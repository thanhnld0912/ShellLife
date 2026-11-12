# Tạo bộ model low-poly mẫu cho "Hợp Đồng 30 Đêm".
# Chạy (không cần mở giao diện Blender):
#   E:\blender\blender.exe -b --factory-startup --python art\blender\tao_model_lowpoly.py
# Thêm "-- --khong-render" ở cuối để chỉ xuất .glb, bỏ qua ảnh xem trước.
#
# Quy ước: đơn vị mét, Blender Z hướng lên, MẶT TRƯỚC model quay về -Y
# (khi xuất glTF thành +Z, đúng hướng "nhìn tới" trong Three.js).
# Gốc toạ độ của mỗi model nằm giữa đáy (đặt thẳng xuống sàn được).

import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models')
OUT_PREV = os.path.join(ROOT, 'art', 'preview')
OUT_BLEND = os.path.join(ROOT, 'art', 'blender', 'mau_lowpoly.blend')
RENDER = '--khong-render' not in sys.argv
# "-- --chi-xem=nguoi_kiem_ke,nhan_vien_ngo": chỉ render ảnh xem trước của các model này (và ảnh tổng quan)
CHI_XEM = set(next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--chi-xem=')), []))
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

# Bảng màu nội thất kiểu low-poly sáng sủa (kệ trắng, thương hiệu đỏ, gỗ sáng)
K = dict(
    ke=M('ke_trang', 0xe8ebea, 0.7),
    ke_xam=M('ke_xam', 0xaab2b4, 0.6),
    ke_chan=M('ke_chan', 0x4b5355, 0.7),
    vo=M('vo_tu_trang', 0xeef1f2, 0.5),
    nhan_hieu=M('nhan_hieu', 0xd8473a, 0.6),
    nhan_hieu2=M('nhan_hieu_xanh', 0x2f9c5a, 0.6),
    tem=M('tem_vang', 0xf6d34a, 0.6),
    go_sang=M('go_sang', 0xc99f66, 0.8),
    go_dam=M('go_dam', 0x8a6238, 0.85),
)

def bang_mau_mat():
    """Vật liệu dùng màu đỉnh 'Col' (glTF COLOR_0)."""
    if 'bang_mau' in MATS:
        return MATS['bang_mau']
    m = bpy.data.materials.new('bang_mau')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Roughness'].default_value = 0.8
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    MATS['bang_mau'] = m
    return m

def gop_mau(o):
    """Gộp mọi vật liệu đục, không phát sáng của model thành 1 vật liệu màu đỉnh: 1 lệnh vẽ trong game.
    Vật liệu phát sáng / trong suốt giữ riêng."""
    me = o.data
    mats = list(me.materials)
    def keep(m):
        b = m.node_tree.nodes.get('Principled BSDF') if m and m.node_tree else None
        return b is None or b.inputs['Emission Strength'].default_value > 0 or b.inputs['Alpha'].default_value < 1
    flags = [keep(m) for m in mats]
    if all(flags) or len(mats) < 2:
        return
    kept = [m for m, k in zip(mats, flags) if k]
    new_list = [bang_mau_mat()] + kept
    remap = [new_list.index(m) if k else 0 for m, k in zip(mats, flags)]
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for p in me.polygons:
        m = mats[p.material_index]
        col = (1.0, 1.0, 1.0, 1.0) if flags[p.material_index] else tuple(m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)
        for li in p.loop_indices:
            attr.data[li].color = col
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in new_list:
        me.materials.append(m)
    for p, i in zip(me.polygons, idx):
        p.material_index = i
    try:
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass

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

def tien(P, prof, n=12, loc=(0, 0, 0), kink=38, cap_top=True, cap_bot=True):
    """Khối tiện tròn (chai, lon): prof = [(bán kính, z, vật liệu của dải từ vòng này lên vòng sau), …] từ đáy lên.
    Thân tròn bo mượt (đổ bóng mượt), chỗ gãy góc > kink độ (vai chai, mép lon) giữ cạnh sắc; hai nắp phẳng.
    Một mặt thân quay thẳng ra trước (-Y) để dán hình nhận diện."""
    mats = []
    for _, _, m in prof:
        if m not in mats:
            mats.append(m)
    a0 = -math.pi / 2 - math.pi / n
    ring = lambda r, z: [(loc[0] + r * math.cos(a0 + 2 * math.pi * j / n), loc[1] + r * math.sin(a0 + 2 * math.pi * j / n), loc[2] + z) for j in range(n)]
    verts, faces, fmat, fsmooth = [], [], [], []
    for r, z, _ in prof:
        verts += ring(r, z)
    for i in range(len(prof) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
            fmat.append(mats.index(prof[i][2]))
            fsmooth.append(True)
    if cap_bot:
        base = len(verts)
        verts += ring(prof[0][0], prof[0][1])
        faces.append(tuple(base + j for j in reversed(range(n))))
        fmat.append(mats.index(prof[0][2]))
        fsmooth.append(False)
    if cap_top:
        base = len(verts)
        verts += ring(prof[-1][0], prof[-1][1])
        faces.append(tuple(base + j for j in range(n)))
        fmat.append(mats.index(prof[-1][2]))
        fsmooth.append(False)
    me = bpy.data.meshes.new('tien')
    me.from_pydata(verts, [], faces)
    me.update()
    for m in mats:
        me.materials.append(m)
    for p, mi in zip(me.polygons, fmat):
        p.material_index = mi
    mu = me.attributes.new('muot', 'BOOLEAN', 'FACE')
    mu.data.foreach_set('value', fsmooth)
    # cạnh sắc ở chỗ profile gãy góc
    sharp = set()
    for i in range(1, len(prof) - 1):
        (r0, z0, _), (r1, z1, _), (r2, z2, _) = prof[i - 1], prof[i], prof[i + 1]
        a1 = math.atan2(z1 - z0, r1 - r0)
        a2 = math.atan2(z2 - z1, r2 - r1)
        d = abs(math.degrees(a2 - a1))
        if min(d, 360 - d) > kink:
            sharp.add(i)
    se = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
    vals = [False] * len(me.edges)
    for e in me.edges:
        v0, v1 = e.vertices
        if v0 < len(prof) * n and v1 < len(prof) * n and v0 // n == v1 // n and v0 // n in sharp:
            vals[e.index] = True
    se.data.foreach_set('value', vals)
    o = bpy.data.objects.new('tien', me)
    scene.collection.objects.link(o)
    if BONE[0]:
        o['bone'] = BONE[0]
    P.append(o)
    return o

def uon(objs, R, seg=0.012):
    """Uốn các hình dán phẳng (đặt ở mặt phẳng y = -R…) ôm theo thân tròn bán kính R quanh trục z:
    chỉ chia nhỏ các cạnh dài theo chiều ngang (mỗi đoạn ≤ seg mét, để không lún vào thân), rồi cuộn mỗi đỉnh
    theo góc x / R, giữ nguyên độ nổi trước mặt thân. Hình nhỏ (lát chanh, hạt cà phê) gần như không thêm tam giác."""
    import bmesh
    for o in objs:
        mw = o.matrix_world.copy()
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        long_e = [e for e in bm.edges if abs((mw @ e.verts[0].co).x - (mw @ e.verts[1].co).x) > seg]
        if long_e:
            span = max(abs((mw @ e.verts[0].co).x - (mw @ e.verts[1].co).x) for e in long_e)
            bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=min(3, int(span / seg)), use_grid_fill=True)
        for v in bm.verts:
            w = mw @ v.co
            d = max(0.0006, -w.y - R)
            a = w.x / R
            v.co = Vector(((R + d) * math.sin(a), -(R + d) * math.cos(a), w.z))
        bm.to_mesh(me)
        bm.free()
        o.matrix_world = Matrix.Identity(4)

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
    if 'muot' in me.attributes:   # thân tròn của khối tiện: đổ bóng mượt
        mu = [False] * len(me.polygons)
        me.attributes['muot'].data.foreach_get('value', mu)
        for p, v in zip(me.polygons, mu):
            if v:
                p.use_smooth = True
        me.attributes.remove(me.attributes['muot'])
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
    box(P, (W, D * 0.9, 0.12), (0, 0, 0.06), K['ke_chan'])                       # chân đế
    for side in (-1, 1):
        box(P, (W, 0.01, 0.1), (0, side * D * 0.45, 0.06), K['ke_xam'])          # tấm chắn chân
    box(P, (W, 0.05, H - 0.12), (0, 0, 0.12 + (H - 0.12) / 2), K['ke'])         # vách giữa trắng
    for side in (-1, 1):
        for z in (0.38, 0.82, 1.26, 1.7, 2.14):
            box(P, (W - 0.1, 0.004, 0.006), (0, side * 0.0275, z), K['ke_xam'])  # rãnh pegboard
    for x in (-W / 2 + 0.025, W / 2 - 0.025):
        box(P, (0.05, 0.12, H), (x, 0, H / 2), K['ke_xam'])                     # trụ đứng
    for side in (-1, 1):
        for z in (0.16, 0.6, 1.04, 1.48, 1.92):
            box(P, (W - 0.08, 0.42, 0.03), (0, side * 0.25, z), K['ke'])
            box(P, (W - 0.08, 0.015, 0.06), (0, side * 0.465, z + 0.01), K['tem'])  # dải tem giá
    box(P, (W, 0.06, 0.22), (0, 0, H + 0.11), K['nhan_hieu'])                   # bảng đầu kệ đỏ
    box(P, (W, 0.064, 0.03), (0, 0, H + 0.205), K['ke'])                        # viền trắng
    return finish(P, 'ke_hang', 'Kệ hàng (module 1,3 m, cao 2,4 m)',
                  'Gondola 2 mặt màu trắng, 5 tầng mỗi mặt, cao 2,4 m để che tia quét, dải tem giá vàng, bảng đầu kệ đỏ. '
                  'Ghép 8 cái thành một dãy kệ. Hàng hoá đặt riêng (InstancedMesh).')

# 2. Người Kiểm Kê (thiết kế lại): cao 2,15 m, gầy nhom, áo khoác dài xám chì tới gối, cà vạt đỏ sẫm.
#    Đầu trứng trơn không mặt, chỗ mắt dán một nhãn MÃ VẠCH. Tay phải dài quá gối với 3 ngón dài.
#    Tay trái cầm máy quét kiểu súng, cửa sổ đỏ ở độ cao 1,25 m (khớp SCANNER_Y trong game).
KK = dict(hip=1.02, chest=1.72, neck=1.9, head_top=2.15,
          sh=0.21, sh_z=1.70,
          elbow_L=(0.25, -0.05, 1.32), wrist_L=(0.13, -0.38, 1.26),
          elbow_R=(-0.25, 0.01, 1.22), wrist_R=(-0.24, -0.02, 0.76),
          knee=0.55)
def vanh(P, name, rings, m, n=8, a0=0.0, a1=2 * math.pi, caps=True):
    """Khối tiện từ các vòng elip xếp từ trên xuống: rings = [(z, rx, ry, cx, cy)].
    a0..a1: cung góc (đủ vòng thì đóng kín và có nắp). Mặt trước model là -Y."""
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    cols = n if full else n + 1
    verts, faces = [], []
    for (z, rx, ry, cx, cy) in rings:
        for k in range(cols):
            a = a0 + (a1 - a0) * k / n
            verts.append((cx + rx * math.cos(a), cy + ry * math.sin(a), z))
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % cols if full else k + 1
            a, b = i * cols + k, i * cols + k2
            c, d = (i + 1) * cols + k2, (i + 1) * cols + k
            faces.append((a, d, c, b))
    if full and caps:
        faces.append(tuple(range(cols)))                                           # nắp trên
        last = (len(rings) - 1) * cols
        faces.append(tuple(last + k for k in reversed(range(cols))))               # nắp dưới
    return mesh(P, name, verts, faces, m)

def nguoi_kiem_ke():
    """Cảm hứng Slender Man: rất cao, mảnh khảnh, vest đen ôm sát, sơ mi trắng, cà vạt đen, đầu trắng trơn.
    Dấu hiệu riêng của game: dải mắt đen in mã vạch trắng có vạch laser đỏ, tay phải dài quá gối, máy quét."""
    P = []
    VEST = M('vest_kk', 0x16181b, 0.75)            # vest đen
    VE = M('ve_kk', 0x0b0c0e, 0.45)                # ve áo satin bóng hơn
    QUAN = M('quan_kk3', 0x121417, 0.8)
    GIAY = M('giay_da_kk', 0x0e0f10, 0.35)
    DA = M('da_kk3', 0xe6e3dc, 0.85)               # da trắng bệch
    SOMI = M('somi_kk', 0xeceae3, 0.8)
    VAT = M('ca_vat_kk3', 0x08090a, 0.5)
    KIM = M('kim_loai_kk', 0x9ea3a6, 0.4, 0.6)
    LASER = M('laser_kk', 0xff2a1f, 0.4, 0.0, 8.0)
    K = C['nhua_den']
    hip, chest, knee = KK['hip'], KK['chest'], KK['knee']

    # ---- chân dài mảnh: quần âu ống đứng, giày da mũi nhọn dài
    for sx, sd in ((1, 'L'), (-1, 'R')):
        x = sx * 0.1
        bo('cang.' + sd)
        box(P, (0.085, 0.22, 0.075), (x, -0.035, 0.0375), GIAY, bev=0.016)        # thân giày
        box(P, (0.06, 0.12, 0.045), (x, -0.18, 0.0225), GIAY, bev=0.012)          # mũi giày nhọn dài
        vanh(P, 'ong_' + sd, [(knee, 0.046, 0.05, x, 0), (0.09, 0.044, 0.05, x, -0.004)], QUAN, n=6)
        bo('dui.' + sd)
        vanh(P, 'dui_' + sd, [(hip + 0.02, 0.064, 0.07, x, 0), (knee, 0.048, 0.052, x, 0)], QUAN, n=6)

    # ---- hông + vạt vest ngắn (tới giữa đùi trên), xẻ tà sau
    bo('hong')
    vanh(P, 'hong', [(hip + 0.08, 0.15, 0.105, 0, 0), (hip - 0.03, 0.155, 0.11, 0, 0)], QUAN, n=8)
    for sx in (-1, 1):                                                             # 2 nửa vạt, chừa xẻ trước
        a0, a1 = (-math.pi / 2 + 0.12, math.pi / 2 - 0.06) if sx > 0 else (math.pi / 2 + 0.06, 3 * math.pi / 2 - 0.12)
        vanh(P, 'vat_' + str(sx), [(hip + 0.1, 0.152, 0.108, 0, 0), (hip - 0.16, 0.168, 0.12, 0, 0.004)], VEST, n=5, a0=a0, a1=a1)
    # ---- thân: vest ôm, vai hẹp hơi xuôi, eo thon
    bo('than')
    vanh(P, 'than', [(chest + 0.04, 0.075, 0.06, 0, 0.0),                         # chân cổ
                     (chest - 0.01, 0.185, 0.1, 0, 0.0),                          # đường vai xuôi
                     (chest - 0.13, 0.18, 0.115, 0, -0.005),                      # ngực
                     (1.32, 0.145, 0.102, 0, 0.0),                                # eo thon
                     (hip + 0.1, 0.152, 0.108, 0, 0.0)], VEST, n=8)
    for sx in (-1, 1):
        ball(P, 0.058, (sx * 0.19, 0.0, chest - 0.02), VEST, scale=(1.05, 1.0, 0.6))  # đầu vai
    # sơ mi trắng chữ V sâu + cà vạt đen mảnh
    mesh(P, 'somi', [(-0.07, -0.11, chest - 0.01), (0.07, -0.11, chest - 0.01), (0.0, -0.121, 1.36)], [(0, 2, 1)], SOMI)
    mesh(P, 'cavat', [(-0.016, -0.123, chest - 0.04), (0.016, -0.123, chest - 0.04), (0.022, -0.125, 1.42),
                      (0.0, -0.127, 1.385), (-0.022, -0.125, 1.42)], [(0, 4, 3, 2, 1)], VAT)
    box(P, (0.036, 0.024, 0.028), (0, -0.117, chest - 0.025), VAT)                 # nút cà vạt
    for sx in (-1, 1):                                                             # ve áo nhọn, hẹp
        mesh(P, 've_' + str(sx), [(sx * 0.07, -0.113, chest - 0.005), (sx * 0.13, -0.11, chest - 0.1),
                                   (sx * 0.05, -0.124, 1.43), (sx * 0.004, -0.123, 1.36)],
             [(0, 3, 2, 1) if sx > 0 else (0, 1, 2, 3)], VE)
    for z in (1.3, 1.22):                                                          # 2 cúc một hàng
        box(P, (0.02, 0.01, 0.02), (0.012, -0.113, z), VE)
    box(P, (0.07, 0.008, 0.045), (-0.11, -0.118, 1.5), SOMI)                       # thẻ kiểm kê trắng
    for i in range(5):
        box(P, (0.004 + (i % 2) * 0.004, 0.009, 0.026), (-0.13 + i * 0.01, -0.119, 1.497), K)
    # cổ: cổ sơ mi trắng đứng
    bo('co')
    vanh(P, 'co', [(KK['neck'] - 0.02, 0.034, 0.036, 0, -0.05), (chest, 0.04, 0.04, 0, 0)], DA, n=6)
    vanh(P, 'co_ao', [(chest + 0.075, 0.058, 0.055, 0, -0.012), (chest + 0.01, 0.065, 0.06, 0, 0)], SOMI, n=8)

    # ---- đầu: trứng trắng trơn không mặt, dải mắt đen in mã vạch, vạch laser đỏ cắt ngang
    bo('dau')
    hz = 2.02
    ball(P, 0.112, (0, -0.085, hz), DA, scale=(0.84, 0.95, 1.36), sub=2)
    ball(P, 0.048, (0, -0.06, hz - 0.12), DA, scale=(1.0, 0.9, 0.8))              # cằm nhọn
    for (x, y, rz, w) in ((-0.062, -0.165, -0.62, 0.068), (0.0, -0.194, 0.0, 0.07), (0.062, -0.165, 0.62, 0.068)):
        box(P, (w, 0.01, 0.052), (x, y, hz + 0.008), VAT, rot=(0.05, 0, rz))      # dải mắt đen 3 mảnh ôm mặt
    for i, w in enumerate((0.005, 0.003, 0.008, 0.003, 0.005, 0.007, 0.003, 0.006, 0.004, 0.007, 0.003)):
        box(P, (w, 0.004, 0.034), (-0.05 + i * 0.01, -0.2, hz + 0.008), SOMI, rot=(0.05, 0, 0))  # mã vạch trắng
    for (x, y, rz, w) in ((-0.062, -0.1705, -0.62, 0.062), (0.0, -0.2015, 0.0, 0.07), (0.062, -0.1705, 0.62, 0.062)):
        box(P, (w, 0.004, 0.005), (x, y, hz + 0.004), LASER, rot=(0, 0, rz))      # vạch laser đỏ

    # ---- tay phải: buông thõng, dài quá gối, 3 ngón dài 2 đốt hơi quặp
    ex, ey, ez = KK['elbow_R']
    wx, wy, wz = KK['wrist_R']
    bo('tay_tren.R')
    limb(P, (-KK['sh'], 0, KK['sh_z']), (ex, ey, ez), 0.043, VEST, n=6, r2=0.038)
    bo('tay_duoi.R')
    ball(P, 0.039, (ex, ey, ez), VEST, scale=(1, 1, 0.9))
    limb(P, (ex, ey, ez), (wx, wy, wz + 0.03), 0.038, VEST, n=6, r2=0.036)
    cyl(P, 0.031, 0.03, (wx, wy, wz + 0.02), SOMI, n=6)                           # cổ tay áo trắng
    box(P, (0.034, 0.068, 0.1), (wx, wy, wz - 0.05), DA, bev=0.01)                 # bàn tay dài
    for fy, L in ((-0.024, 1.0), (0.0, 1.12), (0.024, 0.95)):
        a = (wx, wy + fy, wz - 0.095)
        b = (wx + 0.004, wy + fy * 1.3 - 0.01, wz - 0.095 - 0.15 * L)
        c = (wx + 0.006, wy + fy * 1.4 - 0.045, wz - 0.095 - 0.27 * L)
        limb(P, a, b, 0.011, DA, n=4, r2=0.009)
        ball(P, 0.01, b, DA)
        limb(P, b, c, 0.009, DA, n=4, r2=0.003)
    # ---- tay trái: cầm máy quét kiểu súng chĩa về trước
    ex, ey, ez = KK['elbow_L']
    wx, wy, wz = KK['wrist_L']
    bo('tay_tren.L')
    limb(P, (KK['sh'], 0, KK['sh_z']), (ex, ey, ez), 0.043, VEST, n=6, r2=0.038)
    bo('tay_duoi.L')
    ball(P, 0.039, (ex, ey, ez), VEST, scale=(1, 1, 0.9))
    limb(P, (ex, ey, ez), (wx, wy + 0.03, wz), 0.038, VEST, n=6, r2=0.036)
    cyl(P, 0.031, 0.03, (wx, wy + 0.015, wz), SOMI, n=6, rot=(math.pi / 2, 0, 0))
    box(P, (0.046, 0.075, 0.065), (wx, wy - 0.045, wz - 0.02), DA, bev=0.01)
    box(P, (0.042, 0.05, 0.15), (0.12, -0.44, 1.18), K, rot=(0.3, 0, 0), bev=0.008)  # báng máy quét
    box(P, (0.1, 0.17, 0.09), (0.12, -0.5, 1.27), M('may_quet_vang', 0xe8b030, 0.5), bev=0.014)
    box(P, (0.104, 0.06, 0.094), (0.12, -0.44, 1.27), K, bev=0.01)
    box(P, (0.08, 0.01, 0.06), (0.12, -0.587, 1.27), C['den_do'])                  # cửa sổ quét đỏ
    box(P, (0.05, 0.05, 0.012), (0.12, -0.47, 1.32), C['den_xanh'])
    box(P, (0.016, 0.03, 0.035), (0.12, -0.46, 1.205), C['den_do'])
    return finish(P, 'nguoi_kiem_ke', 'Người Kiểm Kê',
                  'Cảm hứng Slender Man: cao 2,15 m, mảnh khảnh, chân dài, vest đen ôm sát (vai hẹp xuôi, eo thon, ve nhọn), '
                  'sơ mi trắng, cà vạt đen mảnh, quần âu, giày mũi nhọn. Đầu trứng trắng trơn không mặt, dải mắt đen in mã vạch '
                  'trắng có vạch laser đỏ phát sáng. Tay phải dài quá gối, 3 ngón dài 2 đốt. Tay trái cầm máy quét vàng, '
                  'cửa sổ đỏ ở độ cao 1,25 m (khớp SCANNER_Y). Thùng người chơi vác trên vai phải.')

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
    V = K['vo']
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
        box(P, (W - 0.1, 0.008, 0.04), (0, -D / 2 + 0.13, z + 0.008), K['tem'])  # nẹp giá phía trước
    for x in (-(W / 2 - 0.08), (W / 2 - 0.08)):                                   # đèn LED dọc hai bên
        box(P, (0.018, 0.018, H - 0.5), (x, -D / 2 + 0.1, 0.22 + (H - 0.5) / 2), C['den_lanh'])
    box(P, (W - 0.12, 0.03, 0.02), (0, -D / 2 + 0.12, H - 0.1), C['den_lanh'])    # đèn ngang trên
    box(P, (W, 0.08, 0.18), (0, -D / 2 + 0.03, H + 0.09), K['nhan_hieu'])       # bảng đèn trên nóc
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
    V = K['vo']
    T = C['trong_tu']
    for sx in (-1, 1):                                                            # hông bậc thang
        x = sx * (W / 2 - 0.02)
        box(P, (0.04, D, 0.9), (x, 0, 0.45), V)
        box(P, (0.04, D * 0.62, H - 0.9), (x, D * 0.19, 0.9 + (H - 0.9) / 2), V)
        box(P, (0.042, 0.02, 0.9), (x, -D / 2 + 0.01, 0.45), K['nhan_hieu'])    # nẹp đỏ mép hông
    box(P, (W, 0.05, H), (0, D / 2 - 0.025, H / 2), V)                            # lưng
    box(P, (W - 0.08, 0.01, H - 0.7), (0, D / 2 - 0.055, 0.68 + (H - 0.7) / 2), T)  # vách trong sáng
    box(P, (W, 0.14, 0.62), (0, -D / 2 + 0.07, 0.31), V)                          # mặt trước đế
    box(P, (W - 0.04, D - 0.2, 0.62), (0, 0.06, 0.31), C['nhua_xam'])             # khối máy
    box(P, (W, 0.02, 0.08), (0, -D / 2 - 0.01, 0.42), K['nhan_hieu'])           # dải chắn va
    for i in range(4):
        box(P, (W - 0.16, 0.004, 0.012), (0, -D / 2 - 0.002, 0.08 + i * 0.026), C['nhua_den'])  # lưới gió
    box(P, (W - 0.06, D - 0.14, 0.02), (0, 0.04, KM_TANG[0] - 0.01), T)            # khay đáy (tầng 1)
    box(P, (W - 0.1, 0.03, 0.012), (0, -D / 2 + 0.17, KM_TANG[0] + 0.004), C['den_lanh'])  # khe gió lạnh
    box(P, (W - 0.06, 0.01, 0.07), (0, -D / 2 + 0.1, KM_TANG[0] + 0.02), C['kinh'])  # tấm chắn trước khay
    for i, z in enumerate(KM_TANG[1:]):                                           # 3 kệ, càng lên càng ngắn
        d = 0.5 - i * 0.04
        yb = D / 2 - 0.06
        box(P, (W - 0.08, d, 0.02), (0, yb - d / 2, z - 0.01), C['thep'])
        box(P, (W - 0.08, 0.008, 0.045), (0, yb - d - 0.004, z + 0.01), K['tem'])
    box(P, (W, 0.52, 0.06), (0, D / 2 - 0.26, H - 0.03), V)                       # mái che
    box(P, (W, 0.04, 0.15), (0, D / 2 - 0.52, H - 0.075), K['nhan_hieu'])       # viền mái
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
    V = K['vo']
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
    box(P, (W + 0.02, D + 0.02, 0.07), (0, 0, 0.13), K['nhan_hieu'])            # dải chắn va quanh thân
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
    box(P, (2.9, 1.2, 0.9), (0, 0, 0.45), K['vo'], bev=0.01)                    # thân trắng
    box(P, (2.92, 1.22, 0.1), (0, 0, 0.05), K['ke_chan'])                       # chân
    box(P, (3.0, 1.3, 0.05), (0, 0, 0.925), K['go_sang'], bev=0.008)            # mặt gỗ sáng
    box(P, (2.9, 0.01, 0.14), (0, -0.605, 0.72), K['nhan_hieu'])                # sọc đỏ thương hiệu
    box(P, (2.9, 0.01, 0.04), (0, -0.605, 0.62), K['tem'])
    box(P, (1.4, 0.4, 0.02), (-0.6, -0.3, 0.96), C['cao_su'])                     # băng chuyền
    box(P, (0.04, 0.4, 0.05), (-1.32, -0.3, 0.97), K['ke_xam'])
    box(P, (0.3, 0.3, 0.02), (0.3, -0.25, 0.96), C['kinh'])                       # mặt quét kính
    box(P, (0.28, 0.28, 0.015), (0.3, -0.25, 0.952), C['den_do'])
    # máy tính tiền: thân + bàn phím nghiêng + màn hình quay về phía nhân viên
    box(P, (0.46, 0.42, 0.12), (0.95, 0.15, 1.01), C['nhua_den'], bev=0.01)       # ngăn kéo tiền
    box(P, (0.34, 0.2, 0.05), (0.95, 0.12, 1.1), C['nhua_xam'], rot=(0.25, 0, 0))  # bàn phím
    limb(P, (0.95, 0.3, 1.07), (0.95, 0.3, 1.3), 0.025, C['nhua_xam'])            # chân màn hình
    box(P, (0.42, 0.04, 0.3), (0.95, 0.3, 1.42), C['nhua_den'], rot=(-0.2, 0, 0))  # màn hình
    box(P, (0.37, 0.01, 0.24), (0.95, 0.275, 1.425), C['den_lanh'], rot=(-0.2, 0, 0))
    box(P, (0.3, 0.3, 0.16), (1.2, -0.3, 1.03), C['nhua_den'], bev=0.01)          # máy in hoá đơn
    box(P, (0.08, 0.002, 0.2), (1.2, -0.452, 1.05), C['giay'], rot=(0.25, 0, 0))  # tờ hoá đơn thò ra
    box(P, (0.4, 0.04, 0.12), (-1.2, 0.1, 1.2), C['nhua_den'])                    # biển "QUẦY 1"
    box(P, (0.34, 0.01, 0.07), (-1.2, 0.075, 1.2), C['den_vang'])
    limb(P, (-1.2, 0.1, 0.95), (-1.2, 0.1, 1.14), 0.012, C['thep'])
    # giá kẹo nhỏ ở đầu quầy phía khách (3 tầng hộp màu)
    box(P, (0.06, 0.3, 0.5), (-1.42, -0.85, 0.25), K['ke_xam'])
    for i, z in enumerate((0.12, 0.27, 0.42)):
        box(P, (0.3, 0.3, 0.012), (-1.27, -0.85, z), K['ke'])
        for j in range(4):
            col = (0xd8342b, 0xf6cf3f, 0x4cae4f, 0x3f8fd2, 0x8e5bb5)[(i + j) % 5]
            box(P, (0.06, 0.05, 0.09), (-1.38 + j * 0.075, -0.9, z + 0.051), M(f'hh_{col:06x}', col, 0.6))
    return finish(P, 'quay_thu_ngan', 'Quầy thu ngân',
                  '3,0×1,3 m, thân trắng sọc đỏ, mặt gỗ sáng. Băng chuyền, mặt quét đỏ, máy tính tiền, màn hình, '
                  'máy in hoá đơn (chỗ in "phiếu chửi khéo"), giá kẹo nhỏ phía khách.')

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

# 11c. Tủ điện tổng ở PHÒNG ĐIỆN: tủ thép xám áp tường (mặt sau ở +Y), cửa mở toang sang trái (bản lề cạnh -X).
#      Trong tủ: hàng 6 cầu dao đen có cần gạt trắng (cao 1,3 m), cầu dao tổng đỏ to bên dưới, sọc vàng đen.
#      Mặt trong cửa dán tờ SƠ ĐỒ trắng (thứ tự bật cầu dao); mặt ngoài cửa có biển tam giác vàng "NGUY HIỂM ĐIỆN".
TD_CAU_DAO = [(-0.3 + 0.12 * i, -0.105, 1.3) for i in range(6)]   # tâm từng cầu dao (toạ độ Blender)
TD_TONG = (0.0, -0.105, 0.95)                                      # tâm cầu dao tổng đỏ

def tu_dien():
    P = []
    W, H, D = 0.9, 1.8, 0.3
    xam, xam_toi = HM(0x8d948f), HM(0x5d6462)
    vang, den, trang = HM(0xf6cf3f), HM(0x1a1d1c), HM(0xf2f2ee)
    box(P, (W, 0.02, H), (0, D / 2 - 0.01, 0.08 + H / 2), xam)                        # lưng tủ
    for sx in (-1, 1):
        box(P, (0.02, D, H), (sx * (W / 2 - 0.01), 0, 0.08 + H / 2), xam)            # hai vách
    for z in (0.08, 0.08 + H):
        box(P, (W, D, 0.03), (0, 0, z), xam)                                          # nóc, đáy
    box(P, (W - 0.1, 0.06, 0.08), (0, 0, 0.04), xam_toi)                              # chân đế
    box(P, (W - 0.06, 0.01, H - 0.06), (0, D / 2 - 0.025, 0.08 + H / 2), HM(0xc9ccc8))  # tấm gá bên trong (sáng)
    # Hàng cầu dao
    box(P, (0.8, 0.15, 0.72), (0, 0.05, 1.13), HM(0xb4b8b4))                          # khung gá thiết bị
    box(P, (0.78, 0.02, 0.22), (0, -0.03, 1.3), xam_toi)                              # thanh ray
    for (x, y, z) in TD_CAU_DAO:
        box(P, (0.085, 0.07, 0.17), (x, y + 0.03, z), den)
        box(P, (0.03, 0.03, 0.05), (x, y - 0.015, z + 0.03), trang)                  # cần gạt trắng (đang tắt: lên)
        box(P, (0.05, 0.004, 0.018), (x, y - 0.005, z - 0.06), trang)  # nhãn số
    # Cầu dao tổng đỏ
    x, y, z = TD_TONG
    box(P, (0.22, 0.08, 0.26), (x, y + 0.035, z), den)
    box(P, (0.06, 0.08, 0.16), (x, y - 0.03, z), HM(0xd8342b))                       # tay gạt đỏ
    # Sọc vàng đen dưới đáy tủ trong
    for i in range(7):
        box(P, (0.11, 0.012, 0.08), (-0.36 + i * 0.12, D / 2 - 0.035, 0.55), vang if i % 2 == 0 else den)
    for i in range(3):                                                                # dây cáp đi lên nóc
        cyl(P, 0.012, 0.6, (-0.25 + i * 0.05, D / 2 - 0.06, 1.55), den, n=6)
    # Cửa mở ~100° quanh bản lề cạnh -X (cửa dày 2 cm, rộng W)
    a = math.radians(100)
    hx, hy = -W / 2, -D / 2                                                           # bản lề

    ux, uy = math.cos(a), -math.sin(a)                                                # hướng dọc tấm cửa (từ bản lề ra mép)
    cx, cy = hx + ux * W / 2, hy + uy * W / 2
    rotz = -a
    box(P, (W, 0.02, H), (cx, cy, 0.08 + H / 2), xam, rot=(0, 0, rotz))
    nx, ny = -uy, ux                                                                  # pháp tuyến cửa
    # mặt TRONG cửa (khi mở quay về phía người đứng trước tủ): tờ sơ đồ
    inner = 1                                                                      # pháp tuyến n quay ra phía mở của tủ
    ox, oy = nx * 0.012 * inner, ny * 0.012 * inner
    box(P, (0.42, 0.004, 0.56), (cx + ox, cy + oy, 1.25), trang, rot=(0, 0, rotz))  # tờ sơ đồ
    for i in range(6):                                                                # 6 ô cầu dao vẽ trên sơ đồ
        for j, col in enumerate((den, HM(0xd8342b) if i % 2 else HM(0x2e9c4f))):
            px = (i - 2.5) * 0.06
            box(P, (0.04, 0.003, 0.05 if j == 0 else 0.02), (cx + ox * 1.15 + ux * px, cy + oy * 1.15 + uy * px, 1.36 - j * 0.07), col, rot=(0, 0, rotz))
    for i in range(3):                                                                # dòng chữ
        box(P, (0.3, 0.003, 0.012), (cx + ox * 1.15, cy + oy * 1.15, 1.12 - i * 0.05), HM(0x4a504e), rot=(0, 0, rotz))
    for k in (-1, 1):                                                                 # băng keo dán sơ đồ
        box(P, (0.08, 0.005, 0.03), (cx + ox * 1.3 + ux * k * 0.2, cy + oy * 1.3 + uy * k * 0.2, 1.52), C['bang_keo'], rot=(0, 0, rotz))
    # mặt NGOÀI cửa: biển tam giác vàng + tay nắm
    ex, ey = -ox, -oy
    tg = mesh(P, 'tgd', [(-0.13, 0, -0.11), (0.0, 0, 0.12), (0.13, 0, -0.11)], [(0, 1, 2), (2, 1, 0)], vang)
    tg.location = (cx + ex * 1.2, cy + ey * 1.2, 1.35)
    tg.rotation_euler = (0, 0, rotz)
    box(P, (0.025, 0.004, 0.08), (cx + ex * 1.4, cy + ey * 1.4, 1.36), den, rot=(0, 0, rotz))   # dấu chấm than
    box(P, (0.025, 0.004, 0.025), (cx + ex * 1.4, cy + ey * 1.4, 1.29), den, rot=(0, 0, rotz))
    hxx, hyy = hx + ux * (W - 0.06), hy + uy * (W - 0.06)
    box(P, (0.025, 0.04, 0.16), (hxx + ex * 2.2, hyy + ey * 2.2, 1.0), C['thep'], rot=(0, 0, rotz))  # tay nắm
    return finish(P, 'tu_dien', 'Tủ điện tổng',
                  'Tủ thép xám 0,9×1,8 m áp tường, cửa mở. 6 cầu dao đen (cần gạt trắng) ở 1,3 m, cầu dao tổng đỏ ở 0,95 m, '
                  'sơ đồ thứ tự bật dán mặt trong cửa, biển tam giác NGUY HIỂM ĐIỆN mặt ngoài.')

# 11d. Rác: thùng rác nhựa xanh trong siêu thị, túi rác đen, xe thu gom rác, thùng rác lớn ở cửa sau kho.
def thung_rac():
    P = []
    xanh, xanh_toi, den = HM(0x2e8b57), HM(0x1f6b42), HM(0x161818)
    tien(P, [
        (0.17, 0.0, xanh_toi), (0.185, 0.02, xanh), (0.205, 0.66, xanh_toi), (0.21, 0.68, den),
        (0.205, 0.70, den),
    ], n=12)
    k = len(P)
    box(P, (0.12, 0.004, 0.11), (0, -0.2, 0.44), HM(0xf2f2ee))                         # nhãn trắng
    box(P, (0.045, 0.004, 0.045), (0, -0.203, 0.44), HM(0x2e8b57))                     # biểu tượng tái chế
    uon(P[k:], 0.197)
    tien(P, [(0.215, 0.70, xanh), (0.22, 0.72, xanh), (0.17, 0.79, xanh), (0.08, 0.81, xanh)], n=12, cap_bot=True)  # nắp vòm
    box(P, (0.2, 0.012, 0.07), (0, -0.19, 0.76), den, rot=(0.6, 0, 0))                  # khe lật (cửa bập bênh)
    return finish(P, 'thung_rac', 'Thùng rác',
                  'Thùng nhựa xanh cao 0,8 m, đường kính 0,42 m, nắp vòm có khe lật, mép túi rác đen lộ dưới nắp.')

def tui_rac():
    P = []
    den, den2 = HM(0x1a1d1c), HM(0x262a29)
    b = ball(P, 0.18, (0, 0, 0.2), den, scale=(1.0, 0.85, 1.15), sub=2)
    me = b.data
    import random as _r
    rr = _r.Random(7)
    for v in me.vertices:                                                           # lồi lõm như túi đựng đồ
        k = 1 + rr.uniform(-0.09, 0.09)
        v.co = v.co * k
        if v.co.z < -0.12:
            v.co.z = -0.12 - (v.co.z + 0.12) * 0.2                                   # đáy bẹp
    cyl(P, 0.04, 0.08, (0, 0, 0.42), den2, n=6, r2=0.02)                              # cổ túi thắt
    for sx in (-1, 1):                                                               # hai tai nút buộc
        o = ball(P, 0.035, (sx * 0.045, 0, 0.47), den2, scale=(1.4, 0.5, 0.8), sub=1)
        o.rotation_euler = (0, sx * 0.6, 0)
    return finish(P, 'tui_rac', 'Túi rác', 'Túi nilon đen buộc nút, rộng ~0,36 m, cao 0,5 m, lồi lõm.')

def xe_rac():
    P = []
    xam, vang, den, thep = HM(0x6d7472), HM(0xf2c230), HM(0x161818), C['thep']
    box(P, (0.6, 1.0, 0.05), (0, 0, 0.13), C['thep_toi'], bev=0.006)                  # khung sàn
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(P, 0.07, 0.04, (sx * 0.24, sy * 0.38, 0.07), C['cao_su'], n=10, rot=(0, math.pi / 2, 0))
    box(P, (0.56, 0.8, 0.78), (0, -0.06, 0.55), xam, bev=0.01)                       # thùng xám
    box(P, (0.5, 0.74, 0.02), (0, -0.06, 0.9), den)                                    # lòng thùng tối (thấp hơn miệng)
    for sy in (-1, 1):                                                               # vành vàng (khung 4 thanh, miệng hở)
        box(P, (0.6, 0.05, 0.06), (0, -0.06 + sy * 0.4, 0.95), vang)
        box(P, (0.05, 0.84, 0.06), (sy * 0.29, -0.06, 0.95), vang)
    box(P, (0.57, 0.004, 0.1), (0, -0.465, 0.6), vang)                                # sọc vàng phía trước
    for i, (x, y) in enumerate(((-0.12, -0.2), (0.12, 0.05), (-0.05, 0.2))):         # túi rác lòi lên miệng thùng
        o = ball(P, 0.15, (x, y, 0.92), HM(0x1a1d1c), scale=(1, 0.9, 0.85), sub=1)
        o.rotation_euler = (0, 0, i)
    for sx in (-1, 1):                                                               # tay đẩy phía sau (+Y)
        limb(P, (sx * 0.24, 0.36, 0.2), (sx * 0.24, 0.48, 1.02), 0.016, thep, n=6)
    limb(P, (-0.26, 0.48, 1.02), (0.26, 0.48, 1.02), 0.022, HM(0x2f7fc1), n=6)
    box(P, (0.22, 0.02, 0.3), (0.3, -0.2, 0.55), vang, rot=(0, 0, 1.57))              # biển SÀN ƯỚT treo hông
    box(P, (0.12, 0.022, 0.03), (0.302, -0.2, 0.6), den, rot=(0, 0, 1.57))
    return finish(P, 'xe_rac', 'Xe thu gom rác',
                  'Khung 0,6×1,0 m, thùng xám vành vàng cao ~1 m, túi rác đen lòi lên miệng, tay đẩy xanh phía sau (+Y) cao 1,02 m.')

def thung_rac_lon():
    P = []
    xanh, xanh_toi, den = HM(0x24543a), HM(0x183a28), HM(0x161818)
    box(P, (1.6, 1.0, 1.05), (0, 0, 0.62), xanh, bev=0.02)                            # thân
    box(P, (1.64, 0.02, 0.12), (0, -0.505, 0.85), HM(0xf2f2ee))                      # dải chữ trắng
    for i in range(5):
        box(P, (0.18, 0.004, 0.05), (-0.55 + i * 0.27, -0.517, 0.85), xanh_toi)       # "chữ"
    box(P, (1.68, 1.04, 0.04), (0, 0, 1.15), xanh_toi)                                # vành miệng
    box(P, (0.8, 1.02, 0.03), (-0.4, 0, 1.19), xanh_toi, bev=0.005)                   # nắp trái đóng
    box(P, (0.8, 1.02, 0.03), (0.4, 0.62, 1.55), xanh_toi, rot=(1.25, 0, 0), bev=0.005)  # nắp phải mở dựng lên
    box(P, (0.75, 0.6, 0.02), (0.4, 0, 1.17), den)                                    # lòng thùng tối
    o = ball(P, 0.22, (0.35, 0.1, 1.18), HM(0x1a1d1c), scale=(1.2, 1, 0.6), sub=1)     # túi rác ló lên
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(P, 0.07, 0.05, (sx * 0.68, sy * 0.38, 0.07), C['cao_su'], n=8, rot=(0, math.pi / 2, 0))
    for sx in (-1, 1):
        box(P, (0.06, 0.12, 0.06), (sx * 0.83, 0, 0.9), C['thep_toi'])                # tai móc nâng
    return finish(P, 'thung_rac_lon', 'Thùng rác lớn (cửa sau)',
                  'Thùng xanh đậm 1,6×1,0×1,25 m có bánh xe, nắp trái đóng, nắp phải mở dựng lên, dải chữ trắng.')

# 11b. Kiện nước suối 60 chai 1,5 L (~90 kg): cồng kềnh, phải 2 người khiêng (1 người thì kéo lê rất chậm và ồn).
#      Dài theo trục Y (trước-sau): khiêng đi theo chiều dài, mỗi người cầm một quai đai vàng ở hai đầu.
def kien_nuoc():
    P = []
    L, W = 1.1, 0.48
    xanh, xanh_dam, trang, vang, den = HM(0x9ad8ee), HM(0x2f7fc1), HM(0xf6f6f2), HM(0xf6cf3f), HM(0x1a1d1c)
    box(P, (W, L, 0.05), (0, 0, 0.025), C['carton'], bev=0.006)                     # khay carton
    box(P, (W - 0.01, L - 0.01, 0.26), (0, 0, 0.18), xanh)                           # thân chai bọc màng co
    box(P, (W + 0.006, L + 0.006, 0.085), (0, 0, 0.19), xanh_dam)                   # đai nhãn xanh
    box(P, (W + 0.008, L + 0.008, 0.016), (0, 0, 0.19), trang)                      # sọc trắng giữa nhãn
    for k in range(11):                                                             # khe giữa các chai (hai mặt dài)
        y = -L / 2 + 0.0917 * (k + 1)
        for sx in (-1, 1):
            box(P, (0.006, 0.012, 0.25), (sx * (W / 2 - 0.002), y, 0.18), HM(0x6fb6d6))
    for k in range(4):                                                              # khe ở hai đầu
        x = -W / 2 + 0.096 * (k + 1)
        for sy in (-1, 1):
            box(P, (0.012, 0.006, 0.25), (x, sy * (L / 2 - 0.002), 0.18), HM(0x6fb6d6))
    for i in range(12):                                                             # vai chai + nắp (5 × 12 = 60 chai)
        for j in range(5):
            x, y = -W / 2 + 0.048 + j * 0.096, -L / 2 + 0.046 + i * 0.0917
            cyl(P, 0.04, 0.05, (x, y, 0.335), xanh, n=6, r2=0.017)
            cyl(P, 0.016, 0.022, (x, y, 0.37), xanh_dam, n=6)
    for sy in (-1, 1):                                                              # quai đai vàng hai đầu
        for sx in (-1, 1):
            box(P, (0.025, 0.012, 0.3), (sx * 0.13, sy * (L / 2 + 0.008), 0.2), vang)
            box(P, (0.025, 0.05, 0.02), (sx * 0.13, sy * (L / 2 + 0.03), 0.33), vang)
        box(P, (0.3, 0.03, 0.03), (0, sy * (L / 2 + 0.05), 0.33), vang, bev=0.006)
    for sx in (-1, 1):                                                              # nhãn vàng "2 NGƯỜI KHIÊNG" hai mặt dài
        box(P, (0.004, 0.3, 0.1), (sx * (W / 2 + 0.006), 0, 0.075), vang)
        for y in (-0.07, 0.07):
            box(P, (0.003, 0.018, 0.05), (sx * (W / 2 + 0.009), y, 0.07), den)      # người que
            box(P, (0.003, 0.022, 0.022), (sx * (W / 2 + 0.009), y, 0.108), den)
        box(P, (0.003, 0.16, 0.012), (sx * (W / 2 + 0.009), 0, 0.085), den)          # cái kiện giữa hai người
    return finish(P, 'kien_nuoc', 'Kiện nước suối (2 người khiêng)',
                  'Dài 1,1 m, 60 chai 1,5 L bọc màng co (~90 kg), quai đai vàng hai đầu, nhãn vàng hình 2 người khiêng.')

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

# 12+. Hàng hoá (rất nhẹ, dùng InstancedMesh hàng nghìn cái). Kiểu low-poly màu tươi, nhãn là các dải màu,
#      MỖI MÓN CÓ MỘT HÌNH NHẬN DIỆN RIÊNG ở mặt trước (sóng, lát chanh, bát mì, con cá…) để phân biệt từ xa.
#      Khi xuất, mọi màu của một món gộp vào màu đỉnh: mỗi loại hàng chỉ tốn 1 lệnh vẽ trong game.
def HM(hexv, rough=0.6):
    return M(f'hh_{hexv:06x}', hexv, rough)

FRONT = (math.pi / 2, 0, 0)   # xoay hình trụ dẹt để mặt tròn quay ra trước (-Y)

def tron(P, r, x, y, z, col, n=8, sx=1.0, sz=1.0):
    """Hình tròn dẹt dán lên mặt trước (y = mặt trước)."""
    o = cyl(P, r, 0.004, (x, y, z), HM(col), n=n, rot=FRONT)
    o.scale = (sx, 1, sz)
    return o

def tam_giac(P, pts, y, col):
    """Tam giác phẳng dán mặt trước, pts = [(x, z)×3] theo chiều kim đồng hồ khi nhìn từ trước."""
    mesh(P, 'tg', [(x, y, z) for x, z in pts], [(0, 1, 2)], HM(col))

def lon(name, ten, than, soc, icon, mo_ta='Lon 12,4 cm.'):
    """Lon tròn 14 cạnh bo mượt: đáy nhôm vát, thân thẳng có dải nhãn, cổ thắt lại, vành miệng nhôm."""
    P = []
    A, B, S = C['nhom'], HM(than), HM(soc)
    tien(P, [
        (0.024, 0.000, A), (0.033, 0.010, B),                                    # đáy vát
        (0.033, 0.025, S), (0.033, 0.055, B),                                    # dải nhãn dưới
        (0.033, 0.104, A), (0.0295, 0.115, A),                                   # cổ lon thắt dần
        (0.0272, 0.121, A), (0.0276, 0.124, A),                                  # vành miệng
    ], n=12)
    box(P, (0.011, 0.019, 0.0025), (0, 0.006, 0.1252), C['nhom'])                # khoen mở lon
    k = len(P)
    icon(P, -0.0345)
    uon(P[k:], 0.033)
    return finish(P, name, ten, mo_ta)

def icon_song(P, y):                                                            # sóng trắng chéo (cô-la)
    for i, (x, z, a) in enumerate(((-0.007, 0.082, 0.5), (0.007, 0.075, -0.45), (0.0, 0.094, 0.35))):
        box(P, (0.026 if i < 2 else 0.02, 0.003, 0.006), (x, y, z), HM(0xf6f6f2), rot=(0, a, 0))

def icon_chanh(P, y):                                                           # lát chanh vàng có múi
    tron(P, 0.016, 0, y, 0.085, 0xf6cf3f)
    tron(P, 0.011, 0, y - 0.001, 0.085, 0xfdf3b0, n=6)
    for a in (0.0, 1.05, 2.1):
        box(P, (0.022, 0.003, 0.0025), (0, y - 0.002, 0.085), HM(0xf6cf3f), rot=(0, a, 0))

def icon_cam_lon(P, y):                                                         # lát cam trên lon
    tron(P, 0.016, 0, y, 0.085, 0xf28c28)
    tron(P, 0.011, 0, y - 0.001, 0.085, 0xfdd27a, n=6)
    for a in (0.0, 1.05, 2.1):
        box(P, (0.022, 0.003, 0.0025), (0, y - 0.002, 0.085), HM(0xf28c28), rot=(0, a, 0))

def icon_hat_cafe(P, y):                                                        # 2 hạt cà phê
    for x in (-0.009, 0.009):
        tron(P, 0.009, x, y, 0.085, 0x3a2216, n=6, sx=0.75, sz=1.25)
        box(P, (0.002, 0.003, 0.016), (x, y - 0.002, 0.085), HM(0xc98a3a))

def lon_cam():
    return lon('hh_lon_cam', 'Lon soda cam', 0xf28c28, 0xf6f6f2, icon_cam_lon, 'Lon 12,4 cm, cam, dải trắng, hình lát cam.')

def ca_phe_lon():
    return lon('hh_ca_phe', 'Lon cà phê sữa', 0x5a3424, 0xe9dcc4, icon_hat_cafe, 'Lon 12,4 cm, nâu, dải kem, 2 hạt cà phê.')

def icon_la_tra(P, y, z, r):                                                    # 2 lá trà
    for x in (-0.007, 0.007):
        tron(P, 0.008, x, y, z, 0x2e7d4f, n=6, sx=0.7, sz=1.6)

def tra_xanh():
    return chai('hh_tra_xanh', 'Chai trà xanh', 'Cao 26 cm, nước trà xanh nhạt, nhãn trắng có 2 lá trà, nắp xanh lá.',
                0xb5d77a, 0xf6f6f2, 0x2e7d4f, icon=icon_la_tra)

def lon_nuoc():
    return lon('hh_lon_nuoc', 'Lon nước ngọt cô-la', 0xd8342b, 0xf6f6f2, icon_song,
               'Lon 12,4 cm, đỏ, dải trắng dưới, hình sóng trắng chéo.')

def lon_xanh():
    return lon('hh_lon_xanh', 'Lon soda chanh', 0x4cae4f, 0xf6cf3f, icon_chanh,
               'Lon 12,4 cm, xanh lá, dải vàng, hình lát chanh.')

def chai(name, ten, mo_ta, than, nhan, nap, r=0.034, h=0.17, n=8, icon=None):
    """Chai nhựa thon (tiện tròn 14 cạnh, bo mượt): đáy thót, thân có eo và gờ, nhãn quấn quanh,
    vai cong dần lên cổ, khoen cổ, nắp có khía. r, h: bán kính và chiều cao thân kiểu cũ (giữ nguyên tổng chiều cao),
    thân thật thon hơn 14%."""
    P = []
    r = r * 0.86
    T, N, Q = HM(than), HM(nhan), HM(nap)
    z0 = 0.012
    zl0, zl1 = z0 + h * 0.27, z0 + h * 0.65      # nhãn
    zs = z0 + h                                  # bắt đầu vai
    zn = zs + h * 0.30                           # cổ
    top = z0 + h * 1.32 + 0.024                  # đỉnh nắp (như cũ)
    tien(P, [
        (r * 0.78, 0.0, T), (r, 0.010, T),                                       # đáy thót
        (r, zl0 - 0.0006, T), (r * 1.03, zl0, N), (r * 1.03, zl1, T),           # nhãn quấn
        (r, zl1 + 0.0006, T), (r * 0.90, zl1 + h * 0.10, T), (r, zl1 + h * 0.2, T),  # eo cầm tay
        (r * 0.93, zs + h * 0.07, T), (r * 0.74, zs + h * 0.16, T),             # vai cong
        (r * 0.45, zs + h * 0.25, T), (r * 0.40, zn, T),                        # cổ
        (r * 0.55, zn + 0.004, Q), (r * 0.47, zn + 0.005, Q), (r * 0.44, top, Q),  # khoen cổ + nắp
    ], n=10)
    if icon:
        k = len(P)
        icon(P, -(r * 1.03 + 0.0025), 0.012 + h * 0.46, r)
        uon(P[k:], r * 1.03)
    return finish(P, name, ten, mo_ta)

def icon_nui(P, y, z, r):                                                       # núi tuyết (nước suối)
    tam_giac(P, [(-0.022, z - 0.016), (0.0, z + 0.018), (0.022, z - 0.016)], y, 0xf6f6f2)
    tam_giac(P, [(-0.006, z + 0.008), (0.0, z + 0.018), (0.006, z + 0.008)], y - 0.001, 0x9ad8ee)

def icon_lat_cam(P, y, z, r):                                                   # lát cam
    tron(P, r * 0.55, 0, y, z, 0xf6a21e)
    tron(P, r * 0.42, 0, y - 0.001, z, 0xfdd27a, n=6)
    for a in (0.0, 1.05, 2.1):
        box(P, (r * 0.85, 0.003, 0.003), (0, y - 0.002, z), HM(0xf6a21e), rot=(0, a, 0))

def icon_giot(P, y, z, r):                                                      # giọt dầu vàng
    tron(P, 0.014, 0, y, z - 0.004, 0xf6d34a)
    tam_giac(P, [(-0.0125, z - 0.002), (0.0, z + 0.024), (0.0125, z - 0.002)], y, 0xf6d34a)

def icon_qua_cam(P, y, z, r):                                                   # quả cam + lá
    tron(P, 0.016, 0, y, z, 0xf28c28)
    box(P, (0.014, 0.003, 0.007), (0.01, y - 0.001, z + 0.017), HM(0x3a9c3a), rot=(0, -0.5, 0))

def chai_nuoc():
    return chai('hh_chai_nuoc', 'Chai nước suối', 'Cao 26 cm, nhãn xanh dương có núi tuyết, nắp trắng.',
                0x9ad8ee, 0x2f7fc1, 0xf6f6f2, icon=icon_nui)

def chai_ngot():
    return chai('hh_chai_ngot', 'Chai nước cam 1,5 L', 'Cao 32 cm, to bè, nhãn xanh lá có lát cam.',
                0xf28c28, 0x2e9c4f, 0x2e9c4f, r=0.045, h=0.22, icon=icon_lat_cam)

def nuoc_cam():
    return chai('hh_nuoc_cam', 'Chai nước ép cam', 'Cao 23 cm, nhãn trắng có quả cam. Bày trong tủ mát.',
                0xf6a21e, 0xf6f6f2, 0x3a9c3a, h=0.15, icon=icon_qua_cam)

def dau_an():
    return chai('hh_dau_an', 'Chai dầu ăn', 'Cao 29 cm, vàng óng, nắp đỏ, nhãn xanh có giọt dầu.',
                0xf2c230, 0x3a9c3a, 0xd8342b, r=0.038, h=0.19, icon=icon_giot)

def hop(name, ten, mo_ta, w, d, h, than, dai, logo, bev=0.0):
    P = []
    box(P, (w, d, h), (0, 0, h / 2), HM(than), bev=bev)
    box(P, (w + 0.002, d + 0.002, h * 0.2), (0, 0, h * 0.24), HM(dai))           # dải màu ngang
    box(P, (w * 0.5, 0.003, h * 0.16), (0, -d / 2 - 0.0015, h * 0.84), HM(logo))  # logo chữ
    return P

def hop_banh_v(name, ten, mo_ta, than, dai, logo, banh, hat):
    P = hop(name, '', '', 0.16, 0.06, 0.22, than, dai, logo)
    y = -0.032
    for (x, z) in ((-0.03, 0.115), (0.03, 0.135)):                              # 2 chiếc bánh quy
        tron(P, 0.03, x, y, z, banh, n=8)
        for (dx, dz) in ((-0.01, 0.006), (0.011, -0.004), (0.0, -0.013)):
            box(P, (0.007, 0.003, 0.007), (x + dx, y - 0.003, z + dz), HM(hat))   # hạt trên bánh
    return finish(P, name, ten, mo_ta)

def hop_banh():
    return hop_banh_v('hh_hop_banh', 'Hộp bánh quy bơ', '16×22 cm, vàng, dải nâu, 2 bánh quy có hạt sô-cô-la.',
                      0xf6cf3f, 0x7a4a2a, 0xd8342b, 0xc98a3a, 0x4a2a16)

def banh_dua():
    return hop_banh_v('hh_banh_dua', 'Hộp bánh quy dừa', '16×22 cm, xanh dương nhạt, dải trắng, 2 bánh quy rắc dừa trắng.',
                      0x6fb7e0, 0xf6f6f2, 0x2f7fc1, 0xe0b878, 0xf6f6f2)

def ngu_coc():
    P = hop('hh_ngu_coc', '', '', 0.19, 0.065, 0.27, 0xe0463c, 0xf6cf3f, 0xf6f6f2)
    y = -0.0345
    tron(P, 0.055, 0, y, 0.115, 0xf6f6f2, n=10, sz=0.55)                         # bát
    for (x, z) in ((-0.025, 0.135), (0.0, 0.142), (0.025, 0.134), (-0.012, 0.128), (0.014, 0.127)):
        tron(P, 0.009, x, y - 0.002, z, 0xe8a33c, n=6)                           # hạt ngũ cốc
    box(P, (0.006, 0.003, 0.06), (0.045, y - 0.003, 0.15), HM(0xc7cbcc), rot=(0, 0.5, 0))  # thìa
    return finish(P, 'hh_ngu_coc', 'Hộp ngũ cốc', '19×27 cm, đỏ, bát ngũ cốc có thìa.')

def socola():
    P = hop('hh_socola', '', '', 0.09, 0.028, 0.16, 0x6b3a22, 0xd4a537, 0xe0463c)
    for i in range(2):
        for j in range(3):                                                      # thanh sô-cô-la lộ ô
            box(P, (0.026, 0.005, 0.022), (-0.015 + i * 0.03, -0.016, 0.07 + j * 0.026), HM(0x4a2716))
    return finish(P, 'hh_socola', 'Thanh sô-cô-la sữa', '9×16 cm, nâu, dải vàng kim, lộ 6 ô sô-cô-la.')

def goi_mi_v(name, ten, mo_ta, goi, dai, ot=True):
    P = []
    box(P, (0.15, 0.045, 0.12), (0, 0, 0.06), HM(goi), bev=0.012)
    box(P, (0.152, 0.047, 0.03), (0, 0, 0.098), HM(dai))                         # dải màu trên
    y = -0.025
    tron(P, 0.028, 0.025, y, 0.045, 0xf6f6f2, n=8, sz=0.6)                       # bát mì
    for k in range(3):
        box(P, (0.04, 0.003, 0.004), (0.025, y - 0.002, 0.05 + k * 0.006), HM(0xf6cf3f))  # sợi mì
    for a in (0.55, 0.75):
        box(P, (0.004, 0.003, 0.055), (0.045, y - 0.003, 0.068), HM(0x8a6238), rot=(0, a, 0))  # đôi đũa
    if ot:
        tron(P, 0.006, -0.045, y, 0.05, 0xb3261e, n=6, sz=2.2)                   # quả ớt
    else:
        tron(P, 0.012, -0.042, y, 0.052, 0xc98a3a, n=6)                           # đùi gà
        box(P, (0.006, 0.003, 0.016), (-0.042, y - 0.002, 0.036), HM(0xf6f6f2))
    return finish(P, name, ten, mo_ta)

def goi_mi():
    return goi_mi_v('hh_goi_mi', 'Gói mì tôm chua cay', '15×12 cm, cam, dải đỏ, bát mì có đũa và quả ớt.', 0xf28c28, 0xd8342b)

def goi_mi_ga():
    return goi_mi_v('hh_mi_ga', 'Gói mì gà', '15×12 cm, vàng, dải xanh lá, bát mì có đũa và đùi gà.', 0xf6cf3f, 0x2e9c4f, ot=False)

def hop_sua():
    P = []
    w, d, h, g = 0.07, 0.07, 0.15, 0.03
    box(P, (w, d, h), (0, 0, h / 2), HM(0xf6f6f2))
    box(P, (w + 0.002, d + 0.002, 0.04), (0, 0, 0.02), HM(0x3f8fd2))
    for (x, z, s) in ((-0.018, 0.1, 0.016), (0.016, 0.075, 0.012), (0.02, 0.12, 0.009)):
        box(P, (s, 0.003, s * 0.8), (x, -d / 2 - 0.0015, z), HM(0x1e1e1e))       # đốm bò sữa
    box(P, (0.022, 0.003, 0.016), (-0.012, -d / 2 - 0.0015, 0.055), HM(0x4cae4f))  # lá xanh
    v = [(-w / 2, -d / 2, h), (w / 2, -d / 2, h), (w / 2, d / 2, h), (-w / 2, d / 2, h), (-w / 2, 0, h + g), (w / 2, 0, h + g)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
    mesh(P, 'mai_hop', v, f, HM(0x3f8fd2))
    box(P, (w, 0.006, 0.012), (0, 0, h + g + 0.004), HM(0x3f8fd2))
    return finish(P, 'hh_hop_sua', 'Hộp sữa tươi', 'Cao 18 cm, trắng có đốm bò sữa, mái và đáy xanh dương.')

def snack_v(name, ten, mo_ta, goi, mep, dia, lat, bang, ot=False):
    P = []
    box(P, (0.16, 0.07, 0.2), (0, 0, 0.11), HM(goi), bev=0.028)                  # gói phồng
    for z in (0.012, 0.208):
        box(P, (0.162, 0.018, 0.022), (0, 0, z), HM(mep))                         # mép hàn
    y = -0.043
    box(P, (0.11, 0.003, 0.03), (0, y, 0.16), HM(bang))                           # băng rôn tên
    tron(P, 0.04, 0, y, 0.095, dia, n=10)                                        # đĩa logo
    for (x, z, a) in ((-0.016, 0.1, 0.4), (0.014, 0.104, -0.5), (0.0, 0.084, 0.1)):
        box(P, (0.026, 0.003, 0.018), (x, y - 0.003, z), HM(lat), rot=(0, a, 0))  # lát snack
    if ot:
        for x in (-0.047, 0.047):
            tron(P, 0.007, x, y, 0.06, 0xb3261e, n=6, sz=2.4)                     # quả ớt
    return finish(P, name, ten, mo_ta)

def snack():
    return snack_v('hh_snack', 'Gói snack khoai tây', '16×22 cm, gói phồng tím, đĩa vàng có lát khoai, băng rôn đỏ.',
                   0x8e5bb5, 0x6a3f8f, 0xf6cf3f, 0xe8a33c, 0xe0463c)

def snack_rong_bien():
    return snack_v('hh_snack_rong', 'Snack rong biển', '16×22 cm, gói xanh lá đậm, đĩa trắng có lá rong biển xanh đen.',
                   0x2e7d4f, 0x1f5a37, 0xf6f6f2, 0x1f3a2a, 0xf6cf3f)

def snack_cay():
    return snack_v('hh_snack_cay', 'Snack cay', '16×22 cm, gói đỏ rực, đĩa vàng, lát snack cam, 2 quả ớt.',
                   0xc62828, 0x8e1c1c, 0xf6cf3f, 0xf28c28, 0x1e1e1e, ot=True)

def do_hop():
    P = []
    cyl(P, 0.04, 0.074, (0, 0, 0.045), HM(0x2e9c4f), n=8)
    cyl(P, 0.0405, 0.016, (0, 0, 0.022), HM(0xf28c28), n=8)
    cyl(P, 0.038, 0.008, (0, 0, 0.004), C['nhom'], n=8, r2=0.04)
    cyl(P, 0.04, 0.008, (0, 0, 0.086), C['nhom'], n=8, r2=0.037)
    y = -0.0415
    tron(P, 0.015, -0.004, y, 0.055, 0xc7cbcc, n=8, sx=1.5, sz=0.8)              # thân cá bạc
    tam_giac(P, [(0.016, 0.055), (0.032, 0.068), (0.032, 0.042)], y, 0xc7cbcc)    # đuôi cá
    box(P, (0.004, 0.003, 0.004), (-0.02, y - 0.003, 0.058), HM(0x1e1e1e))       # mắt cá
    return finish(P, 'hh_do_hop', 'Cá hộp sốt cà', 'Lon thấp 9 cm, nhãn xanh lá dải cam, hình con cá bạc.')

def nuoc_tay_v(name, ten, mo_ta, than, sao):
    P = []
    box(P, (0.085, 0.052, 0.17), (0, 0, 0.085), HM(than), bev=0.014)
    box(P, (0.06, 0.003, 0.08), (0, -0.0275, 0.08), HM(0xf6f6f2))                 # nhãn
    for a in (0.0, 0.785, 1.57, 2.36):
        box(P, (0.034 if a in (0.0, 1.57) else 0.022, 0.003, 0.005), (0, -0.0295, 0.09), HM(sao), rot=(0, a, 0))  # ngôi sao lấp lánh
    box(P, (0.04, 0.003, 0.01), (0, -0.0295, 0.05), HM(0xe0463c))
    cyl(P, 0.016, 0.03, (0, 0, 0.185), HM(0xf6f6f2), n=8)                         # cổ
    box(P, (0.034, 0.075, 0.035), (0, -0.016, 0.215), HM(0xf6f6f2), bev=0.006)    # đầu vòi xịt
    box(P, (0.014, 0.02, 0.035), (0, -0.03, 0.188), HM(0xe0463c))                 # cò bóp
    box(P, (0.016, 0.012, 0.016), (0, -0.058, 0.215), HM(0xe0463c))               # vòi
    return finish(P, name, ten, mo_ta)

def nuoc_tay():
    return nuoc_tay_v('hh_nuoc_tay', 'Bình xịt tẩy rửa', 'Cao 23 cm, xanh dương, nhãn trắng có ngôi sao vàng, đầu xịt trắng cò đỏ.', 0x3f8fd2, 0xf6cf3f)

def lau_san():
    return nuoc_tay_v('hh_lau_san', 'Bình nước lau sàn', 'Cao 23 cm, hồng, nhãn trắng có ngôi sao tím, đầu xịt trắng cò đỏ.', 0xe86aa0, 0x8e5bb5)

def nuoc_giat():
    P = []
    box(P, (0.13, 0.085, 0.21), (0, 0, 0.105), HM(0xf28c28), bev=0.02)
    box(P, (0.024, 0.06, 0.07), (0.035, 0, 0.215), HM(0xf28c28), bev=0.008)       # quai cầm
    cyl(P, 0.022, 0.03, (-0.03, 0, 0.222), HM(0x3f8fd2), n=8)                     # nắp
    box(P, (0.09, 0.003, 0.1), (0, -0.0435, 0.1), HM(0xf6f6f2))                   # nhãn
    for (x, z, r) in ((-0.018, 0.09, 0.016), (0.016, 0.11, 0.012), (0.012, 0.075, 0.008), (-0.01, 0.125, 0.007)):
        tron(P, r, x, -0.046, z, 0x8fd3ea, n=6)                                   # bong bóng xà phòng
    return finish(P, 'hh_nuoc_giat', 'Can nước giặt', 'Cao 24 cm, cam, quai cầm, nắp xanh, nhãn trắng có bong bóng.')

# Hàng lạnh
def kem_hop():
    P = []
    cyl(P, 0.058, 0.075, (0, 0, 0.0375), HM(0xee8fb0), n=10, r2=0.064)
    cyl(P, 0.066, 0.014, (0, 0, 0.082), HM(0xf6f6f2), n=10)
    cyl(P, 0.04, 0.003, (0, 0, 0.09), HM(0xe0463c), n=8)                          # quả dâu trên nắp
    y = -0.062
    tam_giac(P, [(-0.012, 0.045), (0.0, 0.012), (0.012, 0.045)], y, 0xc98a3a)      # ốc quế
    tron(P, 0.014, 0, y, 0.05, 0xf6f6f2, n=6)                                     # viên kem
    return finish(P, 'hh_kem', 'Hộp kem dâu', 'Hộp tròn 13 cm, cao 9 cm, hồng nắp trắng, quả dâu trên nắp, ốc quế phía trước.')

def goi_dong():
    P = []
    box(P, (0.2, 0.27, 0.045), (0, 0, 0.0225), HM(0x2f7fc1), bev=0.012)          # túi nằm phẳng
    box(P, (0.13, 0.11, 0.004), (0, -0.05, 0.046), HM(0xeef3f5))                  # cửa sổ thấy hàng
    for (x, y) in ((-0.035, -0.05), (0.0, -0.035), (0.035, -0.055)):
        ball(P, 0.022, (x, y, 0.048), HM(0xf1e2c4), scale=(1.3, 0.9, 0.45))       # sủi cảo
    box(P, (0.202, 0.04, 0.03), (0, 0.1, 0.022), HM(0xd8342b))                    # dải đỏ
    return finish(P, 'hh_goi_dong', 'Gói sủi cảo đông lạnh', '20×27 cm, nằm phẳng, xanh dương, cửa sổ thấy 3 viên sủi cảo.')

def pizza():
    P = []
    box(P, (0.28, 0.28, 0.04), (0, 0, 0.02), HM(0xd8342b), bev=0.004)
    cyl(P, 0.1, 0.003, (0.02, 0.02, 0.041), HM(0xf2a640), n=12)                   # hình bánh pizza
    for (x, y) in ((-0.02, 0.05), (0.06, 0.0), (0.0, -0.04), (0.06, 0.07)):
        cyl(P, 0.016, 0.003, (x, y, 0.043), HM(0xa82a24), n=6)
    box(P, (0.28, 0.05, 0.003), (0, -0.11, 0.041), HM(0xf6f6f2))
    return finish(P, 'hh_pizza', 'Hộp pizza đông lạnh', '28×28 cm, dày 4 cm, nằm phẳng trong tủ đông.')

def sua_chua():
    P = []
    for x in (-0.034, 0.034):
        for y in (-0.034, 0.034):
            cyl(P, 0.031, 0.06, (x, y, 0.03), HM(0xf6f6f2), n=8, r2=0.027)
            cyl(P, 0.029, 0.004, (x, y, 0.062), HM(0xee8fb0), n=8)                # nắp hồng
    box(P, (0.14, 0.14, 0.025), (0, 0, 0.03), HM(0xee8fb0))                      # đai giấy lốc 4
    tron(P, 0.009, 0, -0.072, 0.03, 0xe0463c, n=6, sz=1.2)                         # quả dâu trên đai
    box(P, (0.012, 0.003, 0.004), (0, -0.074, 0.042), HM(0x3a9c3a))
    return finish(P, 'hh_sua_chua', 'Lốc sữa chua dâu', '4 hũ nắp hồng, 14×14 cm, cao 6,5 cm, đai hồng có quả dâu. Bày ở ngăn mát.')

def sua_tuoi():
    P = []
    box(P, (0.09, 0.09, 0.19), (0, 0, 0.095), HM(0xf6f6f2), bev=0.014)
    box(P, (0.092, 0.092, 0.05), (0, 0, 0.05), HM(0x3f8fd2))
    cyl(P, 0.02, 0.03, (0.018, 0.018, 0.2), HM(0x3f8fd2), n=8)
    for (x, z, s) in ((-0.02, 0.13, 0.018), (0.018, 0.115, 0.013), (0.01, 0.155, 0.01)):
        box(P, (s, 0.003, s * 0.8), (x, -0.0465, z), HM(0x1e1e1e))                # đốm bò sữa
    return finish(P, 'hh_sua_tuoi', 'Bình sữa tươi 1 L', 'Cao 21 cm, trắng có đốm bò sữa, dải và nắp xanh dương.')

# Khu rau quả: kệ gỗ nghiêng bày 3 sọt, quả đã đặt sẵn trong model (1 lệnh vẽ cho cả kệ).
import random

def nghieng(objs, pivot, a):
    """Xoay các khối quanh trục X đi qua pivot (a > 0: phía sau +Y nâng lên)."""
    bpy.context.view_layer.update()
    from mathutils import Matrix
    T = Matrix.Translation(Vector(pivot)) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Translation(-Vector(pivot))
    for o in objs:
        o.matrix_world = T @ o.matrix_world

def qua(P, kind, x, y, z, rnd):
    if kind == 'tao':
        o = ball(P, 0.042, (x, y, z), HM(rnd.choice((0xd8342b, 0xb3261e, 0xe0463c))), scale=(1, 1, 0.88))
    elif kind == 'cam':
        o = ball(P, 0.043, (x, y, z), HM(rnd.choice((0xf28c28, 0xf6a21e))))
    elif kind == 'ca_chua':
        o = ball(P, 0.038, (x, y, z), HM(0xe0463c), scale=(1, 1, 0.8))
        box(P, (0.022, 0.022, 0.006), (x, y, z + 0.03), HM(0x3a9c3a))
    elif kind == 'khoai':
        o = ball(P, 0.042, (x, y, z), HM(rnd.choice((0xb58a55, 0xa47a4a))), scale=(1.35, 1, 0.8))
        o.rotation_euler = (0, 0, rnd.uniform(0, 3.14))
    elif kind == 'bap_cai':
        ball(P, 0.075, (x, y, z + 0.02), HM(0x8cc65a))
        o = ball(P, 0.05, (x, y, z + 0.075), HM(0xc4e38a), scale=(1, 1, 0.7))
    elif kind == 'dua':
        ball(P, 0.055, (x, y, z + 0.035), HM(0xc9862a), scale=(1, 1, 1.45))
        o = cyl(P, 0.04, 0.11, (x, y, z + 0.16), HM(0x3a9c3a), n=5, r2=0.0)
    elif kind == 'chuoi':                                                       # nải 4 quả xoè
        for k in range(4):
            a = -0.45 + k * 0.3
            b = ball(P, 0.026, (x + math.sin(a) * 0.03, y + math.cos(a) * 0.03 - 0.03, z), HM(0xf6cf3f), scale=(1, 3.3, 0.9))
            b.rotation_euler = (0, 0, a)
        o = box(P, (0.03, 0.03, 0.03), (x, y - 0.1, z), HM(0x5a7a2a))
    return o

KIEU_QUA = {  # kind: (khoảng cách, số lớp)
    'tao': (0.088, 2), 'cam': (0.09, 2), 'ca_chua': (0.08, 2), 'khoai': (0.1, 2),
    'bap_cai': (0.16, 1), 'dua': (0.13, 1), 'chuoi': (0.17, 1),
}
TEN_QUA = {'tao': 'táo', 'cam': 'cam', 'ca_chua': 'cà chua', 'khoai': 'khoai tây', 'bap_cai': 'bắp cải', 'dua': 'dứa', 'chuoi': 'chuối'}

def ke_rau_qua(name, kinds, seed):
    P = []
    rnd = random.Random(seed)
    W, D = 1.8, 1.1
    G = K['go_sang']
    GD = K['go_dam']
    for sx in (-1, 1):                                                          # khung chân gỗ
        for sy in (-1, 1):
            box(P, (0.07, 0.07, 0.72 if sy < 0 else 0.86), (sx * (W / 2 - 0.05), sy * (D / 2 - 0.05), (0.72 if sy < 0 else 0.86) / 2), GD)
    box(P, (W, 0.04, 0.5), (0, -D / 2 + 0.02, 0.36), K['nhan_hieu2'])           # tấm chắn trước xanh lá
    box(P, (W, 0.045, 0.06), (0, -D / 2 + 0.02, 0.64), GD)                      # nẹp trên
    box(P, (W - 0.1, D - 0.1, 0.03), (0, 0, 0.12), GD)                          # tầng dưới để thùng dự trữ
    for i in range(3):
        box(P, (0.5, 0.36, 0.2), (-0.58 + i * 0.58, 0.05, 0.235), C['carton'], bev=0.006)
    tilted = []
    a = 0.27
    for ci, kind in enumerate(kinds):
        cx = -0.6 + ci * 0.6
        Q = []
        bz = 0.72                                                               # đáy sọt (trước khi nghiêng)
        box(Q, (0.57, 0.92, 0.025), (cx, 0, bz), G)
        for sy in (-1, 1):
            box(Q, (0.57, 0.022, 0.14), (cx, sy * 0.45, bz + 0.07), G)
        for sx in (-1, 1):
            box(Q, (0.022, 0.92, 0.14), (cx + sx * 0.275, 0, bz + 0.07), G)
        for k in range(2):                                                      # nẹp quanh thành sọt
            z = bz + 0.04 + k * 0.06
            for sy in (-1, 1):
                box(Q, (0.58, 0.008, 0.016), (cx, sy * 0.463, z), GD)
            for sx in (-1, 1):
                box(Q, (0.008, 0.93, 0.016), (cx + sx * 0.288, 0, z), GD)
        step, layers = KIEU_QUA[kind]
        nx = int(0.5 / step)
        ny = int(0.84 / step)
        for l in range(layers):
            off = step / 2 * l
            for i in range(nx - l):
                for j in range(ny - l):
                    if l and rnd.random() < 0.35:
                        continue
                    x = cx - (nx - 1) * step / 2 + i * step + off + rnd.uniform(-0.008, 0.008)
                    y = -(ny - 1) * step / 2 + j * step + off + rnd.uniform(-0.008, 0.008)
                    qua(Q, kind, x, y, bz + 0.045 + l * step * 0.62, rnd)
        nghieng(Q, (cx, -0.45, bz), a)
        tilted += Q
        # bảng giá cắm trước sọt
        box(P, (0.008, 0.008, 0.16), (cx, -D / 2 + 0.03, 0.78), GD)
        box(P, (0.17, 0.006, 0.1), (cx, -D / 2 + 0.024, 0.88), HM(0xf6f6f2))
        box(P, (0.17, 0.007, 0.025), (cx, -D / 2 + 0.023, 0.92), HM(0xe0463c))
    P += tilted
    ten = ', '.join(TEN_QUA[k] for k in kinds)
    return finish(P, name, f'Kệ rau quả ({ten})',
                  f'1,8×1,1 m, cao ~1 m. Kệ gỗ nghiêng bày 3 sọt {ten}, tấm chắn xanh lá, bảng giá, thùng dự trữ ở tầng dưới.')

def ke_rau_qua_1():
    return ke_rau_qua('ke_rau_qua_1', ('tao', 'cam', 'chuoi'), 11)

def ke_rau_qua_2():
    return ke_rau_qua('ke_rau_qua_2', ('bap_cai', 'ca_chua', 'khoai'), 23)

def ke_rau_qua_3():
    return ke_rau_qua('ke_rau_qua_3', ('dua', 'tao', 'khoai'), 37)

# Xe đẩy mua hàng (khách) và chồng giỏ nhựa
def xe_mua_sam():
    P = []
    S = K['ke_xam']
    R = K['nhan_hieu']
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(P, 0.045, 0.03, (sx * 0.2, sy * 0.36, 0.045), C['cao_su'], n=8, rot=(0, math.pi / 2, 0))
            box(P, (0.03, 0.04, 0.06), (sx * 0.2, sy * 0.36, 0.1), S)
    for sx in (-1, 1):
        limb(P, (sx * 0.2, -0.36, 0.13), (sx * 0.2, 0.36, 0.13), 0.012, S, n=5)  # khung đáy
        limb(P, (sx * 0.2, 0.36, 0.13), (sx * 0.23, 0.4, 0.95), 0.012, S, n=5)   # trụ sau
    box(P, (0.4, 0.62, 0.012), (0, -0.02, 0.2), S)                               # giá dưới
    # Giỏ lưới: viền trên/dưới + nan dọc
    y0, y1, zb, zt = -0.44, 0.34, 0.46, 0.92
    for (z, w) in ((zb, 0.42), (zt, 0.5), ((zb + zt) / 2, 0.46)):
        for sx in (-1, 1):
            box(P, (0.012, y1 - y0, 0.012), (sx * w / 2, (y0 + y1) / 2, z), S)
        for y in (y0, y1):
            box(P, (w, 0.012, 0.012), (0, y, z), S)
    for k in range(8):
        y = y0 + (k + 0.5) * (y1 - y0) / 8
        for sx in (-1, 1):
            limb(P, (sx * 0.21, y, zb), (sx * 0.25, y, zt), 0.004, S, n=3)
    for k in range(5):
        x = -0.2 + k * 0.1
        for y in (y0, y1):
            limb(P, (x * 0.84, y, zb), (x, y, zt), 0.004, S, n=3)
    box(P, (0.4, y1 - y0, 0.01), (0, (y0 + y1) / 2, zb), S)                     # đáy giỏ
    limb(P, (-0.25, 0.42, 0.98), (0.25, 0.42, 0.98), 0.02, R, n=6)              # tay đẩy đỏ
    box(P, (0.14, 0.02, 0.08), (0, y0 - 0.005, 0.75), R)                         # biển nhỏ trước giỏ
    return finish(P, 'xe_mua_sam', 'Xe đẩy mua hàng',
                  '0,5×0,9 m, cao 1 m. Giỏ lưới thép, tay đẩy đỏ. Xếp lồng nhau ở bãi xe gần quầy.')

def gio_hang():
    P = []
    R = HM(0xd8342b)
    box(P, (0.48, 0.36, 0.06), (0, 0, 0.03), K['ke_chan'])                       # đế
    for i in range(6):
        z = 0.06 + i * 0.05
        w, d, h, t = 0.42, 0.3, 0.2, 0.012
        box(P, (w - 0.04, d - 0.04, t), (0, 0, z + t / 2), R)
        for sy in (-1, 1):
            box(P, (w, t, h), (0, sy * d / 2, z + h / 2), R)
        for sx in (-1, 1):
            box(P, (t, d, h), (sx * w / 2, 0, z + h / 2), R)
    for sx in (-1, 1):                                                          # quai giỏ trên cùng
        limb(P, (sx * 0.12, -0.15, 0.51), (sx * 0.12, 0.15, 0.51), 0.008, C['nhua_den'], n=4)
    return finish(P, 'gio_hang', 'Chồng giỏ nhựa', '6 giỏ đỏ 42×30 cm lồng nhau, cao 0,52 m. Đặt cạnh quầy.')

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
    bo('bang_phieu')                                                              # bảng kẹp phiếu việc (Tab), ẩn khi không xem
    # Dựng sẵn ở tư thế nghỉ sao cho khi tay trái giơ lên (động tác xem_phieu: cánh tay -40°, cẳng tay -92° quanh X)
    # bảng đứng nghiêng ~60° trước ngực, mặt giấy quay về phía mặt; bàn tay đỡ mép dưới.
    phi = math.radians(162)                                                       # trục "lên" của bảng ở tư thế nghỉ
    u = Vector((0, -math.sin(phi), math.cos(phi)))                                # hướng mép trên tờ phiếu
    nv = Vector((0, math.cos(phi), math.sin(phi)))                                # pháp tuyến mặt giấy
    H = Vector((0.33, -0.05, 0.62))                                               # lòng bàn tay trái
    at = lambda du, dn, dx=0.0: tuple(H + u * du + nv * dn + Vector((dx, 0, 0)))
    rot = (phi, 0, 0)
    box(P, (0.27, 0.014, 0.36), at(0.14, 0.03), C['go'], rot=rot, bev=0.004)        # tấm bìa cứng nâu
    box(P, (0.235, 0.004, 0.3), at(0.13, 0.039), C['giay'], rot=rot)               # tờ phiếu
    for i in range(6):                                                            # dòng chữ
        box(P, (0.16 - 0.04 * (i % 2), 0.003, 0.01), at(0.04 + i * 0.038, 0.042, -0.02 * (i % 2)), C['nhua_xam'], rot=rot)
    box(P, (0.045, 0.003, 0.024), at(0.24, 0.042, 0.06), C['thuong_hieu'], rot=rot)  # dấu đỏ
    box(P, (0.12, 0.024, 0.036), at(0.3, 0.04), C['thep'], rot=rot, bev=0.005)       # kẹp sắt ở mép trên
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
            bang_dong_lanh, may_cham_cong, the_nhan_vien, may_quet, den_pin, xe_day, kien_nuoc,
            tu_dien, thung_rac, tui_rac, xe_rac, thung_rac_lon,
            lon_nuoc, lon_xanh, lon_cam, ca_phe_lon, tra_xanh, snack_rong_bien, snack_cay, goi_mi_ga, banh_dua, lau_san, chai_nuoc, chai_ngot, hop_banh, ngu_coc, socola, goi_mi, hop_sua, snack, do_hop,
            nuoc_tay, nuoc_giat, dau_an, kem_hop, goi_dong, pizza, sua_chua, sua_tuoi, nuoc_cam,
            ke_rau_qua_1, ke_rau_qua_2, ke_rau_qua_3, xe_mua_sam, gio_hang]
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

def chan_cham_dat(d):
    """Hạ người vừa đủ để chân duỗi dài hơn chạm đúng mặt sàn (không lơ lửng, không cắm xuống sàn)."""
    ext = []
    for sd in ('L', 'R'):
        a = math.radians(d.get('dui.' + sd, (0, 0, 0))[0])
        b = math.radians(d.get('cang.' + sd, (0, 0, 0))[0])
        ext.append(KK_LT * math.cos(a) + KK_LS * math.cos(a + b))
    return max(ext) - (KK_LT + KK_LS)

# ---------- Người Kiểm Kê: dáng Slender Man — thẳng lưng, sải dài, đều đặn, tay buông gần như bất động
def kk_di(t, T):
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 24, 34, base_knee=3)
    d['hong'] = (0, 0, 2.5 * s)                    # chỉ xoay nhẹ theo bước, không nghiêng
    d['than'] = (3, 0, -2.0 * s)                   # thẳng lưng, hơi đổ tới, xoay ngược hông
    d['co'] = (2, 0, 0)
    d['dau'] = (-2, 0, -0.5 * s)                   # đầu giữ yên nhìn thẳng
    d['tay_tren.R'] = (-4 * math.sin(p - 0.5), 0, 0)   # tay dài đung đưa chậm, trễ nhịp như con lắc
    d['tay_duoi.R'] = (-2 - 2.5 * math.sin(p - 1.0), 0, 0)
    d['tay_tren.L'] = (0.6 * math.sin(2 * p), 0, 0)    # tay cầm máy quét giữ yên
    d['_loc'] = (0, 0, chan_cham_dat(d))
    return d

