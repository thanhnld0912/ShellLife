// Bản đồ siêu thị in trên bìa kẹp phiếu việc (Tab): vẽ bằng SVG từ bố cục (layout.ts), đánh số các việc được giao
// đúng chỗ cần làm, để khỏi lạc trong siêu thị 44 × 34 m. Mũi tên vàng là mình (hướng nhìn).

import type { Game } from '../sim/game.ts';
import type { V2 } from '../sim/geometry.ts';
import {
  BULKY_SPOT, CHILLERS, CLOCK_ZONE, COLD_PILE, COOLERS, COUNTER, DEFECT_BIN, DUMPSTER, FREEZERS, FREEZER_PANEL, PALLETS, POWER_PANEL,
  PRODUCE_STANDS, PROMO_ZONE, ROOMS, SHELVES, STORE, TRASH_BINS, BOX_PILE, coldUnitById, sectionById,
} from '../sim/layout.ts';
import { slotByKey } from '../sim/shelfGoods.ts';
import type { AABB } from '../sim/geometry.ts';

/** Màu theo loại việc (dùng chung cho số trên bản đồ và trong danh sách). */
export const JOB_COLORS: Record<string, string> = {
  scan: '#2f7fc1', restock: '#c62828', coldRestock: '#1f9bb3', freezer: '#4b7d8c', defect: '#e8731c', trash: '#2f8a4a',
  order: '#7a3fa0', power: '#d4a10b', bulky: '#7a3fa0',
};

const rect = (b: AABB, fill: string, extra = '') =>
  `<rect x="${b.minX}" y="${b.minZ}" width="${b.maxX - b.minX}" height="${b.maxZ - b.minZ}" fill="${fill}" ${extra}/>`;

/** Tâm mặt kệ của một đoạn kệ (lệch ra phía lối đi một chút). */
function secPoint(id: string): V2 | null {
  const s = sectionById(id);
  if (!s) return null;
  return { x: (s.x0 + s.x1) / 2, z: s.zFace + s.out * 0.55 };
}

export interface MapMark {
  at: V2;
  label: string;
  color: string;
}

/** Vị trí làm việc của một việc được giao / phiếu phát sinh. */
export function jobPoint(g: Game, kind: string, target?: string): V2 | null {
  switch (kind) {
    case 'scan':
    case 'restock':
    case 'rescan':
      return target ? secPoint(target) : null;
    case 'coldRestock': {
      const u = target ? coldUnitById(target) : undefined;
      return u ? u.front : null;
    }
    case 'freezer':
      return { x: FREEZER_PANEL.x, z: FREEZER_PANEL.z + 0.6 };
    case 'defect': {
      const sl = target ? slotByKey(target) : undefined;
      return sl ? secPoint(sl.section) : null;
    }
    case 'deliver':
      return { x: (COUNTER.minX + COUNTER.maxX) / 2, z: COUNTER.minZ - 0.5 };
    case 'bulky':
      return { x: (PROMO_ZONE.minX + PROMO_ZONE.maxX) / 2, z: (PROMO_ZONE.minZ + PROMO_ZONE.maxZ) / 2 };
    case 'power':
      return { x: (POWER_PANEL.minX + POWER_PANEL.maxX) / 2, z: 1.2 };
  }
  void g;
  return null;
}

