// Bản thử giai đoạn 1: siêu thị dùng model Blender, Người Kiểm Kê, việc được giao, đóng thùng,
// chế độ xem, bảng sự kiện (phím P) để tự điều khiển sự kiện khi chơi thử.
// Chơi mạng bản thử (2 người): xem src/client/net.ts.

import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { BULKY_MOVE, Game, orderText, playerSpawn, type EventConfig, type Evaluation } from './sim/game.ts';
import { GuestSync, HostSync, NetClient, type Lobby, type StartInfo } from './client/net.ts';
import { RemotePlayerView } from './render/remotePlayer.ts';
import { labelPlane } from './render/labels.ts';
import { clockOf } from './sim/shift.ts';
import {
  CLOCK_ZONE, COUNTER, PLAYER_SPAWN_YAW, SOLIDS, coldUnitById, inSafeRoom, sectionAt, type ColdUnit, type Section,
} from './sim/layout.ts';
import { ThrowAim } from './client/throwAim.ts';
import { HeldItem } from './client/heldItem.ts';
import { CoWorker } from './client/coworker.ts';
import { MenuUI } from './client/menu.ts';
import type { Settings } from './client/settings.ts';
import { BULKY_SIZE, CART_SIZE, POWER_ZONE, PROMO_ZONE, TRASH_BINS } from './sim/layout.ts';
import { CART_MOVE } from './sim/game.ts';
import type { AABB } from './sim/geometry.ts';
import { DEFECT_TEXT, hashStr, slotAt, slotByKey, type ShelfSlot } from './sim/shelfGoods.ts';
import { formatPrice, productById } from './sim/products.ts';
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
import { loadModels, MODEL_NAMES, type ModelLib } from './render/models.ts';
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
    qualityChoice = sel.value as QualityChoice;
    saveQualityChoice(qualityChoice);
    show();
    if (mode !== 'menu') return; // đang trong ca: áp dụng từ lần nhận ca sau
    quality = resolveQuality(qualityChoice, renderer);
    applyQuality();
  });
}

let mode: Mode = 'menu';
let game: Game | null = null;
let world: World | null = null;
let auditorView: AuditorView | null = null;
let captureView: CaptureView | null = null;
let throwAim: ThrowAim | null = null;
let heldItem: HeldItem | null = null;
let coworker: CoWorker | null = null;
/** Nhún nhẹ của bìa kẹp phiếu việc khi đi. */
let sheetBob = 0;
/** Đang mở tủ điện (minigame sửa điện). */
let powerOpen = false;
/** Túi rác xách tay (hình trên tay, góc nhìn thứ nhất). */
const handBags = new THREE.Group();
camera.add(handBags);
let fpsT = 0;
/** Đang giữ R để ăn / uống: thời gian đã giữ (giây). */
let eatT = 0;
let eatWarned = false;
const EAT_TIME = 1.4;
let deathStage: 'lunge' | 'cine' | 'black' | null = null;
// ---- Chơi mạng ----
let net: NetClient | null = null;
/** Mình là chủ phòng: chạy ca, gửi trạng thái. */
let hostSync: HostSync | null = null;
/** Mình vào phòng người khác: game là bản sao. */
let guestSync: GuestSync | null = null;
/** Người chơi khác (theo chỉ số trong game.players; chỗ của mình là null). */
let remotes: ({ view: RemotePlayerView; tag: THREE.Mesh } | null)[] = [];
/** Đi / chạy / rón rén của mình ở khung hình này (gửi cho chủ phòng). */
let motion = { moving: false, running: false, sneak: false };
/** Đang cầm đầu sau kiện hàng (người kia dẫn): vị trí khung hình trước. */
let followPrev: V2 | null = null;
let heldKey: string | null = null;
const netMode = () => !!(hostSync || guestSync);
/** Mình là người thứ mấy trong game.players. */
const myIndex = () => (game ? Math.max(0, game.players.indexOf(game.player)) : 0);
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
    hud.show('pause', true); // nếu khoá chuột không được (vd. đóng bằng Esc) thì bấm "Tiếp tục"
    look.lock();
  },
};
const dev = new DevPanel(devHost);

// ---- Menu chính, cài đặt, hướng dẫn ----
let subtitles = true;
const menu = new MenuUI({
  look,
  apply(st: Settings) {
    audio.setVolumes(st);
    camera.fov = st.fov;
    camera.updateProjectionMatrix();
    renderer.toneMappingExposure = st.brightness;
    subtitles = st.subtitles;
    hud.show('fps', st.showFps);
  },
  inGame: () => mode !== 'menu',
  testSound() {
    audio.start();
    audio.tone(1320, 0.08, 0.08);
    setTimeout(() => audio.tone(990, 0.16, 0.2), 200);
    setTimeout(() => audio.speak('Kiểm tra âm thanh. Một. Hai.'), 500);
  },
  onOverlay() {
    /* tạm dừng vẫn giữ nguyên */
  },
  resume() {
    if (mode === 'play') look.lock();
  },
  quitToMenu() {
    location.reload();
  },
});
// Nhạc nền ở menu: trình duyệt chỉ cho phát tiếng sau lần bấm đầu tiên
window.addEventListener('pointerdown', () => {
  if (mode !== 'menu' || audio.ready) return;
  audio.start();
  audio.music('menu');
}, { once: false });

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
  if (lobbyState) showLobby(lobbyState);
  startAsGuest();
  document.getElementById('play-info')!.textContent = `Đồ hoạ: ${QUALITY[quality].label} (đổi trong Cài đặt) · thử việc 5 đêm, mỗi đêm khoảng 6,5 phút.`;
});

// ---- Bắt đầu ----
const nameInput = document.getElementById('name') as HTMLInputElement;
const myName = () => (nameInput.value.trim() || 'Minh').slice(0, 14);
startBtn.addEventListener('click', () => beginShift(myName()));

/** Nhận ca. Chơi mạng: names = tên mọi người trong phòng, me = mình là người thứ mấy, seed / events do chủ phòng quyết. */
function beginShift(name: string, o: { seed?: number; names?: string[]; me?: number; events?: Partial<EventConfig> } = {}): void {
  if (!models) return;
  const me = o.me ?? 0;
  game = new Game(name, { seed: o.seed, events: o.events ?? dev.saved.events, tuning: dev.saved.tuning, players: o.names });
  if (guestSync) guestSync.wrap(game);
  // Mức Thấp: hàng hoá là khối hộp, dán ảnh chụp mặt trước của từng món để vẫn thấy nhãn và hình
  if (QUALITY[quality].proxyGoods) models.bakeImpostors(renderer, MODEL_NAMES.filter((n) => n.startsWith('hh_')));
  world = buildWorld(name, models, QUALITY[quality]);
  world.scene.add(camera);
  auditorView = new AuditorView(world.scene, models, QUALITY[quality].shadows);
  throwAim = new ThrowAim(world.scene, camera);
  heldItem = new HeldItem(camera, models);
  coworker = new CoWorker(world.scene, models);
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
  player.teleport(playerSpawn(me), PLAYER_SPAWN_YAW);
  player.setCarrying(false);
  player.onNoise = (at, r, e) => game?.noise(at, r, e);
  remotes = game.players.map((p, i) => (i === me ? null : makeRemote(p.name, playerSpawn(i))));
  audio.start();
  audio.music('game');
  hud.show('menu', false);
  hud.show('hud', true);
  hud.badge(name, 0, 0);
  world.syncTrash(game.shift.trashFull);
  world.syncCarts(game.shift.carts, null);
  buildHandBags();
  syncReset();
  mode = 'play';
  if (guestSync) {
    // Bắt đầu do chủ phòng bấm: trình duyệt chỉ cho khoá chuột khi chính mình bấm
    hud.show('pause', true);
    hud.toast('Chủ phòng đã bắt đầu ca · bấm "Tiếp tục" để vào', true);
  } else look.lock();
}

