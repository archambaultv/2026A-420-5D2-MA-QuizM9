/**
 * Ce qu'un test d'intégration partage : démarrer l'API sur un port libre,
 * avec une base PostgreSQL TEMPORAIRE, et lui parler en JSON.
 *
 * Chaque fichier de test tourne dans son propre processus (node --test), donc
 * chaque fichier crée SA base (quizm9_test_xxxx) sur le serveur PostgreSQL de
 * DATABASE_URL, la remplit par schema.sql et seed.sql, et la détruit à la
 * fin. Deux fichiers lancés en parallèle ne se voient pas.
 *
 * Il faut un PostgreSQL qui tourne : `docker compose up -d postgres`. Sans
 * Docker, DATABASE_URL=sqlite:… suffit : chaque fichier de test reçoit alors
 * une base SQLite en mémoire, jetée à la fin.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://quizm9:quizm9@localhost:5432/quizm9';
const SQLITE = ADMIN_URL.startsWith('sqlite:');

/** Exécute une commande d'administration (CREATE/DROP DATABASE) sur la base principale. */
async function admin(sql) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Démarre l'API et retourne son adresse et une fonction pour l'arrêter. */
export async function startServer() {
  const dbName = `quizm9_test_${randomBytes(4).toString('hex')}`;

  // DATABASE_URL et SESSION_SECRET doivent être fixés AVANT d'importer
  // app.js : db.js et session.js les lisent au chargement.
  if (SQLITE) {
    process.env.DATABASE_URL = 'sqlite::memory:';
  } else {
    await admin(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.href;
  }
  process.env.SESSION_SECRET = 'secret-de-test';

  const { app } = await import('../src/app.js');
  const repository = await import('../src/repository/index.js');
  const { COOKIE_NAME, signSession } = await import('../src/session.js');

  const server = app.listen(0); // 0 : n'importe quel port libre
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;

  return {
    base,
    /** Une requête JSON : retourne { status, data }. `cookie` : la session (voir login). */
    async request(method, path, body, cookie) {
      const headers = {};
      if (body) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const response = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        // pas de corps JSON
      }
      return { status: response.status, data };
    },
    /**
     * Ouvre une session pour un compte de test, sans passer par GitHub :
     * on crée le compte, puis on signe le cookie nous-mêmes avec la clé de
     * test. Retourne la valeur à passer en `cookie` à request().
     */
    async login(login = 'alice') {
      const account = await repository.findOrCreateAccount({
        githubId: 1000 + login.length * 7919 + login.charCodeAt(0),
        login,
        name: null,
        avatarUrl: null,
      });
      return `${COOKIE_NAME}=${signSession({ accountId: account.id })}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await repository.closeDatabase();
      if (!SQLITE) await admin(`DROP DATABASE ${dbName}`);
    },
  };
}
