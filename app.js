import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';

/* =========================================================
   Config
   ========================================================= */
const AGENT_ID = 'agent_3001m55e8rm3fmh9bs1cje0r0929';      // ElevenLabs voice agent (per-person overrides)
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);
const probe = document.createElement('canvas').getContext('webgl2');
const maxTex = probe ? probe.getParameter(probe.MAX_TEXTURE_SIZE) : 4096;
let GPU = '';
try { const ext = probe && probe.getExtension('WEBGL_debug_renderer_info'); GPU = probe ? String(probe.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER)) : ''; } catch (e) {}
const WEAK_GPU = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Microsoft Basic/i.test(GPU);
let savedQ = null; try { savedQ = localStorage.getItem('kz_quality'); } catch (e) {}
const QUALITY = savedQ || ((isMobile || WEAK_GPU || maxTex < 8192 || (navigator.hardwareConcurrency || 8) <= 4) ? 'medium' : 'high');
const LOW = QUALITY !== 'high';
const DPR_MAX = Math.min(window.devicePixelRatio || 1, LOW ? 1 : 1.5);

const R = 420;                         // globe radius (scene units)
const EXAG = 15;                       // vertical exaggeration of Kazakhstan relief
const VS = (R / 6371000) * EXAG;       // scene units per metre of elevation
const BASE = 2.6;                      // how far Kazakhstan is raised above the globe
const H_MIN = -150;
const KZ_LAT = 48.0, KZ_LON = 67.0;
const BOOK_W = 5.2, BOOK_H = 6.9, BOOK_T = 0.6;
const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
document.body.classList.add('booting');

/* =========================================================
   Renderer
   ========================================================= */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false });
let dpr = DPR_MAX;
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.5, 9000);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.085, minDistance: 6, maxDistance: 3600, zoomSpeed: 2.4, rotateSpeed: 0.65, panSpeed: 1.0 });
controls.screenSpacePanning = false;
if ('zoomToCursor' in controls) controls.zoomToCursor = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0xcfe0ec, 2.3));
const sun = new THREE.DirectionalLight(0xfff3df, 2.2);
sun.position.set(-0.55, 1, 0.75).multiplyScalar(1000);
scene.add(sun);

/* =========================================================
   Loading
   ========================================================= */
const manager = new THREE.LoadingManager();
let extraTotal = 0, extraDone = 0, texTotal = 0, texDone = 0;
function updateProgress() {
  const tot = texTotal + extraTotal, done = texDone + extraDone;
  const pct = tot ? Math.round((done / tot) * 100) : 0;
  $('progress-bar').style.width = pct + '%';
  $('progress-text').textContent = `Жүктелуде… ${pct}%`;
}
manager.onProgress = (_u, l, t) => { texDone = l; texTotal = t; updateProgress(); };
const texLoader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const ALL_TEX = [];
const loadTex = (url, srgb = true) => texLoader.loadAsync(url).then((t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); ALL_TEX.push(t); return t; });
function getJSON(url) { extraTotal++; updateProgress(); return fetch(url).then((r) => r.json()).then((j) => { extraDone++; updateProgress(); return j; }); }
function loadImg(url) { extraTotal++; return new Promise((res, rej) => { const i = new Image(); i.onload = () => { extraDone++; updateProgress(); res(i); }; i.onerror = rej; i.src = url; }); }
function canvasTex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); ALL_TEX.push(t); return t; }

/* =========================================================
   Sphere math (matches THREE.SphereGeometry UV layout)
   ========================================================= */
function sph(lat, lon, r, out = new THREE.Vector3()) {
  const phi = (lon + 180) * DEG, th = (90 - lat) * DEG;
  return out.set(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
}
function basisAt(lat, lon) {
  const n = sph(lat, lon, 1);
  const e = sph(lat, lon + 0.05, 1).sub(sph(lat, lon - 0.05, 1)).normalize();
  const no = sph(lat + 0.05, lon, 1).sub(sph(lat - 0.05, lon, 1)).normalize();
  return { n, e, no };
}
const mercLon = (gx, z) => (gx / (256 * 2 ** z)) * 360 - 180;
const mercLat = (gy, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / (256 * 2 ** z)))) / DEG;
const lonToMx = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const latToMy = (lat, z) => { const s = Math.sin(lat * DEG); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z; };

/* Globe group: rotated so Kazakhstan's centre is at the world origin, facing +Y, north toward -Z */
const globe = new THREE.Group();
{
  const { n, e, no } = basisAt(KZ_LAT, KZ_LON);
  const m = new THREE.Matrix4().makeBasis(e, n, no.clone().negate()).transpose();
  globe.quaternion.setFromRotationMatrix(m);
  globe.position.set(0, -R, 0);
}
scene.add(globe);
const GLOBE_CENTER = new THREE.Vector3(0, -R, 0);

let META, Q;
const rTop = (h) => R + BASE + (Math.max(h, H_MIN) - H_MIN) * VS;
const pxLat = (py) => mercLat(META.gy0 + py, META.z);
const pxLon = (px) => mercLon(META.gx0 + px, META.z);
function heightAtPx(px, py) {
  const { gw, gh, step } = META;
  const i = Math.max(0, Math.min(gw - 1, Math.round(px / step))), j = Math.max(0, Math.min(gh - 1, Math.round(py / step)));
  const v = Q[j * gw + i]; return v ? v - 500 : H_MIN;
}

/* =========================================================
   Earth globe + regional detail + atmosphere
   ========================================================= */
async function buildGlobe() {
  const earth = await loadTex(LOW ? 'earth_m.jpg' : 'earth.jpg');
  const g = new THREE.Mesh(new THREE.SphereGeometry(R, LOW ? 96 : 160, LOW ? 48 : 80),
    new THREE.MeshStandardMaterial({ map: earth, roughness: 0.92, metalness: 0 }));
  globe.add(g);

  // high-res regional patch (Central Asia) with soft edges
  const reg = META.region, tex = await loadTex(LOW ? 'region_m.jpg' : 'region.jpg');
  const cols = LOW ? 80 : 120, rows = LOW ? 46 : 70;
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const lat = reg.lat1 - (j / rows) * (reg.lat1 - reg.lat0);
    for (let i = 0; i <= cols; i++) {
      const lon = reg.lon0 + (i / cols) * (reg.lon1 - reg.lon0);
      const p = sph(lat, lon, R + 0.12); pos.push(p.x, p.y, p.z);
      uv.push((lonToMx(lon, reg.z) - reg.x0) / reg.w, 1 - (latToMy(lat, reg.z) - reg.y0) / reg.h);
      const fx = Math.min(i, cols - i) / (cols * 0.1), fy = Math.min(j, rows - j) / (rows * 0.12);
      const a = Math.max(0, Math.min(1, Math.min(fx, fy))); col.push(1, 1, 1, a * a * (3 - 2 * a));
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  pg.setIndex(idx); pg.computeVertexNormals();
  const patch = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, transparent: true, roughness: 0.92, depthWrite: false }));
  patch.renderOrder = 1;
  globe.add(patch);

  // atmosphere rim
  const ra = R * 1.06, tl = 1 - Math.sqrt(1 - (R / ra) ** 2);
  const atm = new THREE.Mesh(new THREE.SphereGeometry(ra, 64, 32), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false,
    uniforms: { c: { value: new THREE.Color(0x6ec3ff) }, tl: { value: tl } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float tl; varying vec3 vN; varying vec3 vP; void main(){ float t = 1.0 + dot(normalize(vN), normalize(-vP)); float a = smoothstep(tl - 0.5, tl, t) * (1.0 - smoothstep(tl, 1.0, t)); gl_FragColor = vec4(c, a * 0.55); }',
  }));
  atm.renderOrder = 2;
  globe.add(atm);
}

