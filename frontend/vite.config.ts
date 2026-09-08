import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

/**
 * `npm run dev`        → http://localhost:5173 (camera works: localhost is a secure context)
 * `npm run dev:mobile` → https://<lan-ip>:5173 (camera works on a phone or tablet over the LAN;
 *                        the self-signed certificate must be accepted once per device)
 *
 * The config lives in frontend/ and is invoked from the repository root, so the
 * project root is pinned to this directory explicitly.
 */
const useHttps = process.env.HTTPS === 'true';
const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  root: __dirname,
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(repoRoot, 'shared'),
    },
  },
  server: {
    port: 5173,
    // Exposed on the LAN so the workspace can be demonstrated from a mobile device.
    host: true,
    fs: {
      // shared/ sits beside frontend/, outside the Vite root.
      allow: [repoRoot],
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Charts and the router change far less often than app code.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
