// Bố cục siêu thị (đơn vị: mét). Nhìn từ trên xuống:
//
//   z=0  ┌──────────┬────┬────┬──────┐
//        │   KHO    │LẠNH│ĐIỆN│ NGHỈ │   khu sau: z 0..6
//   z=6  ├──── ─────┴─ ──┴─ ──┴── ───┤   (có cửa trên vách z=6)
//        │▌ ═══════ DÃY 1 ════       │
//        │▌ ═══════ DÃY 2 ════       │   khu bán hàng: z 6..24
//        │▌ ═══════ DÃY 3 ════       │   ▌ = tủ mát (tường tây)
//        │▌ ═══════ DÃY 4 ════  [Q]  │   [Q] = quầy
//   z=24 └──────── MẶT KÍNH ─────────┘
//        x=0                       x=24

import type { AABB, V2 } from './geometry.ts';

export const STORE = { w: 24, d: 24, wallH: 3.2, backZ: 6 };

const T = 0.2;
const wallX = (x: number, z0: number, z1: number): AABB => ({ minX: x - T / 2, maxX: x + T / 2, minZ: z0, maxZ: z1 });
const wallZ = (z: number, x0: number, x1: number): AABB => ({ minX: x0, maxX: x1, minZ: z - T / 2, maxZ: z + T / 2 });

export const WALLS: AABB[] = [
  wallX(0, 0, 24),
  wallX(24, 0, 24),
  wallZ(0, 0, 24),
  // Vách ngăn khu sau, chừa cửa: kho 6–8, kho lạnh 11.2–12.8, phòng điện 15.2–16.8, phòng nghỉ 20–21.6
  wallZ(6, 0, 6),
  wallZ(6, 8, 11.2),
  wallZ(6, 12.8, 15.2),
  wallZ(6, 16.8, 20),
  wallZ(6, 21.6, 24),
  wallX(10, 0, 6),
  wallX(14, 0, 6),
  wallX(18, 0, 6),
];

export const GLASS: AABB = wallZ(24, 0, 24);

export const SHELF_X0 = 4;
export const SHELF_X1 = 17;
export const SHELF_MID = (SHELF_X0 + SHELF_X1) / 2;
export const SHELF_DEPTH = 1.0;
export const SHELF_HEIGHT = 2.4; // cao hơn mắt (1,6) và đầu kiểm kê viên (2,05): che hẳn tia quét

export interface ShelfRow { id: number; zc: number; box: AABB }
export const SHELVES: ShelfRow[] = [9.5, 12.75, 16, 19.25].map((zc, i) => ({
  id: i + 1,
  zc,
  box: { minX: SHELF_X0, maxX: SHELF_X1, minZ: zc - SHELF_DEPTH / 2, maxZ: zc + SHELF_DEPTH / 2 },
}));

export const COUNTER: AABB = { minX: 20.5, maxX: 23.5, minZ: 20.8, maxZ: 22.2 };
export const COOLERS: AABB = { minX: 0.1, maxX: 1.0, minZ: 7, maxZ: 22 };
export const BOX_PILE: AABB = { minX: 1.0, maxX: 3.0, minZ: 1.0, maxZ: 3.0 };
export const FREEZER_PANEL: V2 = { x: 12, z: 0.25 };

/** Vật cản di chuyển của người chơi. */
export const SOLIDS: AABB[] = [...WALLS, GLASS, ...SHELVES.map((s) => s.box), COUNTER, COOLERS, BOX_PILE];
/** Vật che tầm nhìn và âm thanh (kệ và tủ mát cao hơn đầu người; quầy thì thấp). */
export const OCCLUDERS: AABB[] = [...WALLS, ...SHELVES.map((s) => s.box), COOLERS];
/** Vật cản đường đi của Người Kiểm Kê. */
export const MOVE_BLOCKERS: AABB[] = [...WALLS, GLASS, ...SHELVES.map((s) => s.box), COUNTER, COOLERS];

export interface Room { name: string; box: AABB; door: V2 }
export const ROOMS: Room[] = [
  { name: 'KHO', box: { minX: 0, maxX: 10, minZ: 0, maxZ: 6 }, door: { x: 7, z: 6 } },
  { name: 'KHO LẠNH', box: { minX: 10, maxX: 14, minZ: 0, maxZ: 6 }, door: { x: 12, z: 6 } },
  { name: 'PHÒNG ĐIỆN', box: { minX: 14, maxX: 18, minZ: 0, maxZ: 6 }, door: { x: 16, z: 6 } },
  { name: 'PHÒNG NGHỈ', box: { minX: 18, maxX: 24, minZ: 0, maxZ: 6 }, door: { x: 20.8, z: 6 } },
];

export const COUNTER_ZONE: AABB = { minX: 19.2, maxX: 24, minZ: 19.8, maxZ: 24 };
export const PLAYER_SPAWN: V2 = { x: 21.5, z: 23.2 };
export const AUDITOR_SPAWN: V2 = { x: 7, z: 3.5 };
export const AUDITOR_DOOR: V2 = { x: 7, z: 7.5 };

/** Lưới đường đi: các làn giữa dãy kệ (theo z) và hai làn dọc hai bên (theo x). */
export const NAV_X = [2.5, 6.5, 10.5, 14.5, 19];
export const NAV_Z = [7.5, 11.125, 14.375, 17.625, 21.5];

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
