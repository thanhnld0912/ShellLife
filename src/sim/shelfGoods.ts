// Hàng bày trên kệ khô: món nào nằm ở đâu, xác định hoàn toàn từ bố cục (không ngẫu nhiên theo máy),
// nên lõi game (lấy / ăn hàng, hàng lỗi) và phần vẽ (world.ts) luôn khớp nhau, sau này chơi mạng cũng khớp.
// KHÔNG dùng Three.js.

import { SECTIONS, SHELVES, type Section } from './layout.ts';
import { aisleOf, productById, type Product, type ProductId } from './products.ts';

/** Mặt trên các tầng kệ (m), khớp model ke_hang.glb (tầng ở 0,16 m, dày 3 cm). */
export const TIER_TOPS = [0.175, 0.615, 1.055, 1.495, 1.935];
/** Khe hở giữa hai món đứng cạnh nhau (m). */
const GAP = 0.018;
/** Lề hai đầu đoạn kệ (m). */
const EDGE = 0.1;

/** Một ô hàng trên kệ. key = "<đoạn>:<tầng>:<thứ tự>", vd "3N1:2:7". */
export interface ShelfSlot {
  key: string;
  section: string;
  tier: number;
  i: number;
  product: ProductId;
  /** Tâm đáy món hàng. */
  x: number;
  y: number;
  z: number;
  /** Mặt trước món hàng quay ra lối đi: -1 = bắc, +1 = nam. */
  out: number;
}

/** Băm chuỗi (FNV-1a) ra số nguyên không âm: chọn hàng cố định theo vị trí. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Món bày ở tầng `tier` của đoạn kệ (mỗi tầng một món trong ngành hàng của dãy). */
export function tierProduct(sec: Section, tier: number): Product {
  const pool = aisleOf(sec.row).goods;
  return productById(pool[hashStr(`${sec.id}/${tier}`) % pool.length])!;
}

let cache: { all: ShelfSlot[]; byKey: Map<string, ShelfSlot>; bySecTier: Map<string, ShelfSlot[]> } | null = null;

function build() {
  const all: ShelfSlot[] = [];
  for (const sec of SECTIONS) {
    const row = SHELVES[sec.row - 1];
    TIER_TOPS.forEach((y, tier) => {
      const p = tierProduct(sec, tier);
      const step = p.w + GAP;
      const z = row.zc + sec.out * (0.43 - p.d / 2);
      let i = 0;
      for (let x = sec.x0 + EDGE + step / 2; x < sec.x1 - EDGE; x += step, i++) {
        const key = `${sec.id}:${tier}:${i}`;
        if (hashStr(key) % 20 === 0) continue; // chỗ trống lác đác cho thật
        all.push({ key, section: sec.id, tier, i, product: p.id, x, y, z, out: sec.out });
      }
    });
  }
  const byKey = new Map(all.map((s) => [s.key, s]));
  const bySecTier = new Map<string, ShelfSlot[]>();
  for (const s of all) {
    const k = `${s.section}:${s.tier}`;
    if (!bySecTier.has(k)) bySecTier.set(k, []);
    bySecTier.get(k)!.push(s);
  }
  return { all, byKey, bySecTier };
}

/** Mọi ô hàng trên các kệ khô. */
export function shelfSlots(): ShelfSlot[] {
  return (cache ??= build()).all;
}

export function slotByKey(key: string): ShelfSlot | undefined {
  return (cache ??= build()).byKey.get(key);
}

/**
 * Ô hàng gần điểm (x, y) nhất trên mặt kệ của đoạn `sectionId` (điểm nhắm của người chơi).
 * y là độ cao điểm nhắm: món nằm trên tầng có mặt trên thấp hơn y gần nhất.
 */
export function slotAt(sectionId: string, x: number, y: number): ShelfSlot | null {
  let tier = -1;
  for (let t = 0; t < TIER_TOPS.length; t++) if (y >= TIER_TOPS[t] - 0.02) tier = t;
  if (tier < 0) return null;
  const list = (cache ??= build()).bySecTier.get(`${sectionId}:${tier}`) ?? [];
  let best: ShelfSlot | null = null;
  let bd = Infinity;
  for (const s of list) {
    const d = Math.abs(s.x - x);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  const p = best ? productById(best.product)! : null;
  return best && p && bd <= (p.w + GAP) * 0.75 ? best : null;
}

// ---- Hàng lỗi ----
/** het_han: quá hạn sử dụng · phong: bao bì phồng / lon phồng · moc: có đốm mốc. */
export type DefectKind = 'het_han' | 'phong' | 'moc';
export const DEFECT_TEXT: Record<DefectKind, string> = {
  het_han: 'HẾT HẠN SỬ DỤNG',
  phong: 'BAO BÌ BỊ PHỒNG',
  moc: 'CÓ ĐỐM MỐC',
};

/** Chọn `n` ô hàng lỗi cho một đêm (bỏ qua các đoạn kệ đang thiếu hàng). */
export function pickDefects(n: number, rng: () => number, skipSections: Set<string>): Map<string, DefectKind> {
  const pool = shelfSlots().filter((s) => !skipSections.has(s.section));
  const out = new Map<string, DefectKind>();
  const kinds: DefectKind[] = ['het_han', 'phong', 'moc'];
  let guard = 0;
  while (out.size < n && guard++ < n * 50 && pool.length) {
    const s = pool[Math.floor(rng() * pool.length)];
    if (out.has(s.key)) continue;
    // không để hai món lỗi cùng một đoạn kệ (rải đều cho người chơi đi tìm)
    if ([...out.keys()].some((k) => k.startsWith(s.section + ':'))) continue;
    out.set(s.key, kinds[Math.floor(rng() * kinds.length)]);
  }
  return out;
}
