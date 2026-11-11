# Hợp Đồng 30 Đêm

Game kinh dị co-op 2–4 người trên trình duyệt. Hiện tại: **bản thử giai đoạn 1**, một người chơi, siêu thị 36 × 30 m dùng model low-poly từ Blender (thiếu model nào thì tự vẽ khối xám chỗ đó).

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

- **Bố cục 36 × 30 m** (xem sơ đồ đầu [src/sim/layout.ts](src/sim/layout.ts)):
  - Khu bán hàng có 6 dãy kệ.
  - Khu hàng lạnh có 18 tủ mát cửa kính ở tường tây, 12 ngăn mát mở ở tường đông và 2 đảo tủ đông nằm ở giữa.
  - Khu sau gồm kho, kho lạnh, phòng điện, phòng nghỉ và văn phòng.
  - Mặt tiền là kính mờ, bên ngoài có cửa sắt xếp đã khoá.
- **Điểm danh 06:00 ở máy chấm công** cạnh cửa nhân viên trong kho (vạch vàng trên sàn), không phải ở quầy.
- **Việc trong ca:** quét kệ, xếp kệ THIẾU HÀNG (thùng khô ở kho), xếp tủ lạnh HẾT HÀNG (thùng xốp ở kho lạnh), ghi nhiệt độ tủ đông, đơn gấp ra quầy.
  - Thùng khô không bỏ vào tủ lạnh được, thùng lạnh cũng không xếp lên kệ khô được.
- **Chỉ tiêu chỉ là mức tối thiểu.** Phiếu việc có hạn giờ được giao suốt ca; trễ hạn thì bị bấm lỗ.
  - Kệ và tủ để trống hay phiếu quá hạn làm **sổ lệch**: đèn tắt dần từng dải, Người Kiểm Kê thính hơn.
  - Vượt 150% chỉ tiêu được phiếu khen, xoá lỗ kế tiếp.
- **Lon nước ném ra phải nhặt lại:** mỗi lon còn trên sàn lúc 06:00 bị trừ 1 công. Lon chỉ bị trừ công, không làm lệch sổ.

## Bảng sự kiện (phím P) để chơi thử

Trong ca bấm **P** để mở. Bảng có các phần sau:

- **Ngay bây giờ:** mất điện / có điện lại, gọi Người Kiểm Kê vào, cho về kho nghỉ, dụ nó tới chỗ mình, cho loa phát câu tuỳ ý.
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

- Sinh 23 model vào `public/models/*.glb` + `manifest.json` (tủ lạnh có ghi các tầng đặt hàng trong `tang_hang`), ảnh xem trước vào `art/preview/`, file `art/blender/mau_lowpoly.blend` để mở chỉnh tay.
- Xem model 3D: `npm run dev` rồi mở http://localhost:5173/viewer.html
- Quy ước: mét, gốc ở giữa đáy, mặt trước quay về -Y trong Blender (= +Z trong Three.js).
