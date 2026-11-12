// Người chơi KHÁC nhìn từ ngoài vào (model nhan_vien_ngo.glb): chọn động tác theo trạng thái gửi qua mạng.
// Hiện dùng cho "đồng nghiệp ảo" (bảng sự kiện) để thử; sang giai đoạn 2 (chơi mạng) mỗi người chơi khác là một RemotePlayerView.
//
// Động tác: đứng / đi / chạy / bê thùng / soi đèn pin / XEM PHIẾU VIỆC (giơ bảng kẹp, cúi nhìn: người đó đang bấm Tab)
// / KHIÊNG kiện hàng (người đi sau: tay nắm quai phía trước; người đi trước: tay vòng ra sau).

import * as THREE from 'three';
import type { V2 } from '../sim/geometry.ts';
import { playClip, type ModelInstance, type ModelLib } from './models.ts';

export interface RemoteState {
  pos: V2;
  /** Hướng nhìn: hướng tới = (sin yaw, cos yaw). */
  yaw: number;
  moving: boolean;
  running: boolean;
  sneak: boolean;
  /** Đang xem phiếu việc (bấm Tab). */
  sheet: boolean;
  carry: 'dry' | 'cold' | null;
  /** Đang khiêng kiện hàng: 'back' cầm đầu sau (kiện ở trước mặt), 'front' cầm đầu trước (kiện ở sau lưng). */
  bulky: 'back' | 'front' | null;
  light: boolean;
}

export class RemotePlayerView {
  readonly root = new THREE.Group();
  private inst: ModelInstance | null;
  private action: THREE.AnimationAction | null = null;
  private clip = '';
  private box: THREE.Object3D | null;
  private yaw = 0;

  constructor(scene: THREE.Scene, models: ModelLib | null) {
    this.inst = models?.instance('nhan_vien_ngo') ?? models?.instance('nhan_vien') ?? null;
    if (this.inst) {
      this.root.add(this.inst.root);
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.0, 4, 8), new THREE.MeshLambertMaterial({ color: 0x7a1f1f }));
      body.position.y = 0.8;
      this.root.add(body);
    }
    // Thùng hàng ôm trước bụng khi bê thùng
    this.box = models?.static('thung_carton') ?? null;
    if (this.box) {
      this.box.scale.setScalar(0.72);
      this.box.position.set(0, 0.62, 0.34);
      this.box.visible = false;
      this.root.add(this.box);
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Nhảy tới chỗ mới (không trượt mượt). */
  place(p: V2, yaw: number): void {
    this.root.position.set(p.x, 0, p.z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  update(st: RemoteState, dt: number): void {
    // Trượt mượt về vị trí / hướng nhận được (gói tin mạng tới thưa)
    const k = Math.min(1, dt * 12);
    this.root.position.x += (st.pos.x - this.root.position.x) * k;
    this.root.position.z += (st.pos.z - this.root.position.z) * k;
    let dy = st.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 10);
    this.root.rotation.y = this.yaw;
    if (this.box) this.box.visible = !!st.carry && !st.bulky;

    let name = 'dung';
    let ts = 1;
    if (st.bulky) {
      name = st.bulky === 'front' ? 'khieng_lui' : 'khieng';
      ts = st.moving ? (st.sneak ? 0.7 : 1) : 0.12;
    } else if (st.sheet) {
      name = st.moving ? 'di_xem_phieu' : 'xem_phieu';
      ts = st.sneak ? 0.6 : 1;
    } else if (st.carry) {
      name = 'be_thung';
      ts = st.moving ? 1 : 0.1;
    } else if (st.running) {
      name = 'chay';
    } else if (st.light) {
      name = st.moving ? 'di_den_pin' : 'dung_den_pin';
    } else if (st.moving) {
      name = 'di';
      ts = st.sneak ? 0.55 : 1;
    }
    if (this.inst) {
      if (name !== this.clip) {
        this.action = playClip(this.inst, this.action, name, { fade: 0.25 });
        this.clip = name;
      }
      if (this.action) this.action.timeScale = ts;
      this.inst.mixer.update(dt);
    }
  }
}
