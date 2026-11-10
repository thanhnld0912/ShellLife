// Kiểm tra nhanh logic game, không cần trình duyệt: npm run sim:test
import { Game } from '../src/sim/game.ts';
import { ROUTE, pathClear, planPath, hasLOS } from '../src/sim/auditor.ts';
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
  g.scanSection(SECTIONS[0].id);
  g.scanSection(SECTIONS[0].id);
  check('Không quét một kệ hai lần', g.shift.cong === g.shift.safeCap + 2, String(g.shift.cong));
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

console.log(failed ? `\n${failed} kiểm tra thất bại.` : '\nTất cả kiểm tra đều đạt.');
if (failed) throw new Error('sim-smoke failed');
