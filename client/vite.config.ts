/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': API_TARGET },
  },
  preview: {
    proxy: { '/api': API_TARGET },
  },
  build: {
    // Pas de source maps publiques en production : elles exposeraient le code source complet.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
