import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Both values are provided by docker-compose in development and fall back to
// sensible defaults when running `npm run dev` directly on the host.
const clientPort = Number(process.env.CLIENT_PORT) || 3000;
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 is required for the port to be reachable outside the container.
    host: '0.0.0.0',
    port: clientPort,
    strictPort: true,
    // Accept requests proxied from a host/IP other than localhost.
    allowedHosts: true,
    proxy: {
      // Keep the browser on one origin. Vite forwards /api/* to Express over
      // the compose bridge network, so the React code uses relative URLs.
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
