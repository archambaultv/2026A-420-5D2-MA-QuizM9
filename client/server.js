/**
 * Le serveur du client en PRODUCTION (dans le conteneur). En développement,
 * `react-router dev` fait ce travail, et Vite relaie les appels /api du
 * navigateur vers Express. Ici, on refait les deux : un relais /api (et /ws),
 * puis React Router qui rend les pages à partir du dossier build/.
 */
import net from 'node:net';
import express from 'express';
import { createRequestHandler } from '@react-router/express';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const port = process.env.PORT ?? 5173;

const app = express();

// Le relais : le navigateur appelle /api/... sur CE serveur, qui transmet à
// Express tel quel (méthode, corps, cookie, réponse) et renvoie ce qu'il
// répond. Le cookie de session part avec la requête et revient avec la
// réponse (Set-Cookie) : pour le navigateur, l'API et les pages sont un
// seul et même site.
app.use('/api', express.raw({ type: '*/*' }), async (req, res) => {
  const init = { method: req.method, headers: {}, redirect: 'manual' };
  if (req.get('cookie')) init.headers.cookie = req.get('cookie');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers['content-type'] = req.get('content-type') ?? 'application/json';
    init.body = req.body;
  }
  const upstream = await fetch(`${API_URL}/api${req.url}`, init);
  res.status(upstream.status);
  for (const name of ['content-type', 'location']) {
    if (upstream.headers.has(name)) res.set(name, upstream.headers.get(name));
  }
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length > 0) res.set('set-cookie', cookies);
  res.send(Buffer.from(await upstream.arrayBuffer()));
});

// Les fichiers construits par Vite (JavaScript, CSS), puis les pages.
app.use(express.static('build/client', { maxAge: '1h' }));
app.use(createRequestHandler({ build: await import('./build/server/index.js') }));

const server = app.listen(port, () => {
  console.log(`Quiz M9 — client démarré sur http://localhost:${port} (API : ${API_URL})`);
});

// Le relais WebSocket. Une requête d'ouverture (Upgrade) n'arrive pas à
// Express : le serveur HTTP la signale par l'événement 'upgrade'. On ouvre
// une connexion TCP vers l'API, on lui réécrit la requête telle quelle, puis
// on branche les deux tuyaux : la réponse 101 et toutes les trames passent
// d'un côté à l'autre sans être lues.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();

  const api = new URL(API_URL);
  const upstream = net.connect(api.port || 80, api.hostname, () => {
    let request = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      request += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    upstream.write(request + '\r\n');
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
