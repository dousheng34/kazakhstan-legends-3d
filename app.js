import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { AgentSession } from './voice-session.js';
import { initSelect, makeSfx } from './select.js';
import { teleport } from './teleport.js';
import { resolveQuality, dprCap, stepDpr, shouldRenderWhileHidden, labelOpacityCss } from './render-quality.js';

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
const QUALITY = resolveQuality(savedQ, { isMobile, weakGpu: WEAK_GPU, maxTex, cores: navigator.hardwareConcurrency || 8 });
const LOW = QUALITY !== 'high';
let DPR_MAX = dprCap(window.devicePixelRatio || 1, QUALITY, { width: innerWidth, height: innerHeight, maxDimension: maxTex });
probe?.getExtension('WEBGL_lose_context')?.loseContext();

const R = 420;                         // globe radius (scene units)
const EXAG = 15;                       // vertical exaggeration of Kazakhstan relief
const VS = (R / 6371000) * EXAG;       // scene units per metre of elevation
const BASE = 2.6;                      // how far Kazakhstan is raised above the globe
const H_MIN = -150;
const KZ_LAT = 48.0, KZ_LON = 67.0;
const CARD_W = 4.6, CARD_H = 6.1;                // photo cards lying on the map (scene units)
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
const loadTex = (url, srgb = true) => texLoader.loadAsync(url).then((t) => {
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(LOW ? 4 : 8, maxAniso);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  ALL_TEX.push(t);
  return t;
});
function getJSON(url) { extraTotal++; updateProgress(); return fetch(url).then((r) => r.json()).then((j) => { extraDone++; updateProgress(); return j; }); }
function loadImg(url) { extraTotal++; return new Promise((res, rej) => { const i = new Image(); i.onload = () => { extraDone++; updateProgress(); res(i); }; i.onerror = rej; i.src = url; }); }
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(LOW ? 4 : 8, maxAniso);
  ALL_TEX.push(t);
  return t;
}

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
   People on the map: plain photo cards (no books)
   ========================================================= */
const pins = [];
let PERSONS = [];

// Contemporary people (1950–2026) are read from modern.json and placed on the map by `geo`.
// They are AI-guide personas: third person, never "I am <real person>".
let MODERN = [];
const GUIDE_VOICE = { male: 'Vp3gaOLjssOTvqcooFwg', female: 'QpQ3ApUOdmaUcNblVLGC' };   // library voices already used here — NOT clones of real people
// The 23 historical figures are shown by default again; they can still be hidden from the select screen.
const HIST_ON = (() => { try { return localStorage.getItem('kz_hist') !== '0'; } catch (e) { return true; } })();
const allPeople = () => MODERN.concat(HIST_ON ? PERSONS : []);
function latLonToPx(lat, lon) {                                   // inverse of pxLat/pxLon (web-mercator tile grid used by the map)
  const n = 2 ** META.z, x = (lon + 180) / 360 * n, y = (1 - Math.log(Math.tan(lat * DEG) + 1 / Math.cos(lat * DEG)) / Math.PI) / 2 * n;
  return [x * 256 - META.gx0, y * 256 - META.gy0];
}
const imgOf = (p) => p.img || `img/${p.id}.jpg`;
const hiOf = (p) => p.img_hi || (p.modern ? `img_hi/${p.id}.jpg` : imgOf(p));
async function loadModern() {
  if (MODERN.length) return;
  try {
    const r = await fetch('modern.json', { cache: 'no-cache' }); if (!r.ok) return;
    const list = await r.json(); if (!Array.isArray(list)) return;
    MODERN = list.filter((p) => p && p.id && p.name && p.mouth).map((p) => ({
      ...p, modern: true, lang: p.lang === 'ru' ? 'ru' : 'kk', years: p.years || '', region: p.region || '',
      voice: p.voice || (p.female ? GUIDE_VOICE.female : GUIDE_VOICE.male), speed: p.speed || 1,
    }));
    MODERN.forEach((p) => {                                        // map position from lat/lon (needs META, i.e. after buildKazakhstan)
      if (Array.isArray(p.geo) && typeof META !== 'undefined' && META) { [p.px, p.py] = latLonToPx(p.geo[0], p.geo[1]); p.h = heightAtPx(p.px, p.py); }
    });
  } catch (e) { console.warn('modern.json not loaded', e); }
}
function wrapText(g, text, maxW) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function photoTexture(p, img) {
  const W = 480, H = Math.round(480 * CARD_H / CARD_W), B = 12;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // white photo-print border with a thin gold outline
  rrect(g, 0, 0, W, H, 22); g.fillStyle = '#ffffff'; g.fill();
  g.save(); rrect(g, B, B, W - 2 * B, H - 2 * B, 14); g.clip();
  const iw0 = W - 2 * B, ih0 = H - 2 * B;
  if (img) {
    const r = Math.max(iw0 / img.width, ih0 / img.height), iw = img.width * r, ih = img.height * r;
    g.drawImage(img, B + (iw0 - iw) / 2, B + Math.min(0, (ih0 - ih) * 0.2), iw, ih);   // keep the face near the top
  } else { g.fillStyle = '#0b5266'; g.fillRect(B, B, iw0, ih0); }
  // name strip over the bottom of the photo
  const sh = g.createLinearGradient(0, H * 0.58, 0, H);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.82)');
  g.fillStyle = sh; g.fillRect(B, H * 0.58, iw0, H * 0.42);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '700 40px "PT Serif", Georgia, serif';
  let lines = wrapText(g, p.name, W - 70);
  if (lines.length > 2) { g.font = '700 34px "PT Serif", Georgia, serif'; lines = wrapText(g, p.name, W - 70).slice(0, 2); }
  const lh = lines.length > 1 ? 40 : 0;
  let y = H - B - 46 - lh;
  g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
  lines.forEach((l) => { g.fillText(l, W / 2, y); y += 40; });
  g.font = '400 22px "PT Sans", system-ui, sans-serif'; g.fillStyle = '#ffe08a';
  g.fillText(p.years || '', W / 2, H - B - 18);
  g.restore();
  rrect(g, 3, 3, W - 6, H - 6, 20); g.strokeStyle = '#c9a227'; g.lineWidth = 4; g.stroke();
  const tw = LOW ? 256 : 384;
  const sm = document.createElement('canvas'); sm.width = tw; sm.height = Math.round(tw * H / W);
  sm.getContext('2d').drawImage(c, 0, 0, sm.width, sm.height);
  return canvasTex(sm);
}
function softRectTexture(color, blur) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d'); g.filter = `blur(${blur}px)`; g.fillStyle = color;
  rrect(g, 40, 40, 176, 240, 16); g.fill();
  return canvasTex(c);
}


