// Kiểm tra nhanh logic game, không cần trình duyệt: npm run sim:test
import { Game, type Evaluation } from '../src/sim/game.ts';
import { Auditor, ROUTE, beamReach, pathClear, planPath, hasLOS, tuningForNight } from '../src/sim/auditor.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import { AUDITOR_DOOR, AUDITOR_SPAWN, COLD_UNITS, SECTIONS, SHELVES, storageSlot } from '../src/sim/layout.ts';
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
check('Có 24 đoạn kệ (6 dãy)', SECTIONS.length === 24, String(SECTIONS.length));

// 2. Tìm đường tới các điểm khó: giữa hai dãy kệ, góc quầy, làn tây, khu hàng lạnh giữa hai đảo tủ đông,
//    sau đảo tủ đông, sát ngăn mát tường đông, cửa kho lạnh
const lane = (i: number) => (SHELVES[i].box.maxZ + SHELVES[i + 1].box.minZ) / 2;
const targets = [
  { x: 12, z: lane(2) }, { x: 28.5, z: 27.2 }, { x: 3, z: 24 }, { x: 30, z: 16 },
  { x: 30, z: 20.4 }, { x: 34.2, z: 15 }, { x: 16.5, z: 8.2 },
];
for (const t of targets) {
  const p = planPath({ x: 3, z: 8.6 }, t);
  const end = p[p.length - 1];
  check(`Tìm đường tới (${t.x}, ${t.z.toFixed(1)})`, p.length > 0 && dist(end, t) < 1.5, `${p.length} điểm`);
}

// 3. Kệ che tầm nhìn
check('Kệ che tầm nhìn giữa hai làn', !hasLOS({ x: 12, z: lane(0) }, { x: 12, z: lane(1) }));
check('Cùng làn thì nhìn thấy', hasLOS({ x: 3, z: lane(0) }, { x: 20, z: lane(0) }));
{
  const r = beamReach({ x: 12, z: lane(0) }, Math.PI, 9); // chĩa về phía bắc, gặp mặt nam của dãy 1
  const want = lane(0) - SHELVES[0].box.maxZ;
  check('Tia quét dừng ở mặt kệ', Math.abs(r - want) < 0.05, `${r.toFixed(2)} / ${want.toFixed(2)}`);
  check('Tia quét dọc làn đi hết tầm', beamReach({ x: 3, z: lane(0) }, Math.PI / 2, 9) === 9);
}
check('Tủ đông nằm thấp: không che tầm nhìn', hasLOS({ x: 30, z: 11.75 }, { x: 30, z: 14.75 }));
check('Ngăn mát mở cao: che tầm nhìn', !hasLOS({ x: 34.2, z: 15 }, { x: 36.5, z: 15 }));
check(`Có ${COLD_UNITS.length} tủ lạnh bán hàng`, COLD_UNITS.length === 18 + 12 + 6);

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

// 9. Bảng sự kiện: điều khiển tay
{
  const g = new Game('Thử', { seed: 11, events: { auditorStart: 0 } });
  g.tick(1 / 60);
  check('Lịch: Người Kiểm Kê vào lúc 22:00', g.auditor.state !== 'idle', g.auditor.state);
  g.devAuditorRest();
  check('Cho về kho nghỉ', g.auditor.state === 'idle');
  for (let i = 0; i < 60; i++) g.tick(1 / 60);
  check('Về nghỉ thì không tự vào lại theo lịch', g.auditor.state === 'idle');
  g.devLure({ x: 10, z: 11.1 });
  check('Dụ tới: gọi vào và nghe thấy', g.auditor.state === 'alert', g.auditor.state);

  const n1 = new Game('Thử', 12);
  check('Đêm 1 mặc định không mất điện', n1.blackout === null);
  const n1b = new Game('Thử', { seed: 12, events: { blackoutFromNight: 1, blackoutMinutes: 40 } });
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
  check('Nhảy tới đêm 3', n1.night === 3 && n1.shift.quota === 10 && n1.events.some((e) => e.type === 'night'));
  check('Đêm 3 dùng thông số đêm 3', Math.abs(n1.auditor.tune.speed - tuningForNight(3).speed) < 1e-9);

  n1.setTuning({ range: 4, countTime: 3 });
  check('Ghi đè thông số có hiệu lực ngay', n1.auditor.tune.range === 4 && n1.auditor.tune.countTime === 3);
  n1.nextNight();
  check('Ghi đè giữ qua đêm sau', n1.auditor.tune.range === 4);
  n1.resetTuning();
  check('Khôi phục thông số mặc định', n1.auditor.tune.range === tuningForNight(n1.night).range);

  // Không chết + tàng hình
  const nd = new Game('Thử', 3);
  for (let i = 0; i < 60 * 12; i++) nd.tick(1 / 60);
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
  const inv = new Game('Thử', 3);
  for (let i = 0; i < 60 * 12; i++) inv.tick(1 / 60);
  inv.dev.invisible = true;
  const b = inv.auditor;
  inv.player.pos = { x: b.pos.x + Math.sin(b.beam) * 2, z: b.pos.z + Math.cos(b.beam) * 2 };
  for (let i = 0; i < 60 * 3; i++) inv.tick(1 / 60);
  check('Tàng hình: đứng trước tia quét không bị đếm', inv.phase === 'shift' && inv.auditor.state !== 'count', inv.auditor.state);
}

