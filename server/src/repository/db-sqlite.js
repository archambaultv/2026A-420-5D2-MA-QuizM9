/**
 * SQLite en secours, pour un poste sans Docker : DATABASE_URL=sqlite:<chemin>
 * (relatif à server/), ou sqlite::memory: pour une base jetable.
 *
 * Ce fichier IMITE l'interface de pg pour que le reste de repository/ ne
 * change pas : `pool.query(sql, [valeurs])` retourne { rows, rowCount },
 * `pool.connect()` prête une « connexion ». Les différences de dialecte
 * sont réglées ici, et nulle part ailleurs :
 *   - les paramètres $1, $2, … deviennent ?1, ?2, … ;
 *   - ILIKE devient LIKE (le LIKE de SQLite ignore déjà la casse) ;
 *   - les booléens deviennent 0 et 1 (SQLite n'en a pas) ;
 *   - FOR SHARE et FOR UPDATE disparaissent : SQLite verrouille déjà toute
 *     la base à chaque écriture ;
 *   - le schéma est schema.sqlite.sql (pas de GENERATED AS IDENTITY).
 *
 * Une limite : SQLite n'a qu'une connexion. Deux transactions simultanées
 * passent donc à tour de rôle (voir connect), et une requête lancée hors
 * transaction pendant ce temps voit ce que la transaction a déjà écrit.
 * Pour la concurrence, PostgreSQL reste la référence.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.env.DATABASE_URL.slice('sqlite:'.length);
const dbPath = target === ':memory:' ? target : fileURLToPath(new URL(`../../${target}`, import.meta.url));

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

// Les lecteurs (un autre processus) ne bloquent pas le serveur.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/** Exécute une requête écrite pour pg et répond comme pg. */
async function query(sql, params = []) {
  // node:sqlite répond sur-le-champ, PostgreSQL répond par le réseau, plus
  // tard. On imite ce délai : sans lui, deux requêtes HTTP ne se croiseraient
  // jamais, et les bogues de concurrence resteraient invisibles.
  await new Promise((resolve) => setImmediate(resolve));
  const statement = db.prepare(
    sql
      .replace(/\$(\d+)/g, '?$1')
      .replace(/\bILIKE\b/g, 'LIKE')
      .replace(/\bFOR (SHARE|UPDATE)\b/gi, ''),
  );
  const values = params.map((v) => (typeof v === 'boolean' ? Number(v) : v));

  // Une requête qui produit des lignes se lit avec all() ; une écriture
  // se lance avec run(), qui compte les lignes touchées.
  if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    const rows = statement.all(...values);
    return { rows, rowCount: rows.length };
  }
  const { changes } = statement.run(...values);
  return { rows: [], rowCount: changes };
}

// SQLite n'a qu'une connexion. Deux BEGIN sur la même connexion lèvent une
// erreur : connect() fait donc attendre son tour à chaque transaction, jusqu'à
// ce que la précédente appelle release().
let queue = Promise.resolve();

export const pool = {
  query,
  async connect() {
    let release;
    const done = new Promise((resolve) => {
      release = resolve;
    });
    const previous = queue;
    queue = queue.then(() => done);
    await previous;
    return { query, release };
  },
};

/** Crée les tables (schema.sqlite.sql), puis les remplit (seed.sql) si la base est vide. */
export async function initializeDatabase() {
  db.exec(readSql('schema.sqlite.sql'));

  const { rows } = await query('SELECT COUNT(*) AS n FROM quiz');
  if (rows[0].n === 0) {
    db.exec(readSql('seed.sql'));
  }
}

function readSql(name) {
  return readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8');
}

/** Ferme le fichier. */
export async function closeDatabase() {
  db.close();
}
