/**
 * Les lectures et écritures des parties : game, player, answer. Tout le SQL
 * sur ces tables vit ici, nulle part ailleurs.
 *
 * Les écritures de fin de question reçoivent un dernier paramètre `db` : la
 * connexion à utiliser. Par défaut le pool ; dans une transaction, le client
 * que withTransaction a emprunté (voir game.js, closeQuestion).
 */
import { pool } from './db.js';

// ── Les écritures d'avant-partie ──────────────────────────────────────────

/**
 * Insère une partie, animée par ce compte (null : personne). state et
 * question_index partent de leurs valeurs par défaut : 'lobby', -1.
 *
 * @returns {Promise<number>} l'id de la partie créée
 */
export async function createGame(quizId, code, createdAt, accountId = null) {
  const { rows } = await pool.query(
    'INSERT INTO game (quiz_id, code, created_at, account_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [quizId, code, createdAt, accountId],
  );
  return rows[0].id;
}

/**
 * Inscrit un joueur dans une partie. Son score part à 0 tout seul.
 *
 * @returns {Promise<number>} l'id du joueur inscrit
 */
export async function addPlayer(gameId, nickname) {
  const { rows } = await pool.query(
    'INSERT INTO player (game_id, nickname) VALUES ($1, $2) RETURNING id',
    [gameId, nickname],
  );
  return rows[0].id;
}

// ── Les lectures ──────────────────────────────────────────────────────────

/** La partie qui porte ce code, ou undefined. */
export async function findGameByCode(code) {
  const { rows } = await pool.query('SELECT * FROM game WHERE code = $1', [code]);
  return rows[0];
}

/** Le joueur qui porte ce pseudonyme dans cette partie, ou undefined. */
export async function findPlayer(gameId, nickname) {
  const { rows } = await pool.query(
    'SELECT * FROM player WHERE game_id = $1 AND nickname = $2',
    [gameId, nickname],
  );
  return rows[0];
}

/** Les joueurs d'une partie, classés : meilleur score, puis alphabétique. */
export async function getPlayers(gameId) {
  const { rows } = await pool.query(
    `SELECT id, nickname, score
       FROM player
      WHERE game_id = $1
      ORDER BY score DESC, nickname`,
    [gameId],
  );
  return rows;
}

/** La réponse d'un joueur à une question, ou undefined s'il n'a pas répondu. */
export async function findAnswer(gameId, playerId, questionId) {
  const { rows } = await pool.query(
    'SELECT * FROM answer WHERE game_id = $1 AND player_id = $2 AND question_id = $3',
    [gameId, playerId, questionId],
  );
  return rows[0];
}

/** Les réponses reçues pour une question, en ordre d'arrivée (horloge du serveur). */
export async function getAnswersForQuestion(gameId, questionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, player_id, choice_id, answered_at, points
       FROM answer
      WHERE game_id = $1 AND question_id = $2
      ORDER BY answered_at, id`,
    [gameId, questionId],
  );
  return rows;
}

/** Combien de réponses reçues pour une question. */
export async function countAnswers(gameId, questionId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS n FROM answer WHERE game_id = $1 AND question_id = $2',
    [gameId, questionId],
  );
  return rows[0].n;
}

// ── Les écritures en cours de partie ──────────────────────────────────────

/**
 * Enregistre la réponse d'un joueur, SEULEMENT si la question questionIndex
 * est encore ouverte. answeredAt vient de l'horloge du serveur (Date.now()),
 * jamais du client.
 *
 * - INSERT … SELECT … WHERE EXISTS : la ligne n'est insérée que si la partie
 *   est encore sur cette question. Vérifier et insérer : une seule requête.
 * - FOR SHARE : si une clôture est en cours (elle a verrouillé la ligne game),
 *   on attend son COMMIT, puis on relit l'état : 'results', donc rien
 *   d'inséré. Sans lui, l'INSERT verrait l'état d'avant la clôture et la
 *   réponse arriverait trop tard pour être comptée.
 * - ON CONFLICT DO NOTHING : si le joueur a déjà répondu (l'index
 *   answer_once), rien n'est inséré, sans erreur.
 *
 * @returns {Promise<number|null>} l'id de la réponse, ou null si refusée
 */
export async function recordAnswer(gameId, playerId, questionId, choiceId, answeredAt, questionIndex) {
  const { rows } = await pool.query(
    `INSERT INTO answer (game_id, player_id, question_id, choice_id, answered_at)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (
        SELECT 1 FROM game
         WHERE id = $1 AND state = 'question' AND question_index = $6
           FOR SHARE
      )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [gameId, playerId, questionId, choiceId, answeredAt, questionIndex],
  );
  return rows[0]?.id ?? null;
}

/**
 * Fait passer la partie d'un état à un autre, SEULEMENT si elle est encore
 * dans l'état de départ. La condition est dans le WHERE : la vérification et
 * l'écriture forment une seule requête, qu'aucune autre ne peut couper.
 *
 *   from : { state, questionIndex }                     l'état attendu
 *   to   : { state, questionIndex, questionStartedAt }  le nouvel état
 *
 * Dans une transaction, l'UPDATE verrouille aussi la ligne game jusqu'au
 * COMMIT : une autre transaction qui veut la modifier attend son tour.
 *
 * @returns {Promise<boolean>} true si la partie a changé ; false si une
 *   autre requête l'avait déjà fait changer
 */
export async function transitionGame(gameId, from, to, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE game SET state = $1, question_index = $2, question_started_at = $3
      WHERE id = $4 AND state = $5 AND question_index = $6`,
    [to.state, to.questionIndex, to.questionStartedAt, gameId, from.state, from.questionIndex],
  );
  return rowCount === 1;
}

/** Fait avancer la machine à états d'une partie, d'un seul UPDATE, sans condition. */
export async function updateGameState(gameId, state, questionIndex, questionStartedAt, db = pool) {
  await db.query(
    'UPDATE game SET state = $1, question_index = $2, question_started_at = $3 WHERE id = $4',
    [state, questionIndex, questionStartedAt, gameId],
  );
}

/** Inscrit les points obtenus par une réponse, une fois la question close. */
export async function setAnswerPoints(answerId, points, db = pool) {
  await db.query('UPDATE answer SET points = $1 WHERE id = $2', [points, answerId]);
}

/** Ajoute des points au total d'un joueur. */
export async function addPointsToPlayer(playerId, points, db = pool) {
  await db.query('UPDATE player SET score = score + $1 WHERE id = $2', [points, playerId]);
}
