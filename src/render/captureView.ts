// Cảnh "đóng thùng": diễn theo trạng thái của Người Kiểm Kê trong sim (không tự giữ thời gian riêng),
// nên khi chơi mạng mọi máy thấy cùng một cảnh.
//   boxing: nhân viên giãy rồi co người (chuyển động dong_thung) → thùng carton to rơi úp xuống
//           → thùng bị ép nhỏ lại bằng thùng thường → dán nhãn tên
//   carry:  thùng nằm trên tay Người Kiểm Kê
//   store:  đặt thùng xuống ô trong kho (Game báo 'stored' thì thế giới vẽ thùng cố định thay thế)

import * as THREE from 'three';
import { BOXING_TIME, STORE_TIME, type Auditor } from '../sim/auditor.ts';
import { labelPlane } from './labels.ts';
import { playClip, type ModelInstance, type ModelLib } from './models.ts';

const BIG = 1.75; // thùng lúc úp xuống người
const smooth = (x: number) => x * x * (3 - 2 * x);
const seg = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));

export class CaptureView {
  private box = new THREE.Group();
  private label: THREE.Mesh | null = null;
  private victim: THREE.Object3D;
  private victimInst: ModelInstance | null;
  private lastState = '';
  private carryFrom = new THREE.Vector3();
  private carryRot = 0;
  /** Gọi một lần lúc thùng chạm đất (để phát tiếng). */
  onLand: (() => void) | null = null;
  /** Gọi lúc thùng bị ép nhỏ. */
  onCrush: (() => void) | null = null;
  private landed = false;
  private crushed = false;

  constructor(scene: THREE.Scene, models: ModelLib | null) {
    const m = models?.static('thung_carton');
    if (m) this.box.add(m);
    else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.58), new THREE.MeshLambertMaterial({ color: 0xa47a4a }));
      b.position.y = 0.25;
      this.box.add(b);
    }
    this.box.visible = false;
    this.victimInst = models?.instance('nhan_vien') ?? null;
    if (this.victimInst) {
      this.victim = this.victimInst.root;
    } else {
      this.victim = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.2, 4, 8), new THREE.MeshLambertMaterial({ color: 0xb3261e }));
      this.victim.position.y = 0.85;
    }
    this.victim.visible = false;
    scene.add(this.box, this.victim);
  }

  /** Ghi tên lên nhãn thùng (gọi khi một người bị bắt). */
  begin(name: string): void {
    if (this.label) this.box.remove(this.label);
    this.label = labelPlane([name.toUpperCase(), 'ĐÃ LƯU KHO'], 0.5, 0.27, { bg: '#fbfaf6', fg: '#2a2117' });
    this.label.position.set(0, 0.24, 0.297);
    this.label.visible = false;
    this.box.add(this.label);
    this.landed = this.crushed = false;
  }

  update(a: Auditor, dt: number): void {
    const c = a.capture;
    const st = c ? a.state : 'none';
    const t = a.stateTime;
    if (st !== this.lastState) this.enter(st, a);
    this.lastState = st;
    if (!c) {
      this.box.visible = this.victim.visible = false;
      return;
    }

    if (st === 'boxing') {
      const face = Math.atan2(a.pos.x - c.at.x, a.pos.z - c.at.z); // nhân viên quay mặt về phía nó
      // Nhân viên: giãy rồi co lại, khuất hẳn khi thùng úp xong
      this.victim.visible = t < 1.3;
      this.victim.position.set(c.at.x, this.victimInst ? 0 : 0.85, c.at.z);
      this.victim.rotation.y = face;
      this.victimInst?.mixer.update(dt);
      // Thùng: rơi từ trên xuống (0,8–1,1 s), nảy nhẹ, bị ép nhỏ (1,7–2,3 s), dán nhãn
      const fall = smooth(seg(t, 0.8, 1.1));
      const crush = smooth(seg(t, 1.7, 2.3));
      const land = Math.max(0, t - 1.1);
      const wob = t > 1.1 ? Math.exp(-land * 6) * Math.sin(land * 34) : 0;
      this.box.visible = t >= 0.8;
      this.box.position.set(c.at.x, 2.4 * (1 - fall), c.at.z);
      this.box.rotation.set(wob * 0.05, face, wob * 0.04);
      const s = BIG + (1 - BIG) * crush;
      this.box.scale.set(s * (1 + 0.06 * wob), s * (1 - 0.08 * wob), s * (1 + 0.06 * wob));
      if (this.label) this.label.visible = t > 2.4;
      if (!this.landed && t >= 1.1) {
        this.landed = true;
        this.onLand?.();
      }
      if (!this.crushed && t >= 1.7) {
        this.crushed = true;
        this.onCrush?.();
      }
      // Cuối cảnh nhấc thùng lên tay
      const lift = smooth(seg(t, BOXING_TIME - 0.45, BOXING_TIME));
      if (lift > 0) {
        const hands = this.handsPos(a);
        this.box.position.lerp(hands, lift);
        this.box.rotation.y = face + (a.heading - face) * lift;
      }
    } else if (st === 'carry') {
      this.box.visible = true;
      this.box.scale.setScalar(1);
      this.box.position.copy(this.handsPos(a));
      if (a.moving) this.box.position.y += Math.abs(Math.sin(performance.now() / 160)) * 0.03;
      this.box.rotation.set(0, a.heading, 0);
    } else if (st === 'store') {
      // Đặt xuống ô trong kho, xoay về hướng như các thùng đã lưu
      const k = smooth(seg(t, 0.15, STORE_TIME * 0.85));
      this.box.position.copy(this.carryFrom).lerp(new THREE.Vector3(c.slot.x, 0, c.slot.z), k);
      this.box.position.y += Math.sin(k * Math.PI) * 0.12;
      this.box.rotation.set(0, this.carryRot * (1 - k), 0);
    } else {
      this.box.visible = this.victim.visible = false;
    }
  }

  private handsPos(a: Auditor): THREE.Vector3 {
    return new THREE.Vector3(a.pos.x + Math.sin(a.heading) * 0.5, 0.72, a.pos.z + Math.cos(a.heading) * 0.5);
  }

  private enter(st: string, a: Auditor): void {
    if (st === 'boxing' && this.victimInst) {
      playClip(this.victimInst, null, 'dong_thung', { loop: false });
    }
    if (st === 'store') {
      this.carryFrom.copy(this.box.position);
      this.carryRot = a.heading;
    }
  }
}
