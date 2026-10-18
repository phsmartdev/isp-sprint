import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/vercel.ts', 'src/vercel-setup.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // pacotes do workspace são TS-fonte: empacotar junto; dependências npm ficam externas
  noExternal: [/^@isp\//],
});
