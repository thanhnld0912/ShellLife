// Kiểm tra nhanh logic game, không cần trình duyệt: npm run sim:test
import { Game, orderText, type Evaluation, type GameOptions } from '../src/sim/game.ts';
import { EAT_RECORD_OVER, LITTER_FEE, WAGE_PER_NIGHT, jobCounts } from '../src/sim/shift.ts';
import { shelfSlots, slotAt, slotByKey } from '../src/sim/shelfGoods.ts';
import { productById } from '../src/sim/products.ts';
import {
  Auditor, ROUTE_STYLES, beamReach, buildRoute, navStats, pathClear, planPath, hasLOS, tuningForNight,
} from '../src/sim/auditor.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import {
  AUDITOR_DOOR, AUDITOR_SPAWN, CLOCK_ZONE, COLD_UNITS, PLAYER_SPAWN, ROOMS, SECTIONS, SHELVES, STORE, inSafeRoom, roomAt, storageSlot,
  storageStand, TRASH_BINS, PLAYER_SOLIDS, SOLIDS,
} from '../src/sim/layout.ts';
import type { V2 } from '../src/sim/geometry.ts';
import { dist } from '../src/sim/geometry.ts';

/** Game để thử các việc: bỏ bước chấm công vào ca (có bài kiểm tra riêng cho chấm công). */
function mkGame(name: string, opts: GameOptions | number = {}): Game {
  const o: GameOptions = typeof opts === 'number' ? { seed: opts } : opts;
  return new Game(name, { ...o, events: { clockInRequired: false, ...o.events } });
}

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  if (!ok) failed++;
}

// 1. Lộ trình tuần tra: mỗi kiểu đều đi tới được mọi điểm, không xuyên tường
/** Đi theo đường planPath từ a tới b: mọi đoạn đều đi thẳng được và tới đúng nơi. */
const walk = (a: V2, b: V2): boolean => {
  const path = planPath(a, b);
  let cur = a;
  for (const q of path) {
    if (!pathClear(cur, q)) return false;
    cur = q;
  }
  return dist(cur, b) < 0.05;
};
for (const style of ROUTE_STYLES) {
  const r = buildRoute(style, mulberry32(5));
  let ok = r.length >= 6;
  for (let i = 0; i < r.length; i++) ok &&= walk(r[i], r[(i + 1) % r.length]);
  check(`Lộ trình "${style}" đi được (${r.length} điểm)`, ok);
}
check('Hai lần dựng cùng kiểu cho thứ tự khác nhau',
  JSON.stringify(buildRoute('ngau_nhien', mulberry32(1))) !== JSON.stringify(buildRoute('ngau_nhien', mulberry32(2))));
// Ra khỏi phòng riêng (PHÒNG KIỂM KÊ) qua đúng cửa phòng
{
  const office = ROOMS.find((r) => r.name === 'PHÒNG KIỂM KÊ')!;
  const path = planPath(AUDITOR_SPAWN, AUDITOR_DOOR);
  check('Xuất phát trong phòng kiểm kê (tách khỏi văn phòng)', AUDITOR_SPAWN.x > office.box.minX && AUDITOR_SPAWN.z < STORE.backZ);
  check('Từ phòng kiểm kê ra cửa không xuyên tường', walk(AUDITOR_SPAWN, AUDITOR_DOOR), `${path.length} điểm`);
  const cross = [AUDITOR_SPAWN, ...path].findIndex((q, i, arr) => i > 0 && arr[i - 1].z < STORE.backZ && q.z >= STORE.backZ);
  const pts = [AUDITOR_SPAWN, ...path];
  // Điểm ngay trước và sau vách z = 7 nằm thẳng ô cửa
  const a = pts[cross - 1];
  const b = pts[cross];
  const xAt = a.x + ((b.x - a.x) * (STORE.backZ - a.z)) / (b.z - a.z);
  check('Đi qua đúng ô cửa phòng kiểm kê', cross > 0 && Math.abs(xAt - office.door.x) < office.doorW / 2, xAt.toFixed(2));
}
// Vác thùng về kho từ mọi nơi (khu bán hàng, kho lạnh, phòng nghỉ, văn phòng) đều qua cửa, không xuyên tường
for (const from of [{ x: 36, z: 22.75 }, { x: 14.5, z: 4 }, { x: 25, z: 4.5 }, { x: 40, z: 3.5 }, { x: 2.3, z: 31 }, { x: 33, z: 4 }]) {
  check(`Vác thùng từ (${from.x}, ${from.z}) về kho không xuyên tường`, walk(from, storageStand(1)));
}
check('Có 48 đoạn kệ (12 dãy, 2 khối)', SECTIONS.length === 48, String(SECTIONS.length));
{
  const ns = navStats();
  check('Lưới đường đi liền một vùng', ns.components === 1, `${ns.nodes} điểm, ${ns.components} vùng`);
}

// 2. Tìm đường tới các điểm khó: giữa hai dãy kệ, góc quầy, làn tây, khu hàng lạnh giữa hai đảo tủ đông,
//    sau đảo tủ đông, sát ngăn mát tường đông, cửa kho lạnh
const lane = (i: number) => (SHELVES[i].box.maxZ + SHELVES[i + 1].box.minZ) / 2;
const targets = [
  { x: 10, z: lane(2) }, { x: 39.5, z: 30.9 }, { x: 2.3, z: 24 }, { x: 36, z: 16.25 },
  { x: 36, z: 22.75 }, { x: 42.2, z: 15 }, { x: 14.5, z: 8.2 }, { x: 22, z: 31.0 }, { x: 11.0, z: 33.2 }, { x: 16.6, z: 31.6 },
];
for (const t of targets) {
  const p = planPath({ x: 2.3, z: 8.4 }, t);
  const end = p[p.length - 1];
  check(`Tìm đường tới (${t.x}, ${t.z.toFixed(1)})`, p.length > 0 && dist(end, t) < 1.5, `${p.length} điểm`);
}

// 3. Kệ che tầm nhìn
check('Kệ che tầm nhìn giữa hai làn', !hasLOS({ x: 12, z: lane(0) }, { x: 12, z: lane(1) }));
check('Cùng làn thì nhìn thấy', hasLOS({ x: 3, z: lane(0) }, { x: 14.5, z: lane(0) }));
check('Hai khối kệ lệch nhau: làn khối tây không nhìn thông sang khối giữa', !hasLOS({ x: 3, z: lane(0) }, { x: 26, z: lane(0) }));
check('Pallet che đường nhìn dọc làn ngang', !hasLOS({ x: 3, z: 19.5 }, { x: 14, z: 19.5 }));
{
  const r = beamReach({ x: 12, z: lane(0) }, Math.PI, 9); // chĩa về phía bắc, gặp mặt nam của dãy 1
  const want = lane(0) - SHELVES[0].box.maxZ;
  check('Tia quét dừng ở mặt kệ', Math.abs(r - want) < 0.05, `${r.toFixed(2)} / ${want.toFixed(2)}`);
  check('Tia quét dọc làn đi hết tầm', beamReach({ x: 3, z: lane(0) }, Math.PI / 2, 9) === 9);
}
check('Tủ đông nằm thấp: không che tầm nhìn', hasLOS({ x: 35.9, z: 11.8 }, { x: 35.9, z: 14.2 }));
check('Ngăn mát mở cao: che tầm nhìn', !hasLOS({ x: 42.2, z: 15 }, { x: 43.95, z: 15 }));
check(`Có ${COLD_UNITS.length} tủ lạnh bán hàng`, COLD_UNITS.length === 18 + 15 + 9);

