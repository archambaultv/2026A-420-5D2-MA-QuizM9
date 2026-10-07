/**
 * Le crochet qui tient l'état de la partie à jour dans le navigateur.
 *
 * Plus de sondage : une connexion WebSocket reste ouverte, et le serveur
 * envoie l'état complet de la partie à chaque changement. Le navigateur ne
 * parle plus que quand il a quelque chose à dire.
 */
import { useEffect, useState } from 'react';

export function useGame(code) {
  const [game, setGame] = useState(null);

  useEffect(() => {
    if (!code) return;

    let ws = null;
    let attempts = 0;
    let retryTimer = null;
    let stopped = false;

    function connect() {
      // Même hôte que la page (Vite relaie /ws) ; wss: si la page est en HTTPS.
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}/ws`);

      ws.addEventListener('open', () => {
        attempts = 0;
        // Une nouvelle connexion ne sait rien : on dit quelle partie on suit.
        // Le serveur répond par l'état complet, ce qui rattrape ce qu'on a
        // manqué pendant une coupure.
        ws.send(JSON.stringify({ type: 'join', code }));
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'state') setGame(message.game);
      });

      // Le navigateur ne se reconnecte jamais tout seul. On attend 1 s, 2 s,
      // 4 s… jusqu'à 30 s, plus un peu de hasard : après un redémarrage du
      // serveur, les clients ne reviennent pas tous à la même milliseconde.
      ws.addEventListener('close', () => {
        if (stopped) return;
        const delay = Math.min(1000 * 2 ** attempts, 30_000) + Math.random() * 1000;
        attempts++;
        retryTimer = setTimeout(connect, delay);
      });
    }

    connect();

    // On quitte la page : on raccroche pour de bon, sans se reconnecter.
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ws.close();
    };
  }, [code]);

  return game;
}
