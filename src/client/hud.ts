// Giao diện trên màn hình: đồng hồ, thẻ nhân viên, gợi ý, máy quét, phiếu việc, phiếu đánh giá.

import type { Evaluation, Game } from '../sim/game.ts';
import { MAX_NIGHTS, orderText } from '../sim/game.ts';
import { LITTER_FEE, RECORDS_PER_HOLE, clockOf } from '../sim/shift.ts';
import { formatPrice } from '../sim/products.ts';
import type { V2 } from '../sim/geometry.ts';
import { JOB_COLORS, jobPoint, storeMapSvg, type MapMark } from './storeMap.ts';

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
    const left = s.jobsLeft.length;
    el.hidden = false;
    el.innerHTML =
      `<div class="${left ? 'jobs' : 'jobs done'}"><span>VIỆC ĐƯỢC GIAO ${s.jobsDone}/${s.jobs.length}${left ? '' : ' · XONG'}</span><b>Tab: bìa kẹp + bản đồ</b></div>` +
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
      (cans ? `<div class="soon"><span>Nhặt lại ${cans} lon nước đã ném</span><b>−${formatPrice(cans * LITTER_FEE)} lương</b></div>` : '');
  }

  /** Thẻ nhân viên: số lỗ (3 = hết hợp đồng) và số lần ghi hồ sơ đang tích (3 lần = 1 lỗ). */
  badge(name: string, holes: number, records = 0): void {
    $('badge-name').textContent = name;
    $('holes').querySelectorAll('span').forEach((s, i) => s.classList.toggle('p', i < holes));
    $('badge').classList.toggle('warn', holes >= 2);
    $('records').innerHTML = `HỒ SƠ ${Array.from({ length: RECORDS_PER_HOLE }, (_, i) => `<i class="${i < records ? 'on' : ''}"></i>`).join('')}`;
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

  /** Thanh thể lực (0..1); exhausted: vừa cạn, chưa chạy lại được. */
  stamina(v: number, exhausted: boolean): void {
    ($('stamina-bar') as HTMLElement).style.width = `${Math.round(v * 100)}%`;
    const el = $('stamina');
    el.classList.toggle('out', exhausted);
    el.classList.toggle('low', !exhausted && v < 0.3);
    el.querySelector('span')!.textContent = exhausted ? 'HẾT SỨC · KHÔNG CHẠY ĐƯỢC' : 'THỂ LỰC';
  }

  /** Thẻ món đang cầm: tên, giá, hạn sử dụng (lỗi thì chữ đỏ), tiến độ ăn, phím. null: ẩn. */
  item(info: { name: string; price: string; color: string; hsd: string; bad: boolean; keys: string } | null, progress = 0): void {
    const el = $('item');
    el.hidden = !info;
    if (!info) return;
    $('item-band').style.background = info.color;
    $('item-name').textContent = info.name;
    $('item-price').textContent = info.price;
    const h = $('item-hsd');
    h.textContent = info.hsd;
    h.classList.toggle('bad', info.bad);
    ($('item-bar') as HTMLElement).style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    $('item-keys').textContent = info.keys;
  }

  /** Đau bụng (dòng chữ) và chóng mặt (mờ hình, độ 0..1). */
  sickness(sick: boolean, dizzy: number): void {
    $('sick').hidden = !sick;
    const c = document.querySelector('#app canvas') as HTMLElement | null;
    if (c) c.style.filter = dizzy > 0.01 ? `blur(${(dizzy * 2.6).toFixed(2)}px) saturate(${(1 - dizzy * 0.4).toFixed(2)})` : '';
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

  /**
   * Phiếu việc (Tab): tấm bìa kẹp cầm ở một tay, đưa lên ở góc phải màn hình (không che giữa màn hình, vẫn đi lại được).
   * Đang mở thì ẩn dải phiếu việc và máy quét ở góc phải (bìa kẹp đã có đủ).
   */
  sheet(g: Game, open: boolean, me: V2 = { x: 0, z: 0 }, yaw = 0): void {
    const el = $('sheet');
    el.hidden = !open;
    $('hud').classList.toggle('sheet-open', open);
    if (!open) return;
    const s = g.shift;
    const holes = [0, 1, 2].map((i) => (i < g.holes ? '●' : '○')).join('');
    const marks: MapMark[] = [];
    const items = s.jobs
      .map((j, i) => {
        const n = String(i + 1);
        const color = JOB_COLORS[j.kind];
        if (!j.done) {
          const at = j.kind === 'trash' ? null : jobPoint(g, j.kind, j.target);
          if (at) marks.push({ at, label: n, color });
        }
        let extra = '';
        if (j.kind === 'trash' && !j.done) extra = ` · gom ${s.trashTotal - s.trashFull.size}/${s.trashTotal}, đã đổ ${s.trashDumped}`;
        if (j.kind === 'freezer' && !j.done) {
          const t = Number(j.target);
          extra = s.minutes >= t + 40 ? ' · LỠ MỐC' : s.minutes >= t ? ' · ĐANG TỚI GIỜ' : '';
        }
        return `<li class="${j.done ? 'done' : ''}"><i style="background:${j.done ? '#9a958a' : color}">${n}</i><span>${esc(g.jobLabel(j))}${extra}</span></li>`;
      })
      .join('');
    const letters = 'ABCDEFGHIJKLMNOP';
    const orderItems = s.orders
      .map((o, i) => {
        const L = letters[i % letters.length];
        if (!o.done) {
          const at = jobPoint(g, o.kind, o.section);
          if (at) marks.push({ at, label: L, color: JOB_COLORS[o.kind === 'power' ? 'power' : 'order'] });
        }
        const st = o.done ? (o.late ? 'xong (trễ)' : 'xong') : o.late ? 'QUÁ HẠN' : `hạn ${clockOf(o.due)}`;
        return `<li class="${o.done ? 'done' : o.late ? 'late' : ''}"><i style="background:${o.done ? '#9a958a' : JOB_COLORS[o.kind === 'power' ? 'power' : 'order']}">${L}</i><span>${esc(orderText(o))}</span><b>${st}</b></li>`;
      })
      .join('');
    el.innerHTML = `<div class="clip"></div><div class="paper receipt">
      <h4>Phân công · Đêm ${g.night}/${MAX_NIGHTS} · ${s.clock()}</h4>
      <div class="sm">${esc(g.name.toUpperCase())} · thẻ ${holes} · hồ sơ ${g.records}/${RECORDS_PER_HOLE}${g.voucher ? ' · có PHIẾU KHEN' : ''}</div>
      ${storeMapSvg(g, marks, me, yaw)}
      <div class="sec">VIỆC ĐƯỢC GIAO ${s.jobsDone}/${s.jobs.length} <small>06:00 còn việc chưa xong: bấm 1 lỗ</small></div>
      <ol class="jobs">${items}</ol>
      ${s.orders.length ? `<div class="sec">PHIẾU PHÁT SINH <small>trễ hạn: ghi hồ sơ (${RECORDS_PER_HOLE} lần = 1 lỗ)</small></div><ol class="jobs">${orderItems}</ol>` : ''}
      <div class="sm">06:00 có mặt ở MÁY CHẤM CÔNG (kho) · Tab: cất phiếu</div></div><div class="thumb"></div>`;
  }

  evaluation(g: Game, ev: Evaluation, onNext: () => void): void {
    const holes = [0, 1, 2].map((i) => (i < ev.holesTotal ? '●' : '○')).join(' ');
    const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    $('eval-body').innerHTML = `
      <h4>Phiếu đánh giá · Đêm ${ev.night}/${MAX_NIGHTS}</h4>
      <div class="sm">In lúc 06:00 · ${esc(g.name.toUpperCase())}</div><hr>
      ${row('Việc được giao', `${ev.jobsDone}/${ev.jobsTotal} xong`, ev.jobsLeft.length ? 'bad' : 'good')}
      ${ev.jobsLeft.map((t) => `<div class="sm bad">· chưa xong: ${esc(t)}</div>`).join('')}
      ${row('Phiếu phát sinh', `${ev.ordersDone}/${ev.ordersTotal} xong${ev.late ? ` · ${ev.late} trễ` : ''}`, ev.late ? 'bad' : ev.ordersTotal ? 'good' : '')}
      ${row('Điểm danh 06:00', ev.atClock ? 'Đã chấm công' : 'VẮNG', ev.atClock ? '' : 'bad')}
      ${ev.defectsTotal ? row('Hàng lỗi đã dọn', `${ev.defectsRemoved}/${ev.defectsTotal}${ev.defectsLeft ? ` · còn ${ev.defectsLeft} trên kệ` : ''}`, ev.defectsLeft ? 'bad' : 'good') : ''}<hr>
      <div class="sm"><b>Ghi hồ sơ đêm nay</b> (${RECORDS_PER_HOLE} lần = 1 lỗ)</div>
      ${ev.records.map((t) => `<div class="sm bad">· ${esc(t)}</div>`).join('') || '<div class="sm">· Không có.</div>'}
      ${row('Hồ sơ đang tích', `${ev.recordsTotal}/${RECORDS_PER_HOLE}${ev.recordHoles ? ` · đã quy ra ${ev.recordHoles} lỗ` : ''}`, ev.recordHoles ? 'bad' : '')}<hr>
      ${row('Lương đêm', formatPrice(ev.wageBase))}
      ${ev.eatenValue ? row(`Trừ ${ev.eatenCount} món đã ăn uống`, `− ${formatPrice(ev.eatenValue)}`, 'bad') : ''}
      ${ev.litterFee ? row(`Phí dọn ${ev.litterLeft} lon nước trên sàn`, `− ${formatPrice(ev.litterFee)}`, 'bad') : ''}
      ${row('Thực nhận', formatPrice(ev.wage), 'good')}<hr>
      ${ev.reasons.map((t) => `<div class="bad">BẤM LỖ: ${esc(t)}</div>`).join('') || '<div>Không bị bấm lỗ.</div>'}
      ${ev.voucherUsed ? '<div class="good">Đã dùng PHIẾU KHEN: xoá 1 lỗ.</div>' : ''}
      ${ev.voucherEarned ? '<div class="good">Xong hết việc, không trễ, không ghi hồ sơ: nhận PHIẾU KHEN (tự xoá lỗ kế tiếp).</div>' : ''}
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
