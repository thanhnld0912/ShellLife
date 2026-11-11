import * as THREE from 'three';

export interface LabelStyle {
  bg?: string;
  fg?: string;
  font?: string;
  px?: number;
  w?: number;
  h?: number;
}

/** Vẽ chữ lên canvas làm texture. Dùng cho biển tên, nhãn thùng, bảng phân ca. */
export function labelTexture(lines: string[], s: LabelStyle = {}): THREE.CanvasTexture {
  const w = s.w ?? 512;
  const h = s.h ?? 192;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = s.bg ?? '#f1eee6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = s.fg ?? '#1e2422';
  const px = s.px ?? Math.floor(h / (lines.length + 0.8));
  g.font = `700 ${px}px ${s.font ?? '"Segoe UI", Arial, sans-serif'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const step = h / (lines.length + 1);
  lines.forEach((t, i) => g.fillText(t, w / 2, step * (i + 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Biển một mặt, chữ đọc được từ phía +Z của nó (xoay rotation.y để quay mặt).
 * Chỉ vẽ mặt trước: nhìn từ phía sau không thấy, tránh chữ bị ngược như soi gương.
 */
export function labelPlane(lines: string[], width: number, height: number, s: LabelStyle = {}): THREE.Mesh {
  const tex = labelTexture(lines, { w: 512, h: Math.round((512 * height) / width), ...s });
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

/** Biển treo hai mặt: hai tấm quay lưng vào nhau, đứng phía nào cũng đọc xuôi. */
export function labelSign(lines: string[], width: number, height: number, s: LabelStyle = {}): THREE.Group {
  const g = new THREE.Group();
  const front = labelPlane(lines, width, height, s);
  front.position.z = 0.004;
  const back = new THREE.Mesh(front.geometry, front.material);
  back.rotation.y = Math.PI;
  back.position.z = -0.004;
  g.add(front, back);
  return g;
}
