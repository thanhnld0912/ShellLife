import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Hai trang: game (index.html) và trang xem model (viewer.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
});
