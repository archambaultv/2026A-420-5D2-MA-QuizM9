/**
 * La connexion à PostgreSQL. PostgreSQL est un SERVEUR, plus un fichier : on
 * s'y connecte par une adresse, DATABASE_URL. La valeur par défaut est celle
 * du service postgres de compose.yml, démarré par `docker compose up -d postgres`.
 *
 * Un Pool garde quelques connexions ouvertes et en prête une à chaque
 * requête. Toute requête est ASYNCHRONE : elle part sur le réseau, la
 * réponse revient plus tard, d'où les `await` partout dans repository/.
 */
import pg from 'pg';

const { Pool, types } = pg;

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://quizm9:quizm9@localhost:5432/quizm9';

// Les BIGINT (horodatages, COUNT(*)) arrivent en chaîne par défaut, parce
// qu'un BIGINT peut dépasser ce qu'un Number représente. Pas les nôtres :
// on les convertit en nombres.
types.setTypeParser(types.builtins.INT8, Number);

export const pool = new Pool({ connectionString: DATABASE_URL });

/** Crée les tables (schema.sql), puis les remplit (seed.sql) si la base est vide. */
export async function initializeDatabase() {
  await pool.query(await readSql('schema.sql'));

  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM quiz');
  if (rows[0].n === 0) {
    await pool.query(await readSql('seed.sql'));
    // Les id du seed sont donnés à la main : on avance les compteurs pour
    // que les prochains INSERT n'entrent pas en collision.
    await pool.query(`
      SELECT setval(pg_get_serial_sequence('quiz', 'id'), (SELECT MAX(id) FROM quiz));
      SELECT setval(pg_get_serial_sequence('question', 'id'), (SELECT MAX(id) FROM question));
    `);
  }
}

async function readSql(name) {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL(`../../data/${name}`, import.meta.url), 'utf8');
}

/** Ferme les connexions ; les tests s'en servent pour finir proprement. */
export function closeDatabase() {
  return pool.end();
}
