// Bản thử giai đoạn 1: một người chơi, siêu thị dùng model Blender, Người Kiểm Kê, chỉ tiêu, đóng thùng,
// chế độ xem, bảng sự kiện (phím P) để tự điều khiển sự kiện khi chơi thử.

import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Game, orderText, type Evaluation } from './sim/game.ts';
import { clockOf } from './sim/shift.ts';
import {
  CLOCK_ZONE, COUNTER, PLAYER_SPAWN, PLAYER_SPAWN_YAW, SOLIDS, coldUnitById, inSafeRoom, sectionAt, type ColdUnit, type Section,
} from './sim/layout.ts';
import { ThrowAim } from './client/throwAim.ts';
import { inBox, inflate, type V2 } from './sim/geometry.ts';
import { hasLOS } from './sim/auditor.ts';
import { buildWorld, type World } from './render/world.ts';
import { AuditorView } from './render/auditorView.ts';
import { CaptureView } from './render/captureView.ts';
import { PlayerController } from './client/player.ts';
import { GameAudio } from './client/audio.ts';
import { Hud } from './client/hud.ts';
import { MouseLook } from './client/mouseLook.ts';
import { DevPanel, applyDevSaved, type DevHost } from './client/devPanel.ts';
import { loadModels, type ModelLib } from './render/models.ts';
import {
  QUALITY, ResolutionGovernor, detectQuality, loadQualityChoice, resolveQuality, saveQualityChoice, type QualityChoice,
} from './render/quality.ts';

type Mode = 'menu' | 'play' | 'eval' | 'dying' | 'spectate' | 'final';

// ---- Khởi tạo three.js ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 60);
const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0; // tắt phần xoay mặc định (hay giật); dùng MouseLook
const look = new MouseLook(camera, document.body);
const player = new PlayerController(camera);
const audio = new GameAudio();
const hud = new Hud();

// ---- Mức đồ hoạ (chọn ở menu, áp dụng khi nhận ca) ----
let qualityChoice: QualityChoice = loadQualityChoice();
let quality = resolveQuality(qualityChoice, renderer);
const governor = new ResolutionGovernor(renderer, QUALITY[quality]);
function applyQuality(): void {
  const q = QUALITY[quality];
  governor.setQuality(q);
  renderer.shadowMap.enabled = q.shadows;
  player.setShadows(q.shadows);
  camera.far = q.far + 4;
  camera.updateProjectionMatrix();
}
applyQuality();
{
  const sel = document.getElementById('quality') as HTMLSelectElement;
  const info = document.getElementById('quality-info')!;
  const show = () => {
    info.textContent = qualityChoice === 'auto' ? `máy này: ${QUALITY[detectQuality(renderer)].label}` : '';
  };
  sel.value = qualityChoice;
  show();
  sel.addEventListener('change', () => {
    if (mode !== 'menu') return;
    qualityChoice = sel.value as QualityChoice;
    saveQualityChoice(qualityChoice);
    quality = resolveQuality(qualityChoice, renderer);
    applyQuality();
    show();
  });
}

let mode: Mode = 'menu';
let game: Game | null = null;
let world: World | null = null;
let auditorView: AuditorView | null = null;
let captureView: CaptureView | null = null;
let throwAim: ThrowAim | null = null;
let deathStage: 'lunge' | 'cine' | 'black' | null = null;
let deathT = 0;
/** Góc máy cảnh đóng thùng. */
const cine = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
let debug = false;
let sheetOpen = false;
let sheetRefresh = 0;
let ordersRefresh = 0;
let scanTarget: string | null = null;
let scanT = 0;
let scanBeepT = 0;
let canCooldown = 0;
let specIdx = 0;
let powerTarget = 1;
let flickerT = 0;
let flashTipShown = false;
let dyingName = '';

