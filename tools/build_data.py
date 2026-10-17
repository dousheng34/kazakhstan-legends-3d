#!/usr/bin/env python3
"""
Kazakhstan Legends 3D — data pipeline.

Rebuilds every generated data file the web app uses:
  height.json, meta.json, mask*.png, tex_*.jpg, texture.jpg   (Kazakhstan relief + 8K baked satellite)
  earth.jpg, region.jpg                                        (globe + Central Asia detail patch)
  cities.json and person positions (px/py/h) in persons.json

Usage:
  pip install numpy scipy pillow shapely requests
  python tools/build_data.py            # writes into the repo root (next to index.html)

Data sources (free / open):
  - Satellite: Esri World Imagery tiles (attribution required: "© Esri")
  - Elevation: AWS Terrain Tiles (terrarium PNG)
  - Border: geoBoundaries gbOpen KAZ ADM0 (OpenStreetMap, ODbL)
"""
import io, json, math, os, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from scipy import ndimage
from shapely.geometry import shape

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = os.path.join(ROOT, '.cache_tiles')
os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'kazakhstan-legends-3d/1.0'}
ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
TERR = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
BORDER = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KAZ/ADM0/geoBoundaries-KAZ-ADM0_simplified.geojson'


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch(url, fn):
    if os.path.exists(fn) and os.path.getsize(fn) > 100:
        return
    for _ in range(5):
        try:
            r = requests.get(url, headers=UA, timeout=30)
            if r.status_code == 200:
                open(fn, 'wb').write(r.content)
                return
        except Exception:
            pass
        time.sleep(1.5)
    raise RuntimeError('download failed: ' + url)


def mosaic(z, tx0, tx1, ty0, ty1, kind):
    jobs = []
    for x in range(tx0, tx1 + 1):
        for y in range(ty0, ty1 + 1):
            url = (ESRI if kind == 's' else TERR).format(z=z, x=x, y=y)
            jobs.append((url, os.path.join(CACHE, f'{kind}{z}_{x}_{y}')))
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda a: fetch(*a), jobs))
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    if kind == 's':
        img = Image.new('RGB', (W, H))
        for x in range(tx0, tx1 + 1):
            for y in range(ty0, ty1 + 1):
                img.paste(Image.open(os.path.join(CACHE, f's{z}_{x}_{y}')).convert('RGB'), ((x - tx0) * 256, (y - ty0) * 256))
        return img
    dem = np.zeros((H, W), np.float32)
    for x in range(tx0, tx1 + 1):
        for y in range(ty0, ty1 + 1):
            t = np.asarray(Image.open(os.path.join(CACHE, f't{z}_{x}_{y}')).convert('RGB')).astype(np.float32)
            dem[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = t[..., 0] * 256 + t[..., 1] + t[..., 2] / 256 - 32768
    return dem


def bake(sat, dem, px_m, zf=5.0, sun=(-120, 170, 110)):
    """Bake hillshade + ambient occlusion into satellite colours (static sun = same as the 3D scene)."""
    d = ndimage.gaussian_filter(dem, 0.8)
    gy, gx = np.gradient(d * zf, px_m)
    nx, ny, nz = -gx, np.ones_like(d), -gy
    nl = np.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl
    L = np.array(sun, np.float32); L /= np.linalg.norm(L)
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1) / L[1]
    L2 = np.array([-60, 120, -90], np.float32); L2 /= np.linalg.norm(L2)
    lam2 = np.clip(nx * L2[0] + ny * L2[1] + nz * L2[2], 0, 1) / L2[1]
    f = 1 + 0.85 * (lam - 1) + 0.2 * (lam2 - 1)
    f *= np.clip(1 + (d - ndimage.gaussian_filter(d, 12)) / 900.0, 0.82, 1.08)
    f = np.clip(f, 0.38, 1.55).astype(np.float32)
    lin = (np.asarray(sat).astype(np.float32) / 255) ** 2.2 * f[..., None]
    out = Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8))
    out = ImageEnhance.Contrast(ImageEnhance.Color(out).enhance(1.12)).enhance(1.06)
    return out.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))