/* =========================================================
   Kazakhstan relief slab
   ========================================================= */
function strataTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
  const g = c.getContext('2d');
  const bands = [[0, '#6b4f36'], [0.14, '#7e5f42'], [0.26, '#9a7752'], [0.36, '#b08b60'], [0.46, '#8d6c4c'], [0.56, '#c2a074'], [0.66, '#d1b285'],
    [0.74, '#a8835c'], [0.82, '#c9a77a'], [0.9, '#9c7a55'], [0.96, '#6e5437'], [1, '#5a4530']];
  const lg = g.createLinearGradient(0, 1024, 0, 0); bands.forEach(([p, col]) => lg.addColorStop(p, col));
  g.fillStyle = lg; g.fillRect(0, 0, 512, 1024);
  const id = g.getImageData(0, 0, 512, 1024), d = id.data;
  for (let y = 0; y < 1024; y++) { const row = Math.sin(y * 0.21) * 6 + Math.sin(y * 0.047) * 9;
    for (let x = 0; x < 512; x++) { const n = (Math.random() - 0.5) * 20 + row; const k = (y * 512 + x) * 4; d[k] += n; d[k + 1] += n * 0.9; d[k + 2] += n * 0.75; } }
  g.putImageData(id, 0, 0);
  g.fillStyle = '#fec50c'; g.fillRect(0, 0, 512, 6);
  const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping;
  return t;
}

async function buildKazakhstan() {
  const [meta, hj] = await Promise.all([getJSON('meta.json'), getJSON('height.json')]);
  META = meta;
  Q = new Uint16Array(Uint8Array.from(atob(hj.b64), (c) => c.charCodeAt(0)).buffer);
  const { w: W, h: H, gw, gh, step } = meta;
  const sub = LOW ? 3 : 2;               // 6–9 km grid: smooth enough with baked relief, 4–9× fewer triangles
  // cached trig per grid column / row (Mercator is separable)
  const cphi = new Float32Array(gw), sphi = new Float32Array(gw), cth = new Float32Array(gh), sth = new Float32Array(gh);
  for (let i = 0; i < gw; i++) { const phi = (pxLon(i * step) + 180) * DEG; cphi[i] = Math.cos(phi); sphi[i] = Math.sin(phi); }
  for (let j = 0; j < gh; j++) { const th = (90 - pxLat(j * step)) * DEG; cth[j] = Math.cos(th); sth[j] = Math.sin(th); }

  const chunks = LOW
    ? [{ name: 'texture', mask: 'mask.png', tx0: 0, ty0: 0, tw: W * 2, th: H * 2, cx0: 0, cx1: W, cy0: 0, cy1: H }]
    : meta.chunks;

  await Promise.all(chunks.map(async (ch) => {
    const [map, alpha] = await Promise.all([loadTex(`${ch.name}.jpg`), loadTex(ch.mask, false)]);
    const i0 = Math.floor(ch.cx0 / step / sub) * sub, i1 = Math.min(gw - 1, Math.ceil(ch.cx1 / step / sub) * sub);
    const j0 = Math.floor(ch.cy0 / step / sub) * sub, j1 = Math.min(gh - 1, Math.ceil(ch.cy1 / step / sub) * sub);
    const cols = Math.floor((i1 - i0) / sub) + 1, rows = Math.floor((j1 - j0) / sub) + 1;
    const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), ok = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const gi = i0 + c * sub, gj = j0 + r * sub, k = r * cols + c, qv = Q[gj * gw + gi];
      const px = gi * step, py = gj * step, rr = rTop(qv ? qv - 500 : H_MIN);
      ok[k] = qv ? 1 : 0;
      pos[k * 3] = -rr * cphi[gi] * sth[gj]; pos[k * 3 + 1] = rr * cth[gj]; pos[k * 3 + 2] = rr * sphi[gi] * sth[gj];
      uv[k * 2] = (2 * px + 1 - ch.tx0) / ch.tw; uv[k * 2 + 1] = 1 - (2 * py + 1 - ch.ty0) / ch.th;
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      if (ok[a] && ok[b] && ok[cc] && ok[d]) idx.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeBoundingSphere();
    globe.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, alphaMap: alpha, alphaTest: 0.5, toneMapped: false })));
  }));

  // walls: earth cross-section from the globe surface up to the relief
  const ring = meta.ring, n = ring.length;
  const wp = new Float32Array(n * 6), wuv = new Float32Array(n * 4);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let dist = 0, prev = null;
  for (let k = 0; k < n; k++) {
    const [px, py, h] = ring[k];
    const lat = pxLat(py), lon = pxLon(px);
    sph(lat, lon, R - 0.4, a); sph(lat, lon, rTop(h), b);
    if (prev) dist += prev.distanceTo(b);
    prev = b.clone();
    wp.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
    wuv.set([dist / 14, 0, dist / 14, 1], k * 4);
  }
  const widx = [];
  for (let k = 0; k < n - 1; k++) { const i = k * 2; widx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
  wg.setIndex(widx); wg.computeVertexNormals();
  globe.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ map: strataTexture(), roughness: 0.9, side: THREE.DoubleSide })));
  // golden border band along the top edge so the country stands out on the globe
  const bp = new Float32Array(n * 6);
  for (let k = 0; k < n; k++) {
    const [px, py, h] = ring[k], lat = pxLat(py), lon = pxLon(px), rt = rTop(h);
    sph(lat, lon, rt - 0.45, a); sph(lat, lon, rt + 0.03, b);
    bp.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bg.setIndex(widx);
  globe.add(new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xf2b705, side: THREE.DoubleSide, toneMapped: false })));
}

/* =========================================================
   Personality books lying on the map
   ========================================================= */
