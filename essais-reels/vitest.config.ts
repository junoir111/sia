import { defineConfig } from 'vitest/config';

// Essai RÉEL contre le serveur SIA (réseau). Hors de `npm run verifier` : `npm run essai-reel`.
export default defineConfig({
  test: {
    root: 'essais-reels',
    environment: 'node',
    include: ['**/*.reel.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
