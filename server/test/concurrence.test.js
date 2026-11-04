/**
 * Les tests de l'exercice 17 : la concurrence. Ils sont FOURNIS et échouent
 * au départ. Chaque jalon en fait passer quelques-uns :
 *
 *   npm run test:concurrence -w server
 *
 * Un test de course doit échouer à coup sûr tant que le bogue est là. Pour
 * chaque bogue, il y a donc deux sortes de tests :
 *
 * - la course REJOUÉE pas à pas : on lit la partie deux fois (deux objets
 *   périmés), puis on écrit avec l'un, puis avec l'autre. C'est exactement
 *   ce qui arrive quand deux requêtes se croisent, mais au ralenti ;
 * - la VRAIE course : plusieurs requêtes lancées en même temps (Promise.all).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let api;
let alice;
let repository; // les fonctions de repository/
let engine; // les fonctions de game.js

before(async () => {
  api = await startServer();
  alice = await api.login('alice');
  // Importés APRÈS startServer : DATABASE_URL doit être fixé avant.
  repository = await import('../src/repository/index.js');
  engine = await import('../src/game.js');
  // Les connexions (HTTP et base) s'ouvrent à la demande, une à une : la
  // première rafale arriverait étalée, sans course. On les ouvre d'avance.
  await Promise.all(Array.from({ length: 12 }, () => api.request('GET', '/api/quizzes')));
});
after(() => api.close());

// ── Les outils ────────────────────────────────────────────────────────────

/** Une partie neuve, dans le salon d'attente, sur un questionnaire de deux questions. */
async function newGame() {
  const quiz = await api.request('POST', '/api/quizzes', { title: 'Concurrence' }, alice);
  for (const text of ['2 + 2 ?', '3 + 3 ?']) {
    await api.request('POST', `/api/quizzes/${quiz.data.id}/questions`, {
      text,
      durationSeconds: 30,
      choices: [{ text: 'la bonne', isCorrect: true }, { text: 'la mauvaise' }],
    }, alice);
  }
  const game = await api.request('POST', '/api/games', { quizId: quiz.data.id }, alice);
  return game.data.code;
}

/** L'état public de la partie. */
async function stateOf(code) {
  return (await api.request('GET', `/api/games/${code}`)).data;
}

/** L'animateur clique sur le bouton, en disant l'état qu'il a sous les yeux. */
async function hostNext(code, expected) {
  const body = expected ?? (({ state, questionIndex }) => ({ state, questionIndex }))(await stateOf(code));
  return api.request('POST', `/api/games/${code}/next`, body, alice);
}