const books = [];
let PERSONS = [];
function wrapText(g, text, maxW) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function coverTexture(p, img) {
  const W = 600, H = Math.round(600 * BOOK_H / BOOK_W);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  rrect(g, 0, 0, W, H, 26); g.save(); g.clip();
  const bg = g.createRadialGradient(W * 0.3, H * 0.2, 40, W * 0.5, H * 0.5, H * 0.8);
  bg.addColorStop(0, '#13819b'); bg.addColorStop(0.6, '#0b5266'); bg.addColorStop(1, '#073a49');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // ornament border
  rrect(g, 22, 22, W - 44, H - 44, 16); g.strokeStyle = 'rgba(254,197,12,.85)'; g.lineWidth = 4; g.stroke();
  rrect(g, 32, 32, W - 64, H - 64, 12); g.strokeStyle = 'rgba(254,197,12,.35)'; g.lineWidth = 2; g.stroke();
  // portrait in gold frame
  const fw = W * 0.62, fh = fw * 4 / 3, fx = (W - fw) / 2, fy = 66;
  const gold = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
  gold.addColorStop(0, '#ffe58a'); gold.addColorStop(0.5, '#c9a227'); gold.addColorStop(1, '#ffd65a');
  g.fillStyle = gold; rrect(g, fx - 10, fy - 10, fw + 20, fh + 20, 8); g.fill();
  g.save(); rrect(g, fx, fy, fw, fh, 4); g.clip();
  const r = Math.max(fw / img.width, fh / img.height), iw = img.width * r, ih = img.height * r;
  g.drawImage(img, fx + (fw - iw) / 2, fy, iw, ih); g.restore();
  // name
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffd84d'; g.font = '700 50px "PT Serif", Georgia, serif';
  let lines = wrapText(g, p.name, W - 90);
  if (lines.length > 2) { g.font = '700 42px "PT Serif", Georgia, serif'; lines = wrapText(g, p.name, W - 90).slice(0, 2); }
  let y = fy + fh + 74;
  lines.forEach((l) => { g.fillText(l, W / 2, y); y += 54; });
  g.fillStyle = '#cfe9f0'; g.font = '400 28px "PT Sans", system-ui, sans-serif';
  g.fillText(p.years, W / 2, y + 6);
  g.restore();
  const sm = document.createElement('canvas'); sm.width = 320; sm.height = Math.round(320 * H / W);
  sm.getContext('2d').drawImage(c, 0, 0, sm.width, sm.height);
  return canvasTex(sm);
}
function softRectTexture(color, blur) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d'); g.filter = `blur(${blur}px)`; g.fillStyle = color;
  rrect(g, 40, 40, 176, 240, 16); g.fill();
  return canvasTex(c);
}

async function buildBooks() {
  PERSONS = await getJSON('persons.json');
  try { await Promise.all([document.fonts.load('700 50px "PT Serif"'), document.fonts.load('400 28px "PT Sans"')]); } catch (e) {}
  const imgs = await Promise.all(PERSONS.map((p) => loadImg(`img/${p.id}.jpg`)));

  // relax overlapping books in map-pixel space (axis-aligned footprints)
  const items = PERSONS.map((p) => {
    const upp = 0.0806 * (R / 420) * Math.cos(pxLat(p.py) * DEG);   // scene units per map pixel
    return { p, x: p.px, y: p.py, ox: p.px, oy: p.py, hw: (BOOK_W / upp) / 2 + 8, hh: (BOOK_H / upp) / 2 + 8 };
  });
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const dx = B.x - A.x, dy = B.y - A.y, ox = A.hw + B.hw - Math.abs(dx), oy = A.hh + B.hh - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; A.x -= s; B.x += s; }
        else { const s = (dy >= 0 ? 1 : -1) * oy / 2; A.y -= s; B.y += s; }
      }
    }
    for (const t of items) { t.x += (t.ox - t.x) * 0.02; t.y += (t.oy - t.y) * 0.02; }
  }

  const shape = new THREE.Shape(); const w = BOOK_W / 2, h = BOOK_H / 2, r = 0.22;
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: BOOK_T, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 });
  const pagesTex = (() => { const c = document.createElement('canvas'); c.width = 8; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#f6efdc'; g.fillRect(0, 0, 8, 64); for (let y = 0; y < 64; y += 3) { g.fillStyle = 'rgba(150,125,90,.25)'; g.fillRect(0, y, 8, 1); } return canvasTex(c); })();
  pagesTex.wrapS = pagesTex.wrapT = THREE.RepeatWrapping; pagesTex.repeat.set(1, 1);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0a4c5f, roughness: 0.6 });
  const pageMat = new THREE.MeshStandardMaterial({ map: pagesTex, roughness: 0.85 });
  const coverGeo = new THREE.PlaneGeometry(BOOK_W + 0.06, BOOK_H + 0.06);
  const shadowGeo = new THREE.PlaneGeometry(BOOK_W * 1.45, BOOK_H * 1.45);
  const shadowMat = new THREE.MeshBasicMaterial({ map: softRectTexture('rgba(10,25,35,1)', 18), transparent: true, opacity: 0.45, depthWrite: false });
  const glowMat0 = new THREE.MeshBasicMaterial({ map: softRectTexture('rgba(254,197,12,1)', 22), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pinGeo = new THREE.CircleGeometry(0.32, 24), ringGeo = new THREE.RingGeometry(0.5, 0.75, 40);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xfec50c, toneMapped: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.9 });

  items.forEach((it, i) => {
    const p = it.p;
    // footprint height: highest terrain under the book
    let hmax = H_MIN;
    for (const [fx, fy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) hmax = Math.max(hmax, heightAtPx(it.x + fx * it.hw * 0.9, it.y + fy * it.hh * 0.9));
    const lat = pxLat(it.y), lon = pxLon(it.x);
    const { n, e, no } = basisAt(lat, lon);
    const base = new THREE.Group();
    base.position.copy(sph(lat, lon, rTop(hmax) + 0.05));
    base.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e, no, n));
    const lift = new THREE.Group(); base.add(lift);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.set(0.35, 0.45, 0.02); base.add(shadow);
    const glow = new THREE.Mesh(shadowGeo, glowMat0.clone()); glow.position.z = 0.03; base.add(glow);
    const body = new THREE.Mesh(bodyGeo, [capMat, pageMat]); lift.add(body);
    const cover = new THREE.Mesh(coverGeo, new THREE.MeshBasicMaterial({ map: coverTexture(p, imgs[i]), transparent: true, alphaTest: 0.5, toneMapped: false }));
    cover.position.z = BOOK_T + 0.05; lift.add(cover);
    body.userData.index = cover.userData.index = i;
    globe.add(base);

    // pin at the exact birthplace + leader line when the book had to move aside
    const truLat = pxLat(p.py), truLon = pxLon(p.px), tb = basisAt(truLat, truLon);
    const pin = new THREE.Group(); pin.position.copy(sph(truLat, truLon, rTop(heightAtPx(p.px, p.py)) + 0.06));
    pin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tb.e, tb.no, tb.n));
    pin.add(new THREE.Mesh(pinGeo, pinMat));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfec50c, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    ring.position.z = 0.01; ring.material.opacity = 0.55; pin.add(ring);
    globe.add(pin);
    if (Math.hypot(it.x - p.px, it.y - p.py) > 6) {
      const lg = new THREE.BufferGeometry().setFromPoints([pin.position.clone(), base.position.clone().add(n.clone().multiplyScalar(0.05))]);
      globe.add(new THREE.Line(lg, lineMat));
    }
    books.push({ p, base, lift, body, cover, glow, ring, hover: 0, phase: Math.random() * 6.28 });
  });
}

