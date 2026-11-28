// Builds the Car Builder (car-builder.html) as one self-contained page, for the chat: it is not
// part of the game. `npm run car-builder` writes dist-car-builder/car-builder.html.
import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const inline = {
  name: 'inline-into-one-page',
  closeBundle() {
    const dir = 'dist-car-builder';
    const js = readFileSync(`${dir}/assets/${readdirSync(`${dir}/assets`).find((f) => f.endsWith('.js'))}`, 'utf8').replaceAll('</script', '<\\/script');
    const html = readFileSync(`${dir}/car-builder.html`, 'utf8')
      .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '')
      .replace('<link rel="manifest"', '<link rel="x-manifest"')
      .replace('</body>', () => `<script type="module">\n${js}\n</script>\n</body>`);
    writeFileSync(`${dir}/car-builder.html`, html);
  },
};

export default defineConfig({
  base: './',
  plugins: [inline],
  build: { outDir: 'dist-car-builder', emptyOutDir: true, target: 'es2020', modulePreload: false, assetsInlineLimit: 1e8, chunkSizeWarningLimit: 5000, rollupOptions: { input: { builder: 'car-builder.html' }, output: { inlineDynamicImports: true } } },
});
