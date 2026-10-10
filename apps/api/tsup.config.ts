import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/seed.ts', 'src/scripts/purge-visitors.ts', 'src/scripts/create-platform-admin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // The shared workspace package ships TypeScript source, so bundle it in.
  noExternal: ['@smart-society/shared'],
});
