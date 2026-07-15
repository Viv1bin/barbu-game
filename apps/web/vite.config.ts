import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Chemins relatifs : le site marche à la racine d'un domaine comme dans un
  // sous-dossier (GitHub Pages sert le repo sous /<nom-du-repo>/).
  base: './',
  plugins: [react()],
  // Écoute sur toutes les interfaces : accessible depuis le téléphone / le LAN
  // sans avoir à passer `--host` (npm avale le flag s'il n'y a pas de `--`).
  server: { host: true },
  preview: { host: true },
  resolve: {
    alias: {
      // Moteur compilé (dist) : résolution fiable des extensions .js.
      '@barbu/engine': fileURLToPath(new URL('../../packages/engine/dist/index.js', import.meta.url)),
    },
  },
});
