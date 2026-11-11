// Bố cục siêu thị (đơn vị: mét). Nhìn từ trên xuống, 44 × 34 m:
//
//  z=0 ┌[C]──────────┬─────┬────┬───────┬──────┬───────┐  [C] cửa nhân viên + MÁY CHẤM CÔNG (chấm công vào ca / điểm danh 06:00)
//      │ KHO  (an    │ KHO │PH. │ PHÒNG │ VĂN  │ PHÒNG │  [N] nhân viên bắt đầu ca ở PHÒNG NGHỈ
//      │      toàn)  │LẠNH │ĐIỆN│ NGHỈ N│ PHÒNG│KIỂM KÊ│  [K] Người Kiểm Kê chờ trong phòng riêng
//      │             │(a.t)│    │       │      │   K   │  Kho và kho lạnh: KHU LẤY HÀNG, Người Kiểm Kê không đếm được người ở đây
//  z=7 ├──── ────────┴─ ───┴─ ──┴── ────┴── ───┴── ────┤
//      │▌        ■                ■                     ▐│  ■ pallet hàng cao 1,9 m (che tầm nhìn, chặn lối)
//      │▌ ══════════   ┊ ══════════                     ▐│
//      │▌ ══════════   ┊ ══════════      ┊ ▭▭▭           ▐│  hai khối kệ LỆCH NHAU: làn của khối tây không thẳng
//      │▌ ══════════ ■ ┊ ══════════ ■    ┊          ■    ▐│  hàng làn của khối giữa → không có đường nhìn dài
//      │▌     ■        ┊      ■          ┊ ▭▭▭           ▐│
//      │▌ ══════════   ┊ ══════════      ┊               ▐│  ▌ tủ mát cửa kính · ▐ ngăn mát mở · ▭ tủ đông nằm
//      │▌ ══════════   ┊ ══════════      ┊ ▭▭▭       ■   ▐│
//      │  ══════════   ┊ ══════════                         │
//      │        ■             ■            ■      [QUẦY]    │
// z=34 └═════════════ MẶT KÍNH + CỬA SẮT XẾP ═══════════════┘
//      x=0                                                x=44

import type { AABB, V2 } from './geometry.ts';

export const STORE = { w: 44, d: 34, wallH: 3.4, backZ: 7 };

const T = 0.2;
const wallX = (x: number, z0: number, z1: number): AABB => ({ minX: x - T / 2, maxX: x + T / 2, minZ: z0, maxZ: z1 });
const wallZ = (z: number, x0: number, x1: number): AABB => ({ minX: x0, maxX: x1, minZ: z - T / 2, maxZ: z + T / 2 });
const rect = (cx: number, cz: number, w: number, d: number): AABB => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

export interface Room {
  name: string;
  box: AABB;
  door: V2;
  doorW: number;
  /** Khu lấy hàng: Người Kiểm Kê không nhìn / đếm được người đứng trong phòng này. */
  safe?: boolean;
}
export const ROOMS: Room[] = [
  { name: 'KHO', box: { minX: 0, maxX: 12, minZ: 0, maxZ: 7 }, door: { x: 8.5, z: 7 }, doorW: 2.0, safe: true },
  { name: 'KHO LẠNH', box: { minX: 12, maxX: 17, minZ: 0, maxZ: 7 }, door: { x: 14.5, z: 7 }, doorW: 1.6, safe: true },
  { name: 'PHÒNG ĐIỆN', box: { minX: 17, maxX: 21, minZ: 0, maxZ: 7 }, door: { x: 19, z: 7 }, doorW: 1.6 },
  { name: 'PHÒNG NGHỈ', box: { minX: 21, maxX: 29, minZ: 0, maxZ: 7 }, door: { x: 25, z: 7 }, doorW: 1.6 },
  { name: 'VĂN PHÒNG', box: { minX: 29, maxX: 36, minZ: 0, maxZ: 7 }, door: { x: 32.5, z: 7 }, doorW: 1.6 },
  { name: 'PHÒNG KIỂM KÊ', box: { minX: 36, maxX: 44, minZ: 0, maxZ: 7 }, door: { x: 40, z: 7 }, doorW: 1.4 },
];
export const roomByName = (name: string): Room => ROOMS.find((r) => r.name === name)!;
/** Phòng (khu sau) chứa điểm p, nếu có. */
export function roomAt(p: V2): Room | undefined {
  if (p.z >= STORE.backZ) return undefined;
  return ROOMS.find((r) => p.x >= r.box.minX && p.x <= r.box.maxX && p.z >= r.box.minZ && p.z <= r.box.maxZ);
}
/** Đứng trong khu lấy hàng (kho, kho lạnh): Người Kiểm Kê không bắt được. */
export function inSafeRoom(p: V2): boolean {
  return !!roomAt(p)?.safe;
}

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