/** Người chơi khác: model nhân viên + bảng tên luôn quay về phía mình. */
function makeRemote(name: string, at: V2): { view: RemotePlayerView; tag: THREE.Mesh } {
  const view = new RemotePlayerView(world!.scene, models);
  view.place(at, PLAYER_SPAWN_YAW);
  view.visible = true;
  const tag = labelPlane([name.toUpperCase()], 0.9, 0.2, { bg: '#1e2422', fg: '#f2c94c' });
  world!.scene.add(tag);
  return { view, tag };
}

controls.addEventListener('lock', () => hud.show('pause', false));
controls.addEventListener('unlock', () => {
  throwAim?.cancel();
  if (mode === 'play' && !dev.isOpen && !powerOpen) hud.show('pause', true);
});

// ---- Phím ----
window.addEventListener('keydown', (e) => {
  // Đang mở Cài đặt / Hướng dẫn: phím chỉ dành cho bảng đó
  if (menu.overlayOpen) return;
  if (e.code === 'KeyP' && mode === 'play' && game && !e.repeat && !guestSync) {
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
  if (e.code === 'Escape' && powerOpen) {
    closePower();
    return;
  }
  if (e.code === 'Tab' && mode === 'play') {
    e.preventDefault();
    if (game) {
      sheetOpen = !sheetOpen;
      hud.sheet(game, sheetOpen, player.pos, game.player.yaw);
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
  if (e.code === 'F6' && debug && !guestSync) {
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
  if (game.player.bulky !== null) {
    hud.toast('Đang khiêng kiện hàng: hai tay bận, không ném lon được.', false);
    return;
  }
  throwAim.start(canCooldown <= 0);
  if (canCooldown > 0) hud.toast(`Đang lấy lon mới · còn ${Math.ceil(canCooldown)} giây`, false);
}

function releaseAim(): void {
  if (!game || !world || !throwAim?.aiming) return;
  const r = throwAim.release(() => {
    if (!game || !world || mode !== 'play' || !r) return;
    game.dropLitter(r.land);
    syncWorld();
    audio.clank(p3(r.land, 0.1));
  });
  if (!r) return;
  canCooldown = 6;
  audio.click(p3(player.pos, 1.4), 0.25, 700); // tiếng vung tay
  hud.toast('Đã ném một lon nước. Nhớ nhặt lại: 06:00 mỗi lon còn trên sàn bị trừ 20.000đ lương.', true);
}

function toggleFlash(): void {
  if (!game) return;
  player.setFlashlight(!player.flashOn);
  game.player.light = player.flashOn;
  audio.click(p3(player.pos, 1.3), 0.25, 3200);
}

function dropBox(): void {
  if (!game || !world) return;
  if (game.player.cart !== null) {
    game.releaseCart();
    audio.click(p3(player.pos, 0.4), 0.4, 700);
    hud.toast('Đã buông xe đẩy.', true);
    return;
  }
  if (game.player.bags > 0) {
    hud.toast('Đang xách túi rác: mang về THÙNG RÁC LỚN trong kho để đổ.', false);
    return;
  }
  if (game.player.bulky !== null) {
    game.releaseBulky();
    game.releaseBulky('ban');
    hud.toast('Đã buông kiện hàng (rơi phịch xuống, ồn). Kiện nằm lại chỗ này, cầm lên lại được.', false);
    return;
  }
  if (!player.carrying) return;
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
  | { kind: 'shelf'; section: Section; slot: ShelfSlot | null }
  | { kind: 'defectBin' }
  | { kind: 'bulky'; id: number }
  | { kind: 'cart'; id: number }
  | { kind: 'trashBin'; id: number }
  | { kind: 'dumpster' }
  | { kind: 'powerPanel' }
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
  if (kind === 'shelf') {
    const section = sectionAt(hit.object.userData.row as number, hit.point.x, hit.point.z);
    const slot = slotAt(section.id, hit.point.x, hit.point.y);
    return { kind: 'shelf', section, slot: slot && game?.slotFilled(slot.key) ? slot : null };
  }
  if (kind === 'defectBin') return { kind: 'defectBin' };
  if (kind === 'bulky') return { kind: 'bulky', id: hit.object.userData.id as number };
  if (kind === 'cart') return { kind: 'cart', id: hit.object.userData.id as number };
  if (kind === 'trashBin') return { kind: 'trashBin', id: hit.object.userData.id as number };
  if (kind === 'dumpster') return { kind: 'dumpster' };
  if (kind === 'powerPanel') return { kind: 'powerPanel' };
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
  // Tủ điện tổng (PHÒNG ĐIỆN)
  if (f?.kind === 'powerPanel') {
    if (game.power) hud.toast('Tủ điện tổng: đang có điện. Khi mất điện, tới đây bật lại cầu dao theo sơ đồ.', true);
    else if (game.player.cart !== null || game.player.bulky !== null || player.carrying) hud.toast('Hai tay đang bận: bỏ đồ xuống rồi mới thao tác tủ điện.', false);
    else openPower();
    return;
  }
  // Đang khiêng kiện hàng: E để đặt ở ĐẢO KHUYẾN MÃI
  if (game.player.bulky !== null) {
    const r = game.placeBulky();
    if (r.ok) {
      game.releaseBulky('ban');
      audio.clank(p3(player.pos, 0.3));
    }
    hud.toast(r.msg, r.ok);
    return;
  }
  // Rác: thùng rác, thùng rác lớn (xách tay hoặc bằng xe rác)
  if (f?.kind === 'trashBin') {
    const r = game.takeTrash(f.id);
    if (r.ok) world.syncTrash(game.shift.trashFull);
    hud.toast(r.msg, r.ok);
    return;
  }
  if (f?.kind === 'dumpster') {
    const r = game.dumpTrash();
    hud.toast(r.msg, r.ok);
    return;
  }
  // Đang đẩy xe
  const cart = game.heldCart;
  if (cart) {
    if (f?.kind === 'bulky') {
      const r = game.loadBulky(f.id);
      hud.toast(r.msg, r.ok);
      if (r.ok) audio.clank(p3(player.pos, 0.4));
      return;
    }
    if (cart.bulky !== null) {
      const r = game.placeBulky();
      if (r.ok) audio.clank(p3(player.pos, 0.3));
      hud.toast(r.msg, r.ok);
      return;
    }
    if (f?.kind === 'pile' && cart.kind === 'hang') {
      if (game.takeBox()) {
        world.setPileCount(game.shift.pile);
        audio.click(p3(player.pos, 0.6), 0.5, 900);
        hud.toast(`Chất thùng hàng khô lên xe (${cart.boxes}/3). Đẩy tới kệ THIẾU HÀNG, [E] để xếp.`, true);
      } else hud.toast(game.shift.pile <= 0 ? 'Hết thùng hàng khô trong kho.' : 'Xe đã đầy (3 thùng).', false);
      return;
    }
    if (f?.kind === 'shelf' && cart.boxes > 0) {
      const r = game.restock(f.section.id);
      if (r.ok) {
        world.setRestocked(f.section.id);
        world.syncShelf(game.shift, f.section.id);
        audio.click(p3(player.pos, 1), 0.6, 1200);
      }
      hud.toast(r.msg, r.ok);
      return;
    }
    if (f?.kind === 'counter' && cart.boxes > 0) {
      const r = game.deliver();
      hud.toast(r.msg, r.ok);
      return;
    }
    hud.toast(cart.kind === 'hang' ? 'Đẩy xe hàng: [E] vào kiện nước / đống thùng để chất · [G] buông xe' : 'Đẩy xe rác: [E] vào thùng rác để gom · đổ ở THÙNG RÁC LỚN trong kho · [G] buông xe', false);
    return;
  }
  if (f?.kind === 'cart') {
    if (player.carrying) {
      hud.toast('Đang ôm thùng: thả thùng [G] rồi mới đẩy xe.', false);
      return;
    }
    const r = game.grabCart(f.id);
    if (r.ok) audio.click(p3(player.pos, 0.4), 0.4, 600);
    hud.toast(r.msg, r.ok);
    return;
  }
  if (game.player.bags > 0) {
    hud.toast('Đang xách túi rác: gom thêm ở thùng rác khác (tối đa 2), hoặc đổ vào THÙNG RÁC LỚN trong kho.', false);
    return;
  }
  if (f?.kind === 'bulky') {
    if (player.carrying) {
      hud.toast('Đang ôm thùng: thả thùng [G] rồi mới khiêng kiện hàng.', false);
      return;
    }
    const r = game.grabBulky(f.id);
    if (r.ok) {
      throwAim?.cancel();
      // Đồng nghiệp ảo (bảng sự kiện) chạy tới cầm đầu kia
      const helped = !!coworker?.isActive && game.grabBulky(f.id, 'ban').ok;
      audio.click(p3(player.pos, 0.5), 0.6, 600);
      hud.toast(helped ? 'Đồng nghiệp cầm đầu kia: hai người khiêng, đi nhanh và êm.' : r.msg, helped);
    } else if (r.msg) hud.toast(r.msg, false);
    return;
  }
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
        world.syncShelf(game.shift, f.section.id);
        player.setCarrying(false);
        game.noise({ ...player.pos }, 5, 1.5);
        audio.click(p3(player.pos, 1), 0.6, 1200);
        hud.toast(r.msg, true);
      } else hud.toast(r.msg, false);
    }
    if (f?.kind === 'counter') {
      const r = game.deliver();
      if (r.ok) {
        player.setCarrying(false);
        audio.click(p3(player.pos, 1), 0.6, 1200);
        audio.tone(1500, 0.08, 0.08);
        hud.toast(r.msg, true);
      } else hud.toast(r.msg, false);
    }
    if (f?.kind === 'cold') {
      const r = game.restockCold(f.unit.id);
      if (r.ok) {
        world.setColdNeeded(f.unit.id, false);
        player.setCarrying(false);
        game.noise({ ...player.pos }, 5, 1.5);
        audio.click(p3(player.pos, 1), 0.6, 1000);
        hud.toast(r.msg, true);
      } else hud.toast(r.msg, false);
    }
    return;
  }
  // Đang cầm một món lấy từ kệ: đặt lại kệ, hoặc bỏ vào thùng HÀNG LỖI
  if (game.player.hand) {
    if (f?.kind === 'defectBin') {
      const sec = slotByKey(game.player.hand.key)?.section;
      const r = game.discardHeld();
      if (r.ok) {
        heldItem?.set(null);
        if (sec) world.syncShelf(game.shift, sec);
        audio.clank(p3(player.pos, 0.5));
        hud.toast(r.msg, true);
      } else hud.toast(r.msg, false);
      return;
    }
    if (f?.kind === 'shelf') {
      const key = game.player.hand.key;
      const r = game.putBack();
      if (r.ok) {
        heldItem?.set(null);
        world.syncShelf(game.shift, slotByKey(key)!.section);
        audio.click(p3(player.pos, 1), 0.3, 1600);
        hud.toast(r.msg, true);
      }
      return;
    }
    hud.toast('Đang cầm hàng: [Giữ R] ăn / uống · nhìn vào kệ [E] đặt lại · hàng lỗi bỏ vào THÙNG HÀNG LỖI trong kho', false);
    return;
  }
  if (f?.kind === 'defectBin') {
    hud.toast(game.discardHeld().msg, false);
    return;
  }
  if (f?.kind === 'shelf' && f.slot) {
    const r = game.takeItem(f.slot.key);
    if (r.ok) {
      const h = game.player.hand!;
      heldItem?.set(h.product, h.defect);
      world.syncShelf(game.shift, f.section.id);
      audio.click(p3(player.pos, 1), 0.25, 2000);
    } else if (r.msg) hud.toast(r.msg, false);
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
      hud.toast(r.msg, true);
    } else hud.toast(r.msg, false);
  }
}

function updateScan(dt: number, f: Focus): void {
  if (!game) return;
  const needsStock = f?.kind === 'shelf' && game.shift.restockNeeded.has(f.section.id);
  const holding = player.keys.has('KeyF') && !player.carrying && game.player.bulky === null && game.player.cart === null && f?.kind === 'shelf' && !needsStock;
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
    hud.toast(r.msg, r.ok && !r.defects);
    audio.tone(1760, 0.12, 0.08);
    if (r.defects) {
      // Bíp lỗi: hai tiếng trầm, to
      setTimeout(() => audio.tone(440, 0.22, 0.14, undefined, 'square'), 180);
      setTimeout(() => audio.tone(330, 0.3, 0.14, undefined, 'square'), 430);
    }
    scanT = 0;
    scanTarget = null;
  }
}

