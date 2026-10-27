/**
 * Le crochet qui tient l'état de la partie, et son chat, à jour dans le
 * navigateur.
 *
 * Une connexion Socket.IO reste ouverte, et le serveur envoie l'état complet
 * de la partie à chaque changement. Socket.IO se reconnecte tout seul (avec
 * un délai croissant) : plus de minuteur de reconnexion à écrire.
 *
 * La connexion appartient à la page : passer du salon à la salle de jeu la
 * ferme, puis en ouvre une autre. Le chat survit parce que le serveur le
 * garde, et le renvoie à chaque 'join'.
 */
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useGame(code) {
  const [game, setGame] = useState(null);
  const [chat, setChat] = useState({ enabled: true, messages: [] });
  const socketRef = useRef(null);

  useEffect(() => {
    if (!code) return;

    // Même hôte que la page : io() sans adresse. WebSocket seulement : sans
    // cette option, Socket.IO commence en HTTP (long polling) puis passe au
    // WebSocket, et nos relais (Vite, client/server.js) ne laissent passer
    // que le WebSocket.
    const socket = io({ transports: ['websocket'] });
    socketRef.current = socket;

    // 'connect' arrive à la première connexion ET à chaque reconnexion. Le
    // serveur a oublié nos salons entre-temps : on redit quelle partie on
    // suit, et sa réponse (l'ack) rattrape ce qu'on a manqué.
    socket.on('connect', () => {
      socket.emit('join', code, (reply) => {
        if (reply.game) setGame(reply.game);
        // L'historique REMPLACE ce qu'on avait : rien en double, rien de manqué.
        if (reply.chat) setChat(reply.chat);
      });
    });

    socket.on('state', setGame);
    socket.on('chat:message', (message) => {
      setChat((chat) => ({ ...chat, messages: [...chat.messages, message] }));
    });
    socket.on('chat:enabled', (enabled) => {
      setChat((chat) => ({ ...chat, enabled }));
    });

    // On quitte la page : on raccroche pour de bon, sans se reconnecter.
    return () => {
      socket.disconnect();
    };
  }, [code]);

  /** Envoie un message au chat ; la réponse du serveur, {} ou { error }. */
  function sendMessage(nickname, text) {
    // timeout : sans réponse en 5 s, la promesse est rejetée au lieu d'attendre.
    return socketRef.current.timeout(5000).emitWithAck('chat:send', { nickname, text });
  }

  return { game, chat, sendMessage };
}
