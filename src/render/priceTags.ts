// Bảng giá trên nẹp kệ và tủ lạnh: tên hàng, giá to màu đỏ, đơn vị, dải màu bao bì, mã vạch.
// Mọi bảng giá dùng chung MỘT texture (mỗi món một ô) và vẽ bằng MỘT InstancedMesh: ~1000 bảng = 1 lệnh vẽ.

import * as THREE from 'three';
import { PRODUCTS, formatPrice, type ProductId } from '../sim/products.ts';

const COLS = 4;
const ROWS = Math.ceil(PRODUCTS.length / COLS);
const TW = 256;
const TH = 128;
/** Kích thước bảng giá trên kệ (m): vừa dải nẹp giá cao 6 cm. */
export const TAG_W = 0.12;
export const TAG_H = 0.06;

let cached: { tex: THREE.CanvasTexture; index: Map<string, number> } | null = null;

function atlas(): { tex: THREE.CanvasTexture; index: Map<string, number> } {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = COLS * TW;
  c.height = ROWS * TH;
  const g = c.getContext('2d')!;
  const font = '"Segoe UI", Arial, sans-serif';
  const index = new Map<string, number>();
  PRODUCTS.forEach((p, i) => {
    index.set(p.id, i);
    const x0 = (i % COLS) * TW;
    const y0 = Math.floor(i / COLS) * TH;
    // nền giấy trắng ngà, viền mảnh (chừa lề 3 px để mipmap không lem sang ô bên)
    g.fillStyle = '#fbfaf3';
    g.fillRect(x0, y0, TW, TH);
    g.strokeStyle = '#c9c4b5';
    g.lineWidth = 3;
    g.strokeRect(x0 + 3, y0 + 3, TW - 6, TH - 6);
    // dải màu bao bì + tên hàng
    g.fillStyle = p.color;
    g.fillRect(x0 + 5, y0 + 5, TW - 10, 34);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    let px = 22;
    do g.font = `800 ${px}px ${font}`;
    while (g.measureText(p.name).width > TW - 22 && --px > 12);
    g.fillText(p.name, x0 + 11, y0 + 23);
    // giá to màu đỏ
    g.fillStyle = '#c62828';
    g.font = `900 46px ${font}`;
    g.fillText(formatPrice(p.price), x0 + 10, y0 + 70);
    // đơn vị
    g.fillStyle = '#5a554a';
    g.font = `600 17px ${font}`;
    g.fillText(`/ 1 ${p.unit}`, x0 + 12, y0 + 107);
    // mã vạch nhỏ (giả, cố định theo mã hàng)
    let seed = [...p.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
    g.fillStyle = '#1e1e1e';
    let bx = x0 + TW - 96;
    while (bx < x0 + TW - 12) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = 1 + (seed >>> 28) % 3;
      g.fillRect(bx, y0 + 92, w, 26);
      bx += w + 1 + ((seed >>> 24) & 1) * 2;
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cached = { tex, index };
  return cached;
}

export interface TagPlacement {
  id: ProductId | string;
  /** Ma trận đặt bảng giá: tâm bảng, mặt chữ quay về +Z cục bộ. */
  m: THREE.Matrix4;
  /** Tỉ lệ so với cỡ chuẩn (tủ lạnh dùng bảng nhỏ hơn). */
  scale?: number;
}

/** Gộp mọi bảng giá thành một InstancedMesh. Bảng giá được chiếu sáng như vật thật (mất điện thì tối theo). */
export function buildPriceTags(list: TagPlacement[]): THREE.InstancedMesh | null {
  const items = list.filter((t) => atlas().index.has(t.id));
  if (!items.length) return null;
  const { tex, index } = atlas();
  const geo = new THREE.PlaneGeometry(TAG_W, TAG_H);
  const uv = new Float32Array(items.length * 2);
  items.forEach((t, i) => {
    const k = index.get(t.id)!;
    uv[i * 2] = (k % COLS) / COLS;
    uv[i * 2 + 1] = 1 - (Math.floor(k / COLS) + 1) / ROWS;
  });
  geo.setAttribute('tagUv', new THREE.InstancedBufferAttribute(uv, 2));
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 });
  const sx = (1 / COLS).toFixed(6);
  const sy = (1 / ROWS).toFixed(6);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 tagUv;\n' + sh.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>\n  vMapUv = vMapUv * vec2(${sx}, ${sy}) + tagUv;\n  vEmissiveMapUv = vMapUv;`,
    );
  };
  mat.customProgramCacheKey = () => 'bang_gia';
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const s = new THREE.Matrix4();
  items.forEach((t, i) => im.setMatrixAt(i, t.scale ? t.m.clone().multiply(s.makeScale(t.scale, t.scale, 1)) : t.m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false;
  im.receiveShadow = false;
  return im;
}
