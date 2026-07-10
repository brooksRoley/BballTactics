import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: '/BballTactics/',
  plugins: [vue()],
  server: {
    proxy: {
      // Backend is the zero-next Next.js app (/api/bball/*). Only used when
      // VITE_API_BASE is set to '' (same-origin mode); the default config
      // calls http://localhost:3000 directly with CORS.
      '/api': 'http://localhost:3000'
    }
  }
});