def kk_chay(t, T):
    """Chạy: đổ người tới, sải rất dài, tay cầm máy quét khoá cứng phía trước, tay dài kéo lê phía sau."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 36, 78, base_knee=8)
    d['hong'] = (0, 0, 4 * s)
    d['than'] = (14, 0, -3 * s)
    d['co'] = (-4, 0, 0)
    d['dau'] = (-10, 0, 0)                         # đầu khoá cứng, nhìn thẳng
    d['tay_tren.L'] = (-10, 0, 0)
    d['tay_tren.R'] = (22 + 4 * math.sin(p - 0.6), 0, 0)
    d['tay_duoi.R'] = (6, 0, 0)
    d['_loc'] = (0, 0, chan_cham_dat(d))
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

# ---------- Người Kiểm Kê: cảnh bắt người
KK_LT = KK['hip'] - KK['knee']
KK_LS = KK['knee'] - 0.06
# Tư thế vác thùng trên vai phải (tính bằng IK, không đoán góc):
#   thùng ngồi trên vai phải, mép trong ngay trên khớp vai; cánh tay vòng ra trước ngực, cẳng tay nằm ngang
#   ôm mặt trước thùng, bàn tay và ngón dài bám vào góc ngoài. Tay KHÔNG xuyên thùng (kiểm tra số bên dưới).
# Trong game thùng đặt ở (-0,50; 1,745; 0) so với gốc model rồi gắn vào xương thân (captureView.ts, SHOULDER_BOX).
THUNG_VAI = dict(cx=-0.50, cy=0.0, z0=1.745, w=0.58, d=0.58, h=0.5)
VAI_THAN = (0, 5, 0)

def ik_tay(sd, E, W, than=(0, 0, 0)):
    """Góc (độ, trục thế giới, kiểu make_clips) cho tay_tren/tay_duoi để khuỷu tới E, cổ tay tới W."""
    sx = 1 if sd == 'L' else -1
    S = Vector((sx * KK['sh'], 0, KK['sh_z']))
    E0 = Vector(KK['elbow_' + sd])
    W0 = Vector(KK['wrist_' + sd])
    piv = Vector((0, 0, KK['hip'] + 0.1))
    Rp = Euler(tuple(math.radians(a) for a in than), 'XYZ').to_matrix()
    S1 = piv + Rp @ (S - piv)
    u = (Vector(E) - S1).normalized()
    Ru = (E0 - S).normalized().rotation_difference(Rp.inverted() @ u).to_matrix()
    E1 = S1 + Rp @ Ru @ (E0 - S)
    f = (Vector(W) - E1).normalized()
    Rf = (W0 - E0).normalized().rotation_difference((Rp @ Ru).inverted() @ f).to_matrix()
    deg = lambda R: tuple(round(math.degrees(a), 2) for a in R.to_euler('XYZ'))
    W1 = E1 + Rp @ Ru @ Rf @ (W0 - E0)
    return {'tay_tren.' + sd: deg(Ru), 'tay_duoi.' + sd: deg(Rf)}, (S1, E1, W1, Rp @ Ru @ Rf @ (W0 - E0).normalized())

_E = (-0.04, -0.37, 1.93)
_W = tuple(Vector(_E) + Vector((-0.97, 0.0, 0.16)).normalized() * 0.46)
_tay, (_S, _E1, _W1, _dir) = ik_tay('R', _E, _W, VAI_THAN)
VAI = dict(_tay, dau=(0, 12, 0), than=VAI_THAN)

def _kiem_tra_vai():
    """In khoảng hở nhỏ nhất giữa tay (bán kính ~4,5 cm) và thùng; âm = xuyên."""
    b = THUNG_VAI
    lo = Vector((b['cx'] - b['w'] / 2, b['cy'] - b['d'] / 2, b['z0']))
    hi = Vector((b['cx'] + b['w'] / 2, b['cy'] + b['d'] / 2, b['z0'] + b['h']))
    def dist(p):
        q = Vector((min(max(p.x, lo.x), hi.x), min(max(p.y, lo.y), hi.y), min(max(p.z, lo.z), hi.z)))
        inside = all(lo[i] < p[i] < hi[i] for i in range(3))
        return -min(min(p[i] - lo[i], hi[i] - p[i]) for i in range(3)) if inside else (p - q).length
    tip = _W1 + _dir * 0.37
    worst = []
    for name, a, c, r in (('canh_tay', _S, _E1, 0.045), ('cang_tay', _E1, _W1, 0.04), ('ban_tay_ngon', _W1, tip, 0.025)):
        m = min(dist(a.lerp(c, k / 20)) - r for k in range(1, 21))
        worst.append((name, round(m, 3)))
    print('VAI', VAI, 'khuyu', tuple(round(v, 3) for v in _E1), 'co_tay', tuple(round(v, 3) for v in _W1), 'ho', worst)
_kiem_tra_vai()

def mix(a, b, k):
    """Trộn hai tư thế (dict góc) theo k (0 = a, 1 = b)."""
    out = {}
    for key in set(a) | set(b):
        va, vb = a.get(key, (0, 0, 0)), b.get(key, (0, 0, 0))
        out[key] = tuple(x + (y - x) * k for x, y in zip(va, vb))
    return out

def crouch(d, k):
    """Khuỵu gối k (0..1), bàn chân giữ nguyên trên sàn."""
    a, b = -32 * k, 55 * k
    for sd in ('L', 'R'):
        d['dui.' + sd] = (d.get('dui.' + sd, (0, 0, 0))[0] + a, 0, 0)
        d['cang.' + sd] = (d.get('cang.' + sd, (0, 0, 0))[0] + b, 0, 0)
    d['_loc'] = leg_comp(a, b, KK_LT, KK_LS)
    return d

def kk_lao_toi(t, T):
    """Lao tới: đổ người về trước, sải cực dài, tay dài vươn thẳng ra chộp, đầu khoá vào mục tiêu."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 44, 95, base_knee=10)
    d['hong'] = (0, 3 * s, 5 * s)
    d['than'] = (30, 0, -4 * s)
    d['co'] = (-14, 0, 0)
    d['dau'] = (-22, 0, 0)
    d['tay_tren.R'] = (-88 + 5 * s, -6, 0)
    d['tay_duoi.R'] = (-6, 0, 0)
    d['tay_tren.L'] = (-18, 0, 0)
    d['_loc'] = (0, 0, -0.05 * s * s)
    return d

