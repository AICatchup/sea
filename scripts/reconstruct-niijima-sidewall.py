"""Private study export of observed Niijima sidewall points using Open3D BPA.

Requires numpy, laspy, pyproj, scipy and open3d==0.19.0. No automatic downloads.
This produces open study meshes, never a production terrain or collision patch.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import time
import zipfile

ARCHIVE_SHA256 = "731881a1d95cd52a475912edceec9892670fbd3ebb3d3ac2b7c173e54e6a3e25"
SOURCE_URL = "https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Original/LAS/09/QC/17/09QC1711.zip"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Previously obtained 09QC1711.zip")
    parser.add_argument("--output", required=True, type=Path, help="New study directory; existing output is refused")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new output directory to preserve prior study evidence")
    digest = hashlib.file_digest(args.source.open("rb"), "sha256").hexdigest()
    if digest != ARCHIVE_SHA256:
        parser.error("Archive does not match the recorded Tokyo 09QC1711 source")
    import laspy
    import numpy as np
    import open3d as o3d
    import pyproj
    from scipy.spatial import cKDTree

    started = time.perf_counter()
    transform = pyproj.Transformer.from_crs(6677, 4326, always_xy=True)
    points, colors = [], []
    source_count = 0
    with zipfile.ZipFile(args.source) as archive:
        with archive.open("09QC1711.las") as stream, laspy.open(stream) as reader:
            for chunk in reader.chunk_iterator(500_000):
                source_count += len(chunk)
                selected = (np.asarray(chunk.classification) == 2) & ~np.asarray(chunk.withheld, dtype=bool)
                lon, lat = transform.transform(np.asarray(chunk.x)[selected], np.asarray(chunk.y)[selected])
                x = (lon - 139.2117451) * 111320 * math.cos(math.radians(34.3359808))
                z = (34.3359808 - lat) * 111320
                y = np.asarray(chunk.z)[selected]
                roi = (x >= 5790) & (x <= 5940) & (z >= -1040) & (z <= -1010) & (y >= 10) & (y <= 80)
                points.append(np.column_stack((x[roi], y[roi], z[roi])))
                colors.append(np.column_stack([np.asarray(getattr(chunk, key))[selected][roi] for key in ("red", "green", "blue")]))
    xyz = np.concatenate(points)
    rgb = np.concatenate(colors).astype(float) / 65535
    if len(xyz) < 32 or not np.isfinite(xyz).all():
        raise ValueError("Insufficient or non-finite ROI observations")
    cloud = o3d.geometry.PointCloud()
    cloud.points = o3d.utility.Vector3dVector(xyz)
    cloud.colors = o3d.utility.Vector3dVector(rgb)
    cloud.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=1.25, max_nn=32))
    normals = np.asarray(cloud.normals)
    steep = (abs(normals[:, 1]) < .75) & (abs(normals[:, 0]) > .5)
    cloud = cloud.select_by_index(np.flatnonzero(steep))
    cloud.orient_normals_towards_camera_location(np.array([6200., 45., -1025.]))
    xyz = np.asarray(cloud.points)
    tree = cKDTree(xyz)
    spacing = tree.query(xyz, k=2, workers=1)[0][:, 1]
    median_spacing = float(np.median(spacing[spacing > 0]))
    if not math.isfinite(median_spacing) or median_spacing <= 0:
        raise ValueError("No usable nonduplicate point spacing")
    args.output.mkdir(parents=True)
    records = []
    for name, factors in (("small", [1.5, 2.]), ("multi", [1.5, 2., 3.])):
        tick = time.perf_counter()
        radii = [median_spacing * value for value in factors]
        mesh = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(cloud, o3d.utility.DoubleVector(radii))
        vertices = np.asarray(mesh.vertices)
        faces = np.asarray(mesh.triangles)
        samples = vertices[faces]
        edges = np.stack((samples[:, 1] - samples[:, 0], samples[:, 2] - samples[:, 1], samples[:, 0] - samples[:, 2]), axis=1)
        support = tree.query(samples.mean(axis=1), k=1, workers=1)[0]
        keep = (np.linalg.norm(edges, axis=2).max(axis=1) < 1.5) & (support < .35)
        before = len(faces)
        mesh.triangles = o3d.utility.Vector3iVector(faces[keep])
        mesh.remove_unreferenced_vertices()
        mesh.compute_vertex_normals()
        target = args.output / f"bpa-{name}.ply"
        if not o3d.io.write_triangle_mesh(str(target), mesh, write_ascii=False):
            raise OSError(f"Could not save {target.name}")
        records.append({"name": name, "radii": radii, "vertices": len(mesh.vertices),
                        "triangles": len(mesh.triangles), "beforeSupportFilter": before,
                        "areaM2": mesh.get_surface_area(), "watertight": mesh.is_watertight(),
                        "seconds": time.perf_counter() - tick,
                        "sha256": hashlib.file_digest(target.open("rb"), "sha256").hexdigest()})
    report = {"source": SOURCE_URL, "sourceSha256": digest, "sourcePoints": source_count,
              "class2RoiPoints": int(steep.size), "steepPoints": int(steep.sum()),
              "open3dVersion": o3d.__version__, "normalRadiusM": 1.25, "normalNeighbors": 32,
              "normalSign": "Towards [6200,45,-1025], appropriate only to this eastern face study",
              "medianSpacingM": median_spacing, "records": records,
              "seconds": time.perf_counter() - started,
              "datumTransformAccuracyM": transform.accuracy,
              "sourceCRS": "EPSG6677 from catalogue; absent from LAS VLR",
              "credit": "Tokyo Metropolitan Government Digital Service Bureau, CC BY 4.0",
              "limits": ["Open observation-backed study meshes; not game terrain or collision",
                         "Normals and steepness do not prove full sidewall coverage",
                         "Centroid support filter does not prove every hole is preserved",
                         "Interpolation between observed vertices remains inferred",
                         "No centimetre survey accuracy or photorealism established"]}
    (args.output / "receipt.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