const SPEC_CAMS: { pos: [number, number, number]; look: [number, number, number]; name: string }[] = [
  { pos: [1.8, 3.1, 8.0], look: [14, 0.6, 20], name: 'CAMERA 1 · GÓC TÂY BẮC' },
  { pos: [15.25, 3.1, 7.8], look: [15.25, 0.6, 24], name: 'CAMERA 2 · LỐI GIỮA HAI KHỐI KỆ' },
  { pos: [43.2, 3.1, 8.2], look: [34, 0.6, 20], name: 'CAMERA 3 · KHU HÀNG LẠNH' },
  { pos: [1.8, 3.1, 33.2], look: [14, 0.6, 22], name: 'CAMERA 4 · MẶT KÍNH TÂY' },
  { pos: [43.2, 3.1, 33.2], look: [30, 0.6, 24], name: 'CAMERA 5 · QUẦY' },
  { pos: [11.5, 3.0, 6.2], look: [5, 0.4, 1.5], name: 'CAMERA 6 · KHO' },
  { pos: [43.5, 3.0, 9.8], look: [12, 0.6, 7.6], name: 'CAMERA 7 · HÀNH LANG CỬA PHÒNG' },
  { pos: [37.0, 2.9, 6.4], look: [41, 1.0, 1.8], name: 'CAMERA 8 · PHÒNG KIỂM KÊ' },
];
/** Camera kho: mở đầu chế độ xem sau khi chết (thấy thùng mang tên mình). */
const KHO_CAM = 5;

// ---- Bảng sự kiện (phím P) ----
const devHost: DevHost = {
  game: () => game,
  world: () => world,
  player,
  timeScale: 1,
  onClose: () => {
    if (mode !== 'play') return;
    hud.show('pause', true); // nếu khoá chuột không được (vd. đóng bằng Esc) thì bấm màn hình để tiếp tục
    look.lock();
  },
};
const dev = new DevPanel(devHost);

// ---- Tải model ----
const startBtn = document.getElementById('start') as HTMLButtonElement;
let models: ModelLib | null = null;
startBtn.disabled = true;
startBtn.textContent = 'Đang tải model…';
loadModels((done, total) => (startBtn.textContent = `Đang tải model ${done}/${total}`)).then((lib) => {
  models = lib;
  const box = lib.static('thung_carton');
  if (box) player.setCarryModel(box);
  startBtn.disabled = false;
  startBtn.textContent = 'Nhận ca';
});

// ---- Bắt đầu ----
const nameInput = document.getElementById('name') as HTMLInputElement;
startBtn.addEventListener('click', () => {
  if (!models) return;
  const name = (nameInput.value.trim() || 'Minh').slice(0, 14);
  game = new Game(name, { events: dev.saved.events, tuning: dev.saved.tuning });
  world = buildWorld(name, models, QUALITY[quality]);
  world.scene.add(camera);
  auditorView = new AuditorView(world.scene, models, QUALITY[quality].shadows);
  throwAim = new ThrowAim(world.scene, camera);
  captureView = new CaptureView(world.scene, models);
  captureView.onLand = () => {
    const at = game?.auditor.capture?.at;
    if (at) audio.clank(p3(at, 0.3));
  };
  captureView.onCrush = () => {
    const at = game?.auditor.capture?.at;
    if (at) audio.tone(55, 0.35, 0.3, p3(at, 0.3), 'square');
  };
  applyDevSaved(dev.saved, player, world);
  dev.clearLog();
  world.resetNight(game.shift, game.night);
  player.teleport(PLAYER_SPAWN, PLAYER_SPAWN_YAW);
  player.setCarrying(false);
  player.onNoise = (at, r, e) => game?.noise(at, r, e);
  audio.start();
  hud.show('menu', false);
  hud.show('hud', true);
  hud.badge(name, 0);
  mode = 'play';
  look.lock();
});

document.getElementById('pause')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.sens')) return;
  if (mode === 'play') look.lock();
});
controls.addEventListener('lock', () => hud.show('pause', false));
controls.addEventListener('unlock', () => {
  throwAim?.cancel();
  if (mode === 'play' && !dev.isOpen) hud.show('pause', true);
});

// ---- Độ nhạy chuột (ở màn tạm dừng) ----
const sensInput = document.getElementById('sens') as HTMLInputElement;
const sensOut = document.getElementById('sens-val')!;
sensInput.value = String(look.sensitivity);
sensOut.textContent = look.sensitivity.toFixed(2);
sensInput.addEventListener('input', () => {
  look.setSensitivity(Number(sensInput.value));
  sensOut.textContent = look.sensitivity.toFixed(2);
});

