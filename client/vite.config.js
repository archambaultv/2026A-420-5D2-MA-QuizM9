import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';

// Le client (port 5173) relaie ses appels /api au serveur Express (port
// 3000), et ses connexions WebSocket /ws aussi (ws: true : le relais laisse
// passer l'Upgrade). Ce relais vaut pour le NAVIGATEUR ; un loader, lui,
// s'exécute côté serveur et appelle l'API par son adresse complète.
export default defineConfig({
  plugins: [reactRouter()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
