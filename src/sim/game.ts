// Lõi game: giữ toàn bộ "sự thật" của ca làm việc. Không phụ thuộc Three.js,
// để sau này chuyển lên server cho chế độ nhiều người.

import type { V2 } from './geometry.ts';
import { inBox } from './geometry.ts';
import { Auditor, tuningForNight } from './auditor.ts';
import { CONG, FREEZER_TIMES, REAL_PER_MIN, SAFE, SHIFT_MINUTES, Shift, type TaskKind } from './shift.ts';
import { COUNTER_ZONE, PLAYER_SPAWN, sectionById } from './layout.ts';
import { mulberry32 } from './rng.ts';
import { numberVi } from './vi.ts';

export const MAX_NIGHTS = 5;
export const MAX_HOLES = 3;

export interface Evaluation {
  night: number;
  cong: number;
  quota: number;
  safeEarned: number;
  safeCap: number;
  atCounter: boolean;
  holesAdded: number;
  holesTotal: number;
  reasons: string[];
  notes: string[];
  dead: boolean;
  final: boolean;
}

export type GameEvent =
  | { type: 'announce'; text: string }
  | { type: 'heard'; at: V2 }
  | { type: 'light'; at: V2 }
  | { type: 'power'; on: boolean }
  | { type: 'noise'; at: V2; radius: number }
  | { type: 'count'; n: number }
  | { type: 'lost' }
  | { type: 'step'; at: V2 }
  | { type: 'beep'; at: V2 }
  | { type: 'eval'; ev: Evaluation }
  | { type: 'dead'; reason: 'scan' | 'holes' };

export interface TaskResult { ok: boolean; msg: string; cong?: number; safeCapped?: boolean }

export class Game {
  name: string;
  night = 1;
  holes = 0;
  shift: Shift;
  auditor: Auditor;
  player: { pos: V2; alive: boolean; light: boolean } = { pos: { ...PLAYER_SPAWN }, alive: true, light: false };
  /** Điện siêu thị. Mất điện từ đêm 2: mỗi đêm một lần, khoảng 80 phút trong game (~45 giây thật). */
  power = true;
  blackout: { start: number; end: number } | null = null;
  phase: 'shift' | 'eval' | 'dead' | 'done' = 'shift';
  events: GameEvent[] = [];
  private rng: () => number;
  private announced = new Set<string>();

  constructor(name: string, seed = Date.now()) {
    this.name = name;
    this.rng = mulberry32(seed);
    this.shift = new Shift(1, this.rng);
    this.auditor = new Auditor(tuningForNight(1), this.rng);
    this.blackout = this.planBlackout();
  }

  private planBlackout(): { start: number; end: number } | null {
    if (this.night < 2) return null;
    const start = 120 + Math.floor(this.rng() * 180); // từ 00:00 đến 03:00
    return { start, end: start + 80 };
  }

  /** Bật/tắt mất điện ngay (dùng để thử, phím F6 khi bật F3). */
  forceBlackout(): void {
    const m = this.shift.minutes;
    this.announced.delete('bo_off');
    this.announced.delete('bo_on');
    this.blackout = this.power ? { start: m, end: m + 80 } : { start: m - 1, end: m };
    if (!this.power) this.announced.add('bo_off');
  }

  private setPower(on: boolean): void {
    if (this.power === on) return;
    this.power = on;
    this.auditor.blackout = !on;
    this.events.push({ type: 'power', on });
  }

  tick(dt: number): void {
    this.auditor.blackout = !this.power;
    if (this.phase === 'dead') {
      // Người chết chỉ xem: Người Kiểm Kê vẫn đi tuần.
      this.auditor.update(dt, this.player.pos, false);
      this.drainAuditor();
      return;
    }
    if (this.phase !== 'shift') return;
    this.shift.minutes += dt / REAL_PER_MIN;
    this.schedule();
    this.auditor.update(dt, this.player.pos, this.player.alive, this.player.light);
    this.drainAuditor();
    if (this.phase === 'shift' && this.shift.minutes >= SHIFT_MINUTES) this.endShift();
  }

  /** Người chơi gây tiếng động. radius: bán kính nghe (m), error: sai số vị trí (m). */
  noise(at: V2, radius: number, error: number): void {
    if (this.phase !== 'shift') return;
    this.events.push({ type: 'noise', at: { ...at }, radius });
    if (this.auditor.hear(at, radius, error)) this.shift.stats.heard++;
  }