def build_kazakhstan():
    geo = requests.get(BORDER, headers=UA, timeout=60).json()
    poly = max(shape(geo['features'][0]['geometry']).geoms, key=lambda p: p.area)
    Z = 7
    x0, y0 = tile_xy(46.3, 55.7, Z); x1, y1 = tile_xy(87.5, 40.4, Z)
    X0, Y0, X1, Y1 = int(x0), int(y0), int(x1), int(y1)
    dem = mosaic(Z, X0, X1, Y0, Y1, 't')
    ring = np.array([[(tile_xy(lon, lat, Z)[0] - X0) * 256, (tile_xy(lon, lat, Z)[1] - Y0) * 256] for lon, lat in poly.exterior.coords])
    mn = ring.min(0) - 6; mx = ring.max(0) + 6
    cx0, cy0, cx1, cy1 = int(mn[0]), int(mn[1]), int(math.ceil(mx[0])), int(math.ceil(mx[1]))
    dem = dem[cy0:cy1, cx0:cx1]; ring -= [cx0, cy0]
    H, W = dem.shape
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in ring], fill=255)
    mask = np.asarray(m) > 0
    idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
    demf = np.maximum(dem[idx[0], idx[1]], -150)
    m.resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(ROOT, 'mask.png'), optimize=True)
    STEP = 3
    gh = demf[::STEP, ::STEP]; gm = ndimage.binary_dilation(mask, iterations=6)[::STEP, ::STEP]
    q = np.clip(np.round(gh + 500), 0, 65535).astype(np.uint16); q[~gm] = 0
    import base64
    json.dump({'b64': base64.b64encode(q.tobytes()).decode()}, open(os.path.join(ROOT, 'height.json'), 'w'))
    rs = ndimage.map_coordinates(demf, [ring[:, 1], ring[:, 0]], order=1)

    # zoom-8 satellite + DEM, baked, split into 2x2 chunks (each < 4096 px)
    gx0, gy0 = (X0 * 256 + cx0) * 2, (Y0 * 256 + cy0) * 2
    gx1, gy1 = (X0 * 256 + cx1) * 2, (Y0 * 256 + cy1) * 2
    tx0, ty0, tx1, ty1 = gx0 // 256, gy0 // 256, (gx1 - 1) // 256, (gy1 - 1) // 256
    sat8 = mosaic(8, tx0, tx1, ty0, ty1, 's'); dem8 = mosaic(8, tx0, tx1, ty0, ty1, 't')
    ox, oy = gx0 - tx0 * 256, gy0 - ty0 * 256
    W8, H8 = W * 2, H * 2
    dem8 = dem8[oy:oy + H8, ox:ox + W8]; sat8 = sat8.crop((ox, oy, ox + W8, oy + H8))
    m8 = Image.new('L', (W8, H8), 0); ImageDraw.Draw(m8).polygon([tuple(p * 2) for p in ring], fill=255)
    mask8 = np.asarray(m8) > 0
    i8 = ndimage.distance_transform_edt(~mask8, return_distances=False, return_indices=True)
    baked = bake(sat8, np.maximum(dem8[i8[0], i8[1]], -150), 409.0)
    pad, xs, ys, chunks = 8, [0, W8 // 2, W8], [0, H8 // 2, H8], []
    for j in range(2):
        for i in range(2):
            a0, a1 = max(0, xs[i] - pad), min(W8, xs[i + 1] + pad); b0, b1 = max(0, ys[j] - pad), min(H8, ys[j + 1] + pad)
            name = f'tex_{j}{i}'
            baked.crop((a0, b0, a1, b1)).save(os.path.join(ROOT, name + '.jpg'), quality=86, optimize=True, progressive=True)
            m8.crop((a0, b0, a1, b1)).resize(((a1 - a0) // 2, (b1 - b0) // 2), Image.LANCZOS).save(os.path.join(ROOT, f'mask_{j}{i}.png'), optimize=True)
            chunks.append(dict(name=name, mask=f'mask_{j}{i}.png', tx0=a0, ty0=b0, tw=a1 - a0, th=b1 - b0,
                               cx0=xs[i] // 2, cx1=xs[i + 1] // 2, cy0=ys[j] // 2, cy1=ys[j + 1] // 2))
    baked.resize((W, H), Image.LANCZOS).save(os.path.join(ROOT, 'texture.jpg'), quality=86, optimize=True)
    meta = dict(w=W, h=H, gw=gh.shape[1], gh=gh.shape[0], step=STEP,
                ring=[[round(float(a), 2), round(float(b), 2), round(float(c), 1)] for (a, b), c in zip(ring, rs)],
                chunks=chunks, w8=W8, h8=H8, gx0=X0 * 256 + cx0, gy0=Y0 * 256 + cy0, z=Z)
    return meta, demf


def build_globe(meta):
    # world: Esri zoom 4 (Mercator) -> equirectangular 4096x2048
    merc = mosaic(4, 0, 15, 0, 15, 's'); M = np.asarray(merc).astype(np.float32)
    EW, EH = 4096, 2048
    lat = 90 - (np.arange(EH) + 0.5) / EH * 180; latc = np.clip(lat, -85.05, 85.05)
    yy = (1 - np.log(np.tan(np.radians(latc)) + 1 / np.cos(np.radians(latc))) / np.pi) / 2 * 4096
    xx = (np.arange(EW) + 0.5) / EW * 4096
    grid = np.meshgrid(yy, xx, indexing='ij')
    E = np.stack([ndimage.map_coordinates(M[..., c], grid, order=1) for c in range(3)], -1)
    w = np.clip((np.abs(lat) - 78) / 8, 0, 1)[:, None, None]
    E = E * (1 - w) + np.array([236, 242, 247]) * w
    earth = Image.fromarray(np.clip(E, 0, 255).astype(np.uint8))
    earth = ImageEnhance.Contrast(ImageEnhance.Brightness(ImageEnhance.Color(earth).enhance(0.67)).enhance(1.14)).enhance(0.92)
    earth.save(os.path.join(ROOT, 'earth.jpg'), quality=86, optimize=True, progressive=True)

    # Central Asia detail patch: Esri zoom 6 + hillshade
    LON0, LON1, LAT0, LAT1 = 26, 110, 27, 63
    px0, py0 = tile_xy(LON0, LAT1, 6); px1, py1 = tile_xy(LON1, LAT0, 6)
    RX0, RY0, RX1, RY1 = int(px0), int(py0), int(px1), int(py1)
    sat = mosaic(6, RX0, RX1, RY0, RY1, 's'); dem = np.maximum(mosaic(6, RX0, RX1, RY0, RY1, 't'), 0)
    reg = bake(sat, dem, 611 * 4 * 0.72, zf=4.0)
    RW, RH = reg.size
    reg = ImageEnhance.Brightness(ImageEnhance.Color(reg).enhance(0.6)).enhance(1.07)
    reg.resize((4096, int(RH * 4096 / RW)), Image.LANCZOS).save(os.path.join(ROOT, 'region.jpg'), quality=85, optimize=True, progressive=True)
    meta['region'] = dict(z=6, x0=RX0 * 256, y0=RY0 * 256, w=RW, h=RH, lon0=LON0, lon1=LON1, lat0=LAT0, lat1=LAT1)


CITIES = [("Астана", 51.169, 71.449, 1), ("Алматы", 43.238, 76.946, 1), ("Шымкент", 42.315, 69.587, 1), ("Қарағанды", 49.807, 73.088, 0),
          ("Ақтөбе", 50.283, 57.167, 0), ("Тараз", 42.901, 71.378, 0), ("Павлодар", 52.287, 76.967, 0), ("Өскемен", 49.948, 82.628, 0),
          ("Семей", 50.411, 80.227, 0), ("Атырау", 47.094, 51.923, 0), ("Қостанай", 53.214, 63.625, 0), ("Қызылорда", 44.853, 65.509, 0),
          ("Орал", 51.204, 51.370, 0), ("Петропавл", 54.865, 69.135, 0), ("Ақтау", 43.651, 51.158, 0), ("Түркістан", 43.297, 68.251, 0),
          ("Көкшетау", 53.283, 69.396, 0), ("Талдықорған", 45.017, 78.373, 0), ("Жезқазған", 47.783, 67.767, 0), ("Конаев", 43.867, 77.067, 0)]

# lat/lon of each personality (birthplace / main region) — edit persons.json texts, edit coordinates here
PERSON_COORDS = {
    'abai': (50.41, 80.25), 'shakarim': (48.95, 78.6), 'auezov': (49.7, 79.2), 'farabi': (42.85, 68.3), 'yasawi': (43.3, 68.25),
    'abylai': (53.28, 69.39), 'tole': (42.32, 69.6), 'altynsarin': (53.21, 63.62), 'baitursynov': (49.63, 63.5), 'bokeikhan': (49.41, 75.47),
    'magzhan': (54.87, 69.15), 'satpayev': (50.79, 75.7), 'zhambyl': (43.35, 75.5), 'momyshuly': (42.85, 70.9), 'makhambet': (48.0, 51.9),
    'korkyt': (45.62, 64.1), 'beket': (43.6, 54.9), 'aliya': (50.28, 57.2), 'zhansugurov': (45.02, 78.37), 'kurmangazy': (49.4, 49.9),
    'makataev': (42.72, 80.15), 'valikhanov': (52.47, 64.62), 'abulkhair': (49.0, 59.5),
}


def place(meta, demf, lat, lon):
    x, y = tile_xy(lon, lat, meta['z'])
    px, py = x * 256 - meta['gx0'], y * 256 - meta['gy0']
    h = float(ndimage.map_coordinates(demf, [[py], [px]], order=1)[0])
    return round(px, 1), round(py, 1), round(h)


def main():
    meta, demf = build_kazakhstan()
    build_globe(meta)
    json.dump(meta, open(os.path.join(ROOT, 'meta.json'), 'w'))
    cities = []
    for n, lat, lon, big in CITIES:
        px, py, h = place(meta, demf, lat, lon)
        cities.append(dict(n=n, px=px, py=py, h=h, big=big))
    json.dump(cities, open(os.path.join(ROOT, 'cities.json'), 'w'), ensure_ascii=False)
    pp = os.path.join(ROOT, 'persons.json')
    persons = json.load(open(pp, encoding='utf-8'))
    for p in persons:
        if p['id'] in PERSON_COORDS:
            p['px'], p['py'], p['h'] = place(meta, demf, *PERSON_COORDS[p['id']])
    json.dump(persons, open(pp, 'w', encoding='utf-8'), ensure_ascii=False)
    print('done')


if __name__ == '__main__':
    main()
