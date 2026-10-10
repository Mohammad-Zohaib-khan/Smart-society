/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const staticPreview = process.env.VITE_STATIC_PREVIEW === '1';

export default defineConfig({
  // The static preview is served from an unknown sub-path, so its asset URLs must be relative.
  base: staticPreview ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin API in development so session cookies need no cross-site rules.
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    // The WebGL stack (three, r3f, shadergradient) is only reachable through a dynamic import in
    // components/visual/Atmosphere.tsx, so it lands in its own lazily loaded chunk.
    chunkSizeWarningLimit: 1200,
    // Preview hosts may refuse font files from their own origin, so inline everything there.
    assetsInlineLimit: staticPreview ? 100_000_000 : 4096,
    outDir: staticPreview ? 'dist-preview' : 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
