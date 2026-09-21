/**
 * Les lectures et écritures des questionnaires. Tout le SQL sur quiz,
 * question et choice vit ici, nulle part ailleurs.
 *
 * Avec pg, une requête s'écrit pool.query(sql, [valeurs]) : les valeurs
 * prennent la place des $1, $2, … et ne sont JAMAIS collées dans la chaîne.
 * La réponse est une promesse ; `rows` contient les lignes.
 */
import { pool, withTransaction } from './db.js';

// ── Les lectures ──────────────────────────────────────────────────────────

/**
 * Tous les questionnaires, avec leur nombre de questions : le catalogue.
 * @returns {Promise<Array<{id: number, title: string, questionCount: number}>>}
 */
export async function listQuizzes() {
  const { rows } = await pool.query(
    `SELECT quiz.id, quiz.title, COUNT(question.id) AS "questionCount"
       FROM quiz
       LEFT JOIN question ON question.quiz_id = quiz.id
      GROUP BY quiz.id
      ORDER BY quiz.id`,
  );
  return rows;
}

/** Les questionnaires d'un auteur : sa liste « Mes questionnaires ». */
export async function listQuizzesForAccount(accountId) {
  const { rows } = await pool.query(
    `SELECT quiz.id, quiz.title, COUNT(question.id) AS "questionCount"
       FROM quiz
       LEFT JOIN question ON question.quiz_id = quiz.id
      WHERE quiz.account_id = $1
      GROUP BY quiz.id
      ORDER BY quiz.id`,
    [accountId],
  );
  return rows;
}

/**
 * Un questionnaire complet : ses questions en ordre, leurs choix, et où est
 * la bonne réponse. C'est la version pour le moteur de jeu et pour l'auteur,
 * jamais pour un joueur en pleine partie.
 *
 * @returns {Promise<null | {id, title, accountId, questions: Array<{id, text,
 *   durationSeconds, choices: Array<{id, text, isCorrect}>}>}>}
 */
export async function getQuizWithQuestions(quizId) {
  const { rows: quizzes } = await pool.query(
    'SELECT id, title, account_id FROM quiz WHERE id = $1',
    [quizId],
  );
  const quiz = quizzes[0];
  if (!quiz) return null;

  const { rows: questions } = await pool.query(
    `SELECT id, text, duration_seconds
       FROM question
      WHERE quiz_id = $1
      ORDER BY position`,
    [quiz.id],
  );
  // Tous les choix du questionnaire d'un coup, puis répartis par question.
  const { rows: choices } = await pool.query(
    `SELECT choice.id, choice.question_id, choice.text, choice.is_correct
       FROM choice
       JOIN question ON question.id = choice.question_id
      WHERE question.quiz_id = $1
      ORDER BY choice.id`,
    [quiz.id],
  );

  return {
    id: quiz.id,
    title: quiz.title,
    accountId: quiz.account_id,
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      durationSeconds: q.duration_seconds,
      choices: choices
        .filter((c) => c.question_id === q.id)
        .map((c) => ({ id: c.id, text: c.text, isCorrect: c.is_correct })),
    })),
  };
}

/**
 * Les parties jouées sur un questionnaire, la plus récente d'abord, avec le
 * nombre de joueurs : le rapport de l'auteur (exercice 10).
 *
 * @returns {Promise<Array<{id, code, state, createdAt, playerCount}>>}
 */
export async function listGamesForQuiz(quizId) {
  const { rows } = await pool.query(
    `SELECT game.id, game.code, game.state,
            game.created_at AS "createdAt",
            COUNT(player.id) AS "playerCount"
       FROM game
       LEFT JOIN player ON player.game_id = game.id
      WHERE game.quiz_id = $1
      GROUP BY game.id
      ORDER BY game.created_at DESC`,
    [quizId],
  );
  return rows;
}

// ── Les écritures de l'espace auteur ──────────────────────────────────────

/**
 * Crée un questionnaire vide, qui appartient à un compte.
 *
 * SQLite donnait l'id dans lastInsertRowid ; PostgreSQL le RETOURNE comme
 * une ligne de résultat.
 *
 * @returns {Promise<number>} l'id du questionnaire créé
 */
export async function createQuiz(title, accountId) {
  const { rows } = await pool.query(
    'INSERT INTO quiz (title, account_id) VALUES ($1, $2) RETURNING id',
    [title, accountId],
  );
  return rows[0].id;
}

/**
 * Ajoute une question à la fin d'un questionnaire, avec ses choix. La
 * question et ses choix s'écrivent ENSEMBLE : une transaction, donc une seule
 * connexion (tx) pour toutes les requêtes.
 *
 * @param {{text: string, durationSeconds: number,
 *   choices: Array<{text: string, isCorrect: boolean}>}} question
 * @returns {Promise<number>} l'id de la question créée
 */
export function addQuestion(quizId, question) {
  return withTransaction(async (tx) => {
    const { rows: positions } = await tx.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM question WHERE quiz_id = $1',
      [quizId],
    );

    const { rows } = await tx.query(
      `INSERT INTO question (quiz_id, position, text, duration_seconds)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [quizId, positions[0].next, question.text, question.durationSeconds],
    );
    const questionId = rows[0].id;

    for (const choice of question.choices) {
      await tx.query(
        'INSERT INTO choice (question_id, text, is_correct) VALUES ($1, $2, $3)',
        [questionId, choice.text, choice.isCorrect],
      );
    }

    return questionId;
  });
}

/**
 * Retire une question d'un questionnaire, choix compris. Échoue (clé
 * étrangère) si la question a déjà été jouée : ses réponses la référencent.
 *
 * @returns {Promise<boolean>} true si une question a été supprimée
 */
export function deleteQuestion(quizId, questionId) {
  return withTransaction(async (tx) => {
    await tx.query('DELETE FROM choice WHERE question_id = $1', [questionId]);
    const { rowCount } = await tx.query(
      'DELETE FROM question WHERE id = $1 AND quiz_id = $2',
      [questionId, quizId],
    );
    return rowCount > 0;
  });
}