// 4. Một ca: Người Kiểm Kê xuất hiện, đi tuần, không ai ở trong tầm thì không bị bắt
{
  const g = mkGame('Thử', 42);
  g.player.pos = { x: 6, z: 4.5 };
  let moved = 0;
  let last = { ...g.auditor.pos };
  for (let i = 0; i < 60 * 60; i++) {
    g.tick(1 / 60);
    moved += dist(last, g.auditor.pos);
    last = { ...g.auditor.pos };
    if (g.phase !== 'shift') break;
  }
  check('Kiểm kê viên được kích hoạt sau 22:10', g.auditor.state !== 'idle', g.auditor.state);
  check('Kiểm kê viên có di chuyển', moved > 20, `${moved.toFixed(1)} m trong 60 giây`);
}

// 5. Nghe tiếng động và đi điều tra
{
  const g = mkGame('Thử', 7);
  g.player.pos = { x: 6, z: 4.5 };
  for (let i = 0; i < 60 * 14; i++) g.tick(1 / 60); // đợi nó ra khỏi kho
  const before = g.auditor.state;
  g.noise({ x: g.auditor.pos.x + 4, z: g.auditor.pos.z }, 10, 2);
  check('Nghe tiếng động gần', g.auditor.state === 'alert', `${before} → ${g.auditor.state}`);
  for (let i = 0; i < 60 * 2; i++) g.tick(1 / 60);
  check('Chuyển sang đi điều tra', ['investigate', 'search', 'count'].includes(g.auditor.state), g.auditor.state);
  const far = mkGame('Thử', 8);
  for (let i = 0; i < 60 * 14; i++) far.tick(1 / 60);
  far.noise({ x: 23, z: 23.5 }, 2, 0.5);
  check('Không nghe tiếng thì thầm ở xa', far.auditor.state !== 'alert', far.auditor.state);
}

// 6. Đứng trước tia quét thì bị đếm và đóng thùng
{
  const g = mkGame('Thử', 3);
  for (let i = 0; i < 60 * 14; i++) g.tick(1 / 60);
  const a = g.auditor;
  g.player.pos = { x: a.pos.x + Math.sin(a.beam) * 2, z: a.pos.z + Math.cos(a.beam) * 2 };
  let counted = false;
  for (let i = 0; i < 60 * 3 && g.phase === 'shift'; i++) {
    g.tick(1 / 60);
    if (g.events.some((e) => e.type === 'count')) counted = true;
    g.events.length = 0;
  }
  check('Bị tia quét chạm thì đếm', counted);
  check('Đếm đủ 2 giây thì đóng thùng', g.phase === 'dead', g.phase);
}

// 7. Việc được giao: danh sách cụ thể (không còn công / chỉ tiêu)
{
  const g = mkGame('Thử', 1);
  const s = g.shift;
  const kinds = new Set(s.jobs.map((j) => j.kind));
  check('Đầu ca có danh sách việc cụ thể (quét, xếp kệ, tủ lạnh, nhiệt độ, hàng lỗi, rác)',
    ['scan', 'restock', 'coldRestock', 'freezer', 'defect', 'trash'].every((k) => kinds.has(k as never)), s.jobs.map((j) => j.kind).join(','));
  check('Đêm 1 vừa sức: không quá 10 việc', s.jobs.length <= 10, String(s.jobs.length));
  check('Mỗi việc ghi rõ chỗ làm', s.jobs.every((j) => g.jobLabel(j).length > 8), s.jobs.map((j) => g.jobLabel(j)).join(' | '));
  s.minutes = 60;
  const f1 = g.freezer();
  check('Ghi nhiệt độ đúng mốc được giao thì xong việc', f1.ok && !!f1.job && s.jobs.some((j) => j.kind === 'freezer' && j.target === '60' && j.done));
  s.minutes = 180;
  const f2 = g.freezer();
  check('Mốc không được giao: ghi được nhưng không tính là việc', f2.ok && !f2.job);
  const scanJob = s.jobs.find((j) => j.kind === 'scan')!;
  const empty = SECTIONS.find((x) => s.restockNeeded.has(x.id))!;
  check('Kệ thiếu hàng thì không quét được', !g.scanSection(empty.id).ok);
  const sr = g.scanSection(scanJob.target);
  check('Quét đúng đoạn kệ được giao thì xong việc', sr.ok && !!sr.job && scanJob.done, sr.msg);
  check('Không quét một kệ hai lần', !g.scanSection(scanJob.target).ok);
  check('Xếp kệ phải có thùng hàng khô', !g.restock(empty.id).ok);
  g.takeBox();
  const rr = g.restock(empty.id);
  check('Xếp kệ thiếu hàng được giao thì xong việc', rr.ok && !!rr.job);
  check('Xếp hàng xong thì quét được', g.scanSection(empty.id).ok);
}

// 8. Hết ca: còn việc chưa xong và vắng điểm danh thì bị 2 lỗ
{
  const g = mkGame('Thử', 5);
  g.player.pos = { x: 3, z: 3 }; // đứng trong kho, kiểm kê viên không vào kho
  g.shift.minutes = 479.9;
  g.tick(0.2);
  const ev = g.events.find((e) => e.type === 'eval');
  check('Hết ca thì có phiếu đánh giá', !!ev);
  if (ev && ev.type === 'eval') check('Còn việc chưa xong + vắng điểm danh = 2 lỗ', ev.ev.holesAdded === 2, String(ev.ev.holesAdded));
}

// 6. Mất điện: nghe tiếng động thì CHẠY tới; ánh đèn pin trong tầm mắt làm nó chú ý
{
  const g = mkGame('Thử', 7);
  g.player.pos = { x: 6, z: 4.5 };
  check('Đêm 1 không mất điện', g.blackout === null);
  for (let i = 0; i < 60 * 14; i++) g.tick(1 / 60);
  g.events.length = 0;
  g.forceBlackout();
  g.tick(1 / 60);
  check('Mất điện phát sự kiện power', g.events.some((e) => e.type === 'power' && !e.on));
  check('Kiểm kê viên biết đang mất điện', g.auditor.blackout && !g.power);
  g.noise({ x: g.auditor.pos.x + 5, z: g.auditor.pos.z }, 10, 0.5);
  let ran = false;
  let maxStep = 0;
  for (let i = 0; i < 60 * 3; i++) {
    const p0 = { ...g.auditor.pos };
    g.tick(1 / 60);
    if (g.auditor.running) ran = true;
    maxStep = Math.max(maxStep, dist(p0, g.auditor.pos) * 60);
  }
  check('Khi mất điện, nghe tiếng động thì chạy', ran, `tốc độ tối đa ${maxStep.toFixed(2)} m/s`);
  check('Tốc độ chạy > đi điều tra', maxStep > g.auditor.tune.investigateSpeed + 0.5, maxStep.toFixed(2));
  g.forceBlackout();
  g.tick(1 / 60);
  check('Có điện lại', g.power && !g.auditor.blackout);

  const mk = () => {
    const a = new Auditor(tuningForNight(2), mulberry32(3));
    a.state = 'search';
    a.pos = { x: 2.3, z: 12.5 };
    a.heading = Math.PI / 2 - 1.0; // người chơi lệch 1 rad: ngoài tia quét, trong tầm mắt
    a.blackout = true;
    return a;
  };
  const target = { x: 9.3, z: 12.5 };
  const lit = mk();
  lit.update(1 / 60, target, true, true);
  check('Thấy ánh đèn pin thì chú ý', lit.state === 'alert' && lit.events.some((e) => e.type === 'light'), lit.state);
  const dark = mk();
  dark.update(1 / 60, target, true, false);
  check('Tắt đèn pin thì không bị chú ý', dark.state === 'search', dark.state);
  const day = mk();
  day.blackout = false;
  day.update(1 / 60, target, true, true);
  check('Có điện thì đèn pin không gây chú ý', day.state === 'search', day.state);
}

