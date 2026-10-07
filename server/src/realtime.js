/**
 * Le temps réel : une connexion WebSocket par onglet, sur /ws, greffée au
 * serveur HTTP d'Express (même port, 3000).
 *
 * Les ACTIONS restent en HTTP (rejoindre, avancer, répondre). Le WebSocket
 * sert à l'autre sens : le serveur PRÉVIENT les navigateurs qu'une partie a
 * changé, au lieu d'attendre qu'ils le lui demandent.
 *
 * Les messages, en JSON, avec un champ `type` :
 *
 *   navigateur → serveur   { type: 'join', code }       suivre cette partie
 *   serveur → navigateur   { type: 'state', game }      l'état public complet
 *                          { type: 'error', error }
 *
 * Chaque connexion appartient au salon (room) de sa partie. À chaque
 * changement, tout le salon reçoit l'état complet, pas seulement ce qui a
 * changé : un navigateur qui se reconnecte est ainsi à jour d'un seul message.
 */
import { WebSocket, WebSocketServer } from 'ws';
import * as repository from './repository/index.js';
import { closeQuestionIfExpired, publicState } from './game.js';

/** Les salons : code de partie → ensemble des connexions qui la suivent. */
const rooms = new Map();

function join(code, ws) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  rooms.get(code).add(ws);
}

function leave(code, ws) {
  const room = rooms.get(code);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(code);
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/** Greffe le serveur WebSocket au serveur HTTP (celui que retourne app.listen). */
export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let code = null; // la partie que suit CETTE connexion

    ws.on('message', async (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return send(ws, { type: 'error', error: 'Message illisible.' });
      }
      if (message.type !== 'join') {
        return send(ws, { type: 'error', error: 'Type de message inconnu.' });
      }

      try {
        const game = await repository.findGameByCode(String(message.code));
        if (!game) {
          return send(ws, { type: 'error', error: 'Partie introuvable.' });
        }
        if (code) leave(code, ws);
        code = game.code;
        join(code, ws);

        // Comme GET /api/games/:code : une échéance passée pendant que le
        // serveur était arrêté est constatée ici.
        await closeQuestionIfExpired(game);
        send(ws, { type: 'state', game: await publicState(code) });
      } catch (err) {
        console.error(err);
        send(ws, { type: 'error', error: 'Erreur du serveur.' });
      }
    });

    // Indispensable : sans lui, chaque onglet fermé resterait dans son salon.
    ws.on('close', () => {
      if (code) leave(code, ws);
    });

    // Sans gestionnaire 'error', une trame invalide fait planter Node.
    ws.on('error', console.error);
  });

  return wss;
}

/** Envoie l'état de la partie à toutes les connexions qui la suivent. */
export async function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return; // personne ne regarde : inutile de lire la base

  const json = JSON.stringify({ type: 'state', game: await publicState(code) });
  for (const ws of room) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

/**
 * Plus personne ne sonde : c'est le serveur qui clôt la question à son
 * échéance, puis qui prévient le salon.
 */
export function closeAtDeadline(code, deadline) {
  const timer = setTimeout(async () => {
    try {
      const game = await repository.findGameByCode(code);
      await closeQuestionIfExpired(game);
      await broadcastState(code);
    } catch (err) {
      console.error(err);
    }
  }, deadline - Date.now() + 100); // + 100 ms : l'échéance est bien passée

  // N'empêche pas Node de s'arrêter (les tests) s'il ne reste que ce minuteur.
  timer.unref();
}
