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
    kinh_mo=M('kinh_mo', 0xc4e6ee, 0.2, 0.0, 0.0, 0.36),          # kính tủ lạnh hơi sương
    trong_tu=M('trong_tu', 0xdfe8ea, 0.6, 0.0, 0.35),             # lòng tủ lạnh: trắng, tự sáng nhẹ
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
    kem_hong=M('kem_hong', 0xe58fa8, 0.6),
    kem_nau=M('kem_nau', 0x5a3424, 0.7),
    dong_xanh=M('dong_xanh', 0x2f7fc1, 0.4),
    dong_trang=M('dong_trang', 0xeef3f5, 0.4),
    sc_vang=M('sc_vang', 0xf0c94a, 0.6),
)

# ---------------------------------------------------------------- hình khối
BONE = [None]  # xương đang gắn cho các khối tạo tiếp theo (chỉ dùng cho nhân vật)

def bo(name):
    BONE[0] = name

def _post(o, m):
    o.data.materials.append(m)
    if BONE[0]:
        o['bone'] = BONE[0]
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
    for p in P:  # mỗi khối gắn cứng 100% vào một xương
        if 'bone' in p:
            vg = p.vertex_groups.new(name=p['bone'])
            vg.add(list(range(len(p.data.vertices))), 1.0, 'REPLACE')
    BONE[0] = None
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
    W, D, H = 1.3, 1.0, 2.4
    box(P, (W, D * 0.9, 0.12), (0, 0, 0.06), C['thep_toi'])            # chân đế
    box(P, (W, 0.05, H - 0.12), (0, 0, 0.12 + (H - 0.12) / 2), C['thep'])  # vách giữa (pegboard)
    for x in (-W / 2 + 0.025, W / 2 - 0.025):
        box(P, (0.05, 0.12, H), (x, 0, H / 2), C['thep_toi'])          # trụ đứng
    for side in (-1, 1):
        for z in (0.16, 0.6, 1.04, 1.48, 1.92):
            box(P, (W - 0.08, 0.42, 0.03), (0, side * 0.25, z), C['thep'])
            box(P, (W - 0.08, 0.015, 0.06), (0, side * 0.465, z + 0.01), C['tem_gia'])  # dải tem giá
        for z in (0.16, 0.6, 1.04, 1.48, 1.92):
            for x in (-0.4, 0.1, 0.45):
                box(P, (0.05, 0.004, 0.03), (x, side * 0.474, z + 0.01), C['giay'])   # tem giá nhỏ
    box(P, (W, 0.06, 0.22), (0, 0, H + 0.11), C['thuong_hieu'])          # bảng đầu kệ
    return finish(P, 'ke_hang', 'Kệ hàng (module 1,3 m, cao 2,4 m)',
                  'Gondola 2 mặt, 5 tầng mỗi mặt, cao 2,4 m để che tia quét, dải tem giá vàng. Ghép 10 cái thành một dãy kệ 13 m. Hàng hoá đặt riêng (InstancedMesh).')

# 2. Người Kiểm Kê
def nguoi_kiem_ke():
    P = []
    U, Q, S, K = C['dong_phuc'], C['quan_kk'], C['da_kk'], C['nhua_den']
    # Quy ước bên: .L = phía +X (tay cầm máy quét), .R = phía -X (tay buông thõng)
    for sx, sd in ((1, 'L'), (-1, 'R')):
        bo('cang.' + sd)
        box(P, (0.11, 0.27, 0.07), (sx * 0.1, -0.04, 0.035), K, bev=0.01)          # giày
        limb(P, (sx * 0.1, 0, 0.07), (sx * 0.105, 0, 0.53), 0.055, Q, r2=0.064)     # cẳng chân
        ball(P, 0.064, (sx * 0.105, 0, 0.53), Q, sub=1)                             # đầu gối
        bo('dui.' + sd)
        limb(P, (sx * 0.105, 0, 0.53), (sx * 0.11, 0, 0.98), 0.064, Q, r2=0.075)    # đùi dài
    bo('hong')
    box(P, (0.34, 0.2, 0.16), (0, 0, 1.0), Q)                                     # hông
    bo('than')
    t = cyl(P, 0.17, 0.66, (0, 0, 1.4), U, n=8, r2=0.23)                          # thân
    t.scale = (1, 0.62, 1)
    box(P, (0.2, 0.03, 0.08), (0, -0.115, 1.7), C['giay'])                        # cổ áo
    box(P, (0.1, 0.012, 0.065), (-0.1, -0.138, 1.52), C['giay'])                  # thẻ tên trắng (trống)
    bo('co')
    limb(P, (0, 0.02, 1.7), (0, -0.03, 1.86), 0.045, S)                           # cổ hơi dài
    bo('dau')
    ball(P, 0.13, (0, -0.07, 1.93), S, scale=(0.95, 1.0, 1.18))                   # đầu không mặt, cúi về trước
    cyl(P, 0.145, 0.08, (0, -0.07, 2.07), K, n=10)                                # mũ
    box(P, (0.25, 0.14, 0.015), (0, -0.2, 2.035), K, rot=(0.25, 0, 0))            # lưỡi trai
    # tay buông thõng, dài quá hông (khó chịu khi nhìn lâu)
    bo('tay_tren.R')
    limb(P, (-0.25, 0, 1.66), (-0.29, 0.01, 1.25), 0.045, U, r2=0.04)
    bo('tay_duoi.R')
    ball(P, 0.042, (-0.29, 0.01, 1.25), U)
    limb(P, (-0.29, 0.01, 1.25), (-0.27, -0.02, 0.8), 0.04, U, r2=0.032)
    box(P, (0.05, 0.08, 0.14), (-0.27, -0.02, 0.71), S)                          # bàn tay
    # tay cầm máy quét ngang ngực, chĩa về trước
    bo('tay_tren.L')
    limb(P, (0.25, 0, 1.66), (0.28, -0.04, 1.3), 0.045, U, r2=0.04)
    bo('tay_duoi.L')
    ball(P, 0.042, (0.28, -0.04, 1.3), U)
    limb(P, (0.28, -0.04, 1.3), (0.15, -0.38, 1.25), 0.04, U, r2=0.032)
    box(P, (0.06, 0.09, 0.08), (0.14, -0.42, 1.23), S)
    box(P, (0.05, 0.06, 0.16), (0.12, -0.44, 1.18), K, rot=(0.3, 0, 0))           # tay cầm máy quét
    box(P, (0.11, 0.12, 0.09), (0.12, -0.5, 1.27), K, bev=0.008)                  # đầu máy quét
    box(P, (0.08, 0.01, 0.05), (0.12, -0.565, 1.27), C['den_do'])                 # mắt quét đỏ
    return finish(P, 'nguoi_kiem_ke', 'Người Kiểm Kê',
                  'Cao 2,05 m, gầy, đầu không mặt luôn cúi, tay trái dài quá hông, tay phải cầm máy quét ở độ cao 1,25 m (khớp SCANNER_Y). Thẻ tên để trống.')

