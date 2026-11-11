# Hợp Đồng 30 Đêm

Game kinh dị co-op 2–4 người trên trình duyệt. Hiện tại: **bản thử giai đoạn 1**, một người chơi, siêu thị 44 × 34 m kiểu mê cung dùng model low-poly từ Blender (thiếu model nào thì tự vẽ khối xám chỗ đó).

Concept đầy đủ: `E:\ShelfLife-NghienCuu\shelf-life-concept-v8.html`
Kế hoạch triển khai và theo dõi tiến độ: `docs/ke-hoach-trien-khai.html`

## Chạy game

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra (thường là http://localhost:5173) bằng Chrome hoặc Edge, nên đeo tai nghe.

Nếu `npm install` báo lỗi mạng `ENETUNREACH`, chạy lại với IPv4:

```powershell
$env:NODE_OPTIONS='--dns-result-order=ipv4first'; npm install
```

## Siêu thị và luật trong ca

- **Bố cục 44 × 34 m kiểu mê cung** (xem sơ đồ đầu [src/sim/layout.ts](src/sim/layout.ts)):
  - Hai khối kệ, mỗi khối 6 dãy, **lệch nhau 1,5 m**: làn của khối này không thẳng hàng làn của khối kia, không có đường nhìn dài xuyên siêu thị.
  - Mỗi khối có một làn ngang rộng ở giữa; **pallet hàng cao 1,9 m** rải khắp nơi (hành lang, làn ngang, khu lạnh, sát mặt kính) che tầm nhìn và tạo ngõ ngách.
  - Khu hàng lạnh có 18 tủ mát cửa kính ở tường tây, 15 ngăn mát mở ở tường đông và 3 đảo tủ đông nằm, xen pallet so le.
  - Khu sau gồm kho, kho lạnh, phòng điện, phòng nghỉ, văn phòng và **phòng kiểm kê** (riêng của Người Kiểm Kê).
  - Mặt tiền là kính mờ, bên ngoài có cửa sắt xếp đã khoá.
- **Đầu ca:** nhân viên bắt đầu ở PHÒNG NGHỈ, phải chạy tới **máy chấm công trong kho** để chấm công vào ca trước 22:30. Chưa chấm công thì chưa làm việc được; chấm trễ bị trừ 2 công lúc 06:00.
- **Kho và kho lạnh là khu lấy hàng:** đứng trong đó Người Kiểm Kê không nhìn / đếm được (vạch xanh và biển "KHU LẤY HÀNG · KHÔNG KIỂM ĐẾM" ở cửa). Nghe tiếng trong kho thì nó chỉ tới cửa ngó vào.
- **Điểm danh 06:00 ở máy chấm công** cạnh cửa nhân viên trong kho (vạch vàng trên sàn), không phải ở quầy.
- **Ném lon có ngắm:** giữ Q hiện tay cầm lon (cả khi đang ôm thùng), đường bay chấm vàng, vòng vàng chỗ rơi và vòng mờ lớn là tầm nghe tiếng lon. Thả Q để ném, chuột phải để huỷ.
- **Việc trong ca:** quét kệ, xếp kệ THIẾU HÀNG (thùng khô ở kho), xếp tủ lạnh HẾT HÀNG (thùng xốp ở kho lạnh), ghi nhiệt độ tủ đông, đơn gấp ra quầy.
  - Thùng khô không bỏ vào tủ lạnh được, thùng lạnh cũng không xếp lên kệ khô được.
- **Chỉ tiêu chỉ là mức tối thiểu.** Phiếu việc có hạn giờ được giao suốt ca; trễ hạn thì bị bấm lỗ.
  - Kệ và tủ để trống hay phiếu quá hạn làm **sổ lệch**: đèn tắt dần từng dải, Người Kiểm Kê thính hơn.
  - Vượt 150% chỉ tiêu được phiếu khen, xoá lỗ kế tiếp.
- **Lon nước ném ra phải nhặt lại:** mỗi lon còn trên sàn lúc 06:00 bị trừ 1 công. Lon chỉ bị trừ công, không làm lệch sổ.

## Người Kiểm Kê

- **Đứng chờ trong PHÒNG KIỂM KÊ** (phòng riêng ở góc đông bắc, tách khỏi văn phòng, đèn đỏ trên cửa), 22:15 thì đi ra.
- **Mỗi đêm một kiểu lộ trình** (5 kiểu, không lặp kiểu của đêm trước), đảo chiều và điểm bắt đầu ngẫu nhiên, thỉnh thoảng bỏ ngang sang chỗ khác:
  zig-zag qua từng làn · vòng ngoài và ngó vào từng cửa phòng · quanh khu hàng lạnh và quầy · dọc các làn lớn · không theo thứ tự.
- **Nghe tiếng động trong phòng nghỉ, phòng điện, văn phòng thì vào tận phòng đó.** Lưới đường đi tự sinh từ bố cục (ô 1 m, có điểm ở từng ô cửa): đi vào / ra phòng luôn qua cửa, không xuyên tường.
- **Mất điện nhiều lần mỗi đêm:** đêm 2 một lần, mỗi đêm sau thêm một lần (tối đa 3, chỉnh trong bảng P), mỗi lần ~60 phút trong game, cách nhau ít nhất 40 phút.
- **Cảnh bắt người:** lao tới vươn tay dài chộp → giơ thùng quá đầu, úp xuống → ấn bẹp, dán băng keo, quét mã → **vác thùng trên vai** qua cửa kho → cúi đặt vào ô "ĐÃ LƯU KHO".
- Người chơi nhìn thấy nhau (và nhóm ca trước ngoài kính) là **nhân viên bản ngố**: đầu to, mắt chấm, thẻ đeo cổ to.

## Máy yếu

Ở menu chọn **Đồ hoạ**: Tự động (mặc định, đoán theo card đồ hoạ) · Thấp · Vừa · Cao. Lựa chọn được lưu trong trình duyệt.

| Mức | Khác biệt |
|---|---|
| Thấp | Hàng hoá là khối hộp (ít hơn ~5 lần tam giác), 4 đèn trần, không bóng đổ, độ phân giải 50–85% |
| Vừa | Hàng hoá chi tiết, 4 đèn trần, có bóng đổ đèn pin, độ phân giải 60–100% |
| Cao | Như trước: 8 đèn trần, đèn từng phòng, độ phân giải tới 150% |

- Trong lúc chơi, độ phân giải **tự hạ** khi dưới 40 khung/giây và tự nâng lại khi máy rảnh.
- Bóng đổ chỉ được vẽ khi đèn pin / đèn máy quét đang bật. Đèn lối thoát là vầng sáng giả, không phải đèn thật.
- Bấm **F3** khi chơi để xem số khung/giây và độ phân giải đang dùng.

## Bảng sự kiện (phím P) để chơi thử

Trong ca bấm **P** để mở. Bảng có các phần sau:

- **Ngay bây giờ:** mất điện / có điện lại, gọi Người Kiểm Kê vào, cho về văn phòng nghỉ, dụ nó tới chỗ mình, cho loa phát câu tuỳ ý.
- **Thời gian:** tua +10/+30/+60 phút, tới giờ ghi nhiệt độ, tới 05:50, kết thúc ca, tốc độ thời gian 0,5–4×, bắt đầu lại đêm 1–5.
- **Gian lận để thử:** tàng hình, không chết, cộng công, đặt số lỗ thẻ.
- **Lịch sự kiện, thông số Người Kiểm Kê, tốc độ người chơi, độ tối khi mất điện:** lưu trong trình duyệt và áp dụng cho các ca sau. Dòng có vạch vàng là dòng đã chỉnh.
- **Sao chép thông số:** chép giá trị đã chỉnh ra dạng JSON để dán vào nhật ký chơi thử.
- **Nhật ký sự kiện:** ghi lại mọi sự kiện trong ca kèm giờ trong game.

Mặc định game tạm dừng khi bảng mở. Bỏ chọn ô "Tạm dừng" nếu muốn vừa xem vừa để thế giới chạy.

## Lệnh khác

| Lệnh | Việc |
|---|---|
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run sim:test` | Kiểm tra logic game không cần trình duyệt (tuần tra, nghe, đếm, chỉ tiêu) |
| `npm run build` | Đóng gói vào `dist/` |

## Cấu trúc

```
src/
  sim/        Logic game, KHÔNG dùng Three.js. Sau này chạy trên server.
    layout.ts   Bố cục siêu thị, kệ, phòng, lưới đường đi
    auditor.ts  Người Kiểm Kê: tuần tra, tia quét, nghe, đếm 2 giây
    shift.ts    Ca làm việc, đồng hồ, chỉ tiêu công
    game.ts     Lõi game: việc, tiếng động, phiếu đánh giá, chết
  render/     Hình ảnh 3D (khối xám, sau thay bằng model Blender)
  client/     Điều khiển, âm thanh, giao diện
scripts/sim-smoke.ts   Kiểm tra logic
docs/                  Kế hoạch triển khai
```

## Model Blender

File `.blend` để ở OneDrive (không đưa vào Git). Xuất `.glb` vào `public/models/` rồi đẩy lên Git.

## Model low-poly (Blender trên máy này)

```
E:\blender\blender.exe -b --factory-startup --python art\blender\tao_model_lowpoly.py
```

- Thêm `-- --khong-render` để chỉ xuất .glb, hoặc `-- --chi-xem=nguoi_kiem_ke` để chỉ render ảnh xem trước của vài model (nhanh hơn nhiều).
- Sinh 23 model vào `public/models/*.glb` + `manifest.json` (tủ lạnh có ghi các tầng đặt hàng trong `tang_hang`), ảnh xem trước vào `art/preview/`, file `art/blender/mau_lowpoly.blend` để mở chỉnh tay.
- Xem model 3D: `npm run dev` rồi mở http://localhost:5173/viewer.html
- Quy ước: mét, gốc ở giữa đáy, mặt trước quay về -Y trong Blender (= +Z trong Three.js).
