// "Teleport" overlay: light-speed streaks + a title card + white flash, drawn on its own 2D canvas
// over the 3D scene while the camera flies from the globe down to Kazakhstan. No assets, ~1.4 s.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function teleport({ title = 'ҚАЗАҚСТАН', subtitle = '', duration = 1500, sfx } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div'); wrap.id = 'warp'; wrap.setAttribute('aria-hidden', 'true');
    const cv = document.createElement('canvas'); wrap.append(cv);
    const card = document.createElement('div'); card.className = 'warp-card';
    const h = document.createElement('b'); h.textContent = title; const s = document.createElement('span'); s.textContent = subtitle;
    card.append(h, s); wrap.append(card); document.body.append(wrap);
    if (sfx) sfx();
    if (REDUCED) { wrap.classList.add('calm'); setTimeout(() => { wrap.remove(); resolve(); }, 650); return; }

    const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const cx = W / 2, cy = H / 2, N = Math.round(Math.min(420, (W * H) / 4200));
    const stars = Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 40 + 4, v: Math.random() * 0.6 + 0.6,
      hue: Math.random() < 0.18 ? 46 : 190, w: Math.random() * 1.6 + 0.6 }));
    const t0 = performance.now(); let raf = 0;
    function frame(now) {
      const k = Math.min(1, (now - t0) / duration);                      // 0..1
      const speed = k < 0.75 ? 0.15 + k * 2.2 : 1.8 * (1 - (k - 0.75) * 2.4);
      g.fillStyle = `rgba(4,10,18,${k < 0.12 ? 0.25 : 0.32})`; g.fillRect(0, 0, W, H);
      const maxR = Math.hypot(W, H) * 0.62;
      for (const st of stars) {
        const r0 = st.r; st.r += st.v * speed * (st.r * 0.09 + 3);
        if (st.r > maxR) { st.r = Math.random() * 30 + 4; continue; }
        const x0 = cx + Math.cos(st.a) * r0, y0 = cy + Math.sin(st.a) * r0, x1 = cx + Math.cos(st.a) * st.r, y1 = cy + Math.sin(st.a) * st.r;
        g.strokeStyle = `hsla(${st.hue},95%,${st.hue === 46 ? 60 : 72}%,${Math.min(1, st.r / 160)})`; g.lineWidth = st.w * (0.6 + k);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      // tunnel glow in the middle: the land is "coming through" it
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * (0.18 + k * 0.5));
      rg.addColorStop(0, `rgba(254,214,90,${0.18 + k * 0.25})`); rg.addColorStop(1, 'rgba(254,214,90,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
      wrap.style.setProperty('--k', k.toFixed(3));
      if (k < 1) raf = requestAnimationFrame(frame);
      else { wrap.classList.add('flash'); setTimeout(() => { wrap.classList.add('out'); }, 120); setTimeout(() => { cancelAnimationFrame(raf); wrap.remove(); }, 720); resolve(); }
    }
    raf = requestAnimationFrame(frame);
  });
}
