/**
 * L'aiguilleur vers le moteur de base de données. DATABASE_URL décide :
 *
 *   postgres://…   PostgreSQL, le moteur du cours (db-postgres.js). C'est le
 *                  défaut : le service postgres de compose.yml.
 *   sqlite:…       SQLite, un simple fichier, pour un poste SANS Docker
 *                  (db-sqlite.js). Rien à installer : il est dans Node.
 *
 * Les deux modules offrent la même interface : `pool.query(sql, [valeurs])`
 * qui retourne { rows, rowCount }, et `pool.connect()` pour une transaction.
 * Le reste de repository/ ne sait pas lequel des deux répond.
 */
const engine = process.env.DATABASE_URL?.startsWith('sqlite:')
  ? await import('./db-sqlite.js')
  : await import('./db-postgres.js');

export const { pool, initializeDatabase, closeDatabase } = engine;

/**
 * Enveloppe des écritures qui doivent réussir ENSEMBLE. Une transaction vit
 * sur UNE connexion : on en emprunte une au pool et on la passe à fn, qui
 * doit s'en servir pour chaque requête. Si fn lève une erreur, tout est
 * annulé (ROLLBACK) ; sinon tout est confirmé (COMMIT).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
