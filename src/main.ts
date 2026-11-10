// Bản thử giai đoạn 1: một người chơi, siêu thị khối xám, Người Kiểm Kê, chỉ tiêu, đóng thùng, chế độ xem.

import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Game, type Evaluation } from './sim/game.ts';
import { PLAYER_SPAWN, sectionAt, type Section } from './sim/layout.ts';
import type { V2 } from './sim/geometry.ts';
import { buildWorld, type World } from './render/world.ts';
import { AuditorView } from './render/auditorView.ts';
import { PlayerController } from './client/player.ts';
import { GameAudio } from './client/audio.ts';
import { Hud } from './client/hud.ts';

type Mode = 'menu' | 'play' | 'eval' | 'dying' | 'spectate' | 'final';

// ---- Khởi tạo three.js ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app')!.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 60);
const controls = new PointerLockControls(camera, document.body);
const player = new PlayerController(camera);
const audio = new GameAudio();
const hud = new Hud();

let mode: Mode = 'menu';
let game: Game | null = null;
let world: World | null = null;
let auditorView: AuditorView | null = null;
let debug = false;
let sheetOpen = false;
let sheetRefresh = 0;
let scanTarget: string | null = null;
let scanT = 0;
let scanBeepT = 0;
let canCooldown = 0;
let specIdx = 0;
let dyingName = '';

const SPEC_CAMS: { pos: [number, number, number]; look: [number, number, number]; name: string }[] = [
  { pos: [1.6, 2.9, 7.0], look: [12, 0.6, 16], name: 'CAMERA 1 · GÓC TÂY BẮC' },
  { pos: [22.6, 2.9, 7.0], look: [10, 0.6, 16], name: 'CAMERA 2 · GÓC ĐÔNG BẮC' },
  { pos: [1.6, 2.9, 23.2], look: [12, 0.6, 12], name: 'CAMERA 3 · MẶT KÍNH TÂY' },
  { pos: [23.0, 2.9, 23.4], look: [10, 0.6, 12], name: 'CAMERA 4 · QUẦY' },
  { pos: [9.6, 2.6, 5.2], look: [6, 0.4, 1.2], name: 'CAMERA 5 · KHO' },
];

// ---- Bắt đầu ----
const nameInput = document.getElementById('name') as HTMLInputElement;
document.getElementById('start')!.addEventListener('click', () => {
  const name = (nameInput.value.trim() || 'Minh').slice(0, 14);
  game = new Game(name);
  world = buildWorld(name);
  world.scene.add(camera);
  auditorView = new AuditorView(world.scene);
  world.resetNight(game.shift.restockNeeded, game.shift.pile, game.night);
  player.teleport(PLAYER_SPAWN);
  player.setCarrying(false);
  player.onNoise = (at, r, e) => game?.noise(at, r, e);
  audio.start();
  hud.show('menu', false);
  hud.show('hud', true);
  hud.badge(name, 0);
  mode = 'play';
  controls.lock();
});

document.getElementById('pause')!.addEventListener('click', () => {
  if (mode === 'play') controls.lock();
});
controls.addEventListener('lock', () => hud.show('pause', false));
controls.addEventListener('unlock', () => {
  if (mode === 'play') hud.show('pause', true);
});

// ---- Phím ----
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && mode === 'play') {
    e.preventDefault();
    if (game) {
      sheetOpen = !sheetOpen;
      hud.sheet(game, sheetOpen);
    }
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    debug = !debug;
    if (!debug) hud.debug(null);
    return;
  }
  if (mode === 'spectate') {
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      specIdx = (specIdx + (e.code === 'ArrowRight' ? 1 : SPEC_CAMS.length - 1)) % SPEC_CAMS.length;
      setSpectateCam();
    }
    if (e.code === 'KeyR') location.reload();
    return;
  }
  if (mode !== 'play' || !controls.isLocked || !game || !world || e.repeat) return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyQ') throwCan();
});

// ---- Tương tác ----
const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
type Focus = { kind: 'shelf'; section: Section } | { kind: 'pile' } | { kind: 'freezer' } | null;

function getFocus(): Focus {
  if (!world) return null;
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 2.6;
  const hit = raycaster.intersectObjects(world.interactables(), false)[0];
  if (!hit) return null;
  const kind = hit.object.userData.kind as string;
  if (kind === 'shelf') return { kind: 'shelf', section: sectionAt(hit.object.userData.row as number, hit.point.x, hit.point.z) };
  if (kind === 'pile') return { kind: 'pile' };
  if (kind === 'freezer') return { kind: 'freezer' };
  return null;
}

