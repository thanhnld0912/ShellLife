// Người Kiểm Kê: tuần tra, nhìn bằng tia quét, nghe tiếng động và lần theo điểm nghi ngờ.
// Bình thường chỉ đi bộ. Khi MẤT ĐIỆN: nghe tiếng động hoặc thấy ánh đèn pin rọi tới thì CHẠY tới.
// Bị tia quét giữ đủ countTime giây thì người chơi bị "đóng thùng".

import type { AABB, V2 } from './geometry.ts';
import { clamp, dist, headingTo, inBox, inflate, rayAABB, segIntersectsAABB, turnToward, wrapAngle } from './geometry.ts';
import { AUDITOR_DOOR, AUDITOR_SPAWN, COUNTER, MOVE_BLOCKERS, NAV_X, NAV_Z, OCCLUDERS, SHELVES } from './layout.ts';

export type AuditorState = 'idle' | 'enter' | 'patrol' | 'alert' | 'investigate' | 'search' | 'count' | 'caught';

export type AuditorEvent =
  | { type: 'heard'; at: V2 }
  | { type: 'light'; at: V2 }
  | { type: 'count'; n: number }
  | { type: 'caught' }
  | { type: 'lost' }
  | { type: 'step' }
  | { type: 'beep' };

export interface AuditorTuning {
  speed: number;
  investigateSpeed: number;
  /** Tốc độ chạy khi mất điện (người chơi chạy 3,8; ôm thùng chạy 2,7). Đêm 1: 3,4. */
  runSpeed: number;
  range: number;
  halfAngle: number;
  hearMul: number;
  countTime: number;
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
  const nz = NAV_Z.length;
  const idx = (i: number, j: number) => i * nz + j;
  NAV_X.forEach((x) => NAV_Z.forEach((z) => NODES.push({ p: { x, z }, n: [] })));
  const link = (a: number, b: number) => {
    NODES[a].n.push(b);
    NODES[b].n.push(a);
  };
  for (let i = 0; i < NAV_X.length; i++) {
    for (let j = 0; j < nz; j++) {
      if (i + 1 < NAV_X.length) link(idx(i, j), idx(i + 1, j));
      const side = i === 0 || i === NAV_X.length - 1;
      if (side && j + 1 < nz) link(idx(i, j), idx(i, j + 1));
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
  const s = { x: clamp(p.x, 1.8, 22.4), z: clamp(p.z, 7.0, 23.2) };
  for (const sh of SHELVES) {
    if (inBox(s, inflate(sh.box, 0.35))) s.z = s.z < sh.zc ? sh.box.minZ - 0.6 : sh.box.maxZ + 0.6;
  }
  if (inBox(s, inflate(COUNTER, 0.4))) s.x = COUNTER.minX - 0.6;
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

  activate(): void {
    if (this.state !== 'idle') return;
    this.state = 'enter';
    this.heading = 0;
    this.path = [{ ...AUDITOR_DOOR }];
  }

  canSee(p: V2): boolean {
    const d = dist(this.pos, p);
    if (d < 0.9) return true;
    if (d > this.tune.range) return false;
    const half = this.tune.halfAngle + Math.min(0.5, 0.35 / d);
    if (Math.abs(wrapAngle(headingTo(this.pos, p) - this.beam)) > half) return false;
    return hasLOS(this.pos, p);
  }

  /** Nghe một tiếng động. Trả về điểm nghi ngờ (có sai số) nếu nghe thấy. */
  hear(src: V2, radius: number, error: number): V2 | null {
    if (this.state === 'idle' || this.state === 'count' || this.state === 'caught') return null;
    const eff = radius * this.tune.hearMul * (hasLOS(this.pos, src) ? 1 : 0.7);
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
    if (dist(this.pos, p) > 16) return false;
    if (Math.abs(wrapAngle(headingTo(this.pos, p) - this.heading)) > 1.15) return false;
    return hasLOS(this.pos, p);
  }

  update(dt: number, player: V2, alive: boolean, lightOn = false): void {
    this.t += dt;
    this.stateT += dt;
    this.moving = false;
    this.running = false;
    this.lightCd = Math.max(0, this.lightCd - dt);
    if (this.state === 'idle' || this.state === 'caught') return;

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
      if (this.countT >= this.tune.countTime) {
        this.state = 'caught';
        this.events.push({ type: 'caught' });
      }
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
        if (this.follow(dt, this.tune.speed)) this.advanceRoute();
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
    if (this.moving) {
      this.stepT += dt;
      if (this.stepT > (this.running ? 0.34 : 0.62)) {
        this.stepT = 0;
        this.events.push({ type: 'step' });
      }
    }
    this.beepT += dt;
    if (this.beepT > 1.5) {
      this.beepT = 0;
      this.events.push({ type: 'beep' });
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
