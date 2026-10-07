/**
 * Quiz M9 : l'application Express, version semaine 7.
 *
 * Ce fichier construit `app` (les routes) sans l'écouter sur un port. C'est
 * server.js qui appelle app.listen ; un test, lui, démarre `app` sur un port
 * libre avec une base temporaire (voir test/helpers.js).
 *
 * L'état des parties vit dans PostgreSQL (DATABASE_URL). Chaque appel au
 * repository est asynchrone : oublier un `await` sur une lecture, c'est
 * tester une promesse (toujours vraie) au lieu d'un résultat.
 *
 * La plomberie d'une requête :  route → moteur de jeu → repository/ → base.
 *
 * Le contrat de l'API :
 *
 *   GET    /api/auth/github                   302 vers GitHub
 *   GET    /api/auth/callback                 302 vers /quizzes, session ouverte
 *   POST   /api/auth/login                    204 session ouverte  corps : { login, password }
 *   POST   /api/auth/logout                   204 session effacée
 *   GET    /api/me                            200 { id, login, name, avatarUrl } ou 401
 *   GET    /api/me/quizzes                    200 [{ id, title, questionCount }] ou 401
 *   GET    /api/quizzes?q=texte               200 [{ id, title, description, questionCount }]
 *   GET    /api/quizzes/:id                   200 le questionnaire complet
 *   GET    /api/quizzes/:id/games             200 [{ id, code, state, createdAt, playerCount }]
 *   POST   /api/quizzes                       201 { id, title }  corps : { title }  (connecté)
 *   PATCH  /api/quizzes/:id                   200 {}             corps : { description }
 *   DELETE /api/quizzes/:id                   200 {}
 *   POST   /api/quizzes/:id/questions         201 { id }         corps : { text, durationSeconds, choices }
 *   DELETE /api/quizzes/:id/questions/:qid    200 {}
 *   POST /api/games                    201 { code }        corps : { quizId }  (connecté)
 *   POST /api/games/:code/players     201 { nickname }    corps : { nickname }
 *   GET  /api/games/:code              200 état public
 *   POST /api/games/:code/next        200 état public     (animateur)
 *   POST /api/games/:code/answers     201 {}              corps : { nickname, choiceId }
 *
 * Toute erreur a la forme { error: "un message" } : 404 si la ressource
 * n'existe pas, 400 pour une demande invalide, 401 s'il faut être connecté,
 * 403 si le compte connecté n'a pas le droit.
 *
 * Chaque route qui change une partie prévient ensuite les navigateurs qui la
 * suivent, par WebSocket (broadcastState, voir realtime.js).
 *
 * Les routes de l'auteur passent par requireAccount puis requireQuizAuthor
 * (authorization.js) : l'autorisation se décide ici, dans l'API, et une
 * seule fois par route.
 */
import express from 'express';
import * as repository from './repository/index.js';
import { auth } from './auth.js';
import { requireAccount, requireGameHost, requireQuizAuthor } from './authorization.js';
import {
  advance,
  closeQuestion,
  closeQuestionIfExpired,
  createGame,
  currentQuestion,
  publicState,
} from './game.js';
import { broadcastState, closeAtDeadline } from './realtime.js';

await repository.initializeDatabase();

export const app = express();
app.use(express.json());
app.use(auth);

/** Retrouve la partie du paramètre :code, ou répond 404. */
async function requestedGame(req, res) {
  const game = await repository.findGameByCode(req.params.code);
  if (!game) {
    res.status(404).json({ error: 'Partie introuvable.' });
    return null;
  }
  return game;
}

// Tous les questionnaires : le catalogue. Avec ?q=, ceux dont le titre
// contient ce texte.
app.get('/api/quizzes', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  res.status(200).json(q ? await repository.searchQuizzes(q) : await repository.listQuizzes());
});

// Les questionnaires de l'auteur connecté.
app.get('/api/me/quizzes', requireAccount, async (req, res) => {
  res.status(200).json(await repository.listQuizzesForAccount(req.account.id));
});

