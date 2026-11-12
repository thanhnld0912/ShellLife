// Một ca làm việc (một đêm): danh sách việc được giao, phiếu việc phát sinh, hàng hoá trên kệ, rác, xe đẩy.
// Không dùng Three.js (sau này chạy trên server).

import { CART_HOMES, COLD_UNITS, SECTIONS, TRASH_BINS, sectionById } from './layout.ts';
import { mulberry32, shuffle } from './rng.ts';
import { hashStr, pickDefects, type DefectKind } from './shelfGoods.ts';
import type { ProductId } from './products.ts';

// ---- Việc được giao (phân công) ----
// Không còn "công" và chỉ tiêu: đầu ca mỗi nhân viên nhận một DANH SÁCH VIỆC CỤ THỂ (quét đoạn kệ nào, xếp kệ nào,
// ghi nhiệt độ mốc nào, dọn món hàng lỗi nào, gom rác). 06:00 còn việc chưa xong thì bị bấm 1 lỗ (tối đa 1 lỗ/đêm vì việc).
// Sau này nhiều người: việc chia cho từng người (Job.who).

/**
 * scan: quét một đoạn kệ · restock: xếp hàng vào kệ THIẾU HÀNG · coldRestock: xếp hàng lạnh vào tủ HẾT HÀNG
 * freezer: ghi nhiệt độ tủ đông đúng mốc giờ · defect: bỏ một món hàng lỗi vào thùng HÀNG LỖI · trash: gom rác cả siêu thị.
 */
export type JobKind = 'scan' | 'restock' | 'coldRestock' | 'freezer' | 'defect' | 'trash';

export interface Job {
  id: number;
  kind: JobKind;
  /** scan / restock: mã đoạn kệ · coldRestock: mã tủ · freezer: mốc giờ (phút) · defect: mã ô hàng · trash: 'all'. */
  target: string;
  /** Người được giao ('p1' = người chơi này). */
  who: string;
  done: boolean;
}

/** Lương một đêm thử việc (đồng). Ăn hàng, để lon nước trên sàn thì trừ vào đây. */
export const WAGE_PER_NIGHT = 300000;
/** Lon nước ném ra còn trên sàn lúc 06:00: phí dọn, trừ lương. */
export const LITTER_FEE = 20000;
/** Ăn hàng quá chừng này tiền trong một đêm thì bị ghi hồ sơ. */
export const EAT_RECORD_OVER = 100000;
/** Đủ chừng này lần ghi hồ sơ thì bấm 1 lỗ thẻ. */
export const RECORDS_PER_HOLE = 3;

// ---- Phiếu việc phát sinh trong ca ----
// Máy in ở quầy giao thêm phiếu có hạn giờ. Trễ hạn: GHI HỒ SƠ (3 lần ghi = 1 lỗ) và sổ sách lệch đi (siêu thị tối dần).

/** restock: kệ vừa hết hàng · rescan: kệ đã quét phải kiểm lại · deliver: đơn gấp, mang 1 thùng từ kho ra quầy. */
/** coldRestock: tủ lạnh vừa hết hàng (lấy thùng hàng lạnh ở kho lạnh). */
/** bulky: khiêng kiện nước suối (~90 kg) từ kho ra ĐẢO KHUYẾN MÃI: 2 người khiêng, hoặc chở bằng xe đẩy hàng. */
/** power: mất điện, bật lại cầu dao ở tủ điện tổng trong PHÒNG ĐIỆN. */
export type OrderKind = 'restock' | 'rescan' | 'deliver' | 'coldRestock' | 'bulky' | 'power';

/** Việc nặng (phải bê / khiêng / đẩy): giao cách nhau ít nhất HEAVY_GAP phút để người chơi không bị ngợp. */
export const HEAVY_ORDERS = new Set<OrderKind>(['restock', 'coldRestock', 'deliver', 'bulky']);
export const HEAVY_GAP = 70;
/** Kiện hàng (việc nặng nhất) cách mọi việc nặng khác và lần mất điện ít nhất chừng này phút. */
export const BULKY_GAP = 100;

