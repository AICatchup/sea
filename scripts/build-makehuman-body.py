"""Build the CC0 MakeHuman diver body bound to SEA's existing first-person skeleton.

Run with Blender 5.1 and the MPFB 2.0.17 extension plus the CC0 MakeHuman system
asset pack installed:

    blender -b --python scripts/build-makehuman-body.py -- <output dir>

Nothing about the game skeleton changes. The generated human is posed onto the
skeleton's rest pose (arms down, palms back, fingers straight), each joint is then
moved onto the exact game joint, and MPFB's game_engine weights are merged onto the
47 game bones. The first-person eye (head bone origin) sits between the eyes.

Inputs are CC0 (MakeHuman base mesh, targets, young_asian_male skin, high-poly eyes,
eyebrow001, eyelashes01). Output: makehuman-body.json + makehuman-body.bin + textures.
"""
import bpy, bmesh, json, os, struct, sys, math, shutil, hashlib
from mathutils import Vector, Matrix
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("makehuman-out")
os.makedirs(OUT, exist_ok=True)
DATA = LocationService.get_user_data()

# Game skeleton rest points (three.js metres, +Y up, -Z forward), from FirstPersonBody.
GAME = {
    "pelvis@C": (0, .94, .035), "lumbar@C": (0, 1.10, .03), "chest@C": (0, 1.36, .015), "neck@C": (0, 1.505, .014), "head@C": (0, 1.64, -.056),
}
def side(prefix, sign, tag):
    s = lambda x: x * sign
    j = {
        f"{prefix} shoulder": (s(.185), 1.407, .012), f"{prefix} elbow": (s(.257), 1.115, -.014), f"{prefix} wrist": (s(.266), .844, -.052),
        f"{prefix} index proximal": (s(.236), .748, -.051), "index middle": (s(.234), .713, -.051), "index distal": (s(.232), .689, -.051),
        f"{prefix} middle proximal": (s(.257), .744, -.051), "middle middle": (s(.257), .705, -.051), "middle distal": (s(.256), .679, -.051),
        f"{prefix} ring proximal": (s(.280), .745, -.051), "ring middle": (s(.281), .710, -.051), "ring distal": (s(.282), .685, -.051),
        f"{prefix} little proximal": (s(.300), .753, -.051), "little middle": (s(.303), .726, -.051), "little distal": (s(.305), .707, -.051),
        "thumb metacarpal": (s(.238), .815, -.058), "thumb proximal": (s(.211), .793, -.060), "thumb distal": (s(.202), .767, -.057),
        f"{prefix} hip": (s(.095), .925, .030), f"{prefix} knee": (s(.099), .501, .004), f"{prefix} ankle": (s(.103), .087, .022),
    }
    return {f"{k}@{tag}": v for k, v in j.items()}
# Game "left" is -X in three.js; MakeHuman "_l" is +X in Blender. Same anatomical side.
GAME.update(side("left", -1, "L")); GAME.update(side("right", 1, "R"))
def blend(p):  # three.js -> Blender (Z up, -Y forward)
    return Vector((-p[0], p[2], p[1]))
def three(v):
    return (-v.x, v.z, v.y)

def mpfb_to_game(name):
    if name in ("Root", "pelvis"): return "pelvis@C"
    if name in ("spine_01", "spine_02"): return "lumbar@C"
    if name in ("spine_03",) or name.startswith("clavicle"): return "chest@C"
    if name == "neck_01": return "neck@C"
    if name == "head": return "head@C"
    s, tag, pre = ("_l", "L", "left") if name.endswith("_l") else ("_r", "R", "right")
    base = name[:-2]
    simple = {"upperarm": "shoulder", "lowerarm": "elbow", "hand": "wrist", "thigh": "hip", "calf": "knee", "foot": "ankle", "ball": "ankle"}
    if base in simple: return f"{pre} {simple[base]}@{tag}"
    finger, idx = base.split("_")
    if finger == "thumb": return f"thumb {['metacarpal', 'proximal', 'distal'][int(idx) - 1]}@{tag}"
    finger = "little" if finger == "pinky" else finger
    return (f"{pre} {finger} proximal" if idx == "01" else f"{finger} {'middle' if idx == '02' else 'distal'}") + f"@{tag}"

