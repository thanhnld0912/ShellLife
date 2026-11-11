// Bố cục siêu thị (đơn vị: mét). Nhìn từ trên xuống:
//
//   z=0  ┌─[C]──────────┬──────┬──────┬───────┬───────┐   [C] = cửa nhân viên + MÁY CHẤM CÔNG (điểm danh 06:00)
//        │     KHO      │ KHO  │PHÒNG │ PHÒNG │ VĂN   │   khu sau: z 0..7
//        │              │ LẠNH │ ĐIỆN │ NGHỈ  │ PHÒNG │
//   z=7  ├──── ────────┴── ───┴── ───┴─── ───┴── ────┤   (có cửa trên vách z=7)
//        │▌                                 ┊          ▐│
//        │▌ ════════ DÃY 1 ════════          ┊  ▭▭▭    ▐│   ▌ tủ mát cửa kính (tường tây)
//        │▌ ════════ DÃY 2 ════════          ┊          ▐│   ▐ ngăn mát mở (tường đông)
//        │▌ ════════ DÃY 3 ════════          ┊ KHU      ▐│   ▭ tủ đông nằm (2 đảo giữa khu lạnh)
//        │▌ ════════ DÃY 4 ════════          ┊ HÀNG ▭▭▭ ▐│
//        │▌ ════════ DÃY 5 ════════          ┊ LẠNH     ▐│
//        │▌ ════════ DÃY 6 ════════          ┊           │
//        │                                         [QUẦY] │
//   z=30 └═══════════ MẶT KÍNH + CỬA SẮT XẾP ═════════════┘
//        x=0                                            x=36

import type { AABB, V2 } from './geometry.ts';

export const STORE = { w: 36, d: 30, wallH: 3.4, backZ: 7 };

const T = 0.2;
const wallX = (x: number, z0: number, z1: number): AABB => ({ minX: x - T / 2, maxX: x + T / 2, minZ: z0, maxZ: z1 });
const wallZ = (z: number, x0: number, x1: number): AABB => ({ minX: x0, maxX: x1, minZ: z - T / 2, maxZ: z + T / 2 });

export interface Room { name: string; box: AABB; door: V2; doorW: number }
export const ROOMS: Room[] = [
  { name: 'KHO', box: { minX: 0, maxX: 14, minZ: 0, maxZ: 7 }, door: { x: 10, z: 7 }, doorW: 2.0 },
  { name: 'KHO LẠNH', box: { minX: 14, maxX: 19, minZ: 0, maxZ: 7 }, door: { x: 16.5, z: 7 }, doorW: 1.6 },
  { name: 'PHÒNG ĐIỆN', box: { minX: 19, maxX: 24, minZ: 0, maxZ: 7 }, door: { x: 21.5, z: 7 }, doorW: 1.6 },
  { name: 'PHÒNG NGHỈ', box: { minX: 24, maxX: 30, minZ: 0, maxZ: 7 }, door: { x: 26.8, z: 7 }, doorW: 1.6 },
  { name: 'VĂN PHÒNG', box: { minX: 30, maxX: 36, minZ: 0, maxZ: 7 }, door: { x: 33, z: 7 }, doorW: 1.6 },
];

export const WALLS: AABB[] = (() => {
  const w: AABB[] = [wallX(0, 0, STORE.d), wallX(STORE.w, 0, STORE.d), wallZ(0, 0, STORE.w)];
  // Vách ngăn khu sau (z = 7), chừa cửa từng phòng
  let x = 0;
  for (const r of ROOMS) {
    w.push(wallZ(STORE.backZ, x, r.door.x - r.doorW / 2));
    x = r.door.x + r.doorW / 2;
  }
  w.push(wallZ(STORE.backZ, x, STORE.w));
  for (const r of ROOMS.slice(1)) w.push(wallX(r.box.minX, 0, STORE.backZ));
  return w;
})();

export const GLASS: AABB = wallZ(STORE.d, 0, STORE.w);

// ---- Dãy kệ: 6 dãy dài 15,6 m (12 module 1,3 m) ----
export const SHELF_X0 = 5;
export const SHELF_X1 = 5 + 12 * 1.3;
export const SHELF_MID = (SHELF_X0 + SHELF_X1) / 2;
export const SHELF_DEPTH = 1.0;
export const SHELF_HEIGHT = 2.4; // cao hơn mắt (1,6) và đầu kiểm kê viên (2,05): che hẳn tia quét

