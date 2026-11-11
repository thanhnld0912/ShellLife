// Bảng sự kiện (phím P): tự điều khiển sự kiện và chỉnh thông số khi chơi thử.
// - "Ngay bây giờ": mất điện, gọi / cho nghỉ / dụ Người Kiểm Kê, phát loa.
// - Thời gian: tua giờ, tốc độ thời gian, nhảy đêm.
// - Gian lận để thử: tàng hình, không chết, cộng công, đặt số lỗ thẻ.
// - Lịch sự kiện + thông số Người Kiểm Kê + người chơi: lưu trong trình duyệt, áp dụng cho các ca sau.
// - Nhật ký: mọi sự kiện trong ca kèm giờ trong game, để ghi nhận xét chơi thử.

import { ROUTE_NAMES, type AuditorTuning } from '../sim/auditor.ts';
import { DEFAULT_EVENTS, LATE_IN_PENALTY, MAX_NIGHTS, type EventConfig, type Game } from '../sim/game.ts';
import { REAL_PER_MIN, SHIFT_MINUTES, clockOf, type OrderKind } from '../sim/shift.ts';
import type { World } from '../render/world.ts';
import type { PlayerController } from './player.ts';

const KEY = 'hopdong30-bang-su-kien';

type PlayerKey = 'walk' | 'run' | 'carryWalk' | 'carryRun' | 'flashPower' | 'blackoutLevel';

export interface DevSaved {
  events: Partial<EventConfig>;
  tuning: Partial<AuditorTuning>;
  player: Partial<Record<PlayerKey, number>>;
  pauseOnOpen: boolean;
}

export interface DevHost {
  game(): Game | null;
  world(): World | null;
  player: PlayerController;
  /** Tốc độ thời gian của thế giới (Người Kiểm Kê, đồng hồ ca). */
  timeScale: number;
  /** Gọi khi bảng đóng (để khoá chuột lại). */
  onClose(): void;
}

interface SliderDef<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Giá trị hiển thị = giá trị thật × scale (vd. radian → độ). */
  scale?: number;
}

const TUNE_DEFS: SliderDef<keyof AuditorTuning>[] = [
  { key: 'speed', label: 'Đi tuần', min: 0.4, max: 2.5, step: 0.05, unit: 'm/s' },
  { key: 'investigateSpeed', label: 'Đi điều tra', min: 0.8, max: 3.5, step: 0.05, unit: 'm/s' },
  { key: 'runSpeed', label: 'Chạy khi mất điện', min: 2, max: 5, step: 0.05, unit: 'm/s' },
  { key: 'range', label: 'Tầm tia quét', min: 3, max: 16, step: 0.5, unit: 'm' },
  { key: 'halfAngle', label: 'Nửa góc tia quét', min: 3, max: 30, step: 0.5, unit: '°', scale: 180 / Math.PI },
  { key: 'hearMul', label: 'Thính tai', min: 0.3, max: 2.5, step: 0.05, unit: '×' },
  { key: 'countTime', label: 'Đếm bao lâu thì bắt', min: 0.5, max: 5, step: 0.1, unit: 'giây' },
  { key: 'lightSight', label: 'Thấy đèn pin trong', min: 4, max: 24, step: 0.5, unit: 'm' },
];

const PLAYER_DEFS: SliderDef<PlayerKey>[] = [
  { key: 'walk', label: 'Đi bộ', min: 1, max: 4, step: 0.1, unit: 'm/s' },
  { key: 'run', label: 'Chạy', min: 2, max: 6, step: 0.1, unit: 'm/s' },
  { key: 'carryWalk', label: 'Ôm thùng đi', min: 0.8, max: 3, step: 0.1, unit: 'm/s' },
  { key: 'carryRun', label: 'Ôm thùng chạy', min: 1.5, max: 4.5, step: 0.1, unit: 'm/s' },
  { key: 'flashPower', label: 'Độ sáng đèn pin', min: 5, max: 80, step: 1, unit: '' },
  { key: 'blackoutLevel', label: 'Ánh sáng còn lại khi mất điện', min: 0, max: 4, step: 0.1, unit: '×' },
];

const PLAYER_DEFAULTS: Record<PlayerKey, number> = {
  walk: 2.2, run: 3.8, carryWalk: 1.8, carryRun: 2.7, flashPower: 30, blackoutLevel: 1,
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (v: number, step: number) => v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);

