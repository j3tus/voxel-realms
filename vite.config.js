import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: id => id.includes('node_modules/three') ? 'three' : undefined } } },
  worker: { format: 'es' },
  server: { port: 5173, host: true, proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true }, '/info': 'http://localhost:8080' } },
});
