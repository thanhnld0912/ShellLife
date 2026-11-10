// Giao diện trên màn hình: đồng hồ, thẻ nhân viên, gợi ý, máy quét, phiếu việc, phiếu đánh giá.

import type { Evaluation, Game } from '../sim/game.ts';
import { MAX_NIGHTS } from '../sim/game.ts';
import { CONG, FREEZER_TIMES, clockOf } from '../sim/shift.ts';
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
    el.innerHTML = `
      <h4>Phiếu việc · Đêm ${g.night}/${MAX_NIGHTS}</h4>
      <div class="sm">Nhân viên: ${esc(g.name.toUpperCase())} · Bản thử 1 người: làm tất cả các vai</div><hr>
      ${row('Chỉ tiêu', `${s.quota} công`)}
      ${row('Việc an toàn tính tối đa', `${s.safeCap} công`)}
      ${row('Thẻ', holes, g.holes >= 2 ? 'bad' : '')}<hr>
      ${row('Tiến độ', `${s.cong}/${s.quota}`, s.cong >= s.quota ? 'good' : '')}
      ${row('Công an toàn', `${Math.min(s.earnedSafe, s.safeCap)}/${s.safeCap}${s.safeFull ? ' · ĐÃ ĐỦ' : ''}`, s.safeFull ? 'bad' : '')}<hr>
      ${row(`Quét kệ · ${CONG.scan} công · rủi ro`, `${s.scanned.size}/${SECTIONS.length}`)}
      ${row(`Xếp kệ THIẾU HÀNG · ${CONG.restock} công · rủi ro`, `${s.restocked.size}/${s.restockTotal}`)}
      ${row(`Nhiệt độ tủ đông · ${CONG.freezer} công · an toàn`, `${s.freezerDone.size}/${FREEZER_TIMES.length}`)}
      <div class="sm">${next !== null ? `Mốc ghi nhiệt độ kế tiếp: ${clockOf(next)}` : 'Đã hết mốc ghi nhiệt độ.'}</div><hr>
      ${row('06:00', 'Có mặt ở QUẦY để điểm danh')}
      <div class="sm">Bấm Tab để đóng.</div>`;
  }

  evaluation(g: Game, ev: Evaluation, onNext: () => void): void {
    const holes = [0, 1, 2].map((i) => (i < ev.holesTotal ? '●' : '○')).join(' ');
    const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    $('eval-body').innerHTML = `
      <h4>Phiếu đánh giá · Đêm ${ev.night}/${MAX_NIGHTS}</h4>
      <div class="sm">In lúc 06:00</div><hr>
      ${row('Nhân viên', esc(g.name.toUpperCase()))}
      ${row('Công', `${ev.cong}/${ev.quota}`, ev.cong >= ev.quota ? 'good' : 'bad')}
      ${row('Công an toàn', `${Math.min(ev.safeEarned, ev.safeCap)}/${ev.safeCap}`)}
      ${row('Điểm danh 06:00', ev.atCounter ? 'Có mặt' : 'VẮNG', ev.atCounter ? '' : 'bad')}<hr>
      ${ev.reasons.map((r) => `<div class="bad">CẢNH CÁO: ${esc(r)}</div>`).join('') || '<div>Không có cảnh cáo.</div>'}
      ${row('Thẻ', holes, ev.holesTotal >= 2 ? 'bad' : '')}<hr>
      <div class="sm">Nhận xét:</div>
      ${ev.notes.map((n) => `<div class="sm">· ${esc(n)}</div>`).join('')}`;
    const btn = $<HTMLButtonElement>('eval-next');
    btn.textContent = ev.dead ? 'Tiếp tục' : ev.final ? 'Nhận phiếu lương' : `Nhận ca đêm ${ev.night + 1}`;
    btn.onclick = onNext;
    this.show('eval', true);
  }

  death(stage: 'red' | 'black' | 'off', name = '', reason: 'scan' | 'holes' = 'scan'): void {
    const el = $('death');
    el.hidden = stage === 'off';
    el.dataset.stage = stage;
    $('death-line').textContent =
      reason === 'scan'
        ? `Nhân viên ${name}: đã kiểm đếm. Xin cảm ơn.`
        : `Nhân viên ${name}: chấm dứt hợp đồng. Xin cảm ơn.`;
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
