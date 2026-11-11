// Ném lon nước để dụ Người Kiểm Kê, có ngắm:
//   Giữ Q: tay phải cầm lon giơ lên (vẫn thấy cả khi đang ôm thùng), hiện đường bay chấm vàng,
//          vòng đánh dấu chỗ lon sẽ rơi và vòng mờ lớn = tầm tiếng lon nghe được.
//   Thả Q: vung tay ném, lon bay theo đúng đường cong đã hiện, chạm đất mới gây tiếng động.
//   Chuột phải / mất khoá chuột: huỷ, không ném.

import * as THREE from 'three';
import type { V2 } from '../sim/geometry.ts';
import { SOLIDS_3D, STORE } from '../sim/layout.ts';

const SPEED = 8.0; // m/s theo hướng nhìn
const LOB = 1.6; // cộng thêm vận tốc hướng lên (ném vồng)
const G = 9.8;
const STEP = 1 / 40;
const MAX_T = 2.2;
const DOTS = 40;
/** Bán kính nghe tiếng lon rơi (khớp Game.dropLitter). */
export const CAN_NOISE_RADIUS = 11;

export interface ThrowResult {
  /** Chỗ lon nằm lại trên sàn. */
  land: V2;
  /** Thời gian bay (giây) tới lúc chạm. */
  flight: number;
}

