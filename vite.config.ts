import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// La politique de contenu (CSP) de index.html bloquerait le rechargement à chaud de Vite : on ne la garde
// que dans la version fabriquée (build, preview, APK).
const retirerCspEnDev = {
  name: 'sia-retirer-csp-en-dev',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) =>
    html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
};

export default defineConfig({
  plugins: [react(), retirerCspEnDev],
  // Chiffrement Matrix (WASM) : en mode dev, le pré-assemblage de Vite casserait le chemin vers le
  // fichier .wasm (new URL(..., import.meta.url)). La fabrication (vite build) le gère déjà seule.
  optimizeDeps: {
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/preparation.ts'],
  },
});