export interface Order {
  id: number;
  kind: OrderKind;
  /** Đoạn kệ (restock, rescan) / mã tủ (coldRestock). */
  section?: string;
  /** Lúc giao và hạn chót (phút trong game tính từ 22:00). */
  issued: number;
  due: number;
  done: boolean;
  late: boolean;
}

/** Hạn của từng loại phiếu (phút trong game). Việc nặng hạn dài hơn. */
export const ORDER_DUE: Record<OrderKind, number> = { restock: 95, rescan: 70, deliver: 85, coldRestock: 105, bulky: 150, power: 60 };

/** Kiện hàng cồng kềnh. pos: tâm kiện trên sàn · yaw: hướng chiều dài. */
export interface Bulky {
  id: number;
  pos: { x: number; z: number };
  yaw: number;
  /** Ai đang khiêng ('p1' = người chơi này; sau này là mã người chơi trong mạng). Tối đa 2. */
  carriers: string[];
  /** Đang nằm trên xe đẩy hàng nào (null: không). */
  cart: number | null;
  /** Đã đặt ở ĐẢO KHUYẾN MÃI. */
  done: boolean;
}

/** Xe đẩy: 'hang' chở kiện hàng hoặc tối đa 3 thùng hàng khô · 'rac' gom túi rác (tối đa 6 túi). */
export interface Cart {
  id: number;
  kind: 'hang' | 'rac';
  pos: { x: number; z: number };
  yaw: number;
  /** Ai đang đẩy (null: để yên). */
  pusher: string | null;
  bulky: number | null;
  boxes: number;
  bags: number;
}
export const CART_MAX_BOXES = 3;
export const CART_MAX_BAGS = 6;
/** Xách tay tối đa chừng này túi rác. */
export const HAND_MAX_BAGS = 2;

/**
 * Độ lệch sổ (0..1) tăng mỗi giây thật theo: số phiếu đang quá hạn, số đoạn kệ đang trống.
 * Tự giảm chậm khi không có gì bỏ dở; làm xong một phiếu thì giảm ngay một khoản.
 */
export const DRIFT = { perLate: 0.012, perEmpty: 0.0008, decay: 0.004, onDone: 0.08, perDefect: 0.0006 };
/** Từ giờ này (phút, 02:00) hàng lỗi còn trên kệ bắt đầu làm lệch sổ. */
export const DEFECT_DRIFT_FROM = 240;

export interface Litter {
  id: number;
  x: number;
  z: number;
}

export const SHIFT_MINUTES = 480; // 22:00 → 06:00
/** Một ca ~6,5 phút ngoài đời (danh sách việc cụ thể cần đi khắp siêu thị). */
export const REAL_SECONDS_PER_SHIFT = 390;
export const REAL_PER_MIN = REAL_SECONDS_PER_SHIFT / SHIFT_MINUTES;

/** Mốc ghi nhiệt độ tủ đông, tính bằng phút kể từ 22:00 (23:00, 01:00, 03:00, 05:00). */
export const FREEZER_TIMES = [60, 180, 300, 420];
export const FREEZER_WINDOW = 40;

export interface ShiftStats {
  heard: number;
  cans: number;
  idleSec: number;
  runSec: number;
  seen: number;
  lightSpotted: number;
  drops: number;
  sparks: number;
}