/* =========================================================
   City labels
   ========================================================= */
let CITIES = [];
async function buildCities() {
  CITIES = await getJSON('cities.json');
  globe.updateMatrixWorld(true);
  CITIES.forEach((c) => {
    const el = document.createElement('div'); el.className = 'city' + (c.big ? ' big' : ''); el.textContent = c.n;
    $('labels').appendChild(el);
    c.pos = globe.localToWorld(sph(pxLat(c.py), pxLon(c.px), rTop(c.h) + 0.3));
    c.nrm = c.pos.clone().sub(GLOBE_CENTER).normalize(); c.el = el; c.vis = false;
  });
}
const proj = new THREE.Vector3(), tmpv = new THREE.Vector3();
function updateLabels() {
  const W = window.innerWidth, H = window.innerHeight;
  for (const c of CITIES) {
    const d = camera.position.distanceTo(c.pos);
    tmpv.subVectors(camera.position, c.pos).normalize();
    let o = Math.max(0, Math.min(1, ((c.big ? 760 : 330) - d) / 80));
    if (tmpv.dot(c.nrm) < 0.08 || d < 12) o = 0;
    if (o > 0.01) { proj.copy(c.pos).project(camera); if (proj.z > 1) o = 0; }
    if (o <= 0.01) { if (c.vis) { c.el.style.opacity = '0'; c.vis = false; } continue; }
    c.vis = true; c.el.style.opacity = o.toFixed(2);
    c.el.style.transform = `translate3d(${((proj.x + 1) / 2 * W).toFixed(1)}px, ${((1 - proj.y) / 2 * H).toFixed(1)}px, 0) translate(-4px, -50%)`;
  }
}

/* =========================================================
   Camera views & modes (map ↔ globe)
   ========================================================= */
let mode = 'map';
function mapView() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max(112 / (t * camera.aspect), 72 / t) * 1.06;
  const target = new THREE.Vector3(0, 0, 6);
  return { pos: new THREE.Vector3(0, 0.8, 0.6).normalize().multiplyScalar(d).add(target), target, mode: 'map' };
}
function globeView(scale = 3.4) {
  return { pos: new THREE.Vector3(0, 0.99, 0.14).normalize().multiplyScalar(R * scale).add(GLOBE_CENTER), target: GLOBE_CENTER.clone(), mode: 'globe' };
}
let flight = null;
function flyTo(v, dur = 1400, done) {
  flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone(), start: performance.now(), dur, done, mode: v.mode };
  // release OrbitControls limits while the camera is being driven, otherwise they clamp it mid-flight (stutter)
  controls.minDistance = 0.01; controls.maxDistance = Infinity; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
}
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function setMode(m) {
  mode = m; controls.maxDistance = 3600; controls.minPolarAngle = 0;
  if (m === 'globe') {
    controls.maxPolarAngle = Math.PI; controls.minDistance = R * 1.12; if ('zoomToCursor' in controls) controls.zoomToCursor = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  } else {
    controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; if ('zoomToCursor' in controls) controls.zoomToCursor = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };   // drag = move the map
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  }
}
function updateMode() {
  if (flight) return false;
  if (mode === 'map') {
    if (camera.position.distanceTo(controls.target) > 560) {
      const d = Math.max(R * 2.2, camera.position.distanceTo(GLOBE_CENTER));
      flyTo({ pos: new THREE.Vector3(0, 0.99, 0.14).normalize().multiplyScalar(d).add(GLOBE_CENTER), target: GLOBE_CENTER.clone(), mode: 'globe' }, 900, () => setMode('globe'));
      return false;
    }
  } else {
    const off = tmpv.subVectors(camera.position, GLOBE_CENTER);
    const above = off.clone().normalize().y;                 // 1 = straight above Kazakhstan
    if (off.length() < R + 300 && above > 0.86) { flyTo(mapView(), 900, () => setMode('map')); return false; }
  }
  if (mode === 'globe') { if (controls.target.distanceTo(GLOBE_CENTER) > 0.05) { controls.target.lerp(GLOBE_CENTER, 0.08); return true; } }
  else if (controls.target.distanceTo(GLOBE_CENTER) < R * 0.98) { controls.target.lerp(new THREE.Vector3(0, 0, 6), 0.08); return true; }
  return false;
}

/* =========================================================
   Interaction
   ========================================================= */
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hovered = null, downAt = null, lastMove = 0;
const tip = $('hover-tip');
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(books.flatMap((b) => [b.cover, b.body]), false)[0];
  return hit ? books[hit.object.userData.index] : null;
}
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (bookOpen || ev.pointerType === 'touch') return;
  const now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
  const b = mode === 'map' ? pick(ev) : null; hovered = b;
  renderer.domElement.style.cursor = b ? 'pointer' : 'grab';
  if (b) { tip.innerHTML = ''; tip.append(b.p.name); const sm = document.createElement('small'); sm.textContent = `${b.p.years} · ${b.p.region}`; tip.append(sm);
    tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px'; tip.style.opacity = 1; } else tip.style.opacity = 0;
});
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; hideHint(); });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || bookOpen) return;
  if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) < 7 && performance.now() - downAt.t < 650) { const b = pick(ev); if (b) focusBook(b); }
  downAt = null;
});
renderer.domElement.addEventListener('dblclick', (ev) => {
  if (mode === 'globe') flyTo(mapView(), 1800, () => setMode('map'));
});
renderer.domElement.addEventListener('wheel', hideHint, { passive: true });
function hideHint() { $('hint').classList.add('gone'); }

function focusBook(b) {
  tip.style.opacity = 0; hovered = null;
  const wp = new THREE.Vector3(); b.cover.getWorldPosition(wp);
  const up = wp.clone().sub(GLOBE_CENTER).normalize();
  const pos = wp.clone().add(up.multiplyScalar(13)).add(new THREE.Vector3(0, 0, 7.5));
  flyTo({ pos, target: wp, mode: 'map' }, 1200, () => { setMode('map'); openBook(b.p); });
  closePanel();
}
$('home-btn').addEventListener('click', () => flyTo(mapView(), 1700, () => setMode('map')));
$('globe-btn').addEventListener('click', () => flyTo(globeView(), 1900, () => setMode('globe')));
$('fs-btn').addEventListener('click', () => {
  const d = document;
  if (!d.fullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
  else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
});

/* on-screen navigation buttons */
document.querySelectorAll('#nav button').forEach((btn) => btn.addEventListener('click', () => {
  hideHint();
  const tg = controls.target.clone(), off = camera.position.clone().sub(tg);
  const act = btn.dataset.nav;
  if (act === 'in' || act === 'out') {
    const k = act === 'in' ? 0.55 : 1.8;
    // crossing between globe and map → one continuous flight (no second hop, no target snap)
    if (mode === 'globe' && act === 'in' && camera.position.distanceTo(GLOBE_CENTER) * k < R + 420) {
      flyTo(mapView(), 1100, () => setMode('map')); return;
    }
    if (mode === 'map' && act === 'out' && off.length() * k > 560) {
      flyTo(globeView(2.6), 1100, () => setMode('globe')); return;
    }
    let d = THREE.MathUtils.clamp(off.length() * k, controls.minDistance, controls.maxDistance);
    off.setLength(d);
  } else if (act === 'left' || act === 'right') {
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (act === 'left' ? 1 : -1) * Math.PI / 6);
  } else if (act === 'tilt') {
    const sp = new THREE.Spherical().setFromVector3(off);
    sp.phi = sp.phi > 0.75 ? 0.35 : 1.05; off.setFromSpherical(sp);
  } else if (act === 'north') {
    const sp = new THREE.Spherical().setFromVector3(off); sp.theta = 0; off.setFromSpherical(sp);
  }
  flyTo({ pos: tg.clone().add(off), target: tg, mode }, 420, () => setMode(mode));
}));