// 9. Bảng sự kiện: điều khiển tay
{
  const g = mkGame('Thử', { seed: 11, events: { auditorStart: 0 } });
  g.tick(1 / 60);
  check('Lịch: Người Kiểm Kê vào lúc 22:00', g.auditor.state !== 'idle', g.auditor.state);
  g.devAuditorRest();
  check('Cho về kho nghỉ', g.auditor.state === 'idle');
  for (let i = 0; i < 60; i++) g.tick(1 / 60);
  check('Về nghỉ thì không tự vào lại theo lịch', g.auditor.state === 'idle');
  g.devLure({ x: 9, z: 12.5 });
  check('Dụ tới: gọi vào và nghe thấy', g.auditor.state === 'alert', g.auditor.state);

  const n1 = mkGame('Thử', 12);
  check('Đêm 1 mặc định không mất điện', n1.blackout === null);
  // Mất điện nhiều lần: đêm 2 một lần, đêm 3 hai lần, đêm 4 ba lần; không chồng nhau, cách nhau >= 40 phút
  {
    const g = mkGame('Thử', { seed: 21, events: { powerFix: false } }); // không ai sửa điện: tự có điện lại
    const counts: number[] = [];
    let spaced = true;
    for (let n = 2; n <= 5; n++) {
      g.devGoNight(n);
      counts.push(g.blackouts.length);
      for (let i = 1; i < g.blackouts.length; i++) spaced &&= g.blackouts[i].start - g.blackouts[i - 1].end >= 40;
    }
    check('Số lần mất điện tăng theo đêm (2→5)', counts.join(',') === '1,2,3,3', counts.join(','));
    check('Các lần mất điện cách nhau ít nhất 40 phút', spaced);
    g.devGoNight(4);
    let offs = 0;
    g.events.length = 0;
    for (let t = 0; t < 480; t += 2) {
      g.shift.minutes = t;
      g.tick(1 / 60);
    }
    offs = g.events.filter((e) => e.type === 'power' && !e.on).length;
    check('Đêm 4 mất điện 3 lần trong ca', offs === 3, String(offs));
    const styles = new Set<string>();
    for (let n = 1; n <= 5; n++) {
      g.devGoNight(n);
      styles.add(g.auditor.routeStyle);
    }
    check('Mỗi đêm Người Kiểm Kê đi một kiểu lộ trình khác', styles.size === 5, [...styles].join(','));
  }
  const n1b = mkGame('Thử', { seed: 12, events: { blackoutFromNight: 1, blackoutMinutes: 40 } });
  check('Lịch: mất điện từ đêm 1', !!n1b.blackout && n1b.blackout.end - n1b.blackout.start === 40);
  n1b.setEventConfig({ blackoutAuto: false });
  check('Tắt tự mất điện thì bỏ lịch đêm này', n1b.blackout === null);

  n1.devSetPower(false);
  n1.tick(1 / 60);
  check('Mất điện ngay', !n1.power);
  n1.devSetPower(true);
  n1.tick(1 / 60);
  check('Có điện lại ngay', n1.power);

  n1.devSkip(30);
  check('Tua 30 phút', Math.abs(n1.shift.minutes - 30) < 0.1, n1.shift.clock());
  n1.devSkipToFreezer();
  check('Tua tới giờ ghi nhiệt độ', n1.shift.freezerWindow() === 60, n1.shift.clock());
  n1.events.length = 0;
  n1.devGoNight(3);
  check('Nhảy tới đêm 3', n1.night === 3 && n1.shift.jobs.filter((j) => j.kind === 'scan').length === jobCounts(3).scan && n1.events.some((e) => e.type === 'night'));
  check('Đêm 3 dùng thông số đêm 3', Math.abs(n1.auditor.tune.speed - tuningForNight(3).speed) < 1e-9);

  n1.setTuning({ range: 4, countTime: 3 });
  check('Ghi đè thông số có hiệu lực ngay', n1.auditor.tune.range === 4 && n1.auditor.tune.countTime === 3);
  n1.nextNight();
  check('Ghi đè giữ qua đêm sau', n1.auditor.tune.range === 4);
  n1.resetTuning();
  check('Khôi phục thông số mặc định', n1.auditor.tune.range === tuningForNight(n1.night).range);

  // Không chết + tàng hình
  const nd = mkGame('Thử', 3);
  for (let i = 0; i < 60 * 14; i++) nd.tick(1 / 60);
  nd.dev.noDeath = true;
  const a = nd.auditor;
  nd.player.pos = { x: a.pos.x + Math.sin(a.beam) * 2, z: a.pos.z + Math.cos(a.beam) * 2 };
  let spared = false;
  for (let i = 0; i < 60 * 3; i++) {
    nd.tick(1 / 60);
    if (nd.events.some((e) => e.type === 'dev')) spared = true;
    nd.events.length = 0;
  }
  check('Không chết: bị đếm đủ vẫn sống', nd.phase === 'shift' && spared, nd.phase);
  const inv = mkGame('Thử', 3);
  for (let i = 0; i < 60 * 14; i++) inv.tick(1 / 60);
  inv.dev.invisible = true;
  const b = inv.auditor;
  inv.player.pos = { x: b.pos.x + Math.sin(b.beam) * 2, z: b.pos.z + Math.cos(b.beam) * 2 };
  for (let i = 0; i < 60 * 3; i++) inv.tick(1 / 60);
  check('Tàng hình: đứng trước tia quét không bị đếm', inv.phase === 'shift' && inv.auditor.state !== 'count', inv.auditor.state);
}

