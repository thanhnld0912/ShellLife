import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
// @ts-ignore file .mjs không có kiểu (server Node thuần)
import { attachRelay } from './server/relay.mjs';

/** Server chuyển tin chơi mạng (/net) chạy chung với Vite (npm run dev / npm run preview). */
function relay(): Plugin {
  return {
    name: 'hd30-relay',
    configureServer(s) {
      if (s.httpServer) attachRelay(s.httpServer);
    },
    configurePreviewServer(s) {
      attachRelay(s.httpServer);
    },
  };
}

// Đường hầm để chơi với bạn ở xa (Cloudflare Tunnel, ngrok) dùng tên miền lạ: cho phép.
const allowedHosts = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'];

// Hai trang: game (index.html) và trang xem model (viewer.html).
export default defineConfig({
  plugins: [relay()],
  server: { allowedHosts },
  preview: { allowedHosts },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
});
