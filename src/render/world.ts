// Siêu thị: dùng model glTF từ Blender (public/models) nếu tải được, thiếu model nào thì vẽ khối xám chỗ đó.

import * as THREE from 'three';
import type { AABB, V2 } from '../sim/geometry.ts';
import {
  BOX_PILE, CHILLERS, COLD_PILE, COLD_UNITS, COOLERS, COUNTER, FREEZER_PANEL, NAV_X, STAFF_DOOR, TIME_CLOCK, GLASS, NAV_Z, ROOMS, SECTIONS, SHELF_HEIGHT, SHELF_MID, SHELF_X0,
  SHELF_X1, SHELVES, STORE, WALLS, sectionById, storageSlot,
} from '../sim/layout.ts';
import { labelPlane, labelSign } from './labels.ts';
import { playClip, type ModelInstance, type ModelLib, type ModelName } from './models.ts';

/** Hàng tồn đầu đêm (Shift thoả kiểu này). */
export interface NightStock {
  restockNeeded: Set<string>;
  pile: number;
  coldNeeded: Set<string>;
  coldPile: number;
}

export interface World {
  scene: THREE.Scene;
  /** Đối tượng có thể tương tác (raycast). userData.kind = 'shelf' | 'pile' | 'freezer' */
  interactables(): THREE.Object3D[];
  /** Vật thể để ném lon chạm vào. */
  raySolids: THREE.Object3D[];
  /** Dọn cảnh đầu đêm theo ca mới: kệ và tủ lạnh thiếu hàng, số thùng trong kho và kho lạnh. */
  resetNight(s: NightStock, night: number): void;
  setColdPileCount(n: number): void;
  /** Tủ lạnh hết hàng (bỏ hàng, treo thẻ HẾT HÀNG) hoặc đã xếp lại. */
  setColdNeeded(id: string, needed: boolean): void;
  setRestocked(id: string): void;
  /** Kệ vừa hết hàng giữa ca (phiếu việc): bỏ hàng, treo thẻ THIẾU HÀNG. */
  setNeeded(id: string): void;
  /** Treo / gỡ thẻ KIỂM LẠI. */
  setRecount(id: string, on: boolean): void;
  /** Độ lệch sổ 0..1: đèn khu bán hàng tắt dần, nhóm ngoài kính đứng sát hơn. */
  setDrift(d: number): void;
  /** Mã các tủ lạnh có hàng (TM1… tủ mát cửa kính, KM1… ngăn mát mở, TD1… tủ đông nằm). */
  coldUnits(): string[];
  /** Cho một tủ lạnh hết hàng / đầy hàng. */
  setColdFilled(unit: string, filled: boolean): void;
  setPileCount(n: number): void;
  /** Lon nước đã ném nằm trên sàn (nhặt được, userData.kind = 'can'). */
  addCan(x: number, z: number, id: number): void;
  removeCan(id: number): void;
  /** Thùng "ĐÃ LƯU KHO" mang tên, đặt ở ô `at` trong kho (mặc định: ô kế tiếp). */
  addStoredBox(name: string, at?: V2): void;
  /** Mức điện 0..1 (1 = đủ sáng, 0 = mất điện, giữa = chập chờn). */
  setPower(level: number): void;
  /** Độ sáng còn lại khi mất điện (0 = tối hẳn, 1 = như mặc định). Chỉnh trong bảng sự kiện. */
  blackoutLevel: number;
  /** Chạy chuyển động của model (nhóm ca trước ngoài kính…). */
  update(dt: number): void;
}

const PALETTE = [0xd94b3d, 0xe8a33c, 0xf2d04b, 0x5fae5b, 0x3f88c5, 0x8e5bb5, 0xe9e4d4, 0x2f9c95, 0xc4426a, 0xf08a24];
const BOARD_YS = [0.12, 0.56, 1.0, 1.44, 1.88];
/** Mặt trên các tầng kệ trong model ke_hang.glb (tầng ở 0,16 m, dày 3 cm). */
const MODEL_BOARD_TOPS = [0.175, 0.615, 1.055, 1.495, 1.935];
const SHELF_MODULE = 1.3;
const PRODUCTS: ModelName[] = ['hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua'];
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

function lambert(color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function boxFrom(b: AABB, y0: number, h: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, h, b.maxZ - b.minZ), mat);
  m.position.set((b.minX + b.maxX) / 2, y0 + h / 2, (b.minZ + b.maxZ) / 2);
  return m;
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9cfc8';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b4bbb3';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#9aa29a';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 12);
  return t;
}

