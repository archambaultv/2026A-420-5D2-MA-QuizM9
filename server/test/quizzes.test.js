/**
 * Tests d'INTÉGRATION de l'espace auteur : on démarre l'API sur une base
 * temporaire et on lui parle en HTTP, comme le fait le client.
 *
 * Le premier test est fourni. Les test.todo sont le jalon 2 ; le dernier
 * (« un questionnaire sans question ») est le jalon 3 : il doit ÉCHOUER
 * avant que vous corrigiez la route POST /api/games.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let api;
before(async () => {
  api = await startServer();
});
after(() => api.close());

test('un titre vide est refusé (400)', async () => {
  const { status, data } = await api.request('POST', '/api/quizzes', { title: '   ' });
  assert.equal(status, 400);
  assert.equal(typeof data.error, 'string');
});

test('un titre valide crée le questionnaire (201)', async () => {
  const { status, data } = await api.request('POST', '/api/quizzes', { title: 'Capitales' });
  assert.equal(status, 201);
  assert.equal(data.title, 'Capitales');
  assert.equal(typeof data.id, 'number');
});

// ── Jalon 2 ───────────────────────────────────────────────────────────────

/** Une question valide, à surcharger pour la rendre invalide. */
function question(overrides) {
  return {
    text: 'Capitale du Canada ?',
    durationSeconds: 20,
    choices: [
      { text: 'Ottawa', isCorrect: true },
      { text: 'Toronto', isCorrect: false },
    ],
    ...overrides,
  };
}

/** Crée un questionnaire vide et retourne son id. */
async function createQuiz(title = 'Capitales') {
  const { data } = await api.request('POST', '/api/quizzes', { title });
  return data.id;
}

test('une question sans bonne réponse est refusée (400)', async () => {
  const quizId = await createQuiz();
  const { status, data } = await api.request('POST', `/api/quizzes/${quizId}/questions`, question({
    choices: [
      { text: 'Ottawa', isCorrect: false },
      { text: 'Toronto', isCorrect: false },
    ],
  }));
  assert.equal(status, 400);
  assert.match(data.error, /exactement une bonne réponse/);
});

test('une question avec deux bonnes réponses est refusée (400)', async () => {
  const quizId = await createQuiz();
  const { status } = await api.request('POST', `/api/quizzes/${quizId}/questions`, question({
    choices: [
      { text: 'Ottawa', isCorrect: true },
      { text: 'Toronto', isCorrect: true },
    ],
  }));
  assert.equal(status, 400);
});

test('une question valide est ajoutée et apparaît dans GET /api/quizzes/:id', async () => {
  const quizId = await createQuiz();
  const created = await api.request('POST', `/api/quizzes/${quizId}/questions`, question());
  assert.equal(created.status, 201);

  const { status, data } = await api.request('GET', `/api/quizzes/${quizId}`);
  assert.equal(status, 200);
  assert.equal(data.questions.length, 1);
  assert.equal(data.questions[0].id, created.data.id);
  assert.equal(data.questions[0].text, 'Capitale du Canada ?');
});

// ── Jalon 3 : d'abord le test qui échoue, ensuite la correction ───────────

test('une partie sur un questionnaire sans question est refusée (400)', async () => {
  const quizId = await createQuiz('Vide');
  const { status, data } = await api.request('POST', '/api/games', { quizId });
  assert.equal(status, 400);
  assert.equal(typeof data.error, 'string');
});
