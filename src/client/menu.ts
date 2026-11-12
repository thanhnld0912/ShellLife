// Menu chính (Chơi · Hướng dẫn chơi · Cài đặt), bảng Cài đặt (đồ hoạ, âm thanh, voice chat, điều khiển), Hướng dẫn chơi
// và menu tạm dừng. Cài đặt lưu trong trình duyệt (settings.ts) và áp dụng ngay qua onChange.

import { DEFAULT_SETTINGS, keyName, loadSettings, saveSettings, type Settings } from './settings.ts';
import type { MouseLook } from './mouseLook.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

type NumKey = 'fov' | 'brightness' | 'master' | 'music' | 'sfx' | 'announcer' | 'voiceVolume' | 'micGain';
type BoolKey = 'showFps' | 'subtitles' | 'voiceEnabled' | 'voiceProximity';
const NUMS: NumKey[] = ['fov', 'brightness', 'master', 'music', 'sfx', 'announcer', 'voiceVolume', 'micGain'];
const BOOLS: BoolKey[] = ['showFps', 'subtitles', 'voiceEnabled', 'voiceProximity'];

export interface MenuHost {
  look: MouseLook;
  /** Áp dụng cài đặt (âm lượng, góc nhìn, độ sáng…). */
  apply(s: Settings): void;
  /** Đang trong ca (đổi chất lượng đồ hoạ chỉ có hiệu lực từ ca sau). */
  inGame(): boolean;
  /** Bấm "Nghe thử" âm thanh. */
  testSound(): void;
  /** Mở / đóng một bảng (settings / guide) để main biết mà giữ tạm dừng. */
  onOverlay(open: boolean): void;
  resume(): void;
  quitToMenu(): void;
}

export class MenuUI {
  settings: Settings = loadSettings();
  private capturing = false;
  private micStream: MediaStream | null = null;
  private micRaf = 0;