export interface ShelfRow { id: number; zc: number; box: AABB }
export const SHELVES: ShelfRow[] = [10.25, 13.25, 16.25, 19.25, 22.25, 25.25].map((zc, i) => ({
  id: i + 1,
  zc,
  box: { minX: SHELF_X0, maxX: SHELF_X1, minZ: zc - SHELF_DEPTH / 2, maxZ: zc + SHELF_DEPTH / 2 },
}));

// ---- Quầy, tủ lạnh ----
/** Quầy thu ngân sát mặt kính, phía đông: nơi giao đơn gấp. */
export const COUNTER: AABB = { minX: 29.5, maxX: 32.5, minZ: 28.0, maxZ: 29.3 };
/** Tủ mát cửa kính: 18 tủ 1 m dọc tường tây, cửa quay vào trong (+x). */
export const COOLERS: AABB = { minX: 0.1, maxX: 1.0, minZ: 8.5, maxZ: 26.5 };
export const COOLER_COUNT = 18;
/** Ngăn mát mở (kệ lạnh không cửa): 12 cái 1,25 m dọc tường đông, mặt quay vào trong (-x). Cao 2 m: che tầm nhìn. */
export const CHILLERS: AABB = { minX: 35.05, maxX: 35.9, minZ: 9.0, maxZ: 24.0 };
export const CHILLER_COUNT = 12;
/** Tủ đông nằm: 2 đảo giữa khu hàng lạnh, mỗi đảo 3 tủ. Thấp 0,85 m: không che tầm nhìn. */
const FREEZER_X = [28.1, 30.0, 31.9];
const FREEZER_Z = [13.0, 19.0];
export const FREEZERS: AABB[] = FREEZER_Z.flatMap((z) =>
  FREEZER_X.map((x) => ({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.45, maxZ: z + 0.45 })),
);

// ---- Khu sau ----
export const BOX_PILE: AABB = { minX: 6.0, maxX: 8.0, minZ: 1.0, maxZ: 3.0 };
/** Chồng thùng hàng lạnh (thùng xốp) trong kho lạnh, cạnh hai tủ đông dự trữ. */
export const COLD_PILE: AABB = { minX: 15.0, maxX: 16.4, minZ: 1.0, maxZ: 2.4 };
export const FREEZER_PANEL: V2 = { x: 16.5, z: 0.25 };
/** Cửa nhân viên (đã khoá) và máy chấm công trên tường bắc của kho. */
export const STAFF_DOOR: V2 = { x: 1.6, z: 0 };
export const TIME_CLOCK: V2 = { x: 3.5, z: 0.1 };
/** Đứng trong vùng này lúc 06:00 là đã điểm danh (đút thẻ vào máy chấm công). */
export const CLOCK_ZONE: AABB = { minX: 2.2, maxX: 5.2, minZ: 0.1, maxZ: 2.4 };

/** Vật cản di chuyển của người chơi. */
export const SOLIDS: AABB[] = [...WALLS, GLASS, ...SHELVES.map((s) => s.box), COUNTER, COOLERS, CHILLERS, ...FREEZERS, BOX_PILE, COLD_PILE];
/** Vật che tầm nhìn và âm thanh (kệ và tủ lạnh đứng cao hơn đầu người; quầy và tủ đông nằm thì thấp). */
export const OCCLUDERS: AABB[] = [...WALLS, ...SHELVES.map((s) => s.box), COOLERS, CHILLERS];
/** Vật cản đường đi của Người Kiểm Kê. */
export const MOVE_BLOCKERS: AABB[] = [...WALLS, GLASS, ...SHELVES.map((s) => s.box), COUNTER, COOLERS, CHILLERS, ...FREEZERS];

export const PLAYER_SPAWN: V2 = { x: 27.5, z: 28.8 };
export const AUDITOR_SPAWN: V2 = { x: 10, z: 3.8 };
export const AUDITOR_DOOR: V2 = { x: 10, z: 8.6 };

/** Thùng "ĐÃ LƯU KHO" thứ i xếp thành hàng dọc trong kho (i = 0 là thùng của Tuấn, có sẵn). */
export function storageSlot(i: number): V2 {
  return { x: 12.9, z: 1.0 + i * 0.85 };
}
/** Chỗ Người Kiểm Kê đứng để đặt thùng xuống ô i (bên trái thùng, quay về phía +x). */
export function storageStand(i: number): V2 {
  const s = storageSlot(i);
  return { x: s.x - 0.95, z: s.z };
}

