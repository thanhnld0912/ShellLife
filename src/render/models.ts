// Nạp model .glb trong public/models (do script Blender sinh ra) để dùng trong game.
// - Đổi vật liệu sang Lambert cho đồng bộ với siêu thị khối xám và nhẹ cho laptop.
// - Model tĩnh xuất hiện nhiều lần (kệ, tủ mát, hàng hoá) thì vẽ bằng InstancedMesh.
// - Model nào tải lỗi thì trả về null: chỗ đó tự dùng lại khối xám, game vẫn chạy.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const MODEL_NAMES = [
  'ke_hang', 'nguoi_kiem_ke', 'nhan_vien', 'thung_carton', 'tu_mat', 'quay_thu_ngan', 'bang_dong_lanh',
  'may_cham_cong', 'xe_day', 'hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua',
  'ke_mat', 'tu_dong', 'hh_kem', 'hh_goi_dong', 'hh_sua_chua',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

interface Loaded {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export interface ModelInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
}

/** Một phần của model tĩnh: hình + vật liệu + vị trí tương đối với gốc model. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  local: THREE.Matrix4;
}

export class ModelLib {
  private models = new Map<ModelName, Loaded>();
  private partsCache = new Map<ModelName, Part[]>();

  has(name: ModelName): boolean {
    return this.models.has(name);
  }

  /** Bản sao độc lập (có xương, có chuyển động nếu model có). */
  instance(name: ModelName): ModelInstance | null {
    const m = this.models.get(name);
    if (!m) return null;
    const root = cloneSkinned(m.scene);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Mesh có xương: hộp bao không theo chuyển động, tắt cắt để khỏi biến mất
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      }
    });
    return { root, mixer: new THREE.AnimationMixer(root), clips: new Map(m.clips.map((c) => [c.name, c])) };
  }

  /** Bản sao tĩnh, dùng chung hình và vật liệu (rẻ). */
  static(name: ModelName): THREE.Object3D | null {
    const m = this.models.get(name);
    if (!m) return null;
    const root = m.scene.clone(true);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return root;
  }

  /**
   * Vẽ model tĩnh ở nhiều vị trí bằng InstancedMesh (một lệnh vẽ cho mỗi vật liệu).
   * Trả về nhóm chứa các InstancedMesh; thứ tự instance = thứ tự trong `matrices`.
   */
  instanced(name: ModelName, matrices: THREE.Matrix4[], opts: { shadow?: boolean } = {}): THREE.Group | null {
    const parts = this.parts(name);
    if (!parts || !matrices.length) return null;
    const g = new THREE.Group();
    const tmp = new THREE.Matrix4();
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
      matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, p.local)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = opts.shadow ?? true;
      im.receiveShadow = true;
      im.userData.local = p.local;
      g.add(im);
    }
    return g;
  }

  /** Kích thước hộp bao của model (m). */
  size(name: ModelName): THREE.Vector3 | null {
    const m = this.models.get(name);
    if (!m) return null;
    return new THREE.Box3().setFromObject(m.scene).getSize(new THREE.Vector3());
  }

  private parts(name: ModelName): Part[] | null {
    const cached = this.partsCache.get(name);
    if (cached) return cached;
    const m = this.models.get(name);
    if (!m) return null;
    m.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(m.scene.matrixWorld).invert();
    const parts: Part[] = [];
    m.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      parts.push({
        geometry: mesh.geometry,
        material: mesh.material as THREE.Material,
        local: new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld),
      });
    });
    this.partsCache.set(name, parts);
    return parts;
  }

  /** Thêm model đã tải (dùng nội bộ khi nạp). */
  set(name: ModelName, scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.models.set(name, { scene, clips });
  }
}

/** Đổi vật liệu PBR của glTF sang Lambert: giữ màu, độ phát sáng, độ trong suốt. */
function toLambert(mat: THREE.Material): THREE.Material {
  const s = mat as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return mat;
  const l = new THREE.MeshLambertMaterial({
    name: s.name,
    color: s.color,
    map: s.map,
    emissive: s.emissive,
    emissiveIntensity: s.emissiveIntensity,
    emissiveMap: s.emissiveMap,
    transparent: s.transparent,
    opacity: s.opacity,
    side: s.side,
    depthWrite: s.depthWrite,
  });
  // Kim loại / thép sơn trong Blender trông tối khi mất phản xạ môi trường: nâng nhẹ
  if (s.metalness > 0.3) l.color.multiplyScalar(1.15);
  return l;
}

/** Tải tất cả model. onProgress(đã xong, tổng). Không bao giờ báo lỗi: model hỏng thì bỏ qua. */
export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<ModelLib> {
  const lib = new ModelLib();
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL ?? '/';
  let done = 0;
  await Promise.all(
    MODEL_NAMES.map(async (name) => {
      try {
        const g = await loader.loadAsync(`${base}models/${name}.glb`);
        const swap = new Map<THREE.Material, THREE.Material>();
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const conv = (m: THREE.Material) => {
            if (!swap.has(m)) swap.set(m, toLambert(m));
            return swap.get(m)!;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
        });
        lib.set(name, g.scene, g.animations);
      } catch (err) {
        console.warn(`Không tải được model ${name}.glb, dùng khối xám thay thế.`, err);
      } finally {
        onProgress?.(++done, MODEL_NAMES.length);
      }
    }),
  );
  return lib;
}

/** Chơi một chuyển động, chuyển mượt từ chuyển động đang chạy. */
export function playClip(
  inst: ModelInstance,
  current: THREE.AnimationAction | null,
  name: string,
  opts: { loop?: boolean; fade?: number; timeScale?: number } = {},
): THREE.AnimationAction | null {
  const clip = inst.clips.get(name);
  if (!clip) return current;
  const next = inst.mixer.clipAction(clip);
  next.timeScale = opts.timeScale ?? 1;
  if (next === current) return current;
  next.reset();
  if (opts.loop === false) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
  }
  if (current) next.crossFadeFrom(current, opts.fade ?? 0.25, false);
  next.play();
  return next;
}
