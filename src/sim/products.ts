// Danh mục hàng bày bán: tên, giá, đơn vị, màu bao bì, kích thước, ăn uống được không.
// KHÔNG dùng Three.js (sau này chạy trên server). Mã hàng trùng tên model .glb (public/models/<id>.glb).
// Dùng cho bảng giá trên kệ / tủ, cho việc xếp hàng lên kệ (shelfGoods.ts) và cho việc lấy / ăn đồ trên kệ.

export type ProductId =
  | 'hh_lon_nuoc' | 'hh_lon_xanh' | 'hh_chai_nuoc' | 'hh_chai_ngot' | 'hh_hop_banh' | 'hh_ngu_coc' | 'hh_socola'
  | 'hh_goi_mi' | 'hh_hop_sua' | 'hh_snack' | 'hh_do_hop' | 'hh_dau_an' | 'hh_nuoc_tay' | 'hh_nuoc_giat'
  | 'hh_kem' | 'hh_goi_dong' | 'hh_pizza' | 'hh_sua_chua' | 'hh_sua_tuoi' | 'hh_nuoc_cam'
  | 'hh_lon_cam' | 'hh_ca_phe' | 'hh_tra_xanh' | 'hh_snack_rong' | 'hh_snack_cay' | 'hh_mi_ga' | 'hh_banh_dua' | 'hh_lau_san';

/** drink: uống được · food: ăn được · other: hoá phẩm, dầu ăn… (không ăn uống được). */
export type ProductKind = 'drink' | 'food' | 'other';

export interface Product {
  id: ProductId;
  /** Tên in trên bảng giá (viết hoa, ngắn). */
  name: string;
  /** Giá (đồng). */
  price: number;
  /** Đơn vị bán: lon, chai, gói… */
  unit: string;
  /** Màu bao bì chính (#rrggbb), dùng làm dải màu trên bảng giá. */
  color: string;
  kind: ProductKind;
  /** Rộng (theo mặt kệ) và sâu (m), khớp model Blender (manifest.json kich_thuoc_m). */
  w: number;
  d: number;
  /** Thể lực hồi lại khi ăn / uống (0..1). */
  stamina: number;
}

const P = (id: ProductId, name: string, price: number, unit: string, color: string, kind: ProductKind, w: number, d: number): Product => ({
  id, name, price, unit, color, kind, w, d,
  stamina: kind === 'drink' ? 0.35 : kind === 'food' ? 0.5 : 0,
});