async function buildPins() {
  PERSONS = await getJSON('persons.json');
  await loadModern();
  const people = allPeople().filter((p) => Number.isFinite(p.px) && Number.isFinite(p.py));
  try { await Promise.all([document.fonts.load('700 40px "PT Serif"'), document.fonts.load('400 22px "PT Sans"')]); } catch (e) {}
  const imgs = await Promise.all(people.map((p) => loadImg(imgOf(p)).catch(() => null)));

  // relax overlapping photos in map-pixel space (axis-aligned footprints)
  const items = people.map((p) => {
    const upp = 0.0806 * (R / 420) * Math.cos(pxLat(p.py) * DEG);   // scene units per map pixel
    return { p, x: p.px, y: p.py, ox: p.px, oy: p.py, hw: (CARD_W / upp) / 2 + 6, hh: (CARD_H / upp) / 2 + 6 };
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

  const photoGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const shadowGeo = new THREE.PlaneGeometry(CARD_W * 1.4, CARD_H * 1.4);
  const shadowMat = new THREE.MeshBasicMaterial({ map: softRectTexture('rgba(10,25,35,1)', 18), transparent: true, opacity: 0.4, depthWrite: false });
  const glowMat0 = new THREE.MeshBasicMaterial({ map: softRectTexture('rgba(254,197,12,1)', 22), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pinGeo = new THREE.CircleGeometry(0.32, 24), ringGeo = new THREE.RingGeometry(0.5, 0.75, 40);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xfec50c, toneMapped: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.9 });

  items.forEach((it, i) => {
    const p = it.p;
    // footprint height: highest terrain under the photo
    let hmax = H_MIN;
    for (const [fx, fy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) hmax = Math.max(hmax, heightAtPx(it.x + fx * it.hw * 0.9, it.y + fy * it.hh * 0.9));
    const lat = pxLat(it.y), lon = pxLon(it.x);
    const { n, e, no } = basisAt(lat, lon);
    const base = new THREE.Group();
    base.position.copy(sph(lat, lon, rTop(hmax) + 0.05));
    base.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e, no, n));
    const lift = new THREE.Group(); base.add(lift);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.set(0.3, 0.4, 0.02); base.add(shadow);
    const glow = new THREE.Mesh(shadowGeo, glowMat0.clone()); glow.position.z = 0.03; base.add(glow);
    const photo = new THREE.Mesh(photoGeo, new THREE.MeshBasicMaterial({ map: photoTexture(p, imgs[i]), transparent: true, alphaTest: 0.5, toneMapped: false }));
    photo.position.z = 0.12; lift.add(photo);
    photo.userData.index = pins.length;
    globe.add(base);

    // pin at the exact place + leader line when the photo had to move aside
    const truLat = pxLat(p.py), truLon = pxLon(p.px), tb = basisAt(truLat, truLon);
    const pin = new THREE.Group(); pin.position.copy(sph(truLat, truLon, rTop(heightAtPx(p.px, p.py)) + 0.06));
    pin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tb.e, tb.no, tb.n));
    pin.add(new THREE.Mesh(pinGeo, pinMat));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfec50c, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    ring.position.z = 0.01; pin.add(ring);
    globe.add(pin);
    if (Math.hypot(it.x - p.px, it.y - p.py) > 6) {
      const lg = new THREE.BufferGeometry().setFromPoints([pin.position.clone(), base.position.clone().add(n.clone().multiplyScalar(0.05))]);
      globe.add(new THREE.Line(lg, lineMat));
    }
    pins.push({ p, base, lift, photo, glow, ring, hover: 0 });
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
    const opCss = labelOpacityCss(o);
    const tx = ((proj.x + 1) / 2 * W).toFixed(1);
    const ty = ((1 - proj.y) / 2 * H).toFixed(1);
    const xf = `translate3d(${tx}px, ${ty}px, 0) translate(-4px, -50%)`;
    c.vis = true;
    if (c._op !== opCss) { c.el.style.opacity = opCss; c._op = opCss; }
    if (c._xf !== xf) { c.el.style.transform = xf; c._xf = xf; }
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
const uiSfx = makeSfx();
function goToMap() {
  hideHint();
  const fromGlobe = mode === 'globe';
  if (fromGlobe) teleport({ title: lang === 'ru' ? 'КАЗАХСТАН' : 'ҚАЗАҚСТАН', subtitle: lang === 'ru' ? 'Великие личности' : 'Ұлы тұлғалар', sfx: () => uiSfx.warp() });
  flyTo(mapView(), fromGlobe ? 1500 : 1100, () => { setMode('map'); dirty = true; });
}
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
    if (off.length() < R + 300 && above > 0.86) { goToMap(); return false; }
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
  const hit = ray.intersectObjects(pins.map((b) => b.photo), false)[0];
  return hit ? pins[hit.object.userData.index] : null;
}
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (talkOpen || ev.pointerType === 'touch') return;
  const now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
  const b = mode === 'map' ? pick(ev) : null; hovered = b;
  renderer.domElement.style.cursor = b ? 'pointer' : 'grab';
  if (b) { tip.innerHTML = ''; tip.append(b.p.name); const sm = document.createElement('small'); sm.textContent = `${b.p.years} · ${b.p.region}`; tip.append(sm);
    tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px'; tip.style.opacity = 1; } else tip.style.opacity = 0;
});
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; hideHint(); });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || talkOpen) return;
  if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) < 7 && performance.now() - downAt.t < 650) { const b = pick(ev); if (b) focusPin(b); }
  downAt = null;
});
renderer.domElement.addEventListener('dblclick', (ev) => {
  if (mode === 'globe') goToMap();
});
renderer.domElement.addEventListener('wheel', hideHint, { passive: true });
function hideHint() { $('hint').classList.add('gone'); }