  reportMotion(dt: number, moving: boolean, running: boolean): void {
    if (this.phase !== 'shift') return;
    if (!moving) this.shift.stats.idleSec += dt;
    if (running) this.shift.stats.runSec += dt;
  }

  // ---- Việc ----
  scanSection(id: string): TaskResult {
    const sec = sectionById(id);
    if (!sec) return { ok: false, msg: 'Không xác định được kệ.' };
    if (this.shift.scanned.has(id)) return { ok: false, msg: `${sec.name}: đã quét trong ca này.` };
    if (this.shift.restockNeeded.has(id))
      return { ok: false, msg: `${sec.name} đang thiếu hàng. Xếp hàng vào trước rồi mới quét.` };
    this.shift.scanned.add(id);
    return this.credit('scan', `Quét xong ${sec.name}`);
  }

  restock(id: string): TaskResult {
    const sec = sectionById(id);
    if (!sec) return { ok: false, msg: 'Không xác định được kệ.' };
    if (!this.shift.restockNeeded.has(id)) return { ok: false, msg: `${sec.name} không thiếu hàng.` };
    this.shift.restockNeeded.delete(id);
    this.shift.restocked.add(id);
    return this.credit('restock', `Xếp hàng xong ${sec.name}`);
  }

  freezer(): TaskResult {
    const w = this.shift.freezerWindow();
    if (w === null) return { ok: false, msg: 'Chưa đến giờ ghi nhiệt độ (23:00, 01:00, 03:00, 05:00).' };
    if (this.shift.freezerDone.has(w)) return { ok: false, msg: 'Mốc giờ này đã ghi rồi.' };
    this.shift.freezerDone.add(w);
    return this.credit('freezer', 'Ghi nhiệt độ tủ đông: -18°C');
  }

  /** Thả rơi thùng đang ôm (để chạy cho nhanh). Hàng bị trả về đống trong kho. */
  dropBox(): void {
    this.shift.pile++;
    this.shift.stats.drops++;
  }

  takeBox(): boolean {
    if (this.shift.pile <= 0) return false;
    this.shift.pile--;
    return true;
  }

  private credit(kind: TaskKind, text: string): TaskResult {
    const c = CONG[kind];
    const s = this.shift;
    let safeCapped = false;
    if (SAFE[kind]) {
      safeCapped = s.earnedSafe >= s.safeCap;
      s.earnedSafe += c;
    } else {
      s.earnedRisk += c;
    }
    return { ok: true, msg: text, cong: c, safeCapped };
  }

  // ---- Lịch loa và sự kiện trong ca ----
  private once(key: string, cond: boolean, fn: () => void): void {
    if (cond && !this.announced.has(key)) {
      this.announced.add(key);
      fn();
    }
  }

  private announce(text: string): void {
    this.events.push({ type: 'announce', text });
  }

  private schedule(): void {
    const m = this.shift.minutes;
    this.once('open', m >= 0, () =>
      this.announce(`Kính chào quý khách. Ca đêm thứ ${numberVi(this.night)} bắt đầu. Nhân viên ca đêm: một người.`),
    );
    this.once('auditor', m >= 10, () => {
      this.auditor.activate();
      this.announce('Kiểm kê viên bắt đầu làm việc. Không để kiểm kê viên kiểm đếm nhân viên.');
    });
    for (const t of FREEZER_TIMES) {
      this.once(`fz${t}`, m >= t, () => this.announce('Đến giờ ghi nhiệt độ tủ đông.'));
    }
    this.once('progress', m >= 240, () =>
      this.announce(
        `Nhân viên ${this.name}: ${numberVi(this.shift.cong)} trên ${numberVi(this.shift.quota)} công.`,
      ),
    );
    const b = this.blackout;
    if (b) {
      this.once('bo_off', m >= b.start, () => {
        this.setPower(false);
        this.announce('Sự cố mất điện. Nhân viên tiếp tục làm việc bằng đèn pin. Thời gian mất điện vẫn tính là giờ làm.');
      });
      this.once('bo_on', m >= b.end, () => {
        this.setPower(true);
        this.announce('Điện đã có lại. Cảm ơn nhân viên đã không nghỉ.');
      });
    }
    this.once('rollcall', m >= 450, () => this.announce('Còn ba mươi phút đến điểm danh tại quầy.'));
  }

