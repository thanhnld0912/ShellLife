// Mức đồ hoạ cho máy yếu. Chọn ở menu (lưu trong trình duyệt); "Tự động" đoán theo card đồ hoạ.
// Ngoài ra trong lúc chơi, độ phân giải tự hạ khi khung hình chậm và tự nâng lại khi máy rảnh.

import type * as THREE from 'three';

export type Quality = 'thap' | 'vua' | 'cao';
export type QualityChoice = Quality | 'auto';

export interface QualitySettings {
  label: string;
  /** Độ phân giải tối đa / tối thiểu (tỉ lệ so với điểm ảnh màn hình). */
  maxPixelRatio: number;
  minPixelRatio: number;
  /** Bóng đổ của đèn pin và đèn máy quét (không chiếu xuyên kệ). */
  shadows: boolean;
  /** Số đèn trần khu bán hàng (đèn điểm, tốn nhất khi vẽ). */
  lamps: 4 | 8;
  /** Đèn riêng cho phòng nghỉ, phòng điện, văn phòng (kho và kho lạnh luôn có). */
  minorRoomLights: boolean;
  /** Hàng hoá vẽ bằng khối hộp đơn giản thay vì model chi tiết (nhẹ hơn khoảng 8 lần). */
  proxyGoods: boolean;
  /** Tầm nhìn xa (m): sương mù dày hơn, vật ở xa không vẽ. */
  far: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  thap: { label: 'Thấp', maxPixelRatio: 0.85, minPixelRatio: 0.5, shadows: false, lamps: 4, minorRoomLights: false, proxyGoods: true, far: 36 },
  vua: { label: 'Vừa', maxPixelRatio: 1.0, minPixelRatio: 0.6, shadows: true, lamps: 4, minorRoomLights: false, proxyGoods: false, far: 46 },
  cao: { label: 'Cao', maxPixelRatio: 1.5, minPixelRatio: 0.75, shadows: true, lamps: 8, minorRoomLights: true, proxyGoods: false, far: 60 },
};

const KEY = 'hd30.quality';

export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'thap' || v === 'vua' || v === 'cao') return v;
  } catch {
    /* không có bộ nhớ trình duyệt */
  }
  return 'auto';
}

export function saveQualityChoice(v: QualityChoice): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* bỏ qua */
  }
}

/** Đoán mức đồ hoạ theo card đồ hoạ và số nhân CPU. */
export function detectQuality(renderer: THREE.WebGLRenderer): Quality {
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    /* không đọc được */
  }
  const weakGpu = /intel|uhd|hd graphics|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render|software/i.test(gpu);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (weakGpu || cores <= 4 || mem <= 4) return 'thap';
  if (/rtx|radeon rx|geforce gtx 1[06-9]|rx [5-7]\d{3}/i.test(gpu)) return 'cao';
  return 'vua';
}

export function resolveQuality(choice: QualityChoice, renderer: THREE.WebGLRenderer): Quality {
  return choice === 'auto' ? detectQuality(renderer) : choice;
}

/**
 * Tự chỉnh độ phân giải theo tốc độ khung hình: đo trung bình mỗi 1,5 giây;
 * dưới 40 khung/giây thì hạ 10%, trên 57 khung/giây liền 2 lần đo thì nâng 5%.
 */
export class ResolutionGovernor {
  private acc = 0;
  private frames = 0;
  private good = 0;
  ratio: number;
  /** Khung hình / giây đo được gần nhất. */
  fps = 60;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private q: QualitySettings,
  ) {
    this.ratio = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    renderer.setPixelRatio(this.ratio);
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
    this.apply(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));
  }

  /** Gọi mỗi khung hình với thời gian thật (giây, chưa bị cắt). */
  frame(rawDt: number): void {
    if (rawDt <= 0 || rawDt > 0.5) return; // tab bị ẩn / đứng hình lúc tải: bỏ qua
    this.acc += rawDt;
    this.frames++;
    if (this.acc < 1.5) return;
    this.fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const max = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio);
    if (this.fps < 40 && this.ratio > this.q.minPixelRatio + 1e-3) {
      this.good = 0;
      this.apply(Math.max(this.q.minPixelRatio, this.ratio * 0.9));
    } else if (this.fps > 57 && this.ratio < max - 1e-3) {
      if (++this.good >= 2) {
        this.good = 0;
        this.apply(Math.min(max, this.ratio * 1.05));
      }
    } else {
      this.good = 0;
    }
  }

  private apply(r: number): void {
    this.ratio = r;
    this.renderer.setPixelRatio(r);
  }
}
