import { defineConfig } from 'vite';

// Relative base so the build works from any folder (GitHub Pages project sites, Netlify, a phone test link).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 3000 },
});
