// Nạp model .glb trong public/models (do script Blender sinh ra) để dùng trong game.
// - Đổi vật liệu sang Lambert cho đồng bộ với siêu thị khối xám và nhẹ cho laptop.
// - Model tĩnh xuất hiện nhiều lần (kệ, tủ mát, hàng hoá) thì vẽ bằng InstancedMesh.
// - Model nào tải lỗi thì trả về null: chỗ đó tự dùng lại khối xám, game vẫn chạy.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const MODEL_NAMES = [
  'ke_hang', 'nguoi_kiem_ke', 'nhan_vien', 'nhan_vien_ngo', 'thung_carton', 'tu_mat', 'quay_thu_ngan', 'bang_dong_lanh',
  'may_cham_cong', 'xe_day', 'hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua',
  'ke_mat', 'tu_dong', 'hh_kem', 'hh_goi_dong', 'hh_sua_chua',
  'hh_lon_xanh', 'hh_chai_ngot', 'hh_ngu_coc', 'hh_socola', 'hh_snack', 'hh_do_hop', 'hh_nuoc_tay', 'hh_nuoc_giat',
  'hh_dau_an', 'hh_pizza', 'hh_sua_tuoi', 'hh_nuoc_cam',
  'hh_lon_cam', 'hh_ca_phe', 'hh_tra_xanh', 'hh_snack_rong', 'hh_snack_cay', 'hh_mi_ga', 'hh_banh_dua', 'hh_lau_san',
  'ke_rau_qua_1', 'ke_rau_qua_2', 'ke_rau_qua_3', 'xe_mua_sam', 'gio_hang', 'kien_nuoc',
  'tu_dien', 'thung_rac', 'tui_rac', 'xe_rac', 'thung_rac_lon',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

/**
 * Hàng hình tròn (chai, lon): ở mức đồ hoạ Thấp vẽ bằng 2 tấm ảnh cắt hình bắt chéo nhau (dáng chai / lon thon,
 * nhìn xiên vẫn tròn) thay vì khối hộp (nhìn xiên thấy cạnh vuông).
 */