function focusPin(b) {
  tip.style.opacity = 0; hovered = null;
  const wp = new THREE.Vector3(); b.photo.getWorldPosition(wp);
  const up = wp.clone().sub(GLOBE_CENTER).normalize();
  const pos = wp.clone().add(up.multiplyScalar(13)).add(new THREE.Vector3(0, 0, 7.5));
  flyTo({ pos, target: wp, mode: 'map' }, 1200, () => { setMode('map'); openTalk(b.p); });
  closePanel();
}
$('home-btn').addEventListener('click', () => goToMap());
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
      goToMap(); return;
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
$('q-btn').title = LOW ? 'Performance mode / Өнімділік режимі' : 'Adaptive high quality, up to 4K / 4K дейін';
$('q-btn').addEventListener('click', () => {
  const next = LOW ? 'high' : 'medium';
  try { localStorage.setItem('kz_quality', next); } catch (e) {}
  location.reload();
});

const panel = $('panel');
function closePanel() { panel.classList.remove('open'); }
$('list-toggle').addEventListener('click', () => panel.classList.toggle('open'));
function renderList(filter = '') {
  const f = filter.trim().toLowerCase(), groups = {};
  allPeople().forEach((p) => { if (f && !(p.name + ' ' + p.name_ru + ' ' + (p.region || '')).toLowerCase().includes(f)) return; const g = (p.region || '—').split(',')[0].trim(); (groups[g] = groups[g] || []).push(p); });
  const list = $('list'); list.innerHTML = '';
  Object.keys(groups).sort((a, b) => a.localeCompare(b, 'kk')).forEach((g) => {
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; list.appendChild(h);
    groups[g].forEach((p) => {
      const b = document.createElement('button'); b.className = 'item';
      b.innerHTML = '<img alt="" loading="lazy"><div><div class="n"></div><div class="y"></div></div>';
      b.querySelector('img').src = imgOf(p); b.querySelector('.n').textContent = p.name; b.querySelector('.y').textContent = `${p.years} · ${p.region}`;
      b.addEventListener('click', () => pickPerson(p));
      list.appendChild(b);
    });
  });
  if (!list.children.length) list.innerHTML = '<div class="grp" style="text-transform:none;letter-spacing:0">Ештеңе табылмады</div>';
}
$('search').addEventListener('input', (e) => { renderList(e.target.value); panel.classList.add('open'); });

// Everyone with a place on the map: the camera flies to their photo first, then the conversation opens.
function pickPerson(p) {
  const b = pins.find((x) => x.p.id === p.id);
  if (b) { focusPin(b); return; }
  tip.style.opacity = 0; hovered = null; closePanel(); openTalk(p);
}
let selecting = false;
const selectUI = initSelect({
  getPeople: allPeople, imgOf, hiOf, getUiLang: () => lang, onPick: pickPerson, historyOn: HIST_ON,
  onToggleHistory: () => { try { localStorage.setItem('kz_hist', HIST_ON ? '0' : '1'); } catch (e) {} location.reload(); },
  onOpen: () => { selecting = true; closePanel(); }, onClose: () => { selecting = false; dirty = true; },
});
$('select-btn').addEventListener('click', () => selectUI.open());

