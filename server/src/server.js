/**
 * Le point d'entrée du serveur : `npm run dev` et le conteneur lancent ce
 * fichier. Tout le reste (les routes) est dans app.js, testable sans port.
 */
import { app } from './app.js';
import { attachRealtime } from './realtime.js';

const port = process.env.PORT ?? 3000;
const server = app.listen(port, () => {
  console.log(`Quiz M9 : serveur démarré sur http://localhost:${port}`);
});

// Le même serveur HTTP accepte aussi les connexions WebSocket, sur /ws.
attachRealtime(server);
