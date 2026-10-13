"""Tokyo CC BY4.0 east Tomari DEM, mosaicked before reprojection.

Requires numpy, tifffile, pyproj, scipy. Input archives are obtained separately
under provider terms. No network access; this is a heightfield, not overhangs.
"""
from pathlib import Path
import argparse, hashlib, io, zipfile, json, base64, math
import numpy as np
import tifffile, pyproj
from scipy.ndimage import map_coordinates

p = argparse.ArgumentParser()
p.add_argument('--west', type=Path, required=True)
p.add_argument('--east', type=Path, required=True)
p.add_argument('--verify', action='store_true')
args = p.parse_args()
sources = [
    ('09QC1546', args.west, -57600., '1b766ace1472e0d2722ae251aaf33215c43e3c8ea5a855ac43ef00a1ad7ba386', '8cfa80ab355a0f85aa25c4acd38361557e75cbf3b7856a1c04eb286da437b521'),
    ('09QC1547', args.east, -57200., '4963c8f65c0602f5ce415191d2b751f461f2dd85e9a76387c07d767d31b26e55', 'b811a78bdd19fef0dbde151d59cd8d737dba7b52267a3abb9db048cc96d7135c'),
]
tiles, receipts = [], []
for tile, path, east, archive_hash, tiff_hash in sources:
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == archive_hash
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        tiff = z.read(tile + '.tif')
    assert hashlib.sha256(tiff).hexdigest() == tiff_hash
    with tifffile.TiffFile(io.BytesIO(tiff)) as f:
        a, tags = f.asarray(), f.pages[0].tags
        assert a.shape == (1200, 1600)
        assert tags[33550].value == (.25, .25, 0.)
        assert tags[33922].value == (0., 0., 0., east, -184200., 0.)
    tiles.append(a)
    receipts.append({'tile': tile, 'zipSha256': archive_hash, 'tiffSha256': tiff_hash,
        'url': f'https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Grid/TIFF/09/QC/15/{tile}.zip'})
# Independent tile interpolation would erase a half-pixel strip at their border.
a = np.concatenate(tiles, axis=1)
dx, dz = .9862144539255815, .9862084580266731
minx, minz = -298.91765416352035 + 280*dx, -273.7217431740901 + 112*dz
width, height = 128*4+1, 128*4+1
j, i = np.indices((height, width))
x, z = minx + i*dx/4, minz + j*dz/4
tr = pyproj.Transformer.from_crs(4326, 6677, always_xy=True)
e, n = tr.transform(139.2117451+x/(111320*math.cos(math.radians(34.3359808))), 34.3359808-z/111320)
c, r = (e+57600)/.25-.5, (-184200-n)/.25-.5
valid = np.isfinite(a) & (a > -327) & (a < 327)
support = map_coordinates(valid.astype(float), [r, c], order=1, mode='constant', cval=0)
y = map_coordinates(np.where(valid, a, 0), [r, c], order=1, mode='constant', cval=0)
ok = support > .999999
encoded = np.where(ok, np.rint(y*100), -32768).astype('<i2')
payload = encoded.tobytes()
meta = {'id': 'tomari-east-tokyo-mosaic', 'width': width, 'height': height,
    'origin': {'x': minx, 'z': minz}, 'column': {'x': dx/4, 'z': 0}, 'row': {'x': 0, 'z': dz/4},
    'nativeSpacingMetres': .25, 'runtimeReprojected': True, 'validSamples': int(ok.sum()),
    'sources': receipts, 'sourceURL': receipts[1]['url'], 'sourceZipSha256': receipts[1]['zipSha256'],
    'heightsSha256': hashlib.sha256(payload).hexdigest(), 'license': 'CC BY 4.0',
    'attribution': '東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成',
    'sourceCRS': 'EPSG:6677 / PixelIsArea centres', 'datumTransformAccuracyMetres': tr.accuracy,
    'maximumEncodingErrorMetres': float(abs(encoded*.01-y)[ok].max()),
    'centimetreSurveyAccuracyEstablished': False,
    'recording': 'Two provider 25cm TIFFs mosaicked in EPSG:6677 before bilinear reprojection onto SEA aligned ~24.66cm lattice. Runtime retains inferred low tidal ground and blends perimeter. No measured overhang or individual tree claim.'}
data = {**meta, 'heightsCentimetres': base64.b64encode(payload).decode()}
target = Path(__file__).resolve().parents[1]/'src/world/tomari-east-survey.generated.ts'
rendered = '/** Tokyo CC BY4.0 east-coast DEM mosaic. Do not print encoded payload. */\nexport const TOMARI_EAST_SURVEY = '+json.dumps(data, ensure_ascii=False, separators=(',', ':'))+' as const;\n'
if args.verify:
    assert target.read_text(encoding='utf-8') == rendered
else:
    target.write_text(rendered, encoding='utf-8')
print(json.dumps(meta, ensure_ascii=False))
