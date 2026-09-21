/**
 * LA porte d'entrée vers la base. La règle de la semaine 2, valable jusqu'à
 * la fin de la session : aucune requête SQL en dehors du dossier repository/.
 *
 * Semaine 5 : SQLite a cédé sa place à PostgreSQL. Tout le SQL étant ici, le
 * changement est resté confiné ici ; le reste du serveur a seulement appris
 * à attendre (`await`) ses réponses.
 */
export { closeDatabase, initializeDatabase, withTransaction } from './db.js';
export { findAccount, findOrCreateAccount } from './accounts.js';
export {
  addQuestion,
  createQuiz,
  deleteQuestion,
  getQuizWithQuestions,
  listGamesForQuiz,
  listQuizzes,
  listQuizzesForAccount,
} from './quizzes.js';
export {
  addPlayer,
  addPointsToPlayer,
  countAnswers,
  createGame,
  findAnswer,
  findGameByCode,
  findPlayer,
  getAnswersForQuestion,
  getPlayers,
  recordAnswer,
  setAnswerPoints,
  updateGameState,
} from './games.js';
