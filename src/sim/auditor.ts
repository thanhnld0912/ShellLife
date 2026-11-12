// Người Kiểm Kê: tuần tra, nhìn bằng tia quét, nghe tiếng động và lần theo điểm nghi ngờ.
// Bình thường chỉ đi bộ. Khi MẤT ĐIỆN: nghe tiếng động hoặc thấy ánh đèn pin rọi tới thì CHẠY tới.
// Bị tia quét giữ đủ countTime giây thì người chơi bị "đóng thùng":
//   lunge (lao tới) → boxing (nhét vào thùng, dán băng keo) → carry (bê thùng về kho)
//   → store (đặt thùng vào hàng "ĐÃ LƯU KHO") → đi tuần tiếp như bình thường.

import type { AABB, V2 } from './geometry.ts';
import { clamp, dist, headingTo, inBox, inflate, rayAABB, segIntersectsAABB, turnToward, wrapAngle } from './geometry.ts';
import {
  AUDITOR_DOOR, AUDITOR_SPAWN, LANES, MOVE_BLOCKERS, OCCLUDERS, ROOMS, STORE, inSafeRoom, roomAt, storageSlot, storageStand,
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
  /** who: chỉ số người đang bị đếm (trong danh sách mục tiêu truyền vào update). */
  | { type: 'count'; n: number; who: number }
  /** Đếm đủ: bắt đầu lao tới chỗ người chơi thứ who. */
  | { type: 'caught'; at: V2; who: number }
  /** Tới nơi, bắt đầu nhét vào thùng. */
  | { type: 'boxing'; at: V2 }
  /** Đóng thùng xong, bê đi. */
  | { type: 'boxed'; at: V2 }
  /** Đã đặt thùng vào kho. */
  | { type: 'stored'; at: V2 }
  | { type: 'lost'; who: number }
  | { type: 'step' }
  | { type: 'beep' };

/** Một người chơi mà Người Kiểm Kê có thể thấy / bắt (chơi nhiều người: mỗi người một mục tiêu). */
export interface AuditTarget {
  pos: V2;
  alive: boolean;
  /** Đang bật đèn pin (khi mất điện, nó thấy ánh đèn). */
  light?: boolean;
}

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

// ---- Lưới đường đi (tự sinh từ bố cục) ----
// Lưới điểm cách nhau 1 m phủ cả siêu thị, bỏ điểm nằm trong vật cản; thêm điểm ngay tại từng ô cửa.
// Hai điểm gần nhau được nối nếu đi thẳng giữa chúng không vướng gì. Nhờ vậy vào / ra phòng luôn đi qua cửa.
interface NavNode { p: V2; n: number[] }
const NODES: NavNode[] = [];
const NAV_STEP = 1.0;
{
  const free = (p: V2) => !MOVE_INFLATED.some((b) => inBox(p, b));
  for (let x = 0.5; x < STORE.w; x += NAV_STEP) {
    for (let z = 0.5; z < STORE.d; z += NAV_STEP) {
      const p = { x, z };
      if (free(p)) NODES.push({ p, n: [] });
    }
  }
  for (const r of ROOMS) {
    for (const z of [STORE.backZ - 0.9, STORE.backZ, STORE.backZ + 0.9]) {
      const p = { x: r.door.x, z };
      if (free(p)) NODES.push({ p, n: [] });
    }
  }
  // Nối các điểm gần nhau (lưới ô 2 m để khỏi so từng cặp)
  const cell = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
  NODES.forEach((nd, i) => {
    const k = key(nd.p.x, nd.p.z);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k)!.push(i);
  });
  NODES.forEach((a, i) => {
    const cx = Math.floor(a.p.x / 2);
    const cz = Math.floor(a.p.z / 2);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j <= i) continue;
          if (dist(a.p, NODES[j].p) > 1.5 || !pathClear(a.p, NODES[j].p)) continue;
          a.n.push(j);
          NODES[j].n.push(i);
        }
      }
    }
  });
}

