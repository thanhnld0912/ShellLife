# Tạo bộ model low-poly mẫu cho "Hợp Đồng 30 Đêm".
# Chạy (không cần mở giao diện Blender):
#   E:\blender\blender.exe -b --factory-startup --python art\blender\tao_model_lowpoly.py
# Thêm "-- --khong-render" ở cuối để chỉ xuất .glb, bỏ qua ảnh xem trước.
#
# Quy ước: đơn vị mét, Blender Z hướng lên, MẶT TRƯỚC model quay về -Y
# (khi xuất glTF thành +Z, đúng hướng "nhìn tới" trong Three.js).
# Gốc toạ độ của mỗi model nằm giữa đáy (đặt thẳng xuống sàn được).

import bpy, bmesh, math, os, sys, json
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models')
OUT_PREV = os.path.join(ROOT, 'art', 'preview')
OUT_BLEND = os.path.join(ROOT, 'art', 'blender', 'mau_lowpoly.blend')
RENDER = '--khong-render' not in sys.argv
os.makedirs(OUT_GLB, exist_ok=True)
os.makedirs(OUT_PREV, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- vật liệu
def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb(hexv):
    return (lin((hexv >> 16) & 255), lin((hexv >> 8) & 255), lin(hexv & 255), 1.0)

MATS = {}
def M(name, hexv, rough=0.85, metal=0.0, emit=0.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = rgb(hexv)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit > 0:
        b.inputs['Emission Color'].default_value = rgb(hexv)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    m.diffuse_color = rgb(hexv)
    MATS[name] = m
    return m

# Bảng màu chung: siêu thị cũ, đèn huỳnh quang, hơi bệnh.
C = dict(
    thep=M('thep_son', 0x8d948f, 0.6, 0.3),
    thep_toi=M('thep_toi', 0x3b403e, 0.6, 0.4),
    go=M('go_quay', 0x6b5a48),
    tem_gia=M('tem_gia', 0xe8dc9a),
    carton=M('carton', 0xa47c4c, 0.95),
    carton_toi=M('carton_toi', 0x7a5a36, 0.95),
    bang_keo=M('bang_keo', 0xd8cfb4, 0.4),
    giay=M('giay_trang', 0xe9e4d4),
    vo_tu=M('vo_tu_mat', 0xc9d1d2, 0.5),
    kinh=M('kinh', 0x9fd8e6, 0.05, 0.0, 0.0, 0.28),
    den_lanh=M('den_lanh', 0xbff4ff, 0.5, 0.0, 4.0),
    den_do=M('den_do', 0xff3b30, 0.4, 0.0, 6.0),
    den_xanh=M('den_xanh', 0x5dff8a, 0.4, 0.0, 4.0),
    den_vang=M('den_vang', 0xffc94a, 0.4, 0.0, 4.0),
    nhua_den=M('nhua_den', 0x1a1d1c, 0.6),
    nhua_xam=M('nhua_xam', 0x4a504e, 0.7),
    thuong_hieu=M('do_thuong_hieu', 0x8a1d1d),
    cao_su=M('cao_su', 0x161818, 0.95),
    # Người Kiểm Kê
    dong_phuc=M('dong_phuc_kk', 0x2b3640),
    quan_kk=M('quan_kk', 0x15191d),
    da_kk=M('da_kk', 0xa8a294, 0.9),
    # nhân viên (người chơi)
    ao_nv=M('ao_nv', 0xd9d4c7),
    gile_nv=M('gile_nv', 0x7a1f1f),
    quan_nv=M('quan_nv', 0x2a2d33),
    da_nv=M('da_nv', 0xc79a76, 0.9),
    toc=M('toc', 0x18130f, 0.9),
    # hàng hoá
    lon_do=M('lon_do', 0xc0392b, 0.4, 0.5),
    nhom=M('nhom', 0xc7cbcc, 0.3, 0.9),
    banh_vang=M('banh_vang', 0xe6b422),
    banh_nau=M('banh_nau', 0x6e3b1e),
    chai_xanh=M('chai_xanh', 0x7cc4d8, 0.15),
    nap_trang=M('nap_trang', 0xf2f2ee, 0.5),
    mi_cam=M('mi_cam', 0xe0702a, 0.6),
    mi_do=M('mi_do', 0xb3261e, 0.6),
    sua_trang=M('sua_trang', 0xf0eee6, 0.7),
    sua_xanh=M('sua_xanh', 0x2f6db5, 0.7),
)

# ---------------------------------------------------------------- hình khối
def _post(o, m):
    o.data.materials.append(m)
    return o

def box(P, size, loc, m, rot=(0, 0, 0), bev=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bev > 0:
        mod = o.modifiers.new('vat', 'BEVEL')
        mod.width = bev
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    P.append(_post(o, m))
    return o

def cyl(P, r, h, loc, m, n=8, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=h, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object
    P.append(_post(o, m))
    return o

def ball(P, r, loc, m, scale=(1, 1, 1), sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    P.append(_post(o, m))
    return o

def limb(P, a, b, r, m, n=6, r2=None):
    """Khối trụ nối điểm a -> b (tay, chân). r ở đầu a, r2 ở đầu b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(P, r, d.length, (a + b) / 2, m, n=n, r2=r2)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return o

def mesh(P, name, verts, faces, m):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    P.append(_post(o, m))
    return o

MODELS = []  # (obj, meta)

def finish(P, name, ten, mo_ta):
    bpy.ops.object.select_all(action='DESELECT')
    for o in P:
        o.select_set(True)
    bpy.context.view_layer.objects.active = P[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    bpy.ops.object.shade_flat()
    me = o.data
    # gộp vật liệu trùng tên do join sinh ra
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    meta = dict(
        file=f'{name}.glb', ten=ten, mo_ta=mo_ta, tris=tris,
        kich_thuoc_m=[round(max(xs) - min(xs), 3), round(max(zs) - min(zs), 3), round(max(ys) - min(ys), 3)],
    )
    MODELS.append((o, meta))
    return o

# ================================================================ MODEL
# 1. Kệ hàng (một module gondola 2 mặt; dãy kệ 13 m = 10 module)
def ke_hang():
    P = []
    W, D, H = 1.3, 1.0, 2.0
    box(P, (W, D * 0.9, 0.12), (0, 0, 0.06), C['thep_toi'])            # chân đế
    box(P, (W, 0.05, H - 0.12), (0, 0, 0.12 + (H - 0.12) / 2), C['thep'])  # vách giữa (pegboard)
    for x in (-W / 2 + 0.025, W / 2 - 0.025):
        box(P, (0.05, 0.12, H), (x, 0, H / 2), C['thep_toi'])          # trụ đứng
    for side in (-1, 1):
        for z in (0.16, 0.6, 1.04, 1.48):
            box(P, (W - 0.08, 0.42, 0.03), (0, side * 0.25, z), C['thep'])
            box(P, (W - 0.08, 0.015, 0.06), (0, side * 0.465, z + 0.01), C['tem_gia'])  # dải tem giá
        for z in (0.16, 0.6, 1.04, 1.48):
            for x in (-0.4, 0.1, 0.45):
                box(P, (0.05, 0.004, 0.03), (x, side * 0.474, z + 0.01), C['giay'])   # tem giá nhỏ
    box(P, (W, 0.06, 0.22), (0, 0, H + 0.11), C['thuong_hieu'])          # bảng đầu kệ
    return finish(P, 'ke_hang', 'Kệ hàng (module 1,3 m)',
                  'Gondola 2 mặt, 4 tầng mỗi mặt, dải tem giá vàng. Ghép 10 cái thành một dãy kệ 13 m. Hàng hoá đặt riêng (InstancedMesh).')

# 2. Người Kiểm Kê
def nguoi_kiem_ke():
    P = []
    U, Q, S, K = C['dong_phuc'], C['quan_kk'], C['da_kk'], C['nhua_den']
    for sx in (-1, 1):
        box(P, (0.11, 0.27, 0.07), (sx * 0.1, -0.04, 0.035), K, bev=0.01)          # giày
        limb(P, (sx * 0.1, 0, 0.07), (sx * 0.11, 0, 0.98), 0.055, Q, r2=0.075)  # chân dài
    box(P, (0.34, 0.2, 0.16), (0, 0, 1.0), Q)                                     # hông
    t = cyl(P, 0.17, 0.66, (0, 0, 1.4), U, n=8, r2=0.23)                          # thân
    t.scale = (1, 0.62, 1)
    box(P, (0.2, 0.03, 0.08), (0, -0.115, 1.7), C['giay'])                        # cổ áo
    limb(P, (0, 0.02, 1.7), (0, -0.03, 1.86), 0.045, S)                           # cổ hơi dài
    ball(P, 0.13, (0, -0.07, 1.93), S, scale=(0.95, 1.0, 1.18))                   # đầu không mặt, cúi về trước
    cyl(P, 0.145, 0.08, (0, -0.07, 2.07), K, n=10)                                 # mũ
    box(P, (0.25, 0.14, 0.015), (0, -0.2, 2.035), K, rot=(0.25, 0, 0))              # lưỡi trai
    # tay trái: buông thõng, dài quá hông (khó chịu khi nhìn lâu)
    limb(P, (-0.25, 0, 1.66), (-0.29, 0.01, 1.25), 0.045, U, r2=0.04)
    limb(P, (-0.29, 0.01, 1.25), (-0.27, -0.02, 0.8), 0.04, U, r2=0.032)
    box(P, (0.05, 0.08, 0.14), (-0.27, -0.02, 0.71), S)                          # bàn tay
    # tay phải: cầm máy quét ngang ngực, chĩa về trước
    limb(P, (0.25, 0, 1.66), (0.28, -0.04, 1.3), 0.045, U, r2=0.04)
    limb(P, (0.28, -0.04, 1.3), (0.15, -0.38, 1.25), 0.04, U, r2=0.032)
    box(P, (0.06, 0.09, 0.08), (0.14, -0.42, 1.23), S)
    box(P, (0.05, 0.06, 0.16), (0.12, -0.44, 1.18), K, rot=(0.3, 0, 0))           # tay cầm máy quét
    box(P, (0.11, 0.12, 0.09), (0.12, -0.5, 1.27), K, bev=0.008)                  # đầu máy quét
    box(P, (0.08, 0.01, 0.05), (0.12, -0.565, 1.27), C['den_do'])                 # mắt quét đỏ
    box(P, (0.1, 0.012, 0.065), (-0.1, -0.138, 1.52), C['giay'])                   # thẻ tên trắng (trống)
    return finish(P, 'nguoi_kiem_ke', 'Người Kiểm Kê',
                  'Cao 2,05 m, gầy, đầu không mặt luôn cúi, tay trái dài quá hông, tay phải cầm máy quét ở độ cao 1,25 m (khớp SCANNER_Y). Thẻ tên để trống.')

# 3. Nhân viên (người chơi nhìn thấy nhau)
def nhan_vien():
    P = []
    A, G, Q, S = C['ao_nv'], C['gile_nv'], C['quan_nv'], C['da_nv']
    for sx in (-1, 1):
        box(P, (0.11, 0.25, 0.08), (sx * 0.1, -0.03, 0.04), C['cao_su'], bev=0.012)
        limb(P, (sx * 0.1, 0, 0.08), (sx * 0.11, 0, 0.82), 0.065, Q, r2=0.08)
    box(P, (0.34, 0.21, 0.15), (0, 0, 0.85), Q)
    t = cyl(P, 0.19, 0.58, (0, 0, 1.2), G, n=8, r2=0.22)                           # gilê đỏ đồng phục
    t.scale = (1, 0.66, 1)
    box(P, (0.07, 0.03, 0.14), (0, -0.125, 1.42), A)                                # cổ áo sơ mi lộ ra
    box(P, (0.2, 0.05, 0.05), (0, -0.09, 1.48), A)
    box(P, (0.09, 0.012, 0.055), (0.1, -0.145, 1.34), C['giay'])                  # thẻ nhân viên
    limb(P, (0, 0, 1.48), (0, 0, 1.56), 0.05, S)
    ball(P, 0.115, (0, -0.01, 1.66), S, scale=(0.95, 1.0, 1.1))
    ball(P, 0.12, (0, 0.015, 1.71), C['toc'], scale=(1.0, 1.0, 0.75))              # tóc
    for sx in (-1, 1):
        limb(P, (sx * 0.24, 0, 1.44), (sx * 0.27, 0, 1.12), 0.05, A, r2=0.045)
        limb(P, (sx * 0.27, 0, 1.12), (sx * 0.26, -0.06, 0.86), 0.042, S, r2=0.036)
        box(P, (0.05, 0.08, 0.1), (sx * 0.26, -0.07, 0.8), S)
    return finish(P, 'nhan_vien', 'Nhân viên ca đêm',
                  'Cao 1,72 m, gilê đỏ đồng phục, thẻ nhân viên trước ngực. Đổi màu gilê/tóc trong game để phân biệt 4 người chơi.')

# 4. Thùng carton
def thung_carton():
    P = []
    box(P, (0.58, 0.58, 0.5), (0, 0, 0.25), C['carton'], bev=0.012)
    box(P, (0.58, 0.004, 0.004), (0, 0, 0.502), C['carton_toi'])                  # khe nắp
    box(P, (0.1, 0.6, 0.006), (0, 0, 0.503), C['bang_keo'])                       # băng keo nắp
    box(P, (0.1, 0.006, 0.12), (0, -0.293, 0.44), C['bang_keo'])                  # băng keo vắt xuống
    box(P, (0.1, 0.006, 0.12), (0, 0.293, 0.44), C['bang_keo'])
    box(P, (0.22, 0.004, 0.13), (0.1, -0.292, 0.22), C['giay'])                   # nhãn kho
    for i in range(4):
        box(P, (0.16, 0.003, 0.008), (0.08, -0.295, 0.26 - i * 0.025), C['nhua_den'])  # dòng chữ giả
    box(P, (0.05, 0.003, 0.05), (-0.17, -0.292, 0.38), C['carton_toi'])           # ký hiệu "hướng lên"
    return finish(P, 'thung_carton', 'Thùng carton',
                  '58×50×58 cm như thùng trong kho. Có nhãn trắng phía trước để vẽ chữ (CanvasTexture) cho thùng "ĐÃ LƯU KHO".')

# 5. Tủ mát cửa kính
def tu_mat():
    P = []
    W, D, H = 1.0, 0.8, 2.1
    V = C['vo_tu']
    box(P, (W, D, 0.04), (0, 0, H - 0.02), V)
    box(P, (W, 0.04, H), (0, D / 2 - 0.02, H / 2), V)
    for sx in (-1, 1):
        box(P, (0.04, D, H), (sx * (W / 2 - 0.02), 0, H / 2), V)
    box(P, (W, D, 0.22), (0, 0, 0.11), C['nhua_xam'])                             # đế + máy nén
    for i in range(6):
        box(P, (W - 0.1, 0.004, 0.02), (0, -D / 2 - 0.002, 0.04 + i * 0.03), C['nhua_den'])  # khe tản nhiệt
    box(P, (W, 0.08, 0.16), (0, -D / 2 + 0.02, H + 0.08), C['thuong_hieu'])       # bảng đèn trên
    box(P, (W - 0.12, 0.01, 0.06), (0, -D / 2 - 0.025, H + 0.08), C['den_lanh'])
    for z in (0.62, 1.04, 1.46):
        box(P, (W - 0.1, D - 0.15, 0.02), (0, 0.04, z), C['thep'])                # kệ trong
    box(P, (W - 0.1, 0.02, 0.03), (0, D / 2 - 0.05, H - 0.08), C['den_lanh'])     # đèn trong
    for sx in (-1, 1):                                                            # 2 cánh cửa kính
        cx = sx * W / 4
        dw = W / 2 - 0.02
        y = -D / 2 + 0.02
        box(P, (dw, 0.04, 0.05), (cx, y, H - 0.06), C['thep_toi'])
        box(P, (dw, 0.04, 0.05), (cx, y, 0.245), C['thep_toi'])
        box(P, (0.05, 0.04, H - 0.3), (cx - sx * (dw / 2 - 0.025), y, H / 2 + 0.1), C['thep_toi'])
        box(P, (0.05, 0.04, H - 0.3), (cx + sx * (dw / 2 - 0.025), y, H / 2 + 0.1), C['thep_toi'])
        box(P, (dw - 0.1, 0.01, H - 0.36), (cx, y, H / 2 + 0.11), C['kinh'])
        box(P, (0.025, 0.04, 0.4), (cx - sx * (dw / 2 - 0.08), y - 0.03, 1.2), C['nhom'])  # tay nắm
    return finish(P, 'tu_mat', 'Tủ mát cửa kính',
                  '1,0×2,1 m, 2 cánh kính trong suốt, đèn lạnh xanh bên trong và bảng đèn trên nóc. Đặt 15 cái dọc tường tây.')

# 6. Quầy thu ngân
def quay_thu_ngan():
    P = []
    box(P, (2.9, 1.2, 0.9), (0, 0, 0.45), C['thep_toi'], bev=0.01)
    box(P, (3.0, 1.3, 0.05), (0, 0, 0.925), C['go'], bev=0.008)
    box(P, (2.9, 0.01, 0.12), (0, -0.605, 0.72), C['thuong_hieu'])                # sọc đỏ thương hiệu
    box(P, (1.4, 0.4, 0.02), (-0.6, -0.3, 0.96), C['cao_su'])                     # băng chuyền
    box(P, (0.3, 0.3, 0.02), (0.3, -0.25, 0.96), C['kinh'])                       # mặt quét kính
    box(P, (0.28, 0.28, 0.015), (0.3, -0.25, 0.952), C['den_do'])
    box(P, (0.5, 0.45, 0.12), (0.95, 0.15, 1.01), C['nhua_den'], bev=0.01)        # ngăn kéo tiền
    limb(P, (0.95, 0.2, 1.07), (0.95, 0.25, 1.3), 0.025, C['nhua_xam'])           # chân màn hình
    box(P, (0.42, 0.04, 0.3), (0.95, 0.2, 1.42), C['nhua_den'], rot=(-0.2, 0, 0))  # màn hình
    box(P, (0.37, 0.01, 0.24), (0.95, 0.175, 1.425), C['den_lanh'], rot=(-0.2, 0, 0))
    box(P, (0.3, 0.3, 0.16), (1.2, -0.3, 1.03), C['nhua_den'], bev=0.01)          # máy in hoá đơn
    box(P, (0.08, 0.002, 0.2), (1.2, -0.452, 1.05), C['giay'], rot=(0.25, 0, 0))  # tờ hoá đơn thò ra
    box(P, (0.4, 0.04, 0.12), (-1.2, 0.1, 1.2), C['nhua_den'])                    # biển "QUẦY 1"
    box(P, (0.34, 0.01, 0.07), (-1.2, 0.075, 1.2), C['den_vang'])
    limb(P, (-1.2, 0.1, 0.95), (-1.2, 0.1, 1.14), 0.012, C['thep'])
    return finish(P, 'quay_thu_ngan', 'Quầy thu ngân',
                  '3,0×1,3 m. Băng chuyền, mặt quét đỏ, màn hình, ngăn kéo tiền, máy in hoá đơn (chỗ in "phiếu chửi khéo").')

# 7. Bảng điều khiển tủ đông
def bang_dong_lanh():
    P = []
    box(P, (0.6, 0.08, 0.45), (0, -0.04, 0.225), C['nhua_xam'], bev=0.01)
    box(P, (0.24, 0.01, 0.09), (-0.12, -0.085, 0.34), C['nhua_den'])
    box(P, (0.2, 0.004, 0.06), (-0.12, -0.091, 0.34), C['den_xanh'])              # màn hình nhiệt độ
    for i, mt in enumerate((C['den_xanh'], C['den_vang'], C['den_do'])):
        cyl(P, 0.012, 0.01, (0.1 + i * 0.05, -0.085, 0.37), mt, n=8, rot=(math.pi / 2, 0, 0))
    for i in range(2):
        cyl(P, 0.04, 0.03, (-0.18 + i * 0.13, -0.095, 0.15), C['nhua_den'], n=10, rot=(math.pi / 2, 0, 0))
        box(P, (0.008, 0.01, 0.03), (-0.18 + i * 0.13, -0.112, 0.17), C['giay'])
    box(P, (0.04, 0.05, 0.16), (0.2, -0.105, 0.17), C['thep_toi'])                # cần gạt
    box(P, (0.06, 0.06, 0.05), (0.2, -0.13, 0.24), C['thuong_hieu'])
    box(P, (0.5, 0.004, 0.035), (0, -0.082, 0.42), C['tem_gia'])                  # nhãn "KHO LẠNH"
    return finish(P, 'bang_dong_lanh', 'Bảng điều khiển kho lạnh',
                  'Treo tường (mặt sau ở y=0). Màn hình nhiệt độ xanh, 3 đèn báo, 2 núm vặn, cần gạt đỏ, cho nhiệm vụ chỉnh nhiệt độ.')

# 8. Máy chấm công (đục lỗ thẻ)
def may_cham_cong():
    P = []
    box(P, (0.3, 0.16, 0.42), (0, -0.08, 0.21), C['vo_tu'], bev=0.012)
    cyl(P, 0.1, 0.02, (0, -0.165, 0.29), C['nhua_den'], n=16, rot=(math.pi / 2, 0, 0))
    cyl(P, 0.09, 0.01, (0, -0.172, 0.29), C['giay'], n=16, rot=(math.pi / 2, 0, 0))   # mặt đồng hồ
    box(P, (0.006, 0.004, 0.07), (0, -0.18, 0.31), C['nhua_den'])
    box(P, (0.05, 0.004, 0.006), (0.02, -0.18, 0.29), C['nhua_den'])
    box(P, (0.16, 0.03, 0.02), (0, -0.165, 0.11), C['nhua_den'])                  # khe đút thẻ
    box(P, (0.04, 0.02, 0.02), (0.11, -0.168, 0.11), C['den_do'])
    # giá cắm thẻ bên cạnh, 4 thẻ cho 4 người
    box(P, (0.22, 0.04, 0.36), (0.32, -0.02, 0.18), C['thep_toi'])
    for i in range(4):
        box(P, (0.2, 0.03, 0.01), (0.32, -0.055, 0.04 + i * 0.085), C['thep'])
        box(P, (0.054, 0.004, 0.086), (0.27 + (i % 2) * 0.06, -0.06, 0.08 + i * 0.085), C['giay'])
    return finish(P, 'may_cham_cong', 'Máy chấm công + giá thẻ',
                  'Treo tường gần phòng nghỉ. Đút thẻ vào khe để đục lỗ. Giá bên phải cắm 4 thẻ của 4 người.')

# 9. Thẻ nhân viên (cầm tay / màn đánh giá)
def the_nhan_vien():
    P = []
    box(P, (0.054, 0.002, 0.086), (0, 0, 0.043), C['giay'], bev=0.0)
    box(P, (0.054, 0.003, 0.016), (0, 0, 0.078), C['thuong_hieu'])                # dải đầu thẻ
    box(P, (0.018, 0.003, 0.022), (-0.013, 0, 0.055), C['nhua_xam'])              # ảnh
    for i in range(3):
        box(P, (0.018, 0.003, 0.002), (0.014, 0, 0.062 - i * 0.006), C['nhua_xam'])  # dòng chữ
    for i in range(3):                                                            # 3 ô đục lỗ
        cyl(P, 0.0045, 0.003, (-0.014 + i * 0.014, 0, 0.018), C['thep'], n=10, rot=(math.pi / 2, 0, 0))
    box(P, (0.012, 0.003, 0.006), (0, 0, 0.09), C['nhua_xam'])                    # lỗ dây đeo
    return finish(P, 'the_nhan_vien', 'Thẻ nhân viên',
                  '5,4×8,6 cm. 3 ô tròn xám là chỗ đục lỗ: game đổi ô thành đen khi bị đục (3 lỗ = chết).')

# 10. Máy quét cầm tay (góc nhìn người chơi)
def may_quet():
    P = []
    box(P, (0.05, 0.06, 0.13), (0, 0.02, 0.065), C['nhua_den'], rot=(0.25, 0, 0), bev=0.006)
    box(P, (0.075, 0.17, 0.07), (0, -0.04, 0.15), C['nhua_xam'], bev=0.008)
    box(P, (0.05, 0.05, 0.004), (0, 0.0, 0.187), C['den_xanh'])                   # màn hình nhỏ
    box(P, (0.06, 0.006, 0.04), (0, -0.128, 0.15), C['den_do'])                   # cửa sổ tia
    box(P, (0.02, 0.025, 0.01), (0, 0.045, 0.11), C['thuong_hieu'])               # cò bấm
    return finish(P, 'may_quet', 'Máy quét cầm tay',
                  'Cho tay người chơi (góc nhìn thứ nhất). Màn hình xanh hiện số đếm, cửa sổ đỏ phát tia khi giữ F.')

# 11. Xe đẩy hàng
def xe_day():
    P = []
    box(P, (0.55, 0.85, 0.04), (0, 0, 0.16), C['thep_toi'], bev=0.006)
    for sx in (-1, 1):
        limb(P, (sx * 0.24, 0.4, 0.18), (sx * 0.24, 0.4, 1.0), 0.015, C['thep'], n=6)
        for sy in (-1, 1):
            cyl(P, 0.06, 0.04, (sx * 0.21, sy * 0.33, 0.06), C['cao_su'], n=10, rot=(0, math.pi / 2, 0))
            box(P, (0.04, 0.06, 0.08), (sx * 0.21, sy * 0.33, 0.12), C['thep_toi'])
    limb(P, (-0.24, 0.4, 1.0), (0.24, 0.4, 1.0), 0.018, C['thuong_hieu'], n=6)  # tay đẩy
    return finish(P, 'xe_day', 'Xe đẩy hàng',
                  '0,55×0,85 m, tay đẩy đỏ. Để ở kho; về sau có thể cho chở 2 thùng (nhanh hơn nhưng ồn).')

# 12–16. Hàng hoá (rất nhẹ, dùng InstancedMesh hàng nghìn cái)
def lon_nuoc():
    P = []
    cyl(P, 0.033, 0.11, (0, 0, 0.06), C['lon_do'], n=10)
    cyl(P, 0.03, 0.01, (0, 0, 0.005), C['nhom'], n=10)
    cyl(P, 0.03, 0.01, (0, 0, 0.12), C['nhom'], n=10)
    return finish(P, 'hh_lon_nuoc', 'Lon nước ngọt', 'Cao 12,5 cm, 10 cạnh.')

def hop_banh():
    P = []
    box(P, (0.16, 0.06, 0.22), (0, 0, 0.11), C['banh_vang'])
    box(P, (0.162, 0.062, 0.05), (0, 0, 0.07), C['banh_nau'])
    box(P, (0.06, 0.004, 0.05), (0.03, -0.031, 0.16), C['thuong_hieu'])
    return finish(P, 'hh_hop_banh', 'Hộp bánh quy', '16×22 cm.')

def chai_nuoc():
    P = []
    cyl(P, 0.034, 0.16, (0, 0, 0.08), C['chai_xanh'], n=8)
    cyl(P, 0.0345, 0.05, (0, 0, 0.08), C['nap_trang'], n=8)                     # nhãn
    cyl(P, 0.034, 0.05, (0, 0, 0.185), C['chai_xanh'], n=8, r2=0.014)
    cyl(P, 0.016, 0.02, (0, 0, 0.22), C['nap_trang'], n=8)
    return finish(P, 'hh_chai_nuoc', 'Chai nước suối', 'Cao 23 cm.')

def goi_mi():
    P = []
    box(P, (0.15, 0.045, 0.12), (0, 0, 0.06), C['mi_cam'], bev=0.012)
    box(P, (0.152, 0.047, 0.035), (0, 0, 0.085), C['mi_do'])
    box(P, (0.04, 0.003, 0.03), (-0.04, -0.024, 0.035), C['nap_trang'])
    return finish(P, 'hh_goi_mi', 'Gói mì', '15×12 cm.')

def hop_sua():
    P = []
    w, d, h, g = 0.07, 0.07, 0.15, 0.03
    box(P, (w, d, h), (0, 0, h / 2), C['sua_trang'])
    box(P, (w + 0.002, d + 0.002, 0.05), (0, 0, 0.06), C['sua_xanh'])
    v = [(-w / 2, -d / 2, h), (w / 2, -d / 2, h), (w / 2, d / 2, h), (-w / 2, d / 2, h), (-w / 2, 0, h + g), (w / 2, 0, h + g)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
    mesh(P, 'mai_hop', v, f, C['sua_trang'])
    box(P, (w, 0.006, 0.012), (0, 0, h + g + 0.004), C['sua_trang'])
    return finish(P, 'hh_hop_sua', 'Hộp sữa giấy', 'Cao 18 cm, nắp mái nhà.')

builders = [ke_hang, nguoi_kiem_ke, nhan_vien, thung_carton, tu_mat, quay_thu_ngan, bang_dong_lanh,
            may_cham_cong, the_nhan_vien, may_quet, xe_day, lon_nuoc, hop_banh, chai_nuoc, goi_mi, hop_sua]
for b in builders:
    b()

# ---------------------------------------------------------------- xuất .glb
for o, meta in MODELS:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_GLB, meta['file']),
        export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    )
    meta['kb'] = round(os.path.getsize(os.path.join(OUT_GLB, meta['file'])) / 1024, 1)
    print(f"XUAT {meta['file']:22s} {meta['tris']:5d} tam giác  {meta['kb']} KB")

with open(os.path.join(OUT_GLB, 'manifest.json'), 'w', encoding='utf-8') as fh:
    json.dump([m for _, m in MODELS], fh, ensure_ascii=False, indent=2)

# ---------------------------------------------------------------- ảnh xem trước
def setup_render():
    r = scene.render
    r.engine = 'BLENDER_EEVEE'
    r.resolution_x = r.resolution_y = 640
    r.film_transparent = False
    r.image_settings.file_format = 'PNG'
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    scene.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('the_gioi')
    scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = rgb(0x2a3230)
    bg.inputs['Strength'].default_value = 0.9

    def light(name, kind, loc, energy, color=(1, 1, 1), rot=None, size=1.0):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == 'AREA':
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        if rot:
            lo.rotation_euler = rot
        scene.collection.objects.link(lo)
        return lo
    light('mat_troi', 'SUN', (0, 0, 10), 2.2, (0.92, 1.0, 0.97), rot=(0.75, 0.1, 0.6))
    light('den_phu', 'SUN', (0, 0, 10), 0.6, (1.0, 0.75, 0.75), rot=(1.1, 0, -2.4))

    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'san'
    floor.data.materials.append(M('san', 0x3a403d, 0.9))

    cd = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, floor

def frame(cam, objs, direction=(0.85, -1.6, 0.8), pad=1.08):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (mn + mx) / 2
    radius = max((p - center).length for p in pts)
    fov = cam.data.angle
    dist = radius / math.sin(fov / 2) * pad
    cam.location = center + Vector(direction).normalized() * dist
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_start = dist * 0.01
    cam.data.clip_end = dist * 10

def render_to(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('ANH', path)

if RENDER:
    cam, floor = setup_render()
    allm = [o for o, _ in MODELS]
    for o, meta in MODELS:
        for x in allm:
            x.hide_render = x is not o
        frame(cam, [o])
        render_to(os.path.join(OUT_PREV, meta['file'].replace('.glb', '.png')))

    # Ảnh tổng quan: xếp tất cả cạnh nhau theo tỉ lệ thật
    for x in allm:
        x.hide_render = False
    get = {meta['file'][:-4]: o for o, meta in MODELS}
    place = {
        'tu_mat': (-3.4, 0.4, 0), 'ke_hang': (-1.9, 0.3, 0), 'nguoi_kiem_ke': (-0.55, -0.3, 0),
        'nhan_vien': (0.35, -0.5, 0), 'quay_thu_ngan': (2.6, 0.5, 0), 'thung_carton': (1.2, -0.9, 0),
        'xe_day': (-1.2, -1.2, 0), 'bang_dong_lanh': (-2.7, -1.1, 0), 'may_cham_cong': (-2.0, -1.4, 0),
        'the_nhan_vien': (0.75, -1.5, 0), 'may_quet': (0.45, -1.5, 0),
    }
    for k, loc in place.items():
        get[k].location = loc
    get['thung_carton'].rotation_euler = (0, 0, 0.3)
    get['nguoi_kiem_ke'].rotation_euler = (0, 0, -0.35)
    get['xe_day'].rotation_euler = (0, 0, 0.5)
    # bày hàng lên kệ và tủ mát (chỉ để xem, không xuất)
    goods = [get[k] for k in ('hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua')]
    for g in goods:
        g.hide_render = True
    kx, ky, _ = place['ke_hang']
    for li, z in enumerate((0.175, 0.615, 1.055, 1.495)):
        src = goods[li % len(goods) if li < 3 else 4]
        step = {'hh_hop_banh': 0.17, 'hh_goi_mi': 0.16}.get(src.name, 0.085)
        n = int(1.16 / step)
        for i in range(n):
            if (li * 7 + i) % 9 == 4:
                continue  # chừa ô trống cho cảm giác "hết hàng"
            d = src.copy()
            scene.collection.objects.link(d)
            d.hide_render = False
            d.location = (kx - 0.58 + step / 2 + i * step, ky - 0.33, z)
    tx, ty, _ = place['tu_mat']
    for z in (0.25, 0.64, 1.06, 1.48):
        for i in range(10):
            src = goods[0] if z < 1 else goods[2]
            d = src.copy()
            scene.collection.objects.link(d)
            d.hide_render = False
            d.location = (tx - 0.4 + i * 0.09, ty - 0.12, z)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    cam.data.lens = 40
    frame(cam, [get[k] for k in place], direction=(0.3, -1.6, 0.9), pad=0.8)
    render_to(os.path.join(OUT_PREV, 'tong_quan.png'))

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('XONG', len(MODELS), 'model')