// ---- Kệ hàng: hai khối 6 dãy, mỗi dãy 8 module 1,3 m (10,4 m). Hai khối lệch nhau 1,5 m theo z. ----
export const SHELF_MODULE = 1.3;
export const SHELF_DEPTH = 1.0;
export const SHELF_HEIGHT = 2.4; // cao hơn mắt (1,6) và đầu kiểm kê viên (2,15): che hẳn tia quét
const MODULES = 8;
/** Khối tây và khối giữa: x bắt đầu, các tâm dãy theo z (có làn ngang rộng 4 m ở giữa mỗi khối). */
const BLOCKS: { x0: number; zs: number[] }[] = [
  { x0: 3.5, zs: [11.0, 14.0, 17.0, 22.0, 25.0, 28.0] },
  { x0: 16.6, zs: [12.5, 15.5, 18.5, 23.5, 26.5, 29.5] },
];

export interface ShelfRow { id: number; zc: number; x0: number; x1: number; mid: number; box: AABB }
export const SHELVES: ShelfRow[] = BLOCKS.flatMap((b) => b.zs.map((zc) => ({ zc, x0: b.x0 }))).map(({ zc, x0 }, i) => {
  const x1 = x0 + MODULES * SHELF_MODULE;
  return { id: i + 1, zc, x0, x1, mid: (x0 + x1) / 2, box: { minX: x0, maxX: x1, minZ: zc - SHELF_DEPTH / 2, maxZ: zc + SHELF_DEPTH / 2 } };
});

// ---- Quầy, tủ lạnh ----
/** Quầy thu ngân sát mặt kính, phía đông: nơi giao đơn gấp. */
export const COUNTER: AABB = { minX: 38.0, maxX: 41.0, minZ: 31.8, maxZ: 33.1 };
/** Tủ mát cửa kính: 18 tủ 1 m dọc tường tây, cửa quay vào trong (+x). */
export const COOLERS: AABB = { minX: 0.1, maxX: 1.0, minZ: 9.0, maxZ: 27.0 };
export const COOLER_COUNT = 18;
/** Ngăn mát mở (kệ lạnh không cửa): 15 cái 1,2 m dọc tường đông, mặt quay vào trong (-x). Cao 2 m: che tầm nhìn. */
export const CHILLERS: AABB = { minX: 43.05, maxX: 43.9, minZ: 10.0, maxZ: 28.0 };
export const CHILLER_COUNT = 15;
/** Tủ đông nằm: 3 đảo giữa khu hàng lạnh, mỗi đảo 3 tủ. Thấp 0,85 m: không che tầm nhìn. */
const FREEZER_X = [34.1, 35.9, 37.7];
const FREEZER_Z = [13.0, 19.5, 26.0];
export const FREEZERS: AABB[] = FREEZER_Z.flatMap((z) =>
  FREEZER_X.map((x) => ({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.45, maxZ: z + 0.45 })),
);

/**
 * Pallet hàng (nước, giấy… bọc màng co) cao 1,9 m đặt rải trong siêu thị: che tầm nhìn, chặn lối,
 * cắt các đường nhìn dài, biến khoảng trống thành ngõ ngách.
 */