/** Số điểm và số vùng liền nhau của lưới (để kiểm tra: phải là 1 vùng). */
export function navStats(): { nodes: number; components: number } {
  const seen = new Int32Array(NODES.length).fill(-1);
  let comp = 0;
  for (let s = 0; s < NODES.length; s++) {
    if (seen[s] >= 0) continue;
    const q = [s];
    seen[s] = comp;
    while (q.length) {
      const u = q.pop()!;
      for (const v of NODES[u].n) if (seen[v] < 0) {
        seen[v] = comp;
        q.push(v);
      }
    }
    comp++;
  }
  return { nodes: NODES.length, components: comp };
}

function nearestNode(p: V2): number {
  let best = -1;
  let bd = Infinity;
  // Ưu tiên điểm gần mà đi thẳng tới được
  NODES.forEach((node, i) => {
    const d = dist(p, node.p);
    if (d < bd && d < 4 && pathClear(p, node.p)) {
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

/** Đường ngắn nhất giữa hai điểm của lưới (A*, hàng đợi ưu tiên dạng đống nhị phân). */
function shortest(a: number, b: number): number[] {
  if (a === b) return [a];
  const n = NODES.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goal = NODES[b].p;
  const heap: [number, number][] = []; // [f, nút]
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  g[a] = 0;
  push(dist(NODES[a].p, goal), a);
  while (heap.length) {
    const u = pop();
    if (u === b) break;
    if (closed[u]) continue;
    closed[u] = 1;
    for (const v of NODES[u].n) {
      const nd = g[u] + dist(NODES[u].p, NODES[v].p);
      if (nd < g[v]) {
        g[v] = nd;
        prev[v] = u;
        push(nd + dist(NODES[v].p, goal), v);
      }
    }
  }
  if (g[b] === Infinity) return [a];
  const path: number[] = [];
  for (let c = b; c !== -1; c = prev[c]) path.unshift(c);
  return path;
}

export function planPath(from: V2, to: V2): V2[] {
  if (pathClear(from, to)) return [{ ...to }];
  const pts = shortest(nearestNode(from), nearestNode(to)).map((i) => ({ ...NODES[i].p }));
  const last = pts.length ? pts[pts.length - 1] : from;
  if (pathClear(last, to)) pts.push({ ...to });
  // Cắt góc: từ mỗi điểm đi thẳng tới điểm xa nhất còn đi thẳng được (đi tự nhiên, không zig-zag theo lưới)
  const out: V2[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !pathClear(cur, pts[j])) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}

// ---- Lộ trình tuần tra: mỗi đêm một kiểu ----

/** Một điểm trên lộ trình. peek: tới nơi thì dừng lại ngó theo hướng này (rad), vd. ngó vào cửa phòng. */
export interface Waypoint extends V2 { peek?: number }

export const ROUTE_STYLES = ['zigzag', 'vong_ngoai', 'khu_lanh', 'doc', 'ngau_nhien'] as const;
export type RouteStyle = (typeof ROUTE_STYLES)[number];
export const ROUTE_NAMES: Record<RouteStyle, string> = {
  zigzag: 'Zig-zag qua từng làn kệ',
  vong_ngoai: 'Vòng ngoài, ngó vào cửa các phòng',
  khu_lanh: 'Quanh khu hàng lạnh và quầy',
  doc: 'Đi dọc các làn lớn',
  ngau_nhien: 'Không theo thứ tự',
};

const NORTH = Math.PI; // hướng nhìn về phía bắc (vào các phòng khu sau)
const { W, XC, XE, XK, XK2, NZ, SZ, AW, AM } = LANES;
/** Đứng trước cửa các phòng không phải khu lấy hàng, ngó vào trong. */
const DOOR_PEEKS: Waypoint[] = ROOMS.filter((r) => !r.safe && r.name !== 'PHÒNG KIỂM KÊ').map((r) => ({ x: r.door.x, z: NZ, peek: NORTH }));

/** Dựng lộ trình theo kiểu, có đảo chiều và điểm bắt đầu ngẫu nhiên. */
export function buildRoute(style: RouteStyle, rng: () => number): Waypoint[] {
  let r: Waypoint[] = [];
  const zig = (zs: number[], a: number, b: number) =>
    zs.forEach((z, j) => (j % 2 === 0 ? [a, b] : [b, a]).forEach((x) => r.push({ x, z })));
  switch (style) {
    case 'zigzag':
      zig(AW, W, XC);
      zig([...AM].reverse(), XC, XE);
      r.push({ x: XK, z: 29.0 }, { x: XK2, z: 29.0 }, { x: XK2, z: 16.25 }, { x: XK, z: 22.75 }, { x: XK, z: 10.5 }, { x: XK2, z: 10.5 });
      break;
    case 'vong_ngoai':
      r = [
        { x: W, z: NZ }, ...DOOR_PEEKS.slice().sort((a, b) => a.x - b.x), { x: XK2, z: NZ }, { x: XK2, z: 19.5 }, { x: XK2, z: SZ },
        { x: XE, z: SZ }, { x: XC, z: SZ }, { x: W, z: SZ }, { x: W, z: 19.5 },
      ];
      break;
    case 'khu_lanh':
      r = [
        { x: XE, z: NZ }, { x: XK, z: 12.0 }, { x: XK2, z: 16.25 }, { x: XK, z: 19.5 }, { x: XK2, z: 22.75 }, { x: XK, z: 26.0 },
        { x: XK2, z: SZ }, { x: 36.0, z: SZ }, { x: XE, z: SZ }, { x: XE, z: AM[2] }, { x: XC, z: AM[2] }, { x: XC, z: AW[2] },
        { x: W, z: AW[2] }, { x: XC, z: AW[2] }, { x: XE, z: AM[1] },
      ];
      break;
    case 'doc':
      r = [
        { x: W, z: NZ }, { x: W, z: SZ }, { x: XC, z: SZ }, { x: XC, z: NZ }, { x: XE, z: NZ }, { x: XE, z: SZ },
        { x: XK2, z: SZ }, { x: XK2, z: NZ }, ...DOOR_PEEKS.slice().sort((a, b) => b.x - a.x),
      ];
      break;
    case 'ngau_nhien': {
      const pool: Waypoint[] = [...DOOR_PEEKS];
      for (const x of [W, XC, XE, XK, XK2]) for (const z of [NZ, ...AW, ...AM, SZ]) pool.push({ x, z });
      const walk = pool.filter((p) => !MOVE_INFLATED.some((b) => inBox(p, b)));
      const pick: Waypoint[] = [];
      while (pick.length < 12 && walk.length) pick.push(walk.splice(Math.floor(rng() * walk.length), 1)[0]);
      // Xếp điểm gần nhau đi trước (đỡ đi qua đi lại cả siêu thị), nhưng thứ tự vẫn khác mỗi lần
      r = [pick.shift()!];
      while (pick.length) {
        const last = r[r.length - 1];
        pick.sort((a, b) => dist(last, a) - dist(last, b));
        r.push(pick.shift()!);
      }
      break;
    }
  }
  r = r.filter((p) => !MOVE_INFLATED.some((b) => inBox(p, b)));
  if (rng() < 0.5) r.reverse();
  const k = Math.floor(rng() * r.length);
  return [...r.slice(k), ...r.slice(0, k)];
}

/** Đẩy điểm ra khỏi vật cản (ra mép gần nhất). */
function pushOut(s: V2): V2 {
  for (let pass = 0; pass < 3; pass++) {
    for (const o of MOVE_INFLATED) {
      if (!inBox(s, o)) continue;
      const d = [s.x - o.minX, o.maxX - s.x, s.z - o.minZ, o.maxZ - s.z];
      const m = d.indexOf(Math.min(...d));
      if (m === 0) s.x = o.minX - 0.15;
      else if (m === 1) s.x = o.maxX + 0.15;
      else if (m === 2) s.z = o.minZ - 0.15;
      else s.z = o.maxZ + 0.15;
    }
  }
  return s;
}

/**
 * Đưa điểm nghi ngờ về chỗ Người Kiểm Kê đi tới được.
 * Tiếng động trong một phòng thường: điểm nằm trong phòng đó. Trong khu lấy hàng (kho, kho lạnh): chỉ tới trước cửa ngó vào.
 */
function walkablePoint(p: V2, src: V2 = p): V2 {
  const room = roomAt(src);
  if (room?.safe) return { x: room.door.x, z: STORE.backZ + 1.0 };
  if (room) {
    const b = room.box;
    return pushOut({ x: clamp(p.x, b.minX + 0.7, b.maxX - 0.7), z: clamp(p.z, 0.7, STORE.backZ - 0.7) });
  }
  return pushOut({ x: clamp(p.x, 1.4, STORE.w - 1.4), z: clamp(p.z, STORE.backZ + 0.9, STORE.d - 0.8) });
}

export class Auditor {
  pos: V2;
  heading = 0; // đứng sau bàn văn phòng, nhìn ra cửa (phía nam)
  beam = 0;
  /** Kiểu lộ trình đêm nay (mỗi đêm một kiểu, Game chọn). */
  routeStyle: RouteStyle;
  route: Waypoint[];
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
  /** Đang đếm người chơi thứ mấy (-1: không đếm ai). */
  countWho = -1;
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
  private pauseT = 0;
  /** Đang dừng ngó vào một hướng (vd. cửa kho), null nếu chỉ đứng quay quanh. */
  private peekDir: number | null = null;

  constructor(tune: AuditorTuning, rng: () => number, routeStyle: RouteStyle = 'zigzag') {
    this.tune = tune;
    this.rng = rng;
    this.pos = { ...AUDITOR_SPAWN };
    this.routeStyle = routeStyle;
    this.route = buildRoute(routeStyle, rng);
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
    // Từ sau bàn văn phòng đi ra, qua đúng cửa văn phòng
    this.state = 'enter';
    this.stateT = 0;
    this.path = planPath(this.pos, AUDITOR_DOOR);
  }

  /** Thả người đang bị đếm (dùng khi bật "không chết" để thử): đứng tìm quanh đó. */
  release(): void {
    if (this.state !== 'count' && this.state !== 'lunge') return;
    this.countT = 0;
    this.counted = 0;
    this.countWho = -1;
    this.capture = null;
    this.state = 'search';
    this.stateT = 0;
    this.path = [];
  }

  /** Cho về văn phòng đứng chờ sau bàn cho đến khi activate() lần nữa. */
  retire(): void {
    // Đang bê thùng thì coi như đã cất xong ngay
    if (this.capture && (this.state === 'boxing' || this.state === 'carry' || this.state === 'store')) {
      this.events.push({ type: 'stored', at: { ...this.capture.slot } });
    }
    this.capture = null;
    this.state = 'idle';
    this.pos = { ...AUDITOR_SPAWN };
    this.heading = 0;
    this.beam = 0;
    this.path = [];
    this.suspicion = null;
    this.urgent = false;
    this.countT = 0;
    this.countWho = -1;
  }

  canSee(p: V2): boolean {
    if (inSafeRoom(p)) return false; // kho, kho lạnh: khu lấy hàng, không kiểm đếm
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
    const s = walkablePoint({ x: src.x + Math.sin(ang) * mag, z: src.z + Math.cos(ang) * mag }, src);
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
    if (inSafeRoom(p) || dist(this.pos, p) > this.tune.lightSight) return false;
    if (Math.abs(wrapAngle(headingTo(this.pos, p) - this.heading)) > 1.15) return false;
    return hasLOS(this.pos, p);
  }

  /**
   * targets: các người chơi (chơi một mình: truyền vị trí, còn sống, đèn pin như cũ).
   * Nhiều người: đếm người đang bị đếm nếu còn thấy, không thì người gần nhất trong tia quét.
   */
  update(dt: number, player: V2 | AuditTarget[], alive = true, lightOn = false): void {
    const targets: AuditTarget[] = Array.isArray(player) ? player : [{ pos: player, alive, light: lightOn }];
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
    let who = -1;
    if (this.state === 'count' && this.countWho >= 0) {
      const t = targets[this.countWho];
      if (t && t.alive && this.canSee(t.pos)) who = this.countWho;
    }
    if (who < 0) {
      let bd = Infinity;
      targets.forEach((t, i) => {
        if (!t.alive || !this.canSee(t.pos)) return;
        const d = dist(this.pos, t.pos);
        if (d < bd) {
          bd = d;
          who = i;
        }
      });
    }
    if (who >= 0) {
      const player = targets[who].pos;
      if (this.state !== 'count' || this.countWho !== who) {
        // Đang đếm người khác mà mất dấu người đó: người kia thoát, đếm lại từ đầu cho người mới
        if (this.state === 'count' && this.countWho >= 0) this.events.push({ type: 'lost', who: this.countWho });
        this.state = 'count';
        this.countT = 0;
        this.counted = 0;
        this.countWho = who;
        this.path = [];
      }
      this.lostT = 0;
      this.lastSeen = { ...player };
      this.countT += dt;
      const n = this.countT >= this.tune.countTime / 2 ? 2 : 1;
      if (n > this.counted) {
        this.counted = n;
        this.events.push({ type: 'count', n, who });
      }
      const h = headingTo(this.pos, player);
      this.beam = h;
      this.heading = turnToward(this.heading, h, 4 * dt);
      if (this.countT >= this.tune.countTime) this.startCapture(player, who);
      return;
    }
    if (this.state === 'count') {
      this.lostT += dt;
      if (this.lastSeen) this.beam = turnToward(this.beam, headingTo(this.pos, this.lastSeen), 3 * dt);
      if (this.lostT > 0.7) {
        this.countT = 0;
        this.events.push({ type: 'lost', who: Math.max(0, this.countWho) });
        this.countWho = -1;
        this.goInvestigate(this.lastSeen ?? this.pos);
      }
      return;
    }

    // --- Mất điện: thấy ánh đèn pin thì chạy tới chỗ đó ---
    const lit = this.blackout && this.lightCd <= 0 && this.state !== 'alert' ? targets.find((t) => t.alive && t.light && this.seesLight(t.pos)) : undefined;
    if (lit) {
      const player = lit.pos;
      this.lightCd = 2;
      const ang = this.rng() * Math.PI * 2;
      const s = walkablePoint({ x: player.x + Math.sin(ang), z: player.z + Math.cos(ang) }, player);
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
          if (this.peekDir !== null) this.heading = turnToward(this.heading, this.peekDir, 3 * dt);
          else this.heading = wrapAngle(this.heading + dt * 0.6);
          this.sweep(this.peekDir !== null ? 0.5 : 0.7, 1.1);
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

  private startCapture(player: V2, who = 0): void {
    const at = { ...player };
    this.capture = { at, stand: storageStand(this.storeIndex), slot: storageSlot(this.storeIndex) };
    this.countT = 0;
    this.counted = 0;
    this.countWho = -1;
    // Dừng cách người chơi 0,75 m
    const d = dist(this.pos, at);
    const stop = d > 0.8 ? { x: at.x + ((this.pos.x - at.x) / d) * 0.75, z: at.z + ((this.pos.z - at.z) / d) * 0.75 } : { ...this.pos };
    this.path = pathClear(this.pos, stop) ? [stop] : planPath(this.pos, stop);
    this.setState('lunge');
    this.events.push({ type: 'caught', at: { ...at }, who });
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
          // Vác thùng về kho: lưới đường đi bắt buộc đi qua đúng ô cửa kho
          this.path = planPath(this.pos, c.stand);
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
    this.route.forEach((p, i) => {
      const d = dist(this.pos, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.routeIdx = best;
    this.peekDir = null;
    this.path = planPath(this.pos, this.route[best]);
    this.urgent = false;
    this.state = 'patrol';
    this.stateT = 0;
  }

  /** Tới một điểm trên lộ trình: ngó vào (nếu là điểm ngó), có khi dừng đứng quét, rồi đi điểm kế (lộ trình vòng tròn). */
  private advanceRoute(): void {
    const here = this.route[this.routeIdx];
    this.peekDir = null;
    if (here.peek !== undefined) {
      this.peekDir = here.peek;
      this.pauseT = 2.0 + this.rng() * 1.5;
    } else if (this.rng() < 0.25) {
      this.pauseT = 1.5 + this.rng() * 1.5;
    }
    // Thỉnh thoảng bỏ ngang, nhảy tới một điểm bất kỳ: không học thuộc được lộ trình
    if (this.rng() < 0.15) this.routeIdx = Math.floor(this.rng() * this.route.length);
    else this.routeIdx = (this.routeIdx + 1) % this.route.length;
    this.path = planPath(this.pos, this.route[this.routeIdx]);
  }

  private goInvestigate(target: V2): void {
    this.suspicion = { ...target };
    this.path = planPath(this.pos, target);
    this.state = 'investigate';
    this.stateT = 0;
  }
}