/* =========================================================
   Person card + ElevenLabs live conversation
   ========================================================= */
let talkOpen = false, current = null, lang = 'kk';
const histories = {};
const overlay = $('talk-overlay'), log = $('chat-log'), statusEl = $('status'), wave = $('wave');
const cleanText = (t) => (t || '').replace(/<\/?[a-z_]{1,32}>\s*/gi, '').replace(/\[[^\]]{1,40}\]\s*/g, '').trim();
function addMsg(role, text) {
  const d = document.createElement('div'); d.className = `msg ${role === 'user' ? 'u' : 'a'}`; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
const nameFor = (p) => (lang === 'ru' ? p.name_ru : p.name);
function setStatus(t) { statusEl.textContent = t || ''; }

const greetOf = (p) => !p.modern ? p.greet : (lang === 'ru'
  ? `Здравствуйте! Я ИИ-гид и расскажу о человеке: ${p.name_ru}${p.field_ru ? ' — ' + p.field_ru.toLowerCase() : ''}. Что вам интересно?`
  : `Сәлеметсіз бе! Мен — AI-гидпін, ${p.name} туралы айтып беремін${p.field_kk ? ' (' + p.field_kk.toLowerCase() + ')' : ''}. Не білгіңіз келеді?`);

// Contemporaries: the model is a guide ABOUT the person, never the person (no impersonation / invented quotes).
function buildGuidePrompt(p) {
  const ru = lang === 'ru', living = p.living !== false;
  const facts = (ru ? (p.bio_ru || p.bio) : p.bio) || '', role = (ru ? p.field_ru : p.field_kk) || '', name = ru ? p.name_ru : p.name;
  const hist = (histories[p.id] || []).slice(-10).map((m) => `${m.role === 'user' ? (ru ? 'Пользователь' : 'Қолданушы') : 'Гид'}: ${m.content}`).join('\n');
  if (ru) return `Ты — голосовой ИИ-гид проекта «Великие личности Казахстана», рассказ о человеке: ${name} (${p.years}, ${role}). Ты НЕ этот человек и не говоришь от его/её лица — рассказываешь о нём/ней в третьем лице, живо и тепло. Никогда не говори «я — ${name}». Если спросят, честно скажи, что это синтезированный голос ИИ-гида, а не реальный человек. Пиши ответ только обычным текстом: никогда не используй теги вида <abai>, <default> или любые другие <...>.
Проверенные факты: ${facts}
Называй только общеизвестные, проверенные факты. Если не знаешь или не уверен — скажи «точно не знаю»; не выдумывай даты, результаты, цифры и цитаты и не приписывай человеку слов, которых он не говорил. ${living ? 'Это живой человек: не обсуждай личную жизнь, здоровье, семью, политику и скандалы, не строй догадок; на такие вопросы вежливо возвращай разговор к достижениям.' : 'Не строй догадок о семье и личной жизни ушедшего человека.'}
Ответ короткий: 1–3 предложения, в первом сразу ответ на вопрос. Без списков и эмодзи. Говори только по-русски.${hist ? '\n\nПредыдущий разговор:\n' + hist : ''}`;
  return `Сен — «Қазақстанның ұлы тұлғалары» жобасының дауыстық AI-гидісің, әңгіме тақырыбы: ${name} (${p.years}, ${role}). Сен ол адам емессің және оның атынан сөйлемейсің — ол туралы үшінші жақта, жанды әрі жылы айтасың. «Мен — ${name}» деп ешқашан айтпа. Сұраса, адал айт: бұл — AI-гидтің жасанды дауысы, нақты адам емес. Жауапты тек кәдімгі мәтінмен жаз: <abai>, <default> немесе басқа кез келген <...> тегтерін ешқашан қолданба.
Расталған деректер: ${facts}
Тек жалпыға белгілі, расталған фактілерді айт. Білмесең немесе сенімсіз болсаң — «Нақты білмеймін» де; жылдарды, нәтижелерді, сандарды, дәйексөздерді ойдан шығарма және оған айтпаған сөзді тақпа. ${living ? 'Бұл тірі адам: жеке өмірі, денсаулығы, отбасы, саясат пен дау-дамай туралы әңгімелеме, болжам айтпа; мұндай сұраққа сыпайы түрде оның еңбегі мен жетістіктеріне оралт.' : 'Қайтыс болған адамның отбасы мен жеке өмірі туралы болжам айтпа.'}
Жауап қысқа: 1–3 сөйлем, бірінші сөйлемде сұраққа тікелей жауап бер. Тізім мен эмодзи қолданба. Тек қазақ тілінде сөйле.${hist ? '\n\nАлдыңғы әңгіме:\n' + hist : ''}`;
}

function buildPrompt(p) {
  if (p.modern) return buildGuidePrompt(p);
  const rule = (lang === 'kk' ? 'Тек қазақ тілінде сөйле. ' + "Жауапты тек кәдімгі мәтінмен жаз: <abai>, <default> немесе басқа кез келген <...> тегтерін ешқашан қолданба." : 'Говори только по-русски; можно вставлять казахские обращения (балам, шырағым). ' + "Пиши ответ только обычным текстом: никогда не используй теги вида <abai>, <default> или любые другие <...>.");
  const hist = (histories[p.id] || []).slice(-10).map((m) => `${m.role === 'user' ? 'Ұрпақ' : 'Сен'}: ${m.content}`).join('\n');
  return `Сен — ${p.name} (${p.years}), ${p.region} өңірімен байланысты тарихи тұлға. Өмірбаяның қысқаша: ${p.bio}
Сен тірі ${p.name} сияқты сөйлейсің: өз мінезіңмен, өз дәуіріңнің сөзімен, өз өмір тәжірибеңмен, бірінші жақпен ("мен"). Бейнеден шықпа, өзіңді ассистент, модель, бот деп атама. Тек адам шын ниетпен "сен ЖИ-сің бе?" деп сұраса ғана, бұл тарихи бейненің қайта жаңғыртылған дауысы екенін бір сөйлеммен мойында да, әңгімені сол бейнеде жалғастыр.
Сенімен 2026 жылы өмір сүріп жатқан қазақ ұрпағы тірідей, дауыспен сөйлесіп отыр. Жылы, бірақ шыншыл бол: қалай өмір сүру керектігін айт, ақыл бер, ұрпақтың сенің өсиетіңді орындамай жүрген тұстарын әдеппен, бірақ ашық сына.
Өз шығармаларың мен өміріңнен тек нақты білетін деректерді айт; сенімді болмасаң дәйексөзді ойдан шығарма. Өзің қайтыс болғаннан кейінгі оқиғалар туралы сұраса — таңғала, өз көзқарасыңнан баға бер.
Жауап қысқа болсын: әдетте 1–3 сөйлем, ауызша айтуға ыңғайлы. Бірінші сөйлемде сұраққа тікелей жауап бер; сұрақты қайталап оқыма және әр жауапта қайта амандаспа. Толығырақ түсіндіруді сұраса ғана кеңейт. Тізім, эмодзи қолданба. Әңгімені жалғастыру үшін кейде өзің де сұрақ қой.
Зиянды не қауіпті нәрсе сұраса — өз мінезіңде қалып, ақылмен бас тарт.
${rule}${hist ? '\n\nОсыған дейінгі әңгімелерің:\n' + hist : ''}`;
}

let session = null, sessionKind = null, connecting = false, pendingTexts = [], sessionEpoch = 0;

/* ---- Minimal ElevenLabs Agents client (WebSocket protocol) ----
   • audio replies are played for BOTH typed and spoken questions
   • microphone is only requested in voice mode                     */
let sharedCtx = null;
function audioCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}
// Direct streaming STT + response + voice in one ElevenLabs session.
// Migrate away from the old browser-stored Gemini key / serial transcription path.
try {
  localStorage.removeItem('kz_gemini_key');
  if (/[#&]gk=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
} catch {}
async function endSession({ keepPending = false } = {}) {
  sessionEpoch++;
  const s = session; session = null; sessionKind = null; connecting = false;
  if (!keepPending) pendingTexts = [];
  clearTimeout(replyTimer); typingOff();
  $('live-btn').classList.remove('on', 'connecting'); $('live-label').textContent = liveLabel();
  avatar && avatar.setTalk && avatar.setTalk(false); wave.classList.remove('on', 'listen');
  if (s) { try { await s.endSession(); } catch {} }
}
window.addEventListener('pagehide', () => { endSession(); sharedCtx?.suspend(); });
const liveLabel = () => (session && sessionKind === 'voice' ? (lang === 'ru' ? 'Завершить разговор' : 'Сөйлесуді аяқтау') : (lang === 'ru' ? 'Говорить голосом' : 'Дауыспен сөйлесу'));

// Add ?debug to the URL to show request → first-audio timings (hidden for normal visitors).
const DEBUG_LATENCY = new URLSearchParams(location.search).has('debug');
const latencySamples = [];
function showLatency(kind, ms) {
  latencySamples.push(ms); if (latencySamples.length > 20) latencySamples.shift();
  let el = document.getElementById('latency-debug');
  if (!el) {
    el = document.createElement('div'); el.id = 'latency-debug';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.72);color:#fff;font:12px/1.4 monospace;pointer-events:none';
    document.body.appendChild(el);
  }
  const sorted = [...latencySamples].sort((a, b) => a - b);
  el.textContent = `${kind}: ${ms} ms · median ${sorted[Math.floor(sorted.length / 2)]} ms · n=${sorted.length}`;
}
let replyTimer = 0;
function waitForReply() {
  typingOn(); clearTimeout(replyTimer);
  setStatus(lang === 'ru' ? 'Готовит ответ…' : 'Жауап дайындап жатыр…');
  const token = sessionEpoch;
  replyTimer = setTimeout(() => {
    if (token !== sessionEpoch) return;
    typingOff(); setStatus(lang === 'ru' ? 'Ответ задерживается. Можно повторить вопрос или переподключиться.' : 'Жауап кешігіп жатыр. Сұрақты қайталауға не қайта қосылуға болады.');
  }, 20000);
}
async function startSession(kind) {
  if (!current || connecting) return;
  audioCtx();
  const closing = endSession({ keepPending: true });
  const token = sessionEpoch, p = current;
  connecting = true;
  await closing;
  if (token !== sessionEpoch || current !== p) return;
  $('newtab-btn').hidden = !IN_IFRAME;
  $('live-btn').classList.toggle('connecting', kind === 'voice');
  $('live-label').textContent = lang === 'ru' ? 'Отменить подключение' : 'Қосылуды тоқтату';
  setStatus(lang === 'ru' ? 'Подключение…' : 'Қосылып жатыр…');
  const h = histories[p.id];
  const active = () => token === sessionEpoch && current === p;
  let transportError = null;
  const s = new AgentSession({
    agentId: AGENT_ID, audioContext: audioCtx,
    override: {
      // Greeting stays visible in the chat; do not read it before listening.
      agent: { prompt: { prompt: buildPrompt(p) }, first_message: '', language: lang },
      tts: { voice_id: p.voice, speed: p.speed || 1 },
    },
    onError: error => { transportError = error; },
    onLatency: ({ kind, ms }) => {
      if (!active()) return;
      console.info(`[latency] ${kind}: ${ms} ms`);
      if (DEBUG_LATENCY) showLatency(kind, ms);
    },
    onDisconnect: () => {
      if (!active()) return;
      endSession();
      setStatus(transportError ? (lang === 'ru' ? 'Ошибка голосовой связи. Подключитесь снова.' : 'Дауыс байланысында қате. Қайта қосылыңыз.') : (lang === 'ru' ? 'Разговор завершён.' : 'Сөйлесу аяқталды.'));
    },
    onInterruption: () => { if (active()) { clearTimeout(replyTimer); typingOff(); } },
    onModeChange: ({ mode: m }) => {
      if (!active()) return;
      const speaking = m === 'speaking';
      if (speaking) { clearTimeout(replyTimer); typingOff(); }
      avatar.setTalk(speaking);
      wave.classList.toggle('on', speaking || kind === 'voice'); wave.classList.toggle('listen', !speaking && kind === 'voice');
      setStatus(speaking ? (lang === 'ru' ? 'Говорит…' : 'Сөйлеп тұр…') : (kind === 'voice' ? (lang === 'ru' ? 'Слушает вас…' : 'Сізді тыңдап тұр…') : ''));
    },
    onMessage: ({ source, message }) => {
      if (!active()) return;
      const txt = cleanText(message); if (!txt) return;
      if (source === 'ai') {
        clearTimeout(replyTimer); typingOff(); h.push({ role: 'assistant', content: txt }); addMsg('assistant', txt);
      } else { h.push({ role: 'user', content: txt }); addMsg('user', txt); waitForReply(); }
    },
  });
  session = s; sessionKind = kind;
  try {
    await s.start(kind === 'voice');
    if (!active()) { await s.endSession(); return; }
    connecting = false;
    setStatus(kind === 'voice' ? (lang === 'ru' ? 'Говорите — я слушаю' : 'Сөйлей беріңіз — тыңдап тұрмын') : '');
    $('live-btn').classList.remove('connecting');
    $('live-btn').classList.toggle('on', kind === 'voice'); $('live-label').textContent = liveLabel();
    if (kind === 'voice') wave.classList.add('on', 'listen');
    const queued = pendingTexts; pendingTexts = [];
    queued.forEach(sendText);
  } catch (error) {
    await s.endSession();
    if (!active()) return;
    endSession();
    if (error.name === 'AbortError') return;
    if (/NotAllowed|Permission|Security/i.test(error.name + ' ' + error.message)) {
      setStatus(lang === 'ru' ? 'Разрешите микрофон в браузере или напишите вопрос.' : 'Браузерде микрофонға рұқсат беріңіз немесе сұрақты жазыңыз.');
      $('newtab-btn').hidden = !IN_IFRAME;
    } else setStatus(lang === 'ru' ? 'Не удалось подключиться. Проверьте сеть и попробуйте снова.' : 'Қосылу мүмкін болмады. Желіні тексеріп, қайта қосылыңыз.');
  }
}
let typingEl = null;
function typingOn() { if (typingEl) return; typingEl = document.createElement('div'); typingEl.className = 'msg a typing'; typingEl.innerHTML = '<span></span><span></span><span></span>'; log.appendChild(typingEl); log.scrollTop = log.scrollHeight; }
function typingOff() { if (typingEl) { typingEl.remove(); typingEl = null; } }
function sendText(t) {
  const p = current; if (!p) return;
  if (!session || connecting) {
    if (pendingTexts.length >= 10) { setStatus(lang === 'ru' ? 'Дождитесь подключения.' : 'Қосылуды күтіңіз.'); return; }
    pendingTexts.push(t); if (!connecting) startSession('text'); return;
  }
  try {
    session.sendUserMessage(t);
    histories[p.id].push({ role: 'user', content: t }); addMsg('user', t); waitForReply();
  } catch { typingOff(); setStatus(lang === 'ru' ? 'Сообщение не отправлено. Переподключитесь.' : 'Хабар жіберілмеді. Қайта қосылыңыз.'); }
}
$('text-form').addEventListener('submit', (e) => { e.preventDefault(); audioCtx(); const v = $('text-input').value.trim(); $('text-input').value = ''; if (v) sendText(v); });
$('live-btn').addEventListener('click', () => {
  if (connecting || (session && sessionKind === 'voice')) { endSession(); setStatus(lang === 'ru' ? 'Разговор остановлен.' : 'Сөйлесу тоқтатылды.'); }
  else startSession('voice');
});
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
  const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: !LOW, powerPreference: 'high-performance' });
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
  let mouth = null, open = 0, talk = 0, fake = 0, ready = false, speakingOn = false, lastDraw = 0;
  function load(p) {
    ready = false; mouth = p.mouth;
    const img = new Image(); img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); ready = true; };
    img.src = imgOf(p);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!shouldRenderWhileHidden(document.hidden)) return;
    if (!talkOpen || !ready) return;
    let target = 0;
    if (talk > 0) {
      let vol = 0; try { vol = session && sessionKind === 'voice' ? session.getOutputVolume() : 0; } catch (e) {}
      const syl = 0.55 + 0.45 * Math.abs(Math.sin(now / 75) * Math.sin(now / 190 + 1.3));
      target = Math.min(1, (vol > 0.002 ? vol * 3.2 : 0.55) * syl);
    }
    if (fake > now) { const syl = Math.abs(Math.sin(now / 80) * Math.sin(now / 210 + 0.7)); target = Math.max(target, 0.25 + 0.6 * syl); }
    const idle = talk <= 0 && fake <= now && open < 0.01 && target < 0.01;
    if (idle && lastDraw && now - lastDraw < 200) return;
    open += (target - open) * 0.35;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform1f(uT, now / 1000); gl.uniform1f(uOp, open);
    gl.uniform1f(uHas, mouth ? 1 : 0);
    gl.uniform4f(uM, mouth ? mouth.x : 0.5, mouth ? mouth.y : 0.5, mouth ? mouth.w : 0.1, 0);
    gl.uniform1f(uFH, mouth ? mouth.fh : 0.3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    lastDraw = now;
    const on = open > 0.08;
    if (on !== speakingOn) { speakingOn = on; $('portrait-wrap').classList.toggle('speaking', on); }
  }
  requestAnimationFrame(frame);
  return { load, setTalk(on) { talk = on ? 1 : 0; }, pulse(text) { fake = performance.now() + Math.min(14000, 900 + (text || '').length * 55); } };
})();

