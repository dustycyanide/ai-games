import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { assetIoPlugin } from './plugins/asset-io';

// fs.allow includes the workspace root: assets/, capsules/, and package
// sources live outside the app root and are imported via import.meta.glob.
export default defineConfig({
  plugins: [assetIoPlugin()],
  server: {
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
});