// ---- Phím ----
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && mode === 'play' && game && !e.repeat) {
    e.preventDefault();
    if (dev.isOpen) {
      dev.close();
    } else {
      hud.show('pause', false);
      dev.open();
      controls.unlock();
    }
    return;
  }
  if (e.code === 'Escape' && dev.isOpen) {
    dev.close();
    return;
  }
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
      // SPEC_CAMS.length camera cố định + 1 camera tự động theo Người Kiểm Kê
      const n = SPEC_CAMS.length + 1;
      specIdx = (specIdx + (e.code === 'ArrowRight' ? 1 : n - 1)) % n;
      setSpectateCam();
    }
    if (e.code === 'KeyR') location.reload();
    return;
  }
  if (mode !== 'play' || !controls.isLocked || !game || !world || e.repeat) return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyQ') startAim();
  if (e.code === 'KeyT') toggleFlash();
  if (e.code === 'KeyG') dropBox();
  if (e.code === 'F6' && debug) {
    e.preventDefault();
    game.forceBlackout();
  }
});

// ---- Ném lon: giữ Q để ngắm (tay, đường bay, chỗ rơi), thả Q để ném, chuột phải để huỷ ----
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyQ') releaseAim();
});
window.addEventListener('mousedown', (e) => {
  if (e.button === 2 && throwAim?.aiming) throwAim.cancel();
});
window.addEventListener('contextmenu', (e) => {
  if (mode === 'play') e.preventDefault();
});

function startAim(): void {
  if (!game || !throwAim) return;
  throwAim.start(canCooldown <= 0);
  if (canCooldown > 0) hud.toast(`Đang lấy lon mới · còn ${Math.ceil(canCooldown)} giây`, false);
}

function releaseAim(): void {
  if (!game || !world || !throwAim?.aiming) return;
  const r = throwAim.release(() => {
    if (!game || !world || mode !== 'play' || !r) return;
    const id = game.dropLitter(r.land);
    world.addCan(r.land.x, r.land.z, id);
    audio.clank(p3(r.land, 0.1));
  });
  if (!r) return;
  canCooldown = 6;
  audio.click(p3(player.pos, 1.4), 0.25, 700); // tiếng vung tay
  hud.toast('Đã ném một lon nước. Nhớ nhặt lại: 06:00 mỗi lon còn trên sàn bị trừ 1 công.', true);
}

function toggleFlash(): void {
  if (!game) return;
  player.setFlashlight(!player.flashOn);
  game.player.light = player.flashOn;
  audio.click(p3(player.pos, 1.3), 0.25, 3200);
}

function dropBox(): void {
  if (!game || !world || !player.carrying) return;
  const cold = player.carryKind === 'cold';
  player.setCarrying(false);
  game.dropBox();
  world.setPileCount(game.shift.pile);
  world.setColdPileCount(game.shift.coldPile);
  game.noise({ ...player.pos }, 8, 1.5);
  audio.click(p3(player.pos, 0.2), 0.9, 900);
  audio.clank(p3(player.pos, 0.2));
  hud.toast(cold ? 'Thả rơi thùng hàng lạnh (rất ồn). Hàng bị trả về kho lạnh.' : 'Thả rơi thùng hàng (rất ồn). Hàng bị trả về kho.', false);
}

// ---- Tương tác ----
const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
type Focus =
  | { kind: 'shelf'; section: Section }
  | { kind: 'pile' }
  | { kind: 'freezer' }
  | { kind: 'counter' }
  | { kind: 'can'; id: number }
  | { kind: 'cold'; unit: ColdUnit }
  | { kind: 'coldPile' }
  | null;

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
  if (kind === 'counter') return { kind: 'counter' };
  if (kind === 'can') return { kind: 'can', id: hit.object.userData.id as number };
  if (kind === 'cold') return { kind: 'cold', unit: coldUnitById(hit.object.userData.id as string)! };
  if (kind === 'coldPile') return { kind: 'coldPile' };
  return null;
}