/** Un joueur répond, avec son jeton. */
async function answer(code, token, choiceId) {
  const res = await fetch(`${api.base}/api/games/${code}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ choiceId }),
  });
  return res.status;
}

/**
 * Une partie avec ces joueurs, la première question ouverte. Retourne le
 * code, les jetons (par pseudonyme), les lignes de la base et les choix.
 */
async function openQuestion(nicknames = ['zoé']) {
  const code = await newGame();
  const tokens = {};
  for (const nickname of nicknames) {
    const res = await api.request('POST', `/api/games/${code}/players`, { nickname });
    tokens[nickname] = res.data.token;
  }
  await hostNext(code);
  const game = await repository.findGameByCode(code);
  const question = await engine.currentQuestion(game);
  const right = question.choices.find((c) => c.isCorrect).id;
  const wrong = question.choices.find((c) => !c.isCorrect).id;
  const player = await repository.findPlayer(game.id, nicknames[0]);
  return { code, tokens, game, question, player, right, wrong };
}

/** Les scores, par pseudonyme. */
async function scores(code) {
  const { players } = await stateOf(code);
  return Object.fromEntries(players.map((p) => [p.nickname, p.score]));
}

/** Les réponses enregistrées pour la question, avec leurs points. */
async function answersOf(game, question) {
  return repository.getAnswersForQuestion(game.id, question.id);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Jalon 1 : une réponse par joueur ──────────────────────────────────────

test('J1.1 la base garde une seule réponse par joueur et par question', async () => {
  const { game, question, player, right } = await openQuestion();

  for (let i = 0; i < 2; i++) {
    try {
      await repository.recordAnswer(game.id, player.id, question.id, right, Date.now(), 0);
    } catch {
      // Une erreur est acceptée ici : seul le nombre de lignes compte.
    }
  }
  assert.equal(await repository.countAnswers(game.id, question.id), 1);
});

test('J1.2 recordAnswer retourne null pour un doublon, sans lever d’erreur', async () => {
  const { game, question, player, right } = await openQuestion();

  const first = await repository.recordAnswer(game.id, player.id, question.id, right, Date.now(), 0);
  const second = await repository.recordAnswer(game.id, player.id, question.id, right, Date.now(), 0);
  assert.equal(typeof first, 'number');
  assert.equal(second, null);
});

test('J1.3 POST answers deux fois de suite : 201, puis 409', async () => {
  const { code, tokens, right } = await openQuestion();

  assert.equal(await answer(code, tokens.zoé, right), 201);
  assert.equal(await answer(code, tokens.zoé, right), 409);
});

test('J1.4 dix POST answers simultanés du même joueur : un seul 201', async () => {
  const { code, tokens, game, question, right } = await openQuestion();

  const statuses = await Promise.all(
    Array.from({ length: 10 }, () => answer(code, tokens.zoé, right)),
  );
  assert.equal(await repository.countAnswers(game.id, question.id), 1);
  assert.equal(statuses.filter((s) => s === 201).length, 1);
  assert.equal(statuses.filter((s) => s === 409).length, 9);
});

// ── Jalon 2 : une seule clôture ───────────────────────────────────────────

test('J2.1 transitionGame réussit une fois à partir d’un état, puis échoue', async () => {
  const { game } = await openQuestion();
  const from = { state: 'question', questionIndex: 0 };
  const to = { state: 'results', questionIndex: 0, questionStartedAt: null };

  assert.equal(await repository.transitionGame(game.id, from, to), true);
  assert.equal(await repository.transitionGame(game.id, from, to), false);
  assert.equal((await repository.findGameByCode(game.code)).state, 'results');
});

test('J2.2 deux clôtures avec la même lecture périmée : la deuxième ne change rien', async () => {
  const { code, tokens, right } = await openQuestion();
  await answer(code, tokens.zoé, right);

  // Deux requêtes ont lu la partie AVANT que l'une d'elles la close.
  const a = await repository.findGameByCode(code);
  const b = await repository.findGameByCode(code);

  const first = await engine.closeQuestion(a);
  const afterFirst = await scores(code);
  const second = await engine.closeQuestion(b);
  assert.deepEqual(await scores(code), afterFirst);
  // closeQuestion dit si c'est elle qui a clos la question.
  assert.equal(first, true);
  assert.equal(second, false);
});

test('J2.3 cinq clôtures simultanées : chaque réponse compte une fois, un seul bonus', async () => {
  const { code, tokens, game, question, right } = await openQuestion(['zoé', 'yan', 'xia']);
  for (const token of Object.values(tokens)) await answer(code, token, right);

  const stale = await Promise.all(Array.from({ length: 5 }, () => repository.findGameByCode(code)));
  const results = await Promise.all(stale.map((g) => engine.closeQuestion(g)));

  const answers = await answersOf(game, question);
  const total = Object.values(await scores(code)).reduce((a, b) => a + b, 0);
  assert.equal(total, answers.reduce((sum, a) => sum + a.points, 0));
  // Trois bonnes réponses, rapides : 5 + 2 de rapidité chacune, plus UN bonus de 2.
  assert.equal(total, 3 * 7 + 2);
  assert.equal(results.filter((r) => r === true).length, 1);
});

test('J2.4 à l’échéance, dix requêtes simultanées ne closent la question qu’une fois', async () => {
  const { code, tokens, game, question, right } = await openQuestion();
  await answer(code, tokens.zoé, right);
  // On recule l'ouverture de la question : l'échéance tombe dans 200 ms.
  await repository.updateGameState(game.id, 'question', 0, Date.now() - 30_000 + 200);
  await sleep(300);

  // Dix navigateurs qui reviennent en même temps : chaque GET appelle
  // closeQuestionIfExpired.
  await Promise.all(Array.from({ length: 10 }, () => api.request('GET', `/api/games/${code}`)));

  const [zoé] = await answersOf(game, question);
  assert.equal((await scores(code)).zoé, zoé.points);
});

// ── Jalon 3 : le double-clic de l'animateur ───────────────────────────────

test('J3.1 POST next sans l’état attendu : 400', async () => {
  const code = await newGame();
  await api.request('POST', `/api/games/${code}/players`, { nickname: 'zoé' });

  const res = await api.request('POST', `/api/games/${code}/next`, undefined, alice);
  assert.equal(res.status, 400);
  assert.equal((await stateOf(code)).state, 'lobby');
});

test('J3.2 POST next avec un état périmé : 409, la partie ne bouge pas', async () => {
  const { code } = await openQuestion();

  const res = await hostNext(code, { state: 'lobby', questionIndex: -1 });
  assert.equal(res.status, 409);
  const state = await stateOf(code);
  assert.equal(state.state, 'question');
  assert.equal(state.questionIndex, 0);
});

test('J3.3 double-clic : le même POST next deux fois de suite, 200 puis 409', async () => {
  const { code } = await openQuestion();
  await hostNext(code); // clore la question 1 : on est aux résultats
  const click = { state: 'results', questionIndex: 0 };

  assert.equal((await hostNext(code, click)).status, 200);
  assert.equal((await hostNext(code, click)).status, 409);
  const state = await stateOf(code);
  assert.equal(state.state, 'question'); // la question 2 n'a pas été close
  assert.equal(state.questionIndex, 1);
});

test('J3.4 advance avec une lecture périmée : false, la question n’est pas relancée', async () => {
  const { code } = await openQuestion();
  await hostNext(code); // aux résultats de la question 1
  const a = await repository.findGameByCode(code);
  const b = await repository.findGameByCode(code);

  assert.equal(await engine.advance(a), true);
  const startedAt = (await repository.findGameByCode(code)).question_started_at;
  await sleep(5);
  assert.equal(await engine.advance(b), false);
  const game = await repository.findGameByCode(code);
  assert.equal(game.question_index, 1);
  assert.equal(game.question_started_at, startedAt); // le compte à rebours n'a pas recommencé
});

test('J3.5 deux POST next simultanés : un seul 200', async () => {
  const { code } = await openQuestion();
  await hostNext(code);
  const click = { state: 'results', questionIndex: 0 };

  const [r1, r2] = await Promise.all([hostNext(code, click), hostNext(code, click)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal((await stateOf(code)).state, 'question');
});

// ── Jalon 4 : la réponse qui arrive pendant la clôture ────────────────────

test('J4.1 recordAnswer refuse une réponse quand la question est close', async () => {
  const { code, game, question, player, right } = await openQuestion();
  // La route a vu « question » ; la clôture passe avant son INSERT.
  await engine.closeQuestion(await repository.findGameByCode(code));

  const id = await repository.recordAnswer(game.id, player.id, question.id, right, Date.now(), 0);
  assert.equal(id, null);
  assert.equal(await repository.countAnswers(game.id, question.id), 0);
});

test('J4.2 recordAnswer refuse une réponse à une question qui n’est plus la courante', async () => {
  const { code, game, question, player, right } = await openQuestion();
  await hostNext(code); // résultats de la question 1
  await hostNext(code); // question 2 ouverte

  const id = await repository.recordAnswer(game.id, player.id, question.id, right, Date.now(), 0);
  assert.equal(id, null);
});

test('J4.3 des réponses pendant la clôture : aucune ne reste sans points', async () => {
  const nicknames = Array.from({ length: 12 }, (_, i) => `joueur-${i}`);
  const { code, tokens, game, question, right } = await openQuestion(nicknames);

  // Les réponses partent en rafale ; la clôture part au milieu.
  const answers = nicknames.map(async (n, i) => {
    await sleep(i);
    return answer(code, tokens[n], right);
  });
  const close = (async () => {
    await sleep(nicknames.length / 2);
    return engine.closeQuestion(await repository.findGameByCode(code));
  })();
  await Promise.all([...answers, close]);

  const recorded = await answersOf(game, question);
  assert.deepEqual(recorded.filter((a) => a.points === null), []);
  const total = Object.values(await scores(code)).reduce((a, b) => a + b, 0);
  assert.equal(total, recorded.reduce((sum, a) => sum + a.points, 0));
});
