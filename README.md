# Hợp Đồng 30 Đêm

Game kinh dị co-op 2–4 người trên trình duyệt. Hiện tại: **bản thử giai đoạn 1**, một người chơi, siêu thị 44 × 34 m kiểu mê cung dùng model low-poly từ Blender (thiếu model nào thì tự vẽ khối xám chỗ đó).

Concept đầy đủ: `shelf-life-concept-v8.html`
Kế hoạch triển khai và theo dõi tiến độ: `docs/ke-hoach-trien-khai.html`

## Chạy game

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra (thường là http://localhost:5173) bằng Chrome hoặc Edge, nên đeo tai nghe.

**Menu chính:** Chơi (nhập tên nhân viên, nhận ca) · Hướng dẫn chơi · Cài đặt. **Cài đặt** (mở cả khi tạm dừng bằng Esc): đồ hoạ (chất lượng, góc nhìn, độ sáng, hiện FPS), âm thanh (tổng, nhạc nền, âm thanh trong game, loa siêu thị, phụ đề loa), voice chat (lưu sẵn cho giai đoạn 2: giữ phím để nói / micro luôn mở, phím, âm lượng, độ nhạy và chọn micro, nghe theo khoảng cách, nút thử micro có vạch đo), điều khiển (độ nhạy chuột, bảng phím). Cài đặt lưu trong trình duyệt ([src/client/settings.ts](src/client/settings.ts)).

Nếu `npm install` báo lỗi mạng `ENETUNREACH`, chạy lại với IPv4:

```powershell
$env:NODE_OPTIONS='--dns-result-order=ipv4first'; npm install
```

## Chơi cùng bạn (bản thử, 2 người)

Hai người phải mở **cùng một trang web** do máy bạn chạy:

1. Máy bạn: `npm run play` (build rồi chạy server ở cổng 8080: phục vụ trang game và chuyển tin chơi mạng ở `/net`).
   Đang sửa code thì `npm run dev` cũng có sẵn chơi mạng.
2. Người chơi cùng:
   - **Cùng mạng wifi:** mở địa chỉ `http://192.168.x.x:8080` mà server in ra.
   - **Ở xa (không cần thuê server):** cài Cloudflare Tunnel (`winget install --id Cloudflare.cloudflared`), chạy
     `cloudflared tunnel --url http://localhost:8080`, gửi đường link `https://….trycloudflare.com` cho bạn. Chính bạn cũng mở link đó.
3. Menu → Chơi → nhập tên → **Tạo phòng**. Gửi mã 4 chữ (hoặc đường link `?room=MÃ`) cho bạn; bạn nhập tên → **Vào phòng**.
4. Đủ 2 người, chủ phòng bấm **Bắt đầu ca**.

Luật khi chơi 2 người:
- Mỗi người **một danh sách việc riêng** (tổng việc gấp đôi, chia lần lượt); bìa kẹp chỉ hiện việc của mình kèm tiến độ cả nhóm. Làm giúp việc của người kia vẫn được tính.
- **Thẻ, hồ sơ, lương chung cả nhóm.** 06:00 ai còn sống cũng phải có mặt ở máy chấm công.
- Người Kiểm Kê đếm / bắt **từng người**. Một người bị đóng thùng thì xem camera tới hết đêm (đêm sau vào ca lại); cả hai bị bắt thì hết ca.
- Khiêng kiện nước 2 người thật: người cầm trước dẫn đường, người cầm sau tự đi theo đầu kia của kiện.
- Esc (tạm dừng) không dừng ca của người kia. Bảng sự kiện (P) chỉ chủ phòng mở được.

Cách hoạt động ([src/client/net.ts](src/client/net.ts), [server/relay.mjs](server/relay.mjs)): máy chủ phòng chạy toàn bộ ca làm việc; máy vào phòng giữ bản sao, gửi vị trí và thao tác lên, nhận lại trạng thái ~15 lần/giây. Server chỉ giữ phòng và chuyển tin. Chủ phòng thoát là phòng đóng.

## Siêu thị và luật trong ca

- **Bố cục 44 × 34 m kiểu mê cung** (xem sơ đồ đầu [src/sim/layout.ts](src/sim/layout.ts)):
  - Hai khối kệ, mỗi khối 6 dãy, **lệch nhau 1,5 m**: làn của khối này không thẳng hàng làn của khối kia, không có đường nhìn dài xuyên siêu thị.
  - Mỗi khối có một làn ngang rộng ở giữa; **pallet hàng cao 1,9 m** rải khắp nơi (hành lang, làn ngang, khu lạnh, sát mặt kính) che tầm nhìn và tạo ngõ ngách.
  - Mỗi dãy kệ một ngành hàng (giải khát, bánh kẹo, đồ khô, hoá phẩm), tên ngành in ở biển đầu dãy. 28 loại hàng low-poly màu tươi (chai, lon tiện tròn bo mượt, thon đúng dáng), mỗi món có hình nhận diện riêng ở mặt trước (sóng, lát chanh, bát mì có đũa, con cá…). **Bảng giá** trên nẹp mỗi tầng kệ và tủ mát ghi tên hàng, giá, đơn vị, mã vạch; danh mục hàng ở [src/sim/products.ts](src/sim/products.ts).
  - **Khu rau quả** sát mặt kính: 4 kệ gỗ nghiêng bày sọt táo, cam, chuối, dứa, bắp cải, cà chua, khoai tây (thấp ~1 m: chặn lối, không che tầm nhìn). Cạnh quầy có bãi xe đẩy và chồng giỏ nhựa.
  - Khu hàng lạnh có 18 tủ mát cửa kính ở tường tây, 15 ngăn mát mở ở tường đông và 3 đảo tủ đông nằm, xen pallet so le.
  - Khu sau gồm kho, kho lạnh, phòng điện, phòng nghỉ, văn phòng và **phòng kiểm kê** (riêng của Người Kiểm Kê).
  - Mặt tiền là kính mờ, bên ngoài có cửa sắt xếp đã khoá.
- **Đầu ca:** nhân viên bắt đầu ở PHÒNG NGHỈ, phải chạy tới **máy chấm công trong kho** để chấm công vào ca trước 22:30. Chưa chấm công thì chưa làm việc được; chấm trễ bị ghi hồ sơ.
- **Kho và kho lạnh là khu lấy hàng:** đứng trong đó Người Kiểm Kê không nhìn / đếm được (vạch xanh và biển "KHU LẤY HÀNG · KHÔNG KIỂM ĐẾM" ở cửa). Nghe tiếng trong kho thì nó chỉ tới cửa ngó vào.
- **Điểm danh 06:00 ở máy chấm công** cạnh cửa nhân viên trong kho (vạch vàng trên sàn), không phải ở quầy.
- **Ném lon có ngắm:** giữ Q hiện tay cầm lon (cả khi đang ôm thùng), đường bay chấm vàng, vòng vàng chỗ rơi và vòng mờ lớn là tầm nghe tiếng lon. Thả Q để ném, chuột phải để huỷ.
- **Việc được giao (không còn "công" và chỉ tiêu):** đầu ca mỗi nhân viên nhận một **danh sách việc cụ thể** ([src/sim/shift.ts](src/sim/shift.ts)): quét những đoạn kệ nào, xếp kệ THIẾU HÀNG nào, xếp tủ lạnh nào, ghi nhiệt độ mốc giờ nào, dọn món hàng lỗi nào (ghi rõ món, đoạn kệ, tầng), gom rác. Đêm 1 có 9 việc, các đêm sau tăng dần. Sau này nhiều người thì mỗi người một danh sách (`Job.who`).
  - **Bìa kẹp (Tab)** có **bản đồ siêu thị** đánh số từng việc đúng chỗ làm, mũi tên vàng là mình; trên nóc kệ có **biển nổi** CẦN QUÉT (xanh) / ⚠ HÀNG LỖI (cam) nhìn thấy qua nhiều dãy.
  - 06:00 còn việc được giao chưa xong: **bấm 1 lỗ** (tối đa 1 lỗ/đêm vì việc). Vắng điểm danh: 1 lỗ.
  - **Ghi hồ sơ** (cộng dồn qua các đêm, **3 lần = 1 lỗ**): phiếu phát sinh trễ hạn hoặc bỏ dở, chấm công vào ca trễ, ăn hàng quá 100.000đ/đêm. Thẻ nhân viên hiện 3 ô HỒ SƠ.
  - **Lương** 300.000đ/đêm: trừ đúng giá tiền hàng đã ăn, phí dọn 20.000đ/lon nước để lại trên sàn.
  - Xong hết việc, không trễ phiếu, không bị ghi hồ sơ, có mặt 06:00: **phiếu khen**, xoá lỗ kế tiếp.
  - Thùng khô không bỏ vào tủ lạnh được, thùng lạnh cũng không xếp lên kệ khô được.
- **Phiếu phát sinh** (máy in giao trong ca, có hạn): kệ hết hàng, kiểm lại kệ, tủ lạnh hết hàng, đơn gấp, kiện nước, sửa điện. **Việc nặng giãn cách**: hai việc phải bê / khiêng cách nhau ít nhất 70 phút trong game, kiện nước cách việc nặng khác và lần mất điện ít nhất 100 phút, đang có việc nặng dở thì không giao thêm; việc nặng có hạn dài hơn. Một ca dài ~6,5 phút ngoài đời.
  - Kệ và tủ để trống hay phiếu quá hạn làm **sổ lệch**: đèn tắt dần từng dải, Người Kiểm Kê thính hơn.
- **Gom rác (1 lần mỗi đêm):** 5 thùng rác rải khắp siêu thị (biển xanh CẦN GOM). Xách tay tối đa 2 túi, hoặc đẩy **XE GOM RÁC** (vàng, trong kho) gom tới 6 túi một lượt. Đổ vào **THÙNG RÁC LỚN** sát tường tây trong kho.
- **Xe đẩy hàng** (trong kho): [E] đẩy, [G] buông. Chở **kiện nước** (một người cũng đưa được ra đảo khuyến mãi, nhanh hơn kéo lê nhưng bánh xe lạch cạch) hoặc **3 thùng hàng khô** một lúc để xếp kệ / giao đơn gấp. Đẩy xe không chạy được; giữ C thì bánh xe nhỏ tiếng hơn.
- **Mất điện → sửa điện:** từ đêm 2 mất điện thì có phiếu sửa điện (hạn 60 phút). Tới **tủ điện tổng ở PHÒNG ĐIỆN**, [E] mở tủ: bật 6 cầu dao nhánh **đúng thứ tự trên sơ đồ** dán trong cửa tủ (mỗi lần mất điện vị trí và thứ tự đều khác), rồi gạt CẦU DAO TỔNG. Bật sai: tóe lửa, nghe xa 10 m, nhảy hết phải làm lại. Mở tủ thì đứng yên, game vẫn chạy. Không ai sửa thì máy phát dự phòng chạy sau gấp đôi thời gian (phiếu đã quá hạn).
- **PHÒNG KIỂM KÊ luôn khoá** với nhân viên (không vào trốn được); cửa tự trượt mở khi Người Kiểm Kê tới gần.
- **Hàng trên kệ ăn / uống được** (danh mục, giá ở [src/sim/products.ts](src/sim/products.ts), vị trí từng món ở [src/sim/shelfGoods.ts](src/sim/shelfGoods.ts)):
  - Nhìn vào món hàng **[E] lấy** lên tay: thẻ góc trái hiện tên, giá, **hạn sử dụng**. **[Giữ R] ăn / uống**, [E] vào kệ để đặt lại.
  - **Thể lực:** chạy làm tụt (~14 giây là cạn, cạn thì không chạy được tới khi hồi 25%); ăn hồi 50%, uống hồi 35%. Khui lon / xé gói hơi ồn.
  - Ăn hàng chưa trả tiền: lúc 06:00 **trừ lương đúng giá tiền**; ăn quá 100.000đ trong đêm thì bị ghi hồ sơ. Hoá phẩm, dầu ăn không ăn uống được.
  - **Hàng lỗi** (đêm 1 có 3 món, mỗi đêm thêm 1): hết hạn (nghiêng, bạc màu, tem đỏ HẾT HẠN), phồng (to, méo), mốc (ngả xanh xám, quay lệch). Nhận ra bằng mắt, bằng cách cầm lên xem hạn, hoặc **máy quét bíp lỗi** khi quét đoạn kệ (ồn hơn).
  - Ăn phải hàng lỗi: **đau bụng** 40 giây (đi chậm, thỉnh thoảng rên thành tiếng làm Người Kiểm Kê nghe thấy) và **chóng mặt** 22 giây (hình mờ, chao đảo).
  - Mang hàng lỗi bỏ vào **THÙNG HÀNG LỖI** trong kho (cạnh cửa): xong việc được giao. Từ 02:00 hàng lỗi còn trên kệ làm lệch sổ.
- **Phiếu việc (Tab)** là tấm bìa kẹp cầm ở một tay, đưa lên ở góc phải màn hình: không che giữa màn hình, vẫn đi lại được, bìa nhún theo bước chân. Người chơi khác nhìn vào thấy nhân vật giơ bảng kẹp trước ngực, cúi đầu đọc (động tác `xem_phieu` / `di_xem_phieu` của nhan_vien_ngo.glb).
- **Đi rón rén (giữ C):** chậm còn 55%, hạ thấp người; ôm thùng không lạch cạch, kéo kiện hàng nhỏ tiếng hơn.
- **Kiện nước suối 2 người khiêng** (phiếu phát sinh từ đêm 2, tối đa 1 kiện mỗi đêm): kiện ~90 kg nằm ở góc kho, phải đưa ra **ĐẢO KHUYẾN MÃI** sát mặt kính.
  - [E] cầm một đầu. Một mình thì **kéo lê**: 0,8 m/s, không chạy được, kêu ken két nghe xa 9 m (rón rén: 5 m).
  - Hai người khiêng: 1,6 m/s, chỉ lạch cạch nhẹ. [G] buông (kiện rơi phịch, ồn, nằm lại chỗ đó). Tới đảo khuyến mãi bấm [E] đặt.
  - Lõi game đã tính sẵn cho nhiều người (mỗi kiện có danh sách người khiêng, tối đa 2). Khi chưa có chơi mạng, bật **Đồng nghiệp ảo** trong bảng sự kiện để thử khiêng 2 người.
- **Lon nước ném ra phải nhặt lại:** mỗi lon còn trên sàn lúc 06:00 bị trừ 20.000đ lương. Lon không làm lệch sổ.

## Người Kiểm Kê

- **Dáng Slender Man:** cao 2,15 m, vest đen ôm, sơ mi trắng, cà vạt đen, đầu trắng trơn với dải mắt in mã vạch và vạch laser đỏ. Đi thẳng lưng, sải dài, tay buông gần như bất động; thùng vác trên vai gắn vào thân nên lắc theo người.

- **Đứng chờ trong PHÒNG KIỂM KÊ** (phòng riêng ở góc đông bắc, tách khỏi văn phòng, đèn đỏ trên cửa), 22:15 thì đi ra.
- **Mỗi đêm một kiểu lộ trình** (5 kiểu, không lặp kiểu của đêm trước), đảo chiều và điểm bắt đầu ngẫu nhiên, thỉnh thoảng bỏ ngang sang chỗ khác:
  zig-zag qua từng làn · vòng ngoài và ngó vào từng cửa phòng · quanh khu hàng lạnh và quầy · dọc các làn lớn · không theo thứ tự.
- **Nghe tiếng động trong phòng nghỉ, phòng điện, văn phòng thì vào tận phòng đó.** Lưới đường đi tự sinh từ bố cục (ô 1 m, có điểm ở từng ô cửa): đi vào / ra phòng luôn qua cửa, không xuyên tường.
- **Mất điện nhiều lần mỗi đêm:** đêm 2 một lần, mỗi đêm sau thêm một lần (tối đa 3, chỉnh trong bảng P), mỗi lần ~60 phút trong game, cách nhau ít nhất 40 phút.
- **Cảnh bắt người:** lao tới vươn tay dài chộp → giơ thùng quá đầu, úp xuống → ấn bẹp, dán băng keo, quét mã → **vác thùng trên vai** qua cửa kho → cúi đặt vào ô "ĐÃ LƯU KHO".
- Người chơi nhìn thấy nhau (và nhóm ca trước ngoài kính) là **nhân viên bản ngố**: đầu to, mắt chấm, thẻ đeo cổ to.

## Máy yếu

Trong **Cài đặt → Đồ hoạ** chọn chất lượng: Tự động (mặc định, đoán theo card đồ hoạ) · Thấp · Vừa · Cao. Lựa chọn được lưu trong trình duyệt.

| Mức | Khác biệt |
|---|---|
| Thấp | Hàng hoá là khối hộp dán ảnh chụp mặt trước của từng món (vẫn thấy nhãn, hình; ít hơn ~10 lần tam giác), 4 đèn trần, không bóng đổ, độ phân giải 50–85% |
| Vừa | Hàng hoá chi tiết, 4 đèn trần, có bóng đổ đèn pin, độ phân giải 60–100% |
| Cao | Như trước: 8 đèn trần, đèn từng phòng, độ phân giải tới 150% |

- Trong lúc chơi, độ phân giải **tự hạ** khi dưới 40 khung/giây và tự nâng lại khi máy rảnh.
- Bóng đổ chỉ được vẽ khi đèn pin / đèn máy quét đang bật. Đèn lối thoát là vầng sáng giả, không phải đèn thật.
- Bấm **F3** khi chơi để xem số khung/giây và độ phân giải đang dùng.

## Bảng sự kiện (phím P) để chơi thử

Trong ca bấm **P** để mở. Bảng có các phần sau:

- **Ngay bây giờ:** mất điện / có điện lại, gọi Người Kiểm Kê vào, cho về văn phòng nghỉ, dụ nó tới chỗ mình, cho loa phát câu tuỳ ý.
- **Thời gian:** tua +10/+30/+60 phút, tới giờ ghi nhiệt độ, tới 05:50, kết thúc ca, tốc độ thời gian 0,5–4×, bắt đầu lại đêm 1–5.
- **Gian lận để thử:** tàng hình, không chết, xong 1 / xong hết việc được giao, +1 ghi hồ sơ, đặt số lỗ thẻ. Nút "Mất điện ngay" để thử sửa điện; ô "Mất điện phải tự sửa" (tắt thì tự có điện lại như cũ).
- **Đồng nghiệp ảo đi theo:** giả làm người chơi thứ 2 (chỉ trên máy này). Nó đi theo đúng đường mình đi, bắt chước bấm Tab xem phiếu, chạy, soi đèn pin (quay lại nhìn là thấy động tác người khác thấy), và chạy tới cầm đầu kia khi mình khiêng kiện nước. Code hiển thị người chơi khác ở [src/render/remotePlayer.ts](src/render/remotePlayer.ts), dùng lại cho giai đoạn 2.
- Nút **"Giao: khiêng kiện nước"** để thử ngay phiếu kiện hàng.
- **Lịch sự kiện, thông số Người Kiểm Kê, tốc độ người chơi, độ tối khi mất điện:** lưu trong trình duyệt và áp dụng cho các ca sau. Dòng có vạch vàng là dòng đã chỉnh.
- **Sao chép thông số:** chép giá trị đã chỉnh ra dạng JSON để dán vào nhật ký chơi thử.
- **Nhật ký sự kiện:** ghi lại mọi sự kiện trong ca kèm giờ trong game.

Mặc định game tạm dừng khi bảng mở. Bỏ chọn ô "Tạm dừng" nếu muốn vừa xem vừa để thế giới chạy.

## Lệnh khác

| Lệnh | Việc |
|---|---|
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run sim:test` | Kiểm tra logic game không cần trình duyệt (tuần tra, nghe, đếm, việc được giao, ghi hồ sơ, rác, xe đẩy, sửa điện, 2 người chơi) |
| `npm run build` | Đóng gói vào `dist/` |
| `npm run play` | Build rồi chạy server chơi mạng (cổng 8080, đổi bằng biến `PORT`) |
| `npm run serve` | Chạy server với bản đã build sẵn |

## Cấu trúc

```
src/
  sim/        Logic game, KHÔNG dùng Three.js. Sau này chạy trên server.
    layout.ts   Bố cục siêu thị, kệ, phòng, lưới đường đi
    auditor.ts  Người Kiểm Kê: tuần tra, tia quét, nghe, đếm 2 giây
    shift.ts    Ca làm việc, đồng hồ, danh sách việc được giao, rác, xe đẩy
    game.ts     Lõi game: việc, tiếng động, phiếu đánh giá, chết
  render/     Hình ảnh 3D (khối xám, sau thay bằng model Blender)
  client/     Chơi mạng (net.ts), điều khiển, âm thanh (nhạc nền tổng hợp, kênh âm lượng), menu + cài đặt (menu.ts, settings.ts), giao diện, bản đồ trên bìa kẹp (storeMap.ts)
server/                Server chơi mạng: relay.mjs (phòng, chuyển tin), serve.mjs (phục vụ dist/ + /net)
scripts/sim-smoke.ts   Kiểm tra logic
docs/                  Kế hoạch triển khai
```

