/**
 * Le WebSocket de la semaine 7. Node 24 fournit la même classe WebSocket que
 * le navigateur : le test parle à /ws comme le ferait useGame.js.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let api;
let alice;
before(async () => {
  api = await startServer();
  alice = await api.login('alice');
});
after(() => api.close());

/** Une partie neuve, sur un questionnaire d'une question ; retourne son code. */
async function newGame() {
  const quiz = await api.request('POST', '/api/quizzes', { title: 'Temps réel' }, alice);
  await api.request('POST', `/api/quizzes/${quiz.data.id}/questions`, {
    text: '2 + 2 ?',
    durationSeconds: 30,
    choices: [{ text: '4', isCorrect: true }, { text: '5' }],
  }, alice);
  const game = await api.request('POST', '/api/games', { quizId: quiz.data.id }, alice);
  return game.data.code;
}

/**
 * Ouvre une connexion et envoie ce message dès qu'elle est prête. Retourne la
 * connexion et next(), qui attend le prochain message reçu.
 */
function connect(firstMessage) {
  const ws = new WebSocket(api.wsUrl);
  const received = [];
  const waiting = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (waiting.length > 0) waiting.shift()(message);
    else received.push(message);
  });
  ws.addEventListener('open', () => ws.send(JSON.stringify(firstMessage)));
  const next = () =>
    received.length > 0
      ? Promise.resolve(received.shift())
      : new Promise((resolve) => waiting.push(resolve));
  return { ws, next };
}

test('join reçoit tout de suite l’état complet de la partie', async () => {
  const code = await newGame();
  const { ws, next } = connect({ type: 'join', code });

  const message = await next();
  assert.equal(message.type, 'state');
  assert.equal(message.game.code, code);
  assert.equal(message.game.state, 'lobby');
  ws.close();
});

test('un joueur qui rejoint : le salon reçoit le nouvel état, sans le demander', async () => {
  const code = await newGame();
  const { ws, next } = connect({ type: 'join', code });
  await next(); // l'état initial

  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });

  const message = await next();
  assert.deepEqual(message.game.players, [{ nickname: 'zoé', score: 0 }]);
  ws.close();
});

test('l’animateur lance la partie : la question arrive par le WebSocket', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const { ws, next } = connect({ type: 'join', code });
  await next();

  await api.request('POST', `/api/games/${code}/next`, undefined, alice);

  const message = await next();
  assert.equal(message.game.state, 'question');
  assert.equal(message.game.question.text, '2 + 2 ?');
  ws.close();
});

test('une partie inconnue répond par une erreur', async () => {
  const { ws, next } = connect({ type: 'join', code: '000000' });
  assert.deepEqual(await next(), { type: 'error', error: 'Partie introuvable.' });
  ws.close();
});

test('un message illisible répond par une erreur, sans faire tomber le serveur', async () => {
  const ws = new WebSocket(api.wsUrl);
  const message = new Promise((resolve) =>
    ws.addEventListener('message', (event) => resolve(JSON.parse(event.data))),
  );
  ws.addEventListener('open', () => ws.send('pas du JSON'));
  assert.equal((await message).type, 'error');
  ws.close();
});