/** Món đang cầm: thẻ thông tin (tên, giá, hạn sử dụng) và giữ R để ăn / uống. */
function updateHand(dt: number): void {
  if (!game) return;
  const h = game.player.hand;
  if (!h) {
    eatT = 0;
    eatWarned = false;
    if (heldItem) heldItem.eat = 0;
    hud.item(null);
    return;
  }
  const p = productById(h.product)!;
  // Hạn sử dụng: hàng tốt còn vài tháng; hàng lỗi ghi rõ lỗi (cầm lên xem kỹ mới biết)
  const months = 2 + (hashStr(h.key) % 14);
  const hsd = h.defect === 'het_han' ? `HSD: 02/2019 · ${DEFECT_TEXT.het_han}` : h.defect ? `HSD: còn ${months} tháng · ${DEFECT_TEXT[h.defect]}` : `HSD: còn ${months} tháng`;
  const edible = p.kind !== 'other';
  const verb = p.kind === 'drink' ? 'uống' : 'ăn';
  const keys = (edible ? `[Giữ R] ${verb} · ` : 'Không ăn uống được · ') + '[E] đặt lại kệ' + (h.defect ? ' · bỏ vào THÙNG HÀNG LỖI' : '');
  const holding = player.keys.has('KeyR');
  if (holding && edible) {
    if (eatT === 0) audio.click(p3(player.pos, 1.3), 0.4, p.kind === 'drink' ? 2600 : 1400); // khui lon / xé gói
    eatT += dt;
    if (eatT >= EAT_TIME) {
      const sec = slotByKey(h.key)?.section;
      const r = game.eat();
      eatT = 0;
      heldItem?.set(null);
      if (sec) world?.syncShelf(game.shift, sec);
      hud.toast(r.msg, r.ok);
      if (r.ok) audio.tone(660, 0.12, 0.06);
      else audio.tone(160, 0.5, 0.15, undefined, 'sawtooth');
      hud.item(null);
      return;
    }
  } else {
    if (holding && !edible && !eatWarned) {
      eatWarned = true;
      hud.toast(`${p.name} không ăn uống được!`, false);
    }
    if (!holding) eatWarned = false;
    eatT = Math.max(0, eatT - dt * 3);
  }
  if (heldItem) heldItem.eat = eatT / EAT_TIME;
  hud.item({ name: p.name, price: `${formatPrice(p.price)} / ${p.unit}`, color: p.color, hsd, bad: !!h.defect, keys }, eatT / EAT_TIME);
}

