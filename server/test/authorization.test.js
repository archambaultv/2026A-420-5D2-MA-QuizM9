/**
 * Exercice 12 : qui peut faire quoi. Alice est l'autrice, Bob un autre
 * compte, root un administrateur.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { START, startServer } from './helpers.js';

let api;
let alice;
let bob;
let root;
before(async () => {
  api = await startServer();
  alice = await api.login('alice');
  bob = await api.login('bob');
  root = await api.login('root', { admin: true });
});
after(() => api.close());

/** Crée un questionnaire d'Alice, avec une question, et retourne son id. */
async function aliceQuiz() {
  const { data } = await api.request('POST', '/api/quizzes', { title: 'Le quiz d’Alice' }, alice);
  await api.request('POST', `/api/quizzes/${data.id}/questions`, {
    text: 'Capitale du Canada ?',
    durationSeconds: 20,
    choices: [
      { text: 'Ottawa', isCorrect: true },
      { text: 'Toronto', isCorrect: false },
    ],
  }, alice);
  return data.id;
}

// ── Jalon 1 : il faut un compte ───────────────────────────────────────────

test('GET /api/quizzes/:id sans session est refusé (401)', async () => {
  const quizId = await aliceQuiz();
  const { status } = await api.request('GET', `/api/quizzes/${quizId}`);
  assert.equal(status, 401);
});

// ── Jalon 2 : son questionnaire, pas celui des autres ─────────────────────

test('Bob ne voit pas le questionnaire d’Alice (403)', async () => {
  const quizId = await aliceQuiz();
  const { status, data } = await api.request('GET', `/api/quizzes/${quizId}`, undefined, bob);
  assert.equal(status, 403);
  assert.equal(typeof data.error, 'string');
});
test('Bob ne peut pas ajouter de question au questionnaire d’Alice (403)', async () => {
  const quizId = await aliceQuiz();
  const { status } = await api.request('POST', `/api/quizzes/${quizId}/questions`, {
    text: 'Piratée ?',
    durationSeconds: 20,
    choices: [
      { text: 'Oui', isCorrect: true },
      { text: 'Non', isCorrect: false },
    ],
  }, bob);
  assert.equal(status, 403);

  const { data } = await api.request('GET', `/api/quizzes/${quizId}`, undefined, alice);
  assert.equal(data.questions.length, 1);
});
test('Alice voit son questionnaire (200)', async () => {
  const quizId = await aliceQuiz();
  const { status, data } = await api.request('GET', `/api/quizzes/${quizId}`, undefined, alice);
  assert.equal(status, 200);
  assert.equal(data.id, quizId);
});

// ── Jalon 3 : la partie et son animateur ──────────────────────────────────

test('créer une partie sans session est refusé (401)', async () => {
  const quizId = await aliceQuiz();
  const { status } = await api.request('POST', '/api/games', { quizId });
  assert.equal(status, 401);
});
test('Bob ne peut pas faire avancer la partie d’Alice (403)', async () => {
  const quizId = await aliceQuiz();
  const { data } = await api.request('POST', '/api/games', { quizId }, alice);

  const refused = await api.request('POST', `/api/games/${data.code}/next`, START, bob);
  assert.equal(refused.status, 403);

  const accepted = await api.request('POST', `/api/games/${data.code}/next`, START, alice);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.state, 'question');
});

// ── Jalon 4 : l'administrateur ────────────────────────────────────────────

test('un administrateur voit le questionnaire d’Alice (200)', async () => {
  const quizId = await aliceQuiz();
  const { status } = await api.request('GET', `/api/quizzes/${quizId}`, undefined, root);
  assert.equal(status, 200);
});
