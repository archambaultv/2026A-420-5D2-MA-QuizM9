/**
 * Le temps réel, avec Socket.IO : une connexion par onglet, greffée au
 * serveur HTTP d'Express (même port, 3000, chemin /socket.io).
 *
 * Les ACTIONS du jeu restent en HTTP (rejoindre, avancer, répondre).
 * Socket.IO sert à l'autre sens : le serveur PRÉVIENT les navigateurs qu'une
 * partie a changé, au lieu d'attendre qu'ils le lui demandent. Seule
 * exception : les messages du chat, qui partent du navigateur par Socket.IO.
 *
 * Ce que Socket.IO fait à notre place, comparé au WebSocket de la semaine 7 :
 * - des ÉVÉNEMENTS nommés plutôt qu'un champ `type`, sans JSON.parse ;
 * - les SALONS (rooms) : socket.join(code), puis io.to(code).emit(...) ;
 * - l'ACCUSÉ DE RÉCEPTION (ack) : une fonction qui répond à CET envoi ;
 * - la reconnexion automatique, côté navigateur.
 *
 * QUI est au bout d'une connexion se décide UNE fois, à l'ouverture (la
 * poignée de main, une requête HTTP), dans l'intergiciel io.use :
 * - un joueur présente son jeton : io({ auth: { token } }) ;
 * - l'animateur est reconnu par son cookie de session, qui part tout seul
 *   avec la poignée de main, comme avec n'importe quelle requête ;
 * - les autres sont des spectateurs.
 * Le résultat est rangé dans socket.data, et les événements le relisent là :
 * le client ne dit plus qui il est à chaque message.
 *
 * Les événements :
 *
 *   navigateur → serveur   'join', code, ack     suivre cette partie
 *                                                ack({ game, chat }) ou ack({ error })
 *   serveur → navigateur   'state', game         l'état public complet, avec la présence
 *
 *   navigateur → serveur   'chat:send', { text }, ack
 *                                                ack({}) ou ack({ error })
 *   serveur → navigateur   'chat:message', { id, nickname, text, sentAt }
 *   serveur → navigateur   'chat:enabled', enabled   l'animateur a coupé ou rouvert le chat
 *
 * À chaque changement, tout le salon reçoit l'état complet, pas seulement ce
 * qui a changé : un navigateur qui se reconnecte est ainsi à jour d'un seul
 * message. Le chat suit la même idée : le 'join' renvoie tout l'historique,
 * puis chaque nouveau message arrive seul.
 */
import { Server } from 'socket.io';
import * as repository from './repository/index.js';
import { closeQuestionIfExpired, publicState } from './game.js';
import { readSession, verifyPlayerToken } from './session.js';

/** Le serveur Socket.IO ; null tant que attachRealtime n'a pas été appelé. */
let io = null;

/**
 * Le chat de chaque partie, EN MÉMOIRE : code → { enabled, messages }.
 * Rien en base : un redémarrage du serveur l'efface.
 */
const chats = new Map();
const MAX_MESSAGES = 50; // l'historique garde les derniers seulement
const MAX_LENGTH = 200;
let nextMessageId = 1;

/** Le chat de cette partie, créé (actif, vide) au premier usage. */
function chatOf(code) {
  if (!chats.has(code)) chats.set(code, { enabled: true, messages: [] });
  return chats.get(code);
}

/**
 * L'état public de la partie, plus la PRÉSENCE : qui est en ligne en ce
 * moment. La présence n'est écrite nulle part ; elle se déduit des
 * connexions ouvertes dans le salon. Un joueur avec deux onglets a deux
 * connexions, mais il n'est qu'une personne : d'où le Set.
 */
async function stateWithPresence(code) {
  const state = await publicState(code);
  const sockets = await io.in(code).fetchSockets();
  const online = new Set(
    sockets.filter((s) => s.data.role === 'player').map((s) => s.data.player.nickname),
  );
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, online: online.has(p.nickname) })),
    hostOnline: sockets.some((s) => s.data.role === 'host'),
    spectatorCount: sockets.filter((s) => s.data.role === 'spectator').length,
  };
}