# 3. Nhân viên (người chơi nhìn thấy nhau)
def nhan_vien():
    P = []
    A, G, Q, S = C['ao_nv'], C['gile_nv'], C['quan_nv'], C['da_nv']
    for sx, sd in ((1, 'L'), (-1, 'R')):
        bo('cang.' + sd)
        box(P, (0.11, 0.25, 0.08), (sx * 0.1, -0.03, 0.04), C['cao_su'], bev=0.012)
        limb(P, (sx * 0.1, 0, 0.08), (sx * 0.105, 0, 0.45), 0.065, Q, r2=0.072)
        ball(P, 0.072, (sx * 0.105, 0, 0.45), Q)
        bo('dui.' + sd)
        limb(P, (sx * 0.105, 0, 0.45), (sx * 0.11, 0, 0.84), 0.072, Q, r2=0.08)
    bo('hong')
    box(P, (0.34, 0.21, 0.15), (0, 0, 0.85), Q)
    bo('than')
    t = cyl(P, 0.19, 0.58, (0, 0, 1.2), G, n=8, r2=0.22)                           # gilê đỏ đồng phục
    t.scale = (1, 0.66, 1)
    box(P, (0.07, 0.03, 0.14), (0, -0.125, 1.42), A)                                # cổ áo sơ mi lộ ra
    box(P, (0.2, 0.05, 0.05), (0, -0.09, 1.48), A)
    box(P, (0.09, 0.012, 0.055), (0.1, -0.145, 1.34), C['giay'])                  # thẻ nhân viên
    bo('co')
    limb(P, (0, 0, 1.48), (0, 0, 1.56), 0.05, S)
    bo('dau')
    ball(P, 0.115, (0, -0.01, 1.66), S, scale=(0.95, 1.0, 1.1))
    ball(P, 0.12, (0, 0.015, 1.71), C['toc'], scale=(1.0, 1.0, 0.75))              # tóc
    for sx, sd in ((1, 'L'), (-1, 'R')):
        bo('tay_tren.' + sd)
        limb(P, (sx * 0.24, 0, 1.44), (sx * 0.27, 0, 1.12), 0.05, A, r2=0.045)
        bo('tay_duoi.' + sd)
        ball(P, 0.044, (sx * 0.27, 0, 1.12), S)
        limb(P, (sx * 0.27, 0, 1.12), (sx * 0.26, -0.06, 0.86), 0.042, S, r2=0.036)
        box(P, (0.05, 0.08, 0.1), (sx * 0.26, -0.07, 0.8), S)
    bo('may_quet_tay')                                                            # máy quét, chĩa theo cẳng tay
    box(P, (0.045, 0.05, 0.09), (0.26, -0.07, 0.8 - 0.06), C['nhua_den'])
    box(P, (0.07, 0.07, 0.13), (0.26, -0.07 - 0.02, 0.8 - 0.15), C['nhua_xam'], bev=0.008)
    box(P, (0.05, 0.03, 0.01), (0.26, -0.07 - 0.02, 0.8 - 0.218), C['den_do'])
    bo('den_pin_tay')                                                             # đèn pin, đầu đèn theo cẳng tay
    cyl(P, 0.024, 0.15, (-0.26, -0.07, 0.8 - 0.09), C['nhua_den'], n=8)
    cyl(P, 0.026, 0.05, (-0.26, -0.07, 0.8 - 0.18), C['nhom'], n=8, r2=0.038)
    cyl(P, 0.034, 0.006, (-0.26, -0.07, 0.8 - 0.207), C['den_vang'], n=8)
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

# Ba loại tủ lạnh bán hàng. Lòng tủ ĐỂ TRỐNG: game tự xếp hàng (InstancedMesh) lên các tầng ghi trong
# manifest ("tang_hang"), để khi hết hàng thì lấy hàng ra được và người chơi xếp lại.
# Toạ độ trong "tang_hang" theo Three.js: y = độ cao mặt tầng, z = khoảng sâu đặt hàng (+z = phía trước).

def tang_hang(name, layers):
    """Ghi các tầng đặt hàng vào manifest: [{y, x0, x1, z0, z1}] (mét, toạ độ Three.js)."""
    for o, meta in MODELS:
        if meta['file'] == name + '.glb':
            meta['tang_hang'] = [dict(y=round(y, 3), x0=x0, x1=x1, z0=z0, z1=z1) for (y, x0, x1, z0, z1) in layers]

# 5. Tủ mát cửa kính (nước, sữa)
TM_TANG = (0.215, 0.585, 0.955, 1.325, 1.695)   # mặt trên 5 tầng (đáy lòng tủ + 4 kệ lưới)
def tu_mat():
    P = []
    W, D, H = 1.0, 0.8, 2.1
    V = C['vo_tu']
    T = C['trong_tu']
    box(P, (W, D, 0.06), (0, 0, H - 0.03), V)                                    # nóc
    box(P, (W, 0.04, H), (0, D / 2 - 0.02, H / 2), V)                             # lưng
    for sx in (-1, 1):
        box(P, (0.04, D, H), (sx * (W / 2 - 0.02), 0, H / 2), V)                  # hông
    box(P, (W, D, 0.2), (0, 0, 0.1), C['nhua_xam'])                               # đế + máy nén
    for i in range(5):
        box(P, (W - 0.12, 0.004, 0.018), (0, -D / 2 - 0.002, 0.04 + i * 0.03), C['nhua_den'])  # khe tản nhiệt
    # Lòng tủ sáng màu: nhìn qua kính thấy rõ hàng và chỗ trống
    box(P, (W - 0.08, 0.01, H - 0.3), (0, D / 2 - 0.045, 0.2 + (H - 0.3) / 2), T)  # vách sau
    for sx in (-1, 1):
        box(P, (0.01, D - 0.12, H - 0.3), (sx * (W / 2 - 0.045), 0.02, 0.2 + (H - 0.3) / 2), T)
    box(P, (W - 0.08, D - 0.12, 0.015), (0, 0.02, TM_TANG[0] - 0.0075), T)        # đáy lòng tủ
    for z in TM_TANG[1:]:
        box(P, (W - 0.1, D - 0.18, 0.015), (0, 0.04, z - 0.0075), C['thep'])      # kệ lưới
        box(P, (W - 0.1, 0.008, 0.04), (0, -D / 2 + 0.13, z + 0.008), C['tem_gia'])  # nẹp giá phía trước
        for x in (-0.3, 0.05, 0.3):
            box(P, (0.06, 0.004, 0.025), (x, -D / 2 + 0.125, z + 0.008), C['giay'])
    for x in (-(W / 2 - 0.08), (W / 2 - 0.08)):                                   # đèn LED dọc hai bên
        box(P, (0.018, 0.018, H - 0.5), (x, -D / 2 + 0.1, 0.22 + (H - 0.5) / 2), C['den_lanh'])
    box(P, (W - 0.12, 0.03, 0.02), (0, -D / 2 + 0.12, H - 0.1), C['den_lanh'])    # đèn ngang trên
    box(P, (W, 0.08, 0.18), (0, -D / 2 + 0.03, H + 0.09), C['thuong_hieu'])       # bảng đèn trên nóc
    box(P, (W - 0.12, 0.01, 0.07), (0, -D / 2 - 0.015, H + 0.09), C['den_lanh'])
    for sx in (-1, 1):                                                            # 2 cánh cửa kính
        cx = sx * W / 4
        dw = W / 2 - 0.02
        y = -D / 2 + 0.02
        box(P, (dw, 0.04, 0.05), (cx, y, H - 0.06), C['thep_toi'])
        box(P, (dw, 0.04, 0.05), (cx, y, 0.225), C['thep_toi'])
        box(P, (0.045, 0.04, H - 0.3), (cx - sx * (dw / 2 - 0.0225), y, H / 2 + 0.1), C['thep_toi'])
        box(P, (0.045, 0.04, H - 0.3), (cx + sx * (dw / 2 - 0.0225), y, H / 2 + 0.1), C['thep_toi'])
        box(P, (dw - 0.09, 0.008, H - 0.36), (cx, y, H / 2 + 0.1), C['kinh_mo'])
        box(P, (0.025, 0.04, 0.45), (cx - sx * (dw / 2 - 0.08), y - 0.035, 1.15), C['nhom'])  # tay nắm
        box(P, (0.012, 0.03, 0.04), (cx - sx * (dw / 2 - 0.08), y - 0.015, 1.38), C['nhom'])
        box(P, (0.012, 0.03, 0.04), (cx - sx * (dw / 2 - 0.08), y - 0.015, 0.92), C['nhom'])
    o = finish(P, 'tu_mat', 'Tủ mát cửa kính',
               '1,0×2,1 m, 2 cánh kính hơi sương, lòng tủ sáng, 5 tầng (đáy + 4 kệ lưới có nẹp giá), đèn LED dọc. '
               'Lòng tủ để trống: game tự xếp nước, sữa vào các tầng (xem tang_hang).')
    tang_hang('tu_mat', [(z, -0.44, 0.44, -0.3, 0.27) for z in TM_TANG])
    return o