  constructor(private host: MenuHost) {
    // Điều hướng màn hình menu chính
    document.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const go = b.dataset.go!;
        if (go === 'settings' || go === 'guide') this.open(go);
        else this.screen(go);
      }),
    );
    document.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => this.open(b.dataset.open as 'settings' | 'guide')));
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.close(b.dataset.close as 'settings' | 'guide')));
    // Thẻ (tab) trong cài đặt / hướng dẫn
    for (const win of ['settings', 'guide']) {
      const root = $(win);
      root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((t) =>
        t.addEventListener('click', () => {
          root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === t));
          root.querySelectorAll<HTMLElement>('.tab-body').forEach((body) => (body.hidden = body.dataset.body !== t.dataset.tab));
          if (t.dataset.tab !== 'voice') this.stopMic();
        }),
      );
      // bấm ra ngoài khung thì đóng
      root.addEventListener('mousedown', (e) => {
        if (e.target === root) this.close(win as 'settings' | 'guide');
      });
    }
    $('resume').addEventListener('click', () => host.resume());
    $('to-menu').addEventListener('click', () => {
      if (confirm('Về menu chính? Ca làm việc đang chơi sẽ bị huỷ.')) host.quitToMenu();
    });
    this.bindSettings();
    window.addEventListener('keydown', (e) => {
      if (this.capturing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') this.settings.voiceKey = e.code;
        this.capturing = false;
        this.commit();
        return;
      }
      if (e.code === 'Escape' && this.overlayOpen) {
        e.preventDefault();
        this.close($('settings').hidden ? 'guide' : 'settings');
      }
    }, true);
  }

  get overlayOpen(): boolean {
    return !$('settings').hidden || !$('guide').hidden;
  }

  /** Màn hình trong menu chính: main / play. */
  screen(name: string): void {
    document.querySelectorAll<HTMLElement>('#menu .menu-screen').forEach((s) => (s.hidden = s.dataset.screen !== name));
    if (name === 'play') setTimeout(() => $('name').focus(), 30);
  }

  open(which: 'settings' | 'guide'): void {
    $(which).hidden = false;
    $('quality-later').hidden = !this.host.inGame();
    this.host.onOverlay(true);
  }

  close(which: 'settings' | 'guide'): void {
    $(which).hidden = true;
    if (which === 'settings') this.stopMic();
    this.host.onOverlay(this.overlayOpen);
  }

  private bindSettings(): void {
    for (const k of NUMS) {
      const el = $<HTMLInputElement>(`set-${k}`);
      el.addEventListener('input', () => {
        this.settings[k] = Number(el.value);
        this.commit(false);
      });
    }
    for (const k of BOOLS) {
      const el = $<HTMLInputElement>(`set-${k}`);
      el.addEventListener('change', () => {
        this.settings[k] = el.checked;
        this.commit(false);
      });
    }
    const mode = $<HTMLSelectElement>('set-voiceMode');
    mode.addEventListener('change', () => {
      this.settings.voiceMode = mode.value as Settings['voiceMode'];
      this.commit();
    });
    const mic = $<HTMLSelectElement>('set-micId');
    mic.addEventListener('change', () => {
      this.settings.micId = mic.value;
      this.commit();
      if (this.micStream) void this.startMic();
    });
    $('set-voiceKey').addEventListener('click', () => {
      this.capturing = true;
      $('set-voiceKey').textContent = 'Bấm một phím…';
    });
    $('mic-test').addEventListener('click', () => (this.micStream ? this.stopMic() : void this.startMic()));
    $('snd-test').addEventListener('click', () => this.host.testSound());
    $('set-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.host.look.setSensitivity(1);
      this.commit();
    });
    // Độ nhạy chuột (lưu ở mouseLook.ts)
    const sens = $<HTMLInputElement>('sens');
    sens.addEventListener('input', () => {
      this.host.look.setSensitivity(Number(sens.value));
      $('sens-val').textContent = this.host.look.sensitivity.toFixed(2);
    });
    this.render();
    this.host.apply(this.settings);
  }

  private commit(rerender = true): void {
    saveSettings(this.settings);
    this.host.apply(this.settings);
    if (rerender) this.render();
    else this.renderOuts();
  }

  private renderOuts(): void {
    const s = this.settings;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const out: Record<NumKey, string> = {
      fov: `${s.fov}°`, brightness: s.brightness.toFixed(2), master: pct(s.master), music: pct(s.music), sfx: pct(s.sfx),
      announcer: pct(s.announcer), voiceVolume: pct(s.voiceVolume), micGain: pct(s.micGain),
    };
    for (const k of NUMS) {
      const b = document.querySelector<HTMLElement>(`[data-out="${k}"]`);
      if (b) b.textContent = out[k];
    }
  }

  private render(): void {
    const s = this.settings;
    for (const k of NUMS) $<HTMLInputElement>(`set-${k}`).value = String(s[k]);
    for (const k of BOOLS) $<HTMLInputElement>(`set-${k}`).checked = s[k];
    $<HTMLSelectElement>('set-voiceMode').value = s.voiceMode;
    $('set-voiceKey').textContent = `Giữ ${keyName(s.voiceKey)}`;
    $<HTMLSelectElement>('set-micId').value = s.micId;
    $<HTMLInputElement>('sens').value = String(this.host.look.sensitivity);
    $('sens-val').textContent = this.host.look.sensitivity.toFixed(2);
    this.renderOuts();
  }

  /** Thử micro: xin quyền, liệt kê micro, hiện mức âm vào (chưa gửi đi đâu cả). */
  private async startMic(): Promise<void> {
    this.stopMic();
    const info = $('mic-info');
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: this.settings.micId ? { deviceId: { exact: this.settings.micId } } : true });
    } catch {
      info.textContent = 'Không mở được micro (chưa cho phép, hoặc máy không có micro).';
      return;
    }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const sel = $<HTMLSelectElement>('set-micId');
    sel.innerHTML = '<option value="">Mặc định của máy</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Micro ${i + 1}`}</option>`).join('');
    sel.value = this.settings.micId;
    info.textContent = 'Nói thử: vạch xanh nhảy theo giọng. Âm thanh chỉ ở trên máy này.';
    $('mic-test').textContent = '■ Dừng thử';
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(this.micStream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!this.micStream) {
        void ctx.close();
        return;
      }
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      $('mic-meter').style.width = `${Math.min(100, peak * 100 * (0.5 + this.settings.micGain * 1.5))}%`;
      this.micRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  private stopMic(): void {
    if (!this.micStream) return;
    this.micStream.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    cancelAnimationFrame(this.micRaf);
    $('mic-meter').style.width = '0%';
    $('mic-test').textContent = '🎙 Thử micro';
  }
}
