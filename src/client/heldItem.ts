// Món hàng đang cầm trên tay trái (góc nhìn thứ nhất): lấy từ kệ, xem hạn sử dụng, ăn / uống (giữ R),
// đặt lại kệ hoặc bỏ vào thùng HÀNG LỖI. Khi ăn, món hàng đưa dần lên miệng.

import * as THREE from 'three';
import type { ModelLib, ModelName } from '../render/models.ts';
import type { DefectKind } from '../sim/shelfGoods.ts';

const REST = new THREE.Vector3(-0.25, -0.2, -0.5);
const MOUTH = new THREE.Vector3(-0.02, -0.12, -0.26);
const TINT: Record<DefectKind, number> = { phong: 0xffe8e0, het_han: 0xc8bea8, moc: 0x8a9e6a };

export class HeldItem {
  private models: ModelLib | null;
  private holder = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private t = 0;
  /** 0..1: tiến độ ăn (món hàng đưa lên miệng). */
  eat = 0;

  constructor(camera: THREE.PerspectiveCamera, models: ModelLib | null) {
    this.models = models;
    this.holder.position.copy(REST);
    this.holder.visible = false;
    camera.add(this.holder);
  }

  /** Cầm món `id` (mã model hh_…), defect: kiểu lỗi để tô màu / làm méo; null: tay không. */
  set(id: string | null, defect: DefectKind | null = null): void {
    if (this.current) {
      this.holder.remove(this.current);
      this.current = null;
    }
    this.eat = 0;
    this.holder.visible = !!id;
    if (!id) return;
    const m = this.models?.static(id as ModelName);
    let obj: THREE.Object3D;
    if (m) {
      obj = m;
    } else {
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.06).translate(0, 0.07, 0), new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }));
    }
    // Phóng to một chút cho dễ nhìn nhãn, căn giữa theo chiều cao
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3());
    const k = Math.min(1.4, 0.19 / Math.max(size.x, size.y, size.z));
    obj.scale.setScalar(k);
    obj.position.y = -size.y * k * 0.5;
    obj.rotation.set(0.12, 0.35, 0);
    if (defect) {
      if (defect === 'phong') obj.scale.multiply(new THREE.Vector3(1.14, 1.1, 1.3));
      if (defect === 'het_han') obj.rotation.z = 0.18;
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshLambertMaterial).clone();
        mat.color = mat.color.clone().multiply(new THREE.Color(TINT[defect]));
        mesh.material = mat;
      });
    }
    obj.traverse((o) => (o.castShadow = false));
    this.current = obj;
    this.holder.add(obj);
  }

  update(dt: number): void {
    if (!this.holder.visible) return;
    this.t += dt;
    const e = this.eat * this.eat * (3 - 2 * this.eat);
    this.holder.position.lerpVectors(REST, MOUTH, e);
    this.holder.position.y += Math.sin(this.t * 2.2) * 0.006 * (1 - e) + Math.sin(this.t * 30) * 0.004 * e;
    this.holder.rotation.set(-0.5 * e, 0.4 * e, 0.3 * e);
  }
}
