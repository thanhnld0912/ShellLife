// Người Kiểm Kê: tuần tra, nhìn bằng tia quét, nghe tiếng động và lần theo điểm nghi ngờ.
// Bình thường chỉ đi bộ. Khi MẤT ĐIỆN: nghe tiếng động hoặc thấy ánh đèn pin rọi tới thì CHẠY tới.
// Bị tia quét giữ đủ countTime giây thì người chơi bị "đóng thùng":
//   lunge (lao tới) → boxing (nhét vào thùng, dán băng keo) → carry (bê thùng về kho)
//   → store (đặt thùng vào hàng "ĐÃ LƯU KHO") → đi tuần tiếp như bình thường.

import type { AABB, V2 } from './geometry.ts';
import { clamp, dist, headingTo, inBox, inflate, rayAABB, segIntersectsAABB, turnToward, wrapAngle } from './geometry.ts';
import {
  AUDITOR_DOOR, AUDITOR_SPAWN, CHILLERS, COOLERS, COUNTER, FREEZERS, MOVE_BLOCKERS, NAV_X, NAV_Z, OCCLUDERS, SHELVES, STORE,
  storageSlot, storageStand,
} from './layout.ts';

export type AuditorState =
  | 'idle' | 'enter' | 'patrol' | 'alert' | 'investigate' | 'search' | 'count'
  | 'lunge' | 'boxing' | 'carry' | 'store';

/** Các trạng thái của cảnh đóng thùng (không nhìn, không nghe ai khác). */
export const CAPTURE_STATES: readonly AuditorState[] = ['lunge', 'boxing', 'carry', 'store'];

/** Thời gian cảnh nhét vào thùng (giây) và đặt thùng xuống. */
export const BOXING_TIME = 3.0;
export const STORE_TIME = 1.0;
/** Tốc độ lao tới khi đếm xong (m/s): nhanh hơn mọi tốc độ chạy. */
export const LUNGE_SPEED = 6.0;

export type AuditorEvent =
  | { type: 'heard'; at: V2 }
  | { type: 'light'; at: V2 }
  | { type: 'count'; n: number }
  /** Đếm đủ: bắt đầu lao tới chỗ người chơi. */
  | { type: 'caught'; at: V2 }
  /** Tới nơi, bắt đầu nhét vào thùng. */
  | { type: 'boxing'; at: V2 }
  /** Đóng thùng xong, bê đi. */
  | { type: 'boxed'; at: V2 }
  /** Đã đặt thùng vào kho. */
  | { type: 'stored'; at: V2 }
  | { type: 'lost' }
  | { type: 'step' }
  | { type: 'beep' };

/** Đang trong cảnh đóng thùng: chỗ bắt, chỗ đứng đặt thùng, ô thùng trong kho. */
export interface Capture {
  at: V2;
  stand: V2;
  slot: V2;
}

export interface AuditorTuning {
  speed: number;
  investigateSpeed: number;
  /** Tốc độ chạy khi mất điện (người chơi chạy 3,8; ôm thùng chạy 2,7). Đêm 1: 3,4. */
  runSpeed: number;
  range: number;
  halfAngle: number;
  hearMul: number;
  countTime: number;
  /** Khi mất điện: thấy ánh đèn pin trong khoảng cách này (m). */
  lightSight: number;
}

export function tuningForNight(n: number): AuditorTuning {
  return {
    speed: 1.0 + 0.08 * (n - 1),
    investigateSpeed: 1.6 + 0.08 * (n - 1),
    runSpeed: 3.4 + 0.08 * (n - 1), // đêm 5: 3,72 m/s, vẫn chậm hơn người chơi chạy (3,8) một chút
    range: 9 + 0.4 * (n - 1),
    halfAngle: 0.2,
    hearMul: 1 + 0.1 * (n - 1),
    countTime: 2.0,
    lightSight: 16,
  };
}

export function hasLOS(a: V2, b: V2): boolean {
  for (const o of OCCLUDERS) if (segIntersectsAABB(a, b, o)) return false;
  return true;
}

const MOVE_INFLATED: AABB[] = MOVE_BLOCKERS.map((b) => inflate(b, 0.32));
/** Tia quét đi được bao xa theo góc này trước khi bị kệ / tường chặn. */
export function beamReach(from: V2, angle: number, range: number): number {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  let best = range;
  for (const b of OCCLUDERS) best = Math.min(best, rayAABB(from, dx, dz, b));
  return Math.max(0.15, best);
}

