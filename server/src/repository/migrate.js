/**
 * Les migrations : faire évoluer une base qui contient déjà des données.
 *
 * Chaque changement du schéma est un fichier de server/data/migrations/,
 * numéroté : 001_schema_initial.sql, 002_….sql, … La table schema_migration
 * retient ceux qui ont déjà été appliqués à CETTE base. Au démarrage, on
 * applique les autres, dans l'ordre des noms, puis on les note.
 *
 * Une migration appliquée ne se modifie plus : on en écrit une nouvelle.
 *
 * Tout se fait dans UNE transaction : si une migration échoue, aucune n'est
 * appliquée et le serveur ne démarre pas. Le verrou du début fait attendre
 * une deuxième instance de l'API qui démarrerait en même temps.
 */
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('../../data/migrations/', import.meta.url);

/** Applique les migrations qui manquent à la base de `pool`. */
export async function migrate(pool) {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(5212)'); // un nombre choisi, le même pour tous
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name       TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migration');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(new URL(file, DIR), 'utf8'));
      await client.query('INSERT INTO schema_migration (name, applied_at) VALUES ($1, $2)', [
        file,
        Date.now(),
      ]);
      console.log(`Migration appliquée : ${file}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