def kk_bat(t, T):
    """Bắt và đóng thùng (3 giây, khớp BOXING_TIME):
       0–0,3 chộp · 0,3–0,55 giơ thùng lên quá đầu · 0,55–0,7 úp mạnh xuống · 1,4–2,0 ấn bẹp thùng
       2,0–2,35 kéo băng keo · 2,35–2,6 quét mã thùng (bíp) · 2,6–3,0 nhấc thùng lên vai."""
    reach = seg(t, 0.0, 0.3) * (1 - seg(t, 0.3, 0.5))
    up = seg(t, 0.3, 0.5) * (1 - snap(t, 0.55, 0.7))
    slam = snap(t, 0.55, 0.7) * (1 - seg(t, 1.3, 1.45))
    press = seg(t, 1.4, 1.65) * (1 - seg(t, 1.95, 2.1))
    jolt = math.sin(t * 40) * press * 2
    tape = seg(t, 1.95, 2.1) * (1 - seg(t, 2.3, 2.45))
    sweep = -30 + 60 * seg(t, 2.05, 2.32)
    scan = seg(t, 2.3, 2.42) * (1 - seg(t, 2.52, 2.65))
    lift = seg(t, 2.6, 3.0)
    d = {
        'tay_tren.R': (-62 * reach - 172 * up - 58 * slam - 48 * press - 62 * tape, 0, sweep * tape),
        'tay_duoi.R': (-8 * reach - 10 * up + 4 * slam, 0, 0),
        'tay_tren.L': (-12 * reach - 150 * up - 52 * slam - 42 * press + 8 * scan, 0, 0),
        'tay_duoi.L': (-10 * up + 42 * scan, 0, 0),
        'than': (22 * reach - 8 * up + 32 * slam + 46 * press + jolt + 36 * tape + 30 * scan, 0, 0),
        'co': (-6 * up, 0, 0),
        'dau': (-12 * reach - 26 * up + 10 * slam + 16 * press + 12 * tape + 22 * scan, 0, 0.6 * sweep * tape),
    }
    crouch(d, 0.5 * slam + 0.8 * press + 0.4 * tape + 0.3 * scan)
    return mix(d, VAI, lift) | ({'_loc': tuple(v * (1 - lift) for v in d['_loc'])})