export function pathClear(a: V2, b: V2): boolean {
  for (const o of MOVE_INFLATED) if (segIntersectsAABB(a, b, o)) return false;
  return true;
}

// ---- Lưới đường đi ----
interface NavNode { p: V2; n: number[] }
const NODES: NavNode[] = [];
{
  // Mỗi giao điểm (làn dọc × làn ngang) là một nút, trừ chỗ nằm trong vật cản.
  // Hai nút kề nhau (ngang hoặc dọc) được nối nếu đi thẳng giữa chúng không vướng gì.
  const grid = new Map<string, number>();
  NAV_X.forEach((x, i) =>
    NAV_Z.forEach((z, j) => {
      const p = { x, z };
      if (MOVE_INFLATED.some((b) => inBox(p, b))) return;
      grid.set(`${i},${j}`, NODES.length);
      NODES.push({ p, n: [] });
    }),
  );
  const link = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined || !pathClear(NODES[a].p, NODES[b].p)) return;
    NODES[a].n.push(b);
    NODES[b].n.push(a);
  };
  for (let i = 0; i < NAV_X.length; i++) {
    for (let j = 0; j < NAV_Z.length; j++) {
      link(grid.get(`${i},${j}`), grid.get(`${i + 1},${j}`));
      link(grid.get(`${i},${j}`), grid.get(`${i},${j + 1}`));
    }
  }
}

function nearestNode(p: V2): number {
  let best = -1;
  let bd = Infinity;
  NODES.forEach((node, i) => {
    const d = dist(p, node.p);
    if (d < bd && pathClear(p, node.p)) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0) return best;
  NODES.forEach((node, i) => {
    const d = dist(p, node.p);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function bfs(a: number, b: number): number[] {
  if (a === b) return [a];
  const prev = new Map<number, number>([[a, -1]]);
  const q = [a];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === b) break;
    for (const nb of NODES[cur].n) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        q.push(nb);
      }
    }
  }
  if (!prev.has(b)) return [a];
  const path: number[] = [];
  for (let c = b; c !== -1; c = prev.get(c)!) path.unshift(c);
  return path;
}

export function planPath(from: V2, to: V2): V2[] {
  if (pathClear(from, to)) return [{ ...to }];
  const ids = bfs(nearestNode(from), nearestNode(to));
  const pts = ids.map((i) => ({ ...NODES[i].p }));
  const last = pts.length ? pts[pts.length - 1] : from;
  if (pathClear(last, to)) pts.push({ ...to });
  return pts;
}

/** Lộ trình tuần tra: đi zig-zag qua từng làn. */
export const ROUTE: V2[] = (() => {
  const xs = [NAV_X[0], NAV_X[NAV_X.length - 1]];
  const r: V2[] = [];
  NAV_Z.forEach((z, j) => (j % 2 === 0 ? xs : [xs[1], xs[0]]).forEach((x) => r.push({ x, z })));
  return r;
})();

/** Đưa điểm nghi ngờ về chỗ Người Kiểm Kê đi tới được (trong khu bán hàng, ngoài kệ). */
function walkablePoint(p: V2): V2 {
  const s = { x: clamp(p.x, COOLERS.maxX + 0.8, CHILLERS.minX - 0.6), z: clamp(p.z, STORE.backZ + 1.0, STORE.d - 0.8) };
  for (const sh of SHELVES) {
    if (inBox(s, inflate(sh.box, 0.35))) s.z = s.z < sh.zc ? sh.box.minZ - 0.6 : sh.box.maxZ + 0.6;
  }
  if (inBox(s, inflate(COUNTER, 0.4))) s.x = COUNTER.minX - 0.6;
  for (const f of FREEZERS) {
    if (inBox(s, inflate(f, 0.4))) s.z = s.z < (f.minZ + f.maxZ) / 2 ? f.minZ - 0.6 : f.maxZ + 0.6;
  }
  return s;
}

export class Auditor {
  pos: V2;
  heading = Math.PI; // nhìn về phía bắc lúc còn trong kho
  beam = Math.PI;
  state: AuditorState = 'idle';
  tune: AuditorTuning;
  suspicion: V2 | null = null;
  lastSeen: V2 | null = null;
  moving = false;
  /** Đang mất điện (do Game đặt). */
  blackout = false;
  /** Đang chạy (chỉ xảy ra khi mất điện). */
  running = false;
  events: AuditorEvent[] = [];
  /** Đang trong cảnh đóng thùng (null nếu không). */
  capture: Capture | null = null;
  /** Ô trong kho cho thùng kế tiếp (Game giữ số thùng đã lưu kho). */
  storeIndex = 1;
  /** Độ lệch sổ 0..1 (Game đặt): càng lệch càng nghe xa, quét xa, đi tuần nhanh. */
  drift = 0;
  private urgent = false;
  private lightCd = 0;