# 5b. Ngăn mát mở (kệ lạnh không cửa): sữa chua, sữa, rau củ
KM_TANG = (0.64, 0.99, 1.31, 1.63)
def ke_mat():
    P = []
    W, D, H = 1.25, 0.85, 2.0
    V = C['vo_tu']
    T = C['trong_tu']
    for sx in (-1, 1):                                                            # hông bậc thang
        x = sx * (W / 2 - 0.02)
        box(P, (0.04, D, 0.9), (x, 0, 0.45), V)
        box(P, (0.04, D * 0.62, H - 0.9), (x, D * 0.19, 0.9 + (H - 0.9) / 2), V)
        box(P, (0.042, 0.02, 0.9), (x, -D / 2 + 0.01, 0.45), C['thuong_hieu'])    # nẹp đỏ mép hông
    box(P, (W, 0.05, H), (0, D / 2 - 0.025, H / 2), V)                            # lưng
    box(P, (W - 0.08, 0.01, H - 0.7), (0, D / 2 - 0.055, 0.68 + (H - 0.7) / 2), T)  # vách trong sáng
    box(P, (W, 0.14, 0.62), (0, -D / 2 + 0.07, 0.31), V)                          # mặt trước đế
    box(P, (W - 0.04, D - 0.2, 0.62), (0, 0.06, 0.31), C['nhua_xam'])             # khối máy
    box(P, (W, 0.02, 0.08), (0, -D / 2 - 0.01, 0.42), C['thuong_hieu'])           # dải chắn va
    for i in range(4):
        box(P, (W - 0.16, 0.004, 0.012), (0, -D / 2 - 0.002, 0.08 + i * 0.026), C['nhua_den'])  # lưới gió
    box(P, (W - 0.06, D - 0.14, 0.02), (0, 0.04, KM_TANG[0] - 0.01), T)            # khay đáy (tầng 1)
    box(P, (W - 0.1, 0.03, 0.012), (0, -D / 2 + 0.17, KM_TANG[0] + 0.004), C['den_lanh'])  # khe gió lạnh
    box(P, (W - 0.06, 0.01, 0.07), (0, -D / 2 + 0.1, KM_TANG[0] + 0.02), C['kinh'])  # tấm chắn trước khay
    for i, z in enumerate(KM_TANG[1:]):                                           # 3 kệ, càng lên càng ngắn
        d = 0.5 - i * 0.04
        yb = D / 2 - 0.06
        box(P, (W - 0.08, d, 0.02), (0, yb - d / 2, z - 0.01), C['thep'])
        box(P, (W - 0.08, 0.008, 0.045), (0, yb - d - 0.004, z + 0.01), C['tem_gia'])
        for x in (-0.4, 0, 0.4):
            box(P, (0.06, 0.004, 0.025), (x, yb - d - 0.01, z + 0.012), C['giay'])
    box(P, (W, 0.52, 0.06), (0, D / 2 - 0.26, H - 0.03), V)                       # mái che
    box(P, (W, 0.04, 0.15), (0, D / 2 - 0.52, H - 0.075), C['thuong_hieu'])       # viền mái
    box(P, (W - 0.1, 0.01, 0.06), (0, D / 2 - 0.545, H - 0.075), C['den_lanh'])   # đèn viền
    box(P, (W - 0.1, 0.04, 0.015), (0, D / 2 - 0.4, H - 0.07), C['den_lanh'])     # đèn dưới mái
    cyl(P, 0.03, W - 0.1, (0, D / 2 - 0.46, H - 0.18), C['nhua_xam'], n=8, rot=(0, math.pi / 2, 0))  # rèm đêm cuộn
    o = finish(P, 'ke_mat', 'Ngăn mát mở (kệ lạnh)',
               '1,25×2,0 m, không cửa, 4 tầng (khay đáy + 3 kệ ngắn dần), mái có đèn, rèm đêm cuộn trên cao, '
               'khe gió lạnh xanh. Đặt thành dãy dọc tường; game tự xếp hàng.')
    tang_hang('ke_mat', [(KM_TANG[0], -0.56, 0.56, -0.3, 0.26)] +
              [(z, -0.56, 0.56, -(D / 2 - 0.06), -(D / 2 - 0.06) + 0.5 - i * 0.04 - 0.02) for i, z in enumerate(KM_TANG[1:])])
    return o

# 5c. Tủ đông nằm (kem, đồ đông lạnh), nắp kính trượt
TD_DAY = 0.5   # đáy lòng tủ cao: hàng chất gần miệng tủ, nhìn qua nắp kính thấy rõ
def tu_dong():
    P = []
    W, D, H = 1.8, 0.9, 0.85
    V = C['vo_tu']
    T = C['trong_tu']
    box(P, (W, 0.06, H), (0, -D / 2 + 0.03, H / 2), V)                            # 4 vách
    box(P, (W, 0.06, H), (0, D / 2 - 0.03, H / 2), V)
    for sx in (-1, 1):
        box(P, (0.06, D - 0.12, H), (sx * (W / 2 - 0.03), 0, H / 2), V)
    box(P, (W - 0.12, D - 0.12, TD_DAY), (0, 0, TD_DAY / 2), C['nhua_xam'])         # đáy + máy nén
    box(P, (W - 0.12, D - 0.12, 0.01), (0, 0, TD_DAY - 0.005), T)                   # đáy lòng tủ
    box(P, (W - 0.14, 0.008, H - TD_DAY - 0.04), (0, -D / 2 + 0.065, TD_DAY + (H - TD_DAY) / 2 - 0.02), T)
    box(P, (W - 0.14, 0.008, H - TD_DAY - 0.04), (0, D / 2 - 0.065, TD_DAY + (H - TD_DAY) / 2 - 0.02), T)
    box(P, (0.025, D - 0.14, 0.3), (0, 0, TD_DAY + 0.15), C["thep"])               # vách ngăn giữa (2 ngăn)
    box(P, (W + 0.02, D + 0.02, 0.07), (0, 0, 0.13), C['thuong_hieu'])            # dải chắn va quanh thân
    for i in range(4):
        box(P, (0.5, 0.004, 0.014), (W / 2 - 0.4, -D / 2 - 0.012, 0.25 + i * 0.03), C['nhua_den'])  # lưới gió
    box(P, (0.09, 0.004, 0.035), (-W / 2 + 0.16, -D / 2 - 0.002, H - 0.12), C['nhua_den'])
    box(P, (0.07, 0.003, 0.022), (-W / 2 + 0.16, -D / 2 - 0.005, H - 0.12), C['den_xanh'])  # nhiệt kế -18°C
    for (w, d, x, y) in ((W, 0.08, 0, -D / 2 + 0.04), (W, 0.08, 0, D / 2 - 0.04), (0.08, D, -W / 2 + 0.04, 0), (0.08, D, W / 2 - 0.04, 0)):
        box(P, (w, d, 0.035), (x, y, H + 0.0175), C['nhua_xam'])                  # viền miệng tủ
    for i, sx in enumerate((-1, 1)):                                              # 2 nắp kính trượt, lệch tầng
        cx = sx * (W / 4 - 0.02) + (0.18 if i == 0 else 0)                       # nắp trái hé mở
        z = H + 0.04 + i * 0.018
        box(P, (W / 2 - 0.06, D - 0.12, 0.01), (cx, 0, z), C['kinh_mo'])
        box(P, (W / 2 - 0.06, 0.03, 0.02), (cx, -D / 2 + 0.075, z), C['nhom'])
        box(P, (W / 2 - 0.06, 0.03, 0.02), (cx, D / 2 - 0.075, z), C['nhom'])
        box(P, (0.04, 0.12, 0.025), (cx - sx * (W / 4 - 0.07), -0.2, z + 0.012), C['nhua_den'])  # tay kéo
    o = finish(P, 'tu_dong', 'Tủ đông nằm',
               '1,8×0,9×0,85 m, 2 nắp kính trượt (nắp trái hé mở), lòng tủ chia 2 ngăn bằng vách thép, '
               'nhiệt kế xanh. Hàng xếp nằm dưới đáy (tang_hang), nhìn qua nắp kính.')
    tang_hang('tu_dong', [(TD_DAY, -0.84, -0.03, -0.37, 0.37), (TD_DAY, 0.03, 0.84, -0.37, 0.37)])
    return o

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

# Hàng lạnh
def kem_hop():
    P = []
    cyl(P, 0.058, 0.075, (0, 0, 0.0375), C['kem_hong'], n=10, r2=0.064)
    cyl(P, 0.066, 0.014, (0, 0, 0.082), C['nap_trang'], n=10)
    box(P, (0.05, 0.004, 0.03), (0, -0.061, 0.04), C['kem_nau'], rot=(0.08, 0, 0))
    return finish(P, 'hh_kem', 'Hộp kem', 'Hộp tròn 13 cm, cao 9 cm. Xếp chồng trong tủ đông.')

def goi_dong():
    P = []
    box(P, (0.2, 0.27, 0.045), (0, 0, 0.0225), C['dong_xanh'], bev=0.012)          # túi nằm phẳng
    box(P, (0.13, 0.11, 0.004), (0, -0.05, 0.046), C['dong_trang'])                # cửa sổ thấy hàng
    box(P, (0.202, 0.04, 0.03), (0, 0.1, 0.022), C['mi_do'])                       # dải đỏ
    return finish(P, 'hh_goi_dong', 'Gói đồ đông lạnh', '20×27 cm, nằm phẳng (sủi cảo, xúc xích). Xếp lớp trong tủ đông.')

