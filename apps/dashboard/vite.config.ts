import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the dashboard runs on its own port and proxies `/api` to ops-manager.
// `npm run dev` (tsx) serves the backend on :3000; the docker stack maps :3100.
// Override with VITE_API_TARGET when needed.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
