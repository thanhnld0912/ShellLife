// Giao diện trên màn hình: đồng hồ, thẻ nhân viên, gợi ý, máy quét, phiếu việc, phiếu đánh giá.

import type { Evaluation, Game } from '../sim/game.ts';
import { MAX_NIGHTS, orderText } from '../sim/game.ts';
import { CONG, FREEZER_TIMES, LITTER_PENALTY, clockOf } from '../sim/shift.ts';
import { SECTIONS } from '../sim/layout.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Hud {
  private toastT = 0;
  private announceT = 0;

  show(id: string, on: boolean): void {
    $(id).hidden = !on;
  }

  clock(g: Game): void {
    $('clock').textContent = `ĐÊM ${g.night}/${MAX_NIGHTS} · THỬ VIỆC · ${g.shift.clock()}`;
  }

  /**
   * Dải phiếu việc dưới đồng hồ: phiếu chưa xong, hạn gần nhất trước.
   * Còn ít hơn 25 phút trong game (~14 giây thật) thì vàng; quá hạn thì đỏ.
   */
  orders(g: Game): void {
    const el = $('orders');
    const s = g.shift;
    const open = s.openOrders;
    const cans = s.litter.length;
    el.hidden = !open.length && !cans;
    if (el.hidden) return;
    el.innerHTML =
      open
        .slice(0, 4)
        .map((o) => {
          const left = o.due - s.minutes;
          const cls = o.late ? 'late' : left < 25 ? 'soon' : '';
          const when = o.late ? 'QUÁ HẠN' : `hạn ${clockOf(o.due)}`;
          return `<div class="${cls}"><span>${esc(orderText(o))}</span><b>${when}</b></div>`;
        })
        .join('') +
      (open.length > 4 ? `<div class="more">+${open.length - 4} phiếu nữa · Tab</div>` : '') +
      (cans ? `<div class="soon"><span>Nhặt lại ${cans} lon nước đã ném</span><b>−${cans * LITTER_PENALTY} công lúc 06:00</b></div>` : '');
  }

  badge(name: string, holes: number): void {
    $('badge-name').textContent = name;
    $('holes').querySelectorAll('span').forEach((s, i) => s.classList.toggle('p', i < holes));
    $('badge').classList.toggle('warn', holes >= 2);
  }

  hint(text: string): void {
    $('hint').textContent = text;
  }

  scanner(name: string | null, progress = 0, done = false): void {
    const el = $('scanner');
    el.hidden = !name;
    if (!name) return;
    $('scan-name').textContent = name;
    ($('scan-bar') as HTMLElement).style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    $('scan-state').textContent = done ? 'ĐÃ QUÉT TRONG CA' : progress > 0 ? 'ĐANG QUÉT… BÍP' : 'GIỮ F ĐỂ QUÉT';
    el.classList.toggle('done', done);
  }

  toast(text: string, good: boolean): void {
    const el = $('toast');
    el.textContent = text;
    el.className = good ? 'good show' : 'bad show';
    this.toastT = 2.6;
  }

  announce(text: string): void {
    const el = $('announce');
    el.innerHTML = `<span>LOA</span>${esc(text)}`;
    el.classList.add('show');
    this.announceT = Math.max(4, text.length * 0.075);
  }

  count(n: number): void {
    const el = $('count');
    el.textContent = n === 1 ? 'Một…' : n === 2 ? 'Hai…' : '';
    el.classList.toggle('show', n > 0);
    $('vignette').classList.toggle('show', n > 0);
  }

  tick(dt: number): void {
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').classList.remove('show');
    if (this.announceT > 0 && (this.announceT -= dt) <= 0) $('announce').classList.remove('show');
  }

  sheet(g: Game, open: boolean): void {
    const el = $('sheet');
    el.hidden = !open;
    if (!open) return;
    const s = g.shift;
    const holes = [0, 1, 2].map((i) => (i < g.holes ? '●' : '○')).join(' ');
    const next = s.nextFreezer();
    const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    const khen = Math.ceil(s.quota * 1.5);
    const orderRows = s.orders.length
      ? s.orders
          .map((o) => {
            const st = o.done ? (o.late ? 'xong (trễ)' : 'xong') : o.late ? 'QUÁ HẠN' : `hạn ${clockOf(o.due)}`;
            return row(esc(orderText(o)), st, o.late ? 'bad' : o.done ? 'good' : '');
          })
          .join('')
      : '<div class="sm">Chưa có phiếu nào. Máy in sẽ giao thêm trong ca.</div>';
    el.innerHTML = `
      <h4>Phiếu việc · Đêm ${g.night}/${MAX_NIGHTS}</h4>
      <div class="sm">Nhân viên: ${esc(g.name.toUpperCase())} · Bản thử 1 người: làm tất cả các vai</div><hr>
      ${row('Chỉ tiêu (tối thiểu)', `${s.quota} công`)}
      ${row('Vượt 150% → phiếu khen', `${khen} công`)}
      ${row('Việc an toàn tính tối đa', `${s.safeCap} công`)}
      ${row('Thẻ', holes + (g.voucher ? ' · có PHIẾU KHEN' : ''), g.holes >= 2 ? 'bad' : '')}<hr>
      ${row('Tiến độ', `${s.cong}/${s.quota}`, s.cong >= khen ? 'good' : s.cong >= s.quota ? '' : 'bad')}
      ${row('Công an toàn', `${Math.min(s.earnedSafe, s.safeCap)}/${s.safeCap}${s.safeFull ? ' · ĐÃ ĐỦ' : ''}`, s.safeFull ? 'bad' : '')}<hr>
      <div class="sm"><b>Phiếu việc được giao</b> · trễ hạn phiếu nào cũng bị ghi hồ sơ</div>
      ${orderRows}<hr>
      ${row(`Quét kệ · ${CONG.scan} công · rủi ro`, `${s.scanned.size}/${SECTIONS.length}`)}
      ${row(`Xếp kệ THIẾU HÀNG · ${CONG.restock} công · rủi ro`, `${s.restocked.size}/${s.restockTotal}`)}
      ${row(`Xếp tủ lạnh HẾT HÀNG · ${CONG.coldRestock} công · rủi ro`, `${s.coldRestocked.size}/${s.coldTotal}`)}
      ${row(`Đơn gấp ra quầy · ${CONG.deliver} công · rủi ro`, `${s.orders.filter((o) => o.kind === 'deliver' && o.done).length}/${s.orders.filter((o) => o.kind === 'deliver').length}`)}
      ${row(`Nhiệt độ tủ đông · ${CONG.freezer} công · an toàn`, `${s.freezerDone.size}/${FREEZER_TIMES.length}`)}
      ${row(`Lon nước đã ném còn trên sàn · −${LITTER_PENALTY} công/lon`, `${s.litter.length} lon`, s.litter.length ? 'bad' : '')}
      <div class="sm">${next !== null ? `Mốc ghi nhiệt độ kế tiếp: ${clockOf(next)}` : 'Đã hết mốc ghi nhiệt độ.'}</div><hr>
      ${row('06:00', 'Chấm công ở MÁY CHẤM CÔNG (trong kho)')}
      <div class="sm">Bấm Tab để đóng.</div>`;
  }

  evaluation(g: Game, ev: Evaluation, onNext: () => void): void {
    const holes = [0, 1, 2].map((i) => (i < ev.holesTotal ? '●' : '○')).join(' ');
    const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    $('eval-body').innerHTML = `
      <h4>Phiếu đánh giá · Đêm ${ev.night}/${MAX_NIGHTS}</h4>
      <div class="sm">In lúc 06:00</div><hr>
      ${row('Nhân viên', esc(g.name.toUpperCase()))}
      ${ev.litterPenalty ? row(`Trừ ${ev.litterLeft} lon nước để lại trên sàn`, `${ev.congBeforeLitter} − ${ev.litterPenalty}`, 'bad') : ''}
      ${ev.lateInPenalty ? row('Chấm công vào ca trễ', `− ${ev.lateInPenalty}`, 'bad') : ''}
      ${row('Công', `${ev.cong}/${ev.quota}`, ev.cong >= ev.quota ? 'good' : 'bad')}
      ${row('Công an toàn', `${Math.min(ev.safeEarned, ev.safeCap)}/${ev.safeCap}`)}
      ${row('Phiếu việc', `${ev.ordersDone}/${ev.ordersTotal} xong${ev.late ? ` · ${ev.late} trễ` : ''}`, ev.late ? 'bad' : ev.ordersTotal ? 'good' : '')}
      ${row('Điểm danh 06:00', ev.atClock ? 'Đã chấm công' : 'VẮNG', ev.atClock ? '' : 'bad')}<hr>
      ${ev.reasons.map((r) => `<div class="bad">CẢNH CÁO: ${esc(r)}</div>`).join('') || '<div>Không có cảnh cáo.</div>'}
      ${ev.voucherUsed ? '<div class="good">Đã dùng PHIẾU KHEN: xoá 1 lỗ.</div>' : ''}
      ${ev.voucherEarned ? `<div class="good">Vượt 150% chỉ tiêu: nhận PHIẾU KHEN (tự xoá lỗ kế tiếp).</div>` : ''}
      ${row('Thẻ', holes, ev.holesTotal >= 2 ? 'bad' : '')}<hr>
      <div class="sm">Nhận xét:</div>
      ${ev.notes.map((n) => `<div class="sm">· ${esc(n)}</div>`).join('')}`;
    const btn = $<HTMLButtonElement>('eval-next');
    btn.textContent = ev.dead ? 'Tiếp tục' : ev.final ? 'Nhận phiếu lương' : `Nhận ca đêm ${ev.night + 1}`;
    btn.onclick = onNext;
    this.show('eval', true);
  }

  /**
   * red: viền đỏ (vẫn nhìn thấy cảnh phía sau) · cine: khung phim + phụ đề (cảnh đóng thùng)
   * black: màn đen "Hồ sơ đã được lưu kho" · off: tắt.
   */
  death(stage: 'red' | 'cine' | 'black' | 'off', name = '', reason: 'scan' | 'holes' = 'scan'): void {
    const el = $('death');
    el.hidden = stage === 'off';
    el.dataset.stage = stage;
    const line =
      reason === 'scan'
        ? `Nhân viên ${name}: đã kiểm đếm. Xin cảm ơn.`
        : `Nhân viên ${name}: chấm dứt hợp đồng. Xin cảm ơn.`;
    // Bị đếm thì lúc lao tới chỉ có tiếng bíp; câu "đã kiểm đếm" hiện ở cảnh đóng thùng
    $('death-line').textContent = reason === 'scan' ? '' : line;
    $('death-cine').textContent = line;
  }

  spectate(label: string | null): void {
    $('spectate').hidden = label === null;
    if (label) $('spec-cam').textContent = label;
  }

  debug(text: string | null): void {
    $('debug').hidden = text === null;
    if (text) $('debug').textContent = text;
  }
}