export function clockOf(minutes: number): string {
  const total = Math.max(0, Math.min(minutes, SHIFT_MINUTES));
  const h = (22 + Math.floor(total / 60)) % 24;
  const m = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Số lượng việc giao đầu ca theo đêm (1..5). */
export function jobCounts(night: number) {
  return {
    scan: 2 + Math.floor(night / 2),
    restock: 1 + Math.floor((night - 1) / 2),
    cold: 1 + Math.floor((night - 1) / 2),
    defects: 1 + Math.ceil(night / 2),
    freezer: night <= 2 ? [60, 300] : night <= 4 ? [60, 180, 300] : [...FREEZER_TIMES],
  };
}

export class Shift {
  night: number;
  minutes = 0;
  /** Việc được giao đầu ca (danh sách cụ thể). */
  jobs: Job[] = [];
  scanned = new Set<string>();
  restockNeeded = new Set<string>();
  restocked = new Set<string>();
  freezerDone = new Set<number>();
  pile: number;
  /** Tủ lạnh đang HẾT HÀNG (mã TM…, KM…, TD…), số đã xếp lại. */
  coldNeeded = new Set<string>();
  coldRestocked = new Set<string>();
  /** Thùng hàng lạnh còn trong kho lạnh. */
  coldPile = 0;
  /** Phiếu việc phát sinh đã giao trong ca (cả đã xong và quá hạn). */
  orders: Order[] = [];
  /** Lon nước đã ném còn nằm trên sàn. */
  litter: Litter[] = [];
  /** Số lon đã nhặt lại trong ca. */
  litterPicked = 0;
  /** Đoạn kệ đang phải kiểm lại (quét lại). */
  recount = new Set<string>();
  /** Độ lệch sổ 0..1: càng cao siêu thị càng tối, Người Kiểm Kê càng thính. */
  drift = 0;
  stats: ShiftStats = { heard: 0, cans: 0, idleSec: 0, runSec: 0, seen: 0, lightSpotted: 0, drops: 0, sparks: 0 };
  /** Ô hàng đã bị lấy khỏi kệ (đang cầm hoặc đã ăn). Xếp hàng lại đoạn kệ đó thì đầy lại. */
  taken = new Set<string>();
  /** Hàng lỗi còn trên kệ (mã ô → kiểu lỗi), tổng đầu ca, số đã bỏ vào thùng HÀNG LỖI. */
  defects: Map<string, DefectKind>;
  defectsTotal: number;
  defectsRemoved = 0;
  /** Các món đã ăn / uống trong ca (trừ đúng giá tiền vào lương lúc 06:00). */
  eaten: { product: ProductId; price: number; bad: boolean }[] = [];
  /** Kiện hàng cồng kềnh trong ca (đang chờ trong kho, đang khiêng / chở, đã đặt). */
  bulky: Bulky[] = [];
  /** Thùng rác (chỉ số trong TRASH_BINS) còn đầy túi rác. */
  trashFull: Set<number>;
  /** Số túi rác đã đổ vào thùng rác lớn. */
  trashDumped = 0;
  /** Xe đẩy hàng và xe gom rác (về chỗ cũ trong kho mỗi đêm). */
  carts: Cart[];

  /**
   * players: số người chơi trong ca. Nhiều người thì việc nhân lên theo số người (trừ mốc ghi nhiệt độ và gom rác: chia nhau),
   * mỗi việc ghi tên người được giao (Job.who = 'p1', 'p2'…), chia lần lượt cho từng người.
   */
  constructor(night: number, rng: () => number, players = 1) {
    this.night = night;
    const n = Math.max(1, players);
    const k = jobCounts(night);
    for (const id of shuffle(SECTIONS.map((s) => s.id), rng).slice(0, k.restock * n)) this.restockNeeded.add(id);
    this.pile = this.restockNeeded.size + 1;
    for (const id of shuffle(COLD_UNITS.map((u) => u.id), rng).slice(0, k.cold * n)) this.coldNeeded.add(id);
    this.coldPile = this.coldNeeded.size + 1;
    // Hàng lỗi và các đoạn kệ phải quét: bộ ngẫu nhiên riêng (không làm lệch phần khác của game)
    const drng = mulberry32(hashStr(`loi/${night}/${[...this.restockNeeded].join(',')}`));
    this.defects = pickDefects(k.defects * n, drng, this.restockNeeded);
    this.defectsTotal = this.defects.size;
    // Quét: mỗi đoạn ở một dãy khác nhau (rải khắp siêu thị), không trùng kệ đang thiếu hàng
    const rows = new Set<number>();
    const scans: string[] = [];
    const scanCands = shuffle(SECTIONS.filter((x) => !this.restockNeeded.has(x.id)), drng);
    for (const s of scanCands) {
      if (scans.length >= k.scan * n) break;
      if (rows.has(s.row)) continue;
      rows.add(s.row);
      scans.push(s.id);
    }
    // Nhiều người mà hết dãy: lấy thêm đoạn ở dãy đã có
    for (const s of scanCands) {
      if (scans.length >= k.scan * n) break;
      if (!scans.includes(s.id)) scans.push(s.id);
    }
    this.trashFull = new Set(TRASH_BINS.map((_, i) => i));
    this.carts = CART_HOMES.map((h, i) => ({ id: i + 1, kind: h.kind, pos: { x: h.x, z: h.z }, yaw: h.yaw, pusher: null, bulky: null, boxes: 0, bags: 0 }));

    let id = 1;
    // Chia lần lượt cho từng người; mỗi loại việc bắt đầu từ một người khác để không ai toàn nhận việc đầu danh sách
    let start = 0;
    const addAll = (kind: JobKind, targets: Iterable<string>) => {
      let i = start++;
      for (const target of targets) this.jobs.push({ id: id++, kind, target, who: `p${(i++ % n) + 1}`, done: false });
    };
    addAll('scan', scans);
    addAll('restock', this.restockNeeded);
    addAll('coldRestock', this.coldNeeded);
    addAll('freezer', k.freezer.map(String));
    addAll('defect', this.defects.keys());
    this.jobs.push({ id: id++, kind: 'trash', target: 'all', who: `p${((night - 1) % n) + 1}`, done: false });
  }

  /** Đánh dấu xong việc được giao khớp (kind, target). Trả về việc vừa xong (null nếu không có trong danh sách). */
  completeJob(kind: JobKind, target: string): Job | null {
    const j = this.jobs.find((x) => x.kind === kind && x.target === target && !x.done);
    if (!j) return null;
    j.done = true;
    return j;
  }

  get jobsDone(): number {
    return this.jobs.filter((j) => j.done).length;
  }

  get jobsLeft(): Job[] {
    return this.jobs.filter((j) => !j.done);
  }

  /** Túi rác tổng trong đêm (mỗi thùng một túi). */
  get trashTotal(): number {
    return TRASH_BINS.length;
  }

  /** Bỏ mọi dấu vết lấy hàng / hàng lỗi của một đoạn kệ (kệ được xếp hàng mới hoặc bị bán hết). */
  clearSectionGoods(sectionId: string): void {
    const pre = sectionId + ':';
    for (const k of [...this.taken]) if (k.startsWith(pre)) this.taken.delete(k);
    for (const k of [...this.defects.keys()]) if (k.startsWith(pre)) this.defects.delete(k);
  }

  clock(): string {
    return clockOf(this.minutes);
  }

  /** Phiếu chưa xong (kể cả đã quá hạn), hạn gần nhất trước. */
  get openOrders(): Order[] {
    return this.orders.filter((o) => !o.done).sort((a, b) => a.due - b.due);
  }

  get lateCount(): number {
    return this.orders.filter((o) => o.late).length;
  }

  freezerWindow(): number | null {
    for (const t of FREEZER_TIMES) if (this.minutes >= t && this.minutes < t + FREEZER_WINDOW) return t;
    return null;
  }

  /** Mốc ghi nhiệt độ được giao kế tiếp còn kịp làm. */
  nextFreezer(): number | null {
    for (const j of this.jobs) {
      if (j.kind !== 'freezer' || j.done) continue;
      const t = Number(j.target);
      if (this.minutes < t + FREEZER_WINDOW) return t;
    }
    return null;
  }
}

/** Mô tả một việc được giao (để hiện chữ trên bìa kẹp). */
export function jobText(j: Job, defectSlot?: { section: string; tier: number; productName: string }): string {
  switch (j.kind) {
    case 'scan':
      return `Quét ${sectionById(j.target)?.name ?? j.target}`;
    case 'restock':
      return `Xếp hàng ${sectionById(j.target)?.name ?? j.target} (thùng ở KHO)`;
    case 'coldRestock': {
      const u = COLD_UNITS.find((c) => c.id === j.target);
      return `Xếp hàng lạnh vào ${u?.name ?? j.target} (thùng xốp ở KHO LẠNH)`;
    }
    case 'freezer':
      return `Ghi nhiệt độ tủ đông lúc ${clockOf(Number(j.target))} (KHO LẠNH)`;
    case 'defect':
      return defectSlot
        ? `Hàng lỗi: ${defectSlot.productName} · ${sectionById(defectSlot.section)?.name ?? ''} · tầng ${defectSlot.tier + 1}`
        : 'Dọn một món hàng lỗi';
    case 'trash':
      return 'Gom rác các thùng trong siêu thị, đổ vào THÙNG RÁC LỚN (KHO)';
  }
}
