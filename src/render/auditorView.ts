// Hình dạng Người Kiểm Kê và đèn máy quét. Dùng model nguoi_kiem_ke.glb (có chuyển động) nếu tải được,
// không thì dùng khối đơn giản.
//
// Đèn máy quét (không vẽ hình nón, chỉ có ánh sáng rọi lên sàn / kệ):
//   - Có điện, bình thường: tắt (siêu thị đủ sáng, nhìn người và hướng mặt là biết nó nhìn đâu).
//   - Mất điện, bình thường: bật ánh trắng như đèn pin người chơi.
//   - Thấy người / nghe tiếng / đang lao tới: chuyển ĐỎ (cả khi có điện). Đang đếm thì đỏ nhấp nháy.

import * as THREE from 'three';
import type { Auditor } from '../sim/auditor.ts';
import { playClip, type ModelInstance, type ModelLib } from './models.ts';

const SCANNER_Y = 1.25;
const WHITE = new THREE.Color(0xfff1d6); // cùng màu đèn pin người chơi
const RED = new THREE.Color(0xff2418);

export class AuditorView {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private beamPivot = new THREE.Group();
  private spot: THREE.SpotLight;
  private head = new THREE.Group();
  private marker: THREE.Mesh;
  private walkT = 0;
  private model: ModelInstance | null = null;
  private action: THREE.AnimationAction | null = null;
  private clip = '';
  /** 0 = bình thường, 1 = báo động (đỏ). Đổi mượt. */
  private alarm = 0;
  private light = 0;