function openTalk(p) {
  current = p; talkOpen = true; document.body.classList.add('reading');
  if (p.modern) setLangUI(p.lang);                       // each person opens in the language they are known for
  const bigScreen = Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1) >= 2400, leftImg = $('left-img');
  leftImg.onerror = () => { leftImg.onerror = null; leftImg.src = imgOf(p); };
  leftImg.src = bigScreen ? hiOf(p) : imgOf(p);
  avatar.load(p);
  const cr = document.querySelector('.credit-small');           // CC BY / CC BY-SA need the author named next to the photo
  if (cr) cr.textContent = p.modern && p.photo
    ? `Сурет: ${p.photo.author}, ${p.photo.license} (Wikimedia Commons) · Дауыс жасанды (ElevenLabs) — нақты адамның дауысы емес`
    : 'Сурет: Wikimedia Commons / Wikipedia · Дауыс: ElevenLabs';
  $('left-name').textContent = nameFor(p); $('talk-name').textContent = nameFor(p);
  $('left-years').textContent = p.years; $('left-region').textContent = p.region; $('left-bio').textContent = p.bio;
  let mh = $('talk-main').querySelector('.mobile-head');
  if (!mh) { mh = document.createElement('div'); mh.className = 'mobile-head'; $('talk-main').insertBefore(mh, $('talk-main').querySelector('.talk-head')); }
  mh.innerHTML = '<img alt=""><div><div class="n"></div><div class="y"></div><div class="b"></div></div>';
  mh.querySelector('img').src = imgOf(p); mh.querySelector('.n').textContent = p.name;
  mh.querySelector('.y').textContent = `${p.years} · ${p.region}`; mh.querySelector('.b').textContent = p.bio;
  log.innerHTML = ''; typingEl = null;
  const oldNote = $('ai-note'); if (oldNote) oldNote.remove();
  if (!histories[p.id]) histories[p.id] = [{ role: 'assistant', content: greetOf(p) }];
  histories[p.id].forEach((m) => addMsg(m.role, m.content));
  setStatus(lang === 'ru' ? 'Нажмите «Говорить голосом», чтобы начать живой разговор' : '«Дауыспен сөйлесу» батырмасын басып, тірідей сөйлесіңіз');
  $('newtab-btn').hidden = !IN_IFRAME;
  $('live-label').textContent = liveLabel();
  clearTimeout(closeTimer);
  overlay.classList.remove('show', 'closing'); void overlay.offsetWidth;   // restart the opening animation
  overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false');
}
let closeTimer = 0;
function closeTalk() {
  endSession();
  overlay.classList.add('closing'); overlay.setAttribute('aria-hidden', 'true');
  clearTimeout(closeTimer); closeTimer = setTimeout(() => overlay.classList.remove('show', 'closing'), 480);
  talkOpen = false; document.body.classList.remove('reading');
  const t = controls.target.clone();
  const back = new THREE.Vector3().subVectors(camera.position, t).normalize().multiplyScalar(70).add(t);
  back.y = Math.max(back.y, t.y + 40);
  flyTo({ pos: back, target: t, mode: 'map' }, 1100, () => setMode('map'));
}
$('talk-close').addEventListener('click', closeTalk);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTalk(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && talkOpen) closeTalk(); });
function setLangUI(l) {
  lang = l === 'ru' ? 'ru' : 'kk';
  document.querySelectorAll('.lang button').forEach((x) => x.classList.toggle('on', x.dataset.lang === lang));
  if (current) { $('left-name').textContent = nameFor(current); $('talk-name').textContent = nameFor(current); }
  $('text-input').placeholder = lang === 'ru' ? 'Или напишите вопрос…' : 'Немесе жазып сұраңыз…';
}
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  if (lang === b.dataset.lang) return;
  lang = b.dataset.lang;
  document.querySelectorAll('.lang button').forEach((x) => x.classList.toggle('on', x === b));
  if (current) { $('left-name').textContent = nameFor(current); $('talk-name').textContent = nameFor(current); }
  $('text-input').placeholder = lang === 'ru' ? 'Или напишите вопрос…' : 'Немесе жазып сұраңыз…';
  const wasVoice = session && sessionKind === 'voice';
  const stop = endSession(), token = sessionEpoch;
  stop.then(() => { if (wasVoice && talkOpen && token === sessionEpoch) startSession('voice'); });
}));

