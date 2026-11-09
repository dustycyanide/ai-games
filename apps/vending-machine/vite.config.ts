import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// fs.allow includes the workspace root so the @ai-games/schema source (a
// workspace package consumed as raw TypeScript) can be served in dev.
export default defineConfig({
  base: './',
  // three.js alone is ~700 kB minified; one chunk is fine for a single-page toy.
  build: { chunkSizeWarningLimit: 900 },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
});
