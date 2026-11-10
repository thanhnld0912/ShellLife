// Trang xem model .glb trong public/models (đọc danh sách từ manifest.json do script Blender sinh ra).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface ModelMeta {
  file: string;
  ten: string;
  mo_ta: string;
  tris: number;
  kb: number;
  kich_thuoc_m: [number, number, number];
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2321);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x3a403d }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(10, 20, 0x56605b, 0x2e3532);
grid.position.y = 0.001;
scene.add(grid);

// Hai bộ đèn: xem rõ hình dạng / giống trong game (huỳnh quang lạnh, tối)
const studio = new THREE.Group();
const hemi = new THREE.HemisphereLight(0xdfe8e4, 0x2a2420, 1.4);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
studio.add(hemi, sun);
const night = new THREE.Group();
const tube = new THREE.PointLight(0xd8fff2, 6, 8, 1.6);
tube.position.set(0, 3.0, 0.5);
tube.castShadow = true;
night.add(new THREE.AmbientLight(0x6a7a8a, 0.25), tube);
scene.add(studio);

const loader = new GLTFLoader();
let current: THREE.Object3D | null = null;
const refPerson = new THREE.Group();
let refOn = false;

loader.load('/models/nhan_vien.glb', (g) => {
  refPerson.add(g.scene);
  g.scene.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  refPerson.position.x = -1.0;
  refPerson.visible = false;
  scene.add(refPerson);
});

function frame(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.05);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
  camera.position.copy(center).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  // lưới nhỏ cho đồ nhỏ
  const s = r < 0.3 ? 0.1 : 1;
  grid.scale.setScalar(s);
}

function show(m: ModelMeta, btn: HTMLElement) {
  document.querySelectorAll('button.item').forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
  const [w, h, d] = m.kich_thuoc_m;
  (document.getElementById('info') as HTMLElement).innerHTML =
    `<b>${m.ten}</b>${m.mo_ta}<div class="meta">${m.tris} tam giác · ${m.kb} KB<br>Rộng ${w} × cao ${h} × sâu ${d} m<br><code>/models/${m.file}</code></div>`;
  loader.load(`/models/${m.file}`, (g) => {
    if (current) scene.remove(current);
    current = g.scene;
    current.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    scene.add(current);
    frame(current);
    const box = new THREE.Box3().setFromObject(current);
    refPerson.position.x = box.min.x - 0.5;
  });
  try { localStorage.setItem('viewer-model', m.file); } catch { /* bỏ qua */ }
}

fetch('/models/manifest.json')
  .then((r) => r.json())
  .then((list: ModelMeta[]) => {
    const host = document.getElementById('list') as HTMLElement;
    let saved: string | null = null;
    try { saved = localStorage.getItem('viewer-model'); } catch { /* bỏ qua */ }
    let first: [ModelMeta, HTMLElement] | null = null;
    for (const m of list) {
      const b = document.createElement('button');
      b.className = 'item';
      b.innerHTML = `${m.ten}<small>${m.tris}</small>`;
      b.onclick = () => show(m, b);
      host.appendChild(b);
      if (!first || m.file === saved) first = [m, b];
    }
    if (first) show(first[0], first[1]);
  });

const btnS = document.getElementById('lightStudio') as HTMLButtonElement;
const btnN = document.getElementById('lightGame') as HTMLButtonElement;
const btnR = document.getElementById('scaleRef') as HTMLButtonElement;
btnS.onclick = () => { scene.remove(night); scene.add(studio); scene.background = new THREE.Color(0x1d2321); btnS.classList.add('on'); btnN.classList.remove('on'); };
btnN.onclick = () => { scene.remove(studio); scene.add(night); scene.background = new THREE.Color(0x07090a); btnN.classList.add('on'); btnS.classList.remove('on'); };
btnR.onclick = () => {
  refOn = !refOn;
  refPerson.visible = refOn;
  btnR.classList.toggle('on', refOn);
  if (current) {
    const box = new THREE.Box3().setFromObject(current);
    refPerson.position.x = box.min.x - 0.5;
  }
};

function resize() {
  const p = canvas.parentElement as HTMLElement;
  renderer.setSize(p.clientWidth, p.clientHeight, false);
  camera.aspect = p.clientWidth / p.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