# Which game joint each MPFB bone head should land on (None: follows blended neighbours).
def head_target(name):
    if name in ("Root", "spine_01", "spine_02", "spine_03") or name.startswith("clavicle"): return None
    if name == "ball_l" or name == "ball_r": return None
    if name in ("neck_01", "head", "pelvis"): return None
    return mpfb_to_game(name)

# 1. Human, matched to the game silhouette height (head top 1.748m).
macro = TargetService.get_default_macro_info_dict()
macro.update({"gender": 1.0, "age": 0.5, "muscle": 0.62, "weight": 0.48, "height": 0.5, "proportions": 0.55})
macro["race"].update({"asian": 0.8, "caucasian": 0.2, "african": 0.0})
# Re-applying macros on a live human compounds targets, so measure once and rescale.
probe = HumanService.create_human(macro_detail_dict=macro)
bpy.context.view_layer.update(); _ev = probe.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
probe_top = max(v.co.z for v in _m.vertices); _ev.to_mesh_clear()
bpy.data.objects.remove(probe, do_unlink=True)
SCALE = 0.1 * 1.748 / probe_top
human = HumanService.create_human(macro_detail_dict=macro, scale=SCALE)
def top():
    bpy.context.view_layer.update(); ev = human.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    z = max(v.co.z for v in m.vertices); ev.to_mesh_clear(); return z
height = top(); h = macro["height"]
# Bake the macro shape so later operations work on plain geometry.
lowest = min(v.co.z for v in human.data.vertices)

rig = HumanService.add_builtin_rig(human, "game_engine")
HumanService.set_character_skin(os.path.join(DATA, "skins", "young_asian_male", "young_asian_male.mhmat"), human, skin_type="MAKESKIN")
parts = {"body": human}
for name, kind, path in (("eyes", "Eyes", "eyes/high-poly/high-poly.mhclo"), ("eyebrows", "Eyebrows", "eyebrows/eyebrow001/eyebrow001.mhclo"), ("eyelashes", "Eyelashes", "eyelashes/eyelashes01/eyelashes01.mhclo")):
    parts[name] = HumanService.add_mhclo_asset(os.path.join(DATA, path), human, asset_type=kind, subdiv_levels=0)

# 2. Pose onto the game rest pose (parents first; each bone rotates about its own head).
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
mw = rig.matrix_world; inv = mw.inverted()
def pose_head(n): return mw @ rig.pose.bones[n].head
def pose_tail(n): return mw @ rig.pose.bones[n].tail
def rotate_about_head(n, R):
    pb = rig.pose.bones[n]; hd = pb.head.copy()
    pb.matrix = Matrix.Translation(hd) @ R.to_4x4() @ Matrix.Translation(-hd) @ pb.matrix
    bpy.context.view_layer.update()
def align(n, target_dir):
    cur = (pose_tail(n) - pose_head(n)); Rw = cur.normalized().rotation_difference(target_dir.normalized()).to_matrix()
    rotate_about_head(n, inv.to_3x3() @ Rw @ mw.to_3x3())
def frame(a, b):
    a = a.normalized(); b = (b - b.dot(a) * a).normalized(); return Matrix((a, b, a.cross(b))).transposed()