const ROUND_GOODS = new Set<string>([
  'hh_lon_nuoc', 'hh_lon_xanh', 'hh_lon_cam', 'hh_ca_phe', 'hh_chai_nuoc', 'hh_chai_ngot', 'hh_tra_xanh', 'hh_nuoc_cam', 'hh_dau_an', 'hh_do_hop',
]);

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
  private proxyCache = new Map<ModelName, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
  /** Khối hộp dán ảnh chụp mặt trước của món hàng (mức đồ hoạ Thấp), xem bakeImpostors(). */
  private impostors = new Map<ModelName, { geo: THREE.BufferGeometry; mat: THREE.Material }>();

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

  /**
   * Như instanced() nhưng mỗi món chỉ là một khối hộp cùng kích thước, màu của phần lớn nhất model
   * (12 tam giác, 1 lệnh vẽ). Dùng cho hàng hoá ở mức đồ hoạ Thấp.
   */
  instancedProxy(name: ModelName, matrices: THREE.Matrix4[]): THREE.Group | null {
    const m = this.models.get(name);
    const parts = this.parts(name);
    if (!m || !parts || !matrices.length) return null;
    let proxy = this.impostors.get(name) ?? this.proxyCache.get(name);
    if (!proxy) {
      const bb = new THREE.Box3().setFromObject(m.scene);
      const size = bb.getSize(new THREE.Vector3());
      const c = bb.getCenter(new THREE.Vector3());
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z).translate(c.x, c.y, c.z);
      const tris = (p: Part) => (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3;
      const main = parts.reduce((a, b) => (tris(b) > tris(a) ? b : a));
      const col = (main.material as THREE.MeshLambertMaterial).color?.clone() ?? new THREE.Color(0x999999);
      // Model gộp màu vào màu đỉnh: lấy màu chiếm nhiều diện tích bề mặt nhất (màu bao bì chính)
      const vc = main.geometry.attributes.color as THREE.BufferAttribute | undefined;
      if (vc && (main.material as THREE.MeshLambertMaterial).vertexColors) {
        const pos = main.geometry.attributes.position as THREE.BufferAttribute;
        const idx = main.geometry.index;
        const n = idx ? idx.count : pos.count;
        const area = new Map<string, number>();
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < n; t += 3) {
          const [i0, i1, i2] = idx ? [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)] : [t, t + 1, t + 2];
          a.fromBufferAttribute(pos, i0);
          b.fromBufferAttribute(pos, i1).sub(a);
          c.fromBufferAttribute(pos, i2).sub(a);
          const key = [vc.getX(i0), vc.getY(i0), vc.getZ(i0)].map((v) => v.toFixed(2)).join(',');
          area.set(key, (area.get(key) ?? 0) + b.cross(c).length() / 2);
        }
        const best = [...area].reduce((x, y) => (y[1] > x[1] ? y : x))[0].split(',').map(Number);
        col.setRGB(best[0], best[1], best[2]);
      }
      proxy = { geo, mat: new THREE.MeshLambertMaterial({ color: col }) };
      this.proxyCache.set(name, proxy);
    }
    const im = new THREE.InstancedMesh(proxy.geo, proxy.mat, matrices.length);
    matrices.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.userData.local = new THREE.Matrix4();
    const g = new THREE.Group();
    g.add(im);
    return g;
  }

  /**
   * Chụp sẵn MẶT TRƯỚC của từng món hàng (hàng nằm phẳng thì chụp mặt trên) vào một tấm atlas, rồi dán lên
   * khối hộp thay thế ở mức đồ hoạ Thấp: vẫn 12 tam giác một món nhưng thấy rõ nhãn, hình nhận diện, dáng chai
   * (phần nền trong suốt được cắt bỏ bằng alphaTest). Chụp một lần lúc vào ca, mất vài chục mili giây.
   */
  bakeImpostors(renderer: THREE.WebGLRenderer, names: ModelName[], tile = 128): void {
    const list = names.filter((n) => this.models.has(n) && !this.impostors.has(n));
    if (!list.length) return;
    const cols = Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    const rt = new THREE.WebGLRenderTarget(cols * tile, rows * tile, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    const mat = new THREE.MeshLambertMaterial({ map: rt.texture, alphaTest: 0.4 });
    const crossMat = new THREE.MeshLambertMaterial({ map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide });
    const pad = 2;
    list.forEach((name, k) => {
      const src = this.models.get(name)!.scene;
      const root = src.clone(true);
      // Vẽ đúng màu gốc (không đổ bóng, không ánh sáng): ánh sáng thật sẽ tính lại khi vẽ khối hộp trong cảnh
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const old = mesh.material as THREE.MeshLambertMaterial;
        mesh.material = new THREE.MeshBasicMaterial({
          color: old.color ?? 0xffffff,
          vertexColors: !!mesh.geometry.attributes.color && !!old.vertexColors,
          transparent: old.transparent,
          opacity: old.opacity,
        });
      });
      scene.add(root);
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3());
      const c = bb.getCenter(new THREE.Vector3());
      const flat = size.y < 0.06;
      if (flat) {
        // nhìn từ trên xuống, mép trước (+z) ở cạnh dưới ảnh
        cam.left = -size.x / 2; cam.right = size.x / 2; cam.top = size.z / 2; cam.bottom = -size.z / 2;
        cam.position.set(c.x, bb.max.y + 1, c.z);
        cam.up.set(0, 0, -1);
      } else {
        cam.left = -size.x / 2; cam.right = size.x / 2; cam.top = size.y / 2; cam.bottom = -size.y / 2;
        cam.position.set(c.x, c.y, bb.max.z + 1);
        cam.up.set(0, 1, 0);
      }
      cam.lookAt(c);
      cam.updateProjectionMatrix();
      const col = k % cols;
      const row = Math.floor(k / cols);
      const x0 = col * tile + pad;
      const y0 = row * tile + pad;
      const s = tile - pad * 2;
      rt.viewport.set(x0, y0, s, s);
      rt.scissor.set(x0, y0, s, s);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      scene.remove(root);
      const W = cols * tile;
      const H = rows * tile;
      const u0 = x0 / W, u1 = (x0 + s) / W, v0 = y0 / H, v1 = (y0 + s) / H;
      if (!flat && ROUND_GOODS.has(name)) {
        // Hai tấm bắt chéo, cùng dán ảnh mặt trước; phần nền trong suốt cắt bỏ → còn đúng dáng chai / lon
        const a = new THREE.PlaneGeometry(size.x, size.y);
        const b = new THREE.PlaneGeometry(size.x, size.y).rotateY(Math.PI / 2);
        for (const g of [a, b]) {
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
        }
        const geo = mergePlanes(a, b).translate(c.x, c.y, c.z);
        this.impostors.set(name, { geo, mat: crossMat });
        return;
      }
      // Khối hộp: mặt trước (hoặc mặt trên) lấy cả ô ảnh; các mặt khác lấy một điểm giữa thân hàng
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z).translate(c.x, c.y, c.z);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const faces = flat ? [2] : [4, 5];
      for (let f = 0; f < 6; f++) {
        for (let i = f * 4; i < f * 4 + 4; i++) {
          if (faces.includes(f)) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
          else uv.setXY(i, (u0 + u1) / 2, v0 + (v1 - v0) * 0.4);
        }
      }
      uv.needsUpdate = true;
      this.impostors.set(name, { geo, mat });
    });
    rt.scissorTest = false;
    rt.viewport.set(0, 0, cols * tile, rows * tile);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
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
    vertexColors: s.vertexColors,
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
/** Gộp hai tấm phẳng (cùng thuộc tính, có chỉ số) thành một hình. */
function mergePlanes(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv'] as const) {
    const x = a.attributes[k] as THREE.BufferAttribute;
    const y = b.attributes[k] as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(k, new THREE.BufferAttribute(arr, x.itemSize));
  }
  const n = a.attributes.position.count;
  const ia = Array.from(a.index!.array);
  const ib = Array.from(b.index!.array, (i) => i + n);
  g.setIndex([...ia, ...ib]);
  return g;
}

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