/** Kiện hàng nằm trên sàn (chưa ai khiêng, hoặc đã đặt ở ĐẢO KHUYẾN MÃI): vật cản cho người chơi. */
function bulkySolids(): AABB[] {
  if (!game) return [];
  const out: AABB[] = [];
  for (const c of game.shift.carts) {
    if (c.pusher) continue;
    const co = Math.abs(Math.cos(c.yaw));
    const sn = Math.abs(Math.sin(c.yaw));
    const hx = (CART_SIZE.len * sn + CART_SIZE.wid * co) / 2;
    const hz = (CART_SIZE.len * co + CART_SIZE.wid * sn) / 2;
    out.push({ minX: c.pos.x - hx, maxX: c.pos.x + hx, minZ: c.pos.z - hz, maxZ: c.pos.z + hz });
  }
  for (const b of game.shift.bulky) {
    if (b.carriers.length || b.cart !== null) continue;
    const c = Math.abs(Math.cos(b.yaw));
    const sn = Math.abs(Math.sin(b.yaw));
    const hx = (BULKY_SIZE.len * sn + BULKY_SIZE.wid * c) / 2;
    const hz = (BULKY_SIZE.len * c + BULKY_SIZE.wid * sn) / 2;
    out.push({ minX: b.pos.x - hx, maxX: b.pos.x + hx, minZ: b.pos.z - hz, maxZ: b.pos.z + hz });
  }
  return out;
}

/** Kiện hàng và đồng nghiệp ảo (bảng sự kiện → "Đồng nghiệp ảo đi theo"). */
function updateCoworker(dt: number): void {
  if (!game || !world || !coworker) return;
  const want = !netMode() && game.dev.helper && (mode === 'play' || mode === 'eval');
  if (want !== coworker.isActive) {
    camera.getWorldDirection(tmpV);
    coworker.setActive(want, player.pos, Math.atan2(tmpV.x, tmpV.z));
    const hb = game.heldBulky;
    if (want && hb) game.grabBulky(hb.id, 'ban');
    if (!want) game.releaseBulky('ban');
  }
  const hb = game.heldBulky;
  const duo = !!hb && hb.carriers.length >= 2;
  world.syncBulky(game.shift.bulky, game.player.bulky, duo);
  world.syncCarts(game.shift.carts, game.player.cart);
  world.setAuditorPos(game.auditor.pos);
  handBags.children.forEach((b, i) => (b.visible = i < game!.player.bags));
  const frozen = mode === 'play' && !controls.isLocked && (!dev.isOpen || dev.pauses);
  coworker.update(frozen ? 0 : dt, {
    pos: player.pos, running: player.keys.has('ShiftLeft') && !game.player.sneak && !hb, sneak: game.player.sneak,
    sheet: sheetOpen, light: player.flashOn,
  }, hb && hb.carriers.includes('ban') ? hb : null);
}

/** Người chơi khác: động tác theo trạng thái (đi, chạy, xem phiếu, ôm thùng, khiêng kiện…), bảng tên trên đầu. */
function updateRemotes(dt: number): void {
  if (!game) return;
  const g = game;
  g.players.forEach((p, i) => {
    const r = remotes[i];
    if (!r) return;
    const show = p.alive && !p.gone;
    r.view.visible = show;
    r.tag.visible = show;
    if (!show) return;
    const hb = p.bulky !== null ? g.shift.bulky.find((b) => b.id === p.bulky) : undefined;
    r.view.update(
      {
        pos: p.pos, yaw: p.yaw, moving: p.moving, running: p.running, sneak: p.sneak, sheet: p.sheet, carry: p.carry, light: p.light,
        bulky: hb ? (hb.carriers[0] === p.id ? 'back' : 'front') : null,
      },
      dt,
    );
    r.tag.position.set(r.view.root.position.x, p.sneak ? 1.95 : 2.15, r.view.root.position.z);
    r.tag.quaternion.copy(camera.quaternion);
  });
}

/** Người chơi khác là vật cản (trừ người đang cùng khiêng kiện với mình). */
function playerSolids(): AABB[] {
  if (!game || game.players.length < 2) return [];
  const me = game.player;
  const out: AABB[] = [];
  for (const p of game.players) {
    if (p === me || !p.alive || p.gone || (me.bulky !== null && p.bulky === me.bulky)) continue;
    out.push({ minX: p.pos.x - 0.22, maxX: p.pos.x + 0.22, minZ: p.pos.z - 0.22, maxZ: p.pos.z + 0.22 });
  }
  return out;
}

/** Thùng đang ôm, món đang cầm: theo đúng lõi game (chơi mạng: chủ phòng có thể từ chối việc mình vừa làm). */
function reconcileHands(): void {
  if (!game || mode !== 'play') return;
  const c = game.player.carry;
  if ((player.carryKind ?? null) !== c) player.setCarrying(c ?? false);
  const h = game.player.hand;
  const key = h ? h.key : null;
  if (key !== heldKey) {
    heldKey = key;
    heldItem?.set(h ? h.product : null, h?.defect ?? null);
  }
}