def sua_chua():
    P = []
    for x in (-0.034, 0.034):
        for y in (-0.034, 0.034):
            cyl(P, 0.031, 0.06, (x, y, 0.03), C['sua_trang'], n=8, r2=0.027)
            cyl(P, 0.029, 0.004, (x, y, 0.062), C['nhom'], n=8)
    box(P, (0.14, 0.14, 0.025), (0, 0, 0.03), C['sc_vang'])                        # đai giấy lốc 4
    return finish(P, 'hh_sua_chua', 'Lốc sữa chua', '4 hũ, 14×14 cm, cao 6,5 cm. Bày ở ngăn mát.')

# 3b. Nhân viên bản ngố (để so sánh): lùn, đầu to, tay to, mắt chấm, thẻ đeo cổ to đung đưa
def nhan_vien_ngo():
    P = []
    A, G, Q, S = C['ao_nv'], C['gile_nv'], C['quan_nv'], C['da_nv']
    for sx, sd in ((1, 'L'), (-1, 'R')):
        bo('cang.' + sd)
        box(P, (0.15, 0.3, 0.1), (sx * 0.12, -0.04, 0.05), C['cao_su'], bev=0.025)
        limb(P, (sx * 0.12, 0, 0.1), (sx * 0.12, 0, 0.31), 0.075, Q, r2=0.08)
        ball(P, 0.08, (sx * 0.12, 0, 0.31), Q)
        bo('dui.' + sd)
        limb(P, (sx * 0.12, 0, 0.31), (sx * 0.12, 0, 0.52), 0.08, Q, r2=0.09)
    bo('hong')
    box(P, (0.42, 0.3, 0.16), (0, 0, 0.55), Q, bev=0.02)
    bo('than')
    t = cyl(P, 0.28, 0.56, (0, 0, 0.88), G, n=10, r2=0.25)                        # gilê thùng thình
    t.scale = (1, 0.78, 1)
    box(P, (0.16, 0.05, 0.1), (0, -0.19, 1.12), A)                                # cổ áo
    box(P, (0.06, 0.03, 0.06), (0.17, -0.2, 0.75), C['tem_gia'])                  # cúc áo / túi
    box(P, (0.06, 0.03, 0.06), (-0.17, -0.2, 0.75), C['tem_gia'])
    bo('co')
    limb(P, (0, 0, 1.14), (0, 0, 1.2), 0.07, S)
    bo('dau')
    ball(P, 0.23, (0, 0, 1.38), S, sub=2)                                         # đầu to tròn
    for sx in (-1, 1):
        box(P, (0.045, 0.03, 0.075), (sx * 0.085, -0.205, 1.39), C['nhua_den'])  # mắt chấm
    box(P, (0.06, 0.02, 0.015), (0, -0.22, 1.29), C['banh_nau'])                  # miệng
    cyl(P, 0.225, 0.13, (0, 0, 1.55), G, n=12)                                    # mũ đồng phục
    box(P, (0.3, 0.2, 0.025), (0, -0.25, 1.5), G, rot=(0.12, 0, 0))              # lưỡi trai
    bo('day_the')                                                                 # dây + thẻ to, đung đưa
    limb(P, (-0.08, -0.17, 1.12), (0, -0.235, 0.86), 0.012, C['sua_xanh'], n=4)
    limb(P, (0.08, -0.17, 1.12), (0, -0.235, 0.86), 0.012, C['sua_xanh'], n=4)
    box(P, (0.16, 0.015, 0.2), (0, -0.24, 0.76), C['giay'])
    box(P, (0.16, 0.017, 0.04), (0, -0.24, 0.84), C['thuong_hieu'])
    box(P, (0.05, 0.017, 0.06), (-0.04, -0.24, 0.74), C['nhua_xam'])
    for sx, sd in ((1, 'L'), (-1, 'R')):
        bo('tay_tren.' + sd)
        limb(P, (sx * 0.29, 0, 1.1), (sx * 0.34, 0, 0.88), 0.07, A, r2=0.06)
        ball(P, 0.075, (sx * 0.29, 0, 1.1), A)
        bo('tay_duoi.' + sd)
        limb(P, (sx * 0.34, 0, 0.88), (sx * 0.34, -0.03, 0.69), 0.055, S, r2=0.05)
        box(P, (0.11, 0.12, 0.13), (sx * 0.34, -0.04, 0.62), S, bev=0.03)        # bàn tay to (găng)

    bo('may_quet_tay')                                                            # máy quét, chĩa theo cẳng tay
    box(P, (0.045, 0.05, 0.09), (0.34, -0.05, 0.6 - 0.06), C['nhua_den'])
    box(P, (0.07, 0.07, 0.13), (0.34, -0.05 - 0.02, 0.6 - 0.15), C['nhua_xam'], bev=0.008)
    box(P, (0.05, 0.03, 0.01), (0.34, -0.05 - 0.02, 0.6 - 0.218), C['den_do'])
    bo('den_pin_tay')                                                             # đèn pin, đầu đèn theo cẳng tay
    cyl(P, 0.024, 0.15, (-0.34, -0.05, 0.6 - 0.09), C['nhua_den'], n=8)
    cyl(P, 0.026, 0.05, (-0.34, -0.05, 0.6 - 0.18), C['nhom'], n=8, r2=0.038)
    cyl(P, 0.034, 0.006, (-0.34, -0.05, 0.6 - 0.207), C['den_vang'], n=8)
    bo('thung')                                                                   # thùng chỉ hiện khi "đóng thùng"
    box(P, (0.8, 0.8, 0.9), (0, 0.2, 0.45), C['carton'], bev=0.015)
    box(P, (0.14, 0.82, 0.008), (0, 0.2, 0.902), C['bang_keo'])
    box(P, (0.34, 0.006, 0.18), (0, -0.203, 0.6), C['giay'])
    for i in range(3):
        box(P, (0.26, 0.004, 0.018), (0, -0.207, 0.65 - i * 0.045), C['nhua_den'])
    return finish(P, 'nhan_vien_ngo', 'Nhân viên (bản ngố)',
                  'Cao 1,61 m, đầu và tay to, mắt chấm, gilê rộng, thẻ đeo cổ to đung đưa. Có sẵn thùng carton ẩn để diễn cảnh "đóng thùng".')

def den_pin():
    P = []
    cyl(P, 0.022, 0.15, (0, 0, 0.022), C['nhua_den'], n=10, rot=(math.pi / 2, 0, 0))
    cyl(P, 0.024, 0.05, (0, -0.1, 0.022), C['nhom'], n=10, rot=(math.pi / 2, 0, 0), r2=0.036)
    cyl(P, 0.033, 0.006, (0, -0.128, 0.022), C['den_vang'], n=10, rot=(math.pi / 2, 0, 0))
    box(P, (0.014, 0.03, 0.01), (0, 0.01, 0.046), C['thuong_hieu'])
    return finish(P, 'den_pin', 'Đèn pin', 'Dài 18 cm. Mỗi người một cái, dùng khi siêu thị mất điện.')

builders = [ke_hang, nguoi_kiem_ke, nhan_vien, nhan_vien_ngo, thung_carton, tu_mat, ke_mat, tu_dong, quay_thu_ngan,
            bang_dong_lanh, may_cham_cong, the_nhan_vien, may_quet, den_pin, xe_day, lon_nuoc, hop_banh, chai_nuoc,
            goi_mi, hop_sua, kem_hop, goi_dong, sua_chua]
for b in builders:
    b()

# ================================================================ XƯƠNG + CHUYỂN ĐỘNG
# Góc khai báo theo trục THẾ GIỚI (độ), Blender: X ngang, Y ra sau (mặt trước là -Y), Z lên.
#   Xương chĩa xuống (đùi, cẳng, tay): rx âm = đưa ra trước, rx dương = ra sau.
#   Xương chĩa lên (thân, đầu):        rx dương = cúi tới trước, rx âm = ngửa ra sau.
#   rz dương = xoay sang phía +X (bên .L). ry = nghiêng sang bên.
from mathutils import Euler, Matrix

FPS = 30
scene.render.fps = FPS
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
RIGS = {}       # tên model -> armature
ACTIONS = {}    # tên model -> [action]

def clamp01(x):
    return max(0.0, min(1.0, x))

def seg(t, a, b):
    """0 trước a, 1 sau b, mượt ở giữa."""
    u = clamp01((t - a) / (b - a))
    return u * u * (3 - 2 * u)

