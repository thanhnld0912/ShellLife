// Âm thanh tạm thời, tổng hợp bằng Web Audio (chưa cần file âm thanh).
// Loa dùng giọng đọc tiếng Việt của trình duyệt nếu máy có; nếu không thì chỉ hiện chữ.

export interface P3 { x: number; y: number; z: number }

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private vi: SpeechSynthesisVoice | null = null;

  get ready(): boolean {
    return !!this.ctx;
  }

  get hasVietnameseVoice(): boolean {
    return !!this.vi;
  }

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startHum();
    this.pickVoice();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => this.pickVoice();
  }

  private pickVoice(): void {
    if (!('speechSynthesis' in window)) return;
    this.vi = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('vi')) ?? null;
  }

  /** Tiếng ù của đèn huỳnh quang, luôn chạy nền. */
  private startHum(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.018;
    g.connect(this.master);
    [100, 200, 300].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f + i * 0.3;
      const og = ctx.createGain();
      og.gain.value = [1, 0.35, 0.12][i];
      o.connect(og).connect(g);
      o.start();
    });
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.01;
    n.connect(bp).connect(ng).connect(this.master);
    n.start();
  }

  listener(pos: P3, fwd: P3): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  private out(pos?: P3): AudioNode {
    if (!pos) return this.master;
    const p = new PannerNode(this.ctx!, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1.5,
      maxDistance: 40,
      rolloffFactor: 1.3,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    p.connect(this.master);
    return p;
  }

  tone(freq: number, dur: number, vol: number, pos?: P3, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + Math.max(0.012, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.out(pos));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Tiếng bước chân / va chạm ngắn. */
  click(pos: P3, vol: number, cutoff = 700): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    s.connect(f).connect(g).connect(this.out(pos));
    s.start(t, Math.random() * 0.5, 0.1);
  }

  clank(pos: P3): void {
    this.tone(1400, 0.08, 0.22, pos, 'triangle');
    this.tone(2150, 0.05, 0.12, pos, 'triangle');
    this.click(pos, 0.5, 2500);
  }

  /** Đọc bằng giọng tiếng Việt. Trả về false nếu máy không có giọng tiếng Việt. */
  speak(text: string, rate = 0.92): boolean {
    if (!this.vi || !('speechSynthesis' in window)) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.vi;
    u.lang = this.vi.lang;
    u.rate = rate;
    u.pitch = 0.85;
    u.volume = 0.85;
    speechSynthesis.speak(u);
    return true;
  }

  cancelSpeech(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