// ---- Cảnh theo lõi game: kệ, tủ lạnh, đống thùng, thùng rác, lon nước ----
// Việc do người chơi khác làm (chơi mạng) không đi qua interact() trên máy này, nên mỗi khung hình so cảnh với lõi game.
interface SyncState {
  need: Set<string>; taken: Set<string>; defects: Set<string>; recount: Set<string>; cold: Set<string>;
  pile: number; coldPile: number; trash: string; cans: Set<number>;
}
let sync: SyncState | null = null;
const secOf = (key: string) => key.slice(0, key.indexOf(':'));
function syncReset(): void {
  if (!game) return;
  const s = game.shift;
  sync = {
    need: new Set(s.restockNeeded), taken: new Set(s.taken), defects: new Set(s.defects.keys()), recount: new Set(s.recount),
    cold: new Set(s.coldNeeded), pile: s.pile, coldPile: s.coldPile, trash: [...s.trashFull].sort().join(), cans: new Set(),
  };
  syncWorld();
}
function syncWorld(): void {
  if (!game || !world || !sync) return;
  const s = game.shift;
  const w = world;
  const st = sync;
  const secs = new Set<string>();
  for (const id of s.restockNeeded) if (!st.need.has(id)) (w.setNeeded(id), secs.add(id));
  for (const id of st.need) if (!s.restockNeeded.has(id)) (w.setRestocked(id), secs.add(id));
  const defects = new Set(s.defects.keys());
  for (const k of s.taken) if (!st.taken.has(k)) secs.add(secOf(k));
  for (const k of st.taken) if (!s.taken.has(k)) secs.add(secOf(k));
  for (const k of defects) if (!st.defects.has(k)) secs.add(secOf(k));
  for (const k of st.defects) if (!defects.has(k)) secs.add(secOf(k));
  for (const id of secs) w.syncShelf(s, id);
  for (const id of s.recount) if (!st.recount.has(id)) w.setRecount(id, true);
  for (const id of st.recount) if (!s.recount.has(id)) w.setRecount(id, false);
  for (const id of s.coldNeeded) if (!st.cold.has(id)) w.setColdNeeded(id, true);
  for (const id of st.cold) if (!s.coldNeeded.has(id)) w.setColdNeeded(id, false);
  if (s.pile !== st.pile) w.setPileCount(s.pile);
  if (s.coldPile !== st.coldPile) w.setColdPileCount(s.coldPile);
  const trash = [...s.trashFull].sort().join();
  if (trash !== st.trash) w.syncTrash(s.trashFull);
  const cans = new Set(s.litter.map((l) => l.id));
  for (const l of s.litter) if (!st.cans.has(l.id)) w.addCan(l.x, l.z, l.id);
  for (const id of st.cans) if (!cans.has(id)) w.removeCan(id);
  sync = {
    need: new Set(s.restockNeeded), taken: new Set(s.taken), defects, recount: new Set(s.recount), cold: new Set(s.coldNeeded),
    pile: s.pile, coldPile: s.coldPile, trash, cans,
  };
}

// ---- Chơi mạng: tạo phòng, vào phòng, phòng chờ ----
const $id = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mpInfo = $id('mp-info');
const lobbyInfo = $id('lobby-info');
const codeInput = $id<HTMLInputElement>('mp-code');
const lobbyStart = $id<HTMLButtonElement>('lobby-start');
let pendingStart: StartInfo | null = null;
let lobbyState: Lobby | null = null;

async function ensureNet(): Promise<NetClient | null> {
  if (net) return net;
  mpInfo.textContent = 'Đang kết nối…';
  try {
    net = await NetClient.connect();
  } catch {
    mpInfo.textContent = 'Không kết nối được máy chủ chơi mạng. Chạy game bằng "npm run dev" hoặc "npm run play" (mở qua http://…, không mở file trực tiếp).';
    return null;
  }
  mpInfo.textContent = '';
  net.onLobby = showLobby;
  net.onError = (m) => {
    mpInfo.textContent = m;
    lobbyInfo.textContent = m;
  };
  net.onStart = (st) => {
    pendingStart = st;
    startAsGuest();
  };
  net.onLeft = (i, n) => {
    hostSync?.playerLeft(i);
    hud.toast(`${n} đã rời phòng.`, false);
  };
  net.onClose = (m) => {
    net = null;
    if (mode === 'menu') {
      menu.screen('play');
      mpInfo.textContent = m;
      return;
    }
    hud.announce(`${m} Quay về menu sau vài giây…`);
    hud.toast(m, false);
    setTimeout(() => location.reload(), 4500);
  };
  return net;
}

function showLobby(l: Lobby): void {
  lobbyState = l;
  if (mode !== 'menu') return;
  menu.screen('lobby');
  $id('lobby-code').textContent = l.code;
  $id<HTMLInputElement>('lobby-link').value = `${location.origin}${location.pathname}?room=${l.code}`;
  const names = l.players;
  const slots = [...names, ...Array(Math.max(0, 2 - names.length)).fill(undefined)];
  $id('lobby-list').innerHTML = slots
    .map((n, i) =>
      n
        ? `<li>${n.replace(/[<&>]/g, '')}<small>${i === 0 ? 'chủ phòng' : 'vào phòng'}${i === l.you ? ' · bạn' : ''}</small></li>`
        : '<li class="empty">đang chờ người vào…</li>',
    )
    .join('');
  const full = names.filter(Boolean).length >= 2;
  lobbyStart.hidden = l.you !== 0;
  lobbyStart.disabled = !full || !models;
  lobbyInfo.textContent =
    l.you === 0 ? (full ? (models ? 'Đủ người. Bấm Bắt đầu ca.' : 'Đang tải model…') : 'Đang chờ bạn vào phòng…') : 'Đang chờ chủ phòng bắt đầu ca…';
}

$id('mp-create').addEventListener('click', async () => {
  const n = await ensureNet();
  n?.create(myName());
});
$id('mp-join').addEventListener('click', async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    mpInfo.textContent = 'Mã phòng gồm 4 chữ cái.';
    return;
  }
  const n = await ensureNet();
  n?.join(code, myName());
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $id('mp-join').click();
});
$id('lobby-leave').addEventListener('click', () => {
  net?.leave();
  net = null;
  lobbyState = null;
  menu.screen('play');
});
lobbyStart.addEventListener('click', () => {
  const l = lobbyState;
  if (!net || !l || l.you !== 0 || !models) return;
  const names = l.players.filter((x): x is string => !!x);
  if (names.length < 2) return;
  const st: StartInfo = { seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, names, events: dev.saved.events };
  net.start(st);
  hostSync = new HostSync(net, () => game);
  beginShift(names[0], { seed: st.seed, names, me: 0, events: st.events });
});

/** Chủ phòng đã bắt đầu: vào ca (đợi tải xong model nếu chưa xong). */
function startAsGuest(): void {
  const st = pendingStart;
  if (!st || !net || !models || !lobbyState || game) return;
  pendingStart = null;
  const me = lobbyState.you;
  guestSync = new GuestSync(net, me, () => game);
  guestSync.onResult = (r) => hud.toast(r.msg, r.ok);
  beginShift(st.names[me] ?? myName(), { seed: st.seed, names: st.names, me, events: st.events });
}

// Đóng tab / chuyển trang: báo rời phòng ngay (trình duyệt có thể giữ trang cũ trong bộ nhớ, kết nối chưa đóng)
window.addEventListener('pagehide', () => net?.leave());

// Đường link mời: ?room=ABCD → mở sẵn màn Chơi, điền mã phòng
{
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    menu.screen('play');
    codeInput.value = room.toUpperCase().slice(0, 4);
    mpInfo.textContent = `Mã phòng ${codeInput.value}: nhập tên rồi bấm Vào phòng.`;
  }
}

