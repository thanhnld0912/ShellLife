# Hợp Đồng 30 Đêm

Game kinh dị co-op 2–4 người trên trình duyệt. Hiện tại: **bản thử giai đoạn 1**, một người chơi, siêu thị khối xám.

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

- Sinh 16 model vào `public/models/*.glb` + `manifest.json`, ảnh xem trước vào `art/preview/`, file `art/blender/mau_lowpoly.blend` để mở chỉnh tay.
- Xem model 3D: `npm run dev` rồi mở http://localhost:5173/viewer.html
- Quy ước: mét, gốc ở giữa đáy, mặt trước quay về -Y trong Blender (= +Z trong Three.js).