function interact(): void {
  if (!game || !world) return;
  const f = getFocus();
  if (player.carrying) {
    if (f?.kind === 'shelf') {
      const r = game.restock(f.section.id);
      if (r.ok) {
        world.setRestocked(f.section.id);
        player.setCarrying(false);
        game.noise({ ...player.pos }, 5, 1.5);
        audio.click(p3(player.pos, 1), 0.6, 1200);
        hud.toast(`+${r.cong} công · ${r.msg}`, true);
      } else hud.toast(r.msg, false);
    }
    return;
  }
  if (f?.kind === 'pile') {
    if (game.takeBox()) {
      world.setPileCount(game.shift.pile);
      player.setCarrying(true);
      game.noise({ ...player.pos }, 3, 1);
      hud.toast('Đã lấy một thùng hàng. Tìm kệ có thẻ THIẾU HÀNG.', true);
    }
    return;
  }
  if (f?.kind === 'freezer') {
    const r = game.freezer();
    if (r.ok) {
      audio.tone(1500, 0.08, 0.08);
      hud.toast(
        r.safeCapped ? `${r.msg} · Đã đủ công an toàn, việc này không được tính thêm` : `+${r.cong} công (an toàn) · ${r.msg}`,
        !r.safeCapped,
      );
    } else hud.toast(r.msg, false);
  }
}

function throwCan(): void {
  if (!game || !world || canCooldown > 0) return;
  canCooldown = 6;
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 12;
  const hit = raycaster.intersectObjects(world.raySolids, false)[0];
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const land: V2 = hit
    ? { x: hit.point.x - dir.x * 0.3, z: hit.point.z - dir.z * 0.3 }
    : { x: camera.position.x + dir.x * 8, z: camera.position.z + dir.z * 8 };
  land.x = Math.max(0.4, Math.min(23.6, land.x));
  land.z = Math.max(0.4, Math.min(23.6, land.z));
  game.shift.stats.cans++;
  hud.toast('Đã ném một lon nước.', true);
  setTimeout(() => {
    if (!game || !world || mode !== 'play') return;
    world.addCan(land.x, land.z);
    audio.clank(p3(land, 0.1));
    game.noise(land, 11, 2);
  }, 450);
}

function updateScan(dt: number, f: Focus): void {
  if (!game) return;
  const holding = player.keys.has('KeyF') && !player.carrying && f?.kind === 'shelf';
  if (!holding || f?.kind !== 'shelf') {
    scanT = 0;
    scanTarget = null;
    hud.scanner(f?.kind === 'shelf' && !player.carrying ? f.section.name : null, 0, f?.kind === 'shelf' && game.shift.scanned.has(f.section.id));
    return;
  }
  const id = f.section.id;
  const done = game.shift.scanned.has(id);
  if (done) {
    hud.scanner(f.section.name, 1, true);
    return;
  }
  if (scanTarget !== id) {
    scanTarget = id;
    scanT = 0;
    scanBeepT = 0.5;
  }
  scanT += dt;
  scanBeepT += dt;
  if (scanBeepT >= 0.5) {
    scanBeepT = 0;
    audio.tone(1320, 0.06, 0.07);
    game.noise({ ...player.pos }, 4, 1); // máy quét kêu bíp cũng là tiếng động
  }
  hud.scanner(f.section.name, scanT / 1.5, false);
  if (scanT >= 1.5) {
    const r = game.scanSection(id);
    hud.toast(r.ok ? `+${r.cong} công · ${r.msg}` : r.msg, r.ok);
    audio.tone(1760, 0.12, 0.08);
    scanT = 0;
    scanTarget = null;
  }
}

function hintFor(f: Focus): string {
  if (!game) return '';
  if (player.carrying) {
    if (f?.kind === 'shelf')
      return game.shift.restockNeeded.has(f.section.id) ? `[E] Xếp hàng vào ${f.section.name}` : 'Kệ này không thiếu hàng';
    return 'Đang ôm thùng · tìm kệ có thẻ THIẾU HÀNG';
  }
  if (f?.kind === 'pile') return `[E] Lấy thùng hàng (còn ${game.shift.pile})`;
  if (f?.kind === 'freezer')
    return game.shift.freezerWindow() !== null ? '[E] Ghi nhiệt độ tủ đông' : 'Chưa đến giờ ghi nhiệt độ';
  if (f?.kind === 'shelf') return game.shift.scanned.has(f.section.id) ? '' : '[Giữ F] Quét kệ';
  return '';
}

// ---- Sự kiện từ lõi game ----
function handleEvents(): void {
  if (!game) return;
  for (const e of game.events) {
    switch (e.type) {
      case 'announce':
        hud.announce(e.text);
        audio.speak(e.text);
        break;
      case 'heard':
        audio.tone(1760, 0.05, 0.1, p3(game.auditor.pos, 1.3), 'square');
        setTimeout(() => game && audio.tone(1760, 0.05, 0.1, p3(game.auditor.pos, 1.3), 'square'), 120);
        break;
      case 'count':
        hud.count(e.n);
        audio.tone(e.n === 1 ? 990 : 1180, 0.16, 0.2, p3(game.auditor.pos, 1.3));
        audio.speak(e.n === 1 ? 'Một' : 'Hai', 1.0);
        break;
      case 'lost':
        hud.count(0);
        break;
      case 'step':
        audio.click(p3(e.at, 0.05), 0.35);
        break;
      case 'beep':
        audio.tone(2100, 0.04, 0.05, p3(e.at, 1.3), 'square');
        break;
      case 'eval':
        onEval(e.ev);
        break;
      case 'dead':
        startDeath(e.reason);
        break;
      case 'noise':
        break;
    }
  }
  game.events.length = 0;
}

