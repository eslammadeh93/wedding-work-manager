import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    build: {
      manifest: true,
      // Firestore is the only required runtime SDK near this size (134 KB gzip).
      // Feature bundles remain below this threshold and load on demand.
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          // Shared preload helpers must never live inside a lazy PDF bundle:
          // the application entry imports them even before a report is opened.
          onlyExplicitManualChunks: true,
          manualChunks(id) {
            const moduleId = id.replaceAll('\\', '/');
            if (moduleId.includes('vite/preload-helper') || moduleId.includes('commonjsHelpers')) return 'vendor-runtime';
            if (/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return 'vendor-react';
            if (/node_modules\/(jspdf|jspdf-autotable)\//.test(moduleId)) return 'vendor-pdf';
            if (moduleId.includes('/node_modules/xlsx/')) return 'vendor-xlsx';
            if (/node_modules\/@firebase\/firestore\//.test(moduleId)) return 'firebase-firestore';
            if (/node_modules\/@firebase\/auth\//.test(moduleId)) return 'firebase-auth';
          },
        },
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