export class ThrowAim {
  aiming = false;
  private camera: THREE.PerspectiveCamera;
  private hand = new THREE.Group();
  private handCan: THREE.Mesh;
  private dots: THREE.InstancedMesh;
  private marker = new THREE.Group();
  private noiseRing: THREE.Mesh;
  private flying: THREE.Mesh;
  private path: THREE.Vector3[] = [];
  private land: V2 | null = null;
  private flight = 0;
  /** Đang vung tay / lon đang bay (sau khi thả Q). */
  private swingT = -1;
  private flyPath: THREE.Vector3[] = [];
  private flyT = 0;
  private onLanded: (() => void) | null = null;
  private t = 0;
  private tmp = new THREE.Matrix4();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    // Tay: ống tay áo sơ mi + bàn tay + lon nước đỏ
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.34), new THREE.MeshLambertMaterial({ color: 0xd9d4c7 }));
    sleeve.position.z = 0.17;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.065, 0.1), new THREE.MeshLambertMaterial({ color: 0xc79a76 }));
    palm.position.z = -0.03;
    this.handCan = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12), new THREE.MeshLambertMaterial({ color: 0xc23a2e }));
    this.handCan.position.set(0, 0.03, -0.07);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.01, 12), new THREE.MeshLambertMaterial({ color: 0xc7cbcc }));
    top.position.y = 0.065;
    this.handCan.add(top);
    this.hand.add(sleeve, palm, this.handCan);
    this.hand.visible = false;
    this.hand.scale.setScalar(0.7);
    this.hand.traverse((o) => (o.castShadow = false));
    camera.add(this.hand);

    // Đường bay: chấm vàng, chấm xa mờ dần
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 6, 4), dotMat, DOTS);
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    this.dots.renderOrder = 3;
    // Chỗ rơi: vòng vàng + chấm giữa; vòng mờ lớn = tầm nghe tiếng lon
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.32, 28), ringMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), ringMat);
    this.noiseRing = new THREE.Mesh(
      new THREE.RingGeometry(CAN_NOISE_RADIUS - 0.12, CAN_NOISE_RADIUS, 72),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    for (const m of [ring, dot, this.noiseRing]) m.rotation.x = -Math.PI / 2;
    this.marker.add(ring, dot, this.noiseRing);
    this.marker.visible = false;
    this.marker.renderOrder = 3;
    // Lon đang bay
    this.flying = new THREE.Mesh(this.handCan.geometry, this.handCan.material);
    this.flying.visible = false;
    scene.add(this.dots, this.marker, this.flying);
  }

  /** Bắt đầu ngắm (giữ Q). hasCan = false khi đang chờ lấy lon mới: chỉ giơ tay không. */
  start(hasCan: boolean): void {
    if (this.swingT >= 0) return;
    this.aiming = true;
    this.hand.visible = true;
    this.handCan.visible = hasCan;
    this.dots.visible = hasCan;
    this.marker.visible = hasCan;
  }

  cancel(): void {
    this.aiming = false;
    if (this.swingT < 0) this.hand.visible = false;
    this.dots.visible = this.marker.visible = false;
  }

  /** Thả Q: ném theo đường đang ngắm. onLanded được gọi khi lon chạm đất. */
  release(onLanded: () => void): ThrowResult | null {
    if (!this.aiming) return null;
    this.aiming = false;
    this.dots.visible = this.marker.visible = false;
    if (!this.land || !this.handCan.visible) {
      this.hand.visible = false;
      return null;
    }
    this.swingT = 0;
    this.flyPath = this.path.map((p) => p.clone());
    this.flyT = 0;
    this.onLanded = onLanded;
    return { land: { ...this.land }, flight: this.flight };
  }

  update(dt: number): void {
    this.t += dt;
    if (this.aiming) {
      this.computePath();
      this.drawAim();
      // Tay giơ ra sau, hơi nhún theo nhịp thở
      const breathe = Math.sin(this.t * 3) * 0.01;
      this.hand.position.set(0.36, -0.2 + breathe, -0.42);
      this.hand.rotation.set(0.95, -0.15, 0.1);
    }
    if (this.swingT >= 0) {
      this.swingT += dt;
      // Vung tay tới trước (0–0,14 s), lon rời tay, tay hạ xuống và khuất (tới 0,45 s)
      const k = Math.min(1, this.swingT / 0.14);
      const e = 1 - (1 - k) ** 3;
      this.hand.position.set(0.36 - 0.12 * e, -0.2 - 0.1 * e - Math.max(0, this.swingT - 0.14) * 1.2, -0.42 - 0.3 * e);
      this.hand.rotation.set(0.95 - 1.7 * e, -0.15, 0.1);
      this.handCan.visible = this.swingT < 0.12;
      if (this.swingT > 0.45) this.hand.visible = false;
      // Lon bay theo đường đã tính
      if (this.swingT >= 0.12 && this.flyPath.length) {
        this.flyT += dt;
        const i = Math.min(this.flyPath.length - 1, Math.floor(this.flyT / STEP));
        this.flying.visible = i < this.flyPath.length - 1;
        this.flying.position.copy(this.flyPath[i]);
        this.flying.rotation.x += dt * 14;
        this.flying.rotation.z += dt * 9;
        if (i >= this.flyPath.length - 1) {
          this.flyPath = [];
          this.flying.visible = false;
          const cb = this.onLanded;
          this.onLanded = null;
          cb?.();
        }
      }
      if (this.swingT > 0.45 && !this.flyPath.length) this.swingT = -1;
    }
  }

  /** Mô phỏng đường bay từ tay theo hướng nhìn; dừng khi chạm sàn hoặc vật cản. */
  private computePath(): void {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
    const p = cam.position.clone().addScaledVector(right, 0.3).add(new THREE.Vector3(0, -0.12, 0)).addScaledVector(dir, 0.3);
    const v = dir.clone().multiplyScalar(SPEED);
    v.y += LOB;
    const path = [p.clone()];
    let t = 0;
    let land: V2 | null = null;
    while (t < MAX_T) {
      const prev = p.clone();
      v.y -= G * STEP;
      p.addScaledVector(v, STEP);
      t += STEP;
      if (p.y <= 0.04) {
        // chạm sàn: nội suy đúng chỗ chạm
        const k = (prev.y - 0.04) / Math.max(1e-6, prev.y - p.y);
        p.lerpVectors(prev, p, k);
        p.y = 0.04;
        path.push(p.clone());
        land = { x: p.x, z: p.z };
        break;
      }
      const hit = SOLIDS_3D.find(([b, h]) => p.y < h && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ);
      if (hit) {
        // đập vào kệ / tường: rơi thẳng xuống sàn ngay trước chỗ đập
        const back = prev.clone().sub(p).setY(0).normalize().multiplyScalar(0.15);
        const drop = prev.clone().add(back);
        path.push(drop.clone());
        for (let y = drop.y - 0.25; y > 0.04; y -= 0.25) path.push(new THREE.Vector3(drop.x, y, drop.z));
        path.push(new THREE.Vector3(drop.x, 0.04, drop.z));
        land = { x: drop.x, z: drop.z };
        break;
      }
      path.push(p.clone());
    }
    if (!land) land = { x: p.x, z: p.z };
    land.x = Math.max(0.4, Math.min(STORE.w - 0.4, land.x));
    land.z = Math.max(0.4, Math.min(STORE.d - 0.4, land.z));
    this.path = path;
    this.land = land;
    this.flight = path.length * STEP;
  }

  private drawAim(): void {
    if (!this.handCan.visible || !this.land) return;
    const n = this.path.length;
    const one = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion();
    for (let i = 0; i < DOTS; i++) {
      const k = Math.floor(((i + ((this.t * 2) % 1)) / DOTS) * (n - 1)); // chấm trôi dọc đường bay
      const s = k > 3 ? 1 - (0.5 * i) / DOTS : 0; // bỏ vài chấm sát tay (quá to)
      this.tmp.compose(this.path[Math.min(n - 1, Math.max(0, k))], q, one.clone().multiplyScalar(s));
      this.dots.setMatrixAt(i, this.tmp);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.marker.position.set(this.land.x, 0.02, this.land.z);
    const pulse = 1 + 0.12 * Math.sin(this.t * 8);
    this.marker.children[0].scale.setScalar(pulse);
  }
}