export function storeMapSvg(g: Game, marks: MapMark[], me: V2, yaw: number): string {
  const W = STORE.w;
  const D = STORE.d;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${D}" fill="#f4f1e8"/>`);
  // phòng khu sau
  for (const r of ROOMS) {
    const b = r.box;
    const audit = r.name === 'PHÒNG KIỂM KÊ';
    parts.push(rect(b, audit ? '#e6d4d0' : r.safe ? '#dcebdc' : '#ebe7dc', 'stroke="#8c867a" stroke-width="0.12"'));
    parts.push(`<text x="${(b.minX + b.maxX) / 2}" y="${b.minZ + 1.5}" font-size="1.05" text-anchor="middle" fill="#5d574c" font-weight="700">${r.name}</text>`);
    if (audit) parts.push(`<text x="${(b.minX + b.maxX) / 2}" y="${b.minZ + 3.1}" font-size="0.95" text-anchor="middle" fill="#b3261e">KHOÁ</text>`);
  }
  // kệ, tủ, pallet, quầy
  for (const s of SHELVES) parts.push(rect(s.box, '#b9b3a6'));
  for (const s of SHELVES) parts.push(`<text x="${s.x0 - 0.45}" y="${s.zc + 0.4}" font-size="0.95" text-anchor="end" fill="#7a7468">${s.id}</text>`);
  parts.push(rect(COOLERS, '#9fc9d6'), rect(CHILLERS, '#9fc9d6'));
  for (const f of FREEZERS) parts.push(rect(f, '#b6d8e2'));
  for (const p of PALLETS) parts.push(rect(p, '#cfc7b4'));
  for (const p of PRODUCE_STANDS) parts.push(rect(p, '#c9dcae'));
  parts.push(rect(COUNTER, '#c29a64'));
  parts.push(rect(PROMO_ZONE, '#f2c94c', 'opacity="0.8"'));
  parts.push(rect(BOX_PILE, '#c9a273'), rect(COLD_PILE, '#e8eef0', 'stroke="#2f7fc1" stroke-width="0.12"'));
  parts.push(rect(DEFECT_BIN, '#c62828'), rect(DUMPSTER, '#2f8a4a'), rect(POWER_PANEL, '#d4a10b'));
  parts.push(rect(CLOCK_ZONE, 'none', 'stroke="#d4a10b" stroke-width="0.15" stroke-dasharray="0.4 0.3"'));
  // chú thích nhỏ
  const tag = (x: number, z: number, t: string, c = '#5d574c') => parts.push(`<text x="${x}" y="${z}" font-size="0.85" fill="${c}">${t}</text>`);
  tag(BOX_PILE.minX - 0.2, BOX_PILE.maxZ + 1, 'thùng hàng');
  tag(DUMPSTER.maxX + 0.2, DUMPSTER.maxZ + 0.6, 'rác lớn', '#2f8a4a');
  tag(CLOCK_ZONE.minX, CLOCK_ZONE.minZ + 3.3, 'chấm công', '#9a7608');
  tag(PROMO_ZONE.minX - 0.4, PROMO_ZONE.minZ - 0.3, 'khuyến mãi', '#9a7608');
  tag(COUNTER.minX, COUNTER.minZ - 0.3, 'quầy');
  // thùng rác còn đầy
  TRASH_BINS.forEach((b, i) => {
    const full = g.shift.trashFull.has(i);
    parts.push(`<circle cx="${b.x}" cy="${b.z}" r="0.42" fill="${full ? '#2f8a4a' : '#c8c3b6'}" stroke="#fff" stroke-width="0.1"/>`);
  });
  // kiện hàng chờ trong kho
  for (const b of g.shift.bulky) {
    if (b.done) continue;
    parts.push(`<rect x="${b.pos.x - 0.3}" y="${b.pos.z - 0.55}" width="0.6" height="1.1" fill="#7a3fa0" opacity="0.75"/>`);
  }
  void BULKY_SPOT;
  // số việc (nhiều việc cùng một chỗ, vd. các mốc ghi nhiệt độ: xếp lệch sang ngang cho khỏi chồng lên nhau)
  const placed: V2[] = [];
  for (const m of marks) {
    let at = { ...m.at };
    while (placed.some((q) => Math.hypot(q.x - at.x, q.z - at.z) < 1.9)) at = { x: at.x + 2.1, z: at.z };
    placed.push(at);
    m.at = at;
  }
  for (const m of marks) {
    parts.push(`<circle cx="${m.at.x}" cy="${m.at.z}" r="1.05" fill="${m.color}" stroke="#fff" stroke-width="0.18"/>`);
    parts.push(`<text x="${m.at.x}" y="${m.at.z + 0.42}" font-size="1.2" font-weight="800" text-anchor="middle" fill="#fff">${m.label}</text>`);
  }
  // mình
  const ang = (Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 180) / Math.PI;
  parts.push(
    `<g transform="translate(${me.x} ${me.z}) rotate(${-ang})"><path d="M0 1.4 L0.9 -0.8 L0 -0.3 L-0.9 -0.8 Z" fill="#111" stroke="#f2c94c" stroke-width="0.25"/></g>`,
  );
  return `<svg class="map" viewBox="-0.5 -0.5 ${W + 1} ${D + 1}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