def snap(t, a, b):
    """Giật nhanh rồi hãm (ease-out mạnh)."""
    u = clamp01((t - a) / (b - a))
    return 1 - (1 - u) ** 4

def pulse(t, c, w=0.06):
    return math.exp(-((t - c) / w) ** 2)

def make_rig(o, name, bones):
    ad = bpy.data.armatures.new(name + '_xuong')
    arm = bpy.data.objects.new(name + '_rig', ad)
    scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bn, h, t, par in bones:
        e = ad.edit_bones.new(bn)
        e.head, e.tail, e.roll = h, t, 0.0
        if par:
            e.parent = ad.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    o.parent = arm
    mod = o.modifiers.new('xuong', 'ARMATURE')
    mod.object = arm
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    arm.animation_data_create()
    RIGS[o.name] = arm
    return arm

def make_clips(arm, model_name, clips, loc_bones=('goc',), scales=None):
    scales = scales or {}
    Bm = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    names = list(Bm)
    acts = []
    for cname, secs, fn in clips:
        act = bpy.data.actions.new(f'{model_name}__{cname}')
        act['clip'] = cname
        act.use_fake_user = True
        arm.animation_data.action = act
        prev = {}
        n = round(secs * FPS)
        for f in range(n + 1):
            t = f / FPS
            d = fn(t, secs)
            for bn in names:
                rx, ry, rz = d.get(bn, (0, 0, 0))
                Rw = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix()
                q = (Bm[bn].inverted() @ Rw @ Bm[bn]).to_quaternion()
                if bn in prev:
                    q.make_compatible(prev[bn])
                prev[bn] = q
                pb = arm.pose.bones[bn]
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            for bn in loc_bones:   # '_loc' cho xương gốc, '@tên' cho xương khác (toạ độ thế giới)
                v = d.get('_loc', (0, 0, 0)) if bn == 'goc' else d.get('@' + bn, (0, 0, 0))
                pb = arm.pose.bones[bn]
                pb.location = Bm[bn].inverted() @ Vector(v)
                pb.keyframe_insert('location', frame=f + 1)
            for bn, dv in scales.items():   # '%tên' = tỉ lệ đều
                s = d.get('%' + bn, dv)
                pb = arm.pose.bones[bn]
                pb.scale = (s, s, s)
                pb.keyframe_insert('scale', frame=f + 1)
        arm.animation_data.action = None
        acts.append(act)
    ACTIONS[model_name] = acts
    reset_pose(arm)

REST_SCALE = {}  # armature -> {xương: tỉ lệ ở tư thế nghỉ}

def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        s = REST_SCALE.get(arm.name, {}).get(pb.name, 1.0)
        pb.scale = (s, s, s)

def legs_walk(d, p, A, K, base_knee=4.0):
    for sd, ph in (('L', p), ('R', p + math.pi)):
        d['dui.' + sd] = (-A * math.sin(ph), 0, 0)
        d['cang.' + sd] = (base_knee + K * max(0.0, math.cos(ph)) ** 2, 0, 0)

def leg_comp(a, b, Lt, Ls):
    """Bù vị trí gốc để bàn chân đứng yên khi gập đùi a và gối b (độ)."""
    a, ab = math.radians(a), math.radians(a + b)
    ny = Lt * math.sin(a) + Ls * math.sin(ab)
    nz = -Lt * math.cos(a) - Ls * math.cos(ab)
    return (0.0, -ny, -(Lt + Ls) - nz)

# ---------- Người Kiểm Kê: chậm, đều, cứng, không bao giờ chạy
def kk_di(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 17, 26)
    d['hong'] = (0, 3 * s, 4 * s)
    d['than'] = (4, 0, -3 * s)
    d['tay_tren.R'] = (-5 * s, 0, 0)
    d['tay_duoi.R'] = (-2 - 3 * math.sin(p - 0.5), 0, 0)
    d['tay_tren.L'] = (1.5 * math.sin(2 * p), 0, 0)
    tick = 7 * pulse(t / T, 0.62, 0.025)      # đầu giật nhẹ một nhịp mỗi chu kỳ
    d['dau'] = (0, 0, 2 * s + tick)
    d['_loc'] = (0, 0, -0.022 * s * s)
    return d

def kk_chay(t, T):
    """Chạy cứng đơ: sải dài, tay cầm máy quét khoá cứng phía trước, tay kia bị kéo lê ra sau."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 34, 70, base_knee=8)
    d['hong'] = (0, 2 * s, 3 * s)
    d['than'] = (12, 0, -2 * s)
    d['dau'] = (-10, 0, 0)                     # đầu khoá cứng, nhìn thẳng
    d['tay_tren.L'] = (-8, 0, 0)
    d['tay_tren.R'] = (18 + 3 * s, 0, 0)
    d['tay_duoi.R'] = (6, 0, 0)
    d['_loc'] = (0, 0, -0.04 * s * s)
    return d

def kk_dung(t, T):
    p = 2 * math.pi * t / T
    return {
        'than': (1.0 * math.sin(p), 0, 0),
        'dau': (0, 5 * math.sin(p), 1.5 * math.sin(2 * p)),
        'tay_tren.L': (2 * math.sin(p + 1), 0, 0),
        'tay_tren.R': (0.8 * math.sin(p + 2), 0, 0),
    }

def kk_quet(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    return {
        'hong': (0, 0, 4 * s),
        'than': (3, 0, 14 * s),
        'dau': (-5, 0, 22 * math.sin(p - 0.6)),
        'tay_tren.L': (-12, 0, 8 * s),
        'tay_duoi.L': (-4, 0, 0),
        'tay_tren.R': (0, 0, -2 * s),
    }

def kk_quay_dau(t, T):
    back = seg(t, 1.8, 2.4)
    sn = snap(t, 0.35, 0.47) * (1 - back)
    fol = seg(t, 0.8, 1.4) * (1 - back)
    total = 80 * sn
    spine = 35 * fol
    jit = 2.0 * math.sin(t * 55) * (seg(t, 0.47, 0.6) - seg(t, 1.6, 1.8))
    return {
        'than': (0, 0, spine),
        'dau': (0, 12 * sn, total - spine + jit),
        'tay_tren.L': (-6 * fol, 0, 15 * fol),
        'tay_tren.R': (0, 0, 4 * fol),
    }

def kk_dem(t, T):
    up = seg(t, 0.0, 0.45) * (1 - seg(t, 2.5, 2.8))
    p1, p2 = pulse(t, 1.0), pulse(t, 1.8)      # "Một…"  "Hai…"
    return {
        'than': (16 * up + 5 * (p1 + p2), 0, 0),
        'dau': (-18 * up, 22 * up, 6 * p1 - 6 * p2),
        'tay_tren.L': (-30 * up, 0, 0),
        'tay_duoi.L': (-10 * up - 3 * (p1 + p2), 0, 0),
        'tay_tren.R': (-4 * up, 0, 0),
    }

# ---------- Nhân viên
NV_LT, NV_LS = 0.39, 0.37

def nv_dung(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    return {
        'than': (1.2 * s, 0, 0),
        'dau': (0, 0, 3 * math.sin(p * 0.5) ** 3),
        'tay_tren.L': (1.5 * s, 0, 0), 'tay_tren.R': (1.5 * s, 0, 0),
        'tay_duoi.L': (-6, 0, 0), 'tay_duoi.R': (-6, 0, 0),
        '_loc': (0, 0, 0.004 * s),
    }

def nv_walk(t, T, A, K, arm, elbow, lean, bob):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, A, K)
    d['hong'] = (0, 0, 6 * s)
    d['than'] = (lean, 0, -5 * s)
    d['dau'] = (-lean * 0.5, 0, 3 * s)
    for sd, sign in (('L', -1), ('R', 1)):
        f = sign * s                       # tay ngược pha với chân cùng bên
        d['tay_tren.' + sd] = (-arm * f, 0, 0)
        d['tay_duoi.' + sd] = (-elbow - 0.4 * arm * max(0.0, f), 0, 0)
    d['_loc'] = (0, 0, -bob * s * s)
    return d

def nv_di(t, T):
    return nv_walk(t, T, 24, 50, 20, 10, 3, 0.03)

def nv_chay(t, T):
    return nv_walk(t, T, 40, 85, 38, 75, 12, 0.05)

def nv_be_thung(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 18, 38)
    bounce = 2 * math.sin(2 * p)
    d['hong'] = (0, 0, 4 * s)
    d['than'] = (-5, 0, -3 * s)
    d['tay_tren.L'] = (-50 + bounce, 10, 0)
    d['tay_tren.R'] = (-50 + bounce, -10, 0)
    d['tay_duoi.L'] = (-50, 0, 0)
    d['tay_duoi.R'] = (-50, 0, 0)
    d['_loc'] = (0, 0, -0.02 * s * s)
    return d

def quet_mot_tay(t, T, extra=None):
    """Một tay (.L) cầm máy quét chĩa vào kệ, quét qua lại; tay kia buông thả."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {
        'than': (4, 0, 5 * s),
        'dau': (12, 0, 8 * math.sin(p - 0.4)),
        'tay_tren.L': (-62, 0, 12 * s),
        'tay_duoi.L': (-26, 0, 0),
        'tay_tren.R': (2 * s, 4, 0),
        'tay_duoi.R': (-8, 0, 0),
        '%may_quet_tay': 1.0,
    }
    if extra:
        d.update(extra)
    return d