  private rng: () => number;
  private path: V2[] = [];
  private countT = 0;
  private lostT = 0;
  private counted = 0;
  private stateT = 0;
  private t = 0;
  private stepT = 0;
  private beepT = 0;
  private routeIdx = 0;
  private routeDir = 1;
  private pauseT = 0;

  constructor(tune: AuditorTuning, rng: () => number) {
    this.tune = tune;
    this.rng = rng;
    this.pos = { ...AUDITOR_SPAWN };
  }

  get countProgress(): number {
    return this.state === 'count' ? this.countT / this.tune.countTime : 0;
  }

  /** Đã ở trạng thái hiện tại bao lâu (giây). Dùng để diễn cảnh đóng thùng. */
  get stateTime(): number {
    return this.stateT;
  }

  /** Tầm tia quét thực tế (dài thêm khi sổ lệch). */
  get range(): number {
    return this.tune.range + 2.5 * this.drift;
  }

  get capturing(): boolean {
    return CAPTURE_STATES.includes(this.state);
  }

  /** Đang chú ý cao độ (thấy người, nghe tiếng, đang lao tới): đèn máy quét chuyển đỏ. */
  get alarmed(): boolean {
    return this.state === 'alert' || this.state === 'investigate' || this.state === 'count' || this.state === 'lunge';
  }

  activate(): void {
    if (this.state !== 'idle') return;
    this.state = 'enter';
    this.heading = 0;
    this.path = [{ ...AUDITOR_DOOR }];
  }

  /** Thả người đang bị đếm (dùng khi bật "không chết" để thử): đứng tìm quanh đó. */
  release(): void {
    if (this.state !== 'count' && this.state !== 'lunge') return;
    this.countT = 0;
    this.counted = 0;
    this.capture = null;
    this.state = 'search';
    this.stateT = 0;
    this.path = [];
  }

  /** Cho về kho nghỉ (biến mất khỏi khu bán hàng) cho đến khi activate() lần nữa. */
  retire(): void {
    // Đang bê thùng thì coi như đã cất xong ngay
    if (this.capture && (this.state === 'boxing' || this.state === 'carry' || this.state === 'store')) {
      this.events.push({ type: 'stored', at: { ...this.capture.slot } });
    }
    this.capture = null;
    this.state = 'idle';
    this.pos = { ...AUDITOR_SPAWN };
    this.heading = Math.PI;
    this.beam = Math.PI;
    this.path = [];
    this.suspicion = null;
    this.urgent = false;
    this.countT = 0;
  }

  canSee(p: V2): boolean {
    const d = dist(this.pos, p);
    if (d < 0.9) return true;
    if (d > this.range) return false;
    const half = this.tune.halfAngle + Math.min(0.5, 0.35 / d);
    if (Math.abs(wrapAngle(headingTo(this.pos, p) - this.beam)) > half) return false;
    return hasLOS(this.pos, p);
  }

  /** Nghe một tiếng động. Trả về điểm nghi ngờ (có sai số) nếu nghe thấy. */
  hear(src: V2, radius: number, error: number): V2 | null {
    if (this.state === 'idle' || this.state === 'count' || this.capturing) return null;
    const eff = radius * this.tune.hearMul * (1 + 0.5 * this.drift) * (hasLOS(this.pos, src) ? 1 : 0.7);
    if (dist(this.pos, src) > eff) return null;
    const ang = this.rng() * Math.PI * 2;
    const mag = error * (0.4 + 0.6 * this.rng());
    const s = walkablePoint({ x: src.x + Math.sin(ang) * mag, z: src.z + Math.cos(ang) * mag });
    this.suspicion = s;
    this.state = 'alert';
    this.stateT = 0;
    this.path = [];
    this.urgent = this.blackout;
    this.events.push({ type: 'heard', at: { ...s } });
    return s;
  }

  /** Khi mất điện, ánh đèn pin trong tầm mắt (rộng hơn tia quét) làm nó chú ý. */
  seesLight(p: V2): boolean {
    if (dist(this.pos, p) > this.tune.lightSight) return false;
    if (Math.abs(wrapAngle(headingTo(this.pos, p) - this.heading)) > 1.15) return false;
    return hasLOS(this.pos, p);
  }

