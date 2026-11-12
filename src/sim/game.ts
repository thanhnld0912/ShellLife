// Lõi game: giữ toàn bộ "sự thật" của ca làm việc. Không phụ thuộc Three.js,
// để sau này chuyển lên server cho chế độ nhiều người.

import type { V2 } from './geometry.ts';
import { inBox, inflate } from './geometry.ts';
import { Auditor, ROUTE_STYLES, tuningForNight, type AuditorTuning, type RouteStyle } from './auditor.ts';
import {
  BULKY_GAP, CART_MAX_BAGS, CART_MAX_BOXES, DEFECT_DRIFT_FROM, DRIFT, EAT_RECORD_OVER, FREEZER_TIMES, FREEZER_WINDOW, HAND_MAX_BAGS, HEAVY_GAP, HEAVY_ORDERS,
  LITTER_FEE, ORDER_DUE, REAL_PER_MIN, RECORDS_PER_HOLE, SHIFT_MINUTES, Shift, WAGE_PER_NIGHT, clockOf, jobText,
  type Bulky, type Cart, type Job, type JobKind, type Order, type OrderKind,
} from './shift.ts';
import { DEFECT_TEXT, slotByKey, type DefectKind } from './shelfGoods.ts';
import { formatPrice, productById, type ProductId } from './products.ts';
import {
  BULKY_SIZE, BULKY_SPOT, CART_SIZE, CLOCK_ZONE, COLD_UNITS, PLAYER_SPAWN, PROMO_SLOTS, PROMO_ZONE, SECTIONS, TRASH_BINS,
  coldUnitById, sectionById, storageSlot, type Section,
} from './layout.ts';
import { mulberry32, shuffle } from './rng.ts';
import { numberVi } from './vi.ts';

export const MAX_NIGHTS = 5;
export const MAX_HOLES = 3;

export interface Evaluation {
  night: number;
  /** Có mặt ở máy chấm công (trong kho, cạnh cửa nhân viên) lúc 06:00. */
  atClock: boolean;
  holesAdded: number;
  holesTotal: number;
  reasons: string[];
  notes: string[];
  dead: boolean;
  final: boolean;
  /** Việc được giao: tổng, đã xong, mô tả các việc còn bỏ dở. */
  jobsTotal: number;
  jobsDone: number;
  jobsLeft: string[];
  /** Phiếu việc phát sinh: tổng đã giao, đã xong, quá hạn (kể cả chưa làm). */
  ordersTotal: number;
  ordersDone: number;
  late: number;
  /** Ghi hồ sơ đêm nay (lý do), tổng đang tích (sau khi quy đổi ra lỗ), số lỗ do đủ 3 lần ghi. */
  records: string[];
  recordsTotal: number;
  recordHoles: number;
  /** Xong hết việc, không trễ phiếu nào, không bị ghi hồ sơ, có mặt 06:00: nhận phiếu khen (xoá lỗ kế tiếp). */
  voucherEarned: boolean;
  /** Phiếu khen đã dùng để xoá một lỗ trong phiếu đánh giá này. */
  voucherUsed: boolean;
  /** Lương đêm nay: lương gốc, trừ ăn hàng, trừ phí dọn lon nước, còn lại. */
  wageBase: number;
  wage: number;
  litterLeft: number;
  litterFee: number;
  /** Chấm công vào ca trễ (sau hạn đầu ca): bị ghi hồ sơ. */
  lateIn: boolean;
  /** Ăn / uống hàng trên kệ: số món, tổng tiền (đồng, trừ vào lương), số món lỗi đã ăn. */
  eatenCount: number;
  eatenValue: number;
  ateBad: number;
  /** Hàng lỗi: tổng đầu ca, đã bỏ vào thùng HÀNG LỖI, còn trên kệ lúc 06:00. */
  defectsTotal: number;
  defectsRemoved: number;
  defectsLeft: number;
}

/** Tủ điện tổng: các cầu dao (tên mạch). Mỗi lần mất điện, vị trí cầu dao và thứ tự bật trên sơ đồ đổi khác. */
export const BREAKER_NAMES = ['KHO LẠNH', 'TỦ MÁT', 'ĐÈN KHU A', 'ĐÈN KHU B', 'QUẦY THU NGÂN', 'KHO'];
export interface BreakerPanel {
  /** Tên mạch ở từng vị trí cầu dao (trái → phải). */
  slots: string[];
  /** Thứ tự bật đúng theo sơ đồ dán trong cửa tủ (tên mạch). */
  order: string[];
  /** Đã bật đúng bao nhiêu cầu dao. */
  next: number;
  /** Vị trí đang bật (để vẽ). */
  on: boolean[];
}

/** Đang cầm trên tay một món lấy từ kệ (key = mã ô hàng). */
export interface Held {
  key: string;
  product: ProductId;
  defect: DefectKind | null;
}

/** Thể lực (0..1): chạy làm tụt, đứng / đi thì hồi chậm, ăn uống hồi nhanh. Cạn thì không chạy được tới khi hồi lại mức recoverAt. */
export const STAMINA = { drainPerSec: 1 / 14, regenPerSec: 1 / 75, recoverAt: 0.25 };
/** Ăn phải hàng lỗi: đau bụng (đi chậm, thỉnh thoảng rên thành tiếng) và chóng mặt (màn hình mờ, chao đảo). Giây thật. */
export const SICK_SECONDS = 40;
export const DIZZY_SECONDS = 22;
export const SICK_SPEED = 0.65;
/** Đẩy xe: tốc độ (m/s) khi xe trống / chở thùng hoặc rác / chở kiện hàng; bánh xe lạch cạch mỗi rattleEvery giây. */
export const CART_MOVE = {
  empty: 2.0, loaded: 1.8, bulky: 1.35, sneakMul: 0.65,
  rattle: 4, rattleBulky: 6, rattleEvery: 1.0,
  /** Tâm xe cách người đẩy bao xa (m). */
  reach: CART_SIZE.len / 2 + 0.4,
};

/**
 * Kiện hàng cồng kềnh: 1 người thì kéo lê (rất chậm, kêu ken két mỗi soloNoiseEvery giây, nghe xa soloNoise m),
 * 2 người thì khiêng (đi được bằng ôm thùng, chỉ lạch cạch nhẹ). Đi rón rén (giữ C): chậm hơn nhưng nhỏ tiếng hơn.
 * Không chạy được khi đang khiêng / kéo.
 */
export const BULKY_MOVE = {
  soloSpeed: 0.8, duoSpeed: 1.6, sneakMul: 0.7,
  soloNoise: 9, soloNoiseSneak: 5, soloNoiseEvery: 0.8,
  duoNoise: 3, duoNoiseEvery: 1.2,
  /** Tâm kiện cách người cầm đầu này bao xa (m). */
  reach: BULKY_SIZE.len / 2 + 0.35,
};
/** Đi rón rén (giữ C): tốc độ đi bộ nhân thêm hệ số này. */
export const SNEAK_MUL = 0.55;