// 10. Cảnh đóng thùng: lao tới → nhét vào thùng → bê về kho → đặt xuống → đi tuần tiếp
{
  const g = mkGame('Lan', 3);
  for (let i = 0; i < 60 * 14; i++) g.tick(1 / 60);
  const a = g.auditor;
  // Đặt nó đứng ở làn giữa dãy 1 và 2, nhìn về phía đông; người chơi đứng xa 4 m trước tia quét
  a.pos = { x: 2.3, z: 12.5 };
  a.heading = a.beam = Math.PI / 2;
  a.state = 'search';
  g.player.pos = { x: a.pos.x + Math.sin(a.beam) * 4, z: a.pos.z + Math.cos(a.beam) * 4 };
  const caughtAt = { ...g.player.pos };
  const seen: string[] = [];
  let dead: { slot: { x: number; z: number } } | null = null;
  let stored: { name: string; slot: { x: number; z: number } } | null = null;
  let maxSpeed = 0;
  let distAtBoxing = -1;
  for (let i = 0; i < 60 * 90 && !stored; i++) {
    const p0 = { ...g.auditor.pos };
    g.tick(1 / 60);
    if (g.auditor.state === 'lunge') maxSpeed = Math.max(maxSpeed, dist(p0, g.auditor.pos) * 60);
    for (const e of g.events) {
      if (['dead', 'boxing', 'boxed', 'stored'].includes(e.type) && !seen.includes(e.type)) seen.push(e.type);
      if (e.type === 'dead') dead = e;
      if (e.type === 'boxing') distAtBoxing = dist(g.auditor.pos, caughtAt);
      if (e.type === 'stored') stored = e;
    }
    g.events.length = 0;
  }
  check('Thứ tự cảnh: chết → nhét thùng → đóng xong → lưu kho', seen.join(',') === 'dead,boxing,boxed,stored', seen.join(','));
  check('Lao tới rất nhanh', maxSpeed > 5, `${maxSpeed.toFixed(1)} m/s`);
  check('Nhét vào thùng ngay cạnh chỗ bị bắt', distAtBoxing >= 0 && distAtBoxing < 1.2, distAtBoxing.toFixed(2));
  check('Ô kho kế sau thùng của Tuấn', !!dead && dead.slot.z === storageSlot(1).z && !!stored && stored.slot.z === dead.slot.z);
  check('Thùng mang tên người chơi', stored?.name === 'Lan');
  check('Đặt thùng xong thì đứng trong kho', g.auditor.pos.z < 6, `${g.auditor.pos.x.toFixed(1)}, ${g.auditor.pos.z.toFixed(1)}`);
  check('Đặt thùng xong thì đi tuần tiếp', g.auditor.state === 'patrol' && !g.auditor.capture, g.auditor.state);
  let moved = 0;
  let last = { ...g.auditor.pos };
  for (let i = 0; i < 60 * 15; i++) {
    g.tick(1 / 60);
    moved += dist(last, g.auditor.pos);
    last = { ...g.auditor.pos };
  }
  check('Đi tuần lại ra khu bán hàng', moved > 8 && g.auditor.pos.z > 6, `${moved.toFixed(1)} m, z=${g.auditor.pos.z.toFixed(1)}`);
  check('Bắt người tiếp theo sẽ đặt ở ô sau', g.auditor.storeIndex === 2 && g.storedCount === 2);
}

