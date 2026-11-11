// Điều khiển người chơi góc nhìn thứ nhất: di chuyển, va chạm, tiếng bước chân, ôm thùng.

import * as THREE from 'three';
import type { V2 } from '../sim/geometry.ts';
import { pushOutCircle } from '../sim/geometry.ts';
import { SOLIDS } from '../sim/layout.ts';

const EYE = 1.6;
const RADIUS = 0.3;

export class PlayerController {
  pos: V2 = { x: 0, z: 0 };
  carrying = false;
  flashOn = false;
  readonly flash: THREE.SpotLight;
  keys = new Set<string>();
  /** Tốc độ (m/s). Chỉnh được trong bảng sự kiện. Ôm thùng chạy phải thua Người Kiểm Kê chạy (3,4+). */
  speeds = { walk: 2.2, run: 3.8, carryWalk: 1.8, carryRun: 2.7 };
  /** Độ sáng đèn pin khi bật. */
  flashPower = 30;
  /** Gọi khi người chơi gây tiếng động: (vị trí, bán kính nghe, sai số). */
  onNoise: (at: V2, radius: number, error: number) => void = () => {};

  private camera: THREE.PerspectiveCamera;
  private box: THREE.Object3D;
  /** Thùng xốp hàng lạnh (trắng, đai xanh). */
  private coldBox: THREE.Object3D;
  /** Loại thùng đang ôm. */
  carryKind: 'dry' | 'cold' | null = null;
  private bob = 0;
  private runNoiseT = 0;
  private carryNoiseT = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.36, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xa47a4a }),
    );
    this.box.position.set(0, -0.42, -0.6);
    this.box.visible = false;
    camera.add(this.box);
    const foam = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.42), new THREE.MeshLambertMaterial({ color: 0xeef2f0 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.44), new THREE.MeshLambertMaterial({ color: 0x2f7fc1 }));
    band.position.y = -0.09;
    foam.add(band);
    foam.scale.setScalar(0.85);
    foam.position.set(0, -0.5, -0.62);
    foam.rotation.y = 0.12;
    foam.visible = false;
    camera.add(foam);
    this.coldBox = foam;
    // Đèn pin cầm tay phải, hơi chúc xuống
    this.flash = new THREE.SpotLight(0xfff1d6, 0, 22, 0.42, 0.55, 1.3);
    this.flash.position.set(0.2, -0.22, -0.1);
    this.flash.target.position.set(0.05, -0.45, -4);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = 22;
    this.flash.shadow.bias = -0.002;
    camera.add(this.flash, this.flash.target);
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Thay khối thùng đang ôm bằng model (gốc model ở giữa đáy). */
  setCarryModel(model: THREE.Object3D): void {
    // Thu nhỏ một chút cho khỏi che tầm nhìn (mép trên ngang khối thùng cũ)
    model.scale.setScalar(0.8);
    model.position.set(0, -0.66, -0.6);
    model.rotation.y = 0.15;
    model.visible = this.box.visible;
    model.traverse((o) => (o.castShadow = false));
    this.camera.remove(this.box);
    this.camera.add(model);
    this.box = model;
  }

  teleport(p: V2, yaw = 0.5): void {
    this.pos = { ...p };
    this.camera.position.set(p.x, EYE, p.z);
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
  }

  setFlashlight(on: boolean): void {
    this.flashOn = on;
    this.flash.intensity = on ? this.flashPower : 0;
  }

  /** true / 'dry' = thùng hàng khô, 'cold' = thùng hàng lạnh, false = tay không. */
  setCarrying(v: boolean | 'dry' | 'cold'): void {
    this.carryKind = v === false ? null : v === 'cold' ? 'cold' : 'dry';
    this.carrying = this.carryKind !== null;
    this.box.visible = this.carryKind === 'dry';
    this.coldBox.visible = this.carryKind === 'cold';
  }

  update(dt: number): { moving: boolean; running: boolean } {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const rx = -f.z;
    const rz = f.x;
    let mx = 0;
    let mz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) { mx += f.x; mz += f.z; }
    if (k.has('KeyS') || k.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
    if (k.has('KeyD') || k.has('ArrowRight')) { mx += rx; mz += rz; }
    if (k.has('KeyA') || k.has('ArrowLeft')) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    const moving = len > 0.01;
    const running = moving && (k.has('ShiftLeft') || k.has('ShiftRight'));
    // Ôm thùng nặng: chậm hơn một chút. Chạy khi ôm thùng (2,7) thua kiểm kê viên chạy (3,4+) → muốn thoát phải thả thùng.
    const sp = this.speeds;
    const speed = this.carrying ? (running ? sp.carryRun : sp.carryWalk) : running ? sp.run : sp.walk;

    if (moving) {
      mx /= len;
      mz /= len;
      this.pos.x += mx * speed * dt;
      for (const b of SOLIDS) pushOutCircle(this.pos, RADIUS, b);
      this.pos.z += mz * speed * dt;
      for (const b of SOLIDS) pushOutCircle(this.pos, RADIUS, b);
      this.bob += dt * (running ? 11 : 7.5);
    }
    const bobY = moving ? Math.sin(this.bob) * (running ? 0.05 : 0.03) : 0;
    this.camera.position.set(this.pos.x, EYE + bobY, this.pos.z);

    // Tiếng động: chạy thì ồn (~10 m), ôm thùng đi lạch cạch (~3 m). Đi bộ thường thì im.
    if (running) {
      this.runNoiseT += dt;
      if (this.runNoiseT >= 0.45) {
        this.runNoiseT = 0;
        this.onNoise({ ...this.pos }, 10, 2.5);
      }
    } else {
      this.runNoiseT = 0.3;
    }
    if (this.carrying && moving) {
      this.carryNoiseT += dt;
      if (this.carryNoiseT >= 0.9) {
        this.carryNoiseT = 0;
        this.onNoise({ ...this.pos }, 3, 1);
      }
    }
    return { moving, running };
  }
}