export const PALLET_H = 1.9;
export const PALLETS: AABB[] = [
  rect(6.2, 8.9, 1.2, 1.0), // hành lang bắc
  rect(21.8, 9.8, 1.2, 1.2),
  rect(30.0, 9.2, 1.2, 1.0),
  rect(26.4, 10.8, 1.2, 1.0),
  rect(36.2, 9.6, 1.2, 1.0),
  rect(8.7, 19.5, 1.2, 1.2), // làn ngang khối tây
  rect(21.8, 21.0, 1.2, 1.2), // làn ngang khối giữa
  rect(32.0, 16.25, 1.2, 1.0), // khu hàng lạnh: so le giữa các đảo tủ đông
  rect(39.8, 16.25, 1.2, 1.0),
  rect(32.4, 22.75, 1.2, 1.0),
  rect(40.6, 22.75, 1.2, 1.0),
  rect(4.5, 30.6, 1.2, 1.0), // hành lang nam
  rect(12.2, 30.4, 1.2, 1.0),
  rect(27.6, 31.4, 1.2, 1.0),
  rect(8.7, 32.3, 1.2, 1.0), // sát mặt kính
  rect(22.0, 32.3, 1.4, 1.0),
  rect(31.5, 32.3, 1.2, 1.0),
];

// ---- Khu sau ----
const KHO = roomByName('KHO').box;
const COLD_ROOM = roomByName('KHO LẠNH').box;
export const BOX_PILE: AABB = { minX: 5.5, maxX: 7.5, minZ: 1.0, maxZ: 3.0 };
/** Chồng thùng hàng lạnh (thùng xốp) trong kho lạnh, cạnh hai tủ đông dự trữ. */
export const COLD_PILE: AABB = { minX: COLD_ROOM.minX + 0.9, maxX: COLD_ROOM.minX + 2.3, minZ: 1.0, maxZ: 2.4 };
export const FREEZER_PANEL: V2 = { x: COLD_ROOM.minX + 3.6, z: 0.25 };
/** Cửa nhân viên (đã khoá) và máy chấm công trên tường bắc của kho. */
export const STAFF_DOOR: V2 = { x: 1.6, z: 0 };
export const TIME_CLOCK: V2 = { x: 3.5, z: 0.1 };
/** Đứng trong vùng này là chấm công (vào ca lúc đầu đêm, điểm danh lúc 06:00). */
export const CLOCK_ZONE: AABB = { minX: 2.2, maxX: 5.2, minZ: 0.1, maxZ: 2.4 };
/** Bàn làm việc trong văn phòng. */
const OFFICE = roomByName('VĂN PHÒNG').box;
export const OFFICE_DESK: AABB = rect((OFFICE.minX + OFFICE.maxX) / 2, 2.4, 1.4, 0.7);
/** Bàn ăn trong phòng nghỉ (nhân viên đứng quanh đây lúc đầu ca). */
const BREAK = roomByName('PHÒNG NGHỈ');
export const BREAK_TABLE: AABB = rect((BREAK.box.minX + BREAK.box.maxX) / 2, 2.6, 1.8, 0.9);
/** Phòng Kiểm Kê: tủ hồ sơ dọc tường bắc và tường đông. */
const AUDIT = roomByName('PHÒNG KIỂM KÊ');
export const AUDIT_CABINETS: AABB[] = [
  { minX: AUDIT.box.minX + 0.4, maxX: AUDIT.box.maxX - 0.3, minZ: 0.1, maxZ: 0.75 },
  { minX: AUDIT.box.maxX - 0.75, maxX: AUDIT.box.maxX - 0.1, minZ: 0.75, maxZ: 5.6 },
];

/** Vật cản cao: [hộp, chiều cao] (dùng cho va chạm lon ném bay theo đường cong). */
export const SOLIDS_3D: [AABB, number][] = [
  ...WALLS.map((w) => [w, STORE.wallH] as [AABB, number]),
  [GLASS, STORE.wallH],
  ...SHELVES.map((s) => [s.box, SHELF_HEIGHT] as [AABB, number]),
  [COUNTER, 1.05], [COOLERS, 2.1], [CHILLERS, 2.0],
  ...FREEZERS.map((f) => [f, 0.85] as [AABB, number]),
  ...PALLETS.map((p) => [p, PALLET_H] as [AABB, number]),
  [BOX_PILE, 1.04], [COLD_PILE, 1.1], [OFFICE_DESK, 0.76], [BREAK_TABLE, 0.75],
  ...AUDIT_CABINETS.map((c) => [c, 1.9] as [AABB, number]),
];
/** Vật cản di chuyển của người chơi. */
export const SOLIDS: AABB[] = SOLIDS_3D.map(([b]) => b);
/** Vật che tầm nhìn và âm thanh (cao hơn đầu người; quầy, bàn và tủ đông nằm thì thấp). */
export const OCCLUDERS: AABB[] = SOLIDS_3D.filter(([, h]) => h >= 1.8).map(([b]) => b);
/** Vật cản đường đi của Người Kiểm Kê. */
export const MOVE_BLOCKERS: AABB[] = SOLIDS;

