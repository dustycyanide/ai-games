import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * `vite build --mode standalone` folds the whole app into one HTML file: the
 * script and stylesheet are inlined into the page (fonts are already base64 in
 * the CSS via assetsInlineLimit), so it runs from a double-click with no server.
 */
function singleFile(fileName: string): Plugin {
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file === html) continue;
        if (file.type === 'chunk') {
          // A literal "</script" inside the code would end the inline tag early.
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          page = page.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => `<script type="module">\n${code}\n</script>`);
        } else if (name.endsWith('.css')) {
          page = page.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${String(file.source)}\n</style>`);
        } else {
          this.error(`single-file: ${name} was not inlined`);
        }
        delete bundle[name];
      }
      html.source = page;
      html.fileName = fileName;
    },
  };
}

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: './',
    plugins: standalone ? [singleFile('tonic-o-matic.html')] : [],
    build: {
      // three.js alone is ~700 kB minified; one chunk is fine for a single-page toy.
      chunkSizeWarningLimit: 900,
      ...(standalone
        ? { outDir: 'dist/standalone', assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false, modulePreload: false as const }
        : {}),
    },
    // fs.allow includes the workspace root so the @ai-games/schema source (a
    // workspace package consumed as raw TypeScript) can be served in dev.
    server: {
      fs: {
        allow: [fileURLToPath(new URL('../..', import.meta.url))],
      },
    },
  };
});
