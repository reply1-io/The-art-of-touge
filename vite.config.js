import { defineConfig } from 'vite';

// Relative base so the build works from any folder (GitHub Pages project sites, Netlify, a phone test link).
export default defineConfig({
  base: './',
  // Two pages: the game, and the Car Builder.
  build: { target: 'es2020', chunkSizeWarningLimit: 3000, rollupOptions: { input: { main: 'index.html', builder: 'builder.html' } } },
});
