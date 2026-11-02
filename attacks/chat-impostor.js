/**
 * Un imposteur, pour l'exercice 16 (identité). Il écrit dans le chat d'une
 * partie sous le pseudonyme d'un autre joueur, sans être ce joueur.
 *
 *   node attacks/chat-impostor.js 747311 zoé
 *
 * Le serveur (port 3000) doit tourner, et zoé doit avoir rejoint la partie.
 */
import { io } from 'socket.io-client';

const [code, nickname] = process.argv.slice(2);
if (!code || !nickname) {
  console.error('Usage : node attacks/chat-impostor.js <code de partie> <pseudonyme>');
  process.exit(1);
}

const socket = io(process.env.QUIZ_M9_API ?? 'http://localhost:3000', { transports: ['websocket'] });

socket.on('connect_error', (err) => {
  console.log('Connexion refusée :', err.message);
  socket.close();
});

socket.on('connect', async () => {
  const joined = await socket.emitWithAck('join', code);
  if (joined.error) {
    console.log('join :', joined.error);
    return socket.close();
  }
  const reply = await socket.emitWithAck('chat:send', { nickname, text: 'Ce n’est pas moi qui écris !' });
  console.log('Réponse du serveur :', reply);
  socket.close();
});