def nv_quet_hang(t, T):
    return quet_mot_tay(t, T)

def cam_den(d, t, T, walking):
    """Tay .R cầm đèn pin chĩa tới trước, soi qua lại; đầu ngó theo."""
    p = 2 * math.pi * t / T
    sweep = 9 * math.sin(p) if walking else 26 * math.sin(p)
    d['tay_tren.R'] = (-58 + (2 * math.sin(2 * p) if walking else 0), 0, sweep * 0.6)
    d['tay_duoi.R'] = (-30, 0, sweep * 0.4)
    old = d.get('dau', (0, 0, 0))
    d['dau'] = (old[0] + 4, old[1], old[2] + sweep * 0.7)
    th = d.get('than', (0, 0, 0))
    d['than'] = (th[0] + 6, th[1], th[2])            # hơi khom, rón rén
    d['%den_pin_tay'] = 1.0
    return d

def nv_di_den_pin(t, T):
    return cam_den(nv_walk(t, T, 20, 42, 14, 10, 0, 0.025), t, T, True)

def nv_dung_den_pin(t, T):
    return cam_den(nv_dung(t, T), t, T, False)

def nv_dong_thung(t, T):
    st = seg(t, 0.0, 0.15) * (1 - seg(t, 0.55, 0.75))   # giãy giụa
    u = seg(t, 0.6, 1.4)                                 # co người lại như bị nhét vào thùng
    shake = math.sin(t * 32)
    tremble = 1.5 * math.sin(t * 50) * u
    a, b = -100 * u, 130 * u
    d = {
        'dui.L': (a, 0, 0), 'dui.R': (a, 0, 0),
        'cang.L': (b, 0, 0), 'cang.R': (b, 0, 0),
        'than': (45 * u + tremble, 0, 8 * shake * st),
        'dau': (25 * u - 10 * st, 0, 10 * math.sin(t * 27) * st),
        'tay_tren.L': (-70 * st + 20 * shake * st - 40 * u, 20 * st + 25 * u, 0),
        'tay_tren.R': (-70 * st - 20 * shake * st - 40 * u, -20 * st - 25 * u, 0),
        'tay_duoi.L': (-30 * st - 100 * u, 0, 0),
        'tay_duoi.R': (-30 * st - 100 * u, 0, 0),
    }
    d['_loc'] = leg_comp(a, b, NV_LT, NV_LS)
    return d

def bones_human(hip_z, chest, neck_top, head_top, head_y, shoulders, elbows, wrists, knees, ankles, hips_x=0.1):
    B = [('goc', (0, 0, 0), (0, 0, 0.2), None),
         ('hong', (0, 0, hip_z), (0, 0, hip_z + 0.1), 'goc'),
         ('than', (0, 0, hip_z + 0.1), (0, 0, chest), 'hong'),
         ('co', (0, 0, chest), (0, head_y[0], neck_top), 'than'),
         ('dau', (0, head_y[0], neck_top), (0, head_y[1], head_top), 'co')]
    for sd in ('L', 'R'):
        sx = 1 if sd == 'L' else -1
        B.append(('tay_tren.' + sd, shoulders[sd], elbows[sd], 'than'))
        B.append(('tay_duoi.' + sd, elbows[sd], wrists[sd], 'tay_tren.' + sd))
        B.append(('dui.' + sd, (sx * hips_x, 0, hip_z), knees[sd], 'hong'))
        B.append(('cang.' + sd, knees[sd], ankles[sd], 'dui.' + sd))
    return B

objs = {o.name: o for o, _ in MODELS}
metas = {m['file'][:-4]: m for _, m in MODELS}

arm = make_rig(objs['nguoi_kiem_ke'], 'nguoi_kiem_ke', bones_human(
    0.98, 1.7, 1.86, 2.1, (-0.03, -0.07),
    shoulders={'L': (0.25, 0, 1.66), 'R': (-0.25, 0, 1.66)},
    elbows={'L': (0.28, -0.04, 1.3), 'R': (-0.29, 0.01, 1.25)},
    wrists={'L': (0.15, -0.38, 1.25), 'R': (-0.27, -0.02, 0.8)},
    knees={'L': (0.105, 0, 0.53), 'R': (-0.105, 0, 0.53)},
    ankles={'L': (0.1, 0, 0.07), 'R': (-0.1, 0, 0.07)}, hips_x=0.11))
KK_CLIPS = [('di', 1.8, kk_di, 'Đi tuần (chậm, đều)', True),
            ('chay', 0.8, kk_chay, 'Chạy (khi mất điện, nghe tiếng động)', True),
            ('dung_im', 4.0, kk_dung, 'Đứng im', True),
            ('quet', 3.2, kk_quet, 'Quét qua lại', True),
            ('quay_dau', 2.4, kk_quay_dau, 'Quay đầu giật (nghe tiếng động)', True),
            ('dem', 2.8, kk_dem, 'Đếm "Một… Hai…"', True)]
make_clips(arm, 'nguoi_kiem_ke', [(c[0], c[1], c[2]) for c in KK_CLIPS])
metas['nguoi_kiem_ke']['chuyen_dong'] = [dict(ten=c[0], nhan=c[3], lap=c[4]) for c in KK_CLIPS]

arm = make_rig(objs['nhan_vien'], 'nhan_vien', bones_human(
    0.84, 1.48, 1.56, 1.8, (0.0, -0.01),
    shoulders={'L': (0.24, 0, 1.44), 'R': (-0.24, 0, 1.44)},
    elbows={'L': (0.27, 0, 1.12), 'R': (-0.27, 0, 1.12)},
    wrists={'L': (0.26, -0.06, 0.86), 'R': (-0.26, -0.06, 0.86)},
    knees={'L': (0.105, 0, 0.45), 'R': (-0.105, 0, 0.45)},
    ankles={'L': (0.1, 0, 0.08), 'R': (-0.1, 0, 0.08)}, hips_x=0.11) + [
    ('may_quet_tay', (0.26, -0.07, 0.8), (0.26, -0.07, 0.6), 'tay_duoi.L'),
    ('den_pin_tay', (-0.26, -0.07, 0.8), (-0.26, -0.07, 0.6), 'tay_duoi.R')])
NV_CLIPS = [('dung', 3.0, nv_dung, 'Đứng thở', True),
            ('di', 1.0, nv_di, 'Đi', True),
            ('chay', 0.66, nv_chay, 'Chạy', True),
            ('be_thung', 1.2, nv_be_thung, 'Bê thùng đi', True),
            ('quet_hang', 2.4, nv_quet_hang, 'Quét hàng (1 tay)', True),
            ('di_den_pin', 1.15, nv_di_den_pin, 'Đi soi đèn pin (mất điện)', True),
            ('dung_den_pin', 4.0, nv_dung_den_pin, 'Đứng soi đèn pin', True),
            ('dong_thung', 2.2, nv_dong_thung, 'Bị "đóng thùng"', False)]
REST_SCALE[arm.name] = {'may_quet_tay': 0.0, 'den_pin_tay': 0.0}
make_clips(arm, 'nhan_vien', [(c[0], c[1], c[2]) for c in NV_CLIPS],
           scales={'may_quet_tay': 0.0, 'den_pin_tay': 0.0})
metas['nhan_vien']['chuyen_dong'] = [dict(ten=c[0], nhan=c[3], lap=c[4]) for c in NV_CLIPS]