/** Greffe Socket.IO au serveur HTTP (celui que retourne app.listen). */
export function attachRealtime(server) {
  io = new Server(server);

  // L'intergiciel de la poignée de main : il s'exécute une fois par
  // connexion, avant 'connection'. next(new Error(...)) refuse la connexion ;
  // le navigateur reçoit 'connect_error' avec ce message.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token !== undefined) {
      const player = verifyPlayerToken(token);
      if (!player) return next(new Error('Jeton invalide.'));
      socket.data.player = player;
    }
    // socket.request : la requête HTTP de la poignée de main, avec ses cookies.
    socket.data.accountId = readSession(socket.request).accountId ?? null;
    next();
  });

  io.on('connection', (socket) => {
    socket.on('join', async (code, ack) => {
      if (typeof ack !== 'function') return; // un client qui n'attend pas de réponse

      try {
        const game = await repository.findGameByCode(String(code));
        if (!game) {
          return ack({ error: 'Partie introuvable.' });
        }
        const player = socket.data.player;
        if (player && player.code !== game.code) {
          return ack({ error: 'Ce jeton est celui d’une autre partie.' });
        }
        // Une connexion suit une seule partie : on quitte les autres salons.
        // (socket.id est le salon personnel de chaque connexion : on le garde.)
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        socket.join(game.code);
        socket.data.code = game.code; // pour 'chat:send' : la partie de CETTE connexion
        if (player) socket.data.role = 'player';
        else if (socket.data.accountId !== null && socket.data.accountId === game.account_id) {
          socket.data.role = 'host';
        }
        else socket.data.role = 'spectator';

        // Comme GET /api/games/:code : une échéance passée pendant que le
        // serveur était arrêté est constatée ici.
        await closeQuestionIfExpired(game);
        const state = await stateWithPresence(game.code);
        // Les autres apprennent qu'une connexion est arrivée (socket.to :
        // tout le salon SAUF cette connexion, qui reçoit l'état dans l'ack).
        socket.to(game.code).emit('state', state);
        ack({ game: state, chat: chatOf(game.code) });
      } catch (err) {
        console.error(err);
        ack({ error: 'Erreur du serveur.' });
      }
    });

    socket.on('chat:send', (message, ack) => {
      if (typeof ack !== 'function') return;

      // QUI écrit vient du jeton vérifié à la connexion, jamais du message.
      const player = socket.data.player;
      const code = socket.data.code;
      if (!player || !code) {
        return ack({ error: 'Seul un joueur de la partie écrit dans le chat.' });
      }
      const text = typeof message?.text === 'string' ? message.text.trim() : '';
      if (text === '' || text.length > MAX_LENGTH) {
        return ack({ error: `Un message fait de 1 à ${MAX_LENGTH} caractères.` });
      }
      // Le champ grisé du navigateur ne protège rien : c'est ici qu'on refuse.
      const chat = chatOf(code);
      if (!chat.enabled) {
        return ack({ error: 'Le chat est désactivé.' });
      }

      const entry = { id: nextMessageId++, nickname: player.nickname, text, sentAt: Date.now() };
      chat.messages.push(entry);
      if (chat.messages.length > MAX_MESSAGES) chat.messages.shift();
      // Tout le salon, l'auteur compris : il affiche son message à sa réception.
      io.to(code).emit('chat:message', entry);
      ack({});
    });

    // Onglet fermé, réseau coupé, page quittée : la connexion a déjà quitté
    // ses salons. Ceux qui restent reçoivent la nouvelle présence.
    socket.on('disconnect', async () => {
      if (!socket.data.code) return;
      try {
        await broadcastState(socket.data.code);
      } catch (err) {
        console.error(err);
      }
    });
  });

  return io;
}

/** Envoie l'état de la partie à toutes les connexions qui la suivent. */
export async function broadcastState(code) {
  if (!io?.sockets.adapter.rooms.has(code)) return; // personne ne regarde : inutile de lire la base

  io.to(code).emit('state', await stateWithPresence(code));
}

/** L'animateur coupe ou rouvre le chat : on retient, puis on prévient le salon. */
export function setChatEnabled(code, enabled) {
  chatOf(code).enabled = enabled;
  io?.to(code).emit('chat:enabled', enabled);
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
