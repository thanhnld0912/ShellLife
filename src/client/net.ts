// Chơi mạng (bản thử, 2 người): kết nối tới server chuyển tin (server/relay.mjs, đường /net trên cùng trang web).
//
// - Máy CHỦ PHÒNG chạy toàn bộ ca làm việc (lõi game như chơi một mình, thêm người chơi thứ 2). Mỗi ~1/15 giây gửi
//   trạng thái (Người Kiểm Kê, vị trí mọi người, kệ hàng, phiếu việc…) và các sự kiện (loa, tiếng động…) cho máy kia.
// - Máy VÀO PHÒNG giữ một BẢN SAO của game (Game.mirror): tự đi lại trên máy mình (gửi vị trí lên), còn mọi việc
//   (lấy hàng, xếp kệ, khiêng kiện…) vừa chạy thử trên bản sao để thấy ngay, vừa gửi lên chủ phòng làm thật.
//   Trạng thái chủ phòng gửi về luôn ghi đè bản sao, nên hai máy không bao giờ lệch nhau lâu.

import type { Game, GameEvent, TaskResult } from '../sim/game.ts';
import type { EventConfig } from '../sim/game.ts';
import type { V2 } from '../sim/geometry.ts';

export interface Lobby {
  code: string;
  /** Mình là người thứ mấy trong phòng (0 = chủ phòng). */
  you: number;
  players: (string | null)[];
}

/** Chủ phòng gửi khi bắt đầu ca. */
export interface StartInfo {
  seed: number;
  names: string[];
  events: Partial<EventConfig>;
}

/** Thao tác của người vào phòng được làm thay trên máy chủ phòng (danh sách trắng). */
export const NET_ACTIONS = [
  'takeItem', 'putBack', 'eat', 'discardHeld', 'scanSection', 'restock', 'restockCold', 'deliver', 'freezer',
  'dropLitter', 'pickUpLitter', 'dropBox', 'takeBox', 'takeColdBox',
  'grabBulky', 'releaseBulky', 'placeBulky', 'grabCart', 'releaseCart', 'loadBulky',
  'takeTrash', 'dumpTrash', 'flipBreaker', 'mainSwitch',
] as const;
type NetAction = (typeof NET_ACTIONS)[number];

// ---- Kết nối ----