/**
 * Lưới đường đi: các làn ngang (theo z) giữa các dãy kệ, cắt các làn dọc (theo x).
 * Nút nằm trong vật cản bị bỏ; hai nút kề nhau được nối nếu đi thẳng được (xem auditor.ts).
 */
export const NAV_X = [3.0, 8.0, 12.8, 17.6, 22.6, 25.6, 30.0, 34.2];
export const NAV_Z = [8.6, 11.75, 14.75, 17.75, 20.75, 23.75, 27.0];

// ---- Các đoạn kệ (đơn vị để quét và xếp hàng) ----
export type Face = 'B' | 'N';
export type Half = '1' | '2';
export interface Section {
  id: string;
  row: number;
  face: Face;
  half: Half;
  name: string;
  x0: number;
  x1: number;
  /** z của mặt kệ phía người chơi đứng */
  zFace: number;
  /** hướng ra ngoài mặt kệ: -1 = bắc, +1 = nam */
  out: number;
}

export const SECTIONS: Section[] = [];
for (const row of SHELVES) {
  for (const face of ['B', 'N'] as Face[]) {
    for (const half of ['1', '2'] as Half[]) {
      SECTIONS.push({
        id: `${row.id}${face}${half}`,
        row: row.id,
        face,
        half,
        name: `Dãy ${row.id} · mặt ${face === 'B' ? 'bắc' : 'nam'} · đoạn ${half}`,
        x0: half === '1' ? SHELF_X0 : SHELF_MID,
        x1: half === '1' ? SHELF_MID : SHELF_X1,
        zFace: face === 'B' ? row.box.minZ : row.box.maxZ,
        out: face === 'B' ? -1 : 1,
      });
    }
  }
}

export function sectionAt(row: number, x: number, z: number): Section {
  const shelf = SHELVES[row - 1];
  const face: Face = z < shelf.zc ? 'B' : 'N';
  const half: Half = x < SHELF_MID ? '1' : '2';
  return SECTIONS.find((s) => s.row === row && s.face === face && s.half === half)!;
}

export function sectionById(id: string): Section | undefined {
  return SECTIONS.find((s) => s.id === id);
}

// ---- Tủ lạnh bán hàng (đơn vị để xếp hàng lạnh) ----
export type ColdKind = 'tu_mat' | 'ke_mat' | 'tu_dong';
export interface ColdUnit {
  /** TM1… tủ mát cửa kính · KM1… ngăn mát mở · TD1… tủ đông nằm */
  id: string;
  kind: ColdKind;
  name: string;
  x: number;
  z: number;
  /** Góc quay model quanh trục đứng (mặt trước model là +z). */
  rot: number;
  /** Chỗ đứng trước mặt tủ (để xếp hàng, treo thẻ). */
  front: V2;
}

export const COLD_UNITS: ColdUnit[] = (() => {
  const u: ColdUnit[] = [];
  const at = (x: number, z: number, rot: number, d: number): V2 => ({ x: x + Math.sin(rot) * d, z: z + Math.cos(rot) * d });
  for (let i = 0; i < COOLER_COUNT; i++) {
    const x = COOLERS.minX + 0.42;
    const z = COOLERS.minZ + 0.5 + i;
    u.push({ id: `TM${i + 1}`, kind: 'tu_mat', name: `Tủ mát số ${i + 1}`, x, z, rot: Math.PI / 2, front: at(x, z, Math.PI / 2, 1.0) });
  }
  const kmW = (CHILLERS.maxZ - CHILLERS.minZ) / CHILLER_COUNT;
  for (let i = 0; i < CHILLER_COUNT; i++) {
    const x = CHILLERS.maxX - 0.425;
    const z = CHILLERS.minZ + kmW * (i + 0.5);
    u.push({ id: `KM${i + 1}`, kind: 'ke_mat', name: `Ngăn mát số ${i + 1}`, x, z, rot: -Math.PI / 2, front: at(x, z, -Math.PI / 2, 1.0) });
  }
  FREEZERS.forEach((f, i) => {
    const x = (f.minX + f.maxX) / 2;
    const z = (f.minZ + f.maxZ) / 2;
    const rot = z < 16 ? Math.PI : 0; // đảo bắc quay mặt về bắc, đảo nam quay về nam
    u.push({ id: `TD${i + 1}`, kind: 'tu_dong', name: `Tủ đông số ${i + 1}`, x, z, rot, front: at(x, z, rot, 0.95) });
  });
  return u;
})();

export function coldUnitById(id: string): ColdUnit | undefined {
  return COLD_UNITS.find((c) => c.id === id);
}
