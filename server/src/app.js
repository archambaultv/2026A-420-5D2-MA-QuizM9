/**
 * Quiz M9 : l'application Express, version semaine 4.
 *
 * Ce fichier construit `app` (les routes) sans l'écouter sur un port. C'est
 * server.js qui appelle app.listen ; un test, lui, démarre `app` sur un port
 * libre avec une base temporaire (voir test/helpers.js). Séparer les deux,
 * c'est ce qui rend l'API testable sans `npm run dev`.
 *
 * L'état des parties vit dans SQLite (server/data/quizm9.db, ou DB_PATH) :
 * on peut redémarrer le serveur en pleine partie. Le client interroge l'état par
 * sondage HTTP toutes les secondes, la dette de la semaine 1, à régler la
 * semaine 7.
 *
 * La plomberie d'une requête :  route → moteur de jeu → repository/ → base.
 *
 * Le contrat de l'API :
 *
 *   GET    /api/quizzes                       200 [{ id, title, questionCount }]
 *   GET    /api/quizzes/:id                   200 le questionnaire complet
 *   POST   /api/quizzes                       201 { id, title }  corps : { title }
 *   POST   /api/quizzes/:id/questions         201 { id }         corps : { text, durationSeconds, choices }
 *   DELETE /api/quizzes/:id/questions/:qid    200 {}
 *   POST /api/games                    201 { code }        corps : { quizId }
 *   POST /api/games/:code/players     201 { nickname }    corps : { nickname }
 *   GET  /api/games/:code              200 état public
 *   POST /api/games/:code/next        200 état public
 *   POST /api/games/:code/answers     201 {}              corps : { nickname, choiceId }
 *
 * Toute erreur a la forme { error: "un message" } : 404 si la ressource
 * n'existe pas, 400 pour une demande invalide.
 */
import express from 'express';
import * as repository from './repository/index.js';
import {
  advance,
  closeQuestion,
  closeQuestionIfExpired,
  createGame,
  currentQuestion,
  publicState,
} from './game.js';

repository.initializeDatabase();

export const app = express();
app.use(express.json());

/** Retrouve la partie du paramètre :code, ou répond 404. */
function requestedGame(req, res) {
  const game = repository.findGameByCode(req.params.code);
  if (!game) {
    res.status(404).json({ error: 'Partie introuvable.' });
    return null;
  }
  return game;
}

// Tous les questionnaires — le catalogue.
app.get('/api/quizzes', (req, res) => {
  res.status(200).json(repository.listQuizzes());
});

// Un questionnaire complet, avec ses bonnes réponses : la vue de l'AUTEUR,
// pas celle d'un joueur en partie. Sera réservée à l'auteur connecté à la
// semaine 5.
app.get('/api/quizzes/:id', (req, res) => {
  const quiz = repository.getQuizWithQuestions(Number(req.params.id));
  if (!quiz) {
    return res.status(404).json({ error: 'Questionnaire introuvable.' });
  }
  res.status(200).json(quiz);
});

// ── L'espace auteur (semaine 3) ───────────────────────────────────────────
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

// Créer un questionnaire vide (auteur).
app.post('/api/quizzes', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (title === '') {
    return res.status(400).json({ error: 'Le titre est obligatoire.' });
  }
  const id = repository.createQuiz(title);
  res.status(201).json({ id, title });
});

