import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PATHS = ['/zones', '/blast-radius', '/events', '/checks', '/contract'];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(API_PATHS.map((p) => [p, 'http://127.0.0.1:3000'])),
  },
});
