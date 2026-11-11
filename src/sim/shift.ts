import { COLD_UNITS, SECTIONS } from './layout.ts';
import { shuffle } from './rng.ts';

export type TaskKind = 'scan' | 'restock' | 'freezer' | 'deliver' | 'coldRestock';

/** Số công của từng việc, và việc nào là "an toàn" (chỉ tính tối đa nửa chỉ tiêu). */
export const CONG: Record<TaskKind, number> = { scan: 2, restock: 1, freezer: 1, deliver: 3, coldRestock: 2 };
export const SAFE: Record<TaskKind, boolean> = { scan: false, restock: false, freezer: true, deliver: false, coldRestock: false };

// ---- Phiếu việc phát sinh trong ca ----
// Chỉ tiêu chỉ là mức tối thiểu. Suốt ca máy in liên tục giao thêm phiếu việc có hạn giờ;
// để trễ hạn thì bị ghi hồ sơ (bấm lỗ lúc 06:00) và sổ sách lệch đi (siêu thị tối dần).

/** restock: kệ vừa hết hàng · rescan: kệ đã quét phải kiểm lại · deliver: đơn gấp, mang 1 thùng từ kho ra quầy. */
/** coldRestock: tủ lạnh vừa hết hàng (lấy thùng hàng lạnh ở kho lạnh). */
export type OrderKind = 'restock' | 'rescan' | 'deliver' | 'coldRestock';

export interface Order {
  id: number;
  kind: OrderKind;
  /** Đoạn kệ (restock, rescan). */
  section?: string;
  /** Lúc giao và hạn chót (phút trong game tính từ 22:00). */
  issued: number;
  due: number;
  done: boolean;
  late: boolean;
}

/** Hạn của từng loại phiếu (phút trong game; 1 phút ≈ 0,56 giây thật). */
export const ORDER_DUE: Record<OrderKind, number> = { restock: 85, rescan: 70, deliver: 75, coldRestock: 95 };

/**
 * Độ lệch sổ (0..1) tăng mỗi giây thật theo: số phiếu đang quá hạn, số đoạn kệ đang trống.
 * Tự giảm chậm khi không có gì bỏ dở; làm xong một phiếu thì giảm ngay một khoản.
 */
export const DRIFT = { perLate: 0.012, perEmpty: 0.0008, decay: 0.004, onDone: 0.08 };

/** Lon nước đã ném để dụ Người Kiểm Kê: phải nhặt lại. Lúc 06:00 mỗi lon còn trên sàn bị trừ chừng này công. */
export const LITTER_PENALTY = 1;

export interface Litter {
  id: number;
  x: number;
  z: number;
}

export const SHIFT_MINUTES = 480; // 22:00 → 06:00
export const REAL_SECONDS_PER_SHIFT = 270; // ~4,5 phút ngoài đời
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
}

export function clockOf(minutes: number): string {
  const total = Math.max(0, Math.min(minutes, SHIFT_MINUTES));
  const h = (22 + Math.floor(total / 60)) % 24;
  const m = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class Shift {
  night: number;
  minutes = 0;
  quota: number;
  safeCap: number;
  earnedRisk = 0;
  earnedSafe = 0;
  scanned = new Set<string>();
  restockNeeded = new Set<string>();
  restocked = new Set<string>();
  restockTotal: number;
  freezerDone = new Set<number>();
  pile: number;
  /** Tủ lạnh đang HẾT HÀNG (mã TM…, KM…, TD…), số đã xếp lại, tổng cần xếp trong ca. */
  coldNeeded = new Set<string>();
  coldRestocked = new Set<string>();
  coldTotal = 0;
  /** Thùng hàng lạnh còn trong kho lạnh. */
  coldPile = 0;
  /** Phiếu việc đã giao trong ca (cả đã xong và quá hạn). */
  orders: Order[] = [];
  /** Lon nước đã ném còn nằm trên sàn. */
  litter: Litter[] = [];
  /** Số lon đã nhặt lại trong ca. */
  litterPicked = 0;
  /** Đoạn kệ đang phải kiểm lại (quét lại). */
  recount = new Set<string>();
  /** Độ lệch sổ 0..1: càng cao siêu thị càng tối, Người Kiểm Kê càng thính. */
  drift = 0;
  stats: ShiftStats = { heard: 0, cans: 0, idleSec: 0, runSec: 0, seen: 0, lightSpotted: 0, drops: 0 };

  constructor(night: number, rng: () => number) {
    this.night = night;
    this.quota = 6 + 2 * (night - 1);
    this.safeCap = Math.floor(this.quota / 2);
    const n = Math.min(3 + night, 8);
    for (const id of shuffle(SECTIONS.map((s) => s.id), rng).slice(0, n)) this.restockNeeded.add(id);
    this.restockTotal = n;
    this.pile = n + 1;
    // Tủ lạnh hết hàng đầu ca: đêm 1 có 2 tủ, mỗi đêm thêm 1 (tối đa 6). Thùng hàng lạnh dư 1.
    const c = Math.min(1 + night, 6);
    for (const id of shuffle(COLD_UNITS.map((u) => u.id), rng).slice(0, c)) this.coldNeeded.add(id);
    this.coldTotal = c;
    this.coldPile = c + 1;
  }

  /** Công được tính: việc rủi ro tính đủ, việc an toàn tính tối đa safeCap. */
  get cong(): number {
    return this.earnedRisk + Math.min(this.earnedSafe, this.safeCap);
  }

  get safeFull(): boolean {
    return this.earnedSafe >= this.safeCap;
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

  nextFreezer(): number | null {
    for (const t of FREEZER_TIMES) if (this.minutes < t + FREEZER_WINDOW && !this.freezerDone.has(t)) return t;
    return null;
  }
}