G = {k: blend(v) for k, v in GAME.items()}
for s, tag, pre in (("_l", "L", "left"), ("_r", "R", "right")):
    align("upperarm" + s, G[f"{pre} elbow@{tag}"] - G[f"{pre} shoulder@{tag}"])
    align("lowerarm" + s, G[f"{pre} wrist@{tag}"] - G[f"{pre} elbow@{tag}"])
    # Whole-hand orientation from two directions: wrist->middle knuckle and index->little spread.
    cur = frame(pose_head("middle_01" + s) - pose_head("hand" + s), pose_head("index_01" + s) - pose_head("pinky_01" + s))
    want = frame(G[f"{pre} middle proximal@{tag}"] - G[f"{pre} wrist@{tag}"], G[f"{pre} index proximal@{tag}"] - G[f"{pre} little proximal@{tag}"])
    rotate_about_head("hand" + s, inv.to_3x3() @ (want @ cur.transposed()) @ mw.to_3x3())
    for finger, game in (("index", "index"), ("middle", "middle"), ("ring", "ring"), ("pinky", "little")):
        chain = [f"{pre} {game} proximal@{tag}", f"{game} middle@{tag}", f"{game} distal@{tag}"]
        for i in range(3):
            a = G[chain[i]]; b = G[chain[i + 1]] if i < 2 else G[chain[2]] + (G[chain[2]] - G[chain[1]])
            align(f"{finger}_0{i + 1}{s}", b - a)
    thumb = [f"thumb metacarpal@{tag}", f"thumb proximal@{tag}", f"thumb distal@{tag}"]
    for i in range(3):
        a = G[thumb[i]]; b = G[thumb[i + 1]] if i < 2 else G[thumb[2]] + (G[thumb[2]] - G[thumb[1]])
        align(f"thumb_0{i + 1}{s}", b - a)
    align("thigh" + s, G[f"{pre} knee@{tag}"] - G[f"{pre} hip@{tag}"])
    align("calf" + s, G[f"{pre} ankle@{tag}"] - G[f"{pre} knee@{tag}"])
bpy.ops.object.mode_set(mode="OBJECT"); bpy.context.view_layer.update()

# 3. Exact joints: per-bone translation fields, blended by the MPFB weights.
dg = bpy.context.evaluated_depsgraph_get()
eyes_ev = parts["eyes"].evaluated_get(dg); em = eyes_ev.to_mesh()
eye_centre = sum((parts["eyes"].matrix_world @ v.co for v in em.vertices), Vector()) / len(em.vertices); eyes_ev.to_mesh_clear()
delta = {}
for b in rig.pose.bones:
    t = head_target(b.name)
    if t: delta[b.name] = G[t] - (mw @ b.head)
# The real eyes sit ~8cm in front of the game eye (head bone origin), which is fine: the
# camera then rides inside the skull behind them and the face lies within the 12cm near
# plane. Moving the head back instead would visibly stretch the neck. Keep the head.
head_delta = G["head@C"] - eye_centre
delta["head"] = Vector((0, 0, head_delta.z)); delta["neck_01"] = delta["head"] * .5
for s in ("_l", "_r"):
    delta["clavicle" + s] = delta["upperarm" + s] * .5
    delta["ball" + s] = delta["foot" + s]
delta["pelvis"] = (delta["thigh_l"] + delta["thigh_r"]) * .5; delta["Root"] = delta["pelvis"]
delta["spine_01"] = delta["pelvis"] * .6
delta["spine_02"] = delta["pelvis"] * .3 + (delta["upperarm_l"] + delta["upperarm_r"]) * .1
delta["spine_03"] = (delta["upperarm_l"] + delta["upperarm_r"]) * .35

# 4. Export each part: corner-split vertices, game bone keys, translation-corrected positions.
keys = sorted(GAME.keys()); key_index = {k: i for i, k in enumerate(keys)}
blob = bytearray(); meta = {"parts": [], "boneKeys": keys}
def push(arr_bytes):
    while len(blob) % 4: blob.append(0)
    off = len(blob); blob.extend(arr_bytes); return off
