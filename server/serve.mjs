// Chạy game đã build (thư mục dist/) + server chuyển tin chơi mạng (/net) trên cùng một cổng.
//   npm run play          build rồi chạy (mặc định cổng 8080)
//   PORT=3000 npm run serve
// Chia sẻ cho bạn ở xa (không cần thuê server): cloudflared tunnel --url http://localhost:8080

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { attachRelay } from './relay.mjs';

const ROOT = join(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Không có file này.');
      return;
    }
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      // file có mã băm trong tên (assets/) thì cho trình duyệt giữ lâu; còn lại luôn hỏi lại
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

attachRelay(server);

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
  console.log(`Hợp Đồng 30 Đêm đang chạy:`);
  console.log(`  Máy này:        http://localhost:${PORT}`);
  for (const u of lan) console.log(`  Cùng mạng wifi: ${u}`);
  console.log(`  Bạn ở xa:       cloudflared tunnel --url http://localhost:${PORT}  (gửi đường link https://…trycloudflare.com cho bạn)`);
});