export function loadDevSaved(): DevSaved {
  const empty: DevSaved = { events: {}, tuning: {}, player: {}, pauseOnOpen: true };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DevSaved>;
    return { ...empty, ...raw, events: { ...raw.events }, tuning: { ...raw.tuning }, player: { ...raw.player } };
  } catch {
    return empty;
  }
}

/** Áp phần đã lưu cho người chơi và ánh sáng (lịch + thông số Người Kiểm Kê truyền vào new Game). */
export function applyDevSaved(s: DevSaved, player: PlayerController, world: World | null): void {
  const p = { ...PLAYER_DEFAULTS, ...s.player };
  player.speeds = { walk: p.walk, run: p.run, carryWalk: p.carryWalk, carryRun: p.carryRun };
  player.flashPower = p.flashPower;
  if (player.flashOn) player.setFlashlight(true);
  if (world) world.blackoutLevel = p.blackoutLevel;
}

export class DevPanel {
  saved = loadDevSaved();
  private el = document.getElementById('dev') as HTMLElement;
  private logLines: string[] = [];
  private open_ = false;

  constructor(private host: DevHost) {
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onInput(e));
    // Gõ trong ô chữ không được kích hoạt phím tắt của game
    this.el.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' && e.code !== 'Escape') e.stopPropagation();
      if (e.code === 'Enter' && (e.target as HTMLElement).id === 'dev-say') this.say();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  get pauses(): boolean {
    return this.open_ && this.saved.pauseOnOpen;
  }

  open(): void {
    this.open_ = true;
    this.el.hidden = false;
    this.render();
  }

  /** silent = đóng mà không khoá chuột lại (khi game chuyển sang màn khác). */
  close(silent = false): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.hidden = true;
    if (!silent) this.host.onClose();
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** Ghi một dòng vào nhật ký (kèm giờ trong game). */
  log(text: string): void {
    const g = this.host.game();
    this.logLines.unshift(`${g ? g.shift.clock() : '--:--'}  ${text}`);
    if (this.logLines.length > 60) this.logLines.length = 60;
    if (this.open_) {
      const box = this.el.querySelector('#dev-log');
      if (box) box.innerHTML = this.logHtml();
    }
  }

