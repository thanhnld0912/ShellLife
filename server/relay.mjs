// Server chuyển tin cho chơi mạng (bản thử): chỉ giữ PHÒNG và chuyển tin nhắn giữa các máy, không chạy game.
// Máy tạo phòng (chủ phòng) chạy toàn bộ ca làm việc; máy vào phòng gửi thao tác lên chủ phòng và nhận lại trạng thái.
//
// Tin nhắn (JSON) từ máy chơi:
//   { t: 'create', name }        tạo phòng mới, mình là chủ phòng (người 0)
//   { t: 'join', code, name }    vào phòng có mã
//   { t: 'start', d }            chủ phòng bắt đầu ca: gửi d cho mọi người trong phòng, khoá phòng
//   { t: 'send', d, to? }        chủ phòng: gửi cho người `to` (bỏ trống: mọi người) · người vào phòng: gửi cho chủ phòng
//   { t: 'leave' }
// Server gửi về:
//   { t: 'lobby', code, you, players }   danh sách người trong phòng (you: mình là người thứ mấy)
//   { t: 'start', d } · { t: 'msg', from, d } · { t: 'left', idx, name } · { t: 'closed', msg } · { t: 'err', msg }

import { WebSocketServer } from 'ws';

/** Số người tối đa mỗi phòng (bản thử: 2). */
export const MAX_PLAYERS = 2;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MSG = 512 * 1024;

/** @typedef {{ ws: import('ws').WebSocket, name: string } | null} Seat */
/** @typedef {{ code: string, seats: Seat[], started: boolean }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function lobby(room) {
  const players = room.seats.map((s) => (s ? s.name : null));
  room.seats.forEach((s, you) => s && send(s.ws, { t: 'lobby', code: room.code, you, players, started: room.started }));
}

/**
 * Gắn server chuyển tin vào một http.Server (Vite dev / preview, hoặc server/serve.mjs). Đường dẫn: /net
 * @param {import('node:http').Server} httpServer
 */
export function attachRelay(httpServer, path = '/net') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
  httpServer.on('upgrade', (req, socket, head) => {
    // Chỉ nhận đúng đường /net (để yên cho kết nối HMR của Vite)
    if (!req.url || req.url.split('?')[0] !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });
  // Giữ kết nối sống qua đường hầm (Cloudflare Tunnel / ngrok cắt kết nối im lặng lâu)
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20000);
  httpServer.on('close', () => clearInterval(ping));
  return wss;
}

function onConnection(ws) {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  /** @type {Room | null} */
  let room = null;
  let idx = -1;

  const leave = () => {
    if (!room) return;
    const r = room;
    const me = ws.relayIdx ?? idx;
    room = null;
    idx = -1;
    const name = r.seats[me]?.name ?? '';
    if (me === 0) {
      // Chủ phòng rời: đóng phòng
      for (const s of r.seats) if (s && s.ws !== ws) send(s.ws, { t: 'closed', msg: 'Chủ phòng đã rời phòng.' });
      rooms.delete(r.code);
      return;
    }
    if (!r.started) {
      // Chưa bắt đầu: xếp lại chỗ, ai cũng biết mình là người thứ mấy
      r.seats.splice(me, 1);
      r.seats.forEach((s, i) => s && (s.ws.relayIdx = i));
      lobby(r);
    } else {
      r.seats[me] = null;
      send(r.seats[0]?.ws, { t: 'left', idx: me, name });
    }
  };

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    const name = String(m.name ?? '').trim().slice(0, 14) || 'Nhân viên';
    switch (m.t) {
      case 'create': {
        leave();
        const code = newCode();
        room = { code, seats: [{ ws, name }], started: false };
        rooms.set(code, room);
        idx = 0;
        ws.relayIdx = 0;
        lobby(room);
        break;
      }
      case 'join': {
        const code = String(m.code ?? '').trim().toUpperCase();
        const r = rooms.get(code);
        if (!r) return send(ws, { t: 'err', msg: `Không có phòng ${code || '(trống)'}. Kiểm tra lại mã phòng.` });
        if (r.started) return send(ws, { t: 'err', msg: 'Phòng này đã bắt đầu ca.' });
        if (r.seats.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: `Phòng đã đủ ${MAX_PLAYERS} người.` });
        leave();
        room = r;
        idx = r.seats.length;
        ws.relayIdx = idx;
        r.seats.push({ ws, name });
        lobby(r);
        break;
      }
      case 'start': {
        if (!room || idx !== 0) return;
        room.started = true;
        for (const s of room.seats.slice(1)) if (s) send(s.ws, { t: 'start', d: m.d });
        break;
      }
      case 'send': {
        if (!room) return;
        idx = ws.relayIdx ?? idx;
        if (idx === 0) {
          const targets = typeof m.to === 'number' ? [room.seats[m.to]] : room.seats.slice(1);
          for (const s of targets) if (s) send(s.ws, { t: 'msg', from: 0, d: m.d });
        } else {
          send(room.seats[0]?.ws, { t: 'msg', from: idx, d: m.d });
        }
        break;
      }
      case 'leave':
        leave();
        break;
    }
  });
  ws.on('close', () => {
    idx = ws.relayIdx ?? idx;
    leave();
  });
}
