// Lõi game: giữ toàn bộ "sự thật" của ca làm việc. Không phụ thuộc Three.js,
// để sau này chuyển lên server cho chế độ nhiều người.

import type { V2 } from './geometry.ts';
import { inBox } from './geometry.ts';
import { Auditor, ROUTE_STYLES, tuningForNight, type AuditorTuning, type RouteStyle } from './auditor.ts';
import {
  CONG, DRIFT, clockOf, FREEZER_TIMES, LITTER_PENALTY, ORDER_DUE, REAL_PER_MIN, SAFE, SHIFT_MINUTES, Shift, type Order, type OrderKind, type TaskKind,
} from './shift.ts';
import { CLOCK_ZONE, COLD_UNITS, PLAYER_SPAWN, SECTIONS, coldUnitById, sectionById, storageSlot, type Section } from './layout.ts';
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
  /** Có mặt ở máy chấm công (trong kho, cạnh cửa nhân viên) lúc 06:00. */
  atClock: boolean;
  holesAdded: number;
  holesTotal: number;
  reasons: string[];
  notes: string[];
  dead: boolean;
  final: boolean;
  /** Phiếu việc: tổng đã giao, đã xong, quá hạn. */
  ordersTotal: number;
  ordersDone: number;
  late: number;
  /** Vượt 150% chỉ tiêu: nhận phiếu khen (xoá lỗ kế tiếp). */
  voucherEarned: boolean;
  /** Phiếu khen đã dùng để xoá một lỗ trong phiếu đánh giá này. */
  voucherUsed: boolean;
  /** Công trước khi trừ lon nước để lại; `cong` là sau khi trừ. */
  congBeforeLitter: number;
  litterLeft: number;
  litterPenalty: number;
  /** Chấm công vào ca trễ (sau hạn đầu ca) thì bị trừ công. */
  lateIn: boolean;
  lateInPenalty: number;
}

/** Mô tả phiếu việc (để hiện chữ). */
export function orderText(o: Order): string {
  const sec = o.section ? sectionById(o.section) : undefined;
  if (o.kind === 'restock') return `Xếp hàng ${sec?.name ?? ''}`;
  if (o.kind === 'rescan') return `Kiểm lại ${sec?.name ?? ''}`;
  if (o.kind === 'coldRestock') return `Xếp hàng lạnh vào ${coldUnitById(o.section ?? '')?.name ?? ''}`;
  return 'ĐƠN GẤP: mang 1 thùng từ kho ra quầy';
}

/** Đọc giờ trong game bằng chữ, cho loa: 135 → "không giờ mười lăm". */
export function clockVi(minutes: number): string {
  const h = (22 + Math.floor(minutes / 60)) % 24;
  const m = Math.floor(minutes % 60);
  return `${numberVi(h)} giờ${m ? ' ' + numberVi(m) : ''}`;
}

const spoken = (s: Section) => s.name.replace(/ · /g, ', ');

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
  /** slot: ô trong kho sẽ đặt thùng mang tên người chết. */
  | { type: 'dead'; reason: 'scan' | 'holes'; slot: V2 }
  /** Người Kiểm Kê tới nơi, bắt đầu nhét người vào thùng tại `at`. */
  | { type: 'boxing'; at: V2 }
  /** Đóng thùng xong, bắt đầu bê về kho. */
  | { type: 'boxed'; at: V2 }
  /** Thùng mang tên `name` đã được đặt vào ô `slot` trong kho. */
  | { type: 'stored'; name: string; slot: V2 }
  /** Bắt đầu đêm mới mà không qua phiếu đánh giá (nhảy đêm trong bảng sự kiện). */
  | { type: 'night' }
  /** Chấm công vào ca ở máy chấm công (late: sau hạn). */
  | { type: 'clockIn'; late: boolean }
  /** Thông báo của bảng sự kiện (chỉ để hiện cho người thử). */
  | { type: 'dev'; text: string }
  /** Máy in giao phiếu việc mới / phiếu quá hạn / phiếu đã xong. */
  | { type: 'order'; order: Order }
  | { type: 'orderLate'; order: Order }
  | { type: 'orderDone'; order: Order };

export interface TaskResult { ok: boolean; msg: string; cong?: number; safeCapped?: boolean }

