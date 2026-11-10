// Xoay góc nhìn bằng chuột, thay cho phần xoay mặc định của PointerLockControls.
// - Xin "unadjustedMovement" (chuột thô, không gia tốc của Windows) nếu trình duyệt hỗ trợ.
// - Bỏ qua cú nhảy bất thường: Chrome trên Windows đôi khi báo một sự kiện dịch vài trăm px
//   (nhất là ngay sau khi khoá chuột), làm góc nhìn quay ngoắt sang hướng khác.
// - Độ nhạy chỉnh được, lưu trong trình duyệt.

import * as THREE from 'three';

const KEY = 'hopdong30-do-nhay';
export const SENS_MIN = 0.3;
export const SENS_MAX = 2.5;
const BASE = 0.0011; // rad mỗi px ở độ nhạy 1.0 (mặc định cũ của Three.js là 0.002)
const SPIKE = 180; // px trong một sự kiện: lớn hơn thì coi là lỗi
const SETTLE_EVENTS = 3; // bỏ vài sự kiện đầu tiên ngay sau khi khoá chuột

export class MouseLook {
  sensitivity = 1;
  enabled = () => true;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private settle = 0;

  constructor(private camera: THREE.Camera, private dom: HTMLElement) {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v >= SENS_MIN && v <= SENS_MAX) this.sensitivity = v;
    } catch { /* bỏ qua */ }
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.dom) this.settle = SETTLE_EVENTS;
    });
    document.addEventListener('mousemove', (e) => this.onMove(e));
  }

  setSensitivity(v: number): void {
    this.sensitivity = Math.min(SENS_MAX, Math.max(SENS_MIN, v));
    try { localStorage.setItem(KEY, String(this.sensitivity)); } catch { /* bỏ qua */ }
  }

  /** Khoá chuột, ưu tiên chuột thô; trình duyệt không hỗ trợ thì khoá bình thường. */
  lock(): void {
    const el = this.dom as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          try { el.requestPointerLock(); } catch { /* bỏ qua */ }
        });
      }
    } catch {
      el.requestPointerLock();
    }
  }

  private onMove(e: MouseEvent): void {
    if (document.pointerLockElement !== this.dom || !this.enabled()) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    if (Math.abs(dx) > SPIKE || Math.abs(dy) > SPIKE) return;
    const k = BASE * this.sensitivity;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= dx * k;
    this.euler.x -= dy * k;
    const lim = Math.PI / 2 - 0.05;
    this.euler.x = Math.max(-lim, Math.min(lim, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  }
}