/* =========================================================
   Render loop (adaptive resolution, paused behind the conversation card)
   ========================================================= */
const clock = new THREE.Clock();
let frames = 0, acc = 0, slow = 0, fast = 0, frozen = false, pageHidden = false, measuringFrames = false;
function adapt(dt) {
  frames++; acc += dt; if (acc < 1) return;
  const fps = frames / acc; frames = 0; acc = 0;
  const next = stepDpr(dpr, fps, { dprMax: DPR_MAX, dprMin: Math.min(0.5, DPR_MAX), slowStreak: slow, fastStreak: fast });
  slow = next.slow; fast = next.fast;
  if (next.changed) { dpr = next.dpr; renderer.setPixelRatio(dpr); dirty = true; }
}
let dirty = true;
const markDirty = () => { dirty = true; };
controls.addEventListener('change', markDirty);
document.addEventListener('visibilitychange', () => {
  pageHidden = document.hidden; frames = acc = slow = fast = 0; measuringFrames = false;
  if (!pageHidden) { dirty = true; clock.getDelta(); }
});
function animate() {
  if (!shouldRenderWhileHidden(pageHidden || document.hidden)) return;
  const dt = clock.getDelta();
  if ((talkOpen || selecting) && !flight) { frames = acc = slow = fast = 0; measuringFrames = false; if (!frozen || dirty) { renderer.render(scene, camera); frozen = true; dirty = false; } return; }
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
  for (const b of pins) {
    const goal = b === hovered ? 1 : 0;
    if (Math.abs(goal - b.hover) > 0.002) {
      b.hover += (goal - b.hover) * 0.2; active = true;
      b.lift.position.z = b.hover * 0.9; b.lift.scale.setScalar(1 + b.hover * 0.07); b.glow.material.opacity = b.hover * 0.9;
    }
  }
  if (!dirty && !active) { frames = acc = slow = fast = 0; measuringFrames = false; return; } // on-demand idle
  dirty = false;
  updateLabels();
  renderer.render(scene, camera);
  if (measuringFrames) adapt(dt);
  measuringFrames = true;
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  DPR_MAX = dprCap(window.devicePixelRatio || 1, QUALITY, { width: innerWidth, height: innerHeight, maxDimension: maxTex });
  dpr = Math.min(dpr, DPR_MAX); frames = acc = slow = fast = 0; measuringFrames = false;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  dirty = true;
});

/* =========================================================
   Boot
   ========================================================= */
(async function boot() {
  try {
    await buildKazakhstan();
    await Promise.all([buildGlobe(), buildPins(), buildCities()]);
    await loadModern(); renderList(); $('count').textContent = allPeople().length;
    if (/[?&]debug\b/.test(location.search)) window.__kz = { pins, people: allPeople };
    const gv = globeView(4.6);
    camera.position.copy(gv.pos); controls.target.copy(gv.target); setMode('globe');
    renderer.compile(scene, camera);
    ALL_TEX.forEach((t) => { try { renderer.initTexture(t); } catch (e) {} });   // upload all textures now → no freeze later
    renderer.setAnimationLoop(animate);
    $('progress-bar').style.width = '100%'; $('progress-text').textContent = 'Дайын';
    const btn = $('enter-btn'); btn.disabled = false; btn.focus();
    btn.addEventListener('click', () => {
      $('splash').classList.add('hide'); document.body.classList.remove('booting');
      flyTo(globeView(2.6), 1600, () => goToMap());
      setTimeout(hideHint, 10000);
    }, { once: true });
  } catch (e) {
    console.error(e); $('progress-text').textContent = 'Жүктеу қатесі: ' + e.message;
  }
})();