  constructor(scene: THREE.Scene, models: ModelLib | null = null, shadows = true) {
    this.model = models?.instance('nguoi_kiem_ke') ?? null;
    if (this.model) this.body.add(this.model.root);
    else this.buildPlaceholder();
    this.group.add(this.body);

    // Đèn tắt bằng intensity = 0 (không ẩn đèn: đổi số đèn làm mọi vật liệu phải biên dịch lại, giật hình)
    this.spot = new THREE.SpotLight(WHITE, 0, 10, 0.32, 0.45, 1.2);
    this.spot.castShadow = shadows; // không chiếu xuyên kệ (máy yếu: tắt bóng cho nhẹ)
    this.spot.shadow.autoUpdate = false;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.bias = -0.002;
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -0.5, 5);
    this.beamPivot.add(this.spot, tgt);
    this.spot.target = tgt;
    this.beamPivot.position.set(0.12, SCANNER_Y, 0.5);
    this.group.add(this.beamPivot);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0x6fc3df, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.group, this.marker);
  }

  /** Xương của model (vd. 'than'), null nếu dùng hình tạm. */
  bone(name: string): THREE.Object3D | null {
    return this.model?.root.getObjectByName(name) ?? null;
  }

  /** Hình tạm bằng khối khi không có model. */
  private buildPlaceholder(): void {
    const uniform = new THREE.MeshLambertMaterial({ color: 0x1f2a33 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x111417 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.15, 12), uniform);
    torso.position.y = 1.3;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.75, 10), dark);
    legs.position.y = 0.38;
    this.head.position.y = 2.0;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshLambertMaterial({ color: 0x8a8378 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14), dark);
    cap.position.y = 0.08;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), dark);
    brim.position.set(0, 0.04, 0.14);
    this.head.add(skull, cap, brim);
    this.head.rotation.x = 0.45; // luôn cúi nhìn máy quét
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.45), uniform);
    arm.position.set(0.12, SCANNER_Y, 0.22);
    const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.12), dark);
    scanner.position.set(0.12, SCANNER_Y, 0.46);
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.08), new THREE.MeshBasicMaterial({ color: 0xe9e4d4 }));
    badge.position.set(-0.1, 1.6, 0.235);
    this.body.add(torso, legs, this.head, arm, scanner, badge);
  }

  /** Chọn chuyển động theo trạng thái của Người Kiểm Kê. */
  private animate(a: Auditor, dt: number): void {
    const m = this.model!;
    let name: string;
    let timeScale = 1;
    /** Chuyển động một lần, khớp đúng thời điểm trong sim (cảnh bắt người: mọi máy thấy giống nhau). */
    let once = false;
    if (a.state === 'count') name = 'dem';
    else if (a.state === 'alert') name = 'quay_dau';
    else if (a.state === 'lunge') name = 'lao_toi';
    else if (a.state === 'boxing') {
      name = 'bat'; // úp thùng, ấn bẹp, dán băng keo, quét mã, nhấc lên vai
      once = true;
    } else if (a.state === 'carry') {
      name = 'vac_hop'; // vác thùng trên vai phải
      timeScale = a.moving ? a.tune.investigateSpeed / 1.05 : 0.15;
    } else if (a.state === 'store') {
      name = 'dat_hop';
      once = true;
    } else if (a.running) name = 'chay';
    else if (a.moving) {
      name = 'di';
      // khớp nhịp bước với tốc độ đi (đi tuần 1,0 m/s, đi điều tra nhanh hơn)
      timeScale = a.state === 'investigate' ? a.tune.investigateSpeed / a.tune.speed : 1;
    } else if (a.state === 'search' || a.state === 'patrol') name = 'quet';
    else name = 'dung_im';
    if (!m.clips.has(name)) {
      // model cũ chưa có chuyển động mới
      name = { lao_toi: 'chay', bat: 'quet', vac_hop: 'di', dat_hop: 'dung_im' }[name] ?? name;
      once = false;
    }
    if (name !== this.clip) {
      this.clip = name;
      const quick = name === 'quay_dau' || name === 'dem' || name === 'chay' || name === 'lao_toi' || name === 'bat';
      this.action = playClip(m, this.action, name, { fade: quick ? 0.12 : 0.3, timeScale, loop: !once });
    } else if (this.action) {
      this.action.timeScale = timeScale;
    }
    m.mixer.update(dt);
    if (once && this.action) {
      this.action.time = Math.min(a.stateTime, this.action.getClip().duration - 1e-3);
      m.mixer.update(0);
    }
  }

  /** Đèn máy quét: tắt / trắng / đỏ theo điện và mức báo động. */
  private updateLight(a: Auditor, dt: number, power: boolean, active: boolean): void {
    const alarmed = a.alarmed;
    this.alarm += ((alarmed ? 1 : 0) - this.alarm) * Math.min(1, dt * (alarmed ? 8 : 1.5));
    const calm = power ? 0 : 30;
    const hot = power ? 45 : 36; // có điện thì cần sáng hơn mới nổi được trên sàn đã sáng
    let target = active ? calm + (hot - calm) * this.alarm : 0;
    if (a.state === 'count') target *= 0.8 + 0.35 * Math.sin(performance.now() / 55);
    this.light += (target - this.light) * Math.min(1, dt * 10);
    this.spot.intensity = this.light;
    // Đèn đang tắt thì khỏi vẽ lại bản đồ bóng mỗi khung hình
    this.spot.shadow.autoUpdate = this.light > 0.05;
    this.spot.color.copy(WHITE).lerp(RED, this.alarm);
    this.spot.distance = a.range + 1.5;
    this.spot.shadow.camera.far = a.range + 1.5;
    // Bình thường rộng như đèn pin; báo động thì thu hẹp đúng bằng tầm quét
    this.spot.angle = THREE.MathUtils.lerp(0.36, Math.max(0.12, a.tune.halfAngle * 1.25), this.alarm);
  }

  /** power: siêu thị đang có điện. */
  update(a: Auditor, dt: number, debug: boolean, power = true): void {
    // Chưa vào ca (idle): đứng im sau bàn văn phòng, nhìn ra cửa, đèn máy quét tắt
    const idle = a.state === 'idle';
    this.group.visible = true;
    this.group.position.set(a.pos.x, 0, a.pos.z);
    this.group.rotation.y = a.heading;
    this.beamPivot.rotation.y = a.beam - a.heading;
    if (this.model) {
      this.animate(a, dt);
    } else {
      if (a.moving) this.walkT += dt * (a.running ? 13 : 7);
      this.body.position.y = a.moving ? Math.abs(Math.sin(this.walkT)) * (a.running ? 0.07 : 0.03) : 0;
      this.body.rotation.z = a.moving ? Math.sin(this.walkT) * 0.025 : 0;
      // Ngẩng đầu khi nghe thấy hoặc đang đếm
      const lookUp = a.state === 'alert' || a.state === 'count' || a.state === 'search';
      this.head.rotation.x += ((lookUp ? -0.05 : 0.45) - this.head.rotation.x) * Math.min(1, dt * 6);
    }
    this.updateLight(a, dt, power, !idle);
    this.marker.visible = debug && !!a.suspicion;
    if (a.suspicion) this.marker.position.set(a.suspicion.x, 0.02, a.suspicion.z);
  }
}