# ---------- Nhân viên bản ngố: lạch bạch, lố, hoảng loạn
def ngo_dung(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    return {
        'hong': (0, 3 * s, 0),
        'than': (1.5 * math.sin(2 * p), -2 * s, 0),
        'dau': (0, -4 * s, 8 * math.sin(p + 0.7) ** 3),
        'tay_tren.L': (2 * math.sin(2 * p), -10, 0), 'tay_tren.R': (2 * math.sin(2 * p), 10, 0),
        'tay_duoi.L': (-8, 0, 0), 'tay_duoi.R': (-8, 0, 0),
        'day_the': (3 * math.sin(2 * p - 1), 0, 0),
        '_loc': (0, 0, 0.006 * math.sin(2 * p)),
    }

def ngo_lach_bach(t, T, A, K, arm, bob, lean=0.0, carry=False):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, A, K)
    d['hong'] = (0, 9 * s, 7 * s)                       # lắc hông kiểu chim cánh cụt
    d['than'] = (lean, -4 * s, -6 * s)
    d['dau'] = (-lean * 0.5, -6 * s, 5 * math.sin(p - 0.8))
    if carry:
        for sd, sy in (('L', 12), ('R', -12)):
            d['tay_tren.' + sd] = (-55 + 3 * math.sin(2 * p), sy, 0)
            d['tay_duoi.' + sd] = (-45, 0, 0)
    else:
        for sd, sign, out in (('L', -1, -14), ('R', 1, 14)):
            d['tay_tren.' + sd] = (-arm * sign * s, out, 0)   # tay xoè, vung cứng đơ
            d['tay_duoi.' + sd] = (-4, 0, 0)
    d['day_the'] = (12 * math.sin(2 * p - 1.2) + 4, 0, 6 * math.sin(p - 1))
    d['_loc'] = (0.035 * s, 0, -bob * s * s)
    return d

def ngo_di(t, T):
    return ngo_lach_bach(t, T, 24, 45, 30, 0.045)

def ngo_be_thung(t, T):
    return ngo_lach_bach(t, T, 18, 35, 0, 0.035, lean=-6, carry=True)

