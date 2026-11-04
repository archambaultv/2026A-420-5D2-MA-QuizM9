/**
 * LA porte d'entrée vers la base. La règle de la semaine 2, valable jusqu'à
 * la fin de la session : aucune requête SQL en dehors du dossier repository/.
 *
 * Semaine 5 : SQLite a cédé sa place à PostgreSQL. Tout le SQL étant ici, le
 * changement est resté confiné ici ; le reste du serveur a seulement appris
 * à attendre (`await`) ses réponses. SQLite reste disponible en secours,
 * pour un poste sans Docker (voir db.js).
 */
export { closeDatabase, initializeDatabase, withTransaction } from './db.js';
export { findAccount, findOrCreateAccount, findPasswordAccount, setAdmin } from './accounts.js';
export {
  addQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  getQuizWithQuestions,
  listGamesForQuiz,
  listQuizzes,
  listQuizzesForAccount,
  searchQuizzes,
  updateQuizDescription,
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
  transitionGame,
  updateGameState,
} from './games.js';
