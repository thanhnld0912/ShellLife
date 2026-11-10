// Kiểm tra nhanh logic game, không cần trình duyệt: npm run sim:test
import { Game } from '../src/sim/game.ts';
import { Auditor, ROUTE, beamReach, pathClear, planPath, hasLOS, tuningForNight } from '../src/sim/auditor.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import { AUDITOR_DOOR, AUDITOR_SPAWN, SECTIONS } from '../src/sim/layout.ts';
import { dist } from '../src/sim/geometry.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  if (!ok) failed++;
}

// 1. Lộ trình tuần tra đi được
let routeOk = pathClear(AUDITOR_SPAWN, AUDITOR_DOOR);
for (let i = 0; i + 1 < ROUTE.length; i++) routeOk &&= pathClear(ROUTE[i], ROUTE[i + 1]);
check('Lộ trình tuần tra không xuyên vật cản', routeOk);
check('Có 16 đoạn kệ', SECTIONS.length === 16, String(SECTIONS.length));

// 2. Tìm đường tới các điểm khó
const targets = [{ x: 10, z: 14.4 }, { x: 22, z: 23 }, { x: 3, z: 21.5 }, { x: 16, z: 7.2 }];
for (const t of targets) {
  const p = planPath({ x: 2.5, z: 7.5 }, t);
  const end = p[p.length - 1];
  check(`Tìm đường tới (${t.x}, ${t.z})`, p.length > 0 && dist(end, t) < 1.5, `${p.length} điểm`);
}

// 3. Kệ che tầm nhìn
check('Kệ che tầm nhìn giữa hai làn', !hasLOS({ x: 10, z: 11.1 }, { x: 10, z: 14.4 }));
check('Cùng làn thì nhìn thấy', hasLOS({ x: 3, z: 11.1 }, { x: 15, z: 11.1 }));
{
  const r = beamReach({ x: 10, z: 11.1 }, Math.PI, 9); // chĩa về phía bắc, dãy kệ 1 ở z 9..10
  check('Tia quét dừng ở mặt kệ', Math.abs(r - 1.1) < 0.05, r.toFixed(2));
  check('Tia quét dọc làn đi hết tầm', beamReach({ x: 3, z: 11.1 }, Math.PI / 2, 9) === 9);
}

// 4. Một ca: Người Kiểm Kê xuất hiện, đi tuần, không ai ở trong tầm thì không bị bắt
{
  const g = new Game('Thử', 42);
  g.player.pos = { x: 21.5, z: 23.2 };
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
  const g = new Game('Thử', 7);
  g.player.pos = { x: 22.5, z: 23.4 };
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60); // đợi nó ra khỏi kho
  const before = g.auditor.state;
  g.noise({ x: g.auditor.pos.x + 4, z: g.auditor.pos.z }, 10, 2);
  check('Nghe tiếng động gần', g.auditor.state === 'alert', `${before} → ${g.auditor.state}`);
  for (let i = 0; i < 60 * 2; i++) g.tick(1 / 60);
  check('Chuyển sang đi điều tra', ['investigate', 'search', 'count'].includes(g.auditor.state), g.auditor.state);
  const far = new Game('Thử', 8);
  for (let i = 0; i < 60 * 12; i++) far.tick(1 / 60);
  far.noise({ x: 23, z: 23.5 }, 2, 0.5);
  check('Không nghe tiếng thì thầm ở xa', far.auditor.state !== 'alert', far.auditor.state);
}

// 6. Đứng trước tia quét thì bị đếm và đóng thùng
{
  const g = new Game('Thử', 3);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60);
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

// 7. Chỉ tiêu: việc an toàn chỉ tính nửa
{
  const g = new Game('Thử', 1);
  g.shift.minutes = 60;
  g.freezer();
  g.shift.minutes = 180;
  g.freezer();
  g.shift.minutes = 300;
  g.freezer();
  g.shift.minutes = 420;
  g.freezer();
  check('Việc an toàn bị giới hạn ở nửa chỉ tiêu', g.shift.cong === g.shift.safeCap, `${g.shift.cong}/${g.shift.quota}`);
  const full = SECTIONS.find((s) => !g.shift.restockNeeded.has(s.id))!;
  const empty = SECTIONS.find((s) => g.shift.restockNeeded.has(s.id))!;
  check('Kệ thiếu hàng thì không quét được', !g.scanSection(empty.id).ok);
  g.scanSection(full.id);
  g.scanSection(full.id);
  check('Không quét một kệ hai lần', g.shift.cong === g.shift.safeCap + 2, String(g.shift.cong));
  g.restock(empty.id);
  check('Xếp hàng xong thì quét được', g.scanSection(empty.id).ok);
}

// 8. Hết ca: thiếu chỉ tiêu và vắng điểm danh thì bị 2 lỗ
{
  const g = new Game('Thử', 5);
  g.player.pos = { x: 3, z: 3 }; // đứng trong kho, kiểm kê viên không vào kho
  g.shift.minutes = 479.9;
  g.tick(0.2);
  const ev = g.events.find((e) => e.type === 'eval');
  check('Hết ca thì có phiếu đánh giá', !!ev);
  if (ev && ev.type === 'eval') check('Thiếu chỉ tiêu + vắng điểm danh = 2 lỗ', ev.ev.holesAdded === 2, String(ev.ev.holesAdded));
}

// 6. Mất điện: nghe tiếng động thì CHẠY tới; ánh đèn pin trong tầm mắt làm nó chú ý
{
  const g = new Game('Thử', 7);
  g.player.pos = { x: 22.5, z: 23.4 };
  check('Đêm 1 không mất điện', g.blackout === null);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60);
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
    a.pos = { x: 3, z: 11.1 };
    a.heading = Math.PI / 2 - 1.0; // người chơi lệch 1 rad: ngoài tia quét, trong tầm mắt
    a.blackout = true;
    return a;
  };
  const target = { x: 10, z: 11.1 };
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

console.log(failed ? `\n${failed} kiểm tra thất bại.` : '\nTất cả kiểm tra đều đạt.');
if (failed) throw new Error('sim-smoke failed');