/** Nhân viên bắt đầu mỗi đêm trong PHÒNG NGHỈ, quay mặt ra cửa. */
export const PLAYER_SPAWN: V2 = { x: BREAK.door.x - 0.6, z: 4.6 };
export const PLAYER_SPAWN_YAW = Math.PI; // nhìn về phía nam (ra cửa phòng)
/** Người Kiểm Kê đứng chờ giữa phòng riêng, nhìn ra cửa; tới giờ thì đi ra. */
export const AUDITOR_SPAWN: V2 = { x: AUDIT.door.x, z: 2.4 };
export const AUDITOR_DOOR: V2 = { x: AUDIT.door.x, z: 8.4 };
/** Cửa kho (nơi Người Kiểm Kê mang thùng người bị bắt vào cất). */
export const STORAGE_DOOR: V2 = { x: roomByName('KHO').door.x, z: 8.4 };

/** Thùng "ĐÃ LƯU KHO" thứ i xếp thành hàng dọc sát tường đông của kho (i = 0 là thùng của Tuấn, có sẵn). */
export function storageSlot(i: number): V2 {
  return { x: KHO.maxX - 0.8, z: 1.0 + i * 0.85 };
}
/** Chỗ Người Kiểm Kê đứng để đặt thùng xuống ô i (bên trái thùng, quay về phía +x). */
export function storageSlotStand(i: number): V2 {
  const s = storageSlot(i);
  return { x: s.x - 0.95, z: s.z };
}
export const storageStand = storageSlotStand;

/** Các làn chính (để dựng lộ trình tuần tra và treo đèn huỳnh quang). */
export const LANES = {
  /** Làn dọc: giữa tủ mát và khối tây · giữa hai khối · đông khối giữa · tây đảo tủ đông · giữa đảo và ngăn mát. */
  W: 2.3, XC: 15.25, XE: 28.8, XK: 30.8, XK2: 42.0,
  /** Hành lang bắc (trước cửa các phòng) và hành lang nam (trước mặt kính). */
  NZ: 8.4, SZ: 30.9,
  /** Làn ngang trong khối tây / khối giữa (giữa hai dãy liền nhau; phần tử giữa là làn ngang rộng). */
  AW: [12.5, 15.5, 19.5, 23.5, 26.5],
  AM: [14.0, 17.0, 21.0, 25.0, 28.0],
};

/** Dải đèn huỳnh quang trên trần: [x0, x1, z]. */
export const LIGHT_TUBES: [number, number, number][] = [
  [1.5, STORE.w - 1.5, LANES.NZ],
  [1.5, STORE.w - 1.5, LANES.SZ + 0.6],
  ...LANES.AW.map((z) => [3.0, 14.4, z] as [number, number, number]),
  ...LANES.AM.map((z) => [16.1, 27.5, z] as [number, number, number]),
  ...[13.0, 19.5, 26.0].map((z) => [31.5, 41.5, z + 3.0] as [number, number, number]),
];

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
        x0: half === '1' ? row.x0 : row.mid,
        x1: half === '1' ? row.mid : row.x1,
        zFace: face === 'B' ? row.box.minZ : row.box.maxZ,
        out: face === 'B' ? -1 : 1,
      });
    }
  }
}

export function sectionAt(row: number, x: number, z: number): Section {
  const shelf = SHELVES[row - 1];
  const face: Face = z < shelf.zc ? 'B' : 'N';
  const half: Half = x < shelf.mid ? '1' : '2';
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
    // Đảo đầu và đảo giữa quay mặt về bắc, đảo cuối quay về nam (mỗi tủ đều có lối đứng trước mặt)
    const rot = z < 22 ? Math.PI : 0;
    u.push({ id: `TD${i + 1}`, kind: 'tu_dong', name: `Tủ đông số ${i + 1}`, x, z, rot, front: at(x, z, rot, 0.95) });
  });
  return u;
})();

export function coldUnitById(id: string): ColdUnit | undefined {
  return COLD_UNITS.find((c) => c.id === id);
}