// 10. Cảnh đóng thùng: lao tới → nhét vào thùng → bê về kho → đặt xuống → đi tuần tiếp
{
  const g = new Game('Lan', 3);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60);
  const a = g.auditor;
  // Đứng xa 4 m trước tia quét để thấy nó lao tới
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

// 11. Phiếu việc: đủ chỉ tiêu rồi ngồi chờ thì vẫn bị phạt
{
  // Ngồi yên cả ca trong kho (kiểm kê viên không vào kho), chỉ tiêu được cộng cho đủ
  const g = new Game('Thử', { seed: 21, events: { auditorStart: 999 } });
  g.player.pos = { x: 3, z: 3 };
  g.devAddCong(g.shift.quota);
  let issued = 0;
  let lateEv = 0;
  let maxDrift = 0;
  let ev: Evaluation | null = null;
  for (let i = 0; i < 60 * 280 && !ev; i++) {
    g.tick(1 / 60);
    maxDrift = Math.max(maxDrift, g.shift.drift);
    for (const e of g.events) {
      if (e.type === 'order') issued++;
      if (e.type === 'orderLate') lateEv++;
      if (e.type === 'eval') ev = e.ev;
    }
    g.events.length = 0;
  }
  check('Đêm 1 giao 4 phiếu việc trong ca', issued === 4, String(issued));
  check('Bỏ mặc thì phiếu quá hạn', lateEv === issued, `${lateEv}/${issued}`);
  check('Bỏ mặc thì sổ lệch nặng', maxDrift > 0.5, maxDrift.toFixed(2));
  check('Đủ chỉ tiêu nhưng trễ phiếu vẫn bị bấm lỗ', !!ev && ev.late === 4 && ev.reasons.some((r) => r.includes('Trễ hạn')), ev?.reasons.join(' | '));
  check('Sổ lệch thì Người Kiểm Kê nghe thính hơn', g.auditor.drift > 0.5);
}
{
  // Làm phiếu đúng hạn
  const g = new Game('Thử', { seed: 22, events: { ordersBase: 0, ordersPerNight: 0 } });
  const r = g.issueOrder('restock')!;
  check('Phiếu xếp hàng: kệ thành thiếu hàng, thêm thùng', g.shift.restockNeeded.has(r.section!) && g.shift.pile === g.shift.restockTotal + 1 - 0);
  g.shift.drift = 0.3;
  g.restock(r.section!);
  check('Xếp hàng xong thì phiếu xong, sổ bớt lệch', r.done && !r.late && g.shift.drift < 0.3, g.shift.drift.toFixed(2));
  const sec = SECTIONS.find((s) => !g.shift.restockNeeded.has(s.id))!;
  g.scanSection(sec.id);
  const rs = g.issueOrder('rescan')!;
  check('Phiếu kiểm lại: chọn kệ đã quét, quét lại được', rs.kind === 'rescan' && rs.section === sec.id && !g.shift.scanned.has(sec.id));
  const before = g.shift.cong;
  check('Kiểm lại xong được công', g.scanSection(sec.id).ok && rs.done && g.shift.cong === before + 2);
  const d = g.issueOrder('deliver')!;
  check('Đơn gấp: giao ở quầy được 3 công', g.deliveryOpen && g.deliver().ok && d.done && !g.deliveryOpen);
  check('Không có đơn thì không giao được', !g.deliver().ok);
}
{
  // Phiếu khen: vượt 150% chỉ tiêu, xoá lỗ đêm sau
  const g = new Game('Thử', { seed: 23, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
  g.player.pos = { x: 3.5, z: 1.2 }; // ở máy chấm công
  g.devAddCong(9);
  g.shift.minutes = 479.9;
  g.tick(0.2);
  const e1 = g.events.find((e) => e.type === 'eval');
  check('Vượt 150% chỉ tiêu thì nhận phiếu khen', e1?.type === 'eval' && e1.ev.voucherEarned && g.voucher);
  g.nextNight();
  g.player.pos = { x: 3, z: 3 }; // vắng điểm danh, không đủ công: 2 lỗ, phiếu khen xoá 1
  g.shift.minutes = 479.9;
  g.events.length = 0;
  g.tick(0.2);
  const e2 = g.events.find((e) => e.type === 'eval');
  check('Phiếu khen xoá 1 lỗ', e2?.type === 'eval' && e2.ev.voucherUsed && e2.ev.holesAdded === 1 && !g.voucher, e2?.type === 'eval' ? String(e2.ev.holesAdded) : '');
}

// 12. Ném lon thì phải nhặt lại, không sẽ bị trừ công
{
  const mk = () => {
    const g = new Game('Thử', { seed: 31, events: { ordersBase: 0, ordersPerNight: 0, auditorStart: 999 } });
    g.player.pos = { x: 3.5, z: 1.2 }; // đứng ở máy chấm công
    g.devAddCong(g.shift.quota); // vừa đủ chỉ tiêu
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
  check('Còn 1 lon: trừ 1 công, tụt dưới chỉ tiêu', !!ev && ev.litterPenalty === 1 && ev.cong === ev.quota - 1 && ev.holesAdded === 1, ev?.reasons.join(' | '));
  const clean = mk();
  const b = clean.dropLitter({ x: 10, z: 11 });
  clean.pickUpLitter(b);
  const ev2 = endOf(clean);
  check('Nhặt hết thì không bị trừ', !!ev2 && ev2.litterPenalty === 0 && ev2.holesAdded === 0);
  const d = mk();
  for (let i = 0; i < 5; i++) d.dropLitter({ x: 10 + i, z: 11 });
  d.player.pos = { x: 3, z: 3 };
  for (let i = 0; i < 60 * 20; i++) d.tick(1 / 60);
  const ctl = mk();
  ctl.player.pos = { x: 3, z: 3 };
  for (let i = 0; i < 60 * 20; i++) ctl.tick(1 / 60);
  check('Lon để lại chỉ bị trừ công, không làm lệch sổ', Math.abs(d.shift.drift - ctl.shift.drift) < 1e-9, `${d.shift.drift.toFixed(3)} = ${ctl.shift.drift.toFixed(3)}`);
}

// 13. Xếp hàng vào tủ lạnh: thùng hàng lạnh lấy ở kho lạnh
{
  const g = new Game('Thử', { seed: 41, events: { ordersBase: 0, ordersPerNight: 0 } });
  const s = g.shift;
  check('Đêm 1: 2 tủ lạnh hết hàng, 3 thùng hàng lạnh', s.coldNeeded.size === 2 && s.coldPile === 3, `${s.coldNeeded.size}, ${s.coldPile}`);
  const [unit] = [...s.coldNeeded];
  const shelf = [...s.restockNeeded][0];
  g.takeBox();
  check('Thùng hàng khô không bỏ vào tủ lạnh', !g.restockCold(unit).ok && s.coldNeeded.has(unit));
  g.dropBox();
  check('Thả thùng khô thì trả về kho', g.player.carry === null && s.pile === s.restockTotal + 1);
  g.takeColdBox();
  check('Thùng hàng lạnh không xếp lên kệ khô', !g.restock(shelf).ok && s.restockNeeded.has(shelf));
  const before = s.cong;
  const r = g.restockCold(unit);
  check('Xếp hàng lạnh vào tủ được 2 công', r.ok && s.cong === before + 2 && !s.coldNeeded.has(unit) && g.player.carry === null, r.msg);
  check('Tủ không hết hàng thì không xếp được', !g.restockCold(unit).ok);
  g.takeColdBox();
  g.dropBox();
  check('Thả thùng lạnh thì trả về kho lạnh', s.coldPile === 2, String(s.coldPile));
  const o = g.issueOrder('coldRestock')!;
  check('Phiếu "tủ lạnh hết hàng": tủ hết hàng, thêm thùng lạnh', o.kind === 'coldRestock' && s.coldNeeded.has(o.section!) && s.coldPile === 3);
  g.takeColdBox();
  g.restockCold(o.section!);
  check('Xếp xong thì phiếu xong', o.done && !o.late);
}

console.log(failed ? `\n${failed} kiểm tra thất bại.` : '\nTất cả kiểm tra đều đạt.');
if (failed) throw new Error('sim-smoke failed');
