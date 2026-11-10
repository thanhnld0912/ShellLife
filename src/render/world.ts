// Siêu thị dạng khối xám (graybox). Sau này thay dần bằng model glTF từ Blender.

import * as THREE from 'three';
import type { AABB } from '../sim/geometry.ts';
import {
  BOX_PILE, COOLERS, COUNTER, FREEZER_PANEL, GLASS, NAV_Z, ROOMS, SECTIONS, SHELF_HEIGHT, SHELF_MID, SHELF_X0,
  SHELF_X1, SHELVES, STORE, WALLS, sectionById,
} from '../sim/layout.ts';
import { labelPlane } from './labels.ts';

export interface World {
  scene: THREE.Scene;
  /** Đối tượng có thể tương tác (raycast). userData.kind = 'shelf' | 'pile' | 'freezer' */
  interactables(): THREE.Object3D[];
  /** Vật thể để ném lon chạm vào. */
  raySolids: THREE.Object3D[];
  resetNight(needed: Set<string>, pileCount: number, night: number): void;
  setRestocked(id: string): void;
  setPileCount(n: number): void;
  addCan(x: number, z: number): void;
  addStoredBox(name: string): void;
}

const PALETTE = [0xd94b3d, 0xe8a33c, 0xf2d04b, 0x5fae5b, 0x3f88c5, 0x8e5bb5, 0xe9e4d4, 0x2f9c95, 0xc4426a, 0xf08a24];
const BOARD_YS = [0.12, 0.56, 1.0, 1.44, 1.88];

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