  update(dt: number, player: V2, alive: boolean, lightOn = false): void {
    this.t += dt;
    this.stateT += dt;
    this.moving = false;
    this.running = false;
    this.lightCd = Math.max(0, this.lightCd - dt);
    if (this.state === 'idle') return;
    if (this.capturing) {
      this.updateCapture(dt);
      this.footsteps(dt);
      return;
    }

    // --- Phát hiện bằng tia quét ---
    if (alive && this.canSee(player)) {
      if (this.state !== 'count') {
        this.state = 'count';
        this.countT = 0;
        this.counted = 0;
        this.path = [];
      }
      this.lostT = 0;
      this.lastSeen = { ...player };
      this.countT += dt;
      const n = this.countT >= this.tune.countTime / 2 ? 2 : 1;
      if (n > this.counted) {
        this.counted = n;
        this.events.push({ type: 'count', n });
      }
      const h = headingTo(this.pos, player);
      this.beam = h;
      this.heading = turnToward(this.heading, h, 4 * dt);
      if (this.countT >= this.tune.countTime) this.startCapture(player);
      return;
    }
    if (this.state === 'count') {
      this.lostT += dt;
      if (this.lastSeen) this.beam = turnToward(this.beam, headingTo(this.pos, this.lastSeen), 3 * dt);
      if (this.lostT > 0.7) {
        this.countT = 0;
        this.events.push({ type: 'lost' });
        this.goInvestigate(this.lastSeen ?? this.pos);
      }
      return;
    }

    // --- Mất điện: thấy ánh đèn pin thì chạy tới chỗ đó ---
    if (this.blackout && alive && lightOn && this.lightCd <= 0 && this.state !== 'alert' && this.seesLight(player)) {
      this.lightCd = 2;
      const ang = this.rng() * Math.PI * 2;
      const s = walkablePoint({ x: player.x + Math.sin(ang), z: player.z + Math.cos(ang) });
      this.suspicion = s;
      this.urgent = true;
      if (this.state === 'investigate') {
        this.path = planPath(this.pos, s);
      } else {
        this.state = 'alert';
        this.stateT = 0;
        this.path = [];
        this.events.push({ type: 'light', at: { ...s } });
      }
    }

    switch (this.state) {
      case 'enter':
        if (this.follow(dt, this.tune.speed)) this.startPatrol();
        this.sweep(0.38, 1.7);
        break;
      case 'patrol':
        if (this.pauseT > 0) {
          this.pauseT -= dt;
          this.heading = wrapAngle(this.heading + dt * 0.6);
          this.sweep(0.7, 1.1);
          break;
        }
        if (this.follow(dt, this.tune.speed * (1 + 0.3 * this.drift))) this.advanceRoute();
        this.sweep(0.38, 1.7);
        break;
      case 'alert':
        if (this.suspicion) {
          const h = headingTo(this.pos, this.suspicion);
          this.heading = turnToward(this.heading, h, 3 * dt);
          this.beam = turnToward(this.beam, h, 4 * dt);
        }
        if (this.stateT > (this.urgent ? 0.35 : 0.8)) this.goInvestigate(this.suspicion ?? this.pos);
        break;
      case 'investigate':
        if (this.follow(dt, this.urgent ? this.tune.runSpeed : this.tune.investigateSpeed)) {
          this.urgent = false;
          this.state = 'search';
          this.stateT = 0;
        }
        this.sweep(0.3, 2.2);
        break;
      case 'search':
        this.heading = wrapAngle(this.heading + dt * 0.9);
        this.sweep(0.6, 1.4);
        if (this.stateT > 4.5) this.startPatrol();
        break;
    }

    this.running = this.moving && this.urgent && this.state === 'investigate';
    this.footsteps(dt);
  }

  private footsteps(dt: number): void {
    if (this.moving) {
      this.stepT += dt;
      if (this.stepT > (this.running ? 0.3 : 0.62)) {
        this.stepT = 0;
        this.events.push({ type: 'step' });
      }
    }
    this.beepT += dt;
    if (this.beepT > 1.5 && this.state !== 'boxing' && this.state !== 'store') {
      this.beepT = 0;
      this.events.push({ type: 'beep' });
    }
  }

  // ---- Cảnh đóng thùng ----

