import { SECTIONS } from './layout.ts';
import { shuffle } from './rng.ts';

export type TaskKind = 'scan' | 'restock' | 'freezer';

/** Số công của từng việc, và việc nào là "an toàn" (chỉ tính tối đa nửa chỉ tiêu). */
export const CONG: Record<TaskKind, number> = { scan: 2, restock: 1, freezer: 1 };
export const SAFE: Record<TaskKind, boolean> = { scan: false, restock: false, freezer: true };

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
  stats: ShiftStats = { heard: 0, cans: 0, idleSec: 0, runSec: 0, seen: 0, lightSpotted: 0, drops: 0 };

  constructor(night: number, rng: () => number) {
    this.night = night;
    this.quota = 6 + 2 * (night - 1);
    this.safeCap = Math.floor(this.quota / 2);
    const n = Math.min(3 + night, 8);
    for (const id of shuffle(SECTIONS.map((s) => s.id), rng).slice(0, n)) this.restockNeeded.add(id);
    this.restockTotal = n;
    this.pile = n + 1;
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

  freezerWindow(): number | null {
    for (const t of FREEZER_TIMES) if (this.minutes >= t && this.minutes < t + FREEZER_WINDOW) return t;
    return null;
  }

  nextFreezer(): number | null {
    for (const t of FREEZER_TIMES) if (this.minutes < t + FREEZER_WINDOW && !this.freezerDone.has(t)) return t;
    return null;
  }
}