/** Lịch sự kiện trong ca. Chỉnh được trong bảng sự kiện (phím P). */
export interface EventConfig {
  /** Người Kiểm Kê vào ca sau bao nhiêu phút trong game (tính từ 22:00). */
  auditorStart: number;
  /** Hạn chấm công vào ca (phút từ 22:00). Nhân viên bắt đầu ở phòng nghỉ, phải chạy tới máy chấm công trong kho. */
  clockInBy: number;
  /** Phải chấm công vào ca mới được làm việc (tắt để thử nhanh). */
  clockInRequired: boolean;
  /** Có tự mất điện không. */
  blackoutAuto: boolean;
  /** Mất điện từ đêm này trở đi. */
  blackoutFromNight: number;
  /** Mỗi lần mất điện kéo dài bao nhiêu phút trong game (60 phút ≈ 34 giây thật). */
  blackoutMinutes: number;
  /**
   * Số lần mất điện tối đa mỗi đêm. Đêm đầu có mất điện: 1 lần, mỗi đêm sau thêm 1 lần (tới mức tối đa).
   * Các lần cách nhau ít nhất 40 phút trong game.
   */
  blackoutMax: number;
  /** Số phiếu việc mỗi đêm = ordersBase + ordersPerNight × đêm. */
  ordersBase: number;
  ordersPerNight: number;
  /** Nhân hạn của phiếu việc (1 = mặc định, nhỏ hơn = gấp hơn). */
  orderTimeMul: number;
  /** Có phiếu quá hạn thì lúc 06:00 bị bấm 1 lỗ. */
  latePenalty: boolean;
}

/** Chấm công vào ca trễ: trừ chừng này công lúc 06:00. */
export const LATE_IN_PENALTY = 2;

export const DEFAULT_EVENTS: EventConfig = {
  auditorStart: 15,
  clockInBy: 30,
  clockInRequired: true,
  blackoutAuto: true,
  blackoutFromNight: 2,
  blackoutMinutes: 60,
  blackoutMax: 3,
  ordersBase: 3,
  ordersPerNight: 1,
  orderTimeMul: 1,
  latePenalty: true,
};

/** Công tắc để chơi thử. */
export interface DevFlags {
  /** Người Kiểm Kê không nhìn thấy người chơi. */
  invisible: boolean;
  /** Bị đếm đủ 2 giây vẫn không chết (nó thả ra và đi tìm). */
  noDeath: boolean;
}

export interface Blackout { id: number; start: number; end: number }

export interface GameOptions {
  seed?: number;
  events?: Partial<EventConfig>;
  tuning?: Partial<AuditorTuning>;
}

export class Game {
  name: string;
  night = 1;
  holes = 0;
  shift: Shift;
  auditor: Auditor;
  /** carry: đang ôm thùng hàng khô (từ kho), thùng hàng lạnh (từ kho lạnh), hoặc không ôm gì. */
  /** clockedIn: đã chấm công vào ca (chưa chấm thì chưa làm việc được); lateIn: chấm sau hạn. */
  player: { pos: V2; alive: boolean; light: boolean; carry: 'dry' | 'cold' | null; clockedIn: boolean; lateIn: boolean } = {
    pos: { ...PLAYER_SPAWN }, alive: true, light: false, carry: null, clockedIn: false, lateIn: false,
  };
  /** Điện siêu thị. Mất điện từ đêm 2, mỗi đêm sau thêm một lần (xem EventConfig.blackoutMax). */
  power = true;
  /** Lịch mất điện đêm nay (phút trong ca), sắp theo giờ. */
  blackouts: Blackout[] = [];
  private nextBlackoutId = 1;
  /** Mỗi đêm Người Kiểm Kê đi một kiểu lộ trình khác (không lặp lại kiểu của đêm trước). */
  private routeSeed = 0;
  phase: 'shift' | 'eval' | 'dead' | 'done' = 'shift';
  events: GameEvent[] = [];
  eventCfg: EventConfig;
  dev: DevFlags = { invisible: false, noDeath: false };
  /** Thông số Người Kiểm Kê bị ghi đè (áp dụng cho mọi đêm). */
  tuneOverride: Partial<AuditorTuning>;
  /** Số thùng "ĐÃ LƯU KHO" (tính cả thùng của Tuấn có sẵn). */
  storedCount = 1;
  /** Tên người trong thùng Người Kiểm Kê đang bê. */
  private carryingName = '';
  /** Phiếu khen đang giữ (tối đa 1): tự xoá lỗ kế tiếp. */
  voucher = false;
  private rng: () => number;
  /** Ngẫu nhiên riêng cho phiếu việc, để không làm lệch phần còn lại của game. */
  private orderRng: () => number;
  /** Giờ (phút) sẽ giao phiếu việc trong đêm, sắp tăng dần. */
  private orderPlan: number[] = [];
  private nextOrderId = 1;
  private nextLitterId = 1;
  private announced = new Set<string>();

