// Hình học 2D nhìn từ trên xuống. x = đông, z = nam (cùng trục với Three.js).
// Quy ước hướng (heading): vector hướng = (sin h, cos h).

export interface V2 { x: number; z: number }
export interface AABB { minX: number; minZ: number; maxX: number; maxZ: number }

export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const headingTo = (from: V2, to: V2): number => Math.atan2(to.x - from.x, to.z - from.z);

export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(cur + Math.sign(d) * maxStep);
}

export const inBox = (p: V2, b: AABB): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;

export const inflate = (b: AABB, r: number): AABB => ({
  minX: b.minX - r, minZ: b.minZ - r, maxX: b.maxX + r, maxZ: b.maxZ + r,
});

/** Đoạn thẳng a→b có cắt hình hộp không (phương pháp slab). */
/** Khoảng cách từ a theo hướng đơn vị (dx, dz) tới khi chạm hộp; không chạm thì Infinity. */
export function rayAABB(a: V2, dx: number, dz: number, box: AABB): number {
  let tmin = 0;
  let tmax = Infinity;
  for (const [o, d, lo, hi] of [[a.x, dx, box.minX, box.maxX], [a.z, dz, box.minZ, box.maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function segIntersectsAABB(a: V2, b: V2, box: AABB): boolean {
  let tmin = 0;
  let tmax = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < 1e-9) {
    if (a.x < box.minX || a.x > box.maxX) return false;
  } else {
    let t1 = (box.minX - a.x) / dx;
    let t2 = (box.maxX - a.x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (a.z < box.minZ || a.z > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - a.z) / dz;
    let t2 = (box.maxZ - a.z) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Đẩy hình tròn (người chơi) ra khỏi hình hộp. Thay đổi trực tiếp p. */
export function pushOutCircle(p: V2, r: number, b: AABB): void {
  const cx = clamp(p.x, b.minX, b.maxX);
  const cz = clamp(p.z, b.minZ, b.maxZ);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    p.x += dx * k;
    p.z += dz * k;
    return;
  }
  // Tâm nằm trong hộp: đẩy ra theo cạnh gần nhất.
  const left = p.x - b.minX;
  const right = b.maxX - p.x;
  const top = p.z - b.minZ;
  const bottom = b.maxZ - p.z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = b.minX - r;
  else if (m === right) p.x = b.maxX + r;
  else if (m === top) p.z = b.minZ - r;
  else p.z = b.maxZ + r;
}