  private drainAuditor(): void {
    for (const e of this.auditor.events) {
      switch (e.type) {
        case 'heard':
          this.events.push({ type: 'heard', at: e.at });
          break;
        case 'light':
          this.shift.stats.lightSpotted++;
          this.events.push({ type: 'light', at: e.at });
          break;
        case 'count':
          if (e.n === 1) this.shift.stats.seen++;
          this.events.push({ type: 'count', n: e.n });
          break;
        case 'lost':
          this.events.push({ type: 'lost' });
          break;
        case 'caught':
          this.die('scan');
          break;
        case 'step':
          this.events.push({ type: 'step', at: { ...this.auditor.pos } });
          break;
        case 'beep':
          this.events.push({ type: 'beep', at: { ...this.auditor.pos } });
          break;
      }
    }
    this.auditor.events.length = 0;
  }

  private die(reason: 'scan' | 'holes'): void {
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.player.alive = false;
    this.events.push({ type: 'dead', reason });
  }

  private endShift(): void {
    const s = this.shift;
    const atCounter = inBox(this.player.pos, COUNTER_ZONE);
    const reasons: string[] = [];
    let add = 0;
    if (s.cong < s.quota) {
      add++;
      reasons.push(`Không đủ chỉ tiêu (${s.cong}/${s.quota} công).`);
    }
    if (!atCounter) {
      add++;
      reasons.push('Không có mặt ở quầy lúc điểm danh 06:00.');
    }
    this.holes = Math.min(MAX_HOLES, this.holes + add);
    const dead = this.holes >= MAX_HOLES;
    const final = !dead && this.night >= MAX_NIGHTS;
    const ev: Evaluation = {
      night: this.night,
      cong: s.cong,
      quota: s.quota,
      safeEarned: s.earnedSafe,
      safeCap: s.safeCap,
      atCounter,
      holesAdded: add,
      holesTotal: this.holes,
      reasons,
      notes: this.notes(),
      dead,
      final,
    };
    this.phase = final ? 'done' : 'eval';
    if (dead) this.player.alive = false;
    this.events.push({ type: 'eval', ev });
  }

  /** Gọi sau khi người chơi đọc phiếu đánh giá có 3 lỗ. */
  terminate(): void {
    this.phase = 'shift';
    this.die('holes');
  }

  private notes(): string[] {
    const st = this.shift.stats;
    const n: string[] = [];
    const idleMin = Math.round(st.idleSec / REAL_PER_MIN);
    if (st.heard >= 3) n.push(`Gây tiếng động làm kiểm kê viên đổi hướng ${st.heard} lần.`);
    if (st.cans >= 3) n.push(`Ném ${st.cans} lon nước. Hàng hóa không phải đồ chơi.`);
    if (idleMin >= 90) n.push(`Đứng yên ${idleMin} phút trong ca. Hiệu suất: thấp.`);
    if (st.runSec >= 15) n.push(`Chạy trong siêu thị ${Math.round(st.runSec)} giây. Lý do khai báo: "bị dí".`);
    if (st.lightSpotted >= 2) n.push(`Rọi đèn pin vào kiểm kê viên ${st.lightSpotted} lần. Đề nghị tiết kiệm pin.`);
    if (st.drops >= 1) n.push(`Làm rơi ${st.drops} thùng hàng khi đang chạy. Hàng dễ vỡ, nhân viên thì không.`);
    if (st.seen >= 2) n.push(`Bị kiểm kê viên quét trúng ${st.seen} lần nhưng vẫn còn ở đây. Đáng ngờ.`);
    if (this.shift.cong >= this.shift.quota * 1.5) n.push('Nhân viên có dấu hiệu chăm chỉ bất thường.');
    if (!n.length) n.push('Không có gì để nhận xét.');
    return n;
  }

  nextNight(): void {
    this.night++;
    this.shift = new Shift(this.night, this.rng);
    this.auditor = new Auditor(tuningForNight(this.night), this.rng);
    this.player.pos = { ...PLAYER_SPAWN };
    this.player.alive = true;
    this.phase = 'shift';
    this.announced.clear();
    this.power = true;
    this.blackout = this.planBlackout();
  }
}