  constructor(name: string, opts: GameOptions | number = {}) {
    const o: GameOptions = typeof opts === 'number' ? { seed: opts } : opts;
    this.name = name;
    const seed = o.seed ?? Date.now();
    this.rng = mulberry32(seed);
    this.orderRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.eventCfg = { ...DEFAULT_EVENTS, ...o.events };
    this.tuneOverride = { ...o.tuning };
    this.shift = new Shift(1, this.rng);
    this.routeSeed = Math.floor(this.rng() * ROUTE_STYLES.length);
    this.auditor = this.makeAuditor();
    this.blackouts = this.planBlackouts();
    this.orderPlan = this.planOrders();
  }

  /** Rải phiếu việc từ 22:30 đến 05:00, không quá dồn. */
  private planOrders(): number[] {
    const c = this.eventCfg;
    const n = Math.max(0, Math.round(c.ordersBase + c.ordersPerNight * this.night));
    const start = 30;
    const end = 420;
    const slot = (end - start) / Math.max(1, n);
    const plan: number[] = [];
    for (let i = 0; i < n; i++) plan.push(start + slot * i + this.orderRng() * slot * 0.8);
    return plan;
  }

  private makeAuditor(): Auditor {
    const a = new Auditor({ ...tuningForNight(this.night), ...this.tuneOverride }, this.rng, this.routeStyle);
    a.storeIndex = this.storedCount;
    return a;
  }

  /** Kiểu lộ trình tuần tra của đêm hiện tại. */
  get routeStyle(): RouteStyle {
    return ROUTE_STYLES[(this.routeSeed + this.night - 1) % ROUTE_STYLES.length];
  }

  /** Lần mất điện đang diễn ra, hoặc lần sắp tới (null nếu đêm nay không còn). */
  get blackout(): Blackout | null {
    const m = this.shift.minutes;
    return this.blackouts.find((b) => b.end > m) ?? null;
  }

  /**
   * Rải các lần mất điện từ 23:00 tới 05:10: chia đều thành từng khoảng, mỗi lần nằm ngẫu nhiên trong khoảng của nó,
   * cách lần trước ít nhất 40 phút.
   */
  private planBlackouts(from = 60): Blackout[] {
    const c = this.eventCfg;
    if (!c.blackoutAuto || this.night < c.blackoutFromNight) return [];
    const n = Math.max(0, Math.min(c.blackoutMax, 1 + this.night - c.blackoutFromNight));
    const end = 430;
    const span = (end - from) / Math.max(1, n);
    const out: Blackout[] = [];
    for (let i = 0; i < n; i++) {
      const lo = Math.max(from + span * i, out.length ? out[out.length - 1].end + 40 : from);
      const hi = from + span * (i + 1) - c.blackoutMinutes;
      if (hi < lo) continue;
      const start = Math.round(lo + this.rng() * (hi - lo));
      out.push({ id: this.nextBlackoutId++, start, end: start + c.blackoutMinutes });
    }
    return out;
  }

  /** Bật/tắt mất điện ngay (phím F6 khi bật F3, hoặc bảng sự kiện). */
  forceBlackout(): void {
    this.devSetPower(!this.power);
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
    // Chấm công vào ca: đứng ở máy chấm công trong kho
    if (!this.player.clockedIn && this.player.alive && inBox(this.player.pos, CLOCK_ZONE)) {
      this.player.clockedIn = true;
      this.player.lateIn = this.shift.minutes > this.eventCfg.clockInBy;
      this.events.push({ type: 'clockIn', late: this.player.lateIn });
    }
    this.schedule();
    this.updateOrders(dt);
    this.auditor.update(dt, this.player.pos, this.player.alive && !this.dev.invisible, this.player.light);
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
  /** Chưa chấm công vào ca thì chưa được làm việc. */
  private notClockedIn(): TaskResult | null {
    return this.player.clockedIn || !this.eventCfg.clockInRequired ? null : { ok: false, msg: 'Chưa chấm công vào ca: tới MÁY CHẤM CÔNG trong KHO trước đã.' };
  }

  scanSection(id: string): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const sec = sectionById(id);
    if (!sec) return { ok: false, msg: 'Không xác định được kệ.' };
    if (this.shift.scanned.has(id)) return { ok: false, msg: `${sec.name}: đã quét trong ca này.` };
    if (this.shift.restockNeeded.has(id))
      return { ok: false, msg: `${sec.name} đang thiếu hàng. Xếp hàng vào trước rồi mới quét.` };
    this.shift.scanned.add(id);
    const recount = this.shift.recount.delete(id);
    if (recount) this.completeOrder((o) => o.kind === 'rescan' && o.section === id);
    return this.credit('scan', recount ? `Kiểm lại xong ${sec.name}` : `Quét xong ${sec.name}`);
  }