function interact(): void {
  if (!game || !world) return;
  const f = getFocus();
  // Nhặt lon nước đã ném (ôm thùng vẫn nhặt được)
  if (f?.kind === 'can') {
    const r = game.pickUpLitter(f.id);
    world.removeCan(f.id);
    if (r.ok) {
      audio.click(p3(player.pos, 0.3), 0.3, 1800);
      hud.toast(r.msg, true);
    }
    return;
  }
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
    if (f?.kind === 'counter') {
      const r = game.deliver();
      if (r.ok) {
        player.setCarrying(false);
        audio.click(p3(player.pos, 1), 0.6, 1200);
        audio.tone(1500, 0.08, 0.08);
        hud.toast(`+${r.cong} công · ${r.msg}`, true);
      } else hud.toast(r.msg, false);
    }
    if (f?.kind === 'cold') {
      const r = game.restockCold(f.unit.id);
      if (r.ok) {
        world.setColdNeeded(f.unit.id, false);
        player.setCarrying(false);
        game.noise({ ...player.pos }, 5, 1.5);
        audio.click(p3(player.pos, 1), 0.6, 1000);
        hud.toast(`+${r.cong} công · ${r.msg}`, true);
      } else hud.toast(r.msg, false);
    }
    return;
  }
  if (f?.kind === 'pile') {
    if (game.takeBox()) {
      world.setPileCount(game.shift.pile);
      player.setCarrying('dry');
      game.noise({ ...player.pos }, 3, 1);
      hud.toast('Đã lấy một thùng hàng khô. Tìm kệ có thẻ THIẾU HÀNG, hoặc mang ra QUẦY nếu có đơn gấp.', true);
    }
    return;
  }
  if (f?.kind === 'coldPile') {
    if (game.takeColdBox()) {
      world.setColdPileCount(game.shift.coldPile);
      player.setCarrying('cold');
      game.noise({ ...player.pos }, 3, 1);
      hud.toast('Đã lấy một thùng hàng lạnh. Tìm tủ lạnh có thẻ HẾT HÀNG.', true);
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

function updateScan(dt: number, f: Focus): void {
  if (!game) return;
  const needsStock = f?.kind === 'shelf' && game.shift.restockNeeded.has(f.section.id);
  const holding = player.keys.has('KeyF') && !player.carrying && f?.kind === 'shelf' && !needsStock;
  if (!holding || f?.kind !== 'shelf') {
    scanT = 0;
    scanTarget = null;
    hud.scanner(f?.kind === 'shelf' && !player.carrying && !needsStock ? f.section.name : null, 0, f?.kind === 'shelf' && game.shift.scanned.has(f.section.id));
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
  if (f?.kind === 'can') return '[E] Nhặt lại lon nước';
  const coldNeeded = f?.kind === 'cold' && game.shift.coldNeeded.has(f.unit.id);
  if (player.carryKind === 'cold') {
    if (f?.kind === 'cold') return coldNeeded ? `[E] Xếp hàng lạnh vào ${f.unit.name}` : `${f.unit.name} không hết hàng`;
    if (f?.kind === 'shelf' || f?.kind === 'counter') return 'Thùng hàng LẠNH chỉ xếp vào tủ lạnh đang HẾT HÀNG';
    return 'Đang ôm thùng hàng lạnh · tìm tủ lạnh có thẻ HẾT HÀNG';
  }
  if (player.carrying) {
    if (f?.kind === 'shelf')
      return game.shift.restockNeeded.has(f.section.id) ? `[E] Xếp hàng vào ${f.section.name}` : 'Kệ này không thiếu hàng';
    if (f?.kind === 'counter') return game.deliveryOpen ? '[E] Giao đơn gấp ở quầy' : 'Không có đơn gấp nào cần giao';
    if (f?.kind === 'cold') return 'Thùng hàng khô không bỏ vào tủ lạnh · lấy thùng hàng lạnh ở KHO LẠNH';
    return game.deliveryOpen ? 'Đang ôm thùng · mang ra QUẦY (đơn gấp) hoặc xếp vào kệ THIẾU HÀNG' : 'Đang ôm thùng · tìm kệ có thẻ THIẾU HÀNG';
  }
  if (f?.kind === 'pile') return `[E] Lấy thùng hàng khô (còn ${game.shift.pile})`;
  if (f?.kind === 'coldPile') return `[E] Lấy thùng hàng lạnh (còn ${game.shift.coldPile})`;
  if (f?.kind === 'cold') return coldNeeded ? `${f.unit.name} HẾT HÀNG · lấy thùng hàng lạnh ở KHO LẠNH` : '';
  if (f?.kind === 'freezer')
    return game.shift.freezerWindow() !== null ? '[E] Ghi nhiệt độ tủ đông' : 'Chưa đến giờ ghi nhiệt độ';
  if (f?.kind === 'shelf') {
    if (game.shift.restockNeeded.has(f.section.id)) return 'Kệ đang THIẾU HÀNG · lấy thùng ở kho xếp vào trước rồi mới quét';
    if (game.shift.recount.has(f.section.id)) return '[Giữ F] Kiểm lại kệ (phiếu việc)';
    return game.shift.scanned.has(f.section.id) ? '' : '[Giữ F] Quét kệ';
  }
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
        dev.log(`Loa: ${e.text}`);
        break;
      case 'power':
        dev.log(e.on ? 'Có điện lại' : 'MẤT ĐIỆN');
        powerTarget = e.on ? 1 : 0;
        flickerT = e.on ? 0.8 : 1.4;
        if (!e.on) {
          audio.tone(55, 1.8, 0.3);
          audio.click(p3(player.pos, 3), 0.8, 400);
          if (!flashTipShown) {
            flashTipShown = true;
            hud.toast('MẤT ĐIỆN · [T] bật/tắt đèn pin. Ánh đèn rọi tới có thể khiến kiểm kê viên chạy tới.', false);
          }
        } else {
          audio.tone(120, 0.5, 0.12);
        }
        break;
      case 'light':
      case 'heard':
        dev.log(e.type === 'light' ? 'Người Kiểm Kê thấy ánh đèn pin' : `Người Kiểm Kê nghe thấy tiếng động (${e.at.x.toFixed(1)}, ${e.at.z.toFixed(1)})`);
        audio.tone(1760, 0.05, 0.1, p3(game.auditor.pos, 1.3), 'square');
        setTimeout(() => game && audio.tone(1760, 0.05, 0.1, p3(game.auditor.pos, 1.3), 'square'), 120);
        break;
      case 'count':
        if (e.n === 1) dev.log('Bị tia quét chạm: bắt đầu đếm');
        hud.count(e.n);
        audio.tone(e.n === 1 ? 990 : 1180, 0.16, 0.2, p3(game.auditor.pos, 1.3));
        audio.speak(e.n === 1 ? 'Một' : 'Hai', 1.0);
        break;
      case 'lost':
        dev.log('Thoát khỏi tia quét');
        hud.count(0);
        break;
      case 'step':
        audio.click(p3(e.at, 0.05), 0.35);
        break;
      case 'beep':
        audio.tone(2100, 0.04, 0.05, p3(e.at, 1.3), 'square');
        break;
      case 'eval':
        dev.log(`Hết ca · ${e.ev.cong}/${e.ev.quota} công · +${e.ev.holesAdded} lỗ`);
        dev.close(true);
        onEval(e.ev);
        break;
      case 'dead':
        dev.log(e.reason === 'scan' ? 'Bị đếm đủ: Người Kiểm Kê lao tới' : 'Thẻ đủ 3 lỗ: chấm dứt hợp đồng');
        dev.close(true);
        startDeath(e.reason, e.slot);
        break;
      case 'boxing':
        dev.log('Bị nhét vào thùng');
        audio.tone(70, 0.5, 0.25, p3(e.at, 0.5));
        startBoxingShot(e.at);
        break;
      case 'boxed':
        dev.log('Đóng thùng xong, Người Kiểm Kê bê về kho');
        endBoxingShot();
        break;
      case 'stored':
        dev.log(`Thùng ${e.name.toUpperCase()} đã lưu kho · Người Kiểm Kê đi tuần tiếp`);
        world?.addStoredBox(e.name, e.slot);
        audio.clank(p3(e.slot, 0.2));
        break;
      case 'clockIn':
        dev.log(e.late ? 'Chấm công vào ca TRỄ' : 'Đã chấm công vào ca');
        audio.click(p3(player.pos, 1.2), 0.7, 900);
        setTimeout(() => audio.tone(e.late ? 330 : 1320, 0.12, 0.08), 120);
        hud.toast(
          e.late
            ? `Chấm công vào ca TRỄ (${game.shift.clock()}) · 06:00 bị trừ 2 công`
            : `Đã chấm công vào ca lúc ${game.shift.clock()} · bắt đầu làm việc`,
          !e.late,
        );
        break;
      case 'night':
        dev.log(`Bắt đầu lại đêm ${game.night}`);
        resetNightView();
        break;
      case 'dev':
        dev.log(e.text);
        hud.toast(e.text, true);
        break;
      case 'order': {
        const o = e.order;
        dev.log(`Phiếu việc mới: ${orderText(o)} · hạn ${clockOf(o.due)}`);
        if (o.kind === 'restock' && o.section) world?.setNeeded(o.section);
        if (o.kind === 'rescan' && o.section) world?.setRecount(o.section, true);
        if (o.kind === 'coldRestock' && o.section) world?.setColdNeeded(o.section, true);
        world?.setPileCount(game.shift.pile);
        world?.setColdPileCount(game.shift.coldPile);
        // Máy in ở quầy rè rè in phiếu
        for (let i = 0; i < 5; i++) setTimeout(() => audio.click(p3({ x: COUNTER.maxX - 0.8, z: COUNTER.minZ + 0.3 }, 1.1), 0.35, 2600), i * 70);
        hud.orders(game);
        break;
      }
      case 'orderLate':
        dev.log(`QUÁ HẠN: ${orderText(e.order)}`);
        hud.toast(`QUÁ HẠN: ${orderText(e.order)} · đã ghi hồ sơ`, false);
        audio.tone(330, 0.5, 0.15, undefined, 'sawtooth');
        hud.orders(game);
        break;
      case 'orderDone':
        dev.log(`Xong phiếu: ${orderText(e.order)}${e.order.late ? ' (trễ)' : ''}`);
        if (e.order.kind === 'rescan' && e.order.section) world?.setRecount(e.order.section, false);
        hud.orders(game);
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
    resetNightView();
    mode = 'play';
    look.lock();
  });
}

/** Dọn cảnh cho đêm mới: kệ, đèn, vị trí người chơi. */
function resetNightView(): void {
  if (!game || !world) return;
  powerTarget = 1;
  flickerT = 0;
  world.resetNight(game.shift, game.night);
  player.teleport(PLAYER_SPAWN, PLAYER_SPAWN_YAW);
  throwAim?.cancel();
  player.setCarrying(false);
  player.setFlashlight(false);
  game.player.light = false;
  hud.count(0);
  hud.orders(game);
}

// ---- Chết ----
// Bị đếm đủ (scan): lunge (góc nhìn thứ nhất, quay đầu nhìn nó lao tới) → cine (góc máy thứ ba: bị nhét vào thùng)
// → black (màn đen "Hồ sơ đã được lưu kho") → chế độ xem, camera tự theo Người Kiểm Kê bê thùng về kho.
// Thẻ đủ 3 lỗ (holes): màn đỏ → màn đen → chế độ xem như cũ.

function startDeath(reason: 'scan' | 'holes', slot: V2): void {
  if (!game || !world) return;
  mode = 'dying';
  dyingName = game.name;
  hud.count(0);
  hud.scanner(null);
  hud.hint('');
  hud.sheet(game, false);
  sheetOpen = false;
  player.setCarrying(false);
  player.setFlashlight(false);
  game.player.light = false;
  controls.unlock();
  hud.show('pause', false);
  audio.cancelSpeech();
  audio.tone(880, 1.3, 0.16);
  if (reason === 'scan') {
    deathStage = 'lunge';
    deathT = 0;
    captureView?.begin(dyingName);
    hud.death('red', dyingName, reason);
    return;
  }
  hud.death('red', dyingName, reason);
  audio.speak(`Nhân viên ${dyingName}: chấm dứt hợp đồng. Xin cảm ơn.`);
  setTimeout(() => hud.death('black', dyingName, reason), 1700);
  setTimeout(() => {
    world?.addStoredBox(dyingName, slot);
    enterSpectate(KHO_CAM); // camera kho: thấy thùng mang tên mình
  }, 5200);
}

/** Người Kiểm Kê tới nơi: chuyển sang góc máy thứ ba nhìn cảnh nhét vào thùng. */
function startBoxingShot(at: V2): void {
  if (!game || deathStage !== 'lunge') return;
  deathStage = 'cine';
  deathT = 0;
  hud.show('hud', false);
  hud.death('cine', dyingName, 'scan');
  audio.speak(`Nhân viên ${dyingName}: đã kiểm đếm. Xin cảm ơn.`);
  const a = game.auditor.pos;
  let dx = at.x - a.x;
  let dz = at.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const px = -dz;
  const pz = dx;
  // Thử vài góc máy quanh chỗ bị bắt; chọn góc không kẹt trong kệ / tường và nhìn thấy cả hai
  const tries: [number, number][] = [[2.3, 0.9], [-2.3, 0.9], [0, 2.6], [2.2, -0.7], [-2.2, -0.7], [1.4, 1.4], [-1.4, 1.4]];
  let pos: V2 = { x: at.x + dx * 1.5, z: at.z + dz * 1.5 };
  for (const [side, back] of tries) {
    const c = { x: at.x + px * side + dx * back, z: at.z + pz * side + dz * back };
    const blocked = SOLIDS.some((b) => inBox(c, inflate(b, 0.3)));
    if (!blocked && hasLOS(c, at) && hasLOS(c, a)) {
      pos = c;
      break;
    }
  }
  cine.pos.set(pos.x, 1.5, pos.z);
  cine.look.set((at.x * 2 + a.x) / 3, 0.85, (at.z * 2 + a.z) / 3);
  camera.position.copy(cine.pos);
  camera.lookAt(cine.look);
}

/** Đóng thùng xong: màn đen, rồi vào chế độ xem. */
function endBoxingShot(): void {
  if (deathStage !== 'cine') return;
  deathStage = 'black';
  hud.death('black', dyingName, 'scan');
  setTimeout(() => enterSpectate(AUTO_CAM), 2600);
}

function enterSpectate(idx: number): void {
  deathStage = null;
  hud.death('off');
  hud.show('hud', false);
  mode = 'spectate';
  specIdx = idx;
  autoPick = -1;
  setSpectateCam();
}

/** Camera tự động: chọn camera nhìn thấy Người Kiểm Kê (gần nhất) và quay theo nó. */
const AUTO_CAM = SPEC_CAMS.length;
let autoPick = -1;
function updateAutoCam(dt: number): void {
  if (!game || specIdx !== AUTO_CAM) return;
  const a = game.auditor.pos;
  const sees = (i: number) => hasLOS({ x: SPEC_CAMS[i].pos[0], z: SPEC_CAMS[i].pos[2] }, a);
  if (autoPick < 0 || !sees(autoPick)) {
    let best = -1;
    let bd = Infinity;
    SPEC_CAMS.forEach((c, i) => {
      const d = Math.hypot(c.pos[0] - a.x, c.pos[2] - a.z) + (sees(i) ? 0 : 1000);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best !== autoPick) {
      autoPick = best;
      camera.position.set(...SPEC_CAMS[best].pos);
      camera.lookAt(a.x, 1.0, a.z);
      hud.spectate(`TỰ ĐỘNG · ${SPEC_CAMS[best].name} · theo kiểm kê viên`);
    }
  }
  lookToward(a.x, 1.0, a.z, dt * 3);
}

/** Xoay camera mượt về phía một điểm. */
const lookM = new THREE.Matrix4();
const lookQ = new THREE.Quaternion();
const lookT = new THREE.Vector3();
function lookToward(x: number, y: number, z: number, k: number): void {
  lookM.lookAt(camera.position, lookT.set(x, y, z), camera.up);
  lookQ.setFromRotationMatrix(lookM);
  camera.quaternion.slerp(lookQ, Math.min(1, k));
}

/** Chạy mỗi khung hình khi đang chết. */
function updateDeath(dt: number): void {
  if (!game) return;
  deathT += dt;
  const a = game.auditor;
  if (deathStage === 'lunge') {
    // Đứng chết trân, quay đầu nhìn nó lao tới
    lookToward(a.pos.x, 1.75, a.pos.z, dt * 7);
    if (deathT > 8) startBoxingShot(a.capture?.at ?? a.pos); // phòng khi không tới được
  } else if (deathStage === 'cine') {
    // Máy quay đẩy vào chậm
    camera.position.lerp(cine.look, dt * 0.06);
    lookToward(cine.look.x, cine.look.y, cine.look.z, dt * 4);
  }
}

function setSpectateCam(): void {
  if (specIdx === AUTO_CAM) {
    autoPick = -1;
    hud.spectate('TỰ ĐỘNG · theo kiểm kê viên');
    updateAutoCam(1);
    return;
  }
  const c = SPEC_CAMS[specIdx];
  camera.position.set(...c.pos);
  camera.lookAt(...c.look);
  hud.spectate(`${c.name} · ${specIdx + 1}/${SPEC_CAMS.length + 1}`);
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
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;
  if (mode !== 'menu') governor.frame(rawDt);

  if (game && world && auditorView) {
    // Thời gian của thế giới (Người Kiểm Kê, đồng hồ ca) có thể tua nhanh trong bảng sự kiện
    const wdt = dt * devHost.timeScale;
    if (mode === 'play' && controls.isLocked) {
      const m = player.update(dt);
      game.player.pos = { ...player.pos };
      game.reportMotion(dt, m.moving, m.running);
      const f = getFocus();
      updateScan(dt, f);
      let hint = throwAim?.aiming ? 'Thả [Q] để ném lon tới vòng vàng · chuột phải: huỷ' : hintFor(f);
      if (!hint && !game.player.clockedIn) {
        hint = `Chấm công vào ca: tới MÁY CHẤM CÔNG trong KHO trước ${clockOf(game.eventCfg.clockInBy)}`;
      }
      if (!hint && inBox(player.pos, CLOCK_ZONE)) hint = game.shift.minutes >= 420 ? 'MÁY CHẤM CÔNG · đứng đây tới 06:00 để điểm danh' : 'MÁY CHẤM CÔNG · 06:00 phải có mặt ở đây';
      if (!hint && inSafeRoom(player.pos)) hint = 'KHU LẤY HÀNG · kiểm kê viên không kiểm đếm ở đây';
      if (!hint && !game.power) hint = `[T] ${player.flashOn ? 'Tắt' : 'Bật'} đèn pin`;
      if (player.carrying) hint += ' · [G] thả thùng để chạy';
      hud.hint(hint);
      canCooldown = Math.max(0, canCooldown - dt);
      game.tick(wdt);
      hud.clock(game);
      hud.badge(game.name, game.holes);
      if (sheetOpen && (sheetRefresh -= dt) <= 0) {
        sheetRefresh = 0.4;
        hud.sheet(game, true);
      }
    } else if (mode === 'play' && dev.isOpen && !dev.pauses) {
      // Bảng sự kiện mở nhưng không tạm dừng: thế giới vẫn chạy, người chơi đứng yên
      game.tick(wdt);
      hud.clock(game);
      hud.badge(game.name, game.holes);
    } else if (mode === 'spectate' || mode === 'dying') {
      game.tick(wdt);
      if (mode === 'dying') updateDeath(dt);
      else updateAutoCam(dt);
    }
    handleEvents();
    world.setDrift(game.shift.drift);
    if (mode === 'play' && (ordersRefresh -= dt) <= 0) {
      ordersRefresh = 0.25;
      hud.orders(game);
    }
    if (flickerT > 0) {
      flickerT -= dt;
      const lvl = Math.random() < 0.55 ? powerTarget : 1 - powerTarget;
      world.setPower(flickerT > 0 ? lvl * (0.35 + 0.65 * Math.random()) : powerTarget);
    } else {
      world.setPower(powerTarget);
    }
    const frozen = mode === 'play' && !controls.isLocked && (!dev.isOpen || dev.pauses);
    auditorView.update(game.auditor, frozen ? 0 : wdt, debug, game.power);
    captureView?.update(game.auditor, frozen ? 0 : wdt);
    throwAim?.update(frozen ? 0 : dt);
    world.update(dt);
    if (debug) {
      const a = game.auditor;
      hud.debug(
        `Kiểm kê viên: ${a.state}${a.running ? ' (CHẠY)' : ''} · Điện: ${game.power ? 'có' : 'MẤT'} · Đèn pin: ${player.flashOn ? 'bật' : 'tắt'}\n` +
          `[F6] bật/tắt mất điện để thử\nVị trí: ${a.pos.x.toFixed(1)}, ${a.pos.z.toFixed(1)}\n` +
          `Điểm nghi ngờ: ${a.suspicion ? `${a.suspicion.x.toFixed(1)}, ${a.suspicion.z.toFixed(1)}` : '—'}\n` +
          `Đếm: ${Math.round(a.countProgress * 100)}%\nNgười chơi: ${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}\n` +
          `Giọng tiếng Việt: ${audio.hasVietnameseVoice ? 'có' : 'không có (chỉ hiện chữ)'}\n` +
          `Đồ hoạ: ${QUALITY[quality].label} · ${Math.round(governor.fps)} khung/giây · độ phân giải ${Math.round(governor.ratio * 100)}%`,
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

// Chỉ khi chạy npm run dev: cho script kiểm tra tự động (chụp màn hình…) truy cập trạng thái game.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__hd30 = {
    camera, player, dev, devHost, get game() { return game; }, get auditorView() { return auditorView; }, get captureView() { return captureView; }, get throwAim() { return throwAim; },
    renderInfo: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: governor.ratio, programs: renderer.info.programs?.length }),
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
