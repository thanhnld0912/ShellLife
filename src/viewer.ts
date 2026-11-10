// Trang xem model .glb trong public/models (đọc danh sách từ manifest.json do script Blender sinh ra).
// Có chế độ so sánh 2 bản nhân viên đứng cạnh nhau và bộ lọc hình kiểu PS1 (phân giải thấp, nén màu, sương mù).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface ClipMeta { ten: string; nhan: string; lap: boolean }
interface ModelMeta {
  file: string;
  ten: string;
  mo_ta: string;
  tris: number;
  kb: number;
  kich_thuoc_m: [number, number, number];
  chuyen_dong?: ClipMeta[];
}
interface Entry {
  meta: ModelMeta;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  active: THREE.AnimationAction | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const BG_STUDIO = new THREE.Color(0x1d2321);
const BG_NIGHT = new THREE.Color(0x07090a);
scene.background = BG_STUDIO.clone();
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
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
studio.add(new THREE.HemisphereLight(0xdfe8e4, 0x2a2420, 1.4), sun);
const night = new THREE.Group();
const tube = new THREE.PointLight(0xd8fff2, 6, 8, 1.6);
tube.position.set(0, 3.0, 0.5);
tube.castShadow = true;
night.add(new THREE.AmbientLight(0x6a7a8a, 0.25), tube);
scene.add(studio);
let isNight = false;

// ---------------------------------------------------------------- bộ lọc PS1
const PS1_SCALE = 3.5; // mỗi "điểm ảnh" to bằng ~3,5 điểm màn hình
const lowRT = new THREE.WebGLRenderTarget(2, 2, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
const postMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: lowRT.texture }, res: { value: new THREE.Vector2(2, 2) }, levels: { value: 24 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float levels; varying vec2 vUv;
    float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    void main(){
      vec4 c = linearToOutputTexel(texture2D(tDiffuse, vUv));
      float d = (bayer4(floor(vUv * res)) - 0.5) / levels;
      vec3 q = floor((c.rgb + d) * levels + 0.5) / levels;
      gl_FragColor = vec4(q, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const postScene = new THREE.Scene();
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let ps1 = false;
let fogDist = 4;

function applyFog() {
  scene.fog = ps1 ? new THREE.Fog(isNight ? BG_NIGHT : BG_STUDIO, fogDist * 0.55, fogDist * 2.0) : null;
}

// ---------------------------------------------------------------- tải model
const loader = new GLTFLoader();
let entries: Entry[] = [];
let speed = 1;
let lastClip = 'di';
const clock = new THREE.Clock();
let manifest: ModelMeta[] = [];

const refPerson = new THREE.Group();
let refOn = false;
loader.load('/models/nhan_vien.glb', (g) => {
  refPerson.add(g.scene);
  g.scene.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  refPerson.visible = false;
  scene.add(refPerson);
});

function loadEntry(meta: ModelMeta): Promise<Entry> {
  return new Promise((resolve, reject) => {
    loader.load(`/models/${meta.file}`, (g) => {
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.frustumCulled = false; // mesh có xương: tránh bị cắt mất khi đang chạy chuyển động
        }
      });
      resolve({
        meta,
        root: g.scene,
        mixer: new THREE.AnimationMixer(g.scene),
        clips: new Map(g.animations.map((c) => [c.name, c])),
        active: null,
      });
    }, undefined, reject);
  });
}

function frameAll() {
  const box = new THREE.Box3();
  for (const e of entries) box.expandByObject(e.root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.05);
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
  camera.position.copy(center).add(new THREE.Vector3(0.45, 0.4, 1).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  grid.scale.setScalar(r < 0.3 ? 0.1 : 1);
  fogDist = dist;
  applyFog();
  refPerson.position.x = box.min.x - 0.5;
}

let loadToken = 0;
async function showModels(metas: ModelMeta[], spacing = 1.1, infoHtml?: string) {
  const token = ++loadToken;
  const loaded = await Promise.all(metas.map(loadEntry));
  if (token !== loadToken) return;
  for (const e of entries) scene.remove(e.root);
  entries = loaded;
  entries.forEach((e, i) => {
    e.root.position.x = (i - (entries.length - 1) / 2) * spacing;
    scene.add(e.root);
  });
  frameAll();
  buildClipButtons();
  const m = metas[0];
  const [w, h, d] = m.kich_thuoc_m;
  $('info').innerHTML = infoHtml ??
    `<b>${m.ten}</b>${m.mo_ta}<div class="meta">${m.tris} tam giác · ${m.kb} KB<br>Rộng ${w} × cao ${h} × sâu ${d} m<br><code>/models/${m.file}</code></div>`;
}

// ---------------------------------------------------------------- chuyển động
function clipInfo(name: string): ClipMeta | undefined {
  for (const e of entries) {
    const c = e.meta.chuyen_dong?.find((x) => x.ten === name);
    if (c) return c;
  }
  return undefined;
}

function play(name: string) {
  lastClip = name;
  const info = clipInfo(name);
  for (const e of entries) {
    const clip = e.clips.get(name) ?? e.clips.get('dung') ?? e.clips.get('dung_im');
    if (!clip) continue;
    const next = e.mixer.clipAction(clip);
    next.reset();
    if (info && !info.lap && clip.name === name) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    if (e.active && e.active !== next) next.crossFadeFrom(e.active, 0.25, false);
    next.play();
    e.active = next;
  }
  document.querySelectorAll<HTMLButtonElement>('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
}

function buildClipButtons() {
  const host = $('clips');
  host.innerHTML = '';
  const names: string[] = [];
  for (const e of entries) {
    const order = (e.meta.chuyen_dong ?? []).map((c) => c.ten);
    for (const n of [...e.clips.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      if (!names.includes(n)) names.push(n);
    }
  }
  if (!names.length) return;
  host.insertAdjacentHTML('beforeend', `<div class="t">Chuyển động (${names.length})</div>`);
  for (const n of names) {
    const info = clipInfo(n);
    const owners = entries.filter((e) => e.clips.has(n));
    const only = entries.length > 1 && owners.length === 1 ? ` <small>(chỉ ${owners[0].meta.ten.includes('ngố') ? 'bản ngố' : 'bản cũ'})</small>` : '';
    const b = document.createElement('button');
    b.dataset.clip = n;
    b.innerHTML = (info?.nhan ?? n) + (info && !info.lap ? ' <small>↻ bấm lại để xem lại</small>' : '') + only;
    b.onclick = () => play(n);
    host.appendChild(b);
  }
  const lab = document.createElement('label');
  lab.innerHTML = `Tốc độ <input type="range" min="0.1" max="2" step="0.05" value="${speed}"><span>${speed.toFixed(2)}×</span>`;
  const inp = lab.querySelector('input') as HTMLInputElement;
  const out = lab.querySelector('span') as HTMLElement;
  inp.oninput = () => {
    speed = Number(inp.value);
    out.textContent = speed.toFixed(2) + '×';
  };
  host.appendChild(lab);
  play(names.includes(lastClip) ? lastClip : names.includes('di') ? 'di' : names[0]);
}

// ---------------------------------------------------------------- danh sách + nút
function markList(btn: HTMLElement | null) {
  document.querySelectorAll('button.item').forEach((b) => b.classList.toggle('on', b === btn));
}

fetch('/models/manifest.json')
  .then((r) => r.json())
  .then((list: ModelMeta[]) => {
    manifest = list;
    const host = $('list');
    const cmp = document.createElement('button');
    cmp.className = 'item compare';
    cmp.innerHTML = '⇆ So sánh 2 bản nhân viên';
    cmp.onclick = () => {
      markList(cmp);
      showCompare();
    };
    host.appendChild(cmp);
    let saved: string | null = null;
    try { saved = localStorage.getItem('viewer-model'); } catch { /* bỏ qua */ }
    let first: (() => void) | null = () => cmp.click();
    for (const m of list) {
      const b = document.createElement('button');
      b.className = 'item';
      b.innerHTML = `${m.ten}<small>${m.tris}</small>`;
      b.onclick = () => {
        markList(b);
        showModels([m]);
        try { localStorage.setItem('viewer-model', m.file); } catch { /* bỏ qua */ }
      };
      host.appendChild(b);
      if (m.file === saved) first = () => b.click();
    }
    first?.();
  });

function showCompare() {
  const a = manifest.find((m) => m.file === 'nhan_vien.glb');
  const b = manifest.find((m) => m.file === 'nhan_vien_ngo.glb');
  if (!a || !b) return;
  try { localStorage.removeItem('viewer-model'); } catch { /* bỏ qua */ }
  showModels([a, b], 1.15,
    `<b>So sánh nhân viên</b>Trái: <b style="display:inline">bản hiện tại</b> (tỉ lệ người thật).<br>Phải: <b style="display:inline">bản ngố</b> (đầu to, tay to, đi lạch bạch).<div class="meta">Động tác chỉ bản ngố có thì bản cũ đứng thở. Thử bật "Bộ lọc PS1" + "Ánh sáng ca đêm" để xem cảm giác trong game.</div>`);
}

const btnS = $<HTMLButtonElement>('lightStudio');
const btnN = $<HTMLButtonElement>('lightGame');
const btnP = $<HTMLButtonElement>('ps1');
const btnR = $<HTMLButtonElement>('scaleRef');
btnS.onclick = () => {
  isNight = false;
  scene.remove(night);
  scene.add(studio);
  scene.background = BG_STUDIO.clone();
  btnS.classList.add('on');
  btnN.classList.remove('on');
  applyFog();
};
btnN.onclick = () => {
  isNight = true;
  scene.remove(studio);
  scene.add(night);
  scene.background = BG_NIGHT.clone();
  btnN.classList.add('on');
  btnS.classList.remove('on');
  applyFog();
};
btnP.onclick = () => {
  ps1 = !ps1;
  btnP.classList.toggle('on', ps1);
  applyFog();
  resize();
};
btnR.onclick = () => {
  refOn = !refOn;
  refPerson.visible = refOn;
  btnR.classList.toggle('on', refOn);
};

// ---------------------------------------------------------------- vòng lặp
function resize() {
  const p = canvas.parentElement as HTMLElement;
  renderer.setSize(p.clientWidth, p.clientHeight, false);
  camera.aspect = p.clientWidth / p.clientHeight;
  camera.updateProjectionMatrix();
  const w = Math.max(2, Math.floor(p.clientWidth / PS1_SCALE));
  const h = Math.max(2, Math.floor(p.clientHeight / PS1_SCALE));
  lowRT.setSize(w, h);
  postMat.uniforms.res.value.set(w, h);
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() * speed;
  for (const e of entries) e.mixer.update(dt);
  controls.update();
  if (ps1) {
    renderer.setRenderTarget(lowRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  } else {
    renderer.render(scene, camera);
  }
});
