/**
 * Une tempête, pour l'exercice 17 (concurrence). Des joueurs-robots
 * rejoignent une partie. À la première question :
 *
 * 1. chacun répond DEUX fois en même temps (un double-tap sur un téléphone) ;
 * 2. à l'échéance, tous reviennent en même temps, comme trente navigateurs
 *    qui se reconnectent.
 *
 *   node attacks/tempete.js 747311        (12 robots)
 *   node attacks/tempete.js 747311 30     (30 robots)
 *
 * Le serveur (port 3000) doit tourner, et la partie doit être dans le salon
 * d'attente. L'animateur lance la question depuis son navigateur.
 */
import { io } from 'socket.io-client';

const [code, count = '12'] = process.argv.slice(2);
if (!code) {
  console.error('Usage : node attacks/tempete.js <code de partie> [nombre de robots]');
  process.exit(1);
}
const API = process.env.QUIZ_M9_API ?? 'http://localhost:3000';

async function request(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// Les robots rejoignent la partie.
const robots = [];
for (let i = 1; i <= Number(count); i++) {
  const nickname = `robot-${i}`;
  const res = await request('POST', `/api/games/${code}/players`, { nickname });
  if (res.status !== 201) {
    console.error(`${nickname} : ${res.data?.error ?? res.status}`);
    process.exit(1);
  }
  robots.push({ nickname, token: res.data.token });
}
console.log(`${robots.length} robots dans le salon. Lancez la question.`);

// Un spectateur suit la partie pour savoir quand la question s'ouvre.
const socket = io(API, { transports: ['websocket'] });
socket.emit('join', code, () => {});

socket.on('state', async function onState(game) {
  if (game.state !== 'question') return;
  socket.off('state', onState);
  const { choices, deadline } = game.question;

  // Chaque robot ouvre d'abord sa connexion : sinon les ouvertures, une à
  // une, étalent la rafale et les requêtes ne se croisent plus.
  await Promise.all(robots.map(() => request('GET', `/api/games/${code}`)));

  // 1. Le double-tap : deux réponses par robot, en même temps. Les choix
  // sont répartis : un robot sur deux ou trois tombe sur la bonne réponse.
  const statuses = await Promise.all(
    robots.flatMap((r, i) => {
      const choiceId = choices[i % choices.length].id;
      const send = () => request('POST', `/api/games/${code}/answers`, { choiceId }, r.token);
      return [send(), send()];
    }).map((p) => p.then((res) => res.status)),
  );
  const accepted = statuses.filter((s) => s === 201).length;
  console.log(`Réponses acceptées : ${accepted} pour ${robots.length} robots.`);

  // 2. À l'échéance, tout le monde revient en même temps.
  const wait = deadline - Date.now() + 20;
  console.log(`Retour de tous les robots dans ${Math.round(wait / 1000)} s…`);
  setTimeout(async () => {
    await Promise.all(robots.map(() => request('GET', `/api/games/${code}`)));
    const { data } = await request('GET', `/api/games/${code}`);
    console.log('\nClassement après UNE question (10 points au maximum) :');
    for (const p of data.players) {
      const flag = p.score > 10 ? '   <- impossible !' : '';
      console.log(`  ${p.nickname.padEnd(10)} ${String(p.score).padStart(4)} pts${flag}`);
    }
    socket.close();
  }, Math.max(0, wait));
});