function onEval(ev: Evaluation): void {
  if (!game) return;
  mode = 'eval';
  sheetOpen = false;
  hud.sheet(game, false);
  hud.scanner(null);
  hud.count(0);
  controls.unlock();
  hud.show('pause', false);
  hud.badge(game.name, game.holes);
  hud.evaluation(game, ev, () => {
    hud.show('eval', false);
    if (!game || !world) return;
    if (ev.dead) {
      game.terminate();
      handleEvents();
      return;
    }
    if (ev.final) {
      showFinal();
      return;
    }
    game.nextNight();
    world.resetNight(game.shift.restockNeeded, game.shift.pile, game.night);
    player.teleport(PLAYER_SPAWN);
    player.setCarrying(false);
    mode = 'play';
    controls.lock();
  });
}

function startDeath(reason: 'scan' | 'holes'): void {
  if (!game || !world) return;
  mode = 'dying';
  dyingName = game.name;
  hud.count(0);
  hud.scanner(null);
  hud.sheet(game, false);
  sheetOpen = false;
  player.setCarrying(false);
  controls.unlock();
  hud.show('pause', false);
  audio.cancelSpeech();
  audio.tone(880, 1.3, 0.16);
  hud.death('red', dyingName, reason);
  audio.speak(reason === 'scan' ? `Nhân viên ${dyingName}: đã kiểm đếm. Xin cảm ơn.` : `Nhân viên ${dyingName}: chấm dứt hợp đồng. Xin cảm ơn.`);
  setTimeout(() => hud.death('black', dyingName, reason), 1700);
  setTimeout(() => {
    world?.addStoredBox(dyingName);
    hud.death('off');
    hud.show('hud', false);
    mode = 'spectate';
    specIdx = 4; // mở đầu bằng camera kho: thấy thùng mang tên mình
    setSpectateCam();
  }, 5200);
}

function setSpectateCam(): void {
  const c = SPEC_CAMS[specIdx];
  camera.position.set(...c.pos);
  camera.lookAt(...c.look);
  hud.spectate(`${c.name} · ${specIdx + 1}/${SPEC_CAMS.length}`);
}

function showFinal(): void {
  if (!game) return;
  mode = 'final';
  const el = document.getElementById('final-body')!;
  el.innerHTML = `
    <h4>Phiếu lương · Thử việc</h4><hr>
    <div class="row"><span>${game.name.toUpperCase()}</span><span>đã thanh toán</span></div>
    <div class="row"><span>Số lỗ trên thẻ</span><span>${game.holes}/3</span></div><hr>
    <div><b>Ký hợp đồng chính thức 30 ngày?</b></div>
    <div class="sm">Lương gấp đôi.</div>`;
  hud.show('final', true);
  const out = document.getElementById('final-out')!;
  out.textContent = '';
  (document.getElementById('final-yes') as HTMLButtonElement).onclick = () => {
    out.textContent = 'Ca 31 bắt đầu lúc 22:00. Cửa cuốn vẫn đóng. (Hợp đồng chính thức chưa có trong bản thử.)';
  };
  (document.getElementById('final-no') as HTMLButtonElement).onclick = () => {
    out.textContent = 'Cửa cuốn mở. Ngoài trời vẫn còn sương. Ba người đứng ngoài kính nhìn theo bạn.';
  };
}

// ---- Vòng lặp chính ----
const tmpV = new THREE.Vector3();
const p3 = (p: V2, y: number) => ({ x: p.x, y, z: p.z });

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (game && world && auditorView) {
    if (mode === 'play' && controls.isLocked) {
      const m = player.update(dt);
      game.player.pos = { ...player.pos };
      game.reportMotion(dt, m.moving, m.running);
      const f = getFocus();
      updateScan(dt, f);
      hud.hint(hintFor(f));
      canCooldown = Math.max(0, canCooldown - dt);
      game.tick(dt);
      hud.clock(game);
      hud.badge(game.name, game.holes);
      if (sheetOpen && (sheetRefresh -= dt) <= 0) {
        sheetRefresh = 0.4;
        hud.sheet(game, true);
      }
    } else if (mode === 'spectate' || mode === 'dying') {
      game.tick(dt);
    }
    handleEvents();
    auditorView.update(game.auditor, dt, debug);
    if (debug) {
      const a = game.auditor;
      hud.debug(
        `Kiểm kê viên: ${a.state}\nVị trí: ${a.pos.x.toFixed(1)}, ${a.pos.z.toFixed(1)}\n` +
          `Điểm nghi ngờ: ${a.suspicion ? `${a.suspicion.x.toFixed(1)}, ${a.suspicion.z.toFixed(1)}` : '—'}\n` +
          `Đếm: ${Math.round(a.countProgress * 100)}%\nNgười chơi: ${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}\n` +
          `Giọng tiếng Việt: ${audio.hasVietnameseVoice ? 'có' : 'không có (chỉ hiện chữ)'}`,
      );
    }
    camera.getWorldDirection(tmpV);
    audio.listener(camera.position, tmpV);
    hud.tick(dt);
    renderer.render(world.scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