// Un questionnaire complet, avec ses bonnes réponses : la vue de l'AUTEUR,
// pas celle d'un joueur en partie.
app.get('/api/quizzes/:id', requireAccount, requireQuizAuthor, async (req, res) => {
  res.status(200).json(req.quiz);
});

// Les parties jouées sur un questionnaire (exercice 10).
app.get('/api/quizzes/:id/games', requireAccount, requireQuizAuthor, async (req, res) => {
  res.status(200).json(await repository.listGamesForQuiz(req.quiz.id));
});

// ── L'espace auteur ───────────────────────────────────────────────────────
//
// Le formulaire du navigateur a beau exiger un titre (required), l'API
// revérifie tout : n'importe qui peut lui parler sans passer par le
// formulaire (curl, un script). La validation du navigateur est du confort,
// celle du serveur est la règle.

/**
 * Vérifie le corps d'une question. Retourne un message d'erreur, ou null si
 * tout est bon.
 */
function validateQuestion(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text === '') return 'Le texte de la question est obligatoire.';

  const duration = Number(body.durationSeconds);
  if (!Number.isInteger(duration) || duration < 5 || duration > 60) {
    return 'La durée doit être un nombre entier de 5 à 60 secondes.';
  }

  const choices = Array.isArray(body.choices) ? body.choices : [];
  if (choices.length < 2 || choices.length > 4) {
    return 'Une question a de deux à quatre choix.';
  }
  if (choices.some((c) => typeof c?.text !== 'string' || c.text.trim() === '')) {
    return 'Chaque choix doit avoir un texte.';
  }
  if (choices.filter((c) => c.isCorrect === true).length !== 1) {
    return 'Une question a exactement une bonne réponse.';
  }
  return null;
}

// Créer un questionnaire vide : il appartient à l'auteur connecté.
app.post('/api/quizzes', requireAccount, async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (title === '') {
    return res.status(400).json({ error: 'Le titre est obligatoire.' });
  }
  const id = await repository.createQuiz(title, req.account.id);
  res.status(201).json({ id, title });
});

// Changer la description d'un questionnaire (auteur).
app.patch('/api/quizzes/:id', requireAccount, requireQuizAuthor, async (req, res) => {
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (description.length > 500) {
    return res.status(400).json({ error: 'La description fait au plus 500 caractères.' });
  }
  await repository.updateQuizDescription(req.quiz.id, description);
  res.status(200).json({});
});

// Supprimer un questionnaire (auteur). DELETE, jamais GET : une requête GET
// ne doit rien modifier, puisqu'un simple lien, même sur un autre site, la
// déclenche avec le cookie de session (SameSite=Lax).
app.delete('/api/quizzes/:id', requireAccount, requireQuizAuthor, async (req, res) => {
  try {
    await repository.deleteQuiz(req.quiz.id);
  } catch {
    return res.status(400).json({ error: 'Ce questionnaire a déjà été joué : il ne peut plus être supprimé.' });
  }
  res.status(200).json({});
});

