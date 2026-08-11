import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /*
          Split the vendor code out of the app chunk.

          The first paint needs the list view. React, the router and the query
          client change rarely and cache well; keeping them in a separate chunk
          means a deploy that touches only application code does not invalidate
          them, and the app chunk stays small enough to parse quickly on a
          phone.

          Rolldown (Vite 8) takes `advancedChunks` groups; the object form of
          `manualChunks` it replaced is rejected outright.
        */
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router)/ },
            { name: 'vendor', test: /node_modules[\\/](@tanstack|i18next|react-i18next|zod|ulid)/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Mirrors the SWA routing contract: the frontend always calls /api/*, both
    // locally and in the cloud, so no code ever branches on environment.
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
});