def kk_vac_hop(t, T):
    """Đi vác thùng trên vai phải: vẫn thẳng lưng, bước đều; tay phải giữ chặt thùng (không đổi góc so với thân).
    Trong game thùng gắn vào xương 'than' nên nhún, lắc đúng theo người."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    d = {}
    legs_walk(d, p, 24, 34, base_knee=3)
    d.update(VAI)
    d['hong'] = (0, 0, 2.5 * s)
    d['than'] = (4, 5, -1.5 * s)
    d['co'] = (2, 0, 0)
    d['dau'] = (0, 12, 0)
    d['tay_tren.L'] = (0.6 * math.sin(2 * p), 0, 0)
    d['_loc'] = (0, 0, chan_cham_dat(d))
    return d

def kk_dat_hop(t, T):
    """Đặt thùng xuống (1 giây, khớp STORE_TIME): hạ thùng từ vai xuống trước mặt, cúi đặt xuống sàn."""
    a = seg(t, 0.0, 0.35)
    down = seg(t, 0.15, 0.75)
    front = {'tay_tren.R': (-50, 0, 0), 'tay_duoi.R': (-15, 0, 0), 'tay_tren.L': (-40, 0, 0), 'tay_duoi.L': (-10, 0, 0)}
    d = mix(VAI, front, a)
    d['than'] = (52 * down, 0, 5 * (1 - a))
    d['dau'] = (20 * down, 12 * (1 - a), 0)
    crouch(d, 0.9 * down)
    return d

arm = make_rig(objs['nguoi_kiem_ke'], 'nguoi_kiem_ke', bones_human(
    KK['hip'], KK['chest'], KK['neck'], KK['head_top'], (-0.06, -0.1),
    shoulders={'L': (KK['sh'], 0, KK['sh_z']), 'R': (-KK['sh'], 0, KK['sh_z'])},
    elbows={'L': KK['elbow_L'], 'R': KK['elbow_R']},
    wrists={'L': KK['wrist_L'], 'R': KK['wrist_R']},
    knees={'L': (0.102, 0, KK['knee']), 'R': (-0.102, 0, KK['knee'])},
    ankles={'L': (0.1, 0, 0.06), 'R': (-0.1, 0, 0.06)}, hips_x=0.1))
KK_CLIPS = [('di', 1.6, kk_di, 'Đi tuần (chậm, đều)', True),
            ('chay', 0.8, kk_chay, 'Chạy (khi mất điện, nghe tiếng động)', True),
            ('dung_im', 4.0, kk_dung, 'Đứng im', True),
            ('quet', 3.2, kk_quet, 'Quét qua lại', True),
            ('quay_dau', 2.4, kk_quay_dau, 'Quay đầu giật (nghe tiếng động)', True),
            ('dem', 2.8, kk_dem, 'Đếm "Một… Hai…"', True),
            ('lao_toi', 0.55, kk_lao_toi, 'Lao tới chộp người (đếm xong)', True),
            ('bat', 3.0, kk_bat, 'Bắt và đóng thùng: úp thùng, ấn bẹp, dán băng keo, quét mã, nhấc lên vai', False),
            ('vac_hop', 1.6, kk_vac_hop, 'Vác thùng trên vai về kho', True),
            ('dat_hop', 1.0, kk_dat_hop, 'Đặt thùng xuống ô trong kho', False)]
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

def cam_phieu(d, t, T, walking):
    """Tay trái giơ bảng kẹp phiếu việc trước ngực (bảng nằm dọc cẳng tay), đầu cúi nhìn, tay phải lật trang / chỉ dòng.
    Người khác nhìn vào là biết người này đang xem phiếu việc (bấm Tab)."""
    p = 2 * math.pi * t / T
    s = math.sin(p)
    flip = 0.0 if walking else pulse(t, T * 0.62, 0.14)           # thỉnh thoảng lật trang
    d['tay_tren.L'] = (-40 + (2 * math.sin(2 * p) if walking else 0), 0, -30)
    d['tay_duoi.L'] = (-84, 0, 0)
    d['tay_tren.R'] = (-30 - 14 * flip, 0, 26 + 10 * flip)
    d['tay_duoi.R'] = (-62 - 20 * flip + (0 if walking else 6 * math.sin(3 * p)), 0, 0)   # ngón tay dò từng dòng
    old = d.get('dau', (0, 0, 0))
    d['dau'] = (26 + 3 * math.sin(p * 2), old[1] * 0.4, -6 + 4 * s)
    th = d.get('than', (0, 0, 0))
    d['than'] = (th[0] + 5, th[1], th[2] * 0.5)
    d['day_the'] = (d.get('day_the', (0, 0, 0))[0] * 0.5 - 8, 0, 0)
    d['%bang_phieu'] = 1.0
    return d

def ngo_xem_phieu(t, T):
    return cam_phieu(ngo_dung(t, T), t, T, False)

def ngo_di_xem_phieu(t, T):
    return cam_phieu(ngo_lach_bach(t, T, 20, 38, 0, 0.035), t, T, True)

def ngo_khieng(t, T, lui=False):
    """Khiêng kiện hàng nặng cùng người khác: đi chậm, gối chùng, ngả người ra sau.
    lui=False: người đi sau, hai tay nắm quai đai phía trước bụng. lui=True: người đi trước, tay vòng ra sau nắm quai."""
    d = ngo_lach_bach(t, T, 16, 30, 0, 0.03, lean=-3)
    p = 2 * math.pi * t / T
    j = 2 * math.sin(2 * p)
    if lui:
        for sd, out in (('L', -8), ('R', 8)):
            d['tay_tren.' + sd] = (28 + j, out, 0)
            d['tay_duoi.' + sd] = (-12, 0, 0)
        d['than'] = (8, d['than'][1], d['than'][2] * 0.5)
    else:
        for sd, out in (('L', 10), ('R', -10)):
            d['tay_tren.' + sd] = (-30 + j, out, 0)
            d['tay_duoi.' + sd] = (-28, 0, 0)
        d['than'] = (-8, d['than'][1], d['than'][2] * 0.5)
    d['dau'] = (d['dau'][0] - 4, d['dau'][1], d['dau'][2])
    return d

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
          ('den_pin_tay', (-0.34, -0.05, 0.6), (-0.34, -0.05, 0.4), 'tay_duoi.R'),
          ('bang_phieu', (0.34, -0.06, 0.69), (0.34, -0.06, 0.45), 'tay_duoi.L')]
arm = make_rig(objs['nhan_vien_ngo'], 'nhan_vien_ngo', B_NGO)
REST_SCALE[arm.name] = {'thung': 0.0, 'may_quet_tay': 0.0, 'den_pin_tay': 0.0, 'bang_phieu': 0.0}
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
             ('xem_phieu', 3.0, ngo_xem_phieu, 'Xem phiếu việc (Tab): giơ bảng kẹp, cúi nhìn', True),
             ('di_xem_phieu', 0.9, ngo_di_xem_phieu, 'Vừa đi vừa xem phiếu việc', True),
             ('khieng', 1.3, ngo_khieng, 'Khiêng kiện hàng (người đi sau)', True),
             ('khieng_lui', 1.3, lambda t, T: ngo_khieng(t, T, True), 'Khiêng kiện hàng (người đi trước)', True),
             ('dong_thung', 2.6, ngo_dong_thung, 'Bị "đóng thùng"', False)]
make_clips(arm, 'nhan_vien_ngo', [(c[0], c[1], c[2]) for c in NGO_CLIPS],
           loc_bones=('goc', 'thung'), scales={'thung': 0.0, 'than': 1.0, 'may_quet_tay': 0.0, 'den_pin_tay': 0.0, 'bang_phieu': 0.0})
metas['nhan_vien_ngo']['chuyen_dong'] = [dict(ten=c[0], nhan=c[3], lap=c[4]) for c in NGO_CLIPS]

# ---------------------------------------------------------------- xuất .glb
for o, meta in MODELS:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    rig = RIGS.get(o.name)
    if not rig:
        gop_mau(o)
        meta['lenh_ve'] = len(o.data.materials)
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
        if CHI_XEM and o.name not in CHI_XEM:
            continue
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
        if CHI_XEM and mname not in CHI_XEM:
            continue
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
        'ke_rau_qua_1': (5.9, 0.2, 0), 'xe_mua_sam': (4.7, -1.3, 0), 'gio_hang': (3.5, -1.3, 0),
    }
    for k, loc in place.items():
        RIGS.get(k, get[k]).location = loc
    get['thung_carton'].rotation_euler = (0, 0, 0.3)
    RIGS['nguoi_kiem_ke'].rotation_euler = (0, 0, -0.35)
    get['xe_day'].rotation_euler = (0, 0, 0.5)
    # bày hàng lên kệ và tủ mát (chỉ để xem, không xuất)
    goods = [get[k] for k in ('hh_lon_nuoc', 'hh_hop_banh', 'hh_chai_nuoc', 'hh_goi_mi', 'hh_hop_sua')]
    cold = {k: get[k] for k in ('hh_kem', 'hh_goi_dong', 'hh_sua_chua')}
    an_di = [o for o in allm if o.name.startswith('hh_') or o.name in ('ke_rau_qua_2', 'ke_rau_qua_3')]
    for g in an_di:
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
    if not CHI_XEM:
        render_to(os.path.join(OUT_PREV, 'tu_lanh_co_hang.png'))
    for x in allm:
        x.hide_render = False
    for g in an_di:
        g.hide_render = True
    kx, ky, _ = place['ke_hang']
    def rong(o):
        bpy.context.view_layer.update()
        return max(v.co.x for v in o.data.vertices) - min(v.co.x for v in o.data.vertices)
    for li, z in enumerate((0.175, 0.615, 1.055, 1.495, 1.935)):
        src = get[('hh_lon_nuoc', 'hh_snack', 'hh_ngu_coc', 'hh_nuoc_giat', 'hh_chai_ngot')[li]]
        step = rong(src) + 0.015
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

    # Ảnh riêng: toàn bộ hàng hoá xếp hàng; khu rau quả + xe đẩy + giỏ
    for x in scene.objects:
        if x.type == 'MESH' and x.name != 'san':
            x.hide_render = True
    hh = [o for o in allm if o.name.startswith('hh_')]
    for i, o in enumerate(hh):
        o.hide_render = False
        o.location = ((i % 7) * 0.32, (i // 7) * 0.36, 0)
        o.rotation_euler = (0, 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    frame(cam, hh, direction=(0.0, -1.6, 1.0), pad=0.72)
    render_to(os.path.join(OUT_PREV, 'hang_hoa.png'))
    for o in hh:
        o.hide_render = True
    rq = [get[k] for k in ('ke_rau_qua_1', 'ke_rau_qua_2', 'ke_rau_qua_3', 'xe_mua_sam', 'gio_hang')]
    for i, o in enumerate(rq[:3]):
        o.location = (i * 2.0, 0, 0)
        o.rotation_euler = (0, 0, 0)
    rq[3].location = (6.2, -0.2, 0)
    rq[4].location = (6.2, 0.9, 0)
    for o in rq:
        o.hide_render = False
    frame(cam, rq, direction=(0.2, -1.6, 1.1), pad=0.62)
    render_to(os.path.join(OUT_PREV, 'rau_qua.png'))

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('XONG', len(MODELS), 'model')