$('q-btn').textContent = LOW ? 'SD' : 'HD';
$('q-btn').addEventListener('click', () => { try { localStorage.setItem('kz_quality', LOW ? 'high' : 'medium'); } catch (e) {} location.reload(); });

const panel = $('panel');
function closePanel() { panel.classList.remove('open'); }
$('list-toggle').addEventListener('click', () => panel.classList.toggle('open'));
function renderList(filter = '') {
  const f = filter.trim().toLowerCase(), groups = {};
  PERSONS.forEach((p) => { if (f && !(p.name + ' ' + p.name_ru + ' ' + p.region).toLowerCase().includes(f)) return; const g = p.region.split(',')[0].trim(); (groups[g] = groups[g] || []).push(p); });
  const list = $('list'); list.innerHTML = '';
  Object.keys(groups).sort((a, b) => a.localeCompare(b, 'kk')).forEach((g) => {
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; list.appendChild(h);
    groups[g].forEach((p) => {
      const b = document.createElement('button'); b.className = 'item';
      b.innerHTML = '<img alt="" loading="lazy"><div><div class="n"></div><div class="y"></div></div>';
      b.querySelector('img').src = `img/${p.id}.jpg`; b.querySelector('.n').textContent = p.name; b.querySelector('.y').textContent = `${p.years} · ${p.region}`;
      b.addEventListener('click', () => focusBook(books.find((x) => x.p.id === p.id)));
      list.appendChild(b);
    });
  });
  if (!list.children.length) list.innerHTML = '<div class="grp" style="text-transform:none;letter-spacing:0">Ештеңе табылмады</div>';
}
$('search').addEventListener('input', (e) => { renderList(e.target.value); panel.classList.add('open'); });

/* =========================================================
   Book + ElevenLabs live conversation
   ========================================================= */
