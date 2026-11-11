// Cảnh "đóng thùng": diễn theo trạng thái của Người Kiểm Kê trong sim (không tự giữ thời gian riêng),
// nên khi chơi mạng mọi máy thấy cùng một cảnh. Khớp với chuyển động 'bat' / 'vac_hop' / 'dat_hop' của model
// nguoi_kiem_ke.glb và 'dong_thung' của nhân viên bản ngố (nhan_vien_ngo.glb):
//   boxing 0–0,3 s   nó chộp lấy, nhân viên (bản ngố) giãy
//          0,3–0,55  thùng to bung ra trên hai tay nó giơ quá đầu
//          0,55–0,72 úp mạnh xuống; nhân viên ngồi phịch, khuất trong thùng
//          1,4–2,0   ấn bẹp thùng xuống bằng thùng thường · 2,0–2,4 dán băng keo, hiện nhãn tên
//          2,6–3,0   nhấc thùng lên VAI PHẢI
//   carry:  vác thùng trên vai về kho (thùng nhún theo bước)
//   store:  hạ thùng từ vai xuống ô trong kho (Game báo 'stored' thì thế giới vẽ thùng cố định thay thế)

import * as THREE from 'three';
import { BOXING_TIME, STORE_TIME, type Auditor } from '../sim/auditor.ts';
import { labelPlane } from './labels.ts';
import { playClip, type ModelInstance, type ModelLib } from './models.ts';

const BIG = 1.75; // thùng lúc úp xuống người
/** Chỗ thùng trên vai phải Người Kiểm Kê (so với gốc model, trước khi xoay theo hướng nhìn). Khớp tư thế VAI trong script Blender. */
const SHOULDER_BOX = { x: -0.42, y: 1.74, z: 0.0 };
const T_UP = 0.3;
const T_SLAM = 0.55;
const T_LAND = 0.72;
const T_CRUSH0 = 1.45;
const T_CRUSH1 = 1.95;
const T_LABEL = 2.25;
const T_LIFT = 2.6;
const smooth = (x: number) => x * x * (3 - 2 * x);
const seg = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));