export function buildWorld(playerName: string, models: ModelLib | null = null): World {
  const has = (n: ModelName) => !!models?.has(n);
  const mixers: THREE.AnimationMixer[] = [];
  /** Hàng trong từng tủ lạnh (mã tủ → các instance), để cho tủ hết hàng / xếp lại. */
  const coldItems = new Map<string, { im: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[]>();
  const rand = (() => {
    let s = 1234567;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f10);
  scene.fog = new THREE.Fog(0x0b0f10, 14, 44);

  const raySolids: THREE.Object3D[] = [];
  const shelfHits: THREE.Mesh[] = [];
  const add = <T extends THREE.Object3D>(o: T, solid = false): T => {
    scene.add(o);
    if (solid) raySolids.push(o);
    return o;
  };

  // ---- Ánh sáng ----
  // Mỗi đèn nhớ (độ sáng khi có điện, độ sáng khi mất điện, ngưỡng độ lệch sổ làm nó tắt hoặc -1)
  // Sổ càng lệch, đèn khu bán hàng tắt dần từng dải: xa quầy tắt trước, gần quầy tắt sau cùng.
  const counterC = { x: (COUNTER.minX + COUNTER.maxX) / 2, z: (COUNTER.minZ + COUNTER.maxZ) / 2 };
  /** Ngưỡng tắt cho n đèn theo thứ tự từ xa quầy tới gần quầy: 0,12 … 0,85. */
  const driftSteps = (pts: { x: number; z: number }[]): number[] => {
    const order = pts.map((p, i) => [Math.hypot(p.x - counterC.x, p.z - counterC.z), i]).sort((a, b) => b[0] - a[0]);
    const out: number[] = [];
    order.forEach(([, i], k) => (out[i] = 0.12 + (0.73 * k) / Math.max(1, pts.length - 1)));
    return out;
  };
  const powered: [THREE.Light, number, number, number][] = [];
  const hemi = add(new THREE.HemisphereLight(0xdcebe5, 0x111615, 0.75));
  powered.push([hemi, 0.75, 0.03, -2]); // -2: ánh sáng nền, tối đi đều theo độ lệch sổ
  powered.push([add(new THREE.AmbientLight(0xffffff, 0.12)), 0.12, 0.015, -2]);
  // 8 đèn trần khu bán hàng (lưới 4 × 2), tầm 15 m
  const lamps = [7, 15, 23, 31].flatMap((x) => [12.5, 22.5].map((z) => ({ x, z })));
  const lampSteps = driftSteps(lamps);
  lamps.forEach(({ x, z }, i) => {
    const l = new THREE.PointLight(0xe4fff4, 9, 15, 1.2);
    l.position.set(x, STORE.wallH - 0.25, z);
    add(l);
    powered.push([l, 9, 0, lampSteps[i]]);
  });
  for (const r of ROOMS) {
    // Phòng rộng (kho 14 m) cần đèn mạnh và xa hơn để góc máy chấm công không tối hẳn
    const wide = r.box.maxX - r.box.minX > 8;
    const power = wide ? 3.6 : 2.2;
    const l = new THREE.PointLight(r.name === 'KHO LẠNH' ? 0x9fdcff : 0xffe7c4, power, wide ? 11 : 7, 1.2);
    l.position.set((r.box.minX + r.box.maxX) / 2 - (wide ? 2 : 0), 2.9, (r.box.minZ + r.box.maxZ) / 2);
    add(l);
    powered.push([l, power, 0, -1]);
  }
  // Đèn lối thoát chạy pin: luôn sáng xanh, chỉ thấy rõ khi mất điện
  const exits: [number, number, number, number][] = [
    [18, 2.95, STORE.d - 0.18, Math.PI], // trên cửa chính (mặt kính)
    [ROOMS[0].door.x, 2.6, STORE.backZ + 0.12, 0], // cửa kho
    [STORE.w - 0.18, 2.75, 26.5, -Math.PI / 2], // tường đông, cạnh quầy
    [STAFF_DOOR.x, 2.55, 0.12, 0], // trên cửa nhân viên (trong kho)
  ];
  for (const [x, y, z, ry] of exits) {
    const sign = labelPlane(['LỐI THOÁT'], 0.9, 0.26, { bg: '#0d5c2a', fg: '#c9ffd8' });
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    add(sign);
    const g = new THREE.PointLight(0x3dff7a, 0.9, 5, 1.5);
    g.position.set(x, y - 0.3, z + (ry === 0 ? 0.3 : ry === Math.PI ? -0.3 : 0) + 0);
    if (ry === -Math.PI / 2) g.position.x -= 0.3;
    add(g);
  }

  // ---- Sàn, trần, tường ----
  const floor = add(
    new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.d), lambert(0xffffff, { map: floorTexture() })),
    true,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(STORE.w / 2, 0, STORE.d / 2);
  floor.receiveShadow = true;
  const back = add(new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.backZ), lambert(0x5a605c)));
  back.rotation.x = -Math.PI / 2;
  back.position.set(STORE.w / 2, 0.003, STORE.backZ / 2);
  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.d), lambert(0x1c2120)));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(STORE.w / 2, STORE.wallH, STORE.d / 2);

  const wallMat = lambert(0x48514e);
  for (const w of WALLS) {
    const m = add(boxFrom(w, 0, STORE.wallH, wallMat), true);
    m.castShadow = m.receiveShadow = true;
  }
  buildStorefront();

  // Đèn huỳnh quang dạng dải trên mỗi làn
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xe8fff6, toneMapped: false });
  const tubeOn = new THREE.Color(0xe8fff6);
  const tubeOff = new THREE.Color(0x1a1f1e);
  // Mỗi làn một vật liệu riêng để tắt từng dải khi sổ lệch (làn xa quầy tắt trước)
  const laneTubes: [THREE.MeshBasicMaterial, number][] = [];
  const tubeSteps = driftSteps(NAV_Z.map((z) => ({ x: 18, z })));
  const tubeX0 = NAV_X[0] - 1;
  const tubeX1 = NAV_X[NAV_X.length - 1] + 0.6;
  NAV_Z.forEach((z, i) => {
    const m = tubeMat.clone();
    const t = add(new THREE.Mesh(new THREE.BoxGeometry(tubeX1 - tubeX0, 0.05, 0.14), m));
    t.position.set((tubeX0 + tubeX1) / 2, STORE.wallH - 0.06, z);
    laneTubes.push([m, tubeSteps[i]]);
  });
  for (const r of ROOMS) {
    const t = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.14), tubeMat));
    t.position.set((r.box.minX + r.box.maxX) / 2, STORE.wallH - 0.06, (r.box.minZ + r.box.maxZ) / 2);
  }

  // ---- Kệ hàng ----
  const shelfMat = lambert(0x6d7774);
  const boardMat = lambert(0x8d9794);
  const shelfModel = has('ke_hang');
  if (shelfModel) {
    // Mỗi dãy 13 m = 10 module 1,3 m
    const mats: THREE.Matrix4[] = [];
    const n = Math.round((SHELF_X1 - SHELF_X0) / SHELF_MODULE);
    for (const row of SHELVES) {
      for (let i = 0; i < n; i++) mats.push(new THREE.Matrix4().makeTranslation(SHELF_X0 + SHELF_MODULE * (i + 0.5), 0, row.zc));
    }
    add(models!.instanced('ke_hang', mats)!);
  }
  for (const row of SHELVES) {
    const g = new THREE.Group();
    g.visible = !shelfModel;
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X1 - SHELF_X0, SHELF_HEIGHT, 0.1), shelfMat);
    backPanel.position.set(SHELF_MID, SHELF_HEIGHT / 2, row.zc);
    g.add(backPanel);
    for (const y of [...BOARD_YS, SHELF_HEIGHT - 0.02]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X1 - SHELF_X0, 0.04, 0.96), boardMat);
      b.position.set(SHELF_MID, y, row.zc);
      g.add(b);
    }
    for (const x of [SHELF_X0 + 0.03, SHELF_MID, SHELF_X1 - 0.03]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, SHELF_HEIGHT, 1.0), shelfMat);
      p.position.set(x, SHELF_HEIGHT / 2, row.zc);
      g.add(p);
    }
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    add(g);
    // Hộp vô hình để raycast tương tác
    const hit = boxFrom(row.box, 0, SHELF_HEIGHT, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData = { kind: 'shelf', row: row.id };
    add(hit, true);
    shelfHits.push(hit);
    // Biển tên dãy ở hai đầu kệ, quay ra hai làn dọc (x 2,5 và x 19): đứng ở làn dọc nhìn vào
    // thấy số các dãy thẳng hàng cùng độ cao.
    for (const [x, ry] of [[SHELF_X0 - 0.02, -Math.PI / 2], [SHELF_X1 + 0.02, Math.PI / 2]] as const) {
      const end = labelPlane([`DÃY ${row.id}`], 0.92, 0.4, { bg: '#1e2422', fg: '#f2c94c' });
      end.position.set(x, 2.38, row.zc);
      end.rotation.y = ry;
      add(end);
    }
  }
  // Bảng tên từng đoạn kệ trên đầu mỗi mặt kệ, khớp tên trong phiếu việc ("Dãy 1 · mặt nam · đoạn 1")
  for (const sec of SECTIONS) {
    const row = SHELVES[sec.row - 1];
    const text = `DÃY ${sec.row} · MẶT ${sec.face === 'B' ? 'BẮC' : 'NAM'} · ĐOẠN ${sec.half}`;
    const p = labelPlane([text], 2.2, 0.2, { bg: '#1e2422', fg: '#f2c94c' });
    p.position.set((sec.x0 + sec.x1) / 2, shelfModel ? 2.51 : 2.5, row.zc + sec.out * (shelfModel ? 0.036 : 0.06));
    p.rotation.y = sec.out > 0 ? 0 : Math.PI;
    add(p);
  }

  // Hàng trên kệ. Có model hàng hoá thì mỗi loại hàng một nhóm InstancedMesh; không thì khối màu.
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Mỗi đoạn kệ: danh sách (InstancedMesh, chỉ số, ma trận khi có hàng). */
  const sectionItems = new Map<string, { im: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[]>();
  const pushItem = (section: string, im: THREE.InstancedMesh, i: number, m: THREE.Matrix4) => {
    let list = sectionItems.get(section);
    if (!list) sectionItems.set(section, (list = []));
    list.push({ im, i, m });
  };
  if (shelfModel && PRODUCTS.every(has)) {
    const sizes = new Map(PRODUCTS.map((p) => [p, models!.size(p)!]));
    const slots = new Map<ModelName, { section: string; m: THREE.Matrix4 }[]>(PRODUCTS.map((p) => [p, []]));
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const sec of SECTIONS) {
      const row = SHELVES[sec.row - 1];
      // Mặt trước của hàng quay ra lối đi
      if (sec.out < 0) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      else q.identity();
      for (const y of MODEL_BOARD_TOPS) {
        // Mỗi tầng của mỗi đoạn một loại hàng, xếp sát nhau thành dãy
        const p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
        const sz = sizes.get(p)!;
        const step = sz.x + 0.018;
        const z = row.zc + sec.out * (0.43 - sz.z / 2);
        for (let x = sec.x0 + 0.1 + step / 2; x < sec.x1 - 0.1; x += step) {
          if (rand() < 0.05) continue; // chỗ trống lác đác cho thật
          slots.get(p)!.push({ section: sec.id, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, one) });
        }
      }
    }
    for (const p of PRODUCTS) {
      const list = slots.get(p)!;
      const g = models!.instanced(p, list.map((s) => s.m), { shadow: false });
      if (!g) continue;
      add(g);
      for (const im of g.children as THREE.InstancedMesh[]) {
        const local = im.userData.local as THREE.Matrix4;
        list.forEach((s, i) => pushItem(s.section, im, i, new THREE.Matrix4().multiplyMatrices(s.m, local)));
      }
    }
  } else {
    const itemSlots: { section: string; m: THREE.Matrix4 }[] = [];
    const tops = shelfModel ? MODEL_BOARD_TOPS : BOARD_YS.map((y) => y + 0.02);
    for (const sec of SECTIONS) {
      const row = SHELVES[sec.row - 1];
      const zItem = row.zc + sec.out * 0.25;
      for (let x = sec.x0 + 0.2; x < sec.x1 - 0.15; x += 0.3) {
        for (const top of tops) {
          const w = 0.2 + rand() * 0.06;
          const h = 0.22 + rand() * 0.16;
          const d = 0.2 + rand() * 0.04;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x, top + h / 2, zItem),
            new THREE.Quaternion(),
            new THREE.Vector3(w, h, d),
          );
          itemSlots.push({ section: sec.id, m });
        }
      }
    }
    const items = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(0xffffff), itemSlots.length);
    const col = new THREE.Color();
    itemSlots.forEach((s, i) => {
      items.setMatrixAt(i, s.m);
      col.setHex(PALETTE[Math.floor(rand() * PALETTE.length)]).multiplyScalar(0.8 + rand() * 0.25);
      items.setColorAt(i, col);
      pushItem(s.section, items, i, s.m);
    });
    items.castShadow = true;
    items.receiveShadow = true;
    add(items);
  }
  const setSectionFilled = (id: string, filled: boolean) => {
    const touched = new Set<THREE.InstancedMesh>();
    for (const it of sectionItems.get(id) ?? []) {
      it.im.setMatrixAt(it.i, filled ? it.m : ZERO);
      touched.add(it.im);
    }
    touched.forEach((im) => (im.instanceMatrix.needsUpdate = true));
  };

  // Thẻ "THIẾU HÀNG" (đỏ) và "KIỂM LẠI" (vàng) treo trên mặt kệ
  const tags = new Map<string, THREE.Mesh>();
  const recountTags = new Map<string, THREE.Mesh>();
  const shelfTag = (id: string, text: string, bg: string, fg: string, y: number) => {
    const sec = sectionById(id)!;
    const t = labelPlane([text], 0.9, 0.22, { bg, fg });
    t.position.set((sec.x0 + sec.x1) / 2, y, sec.zFace + sec.out * 0.02);
    t.rotation.y = sec.out > 0 ? 0 : Math.PI;
    add(t);
    return t;
  };
  const makeTag = (id: string) => {
    if (!tags.has(id)) tags.set(id, shelfTag(id, 'THIẾU HÀNG', '#b3261e', '#ffffff', 1.92));
  };
  const dropTag = (map: Map<string, THREE.Mesh>, id: string) => {
    const t = map.get(id);
    if (t) {
      scene.remove(t);
      map.delete(id);
    }
  };

  // ---- Tủ mát, quầy ----
  const coolerModel = has('tu_mat');
  const cooler = add(
    boxFrom(COOLERS, 0, 2.1, coolerModel ? HIDDEN : lambert(0x1d3b44, { emissive: 0x2a6f80, emissiveIntensity: 0.55 })),
    true,
  );
  cooler.userData = { kind: 'cooler' };
  buildColdSection();
  const coolerSign = labelPlane(['TỦ MÁT'], 1.4, 0.36, { bg: '#1e2422', fg: '#9fdcff' });
  coolerSign.position.set(1.15, 2.55, (COOLERS.minZ + COOLERS.maxZ) / 2);
  coolerSign.rotation.y = Math.PI / 2;
  add(coolerSign);
  const chillerSign = labelPlane(['SỮA · SỮA CHUA · ĐỒ MÁT'], 2.2, 0.32, { bg: '#1e2422', fg: '#9fdcff' });
  chillerSign.position.set(CHILLERS.minX - 0.05, 2.45, (CHILLERS.minZ + CHILLERS.maxZ) / 2);
  chillerSign.rotation.y = -Math.PI / 2;
  add(chillerSign);
  const coldZoneSign = labelSign(['KHU HÀNG LẠNH · KEM · ĐỒ ĐÔNG LẠNH'], 3.2, 0.4, { bg: '#16323c', fg: '#bff4ff' });
  coldZoneSign.position.set(30, STORE.wallH - 0.55, 16);
  add(coldZoneSign);

  /**
   * Mặt tiền: kính mờ bám bụi chia ô bằng khung nhôm, cửa chính hai cánh ở giữa.
   * Bên ngoài là cửa sắt xếp (kiểu cửa kéo) đã kéo kín và khoá: nhìn ra ngoài chỉ qua khe song sắt.
   */
  function buildStorefront(): void {
    const zG = (GLASS.minZ + GLASS.maxZ) / 2;
    const H = STORE.wallH;
    // Kính: mờ, ám xanh xám, có vệt bẩn (texture vẽ bằng canvas)
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#7d9296';
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(${40 + rand() * 40},${50 + rand() * 40},${50 + rand() * 30},${0.05 + rand() * 0.12})`;
      const w = 6 + rand() * 40;
      g.fillRect(rand() * 256, rand() * 128, w, 2 + rand() * w * 0.4);
    }
    const grad = g.createLinearGradient(0, 128, 0, 70); // bụi bám dày ở chân kính
    grad.addColorStop(0, 'rgba(60,58,50,0.55)');
    grad.addColorStop(1, 'rgba(60,58,50,0)');
    g.fillStyle = grad;
    g.fillRect(0, 70, 256, 58);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(STORE.w / 3, 1);
    const glassMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    const glass = add(boxFrom(GLASS, 0, H, glassMat), true);
    glass.renderOrder = 2;
    // Khung nhôm: thanh đứng mỗi 3 m, thanh ngang trên và dưới, khung cửa chính ở giữa
    const alu = lambert(0x8a9295);
    const frame = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), alu);
      m.position.set(x, y, zG);
      add(m);
    };
    for (let x = 0; x <= STORE.w + 0.01; x += 3) frame(0.08, H, x, H / 2);
    frame(STORE.w, 0.1, STORE.w / 2, 0.05);
    frame(STORE.w, 0.1, STORE.w / 2, 2.35);
    frame(STORE.w, 0.1, STORE.w / 2, H - 0.05);
    for (const x of [16.5, 18, 19.5]) frame(0.1, 2.3, x, 1.15); // cửa chính 2 cánh
    for (const x of [17.75, 18.25]) frame(0.04, 0.45, x, 1.1); // tay nắm cửa
    // Cửa sắt xếp bên ngoài: song đứng + thanh chéo hình thoi (vẽ lên một tấm, phần trống trong suốt)
    const gc = document.createElement('canvas');
    gc.width = 128;
    gc.height = 512;
    const gg = gc.getContext('2d')!;
    gg.clearRect(0, 0, 128, 512);
    gg.strokeStyle = '#5b6062';
    gg.lineCap = 'square';
    gg.lineWidth = 9; // 2 song đứng mỗi ô (thép chữ U)
    for (const x of [6, 70]) {
      gg.beginPath();
      gg.moveTo(x, 0);
      gg.lineTo(x, 512);
      gg.stroke();
    }
    gg.lineWidth = 5; // thanh chéo xếp hình chữ X giữa hai song
    for (let y = -64; y < 512 + 64; y += 128) {
      gg.beginPath();
      gg.moveTo(6, y);
      gg.lineTo(70, y + 64);
      gg.lineTo(134, y);
      gg.moveTo(6, y + 128);
      gg.lineTo(70, y + 64);
      gg.lineTo(134, y + 128);
      gg.stroke();
    }
    const gTex = new THREE.CanvasTexture(gc);
    gTex.colorSpace = THREE.SRGBColorSpace;
    gTex.wrapS = THREE.RepeatWrapping;
    gTex.repeat.set(STORE.w / 0.22, 1); // mỗi ô song rộng 22 cm
    gTex.anisotropy = 4;
    const gateMat = new THREE.MeshLambertMaterial({ map: gTex, alphaTest: 0.5, side: THREE.DoubleSide });
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, H - 0.25), gateMat);
    gate.position.set(STORE.w / 2, (H - 0.25) / 2 + 0.05, GLASS.maxZ + 0.32);
    gate.castShadow = true;
    add(gate);
    const steel = lambert(0x3e4345);
    for (const y of [0.04, H - 0.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(STORE.w, 0.08, 0.12), steel); // ray trên / dưới
      rail.position.set(STORE.w / 2, y, GLASS.maxZ + 0.32);
      add(rail);
    }
    // Ổ khoá to ở giữa, chỗ hai nửa cửa xếp gặp nhau
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, H - 0.25, 0.08), steel);
    post.position.set(18, (H - 0.25) / 2 + 0.05, GLASS.maxZ + 0.32);
    add(post);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), lambert(0xb08a3a));
    lock.position.set(18, 1.05, GLASS.maxZ + 0.4);
    add(lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), lambert(0x9aa0a2));
    shackle.position.set(18, 1.13, GLASS.maxZ + 0.4);
    add(shackle);
  }

  /**
   * Khu hàng lạnh: tủ mát cửa kính (tường tây), ngăn mát mở (tường đông), tủ đông nằm (dọc mặt kính).
   * Hàng bày bên trong vẽ bằng InstancedMesh, nhớ theo từng tủ (mã TM1…, KM1…, TD1…) để sau này
   * cho tủ hết hàng và người chơi xếp lại.
   * Các độ cao tầng khớp "tang_hang" trong manifest.json do script Blender sinh ra.
   */
  function buildColdSection(): void {
    const units = COLD_UNITS.map((u) => ({
      id: u.id,
      kind: u.kind,
      base: new THREE.Matrix4().makeTranslation(u.x, 0, u.z).multiply(new THREE.Matrix4().makeRotationY(u.rot)),
    }));

    // Thân tủ: model nếu có, không thì khối xám
    for (const kind of ['tu_mat', 'ke_mat', 'tu_dong'] as const) {
      const mats = units.filter((u) => u.kind === kind).map((u) => u.base);
      const g = has(kind) ? models!.instanced(kind, mats) : null;
      if (g) {
        add(g);
        continue;
      }
      const [w, h, d] = kind === 'tu_mat' ? [1.0, 2.1, 0.8] : kind === 'ke_mat' ? [1.25, 2.0, 0.85] : [1.8, 0.85, 0.9];
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), lambert(0x9aa7aa), mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, h / 2, 0))));
      add(im);
    }
    // Tủ đông trong kho lạnh, sát tường đông của phòng (hàng dự trữ, chỉ trang trí)
    const coldRoom = ROOMS.find((r) => r.name === 'KHO LẠNH')!.box;
    for (const z of [2.0, 4.3]) {
      const m = models?.static('tu_dong');
      if (m) {
        m.position.set(coldRoom.maxX - 0.55, 0, z);
        m.rotation.y = -Math.PI / 2;
        add(m);
      } else {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 1.8), lambert(0xc8d6dc));
        f.position.set(coldRoom.maxX - 0.55, 0.425, z);
        add(f);
      }
    }

    // Hàng bên trong
    const goods: ModelName[] = ['hh_lon_nuoc', 'hh_chai_nuoc', 'hh_hop_sua', 'hh_sua_chua', 'hh_kem', 'hh_goi_dong'];
    if (!goods.every(has)) return;
    const size = new Map(goods.map((g) => [g, models!.size(g)!]));
    const slots = new Map<ModelName, { unit: string; m: THREE.Matrix4 }[]>(goods.map((g) => [g, []]));
    const tmp = new THREE.Matrix4();
    const put = (unit: string, base: THREE.Matrix4, p: ModelName, x: number, y: number, z: number, ry = 0) => {
      tmp.makeRotationY(ry).setPosition(x, y, z);
      slots.get(p)!.push({ unit, m: base.clone().multiply(tmp) });
    };
    // Một dãy hàng ngang từ x0 tới x1, nhiều hàng sâu (zs), chừa vài chỗ trống cho thật
    const row = (u: (typeof units)[number], p: ModelName, y: number, x0: number, x1: number, zs: number[]) => {
      const step = size.get(p)!.x + 0.012;
      for (let x = x0 + step / 2; x <= x1 - step / 2 + 1e-6; x += step) {
        if (rand() < 0.04) continue;
        for (const z of zs) put(u.id, u.base, p, x, y, z);
      }
    };
    const TM_TANG = [0.215, 0.585, 0.955, 1.325, 1.695];
    const KM_TANG = [0.64, 0.99, 1.31, 1.63];
    for (const u of units) {
      if (u.kind === 'tu_mat') {
        // Nước ngọt, nước suối, sữa hộp: mỗi tầng một loại
        TM_TANG.forEach((y) => {
          const p = (['hh_lon_nuoc', 'hh_chai_nuoc', 'hh_hop_sua'] as ModelName[])[Math.floor(rand() * 3)];
          row(u, p, y, -0.43, 0.43, [0.19, 0.04]);
        });
      } else if (u.kind === 'ke_mat') {
        // Khay đáy: sữa chua; 3 kệ: sữa chua / sữa hộp / chai (kệ trên ngắn dần, hàng lùi vào trong)
        row(u, 'hh_sua_chua', KM_TANG[0], -0.56, 0.56, [0.17, 0.01]);
        KM_TANG.slice(1).forEach((y, i) => {
          const front = 0.135 - i * 0.04;
          const p = (['hh_sua_chua', 'hh_hop_sua', 'hh_chai_nuoc'] as ModelName[])[Math.floor(rand() * 3)];
          row(u, p, y, -0.56, 0.56, [front - 0.08, front - 0.24]);
        });
      } else {
        // Tủ đông (đáy lòng tủ cao 0,5 m): ngăn trái kem chồng 2 lớp, ngăn phải đồ đông lạnh nằm 3 lớp
        const TD_DAY = 0.5;
        for (let l = 0; l < 2; l++) {
          for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 5; j++) {
              if (rand() < (l ? 0.35 : 0.04)) continue; // lớp trên lưa thưa
              put(u.id, u.base, 'hh_kem', -0.78 + i * 0.13, TD_DAY + l * 0.092, -0.3 + j * 0.15, rand() * 6);
            }
          }
        }
        for (let l = 0; l < 3; l++) {
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 2; j++) {
              if (l === 2 && rand() < 0.4) continue;
              put(u.id, u.base, 'hh_goi_dong', 0.17 + i * 0.25 + (rand() - 0.5) * 0.03, TD_DAY + l * 0.047, -0.16 + j * 0.31, (rand() - 0.5) * 0.25);
            }
          }
        }
      }
    }
    for (const p of goods) {
      const list = slots.get(p)!;
      const g = models!.instanced(p, list.map((s) => s.m), { shadow: false });
      if (!g) continue;
      add(g);
      for (const im of g.children as THREE.InstancedMesh[]) {
        const local = im.userData.local as THREE.Matrix4;
        list.forEach((s, i) => {
          let arr = coldItems.get(s.unit);
          if (!arr) coldItems.set(s.unit, (arr = []));
          arr.push({ im, i, m: new THREE.Matrix4().multiplyMatrices(s.m, local) });
        });
      }
    }
  }
  const counterModel = models?.static('quay_thu_ngan') ?? null;
  const counterHit = add(boxFrom(COUNTER, 0, 1.05, counterModel ? HIDDEN : lambert(0x3a3f3a)), true);
  counterHit.userData = { kind: 'counter' }; // giao đơn gấp
  if (counterModel) {
    counterModel.position.set((COUNTER.minX + COUNTER.maxX) / 2, 0, (COUNTER.minZ + COUNTER.maxZ) / 2);
    add(counterModel);
  } else {
    const printer = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), lambert(0x1a1d1c));
    printer.position.set(COUNTER.maxX - 1.2, 1.13, (COUNTER.minZ + COUNTER.maxZ) / 2);
    add(printer);
  }
  // Treo giữa trần: hai mặt, từ trong siêu thị hay từ mặt kính đều đọc xuôi
  const counterSign = labelSign(['QUẦY · NHẬN ĐƠN GẤP'], 2.4, 0.36, { bg: '#1e2422', fg: '#d8f3ec' });
  counterSign.position.set((COUNTER.minX + COUNTER.maxX) / 2, 2.75, (COUNTER.minZ + COUNTER.maxZ) / 2);
  add(counterSign);

  // ---- Khu sau: biển phòng ----
  for (const r of ROOMS) {
    const s = labelPlane([r.name], 1.5, 0.36, { bg: '#1e2422', fg: '#d8f3ec' });
    s.position.set(r.door.x, 2.65, r.door.z + 0.13);
    add(s);
  }

  // Kho: đống thùng hàng
  const cardboard = lambert(0xa47a4a);
  const boxModel = has('thung_carton');
  const pileBoxes: THREE.Mesh[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // Hộp để raycast; có model thì hộp tàng hình, model gắn làm con (ẩn hộp là ẩn luôn model)
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.58), boxModel ? HIDDEN : cardboard);
        b.position.set(BOX_PILE.minX + 0.34 + i * 0.66, 0.25 + layer * 0.52, BOX_PILE.minZ + 0.34 + j * 0.66);
        b.userData = { kind: 'pile' };
        if (boxModel) {
          const m = models!.static('thung_carton')!;
          m.position.y = -0.25;
          m.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2);
          b.add(m);
        }
        add(b, true);
        pileBoxes.push(b);
      }
    }
  }
  // Kho lạnh: chồng thùng hàng lạnh (thùng xốp trắng, đai xanh) để mang ra tủ lạnh đang hết hàng
  const foam = lambert(0xeef2f0);
  const foamBand = lambert(0x2f7fc1);
  const coldPileBoxes: THREE.Mesh[] = [];
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.55), foam);
        b.position.set(COLD_PILE.minX + 0.35 + i * 0.68, 0.18 + layer * 0.37, COLD_PILE.minZ + 0.35 + j * 0.68);
        b.rotation.y = (rand() - 0.5) * 0.2;
        b.userData = { kind: 'coldPile' };
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.57), foamBand);
        band.position.y = 0.06;
        b.add(band);
        b.castShadow = b.receiveShadow = true;
        add(b, true);
        coldPileBoxes.push(b);
      }
    }
  }
  const coldPileSign = labelPlane(['HÀNG LẠNH', 'MANG RA TỦ HẾT HÀNG'], 1.2, 0.4, { bg: '#16323c', fg: '#bff4ff' });
  coldPileSign.position.set(COLD_PILE.minX + 0.2, 1.75, 0.13); // lệch trái, tránh biển nhiệt độ tủ đông
  add(coldPileSign);
  const setColdPileCount = (n: number) => coldPileBoxes.forEach((b, i) => (b.visible = i < n));

  // Tủ lạnh bán hàng: vùng bấm (tàng hình) và thẻ HẾT HÀNG
  const coldHits: THREE.Mesh[] = [];
  const coldTags = new Map<string, THREE.Object3D>();
  const COLD_DIM: Record<string, [number, number, number]> = { tu_mat: [1.0, 2.1, 0.8], ke_mat: [1.25, 2.0, 0.85], tu_dong: [1.8, 0.95, 0.9] };
  for (const u of COLD_UNITS) {
    const [w, h, d] = COLD_DIM[u.kind];
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIDDEN);
    hit.position.set(u.x, h / 2, u.z);
    hit.rotation.y = u.rot;
    hit.userData = { kind: 'cold', id: u.id };
    add(hit, true);
    coldHits.push(hit);
  }
  const makeColdTag = (id: string) => {
    if (coldTags.has(id)) return;
    const u = COLD_UNITS.find((c) => c.id === id)!;
    const style = { bg: '#b3261e', fg: '#ffffff' };
    // Tủ đứng: thẻ dán trên đầu mặt tủ. Tủ đông nằm (đảo, đi vòng được): thẻ hai mặt cắm phía trên.
    const t: THREE.Object3D = u.kind === 'tu_dong' ? labelSign(['HẾT HÀNG'], 0.8, 0.22, style) : labelPlane(['HẾT HÀNG'], 0.8, 0.22, style);
    const [y, f] = u.kind === 'tu_mat' ? [2.45, 0.42] : u.kind === 'ke_mat' ? [2.25, 0.12] : [1.25, 0];
    t.position.set(u.x + Math.sin(u.rot) * f, y, u.z + Math.cos(u.rot) * f);
    t.rotation.y = u.rot;
    add(t);
    coldTags.set(id, t);
  };

  // Xe đẩy để trong kho
  const cart = models?.static('xe_day');
  if (cart) {
    cart.position.set(BOX_PILE.maxX + 1.3, 0, 1.6);
    cart.rotation.y = -0.4;
    add(cart);
  }
  const pileSign = labelPlane(['HÀNG MỚI · MANG RA KỆ THIẾU HÀNG'], 2.4, 0.3, { bg: '#1e2422', fg: '#f2c94c' });
  pileSign.position.set((BOX_PILE.minX + BOX_PILE.maxX) / 2, 2.2, 0.13);
  add(pileSign);

  // Thùng đã lưu kho (bắt đầu với thùng của Tuấn)
  const stored: THREE.Object3D[] = [];
  const storedBox = (lines: string[], x: number, z: number) => {
    const g = new THREE.Group();
    const m = models?.static('thung_carton');
    if (m) {
      g.add(m);
      const l = labelPlane(lines, 0.5, 0.27, { bg: '#fbfaf6', fg: '#2a2117' });
      l.position.set(0, 0.24, 0.297);
      g.add(l);
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.7), cardboard);
      b.position.y = 0.31;
      g.add(b);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), lambert(0xd8cfb4));
      tape.position.y = 0.4;
      g.add(tape);
      const l = labelPlane(lines, 0.56, 0.3, { bg: '#fbfaf6', fg: '#2a2117' });
      l.position.set(0, 0.28, 0.356);
      g.add(l);
    }
    g.position.set(x, 0, z);
    add(g);
    stored.push(g);
  };
  const tuan = storageSlot(0);
  storedBox(['TUẤN · NV 0388', 'ĐÃ LƯU KHO'], tuan.x, tuan.z);

  // Kho lạnh: bảng nhiệt độ
  const panelModel = models?.static('bang_dong_lanh') ?? null;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.45, 0.08),
    panelModel ? HIDDEN : lambert(0x163542, { emissive: 0x3aa7c9, emissiveIntensity: 0.6 }),
  );
  panel.position.set(FREEZER_PANEL.x, 1.45, FREEZER_PANEL.z);
  panel.userData = { kind: 'freezer' };
  add(panel);
  if (panelModel) {
    panelModel.position.set(FREEZER_PANEL.x, 1.45 - 0.225, 0.1); // mặt sau áp tường bắc (z = 0,1)
    add(panelModel);
  }
  const panelSign = labelPlane(['NHIỆT ĐỘ TỦ ĐÔNG', '23 · 01 · 03 · 05 giờ'], 1.2, 0.36, { bg: '#1e2422', fg: '#9fdcff' });
  panelSign.position.set(FREEZER_PANEL.x, 2.0, 0.16);
  add(panelSign);

  const roomC = (name: string) => {
    const b = ROOMS.find((r) => r.name === name)!.box;
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  };
  // Phòng điện: tủ điện
  const breaker = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.25), lambert(0x6b6f5a));
  breaker.position.set(roomC('PHÒNG ĐIỆN').x, 1.4, 0.25);
  add(breaker);

  // Phòng nghỉ: bàn và bảng phân ca
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 0.8), lambert(0x6b5b4a));
  table.position.set(roomC('PHÒNG NGHỈ').x, 0.375, 2.8);
  add(table);
  const roster = labelPlane(['BẢNG PHÂN CA', `1. ${playerName.toUpperCase()}`], 1.4, 0.8, { bg: '#f1eee6', fg: '#24221e' });
  roster.position.set(roomC('PHÒNG NGHỈ').x, 1.7, 0.13);
  add(roster);

  // Văn phòng: một cái bàn, một ngọn đèn bàn, một tờ giấy (chưa vào được, nhìn qua cửa)
  const office = roomC('VĂN PHÒNG');
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.76, 0.7), lambert(0x4a3b2e));
  desk.position.set(office.x, 0.38, 2.4);
  add(desk);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.004, 0.3), lambert(0xf1eee6));
  paper.position.set(office.x - 0.1, 0.765, 2.45);
  add(paper);
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 10, 1, true), lambert(0x2d3330, { emissive: 0xffd78a, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  lamp.position.set(office.x + 0.45, 1.05, 2.3);
  add(lamp);

  // Kho: cửa nhân viên (đã khoá) và máy chấm công, nơi điểm danh lúc 06:00
  const staffDoor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.08), lambert(0x5b4a3a));
  staffDoor.position.set(STAFF_DOOR.x, 1.05, 0.14);
  add(staffDoor);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.08), lambert(0x9aa0a2)); // thanh đẩy cửa thoát hiểm
  bar.position.set(STAFF_DOOR.x, 1.0, 0.22);
  add(bar);
  const doorSign = labelPlane(['CỬA NHÂN VIÊN', 'ĐÃ KHOÁ TỪ BÊN NGOÀI'], 0.9, 0.3, { bg: '#f1eee6', fg: '#b3261e' });
  doorSign.position.set(STAFF_DOOR.x, 1.55, 0.19);
  add(doorSign);
  const clockIn = models?.static('may_cham_cong');
  if (clockIn) {
    clockIn.position.set(TIME_CLOCK.x, 1.2, 0.1); // treo tường bắc, quay vào trong kho
    add(clockIn);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.18), lambert(0x3a3f3e));
    box.position.set(TIME_CLOCK.x, 1.41, 0.19);
    add(box);
  }
  const clockSign = labelPlane(['MÁY CHẤM CÔNG', 'ĐIỂM DANH 06:00'], 1.0, 0.34, { bg: '#1e2422', fg: '#f2c94c' });
  clockSign.position.set(TIME_CLOCK.x, 2.05, 0.12);
  add(clockSign);
  // Vạch vàng trên sàn đánh dấu chỗ đứng chấm công
  const clockMark = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.62, 4, 1, Math.PI / 4),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, toneMapped: false }),
  );
  clockMark.rotation.x = -Math.PI / 2;
  clockMark.scale.set(1.9, 1.3, 1);
  clockMark.position.set(TIME_CLOCK.x, 0.006, 1.2);
  add(clockMark);

  // ---- Bên ngoài: nhóm ca trước đứng sau cửa sắt xếp ----
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(STORE.w + 20, 20), lambert(0x121615));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(STORE.w / 2, -0.01, STORE.d + 10);
  add(outside);
  const figures: THREE.Object3D[] = [];
  for (const [x, z] of [[9, STORE.d + 2.4], [18.8, STORE.d + 3.0], [27, STORE.d + 2.2]]) {
    const inst: ModelInstance | null = models?.instance('nhan_vien') ?? null;
    if (inst) {
      // Bóng người tối ngoài kính, đứng thở, nhìn vào siêu thị
      inst.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const dim = (mat: THREE.Material) => {
          const c = mat.clone() as THREE.MeshLambertMaterial;
          c.color.multiplyScalar(0.16);
          c.emissiveIntensity = 0;
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(dim) : dim(mesh.material);
      });
      inst.root.position.set(x, 0, z);
      inst.root.rotation.y = Math.PI + (rand() - 0.5) * 0.3;
      playClip(inst, null, 'dung', { timeScale: 0.8 + rand() * 0.4 });
      inst.mixer.setTime(rand() * 3);
      mixers.push(inst.mixer);
      add(inst.root);
      figures.push(inst.root);
    } else {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.25, 4, 8), lambert(0x1a1f20));
      f.position.set(x, 0.86, z);
      add(f);
      figures.push(f);
    }
  }

  // ---- Lon nước đã ném ----
  const cans: THREE.Mesh[] = [];
  const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10);
  const canHitGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const canMat = lambert(0xc23a2e);

  // Vật liệu tự phát sáng (đèn tủ mát, màn hình quầy…) cũng tắt khi mất điện
  const glowing = new Map<THREE.MeshLambertMaterial, number>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshLambertMaterial[]) {
      if (mat.emissive && mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0) glowing.set(mat, mat.emissiveIntensity);
    }
  });

  let pileCount = 0;
  const setPileCount = (n: number) => {
    pileCount = n;
    pileBoxes.forEach((b, i) => (b.visible = i < pileCount));
  };

  // Độ lệch sổ (đổi mượt): mức tắt của từng đèn theo ngưỡng
  let drift = 0;
  let driftTarget = 0;
  const lit = (thr: number) => {
    if (thr === -2) return 1 - 0.6 * drift;
    if (thr < 0) return 1;
    const u = Math.max(0, Math.min(1, (drift - thr) / 0.08));
    return 1 - 0.92 * u * u * (3 - 2 * u);
  };
  const figureZ = figures.map((f) => f.position.z);
  function setColdFilledFn(unit: string, filled: boolean): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const it of coldItems.get(unit) ?? []) {
      it.im.setMatrixAt(it.i, filled ? it.m : ZERO);
      touched.add(it.im);
    }
    touched.forEach((im) => (im.instanceMatrix.needsUpdate = true));
  }

  return {
    scene,
    raySolids,
    // Lon đứng trước: nhắm xuống sàn cạnh kệ thì ưu tiên nhặt lon
    interactables: () => [
      ...cans, ...shelfHits, ...pileBoxes.filter((b) => b.visible), ...coldPileBoxes.filter((b) => b.visible),
      ...coldHits, panel, counterHit,
    ],
    resetNight(s, night) {
      for (const sec of SECTIONS) setSectionFilled(sec.id, !s.restockNeeded.has(sec.id));
      tags.forEach((t) => scene.remove(t));
      tags.clear();
      recountTags.forEach((t) => scene.remove(t));
      recountTags.clear();
      s.restockNeeded.forEach((id) => makeTag(id));
      setPileCount(s.pile);
      coldTags.forEach((t) => scene.remove(t));
      coldTags.clear();
      for (const u of COLD_UNITS) setColdFilledFn(u.id, !s.coldNeeded.has(u.id));
      s.coldNeeded.forEach((id) => makeColdTag(id));
      setColdPileCount(s.coldPile);
      cans.forEach((c) => scene.remove(c));
      cans.length = 0;
      figures.forEach((f) => (f.visible = night >= 2));
      drift = driftTarget = 0;
    },
    setRestocked(id) {
      setSectionFilled(id, true);
      dropTag(tags, id);
    },
    setNeeded(id) {
      setSectionFilled(id, false);
      makeTag(id);
    },
    setRecount(id, on) {
      if (on && !recountTags.has(id)) recountTags.set(id, shelfTag(id, 'KIỂM LẠI', '#f2c94c', '#1e2422', 1.66));
      if (!on) dropTag(recountTags, id);
    },
    setDrift(d) {
      driftTarget = d;
    },
    coldUnits: () => [...coldItems.keys()],
    setColdFilled: setColdFilledFn,
    setColdNeeded(id, needed) {
      setColdFilledFn(id, !needed);
      if (needed) makeColdTag(id);
      else {
        const t = coldTags.get(id);
        if (t) {
          scene.remove(t);
          coldTags.delete(id);
        }
      }
    },
    setColdPileCount,
    setPileCount,
    addCan(x, z, id) {
      // Vùng bấm hình cầu tàng hình rộng 0,3 m (lon thật chỉ 6 cm, khó nhắm); lon là con của nó
      const hit = new THREE.Mesh(canHitGeo, HIDDEN);
      hit.position.set(x, 0.12, z);
      hit.userData = { kind: 'can', id };
      const c = new THREE.Mesh(canGeo, canMat);
      c.rotation.z = Math.PI / 2;
      c.rotation.y = Math.random() * Math.PI;
      c.position.y = 0.034 - 0.12;
      c.castShadow = true;
      hit.add(c);
      add(hit);
      cans.push(hit);
    },
    removeCan(id) {
      const i = cans.findIndex((c) => c.userData.id === id);
      if (i < 0) return;
      scene.remove(cans[i]);
      cans.splice(i, 1);
    },
    blackoutLevel: 1,
    setPower(level) {
      const dark = this.blackoutLevel;
      for (const [l, on, off, thr] of powered) l.intensity = (off * dark + (on - off * dark) * level) * lit(thr);
      tubeMat.color.copy(tubeOff).lerp(tubeOn, level);
      for (const [m, thr] of laneTubes) m.color.copy(tubeOff).lerp(tubeOn, level * lit(thr));
      glowing.forEach((base, mat) => (mat.emissiveIntensity = base * (0.04 + 0.96 * level)));
    },
    update(dt) {
      for (const m of mixers) m.update(dt);
      drift += (driftTarget - drift) * Math.min(1, dt * 0.8);
      // Nhóm ca trước đứng sát mặt kính hơn khi sổ lệch
      figures.forEach((f, i) => (f.position.z = figureZ[i] - (figureZ[i] - (GLASS.maxZ + 0.7)) * drift));
    },
    addStoredBox(name, at) {
      const p = at ?? storageSlot(stored.length);
      storedBox([`${name.toUpperCase()}`, 'ĐÃ LƯU KHO'], p.x, p.z);
    },
  };
}
