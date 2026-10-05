import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Where `/api` and `/ws` are proxied to in dev. Defaults to the local server
// (`npm run dev` runs both). Point it at a deployed panel to develop the UI
// against real data without any credentials on the laptop:
//   PANEL_UPSTREAM=https://panel.example.org npm run dev -w @panel/web
const upstream = (process.env.PANEL_UPSTREAM || 'http://localhost:4000').replace(/\/$/, '');
const wsUpstream = upstream.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: upstream, changeOrigin: true, secure: false },
      '/ws': { target: wsUpstream, ws: true, changeOrigin: true, secure: false },
    },
  },
});