  private setState(s: AuditorState): void {
    this.state = s;
    this.stateT = 0;
  }

  private startCapture(player: V2): void {
    const at = { ...player };
    this.capture = { at, stand: storageStand(this.storeIndex), slot: storageSlot(this.storeIndex) };
    this.countT = 0;
    this.counted = 0;
    // Dừng cách người chơi 0,75 m
    const d = dist(this.pos, at);
    const stop = d > 0.8 ? { x: at.x + ((this.pos.x - at.x) / d) * 0.75, z: at.z + ((this.pos.z - at.z) / d) * 0.75 } : { ...this.pos };
    this.path = pathClear(this.pos, stop) ? [stop] : planPath(this.pos, stop);
    this.setState('lunge');
    this.events.push({ type: 'caught', at: { ...at } });
  }

  private updateCapture(dt: number): void {
    const c = this.capture!;
    switch (this.state) {
      case 'lunge': {
        this.urgent = true;
        const arrived = this.follow(dt, LUNGE_SPEED);
        this.running = true;
        this.beam = turnToward(this.beam, headingTo(this.pos, c.at), 8 * dt);
        if (arrived || this.stateT > 6) {
          this.urgent = false;
          this.setState('boxing');
          this.events.push({ type: 'boxing', at: { ...c.at } });
        }
        break;
      }
      case 'boxing': {
        const h = headingTo(this.pos, c.at);
        this.heading = turnToward(this.heading, h, 6 * dt);
        this.beam = turnToward(this.beam, h, 6 * dt);
        if (this.stateT >= BOXING_TIME) {
          // Bê thùng về kho: ra lối giữa, qua cửa kho rồi tới chỗ đặt
          this.path = [...planPath(this.pos, AUDITOR_DOOR), { x: AUDITOR_DOOR.x, z: 5.0 }, { ...c.stand }];
          this.setState('carry');
          this.events.push({ type: 'boxed', at: { ...c.at } });
        }
        break;
      }
      case 'carry':
        if (this.follow(dt, this.tune.investigateSpeed)) this.setState('store');
        this.beam = this.heading;
        break;
      case 'store': {
        const h = headingTo(this.pos, c.slot);
        this.heading = turnToward(this.heading, h, 5 * dt);
        this.beam = this.heading;
        if (this.stateT >= STORE_TIME) {
          this.events.push({ type: 'stored', at: { ...c.slot } });
          this.capture = null;
          this.startPatrol();
        }
        break;
      }
    }
  }

  private sweep(amp: number, freq: number): void {
    this.beam = wrapAngle(this.heading + Math.sin(this.t * freq) * amp);
  }

  /** Đi theo đường. Trả về true khi đã tới nơi. */
  private follow(dt: number, speed: number): boolean {
    if (!this.path.length) return true;
    const tgt = this.path[0];
    const d = dist(this.pos, tgt);
    const h = headingTo(this.pos, tgt);
    this.heading = turnToward(this.heading, h, (this.running || this.urgent ? 7 : 3.5) * dt);
    const align = Math.cos(wrapAngle(h - this.heading));
    const step = speed * dt * Math.max(0.15, align);
    if (d <= step) {
      this.pos = { ...tgt };
      this.path.shift();
    } else {
      this.pos.x += Math.sin(h) * step;
      this.pos.z += Math.cos(h) * step;
    }
    this.moving = true;
    return this.path.length === 0;
  }

  private startPatrol(): void {
    let best = 0;
    let bd = Infinity;
    ROUTE.forEach((p, i) => {
      const d = dist(this.pos, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.routeIdx = best;
    this.path = planPath(this.pos, ROUTE[best]);
    this.urgent = false;
    this.state = 'patrol';
    this.stateT = 0;
  }

  private advanceRoute(): void {
    if (this.rng() < 0.3) this.pauseT = 1.5 + this.rng() * 1.5;
    if (this.rng() < 0.2) {
      this.routeIdx = Math.floor(this.rng() * ROUTE.length);
    } else {
      let next = this.routeIdx + this.routeDir;
      if (next < 0 || next >= ROUTE.length) {
        this.routeDir *= -1;
        next = this.routeIdx + this.routeDir;
      }
      this.routeIdx = next;
    }
    this.path = planPath(this.pos, ROUTE[this.routeIdx]);
  }

  private goInvestigate(target: V2): void {
    this.suspicion = { ...target };
    this.path = planPath(this.pos, target);
    this.state = 'investigate';
    this.stateT = 0;
  }
}