def ngo_chay(t, T):
    """Chạy hớt hải: khuỳnh tay đánh mạnh trước sau, người đổ tới, đầu lắc lư."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 44, 100)
    d['hong'] = (0, 7 * s, 10 * s)
    d['than'] = (18, -5 * s, -9 * s)
    d['dau'] = (-12, 9 * s, 7 * math.sin(2 * p))
    for sd, sign, out in (('L', -1, -18), ('R', 1, 18)):
        f = sign * s
        d['tay_tren.' + sd] = (-58 * f - 10, out, 0)
        d['tay_duoi.' + sd] = (-85 + 18 * math.sin(2 * p + (0 if sd == 'L' else 1.5)), 0, 0)
    d['day_the'] = (40 + 15 * math.sin(2 * p), 0, 10 * s)             # thẻ bay ngược ra sau
    d['_loc'] = (0.03 * s, 0, -0.06 * s * s)
    return d

def ngo_vay_tay(t, T):
    p = 2 * math.pi * t / T
    w = math.sin(3 * p)
    return {
        'than': (0, -6, 0),
        'dau': (0, 10, 4 * w),
        'tay_tren.R': (0, 150 + 22 * w, 0),             # cả cánh tay vẫy qua lại trên đầu
        'tay_duoi.R': (0, 6 * w, 0),
        'tay_tren.L': (-10, -25, 0),
        'tay_duoi.L': (-50, 0, 0),
        'day_the': (4 * math.sin(2 * p), 0, 6 * w),
        '_loc': (0, 0, 0.03 * abs(math.sin(p))),
    }

def ngo_chi_tay(t, T):
    j = pulse(t, 0.35, 0.05) + pulse(t, 0.65, 0.05)   # "Ở ĐÓ! Ở ĐÓ!"
    return {
        'than': (8 + 6 * j, 0, 10),
        'dau': (-8 - 4 * j, 0, 6),
        'tay_tren.L': (-95 - 10 * j, 0, 0),
        'tay_duoi.L': (0, 0, 0),
        'tay_tren.R': (-10, 20, 0),
        'tay_duoi.R': (-40, 0, 0),
        'day_the': (-12 * j + 3, 0, 0),
        '_loc': (0, 0, 0.02 * j),
    }

def ngo_cui_chao(t, T):
    b = seg(t, 0.1, 0.35) * (1 - seg(t, 0.55, 0.8)) + seg(t, 1.0, 1.2) * (1 - seg(t, 1.45, 1.75))
    return {
        'than': (55 * b, 0, 0),
        'dau': (15 * b, 0, 0),
        'tay_tren.L': (-20, 20, 0), 'tay_tren.R': (-20, -20, 0),   # hai tay khép trước bụng
        'tay_duoi.L': (-55, 0, 0), 'tay_duoi.R': (-55, 0, 0),
        'day_the': (-50 * b + 6 * math.sin(t * 14) * b, 0, 0),         # thẻ rủ thẳng xuống
    }

def ngo_dong_thung(t, T):
    st = seg(t, 0.0, 0.12) * (1 - seg(t, 0.5, 0.6))    # giãy, ngó lên thấy thùng rơi
    sh = math.sin(t * 32)
    sit = snap(t, 0.5, 0.6)                            # ngồi phịch xuống
    look = seg(t, 0.15, 0.3) * (1 - sit)
    fall = clamp01((t - 0.45) / 0.25)
    land = max(0.0, t - 0.7)
    wob = math.exp(-land * 5) * math.sin(land * 30) if t > 0.7 else 0.0
    kick = (1.0 if t > 0.78 else 0.0) * (1 - seg(t, 1.9, 2.4))
    kL = max(0.0, math.sin(t * 16)) * kick
    kR = max(0.0, math.sin(t * 16 + math.pi)) * kick
    return {
        'than': (6 * sit, 0, 8 * sh * st),
        'dau': (-30 * look + 15 * sit, 0, 10 * math.sin(t * 27) * st),
        'tay_tren.L': (-120 * st + 30 * sh * st - 20 * sit, -15 * st + 15 * sit, 0),
        'tay_tren.R': (-120 * st - 30 * sh * st - 20 * sit, 15 * st - 15 * sit, 0),
        'tay_duoi.L': (-30 * st - 50 * sit, 0, 0), 'tay_duoi.R': (-30 * st - 50 * sit, 0, 0),
        'dui.L': (-90 * sit - 14 * kL, 0, 0), 'dui.R': (-90 * sit - 14 * kR, 0, 0),
        'cang.L': (-30 * kL, 0, 0), 'cang.R': (-30 * kR, 0, 0),           # hai chân thò ra đạp
        'day_the': (20 * st * sh, 0, 0),
        'thung': (0, 4 * wob, 2 * wob),
        '_loc': (0, 0.15 * sit, -0.4 * sit),
        '@thung': (0, 0, 2.0 * (1 - fall * fall)),
        '%thung': seg(t, 0.25, 0.35) * (1 + 0.08 * wob),
        '%than': 1 - 0.32 * sit,                                         # bị ép bẹp trong thùng
    }

B_NGO = bones_human(
    0.52, 1.14, 1.2, 1.62, (0.0, 0.0),
    shoulders={'L': (0.29, 0, 1.1), 'R': (-0.29, 0, 1.1)},
    elbows={'L': (0.34, 0, 0.88), 'R': (-0.34, 0, 0.88)},
    wrists={'L': (0.34, -0.03, 0.69), 'R': (-0.34, -0.03, 0.69)},
    knees={'L': (0.12, 0, 0.31), 'R': (-0.12, 0, 0.31)},
    ankles={'L': (0.12, 0, 0.1), 'R': (-0.12, 0, 0.1)}, hips_x=0.12)
B_NGO += [('day_the', (0, -0.2, 1.12), (0, -0.24, 0.86), 'than'),
          ('thung', (0, 0.2, 0), (0, 0.2, 0.3), None),
          ('may_quet_tay', (0.34, -0.05, 0.6), (0.34, -0.05, 0.4), 'tay_duoi.L'),
          ('den_pin_tay', (-0.34, -0.05, 0.6), (-0.34, -0.05, 0.4), 'tay_duoi.R')]
arm = make_rig(objs['nhan_vien_ngo'], 'nhan_vien_ngo', B_NGO)
REST_SCALE[arm.name] = {'thung': 0.0, 'may_quet_tay': 0.0, 'den_pin_tay': 0.0}
NGO_CLIPS = [('dung', 2.6, ngo_dung, 'Đứng (đung đưa)', True),
             ('di', 0.9, ngo_di, 'Đi lạch bạch', True),
             ('chay', 0.5, ngo_chay, 'Chạy giơ tay la hét', True),
             ('be_thung', 1.0, ngo_be_thung, 'Bê thùng đi', True),
             ('quet_hang', 2.4, lambda t, T: quet_mot_tay(t, T, {'day_the': (6, 0, 0)}), 'Quét hàng (1 tay)', True),
             ('di_den_pin', 1.05, lambda t, T: cam_den(ngo_lach_bach(t, T, 20, 38, 18, 0.035), t, T, True), 'Đi soi đèn pin (mất điện)', True),
             ('dung_den_pin', 4.0, lambda t, T: cam_den(ngo_dung(t, T), t, T, False), 'Đứng soi đèn pin', True),
             ('vay_tay', 1.6, ngo_vay_tay, 'Vẫy tay', True),
             ('chi_tay', 1.2, ngo_chi_tay, 'Chỉ tay "Ở ĐÓ!"', True),
             ('cui_chao', 2.0, ngo_cui_chao, 'Cúi chào "Dạ thưa sếp"', True),
             ('dong_thung', 2.6, ngo_dong_thung, 'Bị "đóng thùng"', False)]
make_clips(arm, 'nhan_vien_ngo', [(c[0], c[1], c[2]) for c in NGO_CLIPS],
           loc_bones=('goc', 'thung'), scales={'thung': 0.0, 'than': 1.0, 'may_quet_tay': 0.0, 'den_pin_tay': 0.0})
metas['nhan_vien_ngo']['chuyen_dong'] = [dict(ten=c[0], nhan=c[3], lap=c[4]) for c in NGO_CLIPS]

# ---------------------------------------------------------------- xuất .glb
for o, meta in MODELS:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    rig = RIGS.get(o.name)
    if rig:
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        for a in ACTIONS[o.name]:
            tr = rig.animation_data.nla_tracks.new()
            tr.name = a['clip']
            tr.strips.new(a['clip'], 1, a)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_GLB, meta['file']),
        export_format='GLB', use_selection=True, export_apply=not rig, export_yup=True,
        **(dict(export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True) if rig else {}),
    )
    if rig:
        for tr in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(tr)
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

    # Bảng khung hình chuyển động: mỗi hàng một đoạn, 5 khung, nhìn nghiêng 3/4
    import numpy as np
    TW = 300
    os.makedirs(os.path.join(OUT_PREV, 'anim'), exist_ok=True)
    scene.render.resolution_x = scene.render.resolution_y = TW
    for mname, rig in RIGS.items():
        o = objs[mname]
        for x in allm:
            x.hide_render = x is not o
        frame(cam, [o], direction=(1.5, -1.0, 0.35), pad=0.95)
        grid_paths = []
        for act in ACTIONS[mname]:
            rig.animation_data.action = act
            n = round((act.frame_range[1] - act.frame_range[0]))
            row = []
            for k in range(5):
                fr = 1 + round(n * k / 5) if k < 4 else 1 + round(n * 0.92)
                scene.frame_set(fr)
                pth = os.path.join(OUT_PREV, 'anim', f'{mname}_{act["clip"]}_{k}.png')
                render_to(pth)
                row.append(pth)
            grid_paths.append(row)
        rig.animation_data.action = None
        scene.frame_set(1)
        reset_pose(rig)
        rows, cols = len(grid_paths), 5
        big = np.zeros((rows * TW, cols * TW, 4), np.float32)
        for ri, row in enumerate(grid_paths):
            for ci, pth in enumerate(row):
                im = bpy.data.images.load(pth)
                a = np.empty(TW * TW * 4, np.float32)
                im.pixels.foreach_get(a)
                y0 = (rows - 1 - ri) * TW
                big[y0:y0 + TW, ci * TW:(ci + 1) * TW] = a.reshape(TW, TW, 4)
                bpy.data.images.remove(im)
        img = bpy.data.images.new('khung_' + mname, cols * TW, rows * TW)
        img.pixels.foreach_set(big.ravel())
        img.filepath_raw = os.path.join(OUT_PREV, f'chuyen_dong_{mname}.png')
        img.file_format = 'PNG'
        img.save()
        print('ANH', img.filepath_raw)
    scene.render.resolution_x = scene.render.resolution_y = 640

    # Ảnh tổng quan: xếp tất cả cạnh nhau theo tỉ lệ thật
    for x in allm:
        x.hide_render = False
    get = {meta['file'][:-4]: o for o, meta in MODELS}
    place = {
        'ke_mat': (-6.2, 0.4, 0), 'tu_dong': (-4.8, -1.2, 0),
        'tu_mat': (-3.4, 0.4, 0), 'ke_hang': (-1.9, 0.3, 0), 'nguoi_kiem_ke': (-0.55, -0.3, 0),
        'nhan_vien': (0.2, -0.5, 0), 'nhan_vien_ngo': (0.85, -0.45, 0),'quay_thu_ngan': (2.6, 0.5, 0), 'thung_carton': (1.2, -0.9, 0),
        'xe_day': (-1.2, -1.2, 0), 'bang_dong_lanh': (-2.7, -1.1, 0), 'may_cham_cong': (-2.0, -1.4, 0),
        'the_nhan_vien': (0.75, -1.5, 0), 'may_quet': (0.45, -1.5, 0), 'den_pin': (0.25, -1.6, 0),
    }
    for k, loc in place.items():
        RIGS.get(k, get[k]).location = loc
    get['thung_carton'].rotation_euler = (0, 0, 0.3)
    RIGS['nguoi_kiem_ke'].rotation_euler = (0, 0, -0.35)
    get['xe_day'].rotation_euler = (0, 0, 0.5)
    # bày hàng lên kệ và tủ mát (chỉ để xem, không xuất)
    goods = [get[k] for k in ('hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua')]
    cold = {k: get[k] for k in ('hh_kem', 'hh_goi_dong', 'hh_sua_chua')}
    for g in goods + list(cold.values()):
        g.hide_render = True

    def put(src, loc, rotz=0.0):
        d = src.copy()
        scene.collection.objects.link(d)
        d.hide_render = False
        d.location = loc
        d.rotation_euler = (0, 0, rotz)
        return d

    # Ngăn mát: sữa chua tầng dưới, sữa hộp và chai ở trên (chừa chỗ trống)
    mx, my, _ = place['ke_mat']
    for li, z in enumerate(KM_TANG):
        src = cold['hh_sua_chua'] if li < 2 else goods[4] if li == 2 else goods[2]
        step = 0.15 if li < 2 else 0.085
        ydep = (-0.2,) if li == 0 else (0.08,) if li < 3 else (0.12,)
        for i in range(int(1.1 / step)):
            if (li * 5 + i) % 7 == 3:
                continue
            for yy in ydep:
                put(src, (mx - 0.55 + step / 2 + i * step, my + yy, z))
    # Tủ đông: kem ngăn trái, đồ đông lạnh ngăn phải (xếp 2 lớp)
    fx, fy, _ = place['tu_dong']
    for i in range(6):
        for j in range(5):
            put(cold['hh_kem'], (fx - 0.78 + i * 0.13, fy - 0.3 + j * 0.15, TD_DAY))
    for layer in range(2):
        for i in range(3):
            for j in range(2):
                put(cold['hh_goi_dong'], (fx + 0.15 + i * 0.22, fy - 0.17 + j * 0.3, TD_DAY + layer * 0.047), 0.05 * (i - j))
    # Tủ mát cửa kính: lon và chai, 2 hàng sâu
    tx, ty, _ = place['tu_mat']
    for li, z in enumerate(TM_TANG):
        src = goods[0] if li < 2 else goods[4] if li == 2 else goods[2]
        for i in range(10):
            if li == 3 and i in (4, 5, 6):
                continue  # một khúc hết hàng
            for yy in (-0.2, -0.05):
                put(src, (tx - 0.4 + i * 0.09, ty + yy, z))
    # Ảnh riêng khu hàng lạnh
    coldset = [get['ke_mat'], get['tu_dong'], get['tu_mat']]
    for x in allm:
        x.hide_render = x not in coldset and x not in RIGS.values()
    for k in RIGS:
        RIGS[k].hide_render = True
        objs[k].hide_render = True
    frame(cam, coldset, direction=(0.55, -1.6, 0.85), pad=0.85)
    render_to(os.path.join(OUT_PREV, 'tu_lanh_co_hang.png'))
    for x in allm:
        x.hide_render = False
    for g in goods + list(cold.values()):
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
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    cam.data.lens = 40
    frame(cam, [get[k] for k in place], direction=(0.3, -1.6, 0.9), pad=0.8)
    render_to(os.path.join(OUT_PREV, 'tong_quan.png'))

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('XONG', len(MODELS), 'model')