  restock(id: string): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const sec = sectionById(id);
    if (!sec) return { ok: false, msg: 'Không xác định được kệ.' };
    if (!this.shift.restockNeeded.has(id)) return { ok: false, msg: `${sec.name} không thiếu hàng.` };
    if (this.player.carry === 'cold') return { ok: false, msg: 'Đây là thùng hàng LẠNH: xếp vào tủ mát / ngăn mát / tủ đông đang hết hàng.' };
    this.shift.restockNeeded.delete(id);
    this.shift.restocked.add(id);
    this.player.carry = null;
    this.completeOrder((o) => o.kind === 'restock' && o.section === id);
    return this.credit('restock', `Xếp hàng xong ${sec.name}`);
  }

  /** Xếp thùng hàng lạnh vào tủ lạnh đang hết hàng. */
  restockCold(id: string): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const u = coldUnitById(id);
    if (!u) return { ok: false, msg: 'Không xác định được tủ.' };
    if (!this.shift.coldNeeded.has(id)) return { ok: false, msg: `${u.name} không hết hàng.` };
    if (this.player.carry === 'dry') return { ok: false, msg: 'Thùng hàng khô không bỏ vào tủ lạnh được. Lấy thùng hàng lạnh ở KHO LẠNH.' };
    this.shift.coldNeeded.delete(id);
    this.shift.coldRestocked.add(id);
    this.player.carry = null;
    this.completeOrder((o) => o.kind === 'coldRestock' && o.section === id);
    return this.credit('coldRestock', `Xếp hàng lạnh xong ${u.name}`);
  }

  /** Có đơn gấp đang chờ giao ở quầy không. */
  get deliveryOpen(): boolean {
    return this.shift.orders.some((o) => o.kind === 'deliver' && !o.done);
  }

  /** Giao thùng đang ôm ở quầy cho đơn gấp (gần hạn nhất). */
  deliver(): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    if (!this.deliveryOpen) return { ok: false, msg: 'Không có đơn gấp nào cần giao.' };
    if (this.player.carry === 'cold') return { ok: false, msg: 'Đơn gấp cần thùng hàng khô từ KHO, không phải thùng hàng lạnh.' };
    this.player.carry = null;
    this.completeOrder((o) => o.kind === 'deliver');
    return this.credit('deliver', 'Giao đơn gấp ở quầy');
  }

  freezer(): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const w = this.shift.freezerWindow();
    if (w === null) return { ok: false, msg: 'Chưa đến giờ ghi nhiệt độ (23:00, 01:00, 03:00, 05:00).' };
    if (this.shift.freezerDone.has(w)) return { ok: false, msg: 'Mốc giờ này đã ghi rồi.' };
    this.shift.freezerDone.add(w);
    return this.credit('freezer', 'Ghi nhiệt độ tủ đông: -18°C');
  }

  /** Lon nước ném ra đã rơi xuống sàn tại `at`: gây tiếng động và nằm đó chờ nhặt. Trả về mã lon. */
  dropLitter(at: V2): number {
    const id = this.nextLitterId++;
    this.shift.litter.push({ id, x: at.x, z: at.z });
    this.shift.stats.cans++;
    this.noise(at, 11, 2);
    return id;
  }

  /** Nhặt lại lon nước. Nhặt cũng hơi ồn (tiếng lon lăn). */
  pickUpLitter(id: number): TaskResult {
    const s = this.shift;
    const i = s.litter.findIndex((l) => l.id === id);
    if (i < 0) return { ok: false, msg: 'Lon này đã được nhặt.' };
    s.litter.splice(i, 1);
    s.litterPicked++;
    this.noise({ ...this.player.pos }, 2, 0.5);
    const left = s.litter.length;
    return { ok: true, msg: left ? `Đã nhặt lại lon nước · còn ${left} lon trên sàn` : 'Đã nhặt lại lon nước · sàn sạch' };
  }

  /** Thả rơi thùng đang ôm (để chạy cho nhanh). Hàng bị trả về đống trong kho. */
  dropBox(): void {
    if (this.player.carry === 'cold') this.shift.coldPile++;
    else this.shift.pile++;
    this.player.carry = null;
    this.shift.stats.drops++;
  }

  takeBox(): boolean {
    if (this.shift.pile <= 0) return false;
    this.shift.pile--;
    this.player.carry = 'dry';
    return true;
  }

  /** Lấy một thùng hàng lạnh (thùng xốp) ở kho lạnh. */
  takeColdBox(): boolean {
    if (this.shift.coldPile <= 0) return false;
    this.shift.coldPile--;
    this.player.carry = 'cold';
    return true;
  }

  // ---- Phiếu việc ----

  /** Giao một phiếu việc mới. Trả về null nếu không tìm được kệ phù hợp. */
  issueOrder(kind: OrderKind): Order | null {
    const s = this.shift;
    const busy = new Set(s.orders.filter((o) => !o.done && o.section).map((o) => o.section!));
    const pick = (list: string[]) => list[Math.floor(this.orderRng() * list.length)];
    let section: string | undefined;
    if (kind === 'rescan') {
      const cands = [...s.scanned].filter((id) => !busy.has(id));
      if (!cands.length) kind = 'restock'; // chưa quét kệ nào thì đổi thành kệ hết hàng
      else section = pick(cands);
    }
    if (kind === 'restock') {
      const cands = SECTIONS.map((x) => x.id).filter((id) => !s.restockNeeded.has(id) && !busy.has(id));
      if (!cands.length) return null;
      section = pick(cands);
    }
    if (kind === 'coldRestock') {
      const cands = COLD_UNITS.map((u) => u.id).filter((id) => !s.coldNeeded.has(id) && !busy.has(id));
      if (!cands.length) return null;
      section = pick(cands);
    }
    const m = s.minutes;
    const o: Order = {
      id: this.nextOrderId++,
      kind,
      section,
      issued: m,
      due: Math.min(SHIFT_MINUTES - 5, m + ORDER_DUE[kind] * this.eventCfg.orderTimeMul),
      done: false,
      late: false,
    };
    // Thay đổi trong siêu thị theo phiếu
    if (kind === 'restock') {
      s.restockNeeded.add(section!);
      s.restockTotal++;
      s.pile++;
    } else if (kind === 'rescan') {
      s.scanned.delete(section!);
      s.recount.add(section!);
    } else if (kind === 'coldRestock') {
      s.coldNeeded.add(section!);
      s.coldTotal++;
      s.coldPile++;
    } else {
      s.pile++;
    }
    s.orders.push(o);
    this.events.push({ type: 'order', order: o });
    const sec = section ? sectionById(section) : undefined;
    const what =
      kind === 'restock' ? `kệ ${spoken(sec!)} vừa hết hàng, xếp hàng vào`
      : kind === 'rescan' ? `kiểm lại kệ ${spoken(sec!)}, số liệu không khớp`
      : kind === 'coldRestock' ? `${coldUnitById(section!)!.name.toLowerCase()} vừa hết hàng, lấy thùng hàng lạnh ở kho lạnh`
      : 'đơn gấp, mang một thùng hàng từ kho ra quầy';
    this.announce(`Phiếu việc cho nhân viên ${this.name}: ${what}. Hạn ${clockVi(o.due)}.`);
    return o;
  }

  private completeOrder(match: (o: Order) => boolean): void {
    const o = this.shift.openOrders.find(match);
    if (!o) return;
    o.done = true;
    this.shift.drift = Math.max(0, this.shift.drift - DRIFT.onDone);
    this.events.push({ type: 'orderDone', order: o });
  }

  /** Giao phiếu theo lịch, đánh dấu quá hạn, cập nhật độ lệch sổ. */
  private updateOrders(dt: number): void {
    const s = this.shift;
    while (this.orderPlan.length && s.minutes >= this.orderPlan[0]) {
      const at = this.orderPlan.shift()!;
      // Tua giờ vượt qua lúc giao (bảng sự kiện) hoặc quá sát 06:00: bỏ phiếu đó, không giao dồn
      if (s.minutes - at > 20 || s.minutes > SHIFT_MINUTES - 30) continue;
      const r = this.orderRng();
      this.issueOrder(r < 0.3 ? 'restock' : r < 0.55 ? 'coldRestock' : r < 0.8 ? 'rescan' : 'deliver');
    }
    let late = 0;
    for (const o of s.orders) {
      if (o.done) continue;
      if (!o.late && s.minutes > o.due) {
        o.late = true;
        this.events.push({ type: 'orderLate', order: o });
        this.announce(`Phiếu việc quá hạn: ${orderText(o).toLowerCase().replace(/ · /g, ', ')}. Đã ghi vào hồ sơ nhân viên ${this.name}.`);
      }
      if (o.late) late++;
    }
    // Kệ và tủ lạnh để trống làm sổ lệch dần; lon nước để lại chỉ bị trừ công, không làm lệch sổ
    const rise = late * DRIFT.perLate + (s.restockNeeded.size + s.coldNeeded.size) * DRIFT.perEmpty;
    s.drift = Math.max(0, Math.min(1, s.drift + (rise > 0 ? rise : -DRIFT.decay) * dt));
    this.auditor.drift = s.drift;
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
      this.announce(
        `Ca đêm thứ ${numberVi(this.night)} bắt đầu. Nhân viên chấm công vào ca tại máy chấm công trong kho trước ${clockOf(this.eventCfg.clockInBy).replace(':', ' giờ ')}.`,
      ),
    );
    this.once('lateIn', m >= this.eventCfg.clockInBy && !this.player.clockedIn && this.eventCfg.clockInRequired, () =>
      this.announce(`Nhân viên ${this.name} chưa chấm công vào ca. Ghi nhận: đi trễ.`),
    );
    this.once('auditor', m >= this.eventCfg.auditorStart, () => {
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
    this.blackouts.forEach((b, i) => {
      this.once(`bo_off_${b.id}`, m >= b.start && m < b.end, () => {
        this.setPower(false);
        this.announce(
          i === 0
            ? 'Sự cố mất điện. Nhân viên tiếp tục làm việc bằng đèn pin. Thời gian mất điện vẫn tính là giờ làm.'
            : 'Sự cố mất điện lần nữa. Nhân viên tiếp tục làm việc.',
        );
      });
      this.once(`bo_on_${b.id}`, m >= b.end, () => {
        if (!this.power) {
          this.setPower(true);
          this.announce('Điện đã có lại. Cảm ơn nhân viên đã không nghỉ.');
        }
      });
    });
    this.once('rollcall', m >= 450, () => this.announce('Còn ba mươi phút đến điểm danh. Nhân viên chấm công tại máy chấm công trong kho.'));
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
          if (this.dev.noDeath) {
            this.auditor.release();
            this.events.push({ type: 'lost' });
            this.events.push({ type: 'dev', text: 'Bị đếm đủ 2 giây · đang bật KHÔNG CHẾT nên được tha' });
          } else {
            this.carryingName = this.name;
            this.die('scan');
          }
          break;
        case 'boxing':
          this.events.push({ type: 'boxing', at: e.at });
          break;
        case 'boxed':
          this.events.push({ type: 'boxed', at: e.at });
          break;
        case 'stored':
          this.events.push({ type: 'stored', name: this.carryingName, slot: e.at });
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
    // Giữ một ô trong kho cho thùng mang tên người này
    const slot = storageSlot(this.storedCount);
    this.storedCount++;
    this.auditor.storeIndex = this.storedCount;
    this.events.push({ type: 'dead', reason, slot });
  }

  private endShift(): void {
    const s = this.shift;
    const atClock = inBox(this.player.pos, CLOCK_ZONE);
    const reasons: string[] = [];
    let add = 0;
    // Lon nước để lại trên sàn: trừ công trước khi xét chỉ tiêu
    const litterLeft = s.litter.length;
    const litterPenalty = litterLeft * LITTER_PENALTY;
    // Chấm công vào ca trễ (hoặc không chấm): trừ công
    const lateIn = this.eventCfg.clockInRequired && (!this.player.clockedIn || this.player.lateIn);
    const lateInPenalty = lateIn ? LATE_IN_PENALTY : 0;
    const cong = Math.max(0, s.cong - litterPenalty - lateInPenalty);
    if (cong < s.quota) {
      add++;
      reasons.push(
        litterPenalty > 0 && s.cong >= s.quota
          ? `Không đủ chỉ tiêu sau khi trừ ${litterPenalty} công vì ${litterLeft} lon nước để lại trên sàn (${cong}/${s.quota}).`
          : `Không đủ chỉ tiêu (${cong}/${s.quota} công).`,
      );
    }
    if (!atClock) {
      add++;
      reasons.push('Không chấm công lúc 06:00 (máy chấm công trong kho).');
    }
    const late = s.lateCount;
    if (late > 0 && this.eventCfg.latePenalty) {
      add++;
      reasons.push(`Trễ hạn ${late} phiếu việc được giao.`);
    }
    // Phiếu khen: dùng phiếu đang giữ để xoá một lỗ, rồi mới xét phiếu mới
    let voucherUsed = false;
    if (add > 0 && this.voucher) {
      add--;
      this.voucher = false;
      voucherUsed = true;
    }
    const voucherEarned = cong >= Math.ceil(s.quota * 1.5) && !this.voucher;
    if (voucherEarned) this.voucher = true;
    this.holes = Math.min(MAX_HOLES, this.holes + add);
    const dead = this.holes >= MAX_HOLES;
    const final = !dead && this.night >= MAX_NIGHTS;
    const ev: Evaluation = {
      night: this.night,
      cong,
      congBeforeLitter: s.cong,
      litterLeft,
      litterPenalty,
      lateIn,
      lateInPenalty,
      quota: s.quota,
      safeEarned: s.earnedSafe,
      safeCap: s.safeCap,
      atClock,
      holesAdded: add,
      holesTotal: this.holes,
      reasons,
      notes: this.notes(),
      dead,
      final,
      ordersTotal: s.orders.length,
      ordersDone: s.orders.filter((o) => o.done).length,
      late,
      voucherEarned,
      voucherUsed,
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
    if (this.player.lateIn) n.push('Chấm công vào ca trễ. Phòng nghỉ không phải chỗ ngủ.');
    if (st.seen >= 2) n.push(`Bị kiểm kê viên quét trúng ${st.seen} lần nhưng vẫn còn ở đây. Đáng ngờ.`);
    if (this.shift.cong >= this.shift.quota * 1.5) n.push('Nhân viên có dấu hiệu chăm chỉ bất thường.');
    const d = Math.round(this.shift.drift * 100);
    if (d >= 30) n.push(`Sổ sách cuối ca lệch ${d}%. Đèn khu bán hàng đã được tắt bớt cho đỡ tốn điện.`);
    if (this.shift.cong >= this.shift.quota && this.shift.lateCount > 0)
      n.push('Đủ chỉ tiêu không có nghĩa là xong việc.');
    if (!n.length) n.push('Không có gì để nhận xét.');
    return n;
  }

  nextNight(): void {
    this.night++;
    this.shift = new Shift(this.night, this.rng);
    this.auditor = this.makeAuditor();
    this.player.pos = { ...PLAYER_SPAWN };
    this.player.alive = true;
    this.player.carry = null;
    this.player.clockedIn = false;
    this.player.lateIn = false;
    this.phase = 'shift';
    this.announced.clear();
    this.power = true;
    this.blackouts = this.planBlackouts();
    this.orderPlan = this.planOrders();
  }

  // ---- Bảng sự kiện: điều khiển tay để chơi thử ----

  private devNote(text: string): void {
    this.events.push({ type: 'dev', text });
  }

  /** Giao ngay một phiếu việc. */
  devOrder(kind: OrderKind): void {
    if (this.phase !== 'shift') return;
    if (!this.issueOrder(kind)) this.devNote('Không còn kệ phù hợp để giao phiếu này');
  }

  devSetDrift(v: number): void {
    this.shift.drift = Math.max(0, Math.min(1, v));
    this.auditor.drift = this.shift.drift;
  }

  /** Mất điện ngay (on = false) hoặc có điện lại ngay (on = true). */
  devSetPower(on: boolean): void {
    if (this.power === on) return;
    const m = this.shift.minutes;
    if (on) {
      // Kết thúc lần mất điện đang diễn ra ngay bây giờ
      const cur = this.blackouts.find((b) => b.start <= m && b.end > m);
      if (cur) cur.end = m;
      else this.setPower(true);
    } else {
      // Mất điện ngay; bỏ các lần sắp tới bị chồng lên
      const b: Blackout = { id: this.nextBlackoutId++, start: m, end: m + this.eventCfg.blackoutMinutes };
      this.blackouts = [...this.blackouts.filter((x) => x.end <= m || x.start >= b.end + 40), b].sort((x, y) => x.start - y.start);
    }
  }

  /** Gọi Người Kiểm Kê vào ca ngay, không chờ tới giờ. */
  devAuditorNow(): void {
    if (this.auditor.state !== 'idle') return this.devNote('Người Kiểm Kê đang làm việc rồi');
    this.announced.add('auditor');
    this.auditor.activate();
    this.announce('Kiểm kê viên bắt đầu làm việc. Không để kiểm kê viên kiểm đếm nhân viên.');
  }

  /** Cho Người Kiểm Kê về văn phòng đứng chờ (đến khi gọi lại). */
  devAuditorRest(): void {
    this.announced.add('auditor'); // không tự vào lại theo lịch
    this.auditor.retire();
    this.devNote('Người Kiểm Kê đã về văn phòng. Bấm "Gọi vào ngay" để gọi lại.');
  }

  /** Dụ Người Kiểm Kê tới một điểm (như nghe thấy tiếng động rất to ở đó). */
  devLure(at: V2): void {
    if (this.auditor.state === 'idle') this.devAuditorNow();
    if (this.auditor.state === 'count' || this.auditor.capturing) return;
    if (this.auditor.hear(at, 1000, 1.2)) this.devNote('Người Kiểm Kê nghe thấy tiếng động chỗ bạn');
  }

  /** Tua thời gian ca làm (phút trong game). Loa và sự kiện bị bỏ qua sẽ chạy bù ngay. */
  devSkip(minutes: number): void {
    if (this.phase !== 'shift') return;
    this.shift.minutes = Math.min(SHIFT_MINUTES, Math.max(0, this.shift.minutes + minutes));
  }

  /** Tua tới mốc ghi nhiệt độ tủ đông kế tiếp. */
  devSkipToFreezer(): void {
    const t = this.shift.nextFreezer();
    if (t === null) return this.devNote('Đã hết mốc ghi nhiệt độ trong ca này');
    if (this.shift.minutes < t) this.shift.minutes = t + 0.5;
  }

  /** Bắt đầu lại từ đầu đêm n (giữ số lỗ trên thẻ). */
  devGoNight(n: number): void {
    this.night = Math.max(1, Math.min(MAX_NIGHTS, Math.round(n))) - 1;
    this.nextNight();
    this.events.push({ type: 'night' });
  }

  devAddCong(n: number): void {
    this.shift.earnedRisk += n;
  }

  devSetHoles(n: number): void {
    this.holes = Math.max(0, Math.min(MAX_HOLES - 1, Math.round(n)));
  }

  devAnnounce(text: string): void {
    if (text.trim()) this.announce(text.trim());
  }

  /** Đổi lịch sự kiện. Lịch mất điện của đêm này được tính lại nếu chưa mất điện. */
  setEventConfig(cfg: Partial<EventConfig>): void {
    this.eventCfg = { ...this.eventCfg, ...cfg };
    // Giữ các lần đã bắt đầu (lần đang mất điện thì đổi độ dài), lên lịch lại các lần chưa tới
    const m = this.shift.minutes;
    const started = this.blackouts.filter((b) => b.start <= m);
    for (const b of started) if (b.end > m) b.end = Math.max(m, b.start + this.eventCfg.blackoutMinutes);
    const last = started.length ? started[started.length - 1].end + 40 : Math.max(60, m);
    const want = this.planBlackouts(Math.max(60, m, last));
    const total = this.eventCfg.blackoutAuto && this.night >= this.eventCfg.blackoutFromNight
      ? Math.min(this.eventCfg.blackoutMax, 1 + this.night - this.eventCfg.blackoutFromNight)
      : 0;
    this.blackouts = [...started, ...want.slice(0, Math.max(0, total - started.length))];
  }

  /** Ghi đè thông số Người Kiểm Kê (có hiệu lực ngay và cho các đêm sau). */
  setTuning(t: Partial<AuditorTuning>): void {
    this.tuneOverride = { ...this.tuneOverride, ...t };
    Object.assign(this.auditor.tune, t);
  }

  /** Bỏ hết ghi đè, quay về thông số mặc định của đêm hiện tại. */
  resetTuning(): void {
    this.tuneOverride = {};
    Object.assign(this.auditor.tune, tuningForNight(this.night));
  }
}
