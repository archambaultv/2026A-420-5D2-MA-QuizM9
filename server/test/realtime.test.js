/**
 * Le temps réel avec Socket.IO. Le test utilise le même client que le
 * navigateur (socket.io-client) : il parle au serveur comme le ferait
 * useGame.js.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
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

/** Ouvre une connexion et suit cette partie ; retourne la connexion et la réponse à 'join'. */
async function join(code) {
  const socket = io(api.base, { transports: ['websocket'] });
  // emitWithAck : la réponse du serveur (l'ack), sous forme de promesse.
  const reply = await socket.emitWithAck('join', code);
  return { socket, reply };
}

/** Attend le prochain événement de ce nom sur cette connexion. */
function next(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

/** Attend le prochain événement 'state' de cette connexion. */
function nextState(socket) {
  return next(socket, 'state');
}

test('join répond tout de suite par l’état complet de la partie', async () => {
  const code = await newGame();
  const { socket, reply } = await join(code);

  assert.equal(reply.game.code, code);
  assert.equal(reply.game.state, 'lobby');
  assert.deepEqual(reply.chat, { enabled: true, messages: [] });
  socket.disconnect();
});

test('un joueur qui rejoint : le salon reçoit le nouvel état, sans le demander', async () => {
  const code = await newGame();
  const { socket } = await join(code);

  const state = nextState(socket);
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });

  assert.deepEqual((await state).players, [{ nickname: 'zoé', score: 0 }]);
  socket.disconnect();
});

test('l’animateur lance la partie : la question arrive par Socket.IO', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const { socket } = await join(code);

  const state = nextState(socket);
  await api.request('POST', `/api/games/${code}/next`, undefined, alice);

  const game = await state;
  assert.equal(game.state, 'question');
  assert.equal(game.question.text, '2 + 2 ?');
  socket.disconnect();
});

test('une partie inconnue répond par une erreur', async () => {
  const { socket, reply } = await join('000000');
  assert.deepEqual(reply, { error: 'Partie introuvable.' });
  socket.disconnect();
});

test('le salon d’une autre partie ne reçoit rien', async () => {
  const mine = await join(await newGame());
  const other = await join(await newGame());

  let received = false;
  other.socket.on('state', () => (received = true));
  const state = nextState(mine.socket);
  await api.request('POST', `/api/games/${mine.reply.game.code}/players`, { nickname: 'zoé' });

  await state; // le bon salon a reçu l'état : l'autre l'aurait reçu aussi
  assert.equal(received, false);
  mine.socket.disconnect();
  other.socket.disconnect();
});

// ── Le chat ───────────────────────────────────────────────────────────────

test('un message du chat arrive à tout le salon', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const zoe = await join(code);
  const host = await join(code);

  const received = next(host.socket, 'chat:message');
  const reply = await zoe.socket.emitWithAck('chat:send', { nickname: 'zoé', text: ' Bonjour ' });

  assert.deepEqual(reply, {});
  const message = await received;
  assert.equal(message.nickname, 'zoé');
  assert.equal(message.text, 'Bonjour');
  zoe.socket.disconnect();
  host.socket.disconnect();
});

test('une nouvelle connexion reçoit l’historique du chat au join', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const zoe = await join(code);
  await zoe.socket.emitWithAck('chat:send', { nickname: 'zoé', text: 'Premier !' });
  zoe.socket.disconnect();

  const later = await join(code);
  assert.deepEqual(later.reply.chat.messages.map((m) => m.text), ['Premier !']);
  later.socket.disconnect();
});

test('un pseudonyme inconnu ou un message vide est refusé', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const { socket } = await join(code);

  assert.ok((await socket.emitWithAck('chat:send', { nickname: 'max', text: 'Salut' })).error);
  assert.ok((await socket.emitWithAck('chat:send', { nickname: 'zoé', text: '   ' })).error);
  socket.disconnect();
});

test('chat désactivé par l’animateur : le salon est prévenu, le serveur refuse', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });
  const { socket } = await join(code);

  const enabled = next(socket, 'chat:enabled');
  const res = await api.request('POST', `/api/games/${code}/chat`, { enabled: false }, alice);
  assert.equal(res.status, 200);
  assert.equal(await enabled, false);

  const reply = await socket.emitWithAck('chat:send', { nickname: 'zoé', text: 'Salut' });
  assert.deepEqual(reply, { error: 'Le chat est désactivé.' });

  await api.request('POST', `/api/games/${code}/chat`, { enabled: true }, alice);
  assert.deepEqual(await socket.emitWithAck('chat:send', { nickname: 'zoé', text: 'Salut' }), {});
  socket.disconnect();
});

test('seul l’animateur de la partie coupe le chat', async () => {
  const code = await newGame();
  const bob = await api.login('bob');

  const anonymous = await api.request('POST', `/api/games/${code}/chat`, { enabled: false });
  const other = await api.request('POST', `/api/games/${code}/chat`, { enabled: false }, bob);

  assert.equal(anonymous.status, 401);
  assert.equal(other.status, 403);
});