export class NetClient {
  lobby: Lobby | null = null;
  onLobby: (l: Lobby) => void = () => {};
  onStart: (s: StartInfo) => void = () => {};
  onMsg: (from: number, d: any) => void = () => {};
  onError: (msg: string) => void = () => {};
  /** Mất kết nối / phòng đóng. */
  onClose: (msg: string) => void = () => {};
  onLeft: (idx: number, name: string) => void = () => {};
  private closedByMe = false;

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(String(e.data), reviver);
      } catch {
        return;
      }
      switch (m.t) {
        case 'lobby':
          this.lobby = { code: m.code, you: m.you, players: m.players };
          this.onLobby(this.lobby);
          break;
        case 'start':
          this.onStart(m.d);
          break;
        case 'msg':
          this.onMsg(m.from, m.d);
          break;
        case 'err':
          this.onError(m.msg);
          break;
        case 'left':
          this.onLeft(m.idx, m.name);
          break;
        case 'closed':
          this.closedByMe = true;
          this.onClose(m.msg);
          ws.close();
          break;
      }
    };
    ws.onclose = () => {
      if (!this.closedByMe) this.onClose('Mất kết nối tới máy chủ.');
    };
  }

  /** Kết nối tới /net của trang hiện tại. */
  static connect(timeoutMs = 6000): Promise<NetClient> {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net`;
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      const t = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        resolve(new NetClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error('error'));
      };
    });
  }

  get isHost(): boolean {
    return this.lobby?.you === 0;
  }

  private raw(o: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o, replacer));
  }

  create(name: string): void {
    this.raw({ t: 'create', name });
  }

  join(code: string, name: string): void {
    this.raw({ t: 'join', code, name });
  }

  start(d: StartInfo): void {
    this.raw({ t: 'start', d });
  }

  /** Chủ phòng: gửi cho người `to` (bỏ trống: mọi người) · người vào phòng: gửi cho chủ phòng. */
  send(d: unknown, to?: number): void {
    this.raw({ t: 'send', d, to });
  }

  leave(): void {
    this.closedByMe = true;
    this.raw({ t: 'leave' });
    this.ws.close();
  }
}

// ---- Đóng gói trạng thái: Set / Map đi qua JSON ----

function replacer(_k: string, v: unknown): unknown {
  if (v instanceof Set) return { $S: [...v] };
  if (v instanceof Map) return { $M: [...v] };
  if (typeof v === 'function') return undefined;
  return v;
}

function reviver(_k: string, v: any): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (Array.isArray(v.$S)) return new Set(v.$S);
    if (Array.isArray(v.$M)) return new Map(v.$M);
  }
  return v;
}

/** Phần Người Kiểm Kê đổi liên tục (gửi mỗi lần); phần còn lại (lộ trình, thông số) gửi trong bản đầy đủ. */
const AU_FAST = ['pos', 'heading', 'beam', 'state', 'stateT', 'capture', 'moving', 'running', 'countT', 'countWho', 'blackout', 'drift', 'suspicion', 'lastSeen', 'storeIndex'];

/** Người chơi: những gì máy của chính người đó tự quyết (không ghi đè bằng bản của chủ phòng). */
const OWN_KEYS = new Set(['pos', 'yaw', 'sheet', 'light', 'sneak', 'moving', 'running']);

// ---- Máy chủ phòng ----

interface Input {
  p: V2;
  y: number;
  mv: boolean;
  rn: boolean;
  sn: boolean;
  sh: boolean;
  li: boolean;
}

export class HostSync {
  private inputs = new Map<number, Input>();
  private out: GameEvent[] = [];
  private fastT = 0;
  private fullT = 0;
  private dirty = true;

  constructor(
    private net: NetClient,
    private game: () => Game | null,
  ) {
    net.onMsg = (from, d) => this.onMsg(from, d);
  }

  private onMsg(from: number, d: any): void {
    const g = this.game();
    if (!g || !d || from <= 0 || from >= g.players.length) return;
    switch (d.t) {
      case 'in':
        this.inputs.set(from, d as Input);
        break;
      case 'act': {
        const a = d.a as NetAction;
        if (!NET_ACTIONS.includes(a) || g.players[from].gone) return;
        const args = Array.isArray(d.args) ? d.args.slice(0, 2) : [];
        // grabBulky / releaseBulky / grabCart: không cho người khác truyền `who` (luôn là chính người đó)
        const safe = a === 'grabBulky' || a === 'grabCart' ? args.slice(0, 1) : a === 'releaseBulky' ? [] : args;
        const fn = (g as unknown as Record<string, (...x: unknown[]) => unknown>)[a];
        const r = g.as(from, () => fn.apply(g, safe));
        const res: TaskResult = typeof r === 'object' && r ? (r as TaskResult) : { ok: !!r, msg: '' };
        this.net.send({ t: 'res', id: d.id, r: res }, from);
        this.dirty = true;
        break;
      }
      case 'noise':
        if (d.at && typeof d.r === 'number') g.noise({ x: +d.at.x, z: +d.at.z }, Math.min(30, d.r), Math.min(5, +d.e || 1));
        break;
    }
  }

  /** Mỗi khung hình (trước game.tick): đặt vị trí người chơi khác, cho lõi game biết họ đi / chạy (thể lực, tiếng xe…). */
  applyInputs(dt: number): void {
    const g = this.game();
    if (!g) return;
    for (const [i, inp] of this.inputs) {
      const p = g.players[i];
      if (!p || !p.alive || p.gone) continue;
      p.pos = { x: inp.p.x, z: inp.p.z };
      p.yaw = inp.y;
      p.sheet = !!inp.sh;
      p.light = !!inp.li;
      g.as(i, () => g.reportMotion(dt, !!inp.mv, !!inp.rn, !!inp.sn));
    }
  }

  /** Người chơi rời phòng giữa ca: buông đồ, không còn trong ca. */
  playerLeft(i: number): void {
    const g = this.game();
    const p = g?.players[i];
    if (!g || !p) return;
    g.as(i, () => {
      g.releaseBulky();
      g.releaseCart();
    });
    p.gone = true;
    p.alive = false;
    this.inputs.delete(i);
    this.dirty = true;
  }

  /** Gửi kèm một sự kiện riêng cho máy kia (vd. sang đêm mới). */
  push(e: GameEvent): void {
    this.out.push(e);
    this.dirty = true;
  }

  /** Gom sự kiện của khung hình này (gọi trước khi xử lý / xoá game.events). */
  collect(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'noise' || e.type === 'dev') continue;
      this.out.push(e);
      this.dirty = true;
    }
  }

  /** Gửi trạng thái ~15 lần/giây; bản đầy đủ (kệ, phiếu việc…) khi có thay đổi hoặc mỗi nửa giây. */
  send(dt: number): void {
    const g = this.game();
    if (!g) return;
    this.fastT -= dt;
    this.fullT -= dt;
    if (this.fastT > 0) return;
    this.fastT = 1 / 15;
    const au = g.auditor as unknown as Record<string, unknown>;
    const fast: Record<string, unknown> = {};
    for (const k of AU_FAST) fast[k] = au[k];
    const msg: Record<string, unknown> = {
      t: 's', m: g.shift.minutes, pw: g.power, ph: g.phase, dr: g.shift.drift, au: fast, pl: g.players, ev: this.out,
    };
    if (this.dirty || this.fullT <= 0) {
      this.fullT = 0.5;
      this.dirty = false;
      const { events: _e, ...auFull } = au;
      void _e;
      msg.full = {
        shift: g.shift, au: auFull, holes: g.holes, records: g.records, wages: g.wages, voucher: g.voucher, breaker: g.breaker,
        blackouts: g.blackouts, night: g.night, storedCount: g.storedCount, eventCfg: g.eventCfg,
      };
    }
    this.net.send(msg);
    this.out = [];
  }
}

// ---- Máy vào phòng ----

export class GuestSync {
  private nextId = 1;
  /** Việc đã gửi lên, chờ chủ phòng trả kết quả (kết quả chạy thử, lúc gửi). */
  private pending = new Map<number, { r: unknown; at: number }>();
  private sendT = 0;
  private inAction = false;
  /** Vị trí / hướng Người Kiểm Kê nhận được (trượt mượt tới đó, gói tin tới thưa). */
  private auTarget: { pos: V2; heading: number; beam: number } | null = null;
  /** Đã nhận trạng thái đầy đủ lần đầu chưa. */
  ready = false;
  /** Kết quả chủ phòng trả về khác với kết quả chạy thử trên máy mình: báo cho người chơi. */
  onResult: (r: TaskResult) => void = () => {};

  constructor(
    private net: NetClient,
    private me: number,
    private game: () => Game | null,
  ) {
    net.onMsg = (from, d) => {
      if (from !== 0 || !d) return;
      if (d.t === 's') this.apply(d);
      if (d.t === 'res') this.result(d.id, d.r);
    };
  }

  /** Biến game trên máy này thành bản sao: việc chạy thử ngay trên bản sao và gửi lên chủ phòng làm thật. */
  wrap(g: Game): void {
    g.mirror = true;
    g.player = g.players[this.me];
    const self = this;
    const G = g as unknown as Record<string, (...x: unknown[]) => unknown>;
    for (const a of NET_ACTIONS) {
      const orig = G[a];
      G[a] = function (...args: unknown[]) {
        const n = g.events.length;
        self.inAction = true;
        let r: unknown;
        try {
          r = orig.apply(g, args);
        } finally {
          self.inAction = false;
        }
        // Sự kiện (âm thanh…) lấy từ chủ phòng gửi về, không lấy từ lần chạy thử (khỏi kêu hai lần)
        g.events.length = n;
        const id = self.nextId++;
        self.pending.set(id, { r, at: performance.now() });
        self.net.send({ t: 'act', id, a, args: args.map((x) => (typeof x === 'object' && x ? { ...(x as object) } : x)) });
        return r;
      };
    }
    // Tiếng động do chính mình gây ra (bước chạy, máy quét, ném lon…): gửi lên để Người Kiểm Kê bên chủ phòng nghe thấy
    g.noise = (at: V2, radius: number, error: number) => {
      if (self.inAction || g.phase !== 'shift') return;
      self.net.send({ t: 'noise', at: { x: at.x, z: at.z }, r: radius, e: error });
    };
  }

  private result(id: number, r: TaskResult): void {
    const local = this.pending.get(id)?.r;
    this.pending.delete(id);
    const lr: TaskResult = typeof local === 'object' && local ? (local as TaskResult) : { ok: !!local, msg: '' };
    if (r.ok !== lr.ok && r.msg) this.onResult(r);
  }

  private apply(d: any): void {
    const g = this.game();
    if (!g) return;
    const au = g.auditor as unknown as Record<string, unknown>;
    // Đang chờ chủ phòng làm việc mình vừa gửi: trạng thái tới lúc này còn cũ (chưa có việc đó), giữ bản chạy thử của mình
    const now = performance.now();
    for (const [id, p] of this.pending) if (now - p.at > 2000) this.pending.delete(id);
    const hold = this.pending.size > 0;
    if (d.full) {
      const f = d.full;
      if (!hold) {
        Object.assign(g.shift, f.shift);
        g.breaker = f.breaker;
      }
      Object.assign(au, f.au);
      g.holes = f.holes;
      g.records = f.records;
      g.wages = f.wages;
      g.voucher = f.voucher;
      g.blackouts = f.blackouts;
      g.night = f.night;
      g.storedCount = f.storedCount;
      g.eventCfg = f.eventCfg;
      this.ready = true;
    }
    const { pos, heading, beam, ...rest } = d.au;
    Object.assign(au, rest);
    const first = !this.auTarget;
    this.auTarget = { pos, heading, beam };
    if (first || Math.hypot(pos.x - g.auditor.pos.x, pos.z - g.auditor.pos.z) > 3) {
      g.auditor.pos = { ...pos };
      g.auditor.heading = heading;
      g.auditor.beam = beam;
    }
    g.shift.minutes = d.m;
    g.shift.drift = d.dr;
    g.power = d.pw;
    g.phase = d.ph;
    (d.pl as Record<string, unknown>[]).forEach((p, i) => {
      const mine = g.players[i];
      if (!mine) return;
      if (i !== this.me) {
        Object.assign(mine, p);
        return;
      }
      if (hold) return;
      for (const [k, v] of Object.entries(p)) if (!OWN_KEYS.has(k)) (mine as unknown as Record<string, unknown>)[k] = v;
    });
    for (const e of d.ev as GameEvent[]) g.events.push(e);
  }

  /** Mỗi khung hình: Người Kiểm Kê trượt mượt, gửi vị trí của mình lên ~20 lần/giây. */
  frame(dt: number, me: { moving: boolean; running: boolean; sneak: boolean }): void {
    const g = this.game();
    if (!g) return;
    const t = this.auTarget;
    if (t) {
      const a = g.auditor;
      const k = Math.min(1, dt * 12);
      a.pos = { x: a.pos.x + (t.pos.x - a.pos.x) * k, z: a.pos.z + (t.pos.z - a.pos.z) * k };
      const turn = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
      a.heading = turn(a.heading, t.heading);
      a.beam = turn(a.beam, t.beam);
    }
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / 20;
    const p = g.players[this.me];
    if (!p) return;
    this.net.send({ t: 'in', p: { x: p.pos.x, z: p.pos.z }, y: p.yaw, mv: me.moving, rn: me.running, sn: me.sneak, sh: p.sheet, li: p.light });
  }
}