/** Mô tả phiếu việc (để hiện chữ). */
export function orderText(o: Order): string {
  const sec = o.section ? sectionById(o.section) : undefined;
  if (o.kind === 'restock') return `Xếp hàng ${sec?.name ?? ''}`;
  if (o.kind === 'rescan') return `Kiểm lại ${sec?.name ?? ''}`;
  if (o.kind === 'coldRestock') return `Xếp hàng lạnh vào ${coldUnitById(o.section ?? '')?.name ?? ''}`;
  if (o.kind === 'bulky') return 'Đưa KIỆN NƯỚC từ kho ra ĐẢO KHUYẾN MÃI (2 người khiêng / xe đẩy hàng)';
  if (o.kind === 'power') return 'MẤT ĐIỆN: bật lại cầu dao ở tủ điện, PHÒNG ĐIỆN';
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
  | { type: 'orderDone'; order: Order }
  /** Đau bụng: rên / ợ thành tiếng ở vị trí người chơi. */
  | { type: 'groan'; at: V2 }
  /** Kiện hàng cồng kềnh: kéo lê ken két trên sàn / bị thả phịch xuống. */
  | { type: 'scrape'; at: V2 }
  | { type: 'thud'; at: V2 }
  /** Xe đẩy lạch cạch khi đang đẩy. */
  | { type: 'rattle'; at: V2; load: number }
  /** Tủ điện: bật đúng một cầu dao / bật sai (tóe lửa, ồn, phải làm lại từ đầu) / có điện lại. */
  | { type: 'breaker'; ok: boolean; at: V2 }
  /** Gom / đổ rác. */
  | { type: 'trash'; at: V2; dumped: boolean };

/** job: vừa xong một việc được giao · order: vừa xong một phiếu việc phát sinh · defects: số hàng lỗi máy quét báo. */
export interface TaskResult { ok: boolean; msg: string; job?: boolean; order?: boolean; defects?: number }

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
  /** Phiếu việc phát sinh trễ hạn thì bị ghi hồ sơ (3 lần ghi = 1 lỗ thẻ). */
  latePenalty: boolean;
  /** Mất điện thì phải tự bật lại cầu dao ở PHÒNG ĐIỆN (tắt: tự có điện lại sau blackoutMinutes như cũ). */
  powerFix: boolean;
}

export const DEFAULT_EVENTS: EventConfig = {
  auditorStart: 15,
  clockInBy: 30,
  clockInRequired: true,
  blackoutAuto: true,
  blackoutFromNight: 2,
  blackoutMinutes: 60,
  blackoutMax: 3,
  ordersBase: 1,
  ordersPerNight: 1,
  orderTimeMul: 1,
  latePenalty: true,
  powerFix: true,
};