export function buildWorld(playerName: string): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f10);
  scene.fog = new THREE.Fog(0x0b0f10, 12, 34);

  const raySolids: THREE.Object3D[] = [];
  const shelfHits: THREE.Mesh[] = [];
  const add = <T extends THREE.Object3D>(o: T, solid = false): T => {
    scene.add(o);
    if (solid) raySolids.push(o);
    return o;
  };

  // ---- Ánh sáng ----
  add(new THREE.HemisphereLight(0xdcebe5, 0x111615, 0.75));
  add(new THREE.AmbientLight(0xffffff, 0.12));
  for (const [x, z] of [[6, 9.5], [16, 9.5], [6, 17.5], [16, 17.5], [21.5, 21.5]]) {
    const l = new THREE.PointLight(0xe4fff4, 7, 13, 1.2);
    l.position.set(x, 2.95, z);
    add(l);
  }
  for (const r of ROOMS) {
    const l = new THREE.PointLight(r.name === 'KHO LẠNH' ? 0x9fdcff : 0xffe7c4, 2.2, 7, 1.4);
    l.position.set((r.box.minX + r.box.maxX) / 2, 2.8, (r.box.minZ + r.box.maxZ) / 2);
    add(l);
  }

  // ---- Sàn, trần, tường ----
  const floor = add(
    new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.d), lambert(0xffffff, { map: floorTexture() })),
    true,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(STORE.w / 2, 0, STORE.d / 2);
  const back = add(new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.backZ), lambert(0x5a605c)));
  back.rotation.x = -Math.PI / 2;
  back.position.set(STORE.w / 2, 0.003, STORE.backZ / 2);
  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(STORE.w, STORE.d), lambert(0x1c2120)));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(STORE.w / 2, STORE.wallH, STORE.d / 2);

  const wallMat = lambert(0x48514e);
  for (const w of WALLS) add(boxFrom(w, 0, STORE.wallH, wallMat), true);
  const glass = add(
    boxFrom(GLASS, 0, STORE.wallH, new THREE.MeshLambertMaterial({ color: 0x9fd8e6, transparent: true, opacity: 0.14, depthWrite: false })),
    true,
  );
  glass.renderOrder = 2;

  // Đèn huỳnh quang dạng dải trên mỗi làn
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xe8fff6, toneMapped: false });
  for (const z of NAV_Z) {
    const t = add(new THREE.Mesh(new THREE.BoxGeometry(17, 0.05, 0.14), tubeMat));
    t.position.set(10.75, STORE.wallH - 0.06, z);
  }
  for (const r of ROOMS) {
    const t = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.14), tubeMat));
    t.position.set((r.box.minX + r.box.maxX) / 2, STORE.wallH - 0.06, (r.box.minZ + r.box.maxZ) / 2);
  }

  // ---- Kệ hàng ----
  const shelfMat = lambert(0x6d7774);
  const boardMat = lambert(0x8d9794);
  for (const row of SHELVES) {
    const g = new THREE.Group();
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X1 - SHELF_X0, SHELF_HEIGHT, 0.1), shelfMat);
    backPanel.position.set(SHELF_MID, SHELF_HEIGHT / 2, row.zc);
    g.add(backPanel);
    for (const y of BOARD_YS) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X1 - SHELF_X0, 0.04, 0.96), boardMat);
      b.position.set(SHELF_MID, y, row.zc);
      g.add(b);
    }
    for (const x of [SHELF_X0 + 0.03, SHELF_MID, SHELF_X1 - 0.03]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, SHELF_HEIGHT, 1.0), shelfMat);
      p.position.set(x, SHELF_HEIGHT / 2, row.zc);
      g.add(p);
    }
    add(g);
    // Hộp vô hình để raycast tương tác
    const hit = boxFrom(row.box, 0, SHELF_HEIGHT, new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData = { kind: 'shelf', row: row.id };
    add(hit, true);
    shelfHits.push(hit);
    // Biển tên dãy
    const sign = labelPlane([`DÃY ${row.id}`], 1.4, 0.42, { bg: '#1e2422', fg: '#f2c94c' });
    sign.position.set(SHELF_MID, 2.7, row.zc);
    add(sign);
  }

  // Hàng trên kệ: một InstancedMesh cho cả siêu thị
  const itemSlots: { section: string; m: THREE.Matrix4 }[] = [];
  const rand = (() => {
    let s = 1234567;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  for (const sec of SECTIONS) {
    const row = SHELVES[sec.row - 1];
    const zItem = row.zc + sec.out * 0.25;
    for (let x = sec.x0 + 0.2; x < sec.x1 - 0.15; x += 0.3) {
      for (let li = 0; li < 4; li++) {
        const w = 0.2 + rand() * 0.06;
        const h = 0.22 + rand() * 0.16;
        const d = 0.2 + rand() * 0.04;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, BOARD_YS[li] + 0.02 + h / 2, zItem),
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
  });
  add(items);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const setSectionFilled = (id: string, filled: boolean) => {
    itemSlots.forEach((s, i) => {
      if (s.section === id) items.setMatrixAt(i, filled ? s.m : ZERO);
    });
    items.instanceMatrix.needsUpdate = true;
  };

  // Thẻ "THIẾU HÀNG"
  const tags = new Map<string, THREE.Mesh>();
  const makeTag = (id: string) => {
    const sec = sectionById(id)!;
    const t = labelPlane(['THIẾU HÀNG'], 0.9, 0.22, { bg: '#b3261e', fg: '#ffffff' });
    t.position.set((sec.x0 + sec.x1) / 2, 1.92, sec.zFace + sec.out * 0.02);
    t.rotation.y = sec.out > 0 ? 0 : Math.PI;
    add(t);
    tags.set(id, t);
  };

  // ---- Tủ mát, quầy ----
  const cooler = add(boxFrom(COOLERS, 0, 2.1, lambert(0x1d3b44, { emissive: 0x2a6f80, emissiveIntensity: 0.55 })), true);
  cooler.userData = { kind: 'cooler' };
  const coolerSign = labelPlane(['TỦ MÁT'], 1.4, 0.36, { bg: '#1e2422', fg: '#9fdcff' });
  coolerSign.position.set(1.15, 2.4, 14.5);
  coolerSign.rotation.y = Math.PI / 2;
  add(coolerSign);
  add(boxFrom(COUNTER, 0, 1.05, lambert(0x3a3f3a)), true);
  const printer = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), lambert(0x1a1d1c));
  printer.position.set(21.2, 1.13, 21.5);
  add(printer);
  const counterSign = labelPlane(['QUẦY · ĐIỂM DANH 06:00'], 2.6, 0.38, { bg: '#1e2422', fg: '#d8f3ec' });
  counterSign.position.set(22, 2.6, 21.5);
  add(counterSign);

  // ---- Khu sau: biển phòng ----
  for (const r of ROOMS) {
    const s = labelPlane([r.name], 1.5, 0.36, { bg: '#1e2422', fg: '#d8f3ec' });
    s.position.set(r.door.x, 2.65, r.door.z + 0.13);
    add(s);
  }

  // Kho: đống thùng hàng
  const cardboard = lambert(0xa47a4a);
  const pileBoxes: THREE.Mesh[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.58), cardboard);
        b.position.set(BOX_PILE.minX + 0.34 + i * 0.66, 0.25 + layer * 0.52, BOX_PILE.minZ + 0.34 + j * 0.66);
        b.userData = { kind: 'pile' };
        add(b, true);
        pileBoxes.push(b);
      }
    }
  }
  const pileSign = labelPlane(['HÀNG MỚI · MANG RA KỆ THIẾU HÀNG'], 2.4, 0.3, { bg: '#1e2422', fg: '#f2c94c' });
  pileSign.position.set(2, 2.2, 0.13);
  add(pileSign);

  // Thùng đã lưu kho (bắt đầu với thùng của Tuấn)
  const stored: THREE.Object3D[] = [];
  const storedBox = (lines: string[], x: number, z: number) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.7), cardboard);
    b.position.y = 0.31;
    g.add(b);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), lambert(0xd8cfb4));
    tape.position.y = 0.4;
    g.add(tape);
    const l = labelPlane(lines, 0.56, 0.3, { bg: '#fbfaf6', fg: '#2a2117' });
    l.position.set(0, 0.28, 0.356);
    g.add(l);
    g.position.set(x, 0, z);
    add(g);
    stored.push(g);
  };
  storedBox(['TUẤN · NV 0388', 'ĐÃ LƯU KHO'], 8.6, 1.0);

  // Kho lạnh: bảng nhiệt độ
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.45, 0.08),
    lambert(0x163542, { emissive: 0x3aa7c9, emissiveIntensity: 0.6 }),
  );
  panel.position.set(FREEZER_PANEL.x, 1.45, FREEZER_PANEL.z);
  panel.userData = { kind: 'freezer' };
  add(panel);
  const panelSign = labelPlane(['NHIỆT ĐỘ TỦ ĐÔNG', '23 · 01 · 03 · 05 giờ'], 1.2, 0.36, { bg: '#1e2422', fg: '#9fdcff' });
  panelSign.position.set(FREEZER_PANEL.x, 2.0, 0.16);
  add(panelSign);
  for (const z of [1.5, 3.2]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 1.4), lambert(0xc8d6dc));
    f.position.set(13.4, 0.95, z + 0.6);
    add(f);
  }

  // Phòng điện: tủ điện
  const breaker = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.25), lambert(0x6b6f5a));
  breaker.position.set(16, 1.4, 0.25);
  add(breaker);

  // Phòng nghỉ: bàn và bảng phân ca
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 0.8), lambert(0x6b5b4a));
  table.position.set(21, 0.375, 2.6);
  add(table);
  const roster = labelPlane(['BẢNG PHÂN CA', `1. ${playerName.toUpperCase()}`], 1.4, 0.8, { bg: '#f1eee6', fg: '#24221e' });
  roster.position.set(21, 1.7, 0.13);
  add(roster);

  // ---- Bên ngoài mặt kính: nhóm ca trước ----
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), lambert(0x121615));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(12, -0.01, 34);
  add(outside);
  const figures: THREE.Mesh[] = [];
  for (const [x, z] of [[6, 26.4], [11.2, 27], [15.6, 26.2]]) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.25, 4, 8), lambert(0x1a1f20));
    f.position.set(x, 0.86, z);
    add(f);
    figures.push(f);
  }

  // ---- Lon nước đã ném ----
  const cans: THREE.Mesh[] = [];
  const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10);
  const canMat = lambert(0xc23a2e);

  let pileCount = 0;
  const setPileCount = (n: number) => {
    pileCount = n;
    pileBoxes.forEach((b, i) => (b.visible = i < pileCount));
  };

  return {
    scene,
    raySolids,
    interactables: () => [...shelfHits, ...pileBoxes.filter((b) => b.visible), panel],
    resetNight(needed, pile, night) {
      for (const sec of SECTIONS) setSectionFilled(sec.id, !needed.has(sec.id));
      tags.forEach((t) => scene.remove(t));
      tags.clear();
      needed.forEach((id) => makeTag(id));
      setPileCount(pile);
      cans.forEach((c) => scene.remove(c));
      cans.length = 0;
      figures.forEach((f) => (f.visible = night >= 2));
    },
    setRestocked(id) {
      setSectionFilled(id, true);
      const t = tags.get(id);
      if (t) {
        scene.remove(t);
        tags.delete(id);
      }
    },
    setPileCount,
    addCan(x, z) {
      const c = new THREE.Mesh(canGeo, canMat);
      c.rotation.z = Math.PI / 2;
      c.rotation.y = Math.random() * Math.PI;
      c.position.set(x, 0.034, z);
      add(c);
      cans.push(c);
    },
    addStoredBox(name) {
      const n = stored.length;
      storedBox([`${name.toUpperCase()}`, 'ĐÃ LƯU KHO'], 8.6, 1.0 + n * 0.85);
    },
  };
}