// ---- Tủ điện tổng: bật cầu dao nhánh theo đúng thứ tự trên sơ đồ, rồi gạt cầu dao tổng ----
const powerEl = document.getElementById('power')!;
function openPower(): void {
  if (!game?.breaker) return;
  powerOpen = true;
  sheetOpen = false;
  if (game) hud.sheet(game, false);
  throwAim?.cancel();
  controls.unlock();
  hud.show('pause', false);
  powerEl.hidden = false;
  document.getElementById('power-msg')!.textContent = 'Đọc sơ đồ bên trái, bật từng cầu dao theo thứ tự.';
  document.getElementById('power-msg')!.className = '';
  renderPower();
  audio.click(p3(player.pos, 1.3), 0.6, 800);
}
function closePower(): void {
  if (!powerOpen) return;
  powerOpen = false;
  powerEl.hidden = true;
  if (mode === 'play') look.lock();
}
function renderPower(): void {
  const b = game?.breaker;
  if (!b) return;
  document.getElementById('power-order')!.innerHTML = b.order.map((n, i) => `<li class="${i < b.next ? 'done' : ''}">${n}</li>`).join('');
  document.getElementById('power-breakers')!.innerHTML = b.slots
    .map((n, i) => `<div class="breaker ${b.on[i] ? 'on' : ''}" data-i="${i}"><span class="led"></span><span class="lever"></span><span>${n}</span></div>`)
    .join('');
}
function sparkPower(): void {
  const c = powerEl.querySelector('.cabinet')!;
  c.classList.remove('spark');
  void (c as HTMLElement).offsetWidth;
  c.classList.add('spark');
}
document.getElementById('power-breakers')!.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.breaker') as HTMLElement | null;
  if (!el || !game) return;
  const r = game.flipBreaker(Number(el.dataset.i));
  const msg = document.getElementById('power-msg')!;
  if (r.msg) {
    msg.textContent = r.msg;
    msg.className = r.ok ? '' : 'bad';
  }
  renderPower();
});
document.getElementById('power-main')!.addEventListener('click', () => {
  if (!game) return;
  const r = game.mainSwitch();
  const msg = document.getElementById('power-msg')!;
  msg.textContent = r.msg;
  msg.className = r.ok ? '' : 'bad';
  if (r.ok) {
    audio.tone(120, 0.6, 0.15);
    hud.toast(r.msg, true);
    closePower();
  }
});
powerEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  closePower();
});

/** Biển HÀNG LỖI / CẦN QUÉT trên nóc kệ cho đoạn kệ còn việc được giao. */
let jobFlagT = 0;
function updateJobFlags(): void {
  if (!game || !world) return;
  const d = new Set<string>();
  const sc = new Set<string>();
  for (const j of game.shift.jobs) {
    if (j.done) continue;
    if (j.kind === 'scan') sc.add(j.target);
    if (j.kind === 'defect') {
      const sl = slotByKey(j.target);
      if (sl && game.shift.defects.has(j.target)) d.add(sl.section);
    }
  }
  for (const o of game.shift.openOrders) if (o.kind === 'rescan' && o.section) sc.add(o.section);
  world.setJobFlags(d, sc);
}

/** Túi rác xách tay (tối đa 2), góc dưới bên phải màn hình. */
function buildHandBags(): void {
  handBags.clear();
  for (let i = 0; i < 2; i++) {
    const b = models?.static('tui_rac') ?? new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshLambertMaterial({ color: 0x15181a }));
    b.scale.setScalar(0.75);
    b.position.set(0.32 - i * 0.62, -0.62, -0.55);
    b.rotation.set(0.2, i ? 0.8 : -0.5, 0);
    b.traverse((o) => (o.castShadow = false));
    b.visible = false;
    handBags.add(b);
  }
}

/** Thể lực, đau bụng, chóng mặt (mờ hình, chao đảo). */
let dizzyPhase = 0;
function updateBody(dt: number): void {
  if (!game) return;
  heldItem?.update(dt);
  const pl = game.player;
  hud.stamina(pl.stamina, pl.exhausted);
  const dz = mode === 'play' ? Math.min(1, pl.dizzy / 6) : 0;
  hud.sickness(mode === 'play' && pl.sick > 0, dz);
  dizzyPhase += dt;
  if (mode === 'play') camera.rotation.z = dz > 0 ? Math.sin(dizzyPhase * 1.3) * 0.06 * dz : 0;
}

function hintFor(f: Focus): string {
  if (!game) return '';
  const hb = game.heldBulky;
  if (hb) {
    const duo = hb.carriers.length >= 2;
    const where = inBox(hb.pos, inflate(PROMO_ZONE, 0.7)) ? '[E] Đặt kiện nước ở ĐẢO KHUYẾN MÃI' : 'Khiêng ra ĐẢO KHUYẾN MÃI (sát mặt kính)';
    return `${where} · ${duo ? 'hai người khiêng' : 'kéo lê một mình: chậm, ồn'} · [G] buông`;
  }
  if (f?.kind === 'powerPanel') return game.power ? 'Tủ điện tổng · đang có điện' : '[E] Mở tủ điện: bật cầu dao theo sơ đồ';
  if (f?.kind === 'trashBin') return game.shift.trashFull.has(f.id) ? `[E] Gom túi rác (${TRASH_BINS[f.id].name})` : 'Thùng rác đã gom';
  if (f?.kind === 'dumpster') {
    const n = game.player.bags + (game.heldCart?.kind === 'rac' ? game.heldCart.bags : 0);
    return n ? `[E] Đổ ${n} túi rác` : 'THÙNG RÁC LỚN · gom túi rác trong siêu thị mang về đây';
  }
  const hc = game.heldCart;
  if (hc) {
    const load = hc.bulky !== null ? 'chở kiện nước' : hc.kind === 'hang' ? `${hc.boxes}/3 thùng` : `${hc.bags}/6 túi rác`;
    if (hc.bulky !== null)
      return inBox(hc.pos, inflate(PROMO_ZONE, 0.7)) ? '[E] Đặt kiện nước ở ĐẢO KHUYẾN MÃI' : `Đẩy xe ra ĐẢO KHUYẾN MÃI · ${load} · [G] buông`;
    if (f?.kind === 'bulky') return hc.kind === 'hang' ? '[E] Chất kiện nước lên xe' : 'Xe rác không chở kiện hàng';
    if (f?.kind === 'pile' && hc.kind === 'hang') return `[E] Chất thùng lên xe (${hc.boxes}/3)`;
    if (f?.kind === 'shelf' && hc.boxes) return game.shift.restockNeeded.has(f.section.id) ? `[E] Xếp hàng từ xe vào ${f.section.name}` : 'Kệ này không thiếu hàng';
    return `Đang đẩy ${hc.kind === 'hang' ? 'xe hàng' : 'xe rác'} · ${load} · [G] buông xe`;
  }
  if (f?.kind === 'cart') {
    const c = game.shift.carts.find((x) => x.id === f.id)!;
    return c.kind === 'hang' ? '[E] Đẩy XE ĐẨY HÀNG (chở kiện nước / 3 thùng)' : '[E] Đẩy XE GOM RÁC (gom tới 6 túi)';
  }
  if (game.player.bags) return `Đang xách ${game.player.bags} túi rác · đổ vào THÙNG RÁC LỚN trong kho`;
  if (f?.kind === 'bulky') return player.carrying ? 'Kiện nước: thả thùng [G] trước' : '[E] Cầm một đầu kiện nước (2 người khiêng, hoặc chất lên XE ĐẨY HÀNG)';
  if (f?.kind === 'can') return '[E] Nhặt lại lon nước';
  const hand = game.player.hand;
  if (hand) {
    const p = productById(hand.product)!;
    if (f?.kind === 'defectBin') return `[E] Bỏ ${p.name} vào thùng HÀNG LỖI`;
    if (f?.kind === 'shelf') return `[E] Đặt lại ${p.name} lên kệ`;
    return '';
  }
  if (f?.kind === 'defectBin') return 'THÙNG HÀNG LỖI · cầm hàng lỗi trên kệ tới bỏ vào';
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
    const take = f.slot ? `[E] Lấy ${productById(f.slot.product)!.name} · ` : '';
    if (game.shift.recount.has(f.section.id)) return `${take}[Giữ F] Kiểm lại kệ (phiếu việc)`;
    return game.shift.scanned.has(f.section.id) ? take.replace(/ · $/, '') : `${take}[Giữ F] Quét kệ`;
  }
  return '';
}

