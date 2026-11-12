// "Đồng nghiệp ảo" (bật trong bảng sự kiện, phím P): giả làm người chơi thứ 2 để thử trước những thứ của chế độ nhiều người
// khi chưa có chơi mạng:
//   - đi theo sau mình (theo đúng đường mình đã đi nên không xuyên kệ), bắt chước: xem phiếu việc (Tab), chạy, soi đèn pin
//     → nhìn lại phía sau là thấy động tác người khác thấy khi mình bấm Tab;
//   - mình cầm một đầu KIỆN HÀNG thì nó chạy tới cầm đầu kia: hai người khiêng (nhanh, êm) thay vì kéo lê một mình.
// Người Kiểm Kê không nhìn thấy đồng nghiệp ảo (chỉ để thử).

import type * as THREE from 'three';
import type { V2 } from '../sim/geometry.ts';
import type { ModelLib } from '../render/models.ts';
import { RemotePlayerView, type RemoteState } from '../render/remotePlayer.ts';
import { BULKY_MOVE } from '../sim/game.ts';

/** Trạng thái của mình (người chơi) mà đồng nghiệp ảo bắt chước. */
export interface MeState {
  pos: V2;
  running: boolean;
  sneak: boolean;
  sheet: boolean;
  light: boolean;
}

const FOLLOW = 1.7;

export class CoWorker {
  readonly view: RemotePlayerView;
  pos: V2 = { x: 0, z: 0 };
  private yaw = 0;
  private trail: V2[] = [];
  private sheet = false;
  private sheetT = 0;
  private active = false;

  constructor(scene: THREE.Scene, models: ModelLib | null) {
    this.view = new RemotePlayerView(scene, models);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Bật / tắt. Bật thì xuất hiện ngay sau lưng mình. */
  setActive(on: boolean, me: V2, meYaw: number): void {
    if (on === this.active) return;
    this.active = on;
    this.view.visible = on;
    this.trail = [];
    if (on) {
      this.pos = { x: me.x - Math.sin(meYaw) * 0.9, z: me.z - Math.cos(meYaw) * 0.9 };
      this.yaw = meYaw;
      this.trail.push({ ...this.pos });
      this.view.place(this.pos, meYaw);
    }
  }

  /**
   * bulky: kiện mình đang khiêng mà đồng nghiệp ảo cầm đầu kia (null nếu không). Khi đó nó đứng ở đầu trước của kiện,
   * cùng hướng với mình (kiện ở sau lưng nó).
   */
  update(dt: number, me: MeState, bulky: { pos: V2; yaw: number } | null): void {
    if (!this.active) return;
    // Nhớ đường mình đã đi
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(me.pos.x - last.x, me.pos.z - last.z) > 0.2) {
      this.trail.push({ ...me.pos });
      if (this.trail.length > 80) this.trail.shift();
    }
    // Bắt chước xem phiếu việc, chậm nửa nhịp
    if (me.sheet !== this.sheet) {
      this.sheetT += dt;
      if (this.sheetT > 0.35) {
        this.sheet = me.sheet;
        this.sheetT = 0;
      }
    } else this.sheetT = 0;

    let target: V2;
    let faceYaw: number | null = null;
    if (bulky) {
      const d = BULKY_MOVE.reach;
      target = { x: bulky.pos.x + Math.sin(bulky.yaw) * d, z: bulky.pos.z + Math.cos(bulky.yaw) * d };
      faceYaw = bulky.yaw;
    } else {
      target = this.followPoint(me.pos);
    }
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const vmax = bulky ? 6 : me.running ? 4.2 : 3;
    const step = Math.min(dist, vmax * dt);
    if (dist > 0.001) {
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
    }
    const speed = step / Math.max(dt, 1e-3);
    const moving = speed > 0.25;
    if (faceYaw !== null) this.yaw = faceYaw;
    else if (moving) this.yaw = Math.atan2(dx, dz);
    else this.yaw = Math.atan2(me.pos.x - this.pos.x, me.pos.z - this.pos.z); // đứng yên thì quay về phía mình
    const st: RemoteState = {
      pos: this.pos,
      yaw: this.yaw,
      moving,
      running: !bulky && speed > 2.8,
      sneak: me.sneak,
      sheet: this.sheet && !bulky,
      carry: null,
      bulky: bulky ? 'front' : null,
      light: me.light,
    };
    this.view.update(st, dt);
  }

  /** Điểm trên đường mình đã đi, cách mình FOLLOW mét (đi theo đúng lối, không cắt góc xuyên kệ). */
  private followPoint(me: V2): V2 {
    let acc = Math.hypot(this.trail[this.trail.length - 1].x - me.x, this.trail[this.trail.length - 1].z - me.z);
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i];
      const b = this.trail[i - 1];
      const seg = Math.hypot(a.x - b.x, a.z - b.z);
      if (acc + seg >= FOLLOW) {
        const t = (FOLLOW - acc) / seg;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
      acc += seg;
    }
    // Đường còn ngắn: đứng yên chỗ cũ nếu đã đủ gần
    return Math.hypot(this.pos.x - me.x, this.pos.z - me.z) > FOLLOW ? this.trail[0] : this.pos;
  }
}