let bookOpen = false, current = null, lang = 'kk';
const histories = {};
const overlay = $('book-overlay'), cover = $('cover'), log = $('chat-log'), statusEl = $('status'), wave = $('wave');
const cleanText = (t) => (t || '').replace(/\[[^\]]{1,40}\]\s*/g, '').trim();
function addMsg(role, text) {
  const d = document.createElement('div'); d.className = `msg ${role === 'user' ? 'u' : 'a'}`; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
const nameFor = (p) => (lang === 'ru' ? p.name_ru : p.name);
function setStatus(t) { statusEl.textContent = t || ''; }

function buildPrompt(p) {
  const rule = lang === 'kk' ? 'Тек қазақ тілінде сөйле.' : 'Говори только по-русски; можно вставлять казахские обращения (балам, шырағым).';
  const hist = (histories[p.id] || []).slice(-10).map((m) => `${m.role === 'user' ? 'Ұрпақ' : 'Сен'}: ${m.content}`).join('\n');
  return `Сен — ${p.name} (${p.years}), ${p.region} өңірімен байланысты тарихи тұлға. Өмірбаяның қысқаша: ${p.bio}
Сен тірі ${p.name} сияқты сөйлейсің: өз мінезіңмен, өз дәуіріңнің сөзімен, өз өмір тәжірибеңмен, бірінші жақпен ("мен"). Бейнеден шықпа, өзіңді ассистент, модель, бот деп атама. Тек адам шын ниетпен "сен ЖИ-сің бе?" деп сұраса ғана, бұл тарихи бейненің қайта жаңғыртылған дауысы екенін бір сөйлеммен мойында да, әңгімені сол бейнеде жалғастыр.
Сенімен 2026 жылы өмір сүріп жатқан қазақ ұрпағы тірідей, дауыспен сөйлесіп отыр. Жылы, бірақ шыншыл бол: қалай өмір сүру керектігін айт, ақыл бер, ұрпақтың сенің өсиетіңді орындамай жүрген тұстарын әдеппен, бірақ ашық сына.
Өз шығармаларың мен өміріңнен тек нақты білетін деректерді айт; сенімді болмасаң дәйексөзді ойдан шығарма. Өзің қайтыс болғаннан кейінгі оқиғалар туралы сұраса — таңғала, өз көзқарасыңнан баға бер.
Жауап қысқа болсын: 2–4 сөйлем, ауызша айтуға ыңғайлы. Тізім, эмодзи қолданба. Әңгімені жалғастыру үшін кейде өзің де сұрақ қой.
Зиянды не қауіпті нәрсе сұраса — өз мінезіңде қалып, ақылмен бас тарт.
${rule}${hist ? '\n\nОсыған дейінгі әңгімелерің:\n' + hist : ''}`;
}

let session = null, sessionKind = null, connecting = false, pendingText = null;

/* ---- Minimal ElevenLabs Agents client (WebSocket protocol) ----
   • audio replies are played for BOTH typed and spoken questions
   • microphone is only requested in voice mode                     */
const b64ToBytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
let sharedCtx = null;
function audioCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}
class AgentSession {
  constructor(opts) { this.o = opts; this.sources = []; this.playHead = 0; this.outRate = 16000; this.inRate = 16000; this.micLevel = 0; this.closed = false; this.mode = 'listening'; }
  async start(withMic) {
    const ctx = this.ctx = audioCtx();
    this.out = ctx.createGain(); this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.out.connect(this.analyser); this.analyser.connect(ctx.destination);
    this.buf = new Uint8Array(this.analyser.fftSize);
    if (withMic) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    }
    await new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`);
      let ok = false;
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: this.o.override })); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'conversation_initiation_metadata') {
          const md = m.conversation_initiation_metadata_event || {};
          const of = /pcm_(\d+)/.exec(md.agent_output_audio_format || ''); if (of) this.outRate = +of[1];
          const inf = /pcm_(\d+)/.exec(md.user_input_audio_format || ''); if (inf) this.inRate = +inf[1];
          ok = true; resolve();
        }
        this.handle(m);
      };
      ws.onerror = () => { if (!ok) reject(new Error('WebSocket')); };
      ws.onclose = (e) => { if (!ok) reject(new Error(e.reason || 'closed')); else this.finish(); };
    });
    if (withMic) await this.startMic();
    this.tick();
  }
  async startMic() {
    const ctx = this.ctx;
    const src = `class Cap extends AudioWorkletProcessor { process(i){ const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor('cap-proc', Cap);`;
    if (!ctx.__capReady) { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); ctx.__capReady = true; }
    this.micSrc = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'cap-proc');
    const mute = ctx.createGain(); mute.gain.value = 0;
    this.micSrc.connect(this.node); this.node.connect(mute); mute.connect(ctx.destination);
    const ratio = ctx.sampleRate / this.inRate; let acc = []; let pos = 0;
    this.node.port.onmessage = (e) => {
      const x = e.data; let sum = 0;
      for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
      this.micLevel = Math.sqrt(sum / x.length);
      // downsample (box filter) to the agent's input rate
      while (pos < x.length) { const i0 = Math.floor(pos), i1 = Math.min(x.length, Math.floor(pos + ratio)); let s = 0, n = 0; for (let i = i0; i < i1; i++) { s += x[i]; n++; } acc.push(n ? s / n : x[i0]); pos += ratio; }
      pos -= x.length;
      if (acc.length >= this.inRate / 8) {                        // ~125 ms chunks
        const pcm = new Int16Array(acc.length); for (let i = 0; i < acc.length; i++) pcm[i] = Math.max(-1, Math.min(1, acc[i])) * 0x7fff;
        acc = [];
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ user_audio_chunk: bytesToB64(new Uint8Array(pcm.buffer)) }));
      }
    };
  }
  handle(m) {
    switch (m.type) {
      case 'audio': { const ev = m.audio_event || {}; if (ev.audio_base_64) this.play(ev.audio_base_64); break; }
      case 'agent_response': this.o.onMessage && this.o.onMessage({ source: 'ai', message: (m.agent_response_event || {}).agent_response }); break;
      case 'user_transcript': this.o.onMessage && this.o.onMessage({ source: 'user', message: (m.user_transcription_event || {}).user_transcript }); break;
      case 'interruption': this.stopAudio(); break;
      case 'ping': { const p = m.ping_event || {}; setTimeout(() => { try { this.ws.send(JSON.stringify({ type: 'pong', event_id: p.event_id })); } catch (e) {} }, p.ping_ms || 0); break; }
      default: break;
    }
  }
  play(b64) {
    const ctx = this.ctx, u8 = b64ToBytes(b64);
    const pcm = new Int16Array(u8.buffer, 0, u8.length >> 1);
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, this.outRate), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(this.out);
    const t = Math.max(ctx.currentTime + 0.04, this.playHead);
    s.start(t); this.playHead = t + buf.duration;
    this.sources.push(s); s.onended = () => { this.sources = this.sources.filter((x) => x !== s); };
  }
  stopAudio() { this.sources.forEach((s) => { try { s.stop(); } catch (e) {} }); this.sources = []; this.playHead = 0; }
  tick() {
    if (this.closed) return;
    const speaking = this.playHead > this.ctx.currentTime + 0.02;
    const md = speaking ? 'speaking' : 'listening';
    if (md !== this.mode) { this.mode = md; this.o.onModeChange && this.o.onModeChange({ mode: md }); }
    requestAnimationFrame(() => this.tick());
  }
  getOutputVolume() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf); let s = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / this.buf.length);
  }
  getInputVolume() { return this.micLevel; }
  sendUserMessage(text) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'user_message', text })); }
  finish() { if (this.closed) return; this.closed = true; this.o.onDisconnect && this.o.onDisconnect(); }
  async endSession() {
    this.closed = true; this.stopAudio();
    try { this.node && this.node.disconnect(); this.micSrc && this.micSrc.disconnect(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}

async function endSession() {
  const s = session; session = null; sessionKind = null;
  if (s) { try { await s.endSession(); } catch (e) {} }
  $('live-btn').classList.remove('on', 'connecting'); $('live-label').textContent = liveLabel();
  avatar && avatar.setTalk && avatar.setTalk(false); wave.classList.remove('on', 'listen');
}
const liveLabel = () => (session && sessionKind === 'voice' ? (lang === 'ru' ? 'Завершить разговор' : 'Сөйлесуді аяқтау') : (lang === 'ru' ? 'Говорить голосом' : 'Дауыспен сөйлесу'));

async function startSession(kind) {
  if (!current || connecting) return;
  audioCtx();                                   // unlock audio inside the click
  await endSession();
  connecting = true; $('newtab-btn').hidden = !IN_IFRAME;
  if (kind === 'voice') { $('live-btn').classList.add('connecting'); $('live-label').textContent = lang === 'ru' ? 'Подключение…' : 'Қосылуда…'; }
  setStatus(lang === 'ru' ? 'Подключение…' : 'Қосылып жатыр…');
  const p = current, h = histories[p.id];
  // typed question → no spoken greeting, answer straight away; voice → greet first
  const first = kind !== 'voice' ? '' : (h.length <= 1 ? p.greet : (lang === 'ru' ? 'Да, я слушаю тебя, балам.' : 'Иә, балам, тыңдап отырмын.'));
  let skipFirst = kind === 'voice' && h.length <= 1;
  const s = new AgentSession({
    override: {
      agent: { prompt: { prompt: buildPrompt(p) }, first_message: first, language: lang },
      tts: { voice_id: p.voice, speed: p.speed || 1 },
    },
    onDisconnect: () => { if (session === s) { session = null; sessionKind = null; } $('live-btn').classList.remove('on', 'connecting'); $('live-label').textContent = liveLabel(); wave.classList.remove('on', 'listen'); avatar.setTalk(false); },
    onModeChange: ({ mode: m }) => {
      const speaking = m === 'speaking';
      avatar.setTalk(speaking);
      wave.classList.toggle('on', speaking || kind === 'voice'); wave.classList.toggle('listen', !speaking && kind === 'voice');
      setStatus(speaking ? (lang === 'ru' ? 'Говорит…' : 'Сөйлеп тұр…') : (kind === 'voice' ? (lang === 'ru' ? 'Слушает вас…' : 'Сізді тыңдап тұр…') : ''));
    },
    onMessage: ({ source, message }) => {
      if (current !== p) return;
      const txt = cleanText(message); if (!txt) return;
      if (source === 'ai') {
        if (skipFirst) { skipFirst = false; return; }
        typingOff(); h.push({ role: 'assistant', content: txt }); addMsg('assistant', txt);
      } else { h.push({ role: 'user', content: txt }); addMsg('user', txt); typingOn(); }
    },
  });
  try {
    await s.start(kind === 'voice');
    session = s; sessionKind = kind; connecting = false;
    setStatus(kind === 'voice' ? (lang === 'ru' ? 'Говорите — я слушаю' : 'Сөйлей беріңіз — тыңдап тұрмын') : '');
    if (kind === 'voice') { $('live-btn').classList.remove('connecting'); $('live-btn').classList.add('on'); $('live-label').textContent = liveLabel(); wave.classList.add('on', 'listen'); }
    if (pendingText) { const t = pendingText; pendingText = null; sendText(t); }
  } catch (e) {
    connecting = false; console.error(e); try { s.endSession(); } catch (x) {}
    $('live-btn').classList.remove('connecting', 'on'); $('live-label').textContent = liveLabel();
    const denied = /NotAllowed|Permission|denied|NotFound/i.test(String(e && (e.name || e.message || e)));
    if (denied) { setStatus(lang === 'ru' ? 'Нет доступа к микрофону. Откройте сайт и разрешите микрофон (можно и писать текстом — ответ будет голосом).' : 'Микрофонға рұқсат жоқ. Сайтта ашып, микрофонға рұқсат беріңіз (жазып сұрасаңыз да, жауап дауыспен келеді).'); $('newtab-btn').hidden = false; }
    else setStatus((lang === 'ru' ? 'Не удалось подключиться: ' : 'Қосылу мүмкін болмады: ') + (e && e.message ? e.message : e));
  }
}
let typingEl = null;
function typingOn() { if (typingEl) return; typingEl = document.createElement('div'); typingEl.className = 'msg a typing'; typingEl.innerHTML = '<span></span><span></span><span></span>'; log.appendChild(typingEl); log.scrollTop = log.scrollHeight; }
function typingOff() { if (typingEl) { typingEl.remove(); typingEl = null; } }
function sendText(t) {
  const p = current; if (!p) return;
  if (!session) { pendingText = t; startSession('text'); return; }
  histories[p.id].push({ role: 'user', content: t }); addMsg('user', t); typingOn();
  try { session.sendUserMessage(t); } catch (e) { typingOff(); setStatus(String(e)); }
}
$('text-form').addEventListener('submit', (e) => { e.preventDefault(); audioCtx(); const v = $('text-input').value.trim(); $('text-input').value = ''; if (v) sendText(v); });
$('live-btn').addEventListener('click', () => { if (session && sessionKind === 'voice') endSession(); else startSession('voice'); });
$('newtab-btn').addEventListener('click', () => { try { window.open(SITE_URL, '_blank', 'noopener'); } catch (e) {} });

// live volume meter
const bars = [...wave.querySelectorAll('i')];
function meter() {
  if (session && sessionKind === 'voice') {
    let v = 0; try { v = wave.classList.contains('listen') ? session.getInputVolume() : session.getOutputVolume(); } catch (e) {}
    bars.forEach((b, i) => { const k = 0.55 + 0.45 * Math.sin(performance.now() / 120 + i * 1.3); b.style.height = (4 + Math.min(1, v * 2.2) * 18 * k).toFixed(1) + 'px'; });
  }
  requestAnimationFrame(meter);
}
meter();


/* =========================================================
   Talking hologram avatar (WebGL warp of the real portrait)
   ========================================================= */
const SITE_URL = 'https://dousheng34.github.io/kazakhstan-legends-3d/';
const IN_IFRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const avatar = (() => {
  const cv = $('avatar');
  const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: true });
  if (!gl) return { load() {}, setTalk() {}, pulse() {} };
  const vs = 'attribute vec2 p; varying vec2 v; void main(){ v = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.,1.); }';
  const fs = `precision mediump float;
  uniform sampler2D T; uniform float t, op, has; uniform vec4 M; uniform float FH; varying vec2 v;
  void main(){
    vec2 uv = v;
    vec2 c = vec2(M.x, M.y - FH*0.35);
    float headW = smoothstep(0.55, 0.0, distance(uv, c));
    uv.x += sin(t*0.8)*0.003 * headW;
    uv.y += (sin(t*1.1)*0.0015 - op*0.0012) * headW;
    uv = (uv - vec2(0.5, 0.62)) / (1.0 + 0.005*sin(t*1.3)) + vec2(0.5, 0.62);
    float inner = 0.0;
    if (has > 0.5) {
      float hw = M.z*0.5, dx = abs(uv.x - M.x), dy = uv.y - M.y;
      float D = op * FH * 0.045;
      float wx = 1.0 - smoothstep(hw*0.85, hw*1.9, dx);
      float wy = 1.0 - smoothstep(FH*0.10, FH*0.30, dy);
      float w = (dy > 0.0) ? wx*wy : 0.0;
      float gap = D * w;
      if (dy > 0.0 && dy < gap) {
        float e = pow(dx/(hw*0.8), 2.0) + pow((dy - gap*0.5)/(gap*0.5 + 1e-4), 2.0);
        inner = 1.0 - smoothstep(0.7, 1.0, e);
      }
      uv.y -= gap;
      if (dy < 0.0 && dy > -FH*0.05) uv.y += op*FH*0.006*wx*(1.0 + dy/(FH*0.05));   // upper lip lifts a little
    }
    vec4 col = texture2D(T, clamp(uv, 0.0, 1.0));
    col.rgb = mix(col.rgb, col.rgb*0.25 + vec3(0.08, 0.02, 0.02), inner*0.85);
    float scan = 0.5 + 0.5*sin(v.y*900.0 + t*6.0);
    col.rgb += vec3(0.0, 0.10, 0.14) * scan * 0.05;
    float edge = smoothstep(0.0, 0.06, v.x) * smoothstep(1.0, 0.94, v.x) * smoothstep(0.0, 0.05, v.y) * smoothstep(1.0, 0.9, v.y);
    col.rgb = mix(vec3(0.05, 0.35, 0.45), col.rgb, 0.85 + 0.15*edge);
    gl_FragColor = vec4(col.rgb, 1.0);
  }`;
  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uT = U('t'), uOp = U('op'), uHas = U('has'), uM = U('M'), uFH = U('FH');
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let mouth = null, open = 0, talk = 0, fake = 0, ready = false;
  function load(p) {
    ready = false; mouth = p.mouth;
    const img = new Image(); img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); ready = true; };
    img.src = `img/${p.id}.jpg`;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!bookOpen || !ready) return;
    let target = 0;
    if (talk > 0) {
      let vol = 0; try { vol = session && sessionKind === 'voice' ? session.getOutputVolume() : 0; } catch (e) {}
      const syl = 0.55 + 0.45 * Math.abs(Math.sin(now / 75) * Math.sin(now / 190 + 1.3));
      target = Math.min(1, (vol > 0.002 ? vol * 3.2 : 0.55) * syl);
    }
    if (fake > now) { const syl = Math.abs(Math.sin(now / 80) * Math.sin(now / 210 + 0.7)); target = Math.max(target, 0.25 + 0.6 * syl); }
    open += (target - open) * 0.35;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform1f(uT, now / 1000); gl.uniform1f(uOp, open);
    gl.uniform1f(uHas, mouth ? 1 : 0);
    gl.uniform4f(uM, mouth ? mouth.x : 0.5, mouth ? mouth.y : 0.5, mouth ? mouth.w : 0.1, 0);
    gl.uniform1f(uFH, mouth ? mouth.fh : 0.3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    $('portrait-wrap').classList.toggle('speaking', open > 0.08);
  }
  requestAnimationFrame(frame);
  return { load, setTalk(on) { talk = on ? 1 : 0; }, pulse(text) { fake = performance.now() + Math.min(14000, 900 + (text || '').length * 55); } };
})();

function openBook(p) {
  current = p; bookOpen = true; document.body.classList.add('reading');
  $('cover-img').src = $('left-img').src = `img/${p.id}.jpg`;
  avatar.load(p);
  $('cover-name').textContent = p.name; $('cover-years').textContent = p.years;
  $('left-name').textContent = nameFor(p); $('talk-name').textContent = nameFor(p);
  $('left-years').textContent = p.years; $('left-region').textContent = p.region; $('left-bio').textContent = p.bio;
  let mh = $('page-right').querySelector('.mobile-head');
  if (!mh) { mh = document.createElement('div'); mh.className = 'mobile-head'; $('page-right').insertBefore(mh, $('page-right').querySelector('.talk-head')); }
  mh.innerHTML = '<img alt=""><div><div class="n"></div><div class="y"></div><div class="b"></div></div>';
  mh.querySelector('img').src = `img/${p.id}.jpg`; mh.querySelector('.n').textContent = p.name;
  mh.querySelector('.y').textContent = `${p.years} · ${p.region}`; mh.querySelector('.b').textContent = p.bio;
  log.innerHTML = ''; typingEl = null;
  if (!histories[p.id]) histories[p.id] = [{ role: 'assistant', content: p.greet }];
  histories[p.id].forEach((m) => addMsg(m.role, m.content));
  setStatus(lang === 'ru' ? 'Нажмите «Говорить голосом», чтобы начать живой разговор' : '«Дауыспен сөйлесу» батырмасын басып, тірідей сөйлесіңіз');
  $('newtab-btn').hidden = !IN_IFRAME;
  $('live-label').textContent = liveLabel();
  clearTimeout(closeTimer);
  overlay.classList.remove('show', 'closing'); void overlay.offsetWidth;   // restart the opening choreography
  overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false');
}
let closeTimer = 0;
function closeBook() {
  endSession(); pendingText = null;
  overlay.classList.add('closing'); overlay.setAttribute('aria-hidden', 'true');
  clearTimeout(closeTimer); closeTimer = setTimeout(() => overlay.classList.remove('show', 'closing'), 480);
  bookOpen = false; document.body.classList.remove('reading');
  const t = controls.target.clone();
  const back = new THREE.Vector3().subVectors(camera.position, t).normalize().multiplyScalar(70).add(t);
  back.y = Math.max(back.y, t.y + 40);
  flyTo({ pos: back, target: t, mode: 'map' }, 1100, () => setMode('map'));
}
$('book-close').addEventListener('click', closeBook);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBook(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bookOpen) closeBook(); });
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  if (lang === b.dataset.lang) return;
  lang = b.dataset.lang;
  document.querySelectorAll('.lang button').forEach((x) => x.classList.toggle('on', x === b));
  if (current) { $('left-name').textContent = nameFor(current); $('talk-name').textContent = nameFor(current); }
  $('text-input').placeholder = lang === 'ru' ? 'Или напишите вопрос…' : 'Немесе жазып сұраңыз…';
  const wasVoice = session && sessionKind === 'voice';
  endSession().then(() => { if (wasVoice) startSession('voice'); });
}));

/* =========================================================
   Render loop (adaptive resolution, paused behind the book)
   ========================================================= */
const clock = new THREE.Clock();
let frames = 0, acc = 0, slow = 0, fast = 0, frozen = false;
function adapt(dt) {
  frames++; acc += dt; if (acc < 1) return;
  const fps = frames / acc; const n = frames; frames = 0; acc = 0;
  if (n < 20) return;                       // idle periods (on-demand rendering) are not measured
  if (fps < 48) { slow++; fast = 0; } else if (fps > 58) { fast++; slow = 0; } else slow = fast = 0;
  if (slow >= 2 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); slow = 0; }
  else if (fast >= 4 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + 0.25); renderer.setPixelRatio(dpr); fast = 0; }
}
let dirty = true;
const markDirty = () => { dirty = true; };
controls.addEventListener('change', markDirty);
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (bookOpen && !flight) { if (!frozen) { renderer.render(scene, camera); frozen = true; } return; }
  if (frozen) { frozen = false; dirty = true; }
  let active = false;
  if (flight) {
    const k = Math.min(1, (performance.now() - flight.start) / flight.dur), e = ease(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    active = true;
    if (k >= 1) { const d = flight.done; flight = null; d && d(); }
  }
  if (updateMode()) active = true;
  controls.update();
  if (mode === 'map' && !flight) {
    const tg = controls.target, ox = tg.x, oz = tg.z;
    tg.x = Math.max(-135, Math.min(135, tg.x)); tg.z = Math.max(-85, Math.min(95, tg.z));
    if (Math.abs(tg.y) > 0.01) { tg.y += (0 - tg.y) * 0.1; active = true; }
    camera.position.x += tg.x - ox; camera.position.z += tg.z - oz;
  }
  for (const b of books) {
    const goal = b === hovered ? 1 : 0;
    if (Math.abs(goal - b.hover) > 0.002) {
      b.hover += (goal - b.hover) * 0.2; active = true;
      b.lift.position.z = b.hover * 0.9; b.lift.scale.setScalar(1 + b.hover * 0.07); b.glow.material.opacity = b.hover * 0.9;
    }
  }
  if (!dirty && !active) return;            // nothing changed → no GPU work at all
  dirty = false;
  updateLabels();
  renderer.render(scene, camera);
  adapt(dt);
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); dirty = true; });

/* =========================================================
   Boot
   ========================================================= */
(async function boot() {
  try {
    await buildKazakhstan();
    await Promise.all([buildGlobe(), buildBooks(), buildCities()]);
    renderList(); $('count').textContent = PERSONS.length;
    const gv = globeView(4.6);
    camera.position.copy(gv.pos); controls.target.copy(gv.target); setMode('globe');
    renderer.compile(scene, camera);
    ALL_TEX.forEach((t) => { try { renderer.initTexture(t); } catch (e) {} });   // upload all textures now → no freeze later
    renderer.setAnimationLoop(animate);
    $('progress-bar').style.width = '100%'; $('progress-text').textContent = 'Дайын';
    const btn = $('enter-btn'); btn.disabled = false; btn.focus();
    btn.addEventListener('click', () => {
      $('splash').classList.add('hide'); document.body.classList.remove('booting');
      flyTo(globeView(2.6), 1600, () => flyTo(mapView(), 2600, () => setMode('map')));
      setTimeout(hideHint, 10000);
    }, { once: true });
  } catch (e) {
    console.error(e); $('progress-text').textContent = 'Жүктеу қатесі: ' + e.message;
  }
})();
