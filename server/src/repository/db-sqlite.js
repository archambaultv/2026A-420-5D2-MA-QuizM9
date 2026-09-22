/**
 * SQLite en secours, pour un poste sans Docker : DATABASE_URL=sqlite:<chemin>
 * (relatif à server/), ou sqlite::memory: pour une base jetable.
 *
 * Ce fichier IMITE l'interface de pg pour que le reste de repository/ ne
 * change pas : `pool.query(sql, [valeurs])` retourne { rows, rowCount },
 * `pool.connect()` prête une « connexion ». Les différences de dialecte
 * sont réglées ici, et nulle part ailleurs :
 *   - les paramètres $1, $2, … deviennent ?1, ?2, … ;
 *   - les booléens deviennent 0 et 1 (SQLite n'en a pas) ;
 *   - le schéma est schema.sqlite.sql (pas de GENERATED AS IDENTITY).
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
  const statement = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
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

// SQLite n'a qu'une connexion : « l'emprunter » revient à la rendre telle quelle.
export const pool = {
  query,
  async connect() {
    return { query, release() {} };
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
