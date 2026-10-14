import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    define: {
      // Carimbo da versão publicada. Serve para responder uma pergunta que
      // esteve em aberto por várias rodadas: o que está no ar é mesmo o último
      // commit? A Vercel expõe o SHA em VERCEL_GIT_COMMIT_SHA no build.
      __BUILD_ID__: JSON.stringify(
        (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 8) +
          ' · ' +
          new Date().toISOString().slice(0, 16).replace('T', ' ')
      ),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