// 11. Phiếu việc phát sinh: xong việc được giao rồi ngồi chờ thì vẫn bị ghi hồ sơ
{
  // Ngồi yên cả ca ở máy chấm công (kiểm kê viên không vào kho), việc được giao coi như xong hết
  const g = mkGame('Thử', { seed: 21, events: { auditorStart: 999 } });
  g.player.pos = { x: 3.5, z: 1.2 };
  g.devCompleteJobs();
  let issued = 0;
  let lateEv = 0;
  let maxDrift = 0;
  let ev: Evaluation | null = null;
  for (let i = 0; i < 60 * 420 && !ev; i++) {
    g.tick(1 / 60);
    maxDrift = Math.max(maxDrift, g.shift.drift);
    for (const e of g.events) {
      if (e.type === 'order') issued++;
      if (e.type === 'orderLate') lateEv++;
      if (e.type === 'eval') ev = e.ev;
    }
    g.events.length = 0;
  }
  check('Đêm 1 giao 2 phiếu phát sinh trong ca (vừa sức)', issued === 2, String(issued));
  check('Bỏ mặc thì phiếu quá hạn', lateEv === issued, `${lateEv}/${issued}`);
  check('Bỏ mặc thì sổ lệch', maxDrift > 0.25, maxDrift.toFixed(2));
  check('Xong việc được giao nhưng trễ phiếu thì bị ghi hồ sơ (chưa đủ 3 lần thì chưa bấm lỗ)',
    !!ev && ev.late === 2 && ev.records.length === 2 && ev.recordsTotal === 2 && ev.holesAdded === 0, ev ? `${ev.records.join(' | ')} · lỗ ${ev.holesAdded}` : '');
  check('Sổ lệch thì Người Kiểm Kê nghe thính hơn', g.auditor.drift > 0.2);
  // Đêm sau trễ thêm 1 phiếu: đủ 3 lần ghi = 1 lỗ
  g.nextNight();
  g.player.pos = { x: 3.5, z: 1.2 };
  g.devCompleteJobs();
  const o2 = g.issueOrder('rescan')!;
  g.shift.minutes = o2.due + 1;
  g.events.length = 0;
  g.tick(0.01);
  g.shift.minutes = 479.9;
  g.tick(0.2);
  const ev2 = g.events.find((e) => e.type === 'eval');
  check('Đủ 3 lần ghi hồ sơ thì bấm 1 lỗ', ev2?.type === 'eval' && ev2.ev.recordHoles === 1 && ev2.ev.holesAdded === 1 && g.records === 0, ev2?.type === 'eval' ? ev2.ev.reasons.join(' | ') : '');
}
{
  // Làm phiếu đúng hạn
  const g = mkGame('Thử', { seed: 22, events: { ordersBase: 0, ordersPerNight: 0 } });
  const r = g.issueOrder('restock')!;
  check('Phiếu xếp hàng: kệ thành thiếu hàng, thêm thùng', g.shift.restockNeeded.has(r.section!) && g.shift.pile === jobCounts(1).restock + 2);
  g.shift.drift = 0.3;
  g.takeBox();
  g.restock(r.section!);
  check('Xếp hàng xong thì phiếu xong, sổ bớt lệch', r.done && !r.late && g.shift.drift < 0.3, g.shift.drift.toFixed(2));
  const sec = SECTIONS.find((s) => !g.shift.restockNeeded.has(s.id))!;
  g.scanSection(sec.id);
  const rs = g.issueOrder('rescan')!;
  check('Phiếu kiểm lại: chọn kệ đã quét, quét lại được', rs.kind === 'rescan' && rs.section === sec.id && !g.shift.scanned.has(sec.id));
  const rsr = g.scanSection(sec.id);
  check('Kiểm lại xong thì xong phiếu', rsr.ok && !!rsr.order && rs.done);
  const d = g.issueOrder('deliver')!;
  check('Đơn gấp: phải mang thùng ra quầy', g.deliveryOpen && !g.deliver().ok);
  g.takeBox();
  check('Đơn gấp: giao ở quầy thì xong phiếu', g.deliver().ok && d.done && !g.deliveryOpen);
  check('Không có đơn thì không giao được', !g.deliver().ok);
}
{
  // Phiếu khen: xong hết việc, không trễ, không ghi hồ sơ, có mặt 06:00; xoá lỗ đêm sau
  const g = mkGame('Thử', { seed: 23, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  g.player.pos = { x: 3.5, z: 1.2 }; // ở máy chấm công
  g.devCompleteJobs();
  g.shift.minutes = 479.9;
  g.tick(0.2);
  const e1 = g.events.find((e) => e.type === 'eval');
  check('Xong hết việc, không trễ thì nhận phiếu khen', e1?.type === 'eval' && e1.ev.voucherEarned && g.voucher);
  g.nextNight();
  g.player.pos = { x: 3, z: 3 }; // vắng điểm danh, còn việc chưa xong: 2 lỗ, phiếu khen xoá 1
  g.shift.minutes = 479.9;
  g.events.length = 0;
  g.tick(0.2);
  const e2 = g.events.find((e) => e.type === 'eval');
  check('Phiếu khen xoá 1 lỗ', e2?.type === 'eval' && e2.ev.voucherUsed && e2.ev.holesAdded === 1 && !g.voucher, e2?.type === 'eval' ? String(e2.ev.holesAdded) : '');
}

// 12. Ném lon thì phải nhặt lại, không sẽ bị trừ lương
{
  const mk = () => {
    const g = mkGame('Thử', { seed: 31, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
    g.player.pos = { x: 3.5, z: 1.2 }; // đứng ở máy chấm công
    g.devCompleteJobs();
    return g;
  };
  const endOf = (g: Game) => {
    g.shift.minutes = 479.9;
    g.events.length = 0;
    g.tick(0.2);
    const e = g.events.find((x) => x.type === 'eval');
    return e?.type === 'eval' ? e.ev : null;
  };
  const g = mk();
  const a = g.dropLitter({ x: 10, z: 11 });
  g.dropLitter({ x: 12, z: 14 });
  check('Ném lon: nằm trên sàn chờ nhặt', g.shift.litter.length === 2 && g.shift.stats.cans === 2);
  check('Nhặt lại được', g.pickUpLitter(a).ok && g.shift.litter.length === 1 && !g.pickUpLitter(a).ok);
  const ev = endOf(g);
  check('Còn 1 lon: trừ phí dọn vào lương', !!ev && ev.litterFee === LITTER_FEE && ev.wage === WAGE_PER_NIGHT - LITTER_FEE && ev.holesAdded === 0, ev ? `${ev.wage}đ` : '');
  const clean = mk();
  const b = clean.dropLitter({ x: 10, z: 11 });
  clean.pickUpLitter(b);
  const ev2 = endOf(clean);
  check('Nhặt hết thì không bị trừ', !!ev2 && ev2.litterFee === 0 && ev2.wage === WAGE_PER_NIGHT && ev2.holesAdded === 0);
  const d = mk();
  for (let i = 0; i < 5; i++) d.dropLitter({ x: 10 + i, z: 11 });
  d.player.pos = { x: 3, z: 3 };
  for (let i = 0; i < 60 * 20; i++) d.tick(1 / 60);
  const ctl = mk();
  ctl.player.pos = { x: 3, z: 3 };
  for (let i = 0; i < 60 * 20; i++) ctl.tick(1 / 60);
  check('Lon để lại chỉ bị trừ lương, không làm lệch sổ', Math.abs(d.shift.drift - ctl.shift.drift) < 1e-9, `${d.shift.drift.toFixed(3)} = ${ctl.shift.drift.toFixed(3)}`);
}

// 13. Xếp hàng vào tủ lạnh: thùng hàng lạnh lấy ở kho lạnh
{
  const g = mkGame('Thử', { seed: 41, events: { ordersBase: 0, ordersPerNight: 0 } });
  const s = g.shift;
  check('Đêm 1: 1 tủ lạnh hết hàng, 2 thùng hàng lạnh', s.coldNeeded.size === 1 && s.coldPile === 2, `${s.coldNeeded.size}, ${s.coldPile}`);
  const [unit] = [...s.coldNeeded];
  const shelf = [...s.restockNeeded][0];
  g.takeBox();
  check('Thùng hàng khô không bỏ vào tủ lạnh', !g.restockCold(unit).ok && s.coldNeeded.has(unit));
  g.dropBox();
  check('Thả thùng khô thì trả về kho', g.player.carry === null && s.pile === jobCounts(1).restock + 1);
  g.takeColdBox();
  check('Thùng hàng lạnh không xếp lên kệ khô', !g.restock(shelf).ok && s.restockNeeded.has(shelf));
  const r = g.restockCold(unit);
  check('Xếp hàng lạnh vào tủ được giao thì xong việc', r.ok && !!r.job && !s.coldNeeded.has(unit) && g.player.carry === null, r.msg);
  check('Tủ không hết hàng thì không xếp được', !g.restockCold(unit).ok);
  g.takeColdBox();
  g.dropBox();
  check('Thả thùng lạnh thì trả về kho lạnh', s.coldPile === 1, String(s.coldPile));
  const o = g.issueOrder('coldRestock')!;
  check('Phiếu "tủ lạnh hết hàng": tủ hết hàng, thêm thùng lạnh', o.kind === 'coldRestock' && s.coldNeeded.has(o.section!) && s.coldPile === 2);
  g.takeColdBox();
  g.restockCold(o.section!);
  check('Xếp xong thì phiếu xong', o.done && !o.late);
}

// 14. Khu lấy hàng: trong kho / kho lạnh không bị nhìn thấy, không bị đếm; nghe tiếng thì chỉ tới cửa ngó vào
{
  const kho = ROOMS.find((r) => r.name === 'KHO')!;
  const inside = { x: kho.door.x, z: 5.5 };
  check('Trong kho là khu an toàn', inSafeRoom(inside) && inSafeRoom({ x: 14.5, z: 3 }) && !inSafeRoom({ x: 25, z: 3 }));
  const a = new Auditor(tuningForNight(3), mulberry32(4));
  a.state = 'search';
  a.pos = { x: kho.door.x, z: 8.6 };
  a.heading = a.beam = Math.PI; // đứng ở cửa kho nhìn thẳng vào trong
  for (let i = 0; i < 60 * 3; i++) a.update(1 / 60, inside, true);
  check('Đứng trong kho: nhìn thẳng vào vẫn không đếm được', (a.state as string) !== 'count' && !a.capturing, a.state);
  const b = new Auditor(tuningForNight(3), mulberry32(4));
  b.state = 'search';
  b.pos = { x: kho.door.x, z: 10.0 };
  b.heading = b.beam = Math.PI;
  b.update(1 / 60, { x: kho.door.x, z: 7.9 }, true); // đứng ngoài cửa kho: bị thấy
  check('Ra khỏi kho thì bị thấy', (b.state as string) === 'count', b.state);
  const c = new Auditor(tuningForNight(3), mulberry32(4));
  c.state = 'search';
  c.pos = { x: 20, z: 9 };
  const s = c.hear({ x: 4, z: 3 }, 1000, 0.5);
  check('Nghe tiếng trong kho: chỉ tới trước cửa kho', !!s && !roomAt(s) && Math.abs(s.x - kho.door.x) < 0.01, s ? `${s.x}, ${s.z}` : '');
}

// 15. Đầu đêm: bắt đầu ở phòng nghỉ, phải chạy tới máy chấm công trong kho để vào ca
{
  check('Bắt đầu đêm trong PHÒNG NGHỈ', roomAt(PLAYER_SPAWN)?.name === 'PHÒNG NGHỈ');
  check('Người Kiểm Kê có phòng riêng, khác văn phòng', roomAt(AUDITOR_SPAWN)?.name === 'PHÒNG KIỂM KÊ');
  const g = new Game('Thử', 31);
  const sec = SECTIONS.find((x) => !g.shift.restockNeeded.has(x.id))!;
  check('Chưa chấm công thì chưa làm việc được', !g.scanSection(sec.id).ok);
  g.tick(1 / 60);
  g.player.pos = { x: (CLOCK_ZONE.minX + CLOCK_ZONE.maxX) / 2, z: 1.2 };
  g.events.length = 0;
  g.tick(1 / 60);
  check('Tới máy chấm công thì vào ca', g.player.clockedIn && g.events.some((e) => e.type === 'clockIn' && !e.late));
  check('Vào ca rồi thì làm việc được', g.scanSection(sec.id).ok);
  // Đi trễ
  const late = new Game('Thử', 32);
  late.player.pos = { ...PLAYER_SPAWN };
  late.shift.minutes = late.eventCfg.clockInBy + 5;
  late.tick(1 / 60);
  late.player.pos = { x: 3.5, z: 1.2 };
  late.tick(1 / 60);
  check('Chấm công sau hạn: ghi nhận trễ', late.player.clockedIn && late.player.lateIn);
  late.devCompleteJobs();
  late.shift.minutes = 479.9;
  late.tick(0.2);
  const ev = late.events.find((e) => e.type === 'eval');
  check('Chấm công trễ: bị ghi hồ sơ lúc 06:00', !!ev && ev.type === 'eval' && ev.ev.lateIn && ev.ev.records.some((t) => t.includes('trễ')), ev?.type === 'eval' ? ev.ev.records.join(' | ') : '');
  // Chạy kịp: từ phòng nghỉ tới máy chấm công
  const run = planPath(PLAYER_SPAWN, { x: 3.5, z: 1.2 });
  let len = 0;
  let cur: V2 = PLAYER_SPAWN;
  for (const q of run) {
    len += dist(cur, q);
    cur = q;
  }
  const secs = len / 3.8;
  check('Chạy từ phòng nghỉ tới máy chấm công kịp hạn', secs < late.eventCfg.clockInBy * 0.5625, `${len.toFixed(1)} m · ${secs.toFixed(1)} giây chạy`);
}

// 16. Hàng trên kệ: lấy, đặt lại, ăn uống (trừ đúng giá tiền), hàng lỗi (đau bụng, chóng mặt, máy quét báo, thùng HÀNG LỖI), thể lực
{
  const slots = shelfSlots();
  check('Hàng trên kệ: có hàng ở mọi đoạn kệ', SECTIONS.every((s) => slots.some((x) => x.section === s.id)), `${slots.length} món`);
  const sl = slots[123];
  const found = slotAt(sl.section, sl.x + 0.01, sl.y + 0.05);
  check('Nhắm vào món hàng thì tìm đúng ô', found?.key === sl.key, `${sl.key} → ${found?.key}`);
  check('Mọi món trên kệ đều có trong danh mục (giá, kích thước)', slots.every((x) => !!productById(x.product)));

  const g = mkGame('Thử', { seed: 51, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  const s = g.shift;
  check('Đêm 1 có 2 món hàng lỗi, đều nằm trong việc được giao', s.defects.size === 2 && s.defectsTotal === 2 && [...s.defects.keys()].every((k) => s.jobs.some((j) => j.kind === 'defect' && j.target === k)));
  check('Hàng lỗi không nằm ở kệ đang thiếu hàng', [...s.defects.keys()].every((k) => !s.restockNeeded.has(slotByKey(k)!.section)));
  const again = mkGame('Thử', { seed: 51, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  check('Cùng ca thì hàng lỗi cùng chỗ (không phụ thuộc máy)', [...again.shift.defects.keys()].join() === [...s.defects.keys()].join());

  // Lấy một món tốt, đặt lại
  const good = slots.find((x) => !s.defects.has(x.key) && !s.restockNeeded.has(x.section) && productById(x.product)!.kind === 'drink')!;
  check('Lấy món trên kệ', g.takeItem(good.key).ok && g.player.hand?.key === good.key && !g.slotFilled(good.key));
  check('Đang cầm thì không lấy thêm được', !g.takeItem(slots.find((x) => x.key !== good.key && g.slotFilled(x.key))!.key).ok);
  check('Đang cầm hàng thì không lấy thùng được', !g.takeBox());
  g.putBack();
  check('Đặt lại thì kệ đầy lại', g.player.hand === null && g.slotFilled(good.key));

  // Thể lực: chạy 15 giây thì cạn, không chạy được; uống một món thì hồi
  for (let i = 0; i < 15 * 10; i++) g.reportMotion(0.1, true, true);
  check('Chạy liên tục ~14 giây thì cạn thể lực', g.player.stamina === 0 && !g.canRun);
  g.takeItem(good.key);
  const drink = g.eat();
  check('Uống một món: hồi thể lực, chạy lại được', drink.ok && g.player.stamina >= 0.3 && g.canRun, `thể lực ${g.player.stamina.toFixed(2)}`);
  check('Món đã uống không còn trên kệ', !g.slotFilled(good.key));

  // Không ăn được hoá phẩm
  const other = slots.find((x) => productById(x.product)!.kind === 'other' && g.slotFilled(x.key) && !s.defects.has(x.key))!;
  g.takeItem(other.key);
  check('Hoá phẩm không ăn uống được', !g.eat().ok && g.player.hand?.key === other.key);
  check('Hàng tốt không bỏ vào thùng HÀNG LỖI được', !g.discardHeld().ok);
  g.putBack();

  // Máy quét báo hàng lỗi khi quét đoạn kệ có hàng lỗi
  const [k1, k2] = [...s.defects.keys()];
  const sec1 = slotByKey(k1)!.section;
  const scan = g.scanSection(sec1);
  check('Quét đoạn kệ có hàng lỗi: máy quét báo', scan.ok && scan.defects === 1 && /BÍP LỖI/.test(scan.msg), scan.msg);

  // Bỏ hàng lỗi vào thùng: xong việc
  g.takeItem(k1);
  check('Cầm lên thì biết là hàng lỗi', g.player.hand?.defect === s.defects.get(k1));
  const dis = g.discardHeld();
  check('Bỏ hàng lỗi vào thùng HÀNG LỖI: xong việc được giao', dis.ok && !!dis.job && s.defectsRemoved === 1 && !s.defects.has(k1));
  check('Bìa kẹp ghi rõ món, đoạn kệ, tầng của hàng lỗi', /tầng \d/.test(g.jobLabel(s.jobs.find((j) => j.kind === 'defect' && j.target === k2)!)));

  // Ăn phải hàng lỗi: đau bụng (chậm, rên), chóng mặt
  const k2slot = slotByKey(k2)!;
  if (productById(k2slot.product)!.kind === 'other') s.defects.set(good.key, 'het_han'); // đổi sang món ăn được nếu cần
  const badKey = productById(k2slot.product)!.kind === 'other' ? good.key : k2;
  if (badKey === good.key) s.taken.delete(good.key);
  g.takeItem(badKey);
  const bad = g.eat();
  check('Ăn phải hàng lỗi: đau bụng, chóng mặt, đi chậm', !bad.ok && g.player.sick > 0 && g.player.dizzy > 0 && g.speedMul < 1, bad.msg);
  g.events.length = 0;
  for (let i = 0; i < 100; i++) g.reportMotion(0.1, true, false);
  check('Đau bụng thì rên thành tiếng (gây tiếng động)', g.events.some((e) => e.type === 'groan') && g.events.some((e) => e.type === 'noise'));
  for (let i = 0; i < 400; i++) g.reportMotion(0.1, true, false);
  check('Hết đau bụng sau một lúc', g.player.sick === 0 && g.player.dizzy === 0 && g.speedMul === 1);

  // Xếp hàng lại đoạn kệ: hàng mới, không còn chỗ trống
  const emptySec = slotByKey(good.key)!.section;
  s.restockNeeded.add(emptySec);
  g.player.carry = 'dry';
  g.restock(emptySec);
  check('Xếp hàng lại đoạn kệ thì đầy lại', g.slotFilled(good.key));

  // 06:00: trừ đúng giá tiền vào lương
  const value = s.eaten.reduce((a, e) => a + e.price, 0);
  s.minutes = 479.9;
  g.tick(0.2);
  const ev = g.events.find((e) => e.type === 'eval');
  check(
    'Ăn hàng: lúc 06:00 trừ lương đúng giá tiền',
    !!ev && ev.type === 'eval' && ev.ev.eatenCount === s.eaten.length && ev.ev.eatenValue === value && ev.ev.wage === WAGE_PER_NIGHT - value,
    ev && ev.type === 'eval' ? `${ev.ev.eatenCount} món · ${value}đ · lương ${ev.ev.wage}đ` : '',
  );
  check('Ăn chưa quá 100.000đ thì không bị ghi hồ sơ', !!ev && ev.type === 'eval' && (value > EAT_RECORD_OVER) === ev.ev.records.some((t) => t.includes('Ăn')));
  check('Phiếu đánh giá ghi hàng lỗi còn trên kệ', !!ev && ev.type === 'eval' && ev.ev.defectsRemoved === 1 && ev.ev.defectsLeft === s.defects.size);
}

// 17. Kiện hàng cồng kềnh (2 người khiêng), đi rón rén, đang xem phiếu việc
{
  const g = mkGame('Thử', { seed: 77, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  const s = g.shift;
  const o = g.issueOrder('bulky');
  check('Phiếu khiêng kiện nước: có kiện nằm trong kho', !!o && s.bulky.length === 1 && inSafeRoom(s.bulky[0].pos), o ? orderText(o) : '');
  const b = s.bulky[0];
  check('Một mình cầm được một đầu', g.grabBulky(b.id).ok && g.player.bulky === b.id && b.carriers.length === 1);
  check('Đang khiêng thì không lấy thùng được', !g.takeBox());
  check('Một mình kéo lê: rất chậm, không chạy', g.bulkySpeed !== null && g.bulkySpeed <= 0.8 + 1e-9);
  // Kéo lê một mình: ken két, Người Kiểm Kê nghe xa
  g.player.pos = { x: 6, z: 5 };
  g.player.yaw = Math.PI / 2;
  g.events.length = 0;
  for (let i = 0; i < 30; i++) g.reportMotion(0.1, true, false);
  const soloNoise = g.events.filter((e) => e.type === 'noise').map((e) => (e.type === 'noise' ? e.radius : 0));
  check('Kéo lê một mình: kêu ken két, nghe xa', g.events.some((e) => e.type === 'scrape') && soloNoise.length >= 3 && Math.max(...soloNoise) >= 9, `${soloNoise.length} lần · ${Math.max(...soloNoise)} m`);
  check('Kiện đi theo trước mặt người khiêng', Math.abs(b.pos.x - (6 + 0.9)) < 1e-6 && Math.abs(b.pos.z - 5) < 1e-6, `${b.pos.x.toFixed(2)}, ${b.pos.z.toFixed(2)}`);
  // Đi rón rén: kéo lê nhỏ tiếng hơn, chậm hơn
  g.events.length = 0;
  for (let i = 0; i < 30; i++) g.reportMotion(0.1, true, false, true);
  const sneakNoise = g.events.filter((e) => e.type === 'noise').map((e) => (e.type === 'noise' ? e.radius : 0));
  check('Đi rón rén (giữ C): kéo lê nhỏ tiếng hơn, chậm hơn', g.player.sneak && Math.max(...sneakNoise) < 9 && g.bulkySpeed! < 0.8);
  // Người thứ hai cầm đầu kia
  check('Người thứ hai cầm đầu kia', g.grabBulky(b.id, 'p2').ok && b.carriers.length === 2);
  check('Không quá 2 người', !g.grabBulky(b.id, 'p3').ok);
  check('Hai người khiêng: nhanh gấp đôi', g.bulkySpeed !== null && Math.abs(g.bulkySpeed - 1.6 * 0.7) < 1e-9, `${g.bulkySpeed}`);
  g.events.length = 0;
  for (let i = 0; i < 30; i++) g.reportMotion(0.1, true, false, false);
  const duoNoise = g.events.filter((e) => e.type === 'noise').map((e) => (e.type === 'noise' ? e.radius : 0));
  check('Hai người khiêng: êm (không ken két, tiếng nhỏ)', !g.events.some((e) => e.type === 'scrape') && duoNoise.every((r) => r <= 3));
  // Đặt sai chỗ, buông, cầm lại, đặt đúng chỗ
  check('Chưa tới ĐẢO KHUYẾN MÃI thì không đặt được', !g.placeBulky().ok);
  g.releaseBulky('p2');
  g.events.length = 0;
  g.releaseBulky();
  check('Buông hết tay: kiện rơi phịch (ồn), nằm lại chỗ đó', g.player.bulky === null && !b.carriers.length && g.events.some((e) => e.type === 'thud'));
  g.grabBulky(b.id);
  g.player.pos = { x: 24.4, z: 31.0 };
  g.player.yaw = 0;
  g.reportMotion(0.1, false, false);
  const r = g.placeBulky();
  check('Đặt kiện ở ĐẢO KHUYẾN MÃI: xong phiếu', r.ok && !!r.order && b.done && !!o?.done && g.player.bulky === null, r.msg);
  check('Đang xem phiếu việc: lõi game biết (để gửi cho người chơi khác)', (() => { g.player.sheet = true; return g.player.sheet; })());
}

// 18. Gom rác, xe đẩy hàng / xe rác, sửa điện, cửa phòng kiểm kê, giãn cách việc nặng
{
  // Gom rác: xách tay tối đa 2 túi, xe rác gom hết một lượt, đổ vào thùng rác lớn là xong việc
  const g = mkGame('Thử', { seed: 81, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  const s = g.shift;
  check('Đầu ca mọi thùng rác đầy, có việc gom rác', s.trashFull.size === TRASH_BINS.length && s.jobs.some((j) => j.kind === 'trash'));
  check('Xách tay túi rác 1', g.takeTrash(0).ok && g.player.bags === 1);
  check('Xách tay túi rác 2', g.takeTrash(1).ok && g.player.bags === 2);
  check('Xách tay tối đa 2 túi', !g.takeTrash(2).ok && s.trashFull.has(2));
  check('Thùng đã gom thì không gom nữa', !g.takeTrash(0).ok);
  check('Đang xách rác thì không lấy thùng hàng', !g.takeBox());
  const d1 = g.dumpTrash();
  check('Đổ 2 túi: chưa xong việc (còn thùng chưa gom)', d1.ok && !d1.job && g.player.bags === 0 && s.trashDumped === 2);
  const rac = s.carts.find((c) => c.kind === 'rac')!;
  check('Đẩy xe rác', g.grabCart(rac.id).ok && g.player.cart === rac.id);
  for (const i of [2, 3, 4]) g.takeTrash(i);
  check('Xe rác gom một lượt nhiều túi', rac.bags === 3 && s.trashFull.size === 0 && g.player.bags === 0);
  check('Đẩy xe thì chậm hơn, không chạy', g.carrySpeed !== null && g.carrySpeed <= 2.0);
  g.player.yaw = 0;
  g.events.length = 0;
  for (let i = 0; i < 30; i++) g.reportMotion(0.1, true, false);
  check('Xe đẩy lạch cạch (gây tiếng động)', g.events.some((e) => e.type === 'rattle') && g.events.some((e) => e.type === 'noise'));
  const d2 = g.dumpTrash();
  check('Đổ hết túi rác: xong việc gom rác', d2.ok && !!d2.job && s.jobs.find((j) => j.kind === 'trash')!.done && rac.bags === 0, d2.msg);
  g.releaseCart();
  check('Buông xe thì xe nằm lại', g.player.cart === null && rac.pusher === null);

  // Xe đẩy hàng: chở kiện nước một mình, chở 3 thùng xếp kệ
  const h = mkGame('Thử', { seed: 82, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  const hs = h.shift;
  const cart = hs.carts.find((c) => c.kind === 'hang')!;
  const o = h.issueOrder('bulky')!;
  const b = hs.bulky[0];
  check('Đẩy xe hàng', h.grabCart(cart.id).ok);
  check('Chất kiện nước lên xe', h.loadBulky(b.id).ok && cart.bulky === b.id && b.cart === cart.id);
  check('Chở kiện bằng xe: một người cũng đi được, nhanh hơn kéo lê', h.carrySpeed !== null && h.carrySpeed > 0.8 && h.carrySpeed < 1.6, String(h.carrySpeed));
  h.player.pos = { x: 25, z: 30.6 };
  h.player.yaw = 0;
  h.reportMotion(0.1, false, false);
  check('Kiện đi theo xe', Math.abs(b.pos.z - cart.pos.z) < 1e-6 && Math.abs(b.pos.x - cart.pos.x) < 1e-6);
  const pr = h.placeBulky();
  check('Đặt kiện từ xe ở ĐẢO KHUYẾN MÃI: xong phiếu', pr.ok && b.done && o.done && cart.bulky === null, pr.msg);
  const pile0 = hs.pile;
  h.takeBox();
  h.takeBox();
  check('Chất thùng hàng khô lên xe', cart.boxes === 2 && hs.pile === pile0 - 2 && h.player.carry === null);
  const sec = [...hs.restockNeeded][0];
  const rr = h.restock(sec);
  check('Xếp kệ bằng thùng trên xe', rr.ok && cart.boxes === 1 && !hs.restockNeeded.has(sec), rr.msg);
  h.releaseCart();

  // Sửa điện: bật cầu dao đúng thứ tự trên sơ đồ, sai thì tóe lửa (ồn) và làm lại
  const p = mkGame('Thử', { seed: 83, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999, blackoutAuto: false } });
  p.shift.minutes = 100;
  p.devSetPower(false);
  p.tick(0.01);
  check('Mất điện: có sơ đồ cầu dao (thứ tự khác vị trí)', !p.power && !!p.breaker && p.breaker.order.length === 6 && p.breaker.slots.length === 6);
  const bp = p.breaker!;
  const wrong = bp.slots.findIndex((n) => n !== bp.order[0]);
  p.events.length = 0;
  const w = p.flipBreaker(wrong);
  check('Bật sai thứ tự: tóe lửa, ồn, nhảy hết', !w.ok && bp.next === 0 && p.events.some((e) => e.type === 'breaker' && !e.ok) && p.events.some((e) => e.type === 'noise' && e.radius >= 10));
  check('Chưa bật đủ thì cầu dao tổng nhảy lại', !p.mainSwitch().ok && !p.power);
  for (const name of bp.order) p.flipBreaker(bp.slots.indexOf(name));
  check('Bật đủ cầu dao nhánh đúng thứ tự', bp.next === 6 && bp.on.every(Boolean));
  const ms = p.mainSwitch();
  check('Gạt cầu dao tổng: có điện lại', ms.ok && p.power && p.breaker === null);
  const po = mkGame('Thử', { seed: 84, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  po.devGoNight(2);
  const bo = po.blackouts[0];
  po.shift.minutes = bo.start + 0.5;
  po.tick(0.01);
  check('Mất điện theo lịch: giao phiếu sửa điện', !po.power && po.shift.orders.some((x) => x.kind === 'power'));
  po.shift.minutes = bo.end + 5;
  po.tick(0.01);
  check('Không sửa thì vẫn tối sau giờ mất điện (phải tự sửa)', !po.power);
  po.shift.minutes = bo.start + 2 * (bo.end - bo.start) + 1;
  po.tick(0.01);
  check('Lâu quá thì máy phát dự phòng chạy, phiếu sửa điện quá hạn', po.power && po.shift.orders.find((x) => x.kind === 'power')!.late);

  // Cửa phòng kiểm kê khoá với người chơi, Người Kiểm Kê vẫn đi qua
  const door = { x: ROOMS.find((r) => r.name === 'PHÒNG KIỂM KÊ')!.door.x, z: STORE.backZ };
  check('Cửa PHÒNG KIỂM KÊ chặn người chơi', PLAYER_SOLIDS.some((bx) => door.x > bx.minX && door.x < bx.maxX && door.z >= bx.minZ && door.z <= bx.maxZ));
  check('…nhưng không chặn Người Kiểm Kê', !SOLIDS.some((bx) => door.x > bx.minX && door.x < bx.maxX && door.z >= bx.minZ && door.z <= bx.maxZ));
  const out = planPath(AUDITOR_SPAWN, { x: door.x, z: 10 });
  check('Người Kiểm Kê đi ra khỏi phòng được', out.length > 0);

  // Giãn cách việc nặng: không giao hai việc nặng sát nhau
  const sp = mkGame('Thử', { seed: 85, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  sp.devGoNight(3);
  const heavyTimes: number[] = [];
  for (let t = 40; t < 440; t += 5) {
    sp.shift.minutes = t;
    // gọi đúng đường chọn loại phiếu của lịch giao phiếu
    const kind = (sp as unknown as { pickOrderKind(): string }).pickOrderKind();
    if (kind !== 'rescan' && kind !== 'power') {
      const oo = sp.issueOrder(kind as never);
      if (oo) {
        heavyTimes.push(t);
        oo.done = true; // làm xong ngay để không chặn việc nặng kế tiếp
      }
    }
  }
  const gaps = heavyTimes.slice(1).map((t, i) => t - heavyTimes[i]);
  check('Việc nặng được giao cách nhau ít nhất 70 phút', gaps.every((x) => x >= 70), heavyTimes.join(','));
}

console.log(failed ? `\n${failed} kiểm tra thất bại.` : '\nTất cả kiểm tra đều đạt.');
if (failed) throw new Error('sim-smoke failed');