export const PRODUCTS: Product[] = [
  P('hh_lon_nuoc', 'NƯỚC NGỌT CÔ-LA', 10000, 'lon', '#d8342b', 'drink', 0.064, 0.067),
  P('hh_lon_xanh', 'SODA CHANH', 9000, 'lon', '#4cae4f', 'drink', 0.064, 0.069),
  P('hh_chai_nuoc', 'NƯỚC SUỐI 500ML', 5000, 'chai', '#2f7fc1', 'drink', 0.06, 0.062),
  P('hh_chai_ngot', 'NƯỚC CAM 1,5L', 22000, 'chai', '#f28c28', 'drink', 0.08, 0.084),
  P('hh_hop_banh', 'BÁNH QUY BƠ', 35000, 'hộp', '#e6b422', 'food', 0.162, 0.067),
  P('hh_ngu_coc', 'NGŨ CỐC GIÒN', 68000, 'hộp', '#e0463c', 'food', 0.192, 0.073),
  P('hh_socola', 'SÔ-CÔ-LA SỮA', 25000, 'thanh', '#6b3a22', 'food', 0.092, 0.033),
  P('hh_goi_mi', 'MÌ TÔM CHUA CAY', 4500, 'gói', '#f28c28', 'food', 0.152, 0.053),
  P('hh_hop_sua', 'SỮA TƯƠI HỘP', 8000, 'hộp', '#3f8fd2', 'drink', 0.072, 0.074),
  P('hh_snack', 'SNACK KHOAI TÂY', 12000, 'gói', '#8e5bb5', 'food', 0.162, 0.082),
  P('hh_do_hop', 'CÁ HỘP SỐT CÀ', 21000, 'hộp', '#2e9c4f', 'food', 0.081, 0.087),
  P('hh_dau_an', 'DẦU ĂN 1L', 48000, 'chai', '#e0b020', 'other', 0.067, 0.07),
  P('hh_nuoc_tay', 'XỊT TẨY ĐA NĂNG', 39000, 'chai', '#3f8fd2', 'other', 0.085, 0.09),
  P('hh_nuoc_giat', 'NƯỚC GIẶT 2L', 95000, 'can', '#f28c28', 'other', 0.13, 0.091),
  P('hh_lon_cam', 'SODA CAM', 9000, 'lon', '#f28c28', 'drink', 0.064, 0.069),
  P('hh_ca_phe', 'CÀ PHÊ SỮA LON', 14000, 'lon', '#5a3424', 'drink', 0.064, 0.069),
  P('hh_tra_xanh', 'TRÀ XANH 450ML', 10000, 'chai', '#2e7d4f', 'drink', 0.06, 0.064),
  P('hh_snack_rong', 'SNACK RONG BIỂN', 12000, 'gói', '#2e7d4f', 'food', 0.162, 0.082),
  P('hh_snack_cay', 'SNACK CAY', 12000, 'gói', '#c62828', 'food', 0.162, 0.083),
  P('hh_mi_ga', 'MÌ GÀ', 4500, 'gói', '#e0b020', 'food', 0.152, 0.053),
  P('hh_banh_dua', 'BÁNH QUY DỪA', 32000, 'hộp', '#2f7fc1', 'food', 0.162, 0.067),
  P('hh_lau_san', 'NƯỚC LAU SÀN', 42000, 'chai', '#e86aa0', 'other', 0.085, 0.09),
  P('hh_kem', 'KEM DÂU', 45000, 'hộp', '#ee8fb0', 'food', 0.126, 0.132),
  P('hh_goi_dong', 'SỦI CẢO ĐÔNG LẠNH', 55000, 'gói', '#2f7fc1', 'food', 0.202, 0.27),
  P('hh_pizza', 'PIZZA ĐÔNG LẠNH', 89000, 'hộp', '#d8342b', 'food', 0.28, 0.28),
  P('hh_sua_chua', 'SỮA CHUA DÂU', 28000, 'lốc 4', '#ee8fb0', 'food', 0.14, 0.146),
  P('hh_sua_tuoi', 'SỮA TƯƠI 1L', 36000, 'bình', '#3f8fd2', 'drink', 0.092, 0.094),
  P('hh_nuoc_cam', 'NƯỚC ÉP CAM', 15000, 'chai', '#f6a21e', 'drink', 0.06, 0.064),
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
export const productById = (id: string): Product | undefined => BY_ID.get(id as ProductId);

/** 4500 → "4.500đ" */
export const formatPrice = (vnd: number): string => `${Math.round(vnd).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

/** Ngành hàng: mỗi dãy kệ bày một ngành (tên in ở biển đầu dãy), mỗi tầng một món trong ngành. */
export const AISLES: { name: string; goods: ProductId[] }[] = [
  { name: 'GIẢI KHÁT', goods: ['hh_lon_nuoc', 'hh_lon_xanh', 'hh_lon_cam', 'hh_ca_phe', 'hh_chai_nuoc', 'hh_tra_xanh', 'hh_chai_ngot'] },
  { name: 'BÁNH KẸO', goods: ['hh_hop_banh', 'hh_banh_dua', 'hh_snack', 'hh_snack_rong', 'hh_snack_cay', 'hh_socola', 'hh_ngu_coc'] },
  { name: 'ĐỒ KHÔ', goods: ['hh_goi_mi', 'hh_mi_ga', 'hh_do_hop', 'hh_dau_an', 'hh_hop_sua'] },
  { name: 'HOÁ PHẨM', goods: ['hh_nuoc_tay', 'hh_lau_san', 'hh_nuoc_giat'] },
];
/** Ngành hàng của dãy 1–12 (khối tây 1–6, khối giữa 7–12). */
const AISLE_OF_ROW = [0, 1, 2, 3, 1, 0, 2, 0, 1, 3, 2, 1];
export const aisleOf = (rowId: number) => AISLES[AISLE_OF_ROW[(rowId - 1) % AISLE_OF_ROW.length]];
