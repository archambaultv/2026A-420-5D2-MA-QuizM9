/**
 * Le moteur de jeu : l'état des parties vit DANS LA BASE.
 *
 * Une partie est une ligne de la table game, relue à chaque requête ; ses
 * joueurs et leurs réponses sont des lignes de player et answer. On peut
 * redémarrer le serveur en pleine partie : rien n'est perdu.
 *
 * Le moteur ne fait aucun SQL lui-même : il passe par repository/. Depuis la
 * semaine 5, chaque appel au repository est une promesse : `await` partout.
 *
 * Machine à états d'une partie (colonne game.state) :
 *   'lobby' → 'question' ⇄ 'results' → 'finished'
 */
import { calculateScore } from './scoring.js';
import * as repository from './repository/index.js';

/** Un code de partie à six chiffres, unique parmi les parties existantes. */
async function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (await repository.findGameByCode(code));
  return code;
}

/** Crée une partie sur ce questionnaire, animée par ce compte, et retourne sa ligne game. */
export async function createGame(quizId, accountId = null) {
  const code = await generateCode();
  await repository.createGame(quizId, code, Date.now(), accountId);
  return repository.findGameByCode(code);
}

/** La question courante d'une partie, ou null hors d'une question. */
export async function currentQuestion(game) {
  const quiz = await repository.getQuizWithQuestions(game.quiz_id);
  return quiz.questions[game.question_index] ?? null;
}

/** L'échéance de la question courante (horodatage serveur, en ms). */
function deadlineOf(game, question) {
  return game.question_started_at + question.durationSeconds * 1000;
}

/**
 * Clôt la question courante : calcule le pointage de chaque réponse reçue
 * et l'ajoute au total du joueur. Le bonus de la première bonne réponse va à
 * la première bonne réponse dans l'ordre d'arrivée (horloge du serveur).
 *
 * Plusieurs requêtes peuvent vouloir clore la même question en même temps
 * (le minuteur, le clic de l'animateur, trente navigateurs à l'échéance).
 * `game` a été lu AVANT : son état est peut-être déjà périmé. Une seule doit
 * gagner, et c'est la base qui décide : la transaction commence par faire
 * passer la partie de 'question' à 'results' (transitionGame). Les autres
 * reçoivent false et n'écrivent rien.
 *
 * @returns {Promise<boolean>} true si c'est cet appel qui a clos la question
 */
export async function closeQuestion(game) {
  if (game.state !== 'question') return false;
  const question = await currentQuestion(game);
  const correctChoices = new Set(
    question.choices.filter((c) => c.isCorrect).map((c) => c.id),
  );
  const questionDurationMs = question.durationSeconds * 1000;

  const closed = await repository.withTransaction(async (tx) => {
    const won = await repository.transitionGame(
      game.id,
      { state: 'question', questionIndex: game.question_index },
      { state: 'results', questionIndex: game.question_index, questionStartedAt: null },
      tx,
    );
    if (!won) return false; // une autre requête l'a close avant nous

    // Les réponses sont lues APRÈS le changement d'état, dans la transaction.
    const answers = await repository.getAnswersForQuestion(game.id, question.id, tx);
    let firstAwarded = false;
    for (const answer of answers) {
      const responseTimeMs = answer.answered_at - game.question_started_at;
      const isCorrect = correctChoices.has(answer.choice_id);
      const isFirstCorrectAnswer =
        isCorrect && responseTimeMs <= questionDurationMs && !firstAwarded;
      if (isFirstCorrectAnswer) firstAwarded = true;

      const points = calculateScore({
        isCorrect,
        responseTimeMs,
        questionDurationMs,
        isFirstCorrectAnswer,
      });
      await repository.setAnswerPoints(answer.id, points, tx);
      await repository.addPointsToPlayer(answer.player_id, points, tx);
    }
    return true;
  });
  game.state = 'results';
  game.question_started_at = null;
  return closed;
}

/** Clôt la question courante si son échéance est passée. */
export async function closeQuestionIfExpired(game) {
  if (game.state !== 'question') return;
  const question = await currentQuestion(game);
  if (Date.now() > deadlineOf(game, question)) {
    await closeQuestion(game);
  }
}

/**
 * Passe à la question suivante, ou termine la partie s'il n'y en a plus.
 * Comme closeQuestion : seulement si la partie est encore dans l'état lu.
 *
 * @returns {Promise<boolean>} true si c'est cet appel qui a fait avancer la partie
 */
export async function advance(game) {
  if (game.state === 'finished') return false;
  const quiz = await repository.getQuizWithQuestions(game.quiz_id);
  const from = { state: game.state, questionIndex: game.question_index };
  const to =
    game.question_index + 1 >= quiz.questions.length
      ? { state: 'finished', questionIndex: game.question_index, questionStartedAt: null }
      : { state: 'question', questionIndex: game.question_index + 1, questionStartedAt: Date.now() };
  return repository.transitionGame(game.id, from, to);
}

/**
 * L'état visible par les clients, relu au complet dans la base. Les choix
 * sont transmis SANS is_correct : le serveur ne dit jamais au navigateur où
 * est la bonne réponse.
 *
 * remainingMs : le temps restant, plutôt qu'une heure. L'horloge du
 * navigateur peut être décalée, une durée ne l'est jamais (voir useGame.js).
 */
export async function publicState(code) {
  const game = await repository.findGameByCode(code);
  const quiz = await repository.getQuizWithQuestions(game.quiz_id);
  const question = game.state === 'question' ? quiz.questions[game.question_index] : null;
  const players = await repository.getPlayers(game.id);
  return {
    code: game.code,
    state: game.state,
    questionIndex: game.question_index,
    questionCount: quiz.questions.length,
    title: quiz.title,
    question: question && {
      text: question.text,
      deadline: deadlineOf(game, question),
      remainingMs: deadlineOf(game, question) - Date.now(),
      choices: question.choices.map((c) => ({ id: c.id, text: c.text })),
    },
    players: players.map((p) => ({ nickname: p.nickname, score: p.score })),
    answerCount: question ? await repository.countAnswers(game.id, question.id) : 0,
  };
}
