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

/**
 * Ouvre une connexion et suit cette partie ; retourne la connexion et la
 * réponse à 'join'. `token` : le jeton d'un joueur ; `cookie` : la session
 * d'un compte, comme le navigateur l'enverrait avec la poignée de main WebSocket.
 */
async function join(code, { token, cookie } = {}) {
  const socket = io(api.base, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    extraHeaders: cookie ? { cookie } : {},
  });
  // emitWithAck : la réponse du serveur (l'ack), sous forme de promesse.
  const reply = await socket.emitWithAck('join', code);
  return { socket, reply };
}

/** Inscrit un joueur dans la partie ; retourne son jeton. */
async function addPlayer(code, nickname) {
  const res = await api.request('POST', `/api/games/${code}/players`, { nickname });
  return res.data.token;
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

  assert.deepEqual((await state).players, [{ nickname: 'zoé', score: 0, online: false }]);
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
  const zoe = await join(code, { token: await addPlayer(code, 'zoé') });
  const host = await join(code, { cookie: alice });

  const received = next(host.socket, 'chat:message');
  const reply = await zoe.socket.emitWithAck('chat:send', { text: ' Bonjour ' });

  assert.deepEqual(reply, {});
  const message = await received;
  assert.equal(message.nickname, 'zoé');
  assert.equal(message.text, 'Bonjour');
  zoe.socket.disconnect();
  host.socket.disconnect();
});

test('une nouvelle connexion reçoit l’historique du chat au join', async () => {
  const code = await newGame();
  const zoe = await join(code, { token: await addPlayer(code, 'zoé') });
  await zoe.socket.emitWithAck('chat:send', { text: 'Premier !' });
  zoe.socket.disconnect();

  const later = await join(code);
  assert.deepEqual(later.reply.chat.messages.map((m) => m.text), ['Premier !']);
  later.socket.disconnect();
});

test('sans jeton, ou avec un message vide, le chat refuse', async () => {
  const code = await newGame();
  const zoe = await join(code, { token: await addPlayer(code, 'zoé') });
  const spectator = await join(code);

  // Le pseudonyme du message est ignoré : c'est le jeton qui dit qui écrit.
  const reply = await spectator.socket.emitWithAck('chat:send', { text: 'Salut' });
  assert.ok(reply.error);
  assert.ok((await zoe.socket.emitWithAck('chat:send', { text: '   ' })).error);
  zoe.socket.disconnect();
  spectator.socket.disconnect();
});

test('chat désactivé par l’animateur : le salon est prévenu, le serveur refuse', async () => {
  const code = await newGame();
  const { socket } = await join(code, { token: await addPlayer(code, 'zoé') });

  const enabled = next(socket, 'chat:enabled');
  const res = await api.request('POST', `/api/games/${code}/chat`, { enabled: false }, alice);
  assert.equal(res.status, 200);
  assert.equal(await enabled, false);

  const reply = await socket.emitWithAck('chat:send', { text: 'Salut' });
  assert.deepEqual(reply, { error: 'Le chat est désactivé.' });

  await api.request('POST', `/api/games/${code}/chat`, { enabled: true }, alice);
  assert.deepEqual(await socket.emitWithAck('chat:send', { text: 'Salut' }), {});
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

// ── Le jeton du joueur ────────────────────────────────────────────────────

/** Attend l'erreur de connexion (connect_error) de cette connexion. */
function connectError(token) {
  const socket = io(api.base, { transports: ['websocket'], auth: { token } });
  return new Promise((resolve) => socket.once('connect_error', (err) => resolve(err.message)));
}

test('un jeton falsifié est refusé dès l’ouverture de la connexion', async () => {
  const code = await newGame();
  const token = await addPlayer(code, 'zoé');
  const forged = token.replace(/^[^.]+/, Buffer.from(JSON.stringify({ code, nickname: 'max' })).toString('base64url'));

  assert.equal(await connectError(forged), 'Jeton invalide.');
  assert.equal(await connectError('n’importe quoi'), 'Jeton invalide.');
});

test('le jeton d’une partie ne permet pas de jouer dans une autre', async () => {
  const token = await addPlayer(await newGame(), 'zoé');
  const { socket, reply } = await join(await newGame(), { token });

  assert.deepEqual(reply, { error: 'Ce jeton est celui d’une autre partie.' });
  socket.disconnect();
});

test('une réponse sans le jeton du joueur est refusée', async () => {
  const code = await newGame();
  const token = await addPlayer(code, 'zoé');
  const state = await api.request('POST', `/api/games/${code}/next`, undefined, alice);
  const choiceId = state.data.question.choices[0].id;

  const anonymous = await api.request('POST', `/api/games/${code}/answers`, { choiceId });
  assert.equal(anonymous.status, 401);

  const res = await fetch(`${api.base}/api/games/${code}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ choiceId }),
  });
  assert.equal(res.status, 201);
});

// ── La présence ───────────────────────────────────────────────────────────

test('un joueur qui se connecte puis part : le salon le voit en ligne, puis hors ligne', async () => {
  const code = await newGame();
  const token = await addPlayer(code, 'zoé');
  const host = await join(code, { cookie: alice });
  assert.equal(host.reply.game.players[0].online, false);

  const arrived = nextState(host.socket);
  const zoe = await join(code, { token });
  assert.equal((await arrived).players[0].online, true);

  const left = nextState(host.socket);
  zoe.socket.disconnect();
  assert.equal((await left).players[0].online, false);
  host.socket.disconnect();
});

test('deux onglets du même joueur : en fermer un ne le met pas hors ligne', async () => {
  const code = await newGame();
  const token = await addPlayer(code, 'zoé');
  const host = await join(code, { cookie: alice });
  const tab1 = await join(code, { token });
  const tab2 = await join(code, { token });

  const state = nextState(host.socket);
  tab1.socket.disconnect();
  assert.equal((await state).players[0].online, true);
  tab2.socket.disconnect();
  host.socket.disconnect();
});

test('l’animateur est reconnu par son cookie ; les autres connexions sont des spectateurs', async () => {
  const code = await newGame();
  const bob = await api.login('bob');
  const host = await join(code, { cookie: alice });
  const other = await join(code, { cookie: bob }); // connecté, mais pas l'animateur de CETTE partie
  const anonymous = await join(code);

  assert.equal(anonymous.reply.game.hostOnline, true);
  assert.equal(anonymous.reply.game.spectatorCount, 2);

  const state = nextState(anonymous.socket);
  host.socket.disconnect();
  assert.equal((await state).hostOnline, false);
  other.socket.disconnect();
  anonymous.socket.disconnect();
});
