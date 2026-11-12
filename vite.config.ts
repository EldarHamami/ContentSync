import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "single" mode inlines everything into one HTML file (used for the hosted preview page).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: { __SINGLE__: JSON.stringify(mode === 'single') },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
}));