// ---- Sự kiện từ lõi game ----
function handleEvents(): void {
  if (!game) return;
  const meId = game.player.id;
  for (const e of game.events) {
    switch (e.type) {
      case 'announce':
        if (subtitles) hud.announce(e.text);
        audio.speak(e.text);
        dev.log(`Loa: ${e.text}`);
        break;
      case 'power':
        dev.log(e.on ? 'Có điện lại' : 'MẤT ĐIỆN');
        if (e.on && powerOpen) closePower();
        powerTarget = e.on ? 1 : 0;
        flickerT = e.on ? 0.8 : 1.4;
        if (!e.on) {
          audio.tone(55, 1.8, 0.3);
          audio.click(p3(player.pos, 3), 0.8, 400);
          if (!flashTipShown) {
            flashTipShown = true;
            hud.toast('MẤT ĐIỆN · [T] đèn pin · tới PHÒNG ĐIỆN bật lại cầu dao theo sơ đồ. Ánh đèn có thể khiến kiểm kê viên chạy tới.', false);
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
        if (e.who !== meId) {
          // Người khác bị đếm: chỉ nghe tiếng máy quét
          audio.tone(e.n === 1 ? 990 : 1180, 0.16, 0.12, p3(game.auditor.pos, 1.3));
          break;
        }
        if (e.n === 1) dev.log('Bị tia quét chạm: bắt đầu đếm');
        hud.count(e.n);
        audio.tone(e.n === 1 ? 990 : 1180, 0.16, 0.2, p3(game.auditor.pos, 1.3));
        audio.speak(e.n === 1 ? 'Một' : 'Hai', 1.0);
        break;
      case 'lost':
        if (e.who !== meId) break;
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
        dev.log(`Hết ca · việc ${e.ev.jobsDone}/${e.ev.jobsTotal} · ghi hồ sơ ${e.ev.records.length} · +${e.ev.holesAdded} lỗ`);
        dev.close(true);
        onEval(e.ev);
        break;
      case 'dead':
        if (e.who !== meId) {
          dev.log(`${e.name} đã chết`);
          if (e.reason === 'scan') {
            captureView?.begin(e.name);
            hud.toast(`${e.name} bị Người Kiểm Kê đếm đủ, đóng thùng!`, false);
          }
          break;
        }
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
        if (e.who !== meId) {
          dev.log(`${game.players.find((p) => p.id === e.who)?.name ?? e.who} đã chấm công vào ca`);
          break;
        }
        dev.log(e.late ? 'Chấm công vào ca TRỄ' : 'Đã chấm công vào ca');
        audio.click(p3(player.pos, 1.2), 0.7, 900);
        setTimeout(() => audio.tone(e.late ? 330 : 1320, 0.12, 0.08), 120);
        hud.toast(
          e.late
            ? `Chấm công vào ca TRỄ (${game.shift.clock()}) · bị ghi hồ sơ`
            : `Đã chấm công vào ca lúc ${game.shift.clock()} · bắt đầu làm việc`,
          !e.late,
        );
        break;
      case 'night':
        dev.log(`Bắt đầu lại đêm ${game.night}`);
        resetNightView();
        if (guestSync && mode !== 'play') {
          // Chủ phòng đã nhận ca đêm sau
          hud.show('eval', false);
          mode = 'play';
          hud.show('pause', true);
          hud.toast(`Đêm ${game.night} bắt đầu · bấm "Tiếp tục"`, true);
        }
        break;
      case 'dev':
        dev.log(e.text);
        hud.toast(e.text, true);
        break;
      case 'order': {
        const o = e.order;
        dev.log(`Phiếu việc mới: ${orderText(o)} · hạn ${clockOf(o.due)}`);
        if (o.kind === 'restock' && o.section) {
          world?.setNeeded(o.section);
          world?.syncShelf(game.shift, o.section);
        }
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
      case 'scrape':
        // Kiện hàng lết trên sàn: ken két
        audio.tone(170 + Math.random() * 60, 0.32, 0.09, p3(e.at, 0.1), 'sawtooth');
        audio.click(p3(e.at, 0.1), 0.5, 500);
        break;
      case 'thud':
        audio.tone(60, 0.4, 0.25, p3(e.at, 0.2), 'square');
        audio.clank(p3(e.at, 0.2));
        break;
      case 'rattle':
        // bánh xe đẩy lạch cạch (chở nặng thì kêu to hơn)
        audio.click(p3(e.at, 0.15), 0.25 + Math.min(0.4, e.load * 0.06), 1100);
        setTimeout(() => audio.click(p3(e.at, 0.15), 0.2, 1500), 140);
        break;
      case 'breaker':
        if (e.ok) audio.click(p3(e.at, 1.3), 0.7, 2200);
        else {
          // chập điện: xèo xèo + nổ
          audio.tone(90, 0.35, 0.3, p3(e.at, 1.3), 'square');
          for (let i = 0; i < 6; i++) setTimeout(() => audio.click(p3(e.at, 1.3), 0.8, 5000), i * 45);
          sparkPower();
        }
        break;
      case 'trash':
        audio.click(p3(e.at, 0.6), e.dumped ? 0.8 : 0.45, e.dumped ? 500 : 900);
        if (e.dumped) audio.tone(70, 0.25, 0.12, p3(e.at, 0.6));
        break;
      case 'groan':
        // Ọc ọc… ối…: tiếng trầm, ai đứng gần cũng nghe
        audio.tone(95, 0.5, 0.22, p3(e.at, 1.2), 'sawtooth');
        setTimeout(() => audio.tone(70, 0.6, 0.18, p3(e.at, 1.2), 'sawtooth'), 380);
        if (e.who === meId) hud.toast('Ọc ọc… ối… (đau bụng, rên thành tiếng)', false);
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
  if (powerOpen) closePower();
  hud.scanner(null);
  hud.count(0);
  controls.unlock();
  hud.show('pause', false);
  hud.badge(game.name, game.holes, game.records);
  hud.evaluation(game, ev, () => {
    hud.show('eval', false);
    if (!game || !world) return;
    if (guestSync) {
      // Người vào phòng: chủ phòng quyết định nhận ca tiếp
      if (ev.final) showFinal();
      else if (!ev.dead) hud.toast('Đang chờ chủ phòng nhận ca tiếp…', true);
      return;
    }
    if (ev.dead) {
      game.terminate();
      hostSync?.collect(game.events);
      handleEvents();
      return;
    }
    if (ev.final) {
      showFinal();
      return;
    }
    game.nextNight();
    hostSync?.push({ type: 'night' });
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
  syncReset();
  // Chơi mạng: người đã chết đêm trước được vào ca lại
  deathStage = null;
  hud.death('off');
  hud.show('hud', true);
  player.teleport(playerSpawn(myIndex()), PLAYER_SPAWN_YAW);
  throwAim?.cancel();
  player.setCarrying(false);
  player.setFlashlight(false);
  game.player.light = false;
  heldItem?.set(null);
  eatT = 0;
  world.syncTrash(game.shift.trashFull);
  world.syncCarts(game.shift.carts, null);
  if (coworker?.isActive) {
    coworker.setActive(false, player.pos, 0);
    coworker.setActive(true, player.pos, PLAYER_SPAWN_YAW + Math.PI);
  }
  world.syncBulky(game.shift.bulky, null, false);
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
  dyingName = game.player.name;
  heldItem?.set(null);
  if (powerOpen) closePower();
  game.releaseCart();
  hud.item(null);
  hud.sickness(false, 0);
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
    <div class="row"><span>Số lỗ trên thẻ</span><span>${game.holes}/3</span></div>
    <div class="row"><span>Tổng lương ${game.wages.length} đêm</span><span>${formatPrice(game.wages.reduce((a, w) => a + w, 0))}</span></div><hr>
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
    motion = { moving: false, running: false, sneak: false };
    if (mode === 'play' && (controls.isLocked || powerOpen) && game.player.alive) {
      // Kiện hàng: vòng va chạm phía trước (kiện, và đồng nghiệp cầm đầu kia), kiện nằm trên sàn là vật cản
      const hb = game.heldBulky;
      const reach = BULKY_SIZE.len / 2 + 0.35;
      const bodies: [number, number][] = hb ? [[reach - 0.3, 0.26], [reach + 0.3, 0.26]] : [];
      if (hb && hb.carriers.length >= 2) bodies.push([reach * 2, 0.28]);
      if (game.heldCart) bodies.push([CART_MOVE.reach - 0.25, 0.3], [CART_MOVE.reach + 0.25, 0.3]);
      // Hai người khiêng, mình cầm đầu sau (người kia dẫn): đứng ở đầu bên kia của kiện, đi theo kiện
      const follow = !!hb && hb.carriers.length >= 2 && hb.carriers[0] !== game.player.id;
      // Đang mở tủ điện: đứng yên (vẫn có thể bị phát hiện)
      if (powerOpen || follow) for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) player.keys.delete(k);
      if (follow) player.pos = { x: hb!.pos.x + Math.sin(hb!.yaw) * BULKY_MOVE.reach, z: hb!.pos.z + Math.cos(hb!.yaw) * BULKY_MOVE.reach };
      const m = player.update(dt, {
        canRun: game.canRun, speedMul: game.speedMul, maxSpeed: game.carrySpeed, bodies: follow ? [] : bodies, extra: [...bulkySolids(), ...playerSolids()],
      });
      if (follow) m.moving = !!followPrev && Math.hypot(player.pos.x - followPrev.x, player.pos.z - followPrev.z) > 0.004;
      followPrev = follow ? { ...player.pos } : null;
      motion = { moving: m.moving, running: m.running, sneak: m.sneaking };
      if (powerOpen && !inBox(player.pos, POWER_ZONE)) closePower();
      game.player.pos = { ...player.pos };
      camera.getWorldDirection(tmpV);
      game.player.yaw = Math.atan2(tmpV.x, tmpV.z);
      game.player.sheet = sheetOpen;
      game.reportMotion(dt, m.moving, m.running, m.sneaking);
      if (sheetOpen) {
        // Bìa kẹp nhún theo bước chân, lắc nhẹ khi chạy
        if (m.moving) sheetBob += dt * (m.running ? 11 : m.sneaking ? 5 : 7.5);
        const amp = m.moving ? (m.running ? 9 : 4) : 0;
        const el = document.getElementById('sheet')!;
        el.style.setProperty('--bob', `${(Math.abs(Math.sin(sheetBob)) * amp).toFixed(1)}px`);
        el.style.setProperty('--sway', `${(Math.sin(sheetBob * 0.5) * amp * 0.25).toFixed(2)}deg`);
      }
      const f = getFocus();
      updateScan(dt, f);
      updateHand(dt);
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
      hud.badge(game.name, game.holes, game.records);
      if (sheetOpen && (sheetRefresh -= dt) <= 0) {
        sheetRefresh = 0.25;
        hud.sheet(game, true, player.pos, game.player.yaw);
      }
      if ((jobFlagT -= dt) <= 0) {
        jobFlagT = 0.5;
        updateJobFlags();
      }
    } else if (mode === 'play' && dev.isOpen && !dev.pauses) {
      // Bảng sự kiện mở nhưng không tạm dừng: thế giới vẫn chạy, người chơi đứng yên
      game.tick(wdt);
      hud.clock(game);
      hud.badge(game.name, game.holes, game.records);
    } else if (mode === 'spectate' || mode === 'dying') {
      game.tick(wdt);
      if (mode === 'dying') updateDeath(dt);
      else updateAutoCam(dt);
    } else if (netMode() && (mode === 'play' || mode === 'eval')) {
      // Chơi mạng: tạm dừng (Esc) không dừng ca của người khác
      game.tick(wdt);
      hud.clock(game);
      hud.badge(game.player.name, game.holes, game.records);
    }
    if (hostSync) {
      hostSync.applyInputs(dt);
      hostSync.collect(game.events);
      hostSync.send(dt);
    }
    guestSync?.frame(dt, motion);
    handleEvents();
    syncWorld();
    reconcileHands();
    updateRemotes(dt);
    world.setDrift(game.shift.drift);
    updateBody(dt);
    updateCoworker(dt);
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
    captureView?.update(game.auditor, frozen ? 0 : wdt, auditorView.bone('than'));
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
    if ((fpsT -= dt) <= 0) {
      fpsT = 0.5;
      document.getElementById('fps')!.textContent = `${Math.round(governor.fps)} FPS`;
    }
    hud.tick(dt);
    renderer.render(world.scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Chỉ khi chạy npm run dev: cho script kiểm tra tự động (chụp màn hình…) truy cập trạng thái game.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__hd30 = {
    camera, player, dev, devHost, get game() { return game; }, get net() { return net; }, get hostSync() { return hostSync; }, get guestSync() { return guestSync; }, get mode() { return mode; }, get auditorView() { return auditorView; }, get captureView() { return captureView; }, get throwAim() { return throwAim; }, get heldItem() { return heldItem; }, get coworker() { return coworker; }, openPower, hud, get world() { return world; },
    renderInfo: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: governor.ratio, programs: renderer.info.programs?.length }),
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