export class CaptureView {
  private box = new THREE.Group();
  private label: THREE.Mesh | null = null;
  private victim: THREE.Object3D;
  private victimInst: ModelInstance | null;
  /** Xương 'thung' của bản ngố (thùng có sẵn trong model): luôn ẩn, cảnh dùng thùng riêng. */
  private victimBox: THREE.Object3D | null = null;
  private lastState = '';
  private carryFrom = new THREE.Vector3();
  private carryRot = 0;
  private tmp = new THREE.Vector3();
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
    // Người chơi nhìn thấy nhau bằng bản ngố (đầu to, mắt chấm); không có thì dùng bản thường
    this.victimInst = models?.instance('nhan_vien_ngo') ?? models?.instance('nhan_vien') ?? null;
    if (this.victimInst) {
      this.victim = this.victimInst.root;
      this.victimBox = this.victim.getObjectByName('thung') ?? null;
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

  update(a: Auditor, _dt = 0): void {
    const c = a.capture;
    const st = c ? a.state : 'none';
    const t = a.stateTime;
    if (st !== this.lastState) this.enter(st, a);
    this.lastState = st;
    if (!c) {
      this.box.visible = this.victim.visible = false;
      return;
    }

    if (st === 'lunge') {
      // Người bị bắt đang nhìn bằng góc nhìn thứ nhất: chưa vẽ thân (khỏi che camera)
      this.victim.visible = this.box.visible = false;
    } else if (st === 'boxing') {
      const face = Math.atan2(a.pos.x - c.at.x, a.pos.z - c.at.z); // nhân viên quay mặt về phía nó
      this.victim.visible = t < T_LAND + 0.05;
      this.victim.position.set(c.at.x, this.victimInst ? 0 : 0.85, c.at.z);
      this.victim.rotation.y = face;
      if (this.victimInst) {
        this.victimInst.mixer.setTime(Math.max(0, t - 0.05)); // khớp đúng thời điểm trong sim
        this.victimBox?.scale.setScalar(0.0001);
      }
      // Thùng: bung ra trên tay nó (0,3–0,55), úp xuống (0,55–0,72), nảy nhẹ, bị ép nhỏ, dán nhãn
      const open = smooth(seg(t, T_UP, T_SLAM - 0.05));
      const fall = seg(t, T_SLAM, T_LAND);
      const land = Math.max(0, t - T_LAND);
      const wob = t > T_LAND ? Math.exp(-land * 6) * Math.sin(land * 34) : 0;
      const crush = smooth(seg(t, T_CRUSH0, T_CRUSH1));
      this.box.visible = t >= T_UP;
      // trên đầu nó (tay giơ cao) → trên đầu nhân viên → rơi xuống
      const over = this.tmp.set(a.pos.x + Math.sin(a.heading) * 0.35, 2.15, a.pos.z + Math.cos(a.heading) * 0.35);
      const above = new THREE.Vector3(c.at.x, 2.25, c.at.z);
      if (t < T_SLAM) this.box.position.copy(over).lerp(above, open);
      else this.box.position.set(c.at.x, 2.25 * (1 - fall * fall), c.at.z);
      this.box.rotation.set(wob * 0.05, face, wob * 0.04);
      const s = (0.35 + 0.65 * open) * (BIG + (1 - BIG) * crush);
      this.box.scale.set(s * (1 + 0.06 * wob), s * (1 - 0.08 * wob), s * (1 + 0.06 * wob));
      if (this.label) this.label.visible = t > T_LABEL;
      if (!this.landed && t >= T_LAND) {
        this.landed = true;
        this.onLand?.();
      }
      if (!this.crushed && t >= T_CRUSH0) {
        this.crushed = true;
        this.onCrush?.();
      }
      // Cuối cảnh nhấc thùng lên vai phải
      const lift = smooth(seg(t, T_LIFT, BOXING_TIME));
      if (lift > 0) {
        const sh = this.shoulder(a);
        const mid = this.box.position.clone().lerp(sh, lift);
        mid.y += Math.sin(lift * Math.PI) * 0.35; // vung lên một vòng
        this.box.position.copy(mid);
        this.box.rotation.y = face + (a.heading - face) * lift;
      }
    } else if (st === 'carry') {
      this.box.visible = true;
      this.victim.visible = false;
      this.box.scale.setScalar(1);
      this.box.position.copy(this.shoulder(a));
      if (a.moving) this.box.position.y += Math.abs(Math.sin(performance.now() / 300)) * 0.035;
      this.box.rotation.set(0, a.heading, 0.04);
    } else if (st === 'store') {
      // Hạ từ vai xuống ô trong kho, xoay về hướng như các thùng đã lưu
      const k = smooth(seg(t, 0.15, STORE_TIME * 0.85));
      this.box.position.copy(this.carryFrom).lerp(this.tmp.set(c.slot.x, 0, c.slot.z), k);
      this.box.position.y += Math.sin(k * Math.PI) * 0.1;
      this.box.rotation.set(0, this.carryRot * (1 - k), 0);
    } else {
      this.box.visible = this.victim.visible = false;
    }
  }

  /** Vị trí thùng trên vai phải. */
  private shoulder(a: Auditor): THREE.Vector3 {
    const h = a.heading;
    const { x, y, z } = SHOULDER_BOX;
    return new THREE.Vector3(a.pos.x + x * Math.cos(h) + z * Math.sin(h), y, a.pos.z - x * Math.sin(h) + z * Math.cos(h));
  }

  private enter(st: string, a: Auditor): void {
    if (st === 'boxing' && this.victimInst) {
      this.victimInst.mixer.stopAllAction();
      playClip(this.victimInst, null, 'dong_thung', { loop: false });
    }
    if (st === 'store') {
      this.carryFrom.copy(this.box.position);
      this.carryRot = a.heading;
    }
  }
}