// Ajouter une question à la fin d'un questionnaire (auteur).
app.post('/api/quizzes/:id/questions', (req, res) => {
  const quizId = Number(req.params.id);
  if (!repository.getQuizWithQuestions(quizId)) {
    return res.status(404).json({ error: 'Questionnaire introuvable.' });
  }
  const error = validateQuestion(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  const id = repository.addQuestion(quizId, {
    text: req.body.text.trim(),
    durationSeconds: Number(req.body.durationSeconds),
    choices: req.body.choices.map((c) => ({ text: c.text.trim(), isCorrect: c.isCorrect === true })),
  });
  res.status(201).json({ id });
});

// Retirer une question d'un questionnaire (auteur).
app.delete('/api/quizzes/:id/questions/:questionId', (req, res) => {
  const quizId = Number(req.params.id);
  const questionId = Number(req.params.questionId);
  try {
    if (!repository.deleteQuestion(quizId, questionId)) {
      return res.status(404).json({ error: 'Question introuvable.' });
    }
  } catch {
    return res.status(400).json({ error: 'Cette question a déjà été jouée : elle ne peut plus être retirée.' });
  }
  res.status(200).json({});
});

// ── La salle de jeu ───────────────────────────────────────────────────────

// Créer une partie sur un questionnaire (animateur).
app.post('/api/games', (req, res) => {
  const quizId = Number(req.body?.quizId);
  const quiz = repository.getQuizWithQuestions(quizId);
  if (!quiz) {
    return res.status(404).json({ error: 'Questionnaire introuvable.' });
  }
  // Le bogue de la semaine 4 : une partie sans question restait bloquée
  // dans le salon d'attente, devant trente personnes.
  if (quiz.questions.length === 0) {
    return res.status(400).json({ error: 'Ce questionnaire n’a aucune question.' });
  }
  const game = createGame(quizId);
  res.status(201).json({ code: game.code });
});

// Rejoindre une partie avec un pseudonyme (joueur).
app.post('/api/games/:code/players', (req, res) => {
  const game = requestedGame(req, res);
  if (!game) return;

  const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
  if (nickname === '') {
    return res.status(400).json({ error: 'Le pseudonyme est obligatoire.' });
  }
  if (game.state !== 'lobby') {
    return res.status(400).json({ error: 'La partie est déjà commencée.' });
  }
  if (repository.findPlayer(game.id, nickname)) {
    return res.status(400).json({ error: 'Ce pseudonyme est déjà pris.' });
  }

  repository.addPlayer(game.id, nickname);
  res.status(201).json({ nickname });
});

// L'état de la partie — la route que le client sonde toutes les secondes.
app.get('/api/games/:code', (req, res) => {
  const game = requestedGame(req, res);
  if (!game) return;

  closeQuestionIfExpired(game);
  res.status(200).json(publicState(game.code));
});

// L'animateur avance : clôt la question en cours, ou passe à la suivante.
app.post('/api/games/:code/next', (req, res) => {
  const game = requestedGame(req, res);
  if (!game) return;

  closeQuestionIfExpired(game);
  if (game.state === 'question') {
    closeQuestion(game);
  } else {
    advance(game);
  }
  res.status(200).json(publicState(game.code));
});

// Un joueur répond à la question en cours.
app.post('/api/games/:code/answers', (req, res) => {
  const game = requestedGame(req, res);
  if (!game) return;

  closeQuestionIfExpired(game);
  if (game.state !== 'question') {
    return res.status(400).json({ error: 'Aucune question en cours.' });
  }

  const { nickname, choiceId } = req.body ?? {};
  const player = repository.findPlayer(game.id, nickname);
  if (!player) {
    return res.status(400).json({ error: 'Joueur inconnu dans cette partie.' });
  }
  const question = currentQuestion(game);
  if (repository.findAnswer(game.id, player.id, question.id)) {
    return res.status(400).json({ error: 'Ce joueur a déjà répondu.' });
  }
  if (!question.choices.some((c) => c.id === choiceId)) {
    return res.status(400).json({ error: 'Choix inconnu pour cette question.' });
  }

  // Le moment de la réponse est celui du SERVEUR : le bonus de rapidité ne
  // se négocie pas avec l'horloge du client (on y reviendra, semaine 11).
  repository.recordAnswer(game.id, player.id, question.id, choiceId, Date.now());
  res.status(201).json({});
});

// Une erreur levée dans une route — dont les « À faire. » du repository —
// devient une réponse JSON au lieu de faire tomber le serveur.
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});