// Ajouter une question à la fin d'un questionnaire (auteur).
app.post('/api/quizzes/:id/questions', requireAccount, requireQuizAuthor, async (req, res) => {
  const error = validateQuestion(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  const id = await repository.addQuestion(req.quiz.id, {
    text: req.body.text.trim(),
    durationSeconds: Number(req.body.durationSeconds),
    choices: req.body.choices.map((c) => ({ text: c.text.trim(), isCorrect: c.isCorrect === true })),
  });
  res.status(201).json({ id });
});

// Retirer une question d'un questionnaire (auteur).
app.delete('/api/quizzes/:id/questions/:questionId', requireAccount, requireQuizAuthor, async (req, res) => {
  const quizId = req.quiz.id;
  const questionId = Number(req.params.questionId);
  try {
    if (!(await repository.deleteQuestion(quizId, questionId))) {
      return res.status(404).json({ error: 'Question introuvable.' });
    }
  } catch {
    return res.status(400).json({ error: 'Cette question a déjà été jouée : elle ne peut plus être retirée.' });
  }
  res.status(200).json({});
});

// ── La salle de jeu ───────────────────────────────────────────────────────

// Créer une partie sur un questionnaire (animateur). N'importe quel
// questionnaire du catalogue : animer n'est pas modifier. La partie retient
// son animateur.
app.post('/api/games', requireAccount, async (req, res) => {
  const quizId = Number(req.body?.quizId);
  const quiz = await repository.getQuizWithQuestions(quizId);
  if (!quiz) {
    return res.status(404).json({ error: 'Questionnaire introuvable.' });
  }
  // Le bogue de la semaine 4 : une partie sans question restait bloquée
  // dans le salon d'attente, devant trente personnes.
  if (quiz.questions.length === 0) {
    return res.status(400).json({ error: 'Ce questionnaire n’a aucune question.' });
  }
  const game = await createGame(quizId, req.account.id);
  res.status(201).json({ code: game.code });
});

// Rejoindre une partie avec un pseudonyme (joueur).
app.post('/api/games/:code/players', async (req, res) => {
  const game = await requestedGame(req, res);
  if (!game) return;

  const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
  if (nickname === '') {
    return res.status(400).json({ error: 'Le pseudonyme est obligatoire.' });
  }
  if (game.state !== 'lobby') {
    return res.status(400).json({ error: 'La partie est déjà commencée.' });
  }
  if (await repository.findPlayer(game.id, nickname)) {
    return res.status(400).json({ error: 'Ce pseudonyme est déjà pris.' });
  }

  await repository.addPlayer(game.id, nickname);
  await broadcastState(game.code);
  res.status(201).json({ nickname });
});

// L'état de la partie. Le navigateur ne la sonde plus (il reçoit l'état par
// WebSocket), mais elle reste utile : curl, les tests.
app.get('/api/games/:code', async (req, res) => {
  const game = await requestedGame(req, res);
  if (!game) return;

  await closeQuestionIfExpired(game);
  res.status(200).json(await publicState(game.code));
});

// L'animateur avance : clôt la question en cours, ou passe à la suivante.
// Seulement l'animateur de CETTE partie : les joueurs connaissent le code.
app.post('/api/games/:code/next', requireAccount, requireGameHost, async (req, res) => {
  const game = req.game;
  await closeQuestionIfExpired(game);
  if (game.state === 'question') {
    await closeQuestion(game);
  } else {
    await advance(game);
  }
  const state = await publicState(game.code);
  if (state.state === 'question') {
    closeAtDeadline(game.code, state.question.deadline);
  }
  await broadcastState(game.code);
  res.status(200).json(state);
});

// Un joueur répond à la question en cours.
app.post('/api/games/:code/answers', async (req, res) => {
  const game = await requestedGame(req, res);
  if (!game) return;

  await closeQuestionIfExpired(game);
  if (game.state !== 'question') {
    return res.status(400).json({ error: 'Aucune question en cours.' });
  }

  const { nickname, choiceId } = req.body ?? {};
  const player = await repository.findPlayer(game.id, nickname);
  if (!player) {
    return res.status(400).json({ error: 'Joueur inconnu dans cette partie.' });
  }
  const question = await currentQuestion(game);
  if (await repository.findAnswer(game.id, player.id, question.id)) {
    return res.status(400).json({ error: 'Ce joueur a déjà répondu.' });
  }
  if (!question.choices.some((c) => c.id === choiceId)) {
    return res.status(400).json({ error: 'Choix inconnu pour cette question.' });
  }

  // Le moment de la réponse est celui du SERVEUR : le bonus de rapidité ne
  // se négocie pas avec l'horloge du client (on y reviendra, semaine 11).
  await repository.recordAnswer(game.id, player.id, question.id, choiceId, Date.now());
  await broadcastState(game.code); // l'animateur voit le compte de réponses monter
  res.status(201).json({});
});

// Une erreur levée dans une route (Express 5 attrape aussi les promesses
// rejetées) devient une réponse JSON au lieu de faire tomber le serveur.
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});