/** Công tắc để chơi thử. */
export interface DevFlags {
  /** Người Kiểm Kê không nhìn thấy người chơi. */
  invisible: boolean;
  /** Bị đếm đủ 2 giây vẫn không chết (nó thả ra và đi tìm). */
  noDeath: boolean;
  /** Đồng nghiệp ảo đi theo (giả làm người chơi thứ 2, chỉ ở máy này): bắt chước động tác, phụ khiêng kiện hàng. */
  helper: boolean;
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
  /** stamina: thể lực 0..1 · exhausted: vừa cạn thể lực (chưa chạy lại được) · hand: món đang cầm từ kệ. */
  /** sick / dizzy: còn bao nhiêu giây đau bụng / chóng mặt (ăn phải hàng lỗi). */
  /** yaw: hướng nhìn (hướng tới = (sin yaw, cos yaw)) · sneak: đang đi rón rén (giữ C) · sheet: đang xem phiếu việc (Tab). */
  /** bulky: mã kiện hàng đang khiêng / kéo. (yaw, sneak, sheet sau này gửi cho người chơi khác để hiện đúng động tác.) */
  /** cart: mã xe đang đẩy · bags: số túi rác đang xách tay (tối đa 2). */
  player: {
    pos: V2; alive: boolean; light: boolean; carry: 'dry' | 'cold' | null; clockedIn: boolean; lateIn: boolean;
    stamina: number; exhausted: boolean; hand: Held | null; sick: number; dizzy: number;
    yaw: number; sneak: boolean; sheet: boolean; bulky: number | null; cart: number | null; bags: number;
  } = {
    pos: { ...PLAYER_SPAWN }, alive: true, light: false, carry: null, clockedIn: false, lateIn: false,
    stamina: 1, exhausted: false, hand: null, sick: 0, dizzy: 0,
    yaw: 0, sneak: false, sheet: false, bulky: null, cart: null, bags: 0,
  };
  /** Số lần bị ghi hồ sơ đang tích (chưa đủ 3 để quy ra lỗ), cộng dồn qua các đêm. */
  records = 0;
  /** Ghi hồ sơ trong đêm nay (lý do). */
  private nightRecords: string[] = [];
  /** Lương từng đêm đã nhận (đồng). */
  wages: number[] = [];
  /** Tủ điện khi đang mất điện (sơ đồ cầu dao); null khi có điện. */
  breaker: BreakerPanel | null = null;
  private cartNoiseT = 0;
  /** Giờ (phút) giao phiếu việc nặng gần nhất (để giãn cách). */
  private lastHeavyAt = -999;
  /** Đếm ngược tới lần kêu ken két / lạch cạch kế tiếp của kiện hàng đang khiêng. */
  private bulkyNoiseT = 0;
  private nextBulkyId = 1;
  /** Đếm ngược tới lần rên kế tiếp khi đang đau bụng. */
  private groanT = 0;
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
  dev: DevFlags = { invisible: false, noDeath: false, helper: false };
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
      // Khoảng còn lại quá hẹp thì đặt sát sau lần trước (miễn còn kịp trước 05:10)
      const start = hi < lo ? Math.round(lo) : Math.round(lo + this.rng() * (hi - lo));
      if (start + c.blackoutMinutes > end + 20) continue;
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
    if (on) {
      this.breaker = null;
      this.completeOrder((o) => o.kind === 'power');
    } else {
      // Sơ đồ mới mỗi lần mất điện: cầu dao xếp lộn xộn, thứ tự bật cũng khác
      const names = [...BREAKER_NAMES];
      this.breaker = { slots: shuffle([...names], this.orderRng), order: shuffle([...names], this.orderRng), next: 0, on: names.map(() => false) };
    }
  }

  // ---- Sửa điện: tủ điện tổng ở PHÒNG ĐIỆN ----

  /**
   * Bật cầu dao ở vị trí i. Phải bật đúng thứ tự trên sơ đồ dán trong cửa tủ (tên mạch); bật sai thì tóe lửa (ồn),
   * tất cả cầu dao nhảy về tắt, làm lại từ đầu. Bật đủ thì gạt CẦU DAO TỔNG (mainSwitch) để có điện.
   */
  flipBreaker(i: number): TaskResult {
    const b = this.breaker;
    if (!b || this.power) return { ok: false, msg: 'Đang có điện.' };
    if (b.on[i]) return { ok: false, msg: '' };
    const at = { ...this.player.pos };
    if (b.slots[i] === b.order[b.next]) {
      b.on[i] = true;
      b.next++;
      this.events.push({ type: 'breaker', ok: true, at });
      return { ok: true, msg: b.next >= b.order.length ? 'Đủ cầu dao nhánh: gạt CẦU DAO TỔNG' : `Bật ${b.slots[i]} (${b.next}/${b.order.length})` };
    }
    // Sai: tóe lửa, nhảy hết
    b.next = 0;
    b.on = b.on.map(() => false);
    this.shift.stats.sparks++;
    this.events.push({ type: 'breaker', ok: false, at });
    this.noise(at, 10, 2);
    return { ok: false, msg: `Sai thứ tự! ${b.slots[i]} chưa tới lượt: tóe lửa, nhảy hết cầu dao. Xem lại sơ đồ.` };
  }

  /** Gạt cầu dao tổng: chỉ được khi đã bật đủ cầu dao nhánh đúng thứ tự. */
  mainSwitch(): TaskResult {
    const b = this.breaker;
    if (!b || this.power) return { ok: false, msg: '' };
    if (b.next < b.order.length) {
      this.noise({ ...this.player.pos }, 6, 1.5);
      this.events.push({ type: 'breaker', ok: false, at: { ...this.player.pos } });
      return { ok: false, msg: 'Chưa bật đủ cầu dao nhánh: cầu dao tổng nhảy lại.' };
    }
    const late = this.shift.orders.find((o) => o.kind === 'power' && !o.done)?.late ?? false;
    this.setPower(true);
    this.announce('Điện đã có lại. Cảm ơn nhân viên đã sửa.');
    return { ok: true, msg: late ? 'Có điện lại (trễ hạn phiếu sửa điện).' : 'Có điện lại!', order: true };
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

  reportMotion(dt: number, moving: boolean, running: boolean, sneaking = false): void {
    if (this.phase !== 'shift') return;
    this.player.sneak = sneaking;
    this.updateBulky(dt, moving);
    this.updateCart(dt, moving);
    if (!moving) this.shift.stats.idleSec += dt;
    if (running) this.shift.stats.runSec += dt;
    const pl = this.player;
    // Thể lực: chạy thì tụt, không chạy thì hồi chậm
    if (running) pl.stamina = Math.max(0, pl.stamina - STAMINA.drainPerSec * dt);
    else pl.stamina = Math.min(1, pl.stamina + STAMINA.regenPerSec * dt);
    if (pl.stamina <= 0) pl.exhausted = true;
    else if (pl.exhausted && pl.stamina >= STAMINA.recoverAt) pl.exhausted = false;
    // Ăn phải hàng lỗi
    pl.dizzy = Math.max(0, pl.dizzy - dt);
    if (pl.sick > 0) {
      pl.sick = Math.max(0, pl.sick - dt);
      this.groanT -= dt;
      if (this.groanT <= 0 && pl.sick > 0) {
        this.groanT = 6 + this.rng() * 5;
        this.events.push({ type: 'groan', at: { ...pl.pos } });
        this.noise({ ...pl.pos }, 9, 2);
      }
    }
  }

  /** Còn chạy được không (cạn thể lực thì phải đợi hồi lại một ít). */
  get canRun(): boolean {
    return !this.player.exhausted;
  }

  /** Hệ số tốc độ di chuyển (đau bụng thì đi chậm). */
  get speedMul(): number {
    return this.player.sick > 0 ? SICK_SPEED : 1;
  }

  // ---- Kiện hàng cồng kềnh (2 người khiêng) ----

  /** Kiện người chơi đang khiêng / kéo. */
  get heldBulky(): Bulky | null {
    const id = this.player.bulky;
    return id === null ? null : this.shift.bulky.find((b) => b.id === id) ?? null;
  }

  /**
   * Tốc độ tối đa khi đang khiêng (null: không khiêng gì, đi như thường). Một người: kéo lê 0,8 m/s; hai người: 1,6 m/s.
   * Không chạy được.
   */
  get bulkySpeed(): number | null {
    const b = this.heldBulky;
    if (!b) return null;
    const v = b.carriers.length >= 2 ? BULKY_MOVE.duoSpeed : BULKY_MOVE.soloSpeed;
    return v * (this.player.sneak ? BULKY_MOVE.sneakMul : 1) * this.speedMul;
  }

  /** Trần tốc độ khi đang khiêng kiện / đẩy xe (null: đi như thường). Không chạy được khi có trần. */
  get carrySpeed(): number | null {
    const b = this.bulkySpeed;
    if (b !== null) return b;
    const c = this.heldCart;
    if (!c) return null;
    const v = c.bulky !== null ? CART_MOVE.bulky : c.boxes || c.bags ? CART_MOVE.loaded : CART_MOVE.empty;
    return v * (this.player.sneak ? CART_MOVE.sneakMul : 1) * this.speedMul;
  }

  /** Đang bận tay (ôm thùng, cầm hàng, khiêng kiện, đẩy xe, xách rác) thì không lấy thêm gì được. */
  private busyMsg(except: 'cart' | 'bags' | null = null): string | null {
    const pl = this.player;
    if (pl.carry) return 'Đang ôm thùng: làm xong (hoặc thả thùng [G]) trước đã.';
    if (pl.hand) return 'Đang cầm món hàng: đặt lại kệ hoặc ăn / uống trước đã.';
    if (pl.bulky !== null) return 'Đang khiêng kiện hàng.';
    if (pl.cart !== null && except !== 'cart') return 'Đang đẩy xe: buông xe [G] trước đã.';
    if (pl.bags > 0 && except !== 'bags') return 'Đang xách túi rác: đổ vào THÙNG RÁC LỚN trong kho trước đã.';
    return null;
  }

  /** Cầm một đầu kiện hàng. who: 'p1' = người chơi này; người khác (sau này qua mạng, hoặc đồng nghiệp ảo) cầm đầu kia. */
  grabBulky(id: number, who = 'p1'): TaskResult {
    const b = this.shift.bulky.find((x) => x.id === id);
    if (!b || b.done) return { ok: false, msg: '' };
    if (b.carriers.includes(who)) return { ok: false, msg: '' };
    if (b.carriers.length >= 2) return { ok: false, msg: 'Kiện này đã đủ 2 người khiêng.' };
    if (who === 'p1') {
      if (this.player.bulky !== null) return { ok: false, msg: '' };
      const busy = this.busyMsg();
      if (busy) return { ok: false, msg: busy };
      this.player.bulky = id;
    }
    // Đang nằm trên xe đẩy: nhấc khỏi xe
    if (b.cart !== null) {
      const c = this.shift.carts.find((x) => x.id === b.cart);
      if (c) c.bulky = null;
      b.cart = null;
    }
    b.carriers.push(who);
    this.bulkyNoiseT = 0.3;
    return {
      ok: true,
      msg: b.carriers.length >= 2
        ? 'Hai người khiêng: đi được bình thường, chỉ lạch cạch nhẹ.'
        : 'Kéo lê một mình: rất chậm và kêu ken két (Người Kiểm Kê nghe xa). Cần một người cầm đầu kia.',
    };
  }

  /** Buông tay khỏi kiện hàng. Không còn ai khiêng thì kiện rơi phịch xuống (ồn), nằm lại chỗ đó. */
  releaseBulky(who = 'p1'): void {
    const b = who === 'p1' ? this.heldBulky : this.shift.bulky.find((x) => x.carriers.includes(who));
    if (!b) return;
    b.carriers = b.carriers.filter((c) => c !== who);
    if (who === 'p1') this.player.bulky = null;
    if (!b.carriers.length && !b.done && this.phase === 'shift') {
      this.events.push({ type: 'thud', at: { ...b.pos } });
      this.noise({ ...b.pos }, 8, 1.5);
    }
  }

  /** Đặt kiện hàng ở ĐẢO KHUYẾN MÃI (kiện phải nằm trong khu đó): kiện đang khiêng, hoặc kiện trên xe đang đẩy. */
  placeBulky(): TaskResult {
    const c = this.heldCart;
    const b = this.heldBulky ?? (c && c.bulky !== null ? this.shift.bulky.find((x) => x.id === c.bulky) ?? null : null);
    if (!b) return { ok: false, msg: '' };
    if (b.cart !== null && c) {
      c.bulky = null;
      b.cart = null;
    }
    if (!inBox(b.pos, inflate(PROMO_ZONE, 0.7))) return { ok: false, msg: 'Khiêng kiện nước ra ĐẢO KHUYẾN MÃI (sát mặt kính, giữa siêu thị) rồi mới đặt.' };
    const n = this.shift.bulky.filter((x) => x.done).length;
    b.done = true;
    b.carriers = [];
    b.pos = { ...PROMO_SLOTS[n % PROMO_SLOTS.length] };
    b.yaw = Math.PI / 2;
    this.player.bulky = null;
    this.noise({ ...b.pos }, 4, 1);
    this.completeOrder((o) => o.kind === 'bulky');
    return { ok: true, msg: 'Đã đặt kiện nước ở ĐẢO KHUYẾN MÃI', order: true };
  }

  // ---- Xe đẩy hàng / xe gom rác ----

  /** Xe đang đẩy. */
  get heldCart(): Cart | null {
    const id = this.player.cart;
    return id === null ? null : this.shift.carts.find((c) => c.id === id) ?? null;
  }

  /** Cầm tay đẩy xe. Túi rác đang xách thì bỏ luôn vào xe rác. */
  grabCart(id: number, who = 'p1'): TaskResult {
    const c = this.shift.carts.find((x) => x.id === id);
    if (!c) return { ok: false, msg: '' };
    if (c.pusher && c.pusher !== who) return { ok: false, msg: 'Có người đang đẩy xe này.' };
    const busy = this.busyMsg(c.kind === 'rac' ? 'bags' : null);
    if (busy) return { ok: false, msg: busy };
    c.pusher = who;
    this.player.cart = id;
    this.cartNoiseT = 0.4;
    let extra = '';
    if (c.kind === 'rac' && this.player.bags) {
      const n = Math.min(this.player.bags, CART_MAX_BAGS - c.bags);
      c.bags += n;
      this.player.bags -= n;
      extra = ` · bỏ ${n} túi rác vào xe`;
    }
    return {
      ok: true,
      msg: c.kind === 'hang'
        ? `Đẩy xe hàng: [E] vào kiện nước để chất lên xe, [E] vào đống thùng để chất thùng (tối đa ${CART_MAX_BOXES}) · [G] buông xe${extra}`
        : `Đẩy xe rác: [E] vào thùng rác để gom túi, đẩy về THÙNG RÁC LỚN trong kho để đổ · [G] buông xe${extra}`,
    };
  }

  releaseCart(): void {
    const c = this.heldCart;
    if (!c) return;
    c.pusher = null;
    this.player.cart = null;
  }

  /** Chất kiện hàng đang nằm trên sàn (gần xe) lên xe đẩy hàng. */
  loadBulky(id: number): TaskResult {
    const c = this.heldCart;
    const b = this.shift.bulky.find((x) => x.id === id);
    if (!c || !b || b.done) return { ok: false, msg: '' };
    if (c.kind !== 'hang') return { ok: false, msg: 'Xe rác không chở kiện hàng. Dùng XE ĐẨY HÀNG trong kho.' };
    if (c.bulky !== null) return { ok: false, msg: 'Xe đã chở một kiện.' };
    if (c.boxes) return { ok: false, msg: 'Xe đang chở thùng: dỡ hết thùng trước.' };
    if (b.carriers.length) return { ok: false, msg: 'Kiện đang có người khiêng.' };
    c.bulky = id;
    b.cart = c.id;
    this.noise({ ...b.pos }, 5, 1);
    return { ok: true, msg: 'Chất kiện nước lên xe (đẩy chậm hơn, bánh xe lạch cạch). Đẩy ra ĐẢO KHUYẾN MÃI, [E] để đặt.' };
  }

  /** Xe đang đẩy đi theo người chơi; kiện trên xe đi theo xe. Bánh xe lạch cạch. */
  private updateCart(dt: number, moving: boolean): void {
    const c = this.heldCart;
    if (!c) return;
    const pl = this.player;
    c.yaw = pl.yaw;
    c.pos = { x: pl.pos.x + Math.sin(pl.yaw) * CART_MOVE.reach, z: pl.pos.z + Math.cos(pl.yaw) * CART_MOVE.reach };
    if (c.bulky !== null) {
      const b = this.shift.bulky.find((x) => x.id === c.bulky);
      if (b) {
        b.pos = { ...c.pos };
        b.yaw = c.yaw;
      }
    }
    if (!moving) return;
    this.cartNoiseT -= dt;
    if (this.cartNoiseT > 0) return;
    this.cartNoiseT = CART_MOVE.rattleEvery;
    const load = (c.bulky !== null ? 3 : 0) + c.boxes + c.bags;
    const r = (c.bulky !== null ? CART_MOVE.rattleBulky : CART_MOVE.rattle) * (pl.sneak ? 0.5 : 1);
    this.events.push({ type: 'rattle', at: { ...c.pos }, load });
    this.noise({ ...c.pos }, r, 1.5);
  }

  // ---- Gom rác (mỗi đêm 1 lần) ----

  /** Lấy túi rác ở thùng rác thứ i: bỏ vào xe rác đang đẩy, hoặc xách tay (tối đa 2 túi). */
  takeTrash(i: number): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const s = this.shift;
    if (!s.trashFull.has(i)) return { ok: false, msg: 'Thùng rác này đã gom rồi.' };
    const c = this.heldCart;
    if (c) {
      if (c.kind !== 'rac') return { ok: false, msg: 'Xe đẩy hàng không chở rác. Dùng XE GOM RÁC (màu vàng) trong kho, hoặc xách tay.' };
      if (c.bags >= CART_MAX_BAGS) return { ok: false, msg: 'Xe rác đầy: đẩy về THÙNG RÁC LỚN trong kho đổ trước.' };
      c.bags++;
    } else {
      const busy = this.busyMsg('bags');
      if (busy) return { ok: false, msg: busy };
      if (this.player.bags >= HAND_MAX_BAGS) return { ok: false, msg: `Xách tối đa ${HAND_MAX_BAGS} túi. Đổ vào THÙNG RÁC LỚN trong kho, hoặc dùng XE GOM RÁC.` };
      this.player.bags++;
    }
    s.trashFull.delete(i);
    const at = { x: TRASH_BINS[i].x, z: TRASH_BINS[i].z };
    this.events.push({ type: 'trash', at, dumped: false });
    this.noise(at, 3, 1);
    const left = s.trashFull.size;
    return { ok: true, msg: `Gom túi rác (${TRASH_BINS[i].name})${left ? ` · còn ${left} thùng` : ' · đã gom hết, đổ vào THÙNG RÁC LỚN trong kho'}` };
  }

  /** Đổ túi rác (xách tay và trên xe rác đang đẩy) vào thùng rác lớn trong kho. Đổ đủ mọi túi là xong việc gom rác. */
  dumpTrash(): TaskResult {
    const c = this.heldCart;
    const n = this.player.bags + (c && c.kind === 'rac' ? c.bags : 0);
    if (!n) return { ok: false, msg: 'THÙNG RÁC LỚN: gom túi rác ở các thùng rác trong siêu thị rồi mang về đây đổ.' };
    this.player.bags = 0;
    if (c && c.kind === 'rac') c.bags = 0;
    const s = this.shift;
    s.trashDumped += n;
    this.events.push({ type: 'trash', at: { ...this.player.pos }, dumped: true });
    this.noise({ ...this.player.pos }, 5, 1);
    if (s.trashDumped >= s.trashTotal && !s.trashFull.size) {
      return this.jobDone('trash', 'all', `Đổ ${n} túi rác · đã gom rác xong cả siêu thị`);
    }
    return { ok: true, msg: `Đổ ${n} túi rác · còn ${s.trashTotal - s.trashDumped} túi chưa gom` };
  }

  /** Việc được giao vừa làm xong (nếu có trong danh sách). */
  private jobDone(kind: JobKind, target: string, text: string): TaskResult {
    const j = this.shift.completeJob(kind, target);
    return { ok: true, msg: j ? `✓ ${text}` : text, job: !!j };
  }

  /** Mô tả việc được giao (kèm vị trí món hàng lỗi). */
  jobLabel(j: Job): string {
    if (j.kind !== 'defect') return jobText(j);
    const sl = slotByKey(j.target);
    return sl ? jobText(j, { section: sl.section, tier: sl.tier, productName: productById(sl.product)!.name }) : jobText(j);
  }

  /** Kiện đang khiêng đi theo người chơi: tâm kiện ở trước mặt, chiều dài theo hướng nhìn. Kéo lê / khiêng thì gây tiếng động. */
  private updateBulky(dt: number, moving: boolean): void {
    const b = this.heldBulky;
    if (!b) return;
    const pl = this.player;
    b.yaw = pl.yaw;
    b.pos = { x: pl.pos.x + Math.sin(pl.yaw) * BULKY_MOVE.reach, z: pl.pos.z + Math.cos(pl.yaw) * BULKY_MOVE.reach };
    if (!moving) return;
    this.bulkyNoiseT -= dt;
    if (this.bulkyNoiseT > 0) return;
    if (b.carriers.length >= 2) {
      this.bulkyNoiseT = BULKY_MOVE.duoNoiseEvery;
      if (!pl.sneak) this.noise({ ...b.pos }, BULKY_MOVE.duoNoise, 1);
    } else {
      this.bulkyNoiseT = BULKY_MOVE.soloNoiseEvery;
      this.events.push({ type: 'scrape', at: { ...b.pos } });
      this.noise({ ...b.pos }, pl.sneak ? BULKY_MOVE.soloNoiseSneak : BULKY_MOVE.soloNoise, 2);
    }
  }

  // ---- Hàng trên kệ: lấy, đặt lại, ăn / uống, bỏ hàng lỗi ----
  /** Hàng lỗi đang có trong một đoạn kệ (mã ô + kiểu lỗi). */
  defectsIn(sectionId: string): { key: string; kind: DefectKind }[] {
    const pre = sectionId + ':';
    return [...this.shift.defects].filter(([k]) => k.startsWith(pre)).map(([key, kind]) => ({ key, kind }));
  }

  /** Ô hàng còn trên kệ không (chưa bị lấy, đoạn kệ không đang thiếu hàng). */
  slotFilled(key: string): boolean {
    const slot = slotByKey(key);
    return !!slot && !this.shift.taken.has(key) && !this.shift.restockNeeded.has(slot.section);
  }

  /** Cầm một món trên kệ lên tay. */
  takeItem(key: string): TaskResult {
    if (this.phase !== 'shift' || !this.player.alive) return { ok: false, msg: '' };
    const slot = slotByKey(key);
    if (!slot) return { ok: false, msg: 'Không có hàng ở chỗ này.' };
    if (this.player.carry) return { ok: false, msg: 'Đang ôm thùng: xếp thùng xong (hoặc [G] thả) rồi mới lấy hàng.' };
    const h = this.player.hand;
    if (h) return { ok: false, msg: `Tay đang cầm ${productById(h.product)!.name}: [E] đặt lại lên kệ trước.` };
    if (!this.slotFilled(key)) return { ok: false, msg: 'Chỗ này đang trống.' };
    this.shift.taken.add(key);
    this.player.hand = { key, product: slot.product, defect: this.shift.defects.get(key) ?? null };
    this.noise({ ...this.player.pos }, 1.5, 0.5);
    return { ok: true, msg: `Cầm lên: ${productById(slot.product)!.name}` };
  }

  /** Đặt món đang cầm lại đúng chỗ cũ trên kệ. */
  putBack(): TaskResult {
    const h = this.player.hand;
    if (!h) return { ok: false, msg: '' };
    this.shift.taken.delete(h.key);
    this.player.hand = null;
    return { ok: true, msg: `Đặt lại ${productById(h.product)!.name} lên kệ` };
  }

  /** Ăn / uống món đang cầm. Hàng chưa trả tiền: lúc 06:00 bị trừ công đúng giá tiền. */
  eat(): TaskResult {
    const h = this.player.hand;
    if (!h || this.phase !== 'shift') return { ok: false, msg: '' };
    const p = productById(h.product)!;
    if (p.kind === 'other') return { ok: false, msg: `${p.name} không ăn uống được!` };
    const pl = this.player;
    const bad = h.defect !== null;
    this.shift.eaten.push({ product: p.id, price: p.price, bad });
    this.shift.defects.delete(h.key); // món lỗi đã vào bụng: không còn trên kệ nhưng cũng không tính là đã dọn
    pl.hand = null;
    pl.stamina = Math.min(1, pl.stamina + p.stamina);
    if (pl.exhausted && pl.stamina >= STAMINA.recoverAt) pl.exhausted = false;
    // khui lon / xé gói cũng ồn
    this.noise({ ...pl.pos }, p.kind === 'drink' ? 6 : 5, 1.5);
    const verb = p.kind === 'drink' ? 'Uống' : 'Ăn';
    if (bad) {
      pl.sick = SICK_SECONDS;
      pl.dizzy = DIZZY_SECONDS;
      this.groanT = 3;
      return { ok: false, msg: `${verb} phải hàng lỗi (${DEFECT_TEXT[h.defect!].toLowerCase()}): đau bụng, chóng mặt! · −${formatPrice(p.price)}` };
    }
    return { ok: true, msg: `${verb} ${p.name} · hồi thể lực · −${formatPrice(p.price)} (trừ vào lương)` };
  }

  /** Bỏ món đang cầm vào thùng HÀNG LỖI trong kho (chỉ nhận hàng lỗi). */
  discardHeld(): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const h = this.player.hand;
    if (!h) return { ok: false, msg: 'Thùng HÀNG LỖI: mang hàng lỗi (hết hạn, phồng, mốc) trên kệ tới bỏ vào.' };
    const p = productById(h.product)!;
    if (!h.defect) return { ok: false, msg: `${p.name} còn tốt, không phải hàng lỗi: [E] đặt lại lên kệ.` };
    this.shift.defects.delete(h.key);
    this.shift.defectsRemoved++;
    this.player.hand = null;
    return this.jobDone('defect', h.key, `Bỏ hàng lỗi: ${p.name} (${DEFECT_TEXT[h.defect].toLowerCase()})`);
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
    const r = this.jobDone('scan', id, recount ? `Kiểm lại xong ${sec.name}` : `Quét xong ${sec.name}`);
    if (recount) r.order = true;
    // Máy quét phát hiện hàng lỗi trong đoạn kệ: bíp lỗi to (ồn hơn bình thường)
    const bad = this.defectsIn(id);
    if (bad.length) {
      this.noise({ ...this.player.pos }, 9, 2);
      const where = bad
        .map((b) => `${productById(slotByKey(b.key)!.product)!.name.toLowerCase()} tầng ${slotByKey(b.key)!.tier + 1}`)
        .join(', ');
      r.msg += ` · BÍP LỖI: ${bad.length} hàng lỗi (${where})`;
      r.defects = bad.length;
    }
    return r;
  }

  restock(id: string): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const sec = sectionById(id);
    if (!sec) return { ok: false, msg: 'Không xác định được kệ.' };
    if (!this.shift.restockNeeded.has(id)) return { ok: false, msg: `${sec.name} không thiếu hàng.` };
    if (this.player.carry === 'cold') return { ok: false, msg: 'Đây là thùng hàng LẠNH: xếp vào tủ mát / ngăn mát / tủ đông đang hết hàng.' };
    const cart = this.heldCart;
    const fromCart = this.player.carry !== 'dry' && !!cart && cart.kind === 'hang' && cart.boxes > 0;
    if (this.player.carry !== 'dry' && !fromCart) return { ok: false, msg: 'Lấy thùng hàng khô ở KHO (ôm tay, hoặc chất lên xe đẩy hàng).' };
    this.shift.restockNeeded.delete(id);
    this.shift.restocked.add(id);
    this.shift.clearSectionGoods(id); // hàng mới: không còn chỗ trống, không còn hàng lỗi
    if (fromCart) cart!.boxes--;
    else this.player.carry = null;
    const order = this.completeOrder((o) => o.kind === 'restock' && o.section === id);
    const r = this.jobDone('restock', id, `Xếp hàng xong ${sec.name}${fromCart ? ` (thùng trên xe, còn ${cart!.boxes})` : ''}`);
    r.order = order;
    return r;
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
    const order = this.completeOrder((o) => o.kind === 'coldRestock' && o.section === id);
    const r = this.jobDone('coldRestock', id, `Xếp hàng lạnh xong ${u.name}`);
    r.order = order;
    return r;
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
    const cart = this.heldCart;
    if (this.player.carry === 'dry') this.player.carry = null;
    else if (cart && cart.kind === 'hang' && cart.boxes > 0) cart.boxes--;
    else return { ok: false, msg: 'Mang một thùng hàng khô từ KHO ra.' };
    this.completeOrder((o) => o.kind === 'deliver');
    return { ok: true, msg: 'Giao đơn gấp ở quầy', order: true };
  }

  freezer(): TaskResult {
    const nc = this.notClockedIn();
    if (nc) return nc;
    const w = this.shift.freezerWindow();
    if (w === null) {
      const nx = this.shift.nextFreezer();
      return { ok: false, msg: nx !== null ? `Chưa đến giờ ghi nhiệt độ. Mốc được giao kế tiếp: ${clockOf(nx)} (làm trong ${FREEZER_WINDOW} phút).` : 'Chưa đến giờ ghi nhiệt độ.' };
    }
    if (this.shift.freezerDone.has(w)) return { ok: false, msg: 'Mốc giờ này đã ghi rồi.' };
    this.shift.freezerDone.add(w);
    return this.jobDone('freezer', String(w), `Ghi nhiệt độ tủ đông lúc ${clockOf(w)}: -18°C`);
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

  /** Lấy một thùng hàng khô: ôm tay, hoặc chất lên xe đẩy hàng đang đẩy (tối đa 3 thùng). */
  takeBox(): boolean {
    if (this.shift.pile <= 0) return false;
    const c = this.heldCart;
    if (c && c.kind === 'hang' && c.bulky === null && c.boxes < CART_MAX_BOXES) {
      this.shift.pile--;
      c.boxes++;
      return true;
    }
    if (this.busyMsg()) return false;
    this.shift.pile--;
    this.player.carry = 'dry';
    return true;
  }

  /** Lấy một thùng hàng lạnh (thùng xốp) ở kho lạnh. */
  takeColdBox(): boolean {
    if (this.shift.coldPile <= 0 || this.busyMsg()) return false;
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
    // Đoạn kệ đang có việc được giao (quét, hàng lỗi) thì không cho "hết hàng" (kẻo mất việc / mất món lỗi)
    const jobSecs = new Set(s.jobs.filter((j) => !j.done && (j.kind === 'scan' || j.kind === 'defect')).map((j) => (j.kind === 'defect' ? slotByKey(j.target)?.section : j.target)));
    if (kind === 'restock') {
      const cands = SECTIONS.map((x) => x.id).filter((id) => !s.restockNeeded.has(id) && !busy.has(id) && !jobSecs.has(id));
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
      s.clearSectionGoods(section!);
      s.pile++;
    } else if (kind === 'rescan') {
      s.scanned.delete(section!);
      s.recount.add(section!);
    } else if (kind === 'coldRestock') {
      s.coldNeeded.add(section!);
      s.coldPile++;
    } else if (kind === 'bulky') {
      // Kiện mới nằm trong kho, dọc theo trục z; kiện cũ chưa khiêng đi thì kiện sau xếp lệch sang đông
      const waiting = s.bulky.filter((b) => !b.done && !b.carriers.length && b.cart === null).length;
      s.bulky.push({ id: this.nextBulkyId++, pos: { x: BULKY_SPOT.x + waiting * 0.7, z: BULKY_SPOT.z }, yaw: 0, carriers: [], cart: null, done: false });
    } else if (kind === 'deliver') {
      s.pile++;
    }
    if (HEAVY_ORDERS.has(kind)) this.lastHeavyAt = m;
    s.orders.push(o);
    this.events.push({ type: 'order', order: o });
    const sec = section ? sectionById(section) : undefined;
    const what =
      kind === 'restock' ? `kệ ${spoken(sec!)} vừa hết hàng, xếp hàng vào`
      : kind === 'rescan' ? `kiểm lại kệ ${spoken(sec!)}, số liệu không khớp`
      : kind === 'coldRestock' ? `${coldUnitById(section!)!.name.toLowerCase()} vừa hết hàng, lấy thùng hàng lạnh ở kho lạnh`
      : kind === 'bulky' ? 'đưa kiện nước suối trong kho ra đảo khuyến mãi. Kiện nặng: hai người khiêng, hoặc chở bằng xe đẩy hàng'
      : kind === 'power' ? 'sự cố mất điện. Bật lại cầu dao ở tủ điện tổng trong phòng điện, theo đúng sơ đồ'
      : 'đơn gấp, mang một thùng hàng từ kho ra quầy';
    this.announce(`Phiếu việc cho nhân viên ${this.name}: ${what}. Hạn ${clockVi(o.due)}.`);
    return o;
  }

  /** Đánh dấu xong phiếu phát sinh khớp; trả về true nếu có phiếu như vậy. */
  private completeOrder(match: (o: Order) => boolean): boolean {
    const o = this.shift.openOrders.find(match);
    if (!o) return false;
    o.done = true;
    this.shift.drift = Math.max(0, this.shift.drift - DRIFT.onDone);
    this.events.push({ type: 'orderDone', order: o });
    return true;
  }

  /**
   * Chọn loại phiếu phát sinh, giãn cách việc nặng: hai việc nặng (bê thùng, khiêng kiện) cách nhau ít nhất HEAVY_GAP phút;
   * kiện hàng cách việc nặng khác và lần mất điện ít nhất BULKY_GAP phút. Không hợp thì đổi sang việc nhẹ (kiểm lại kệ).
   */
  private pickOrderKind(): OrderKind {
    const s = this.shift;
    const m = s.minutes;
    const r = this.orderRng();
    let kind: OrderKind = r < 0.25 ? 'restock' : r < 0.45 ? 'coldRestock' : r < 0.7 ? 'rescan' : r < 0.85 ? 'deliver' : 'bulky';
    const nearBlackout = this.blackouts.some((b) => m > b.start - BULKY_GAP && m < b.end + 30);
    if (kind === 'bulky' && (this.night < 2 || s.orders.some((o) => o.kind === 'bulky') || nearBlackout || m - this.lastHeavyAt < BULKY_GAP)) kind = 'deliver';
    if (HEAVY_ORDERS.has(kind) && m - this.lastHeavyAt < HEAVY_GAP) kind = 'rescan';
    // Việc nặng còn đang dở (chưa xong) thì cũng không giao thêm việc nặng
    if (HEAVY_ORDERS.has(kind) && s.openOrders.some((o) => HEAVY_ORDERS.has(o.kind))) kind = 'rescan';
    return kind;
  }

  /** Giao phiếu theo lịch, đánh dấu quá hạn, cập nhật độ lệch sổ. */
  private updateOrders(dt: number): void {
    const s = this.shift;
    while (this.orderPlan.length && s.minutes >= this.orderPlan[0]) {
      const at = this.orderPlan.shift()!;
      // Tua giờ vượt qua lúc giao (bảng sự kiện) hoặc quá sát 06:00: bỏ phiếu đó, không giao dồn
      if (s.minutes - at > 20 || s.minutes > SHIFT_MINUTES - 30) continue;
      this.issueOrder(this.pickOrderKind());
    }
    let late = 0;
    for (const o of s.orders) {
      if (o.done) continue;
      if (!o.late && s.minutes > o.due) {
        o.late = true;
        this.events.push({ type: 'orderLate', order: o });
        this.announce(`Phiếu việc quá hạn: ${orderText(o).toLowerCase().replace(/ · /g, ', ')}. Ghi hồ sơ nhân viên ${this.name}.`);
      }
      if (o.late) late++;
    }
    // Kệ và tủ lạnh để trống làm sổ lệch dần; lon nước để lại chỉ bị trừ lương, không làm lệch sổ
    // Hàng lỗi còn trên kệ: từ 02:00 bắt đầu làm lệch sổ
    const defectRise = s.minutes >= DEFECT_DRIFT_FROM ? s.defects.size * DRIFT.perDefect : 0;
    const rise = late * DRIFT.perLate + (s.restockNeeded.size + s.coldNeeded.size) * DRIFT.perEmpty + defectRise;
    s.drift = Math.max(0, Math.min(1, s.drift + (rise > 0 ? rise : -DRIFT.decay) * dt));
    this.auditor.drift = s.drift;
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
    this.once('progress', m >= 240, () => {
      const left = this.shift.jobsLeft.length;
      this.announce(
        left
          ? `Nhân viên ${this.name}: còn ${numberVi(left)} việc được giao chưa xong.`
          : `Nhân viên ${this.name}: đã xong việc được giao.`,
      );
    });
    this.once('trash', m >= 330 && this.shift.jobs.some((j) => j.kind === 'trash' && !j.done), () =>
      this.announce('Nhắc nhân viên: chưa gom rác. Đổ rác vào thùng rác lớn trong kho trước sáu giờ.'),
    );
    this.blackouts.forEach((b, i) => {
      this.once(`bo_off_${b.id}`, m >= b.start && m < b.end, () => {
        this.setPower(false);
        if (this.eventCfg.powerFix) {
          this.issueOrder('power');
        } else {
          this.announce(
            i === 0
              ? 'Sự cố mất điện. Nhân viên tiếp tục làm việc bằng đèn pin. Thời gian mất điện vẫn tính là giờ làm.'
              : 'Sự cố mất điện lần nữa. Nhân viên tiếp tục làm việc.',
          );
        }
      });
      if (!this.eventCfg.powerFix) {
        this.once(`bo_on_${b.id}`, m >= b.end, () => {
          if (!this.power) {
            this.setPower(true);
            this.announce('Điện đã có lại. Cảm ơn nhân viên đã không nghỉ.');
          }
        });
      } else {
        // Không ai sửa: máy phát dự phòng tự chạy sau gấp đôi thời gian (phiếu sửa điện đã quá hạn từ lâu)
        this.once(`bo_gen_${b.id}`, m >= b.start + 2 * (b.end - b.start), () => {
          if (!this.power) {
            this.setPower(true);
            this.announce('Máy phát dự phòng đã chạy. Sự cố mất điện chưa được nhân viên xử lý.');
          }
        });
      }
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
    this.player.hand = null;
    this.releaseBulky();
    this.player.sick = this.player.dizzy = 0;
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.player.alive = false;
    // Giữ một ô trong kho cho thùng mang tên người này
    const slot = storageSlot(this.storedCount);
    this.storedCount++;
    this.auditor.storeIndex = this.storedCount;
    this.events.push({ type: 'dead', reason, slot });
  }

  /** Ghi hồ sơ (3 lần ghi = 1 lỗ thẻ). */
  private record(reason: string): void {
    this.nightRecords.push(reason);
  }

  /**
   * 06:00: chấm phiếu đánh giá.
   * - Còn việc được giao chưa xong: bấm 1 lỗ (tối đa 1 lỗ mỗi đêm vì việc).
   * - Vắng điểm danh 06:00: bấm 1 lỗ.
   * - Ghi hồ sơ: mỗi phiếu phát sinh trễ hạn / bỏ dở, chấm công vào ca trễ, ăn hàng quá 100.000đ. Đủ 3 lần ghi = 1 lỗ.
   * - Lương đêm: trừ tiền hàng đã ăn, phí dọn lon nước để lại.
   * - Phiếu khen: xong hết việc, không trễ phiếu nào, không bị ghi hồ sơ, có mặt 06:00.
   */
  private endShift(): void {
    const s = this.shift;
    const atClock = inBox(this.player.pos, CLOCK_ZONE);
    const reasons: string[] = [];
    let add = 0;
    // Việc được giao
    const left = s.jobsLeft;
    if (left.length) {
      add++;
      reasons.push(`Còn ${left.length}/${s.jobs.length} việc được giao chưa xong.`);
    }
    if (!atClock) {
      add++;
      reasons.push('Không chấm công lúc 06:00 (máy chấm công trong kho).');
    }
    // Ghi hồ sơ
    for (const o of s.orders) {
      if (!o.done && !o.late) o.late = true; // bỏ dở tới 06:00 cũng là trễ
      if (o.late && this.eventCfg.latePenalty) this.record(`Trễ hạn phiếu: ${orderText(o)}`);
    }
    const lateIn = this.eventCfg.clockInRequired && (!this.player.clockedIn || this.player.lateIn);
    if (lateIn) this.record(this.player.clockedIn ? 'Chấm công vào ca trễ.' : 'Không chấm công vào ca.');
    const eatenValue = s.eaten.reduce((x, e) => x + e.price, 0);
    if (eatenValue > EAT_RECORD_OVER) this.record(`Ăn uống hàng chưa trả tiền quá ${formatPrice(EAT_RECORD_OVER)} (${formatPrice(eatenValue)}).`);
    const records = [...this.nightRecords];
    this.records += records.length;
    let recordHoles = 0;
    while (this.records >= RECORDS_PER_HOLE) {
      this.records -= RECORDS_PER_HOLE;
      recordHoles++;
    }
    if (recordHoles) {
      add += recordHoles;
      reasons.push(`Đủ ${RECORDS_PER_HOLE} lần ghi hồ sơ${recordHoles > 1 ? ` (×${recordHoles})` : ''}.`);
    }
    // Lương
    const litterLeft = s.litter.length;
    const litterFee = litterLeft * LITTER_FEE;
    const wage = Math.max(0, WAGE_PER_NIGHT - eatenValue - litterFee);
    this.wages.push(wage);
    // Phiếu khen: dùng phiếu đang giữ để xoá một lỗ, rồi mới xét phiếu mới
    let voucherUsed = false;
    if (add > 0 && this.voucher) {
      add--;
      this.voucher = false;
      voucherUsed = true;
    }
    const late = s.lateCount;
    const voucherEarned = !left.length && late === 0 && !records.length && atClock && !this.voucher;
    if (voucherEarned) this.voucher = true;
    this.holes = Math.min(MAX_HOLES, this.holes + add);
    const dead = this.holes >= MAX_HOLES;
    const final = !dead && this.night >= MAX_NIGHTS;
    const ev: Evaluation = {
      night: this.night,
      atClock,
      holesAdded: add,
      holesTotal: this.holes,
      reasons,
      notes: this.notes(),
      dead,
      final,
      jobsTotal: s.jobs.length,
      jobsDone: s.jobsDone,
      jobsLeft: left.map((j) => this.jobLabel(j)),
      ordersTotal: s.orders.length,
      ordersDone: s.orders.filter((o) => o.done).length,
      late,
      records,
      recordsTotal: this.records,
      recordHoles,
      voucherEarned,
      voucherUsed,
      wageBase: WAGE_PER_NIGHT,
      wage,
      litterLeft,
      litterFee,
      lateIn,
      eatenCount: s.eaten.length,
      eatenValue,
      ateBad: s.eaten.filter((e) => e.bad).length,
      defectsTotal: s.defectsTotal,
      defectsRemoved: s.defectsRemoved,
      defectsLeft: s.defects.size,
    };
    this.nightRecords = [];
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
    const ate = this.shift.eaten.length;
    const ateBad = this.shift.eaten.filter((e) => e.bad).length;
    if (ate >= 3) n.push(`Ăn uống ${ate} món hàng trong ca. Siêu thị không phải căng tin.`);
    if (ateBad) n.push(`Ăn phải ${ateBad} món hàng lỗi. Đã ghi nhận tiếng rên trong camera.`);
    if (this.shift.defects.size) n.push(`Còn ${this.shift.defects.size} món hàng lỗi trên kệ. Khách hàng sẽ rất bất ngờ.`);
    if (st.seen >= 2) n.push(`Bị kiểm kê viên quét trúng ${st.seen} lần nhưng vẫn còn ở đây. Đáng ngờ.`);
    if (!this.shift.jobsLeft.length && this.shift.lateCount === 0) n.push('Nhân viên có dấu hiệu chăm chỉ bất thường.');
    if (st.sparks >= 1) n.push(`Bật sai cầu dao ${st.sparks} lần. Tủ điện không phải máy đánh bạc.`);
    if (this.shift.trashFull.size === this.shift.trashTotal) n.push('Không gom rác. Mùi đã lan tới phòng kiểm kê.');
    const d = Math.round(this.shift.drift * 100);
    if (d >= 30) n.push(`Sổ sách cuối ca lệch ${d}%. Đèn khu bán hàng đã được tắt bớt cho đỡ tốn điện.`);
    if (!this.shift.jobsLeft.length && this.shift.lateCount > 0) n.push('Xong việc được giao không có nghĩa là xong việc.');
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
    this.player.stamina = 1;
    this.player.exhausted = false;
    this.player.hand = null;
    this.player.sick = 0;
    this.player.dizzy = 0;
    this.player.bulky = null;
    this.player.cart = null;
    this.player.bags = 0;
    this.player.sheet = false;
    this.breaker = null;
    this.lastHeavyAt = -999;
    this.nightRecords = [];
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
      this.setPower(true);
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

  /** Đánh dấu xong n việc được giao (chưa xong) đầu danh sách; n < 0: xong hết. */
  devCompleteJobs(n = -1): void {
    let k = 0;
    for (const j of this.shift.jobs) {
      if (j.done) continue;
      if (n >= 0 && k >= n) break;
      j.done = true;
      k++;
    }
  }

  /** Ghi hồ sơ ngay (để thử quy đổi 3 lần ghi = 1 lỗ lúc 06:00). */
  devRecord(): void {
    this.record('Ghi hồ sơ thử (bảng sự kiện).');
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