report = {}
for name, obj in parts.items():
    ev = obj.evaluated_get(dg); m = ev.to_mesh(); m.calc_loop_triangles()
    groups = {g.index: g.name for g in obj.vertex_groups}
    uv = m.uv_layers.active.data if m.uv_layers.active else None
    normals = m.corner_normals
    verts = {}; pos = []; nor = []; uvs = []; joints = []; weights = []; idx = []
    maxshift = 0
    for tri in m.loop_triangles:
        for li in tri.loops:
            vi = m.loops[li].vertex_index; u = tuple(round(c, 6) for c in uv[li].uv) if uv else (0, 0)
            n = normals[li].vector; nk = (round(n.x, 3), round(n.y, 3), round(n.z, 3))
            key = (vi, u, nk)
            if key not in verts:
                v = m.vertices[vi]; acc = {}; shift = Vector()
                total = sum(g.weight for g in v.groups if groups.get(g.group) in delta or groups.get(g.group, "").split(".")[0] in delta)
                for g in v.groups:
                    gname = groups.get(g.group, "")
                    if gname not in delta or g.weight <= 0: continue
                    gk = mpfb_to_game(gname); acc[gk] = acc.get(gk, 0) + g.weight; shift += delta[gname] * (g.weight / total)
                p = obj.matrix_world @ v.co + shift; maxshift = max(maxshift, shift.length)
                top4 = sorted(acc.items(), key=lambda kv: -kv[1])[:4] or [("head@C" if name != "body" else "chest@C", 1.0)]
                ssum = sum(w for _, w in top4); top4 += [(top4[0][0], 0.0)] * (4 - len(top4))
                verts[key] = len(pos)
                pos.append(three(p)); nn = (obj.matrix_world.to_3x3() @ n).normalized(); nor.append(three(nn))
                uvs.append(u); joints.append([key_index[k] for k, _ in top4]); weights.append([w / ssum for _, w in top4])
            idx.append(verts[key])
    ev.to_mesh_clear()
    count = len(pos); flat = lambda rows: [c for r in rows for c in r]
    # (x,y,z)_Blender -> (-x,z,y)_three is a proper rotation (det +1): winding is kept.
    part = {"name": name, "vertices": count, "indices": len(idx),
            "position": push(struct.pack(f"<{count * 3}f", *flat(pos))), "normal": push(struct.pack(f"<{count * 3}f", *flat(nor))),
            "uv": push(struct.pack(f"<{count * 2}f", *flat(uvs))), "joints": push(struct.pack(f"<{count * 4}B", *flat(joints))),
            "weights": push(struct.pack(f"<{count * 4}f", *flat(weights))), "index": push(struct.pack(f"<{len(idx)}I", *idx))}
    meta["parts"].append(part); report[name] = {"vertices": count, "triangles": len(idx) // 3, "maxJointShiftMetres": round(maxshift, 4)}

with open(os.path.join(OUT, "makehuman-body.bin"), "wb") as f: f.write(blob)
# Textures (CC0 MakeHuman system assets; unchanged pixels).
tex = {"skin": os.path.join(DATA, "skins", "young_asian_male", "young_lightskinned_male_diffuse3.png"),
       "eyes": os.path.join(DATA, "eyes", "materials", "brown_eye.png"),
       "eyebrows": os.path.join(DATA, "eyebrows", "eyebrow001", "eyebrow001.png"),
       "eyelashes": os.path.join(DATA, "eyelashes", "eyelashes01", "eyelashes01.png")}
meta["textures"] = {}
for k, src in tex.items():
    dst = f"makehuman-{k}.png"; shutil.copyfile(src, os.path.join(OUT, dst))
    meta["textures"][k] = {"file": dst, "sha256": hashlib.sha256(open(src, "rb").read()).hexdigest()}
meta["provenance"] = {"generator": "MPFB 2.0.17 (Blender 5.1.2) game_engine rig, posed and joint-corrected onto SEA FirstPersonBody",
    "license": "CC0-1.0 (MakeHuman base mesh, targets and system assets; MPFB output is CC0)",
    "macro": {k: v for k, v in macro.items() if k != "race"}, "race": macro["race"], "scale": SCALE, "headTop": height,
    "eyeCentreBeforeCorrection": three(eye_centre), "report": report}
meta["provenance"]["jointShiftMetres"] = {k: round(v.length, 4) for k, v in sorted(delta.items())}
meta["sha256"] = hashlib.sha256(bytes(blob)).hexdigest()
with open(os.path.join(OUT, "makehuman-body.json"), "w") as f: json.dump(meta, f, indent=1)
print("MHBUILD" + json.dumps({"out": OUT, "report": report, "eye": three(eye_centre), "shifts": meta["provenance"]["jointShiftMetres"]}))