  clearLog(): void {
    this.logLines = [];
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.saved));
    } catch { /* bỏ qua */ }
  }

  private logHtml(): string {
    return this.logLines.length
      ? this.logLines.map((l) => `<div>${esc(l)}</div>`).join('')
      : '<div class="dim">Chưa có sự kiện nào.</div>';
  }

  private slider<K extends string>(group: string, d: SliderDef<K>, value: number, changed: boolean): string {
    const sc = d.scale ?? 1;
    const v = value * sc;
    return `<label class="sl${changed ? ' ch' : ''}">
      <span>${d.label}</span>
      <input type="range" data-${group}="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}">
      <b>${fmt(v, d.step)}${d.unit ? ' ' + d.unit : ''}</b></label>`;
  }

  render(): void {
    const g = this.host.game();
    if (!g) {
      this.el.innerHTML = '<div class="dev-in"><p>Nhận ca trước rồi mở bảng.</p></div>';
      return;
    }
    const a = g.auditor;
    const s = this.saved;
    const ev = g.eventCfg;
    const p = { ...PLAYER_DEFAULTS, ...s.player };
    const boText = !ev.blackoutAuto || g.night < ev.blackoutFromNight
      ? 'Đêm này không tự mất điện'
      : g.blackouts.length
        ? `Đêm này mất điện ${g.blackouts.length} lần: ${g.blackouts.map((b) => `${clockOf(b.start)}→${clockOf(b.end)}`).join(' · ')}`
        : '';
    const ts = this.host.timeScale;
    const nightBtns = Array.from({ length: MAX_NIGHTS }, (_, i) =>
      `<button data-act="night" data-n="${i + 1}" class="${g.night === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('');
    const holeBtns = [0, 1, 2].map((n) =>
      `<button data-act="holes" data-n="${n}" class="${g.holes === n ? 'on' : ''}">${n}</button>`).join('');
    const speedBtns = [0.5, 1, 2, 4].map((v) =>
      `<button data-act="speed" data-n="${v}" class="${ts === v ? 'on' : ''}">${v}×</button>`).join('');

    this.el.innerHTML = `<div class="dev-in">
      <header>
        <div><b>BẢNG SỰ KIỆN</b><small>Chơi thử · phím P để đóng</small></div>
        <button data-act="close" class="x" aria-label="Đóng">✕</button>
      </header>
      <div class="state">
        <span>Đêm ${g.night}/${MAX_NIGHTS} · ${g.shift.clock()}</span>
        <span>Kiểm kê viên: <b>${a.state}</b> · lộ trình: ${ROUTE_NAMES[a.routeStyle]}</span>
        <span>Điện: <b class="${g.power ? '' : 'bad'}">${g.power ? 'có' : 'MẤT'}</b></span>
        <span>Công ${g.shift.cong}/${g.shift.quota}</span>
        <span>Phiếu mở: ${g.shift.openOrders.length} · trễ ${g.shift.lateCount}</span>
        <span>Sổ lệch: <b class="${g.shift.drift > 0.45 ? 'bad' : ''}">${Math.round(g.shift.drift * 100)}%</b></span>
      </div>
      <label class="ck"><input type="checkbox" data-opt="pauseOnOpen" ${s.pauseOnOpen ? 'checked' : ''}> Tạm dừng game khi mở bảng (việc bấm sẽ chạy khi đóng bảng)</label>

      <section><h3>Ngay bây giờ</h3>
        <div class="btns">
          <button data-act="power">${g.power ? 'Mất điện ngay' : 'Có điện lại'}</button>
          <button data-act="auditor-now" ${a.state !== 'idle' ? 'disabled' : ''}>Gọi Người Kiểm Kê vào</button>
          <button data-act="auditor-rest" ${a.state === 'idle' ? 'disabled' : ''}>Cho về văn phòng</button>
          <button data-act="lure">Dụ tới chỗ tôi</button>
        </div>
        <div class="row"><input id="dev-say" placeholder="Câu cho loa phát…" maxlength="160"><button data-act="say">Phát loa</button></div>
      </section>

      <section><h3>Thời gian</h3>
        <div class="btns">
          <button data-act="skip" data-n="10">+10 phút</button>
          <button data-act="skip" data-n="30">+30 phút</button>
          <button data-act="skip" data-n="60">+1 giờ</button>
          <button data-act="freezer">Tới giờ ghi nhiệt độ</button>
          <button data-act="to" data-n="470">Tới 05:50</button>
          <button data-act="to" data-n="${SHIFT_MINUTES}">Kết thúc ca</button>
        </div>
        <div class="row"><span class="lbl">Tốc độ thời gian</span><div class="seg">${speedBtns}</div></div>
        <div class="row"><span class="lbl">Bắt đầu lại đêm</span><div class="seg">${nightBtns}</div></div>
      </section>

      <section><h3>Gian lận để thử</h3>
        <label class="ck"><input type="checkbox" data-flag="invisible" ${g.dev.invisible ? 'checked' : ''}> Tàng hình (Người Kiểm Kê không thấy bạn)</label>
        <label class="ck"><input type="checkbox" data-flag="noDeath" ${g.dev.noDeath ? 'checked' : ''}> Không chết (bị đếm đủ vẫn được tha)</label>
        <div class="btns">
          <button data-act="cong" data-n="2">+2 công</button>
          <button data-act="quota">Đủ chỉ tiêu</button>
        </div>
        <div class="row"><span class="lbl">Số lỗ trên thẻ</span><div class="seg">${holeBtns}</div></div>
      </section>

      <section><h3>Lịch sự kiện <small>lưu lại cho các ca sau</small></h3>
        <label class="sl${s.events.auditorStart !== undefined ? ' ch' : ''}"><span>Người Kiểm Kê vào lúc</span>
          <input type="range" data-ev="auditorStart" min="0" max="120" step="5" value="${ev.auditorStart}">
          <b>${clockOf(ev.auditorStart)}</b></label>
        <label class="ck"><input type="checkbox" data-ev="clockInRequired" ${ev.clockInRequired ? 'checked' : ''}> Phải chấm công vào ca mới được làm việc</label>
        <label class="sl${s.events.clockInBy !== undefined ? ' ch' : ''}"><span>Hạn chấm công vào ca</span>
          <input type="range" data-ev="clockInBy" min="5" max="90" step="5" value="${ev.clockInBy}">
          <b>${clockOf(ev.clockInBy)} · trễ trừ ${LATE_IN_PENALTY} công</b></label>
        <label class="ck"><input type="checkbox" data-ev="blackoutAuto" ${ev.blackoutAuto ? 'checked' : ''}> Tự mất điện (đêm đầu 1 lần, mỗi đêm sau thêm 1 lần)</label>
        <label class="sl${s.events.blackoutMax !== undefined ? ' ch' : ''}"><span>Tối đa mỗi đêm</span>
          <input type="range" data-ev="blackoutMax" min="1" max="5" step="1" value="${ev.blackoutMax}">
          <b>${ev.blackoutMax} lần</b></label>
        <label class="sl${s.events.blackoutFromNight !== undefined ? ' ch' : ''}"><span>Mất điện từ đêm</span>
          <input type="range" data-ev="blackoutFromNight" min="1" max="${MAX_NIGHTS}" step="1" value="${ev.blackoutFromNight}">
          <b>${ev.blackoutFromNight}</b></label>
        <label class="sl${s.events.blackoutMinutes !== undefined ? ' ch' : ''}"><span>Mất điện kéo dài</span>
          <input type="range" data-ev="blackoutMinutes" min="20" max="240" step="10" value="${ev.blackoutMinutes}">
          <b>${ev.blackoutMinutes} phút · ~${Math.round(ev.blackoutMinutes * REAL_PER_MIN)} giây</b></label>
        <p class="dim">${boText}</p>
      </section>

      <section><h3>Phiếu việc và độ lệch sổ</h3>
        <div class="btns">
          <button data-act="order" data-kind="restock">Giao: kệ hết hàng</button>
          <button data-act="order" data-kind="rescan">Giao: kiểm lại kệ</button>
          <button data-act="order" data-kind="coldRestock">Giao: tủ lạnh hết hàng</button>
          <button data-act="order" data-kind="deliver">Giao: đơn gấp</button>
        </div>
        <div class="row"><span class="lbl">Đặt độ lệch sổ</span><div class="seg">
          ${[0, 0.3, 0.6, 1].map((v) => `<button data-act="drift" data-n="${v}">${v * 100}%</button>`).join('')}
        </div></div>
        <label class="sl${s.events.ordersBase !== undefined ? ' ch' : ''}"><span>Phiếu mỗi đêm: cơ bản</span>
          <input type="range" data-ev="ordersBase" min="0" max="10" step="1" value="${ev.ordersBase}">
          <b>${ev.ordersBase}</b></label>
        <label class="sl${s.events.ordersPerNight !== undefined ? ' ch' : ''}"><span>Thêm mỗi đêm</span>
          <input type="range" data-ev="ordersPerNight" min="0" max="4" step="1" value="${ev.ordersPerNight}">
          <b>${ev.ordersPerNight}</b></label>
        <label class="sl${s.events.orderTimeMul !== undefined ? ' ch' : ''}"><span>Hạn phiếu (nhân)</span>
          <input type="range" data-ev="orderTimeMul" min="0.4" max="2" step="0.1" value="${ev.orderTimeMul}">
          <b>${ev.orderTimeMul}×</b></label>
        <label class="ck"><input type="checkbox" data-ev="latePenalty" ${ev.latePenalty ? 'checked' : ''}> Trễ hạn phiếu việc bị bấm 1 lỗ lúc 06:00</label>
        <p class="dim">Đêm ${g.night}: ${Math.round(ev.ordersBase + ev.ordersPerNight * g.night)} phiếu (đổi số phiếu có hiệu lực từ đêm sau). Sổ lệch làm đèn khu bán hàng tắt dần, Người Kiểm Kê nghe xa hơn, quét xa hơn, đi tuần nhanh hơn.</p>
      </section>

      <section><h3>Người Kiểm Kê <small>lưu lại, mọi đêm</small></h3>
        ${TUNE_DEFS.map((d) => this.slider('tune', d, a.tune[d.key], s.tuning[d.key] !== undefined)).join('')}
      </section>

      <section><h3>Người chơi và ánh sáng <small>lưu lại</small></h3>
        ${PLAYER_DEFS.map((d) => this.slider('pl', d, p[d.key], s.player[d.key] !== undefined)).join('')}
      </section>

      <div class="btns">
        <button data-act="copy">Sao chép thông số</button>
        <button data-act="reset" class="ghost">Khôi phục mặc định</button>
      </div>
      <p class="dim">Dòng có vạch vàng là đã chỉnh khác mặc định. "Sao chép thông số" để dán vào nhật ký chơi thử hoặc gửi cho AI làm mặc định mới.</p>

      <section><h3>Nhật ký sự kiện <button data-act="clear-log" class="mini">Xoá</button></h3>
        <div id="dev-log">${this.logHtml()}</div>
      </section>
    </div>`;
  }

  private say(): void {
    const g = this.host.game();
    const inp = this.el.querySelector('#dev-say') as HTMLInputElement | null;
    if (!g || !inp) return;
    g.devAnnounce(inp.value);
    inp.value = '';
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const g = this.host.game();
    const n = Number(btn.dataset.n);
    const act = btn.dataset.act!;
    if (act === 'close') return this.close();
    if (!g) return;
    switch (act) {
      case 'power': g.devSetPower(!g.power); break;
      case 'auditor-now': g.devAuditorNow(); break;
      case 'auditor-rest': g.devAuditorRest(); break;
      case 'lure': g.devLure({ ...this.host.player.pos }); break;
      case 'say': this.say(); break;
      case 'skip': g.devSkip(n); break;
      case 'to': g.devSkip(n - g.shift.minutes); break;
      case 'freezer': g.devSkipToFreezer(); break;
      case 'speed': this.host.timeScale = n; break;
      case 'night': g.devGoNight(n); break;
      case 'cong': g.devAddCong(n); break;
      case 'quota': g.devAddCong(Math.max(0, g.shift.quota - g.shift.cong)); break;
      case 'holes': g.devSetHoles(n); break;
      case 'order': g.devOrder(btn.dataset.kind as OrderKind); break;
      case 'drift': g.devSetDrift(n); break;
      case 'clear-log': this.clearLog(); break;
      case 'copy': this.copy(btn); return;
      case 'reset': this.resetAll(); break;
    }
    this.render();
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const g = this.host.game();
    if (!g || t.tagName !== 'INPUT' || t.id === 'dev-say') return;
    const d = t.dataset;
    const out = t.parentElement?.querySelector('b');
    if (d.opt === 'pauseOnOpen') {
      this.saved.pauseOnOpen = t.checked;
    } else if (d.flag === 'invisible' || d.flag === 'noDeath') {
      g.dev[d.flag] = t.checked;
    } else if (d.ev) {
      const k = d.ev as keyof EventConfig;
      const v = t.type === 'checkbox' ? t.checked : Number(t.value);
      (this.saved.events as Record<string, number | boolean>)[k] = v;
      g.setEventConfig({ [k]: v });
      if (e.type === 'change') this.render();
      else if (out && k === 'auditorStart') out.textContent = clockOf(Number(t.value));
      else if (out) out.textContent = t.value;
    } else if (d.tune) {
      const def = TUNE_DEFS.find((x) => x.key === d.tune)!;
      const v = Number(t.value) / (def.scale ?? 1);
      this.saved.tuning[def.key] = v;
      g.setTuning({ [def.key]: v });
      if (out) out.textContent = `${fmt(Number(t.value), def.step)} ${def.unit}`;
      t.parentElement?.classList.add('ch');
    } else if (d.pl) {
      const def = PLAYER_DEFS.find((x) => x.key === d.pl)!;
      this.saved.player[def.key] = Number(t.value);
      applyDevSaved(this.saved, this.host.player, this.host.world());
      if (out) out.textContent = `${fmt(Number(t.value), def.step)}${def.unit ? ' ' + def.unit : ''}`;
      t.parentElement?.classList.add('ch');
    } else {
      return;
    }
    this.save();
  }

  private resetAll(): void {
    const g = this.host.game();
    this.saved = { events: {}, tuning: {}, player: {}, pauseOnOpen: this.saved.pauseOnOpen };
    this.save();
    this.host.timeScale = 1;
    if (g) {
      g.resetTuning();
      g.setEventConfig({ ...DEFAULT_EVENTS });
      g.dev.invisible = false;
      g.dev.noDeath = false;
    }
    applyDevSaved(this.saved, this.host.player, this.host.world());
  }

  private copy(btn: HTMLButtonElement): void {
    const g = this.host.game();
    const data = {
      ghiChu: 'Thông số chơi thử Hợp Đồng 30 Đêm',
      dem: g?.night,
      lichSuKien: g?.eventCfg,
      nguoiKiemKe_ghiDe: this.saved.tuning,
      nguoiChoi: { ...PLAYER_DEFAULTS, ...this.saved.player },
    };
    const text = JSON.stringify(data, null, 2);
    const done = () => {
      btn.textContent = 'Đã sao chép ✓';
      setTimeout(() => (btn.textContent = 'Sao chép thông số'), 1500);
    };
    const fallback = () => window.prompt('Sao chép đoạn này:', text);
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
}
