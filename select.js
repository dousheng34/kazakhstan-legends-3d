// Character-select screen (fighting-game style): big preview with 3D tilt + grid of portraits.
// Pure UI module: it never talks to the voice agent. app.js decides what "pick" does.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;

const T = {
  kk: { title: 'ТҰЛҒАНЫ ТАҢДА', kicker: 'ҚАЗАҚСТАН · ҰЛЫ ТҰЛҒАЛАР', all: 'Барлығы', modern: 'Замандастар', classic: 'Тарихи тұлғалар',
        pick: 'ТАҢДАУ', close: 'Жабу', ai: 'AI-гид', aiHint: 'Бұл — жасанды интеллект гиді; дауыс нақты адамның дауысы емес.',
        hint: '← ↑ → ↓ таңдау · Enter — ашу · Esc — жабу', kk: 'ҚАЗ', ru: 'РУС', empty: 'Ештеңе табылмады',
        cat: { music: 'Музыка', sport: 'Спорт', science: 'Ғылым', culture: 'Мәдениет' } },
  ru: { title: 'ВЫБЕРИ ЛЕГЕНДУ', kicker: 'КАЗАХСТАН · ВЕЛИКИЕ ЛИЧНОСТИ', all: 'Все', modern: 'Современники', classic: 'Исторические',
        pick: 'ВЫБРАТЬ', close: 'Закрыть', ai: 'ИИ-гид', aiHint: 'Это ИИ-гид; голос — не голос реального человека.',
        hint: '← ↑ → ↓ выбор · Enter — открыть · Esc — закрыть', kk: 'КАЗ', ru: 'РУС', empty: 'Ничего не найдено',
        cat: { music: 'Музыка', sport: 'Спорт', science: 'Наука', culture: 'Культура' } },
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function initSelect({ getPeople, imgOf, hiOf, getUiLang = () => 'kk', onPick, onOpen, onClose }) {
  const root = el('div'); root.id = 'select-screen'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="sel-bg"></div>
    <header class="sel-top">
      <div class="sel-title"><small></small><h2></h2></div>
      <div class="sel-tabs" role="tablist"></div>
      <button type="button" class="sel-close">✕</button>
    </header>
    <main class="sel-main">
      <section class="sel-preview" aria-live="polite">
        <div class="sel-stage"><div class="sel-card3d"><img class="sel-hero" alt=""><i class="sel-glare"></i></div></div>
        <div class="sel-info">
          <div class="sel-badges"></div>
          <h3 class="sel-name"></h3>
          <div class="sel-name2"></div>
          <div class="sel-meta"></div>
          <p class="sel-bio"></p>
          <p class="sel-ai"></p>
          <button type="button" class="sel-go"></button>
        </div>
      </section>
      <section class="sel-grid" role="listbox" tabindex="-1"></section>
    </main>
    <footer class="sel-hint"></footer>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const grid = q('.sel-grid'), hero = q('.sel-hero'), card = q('.sel-card3d');

  let filter = 'all', cat = '', sel = null, list = [], opener = null, openState = false, heroToken = 0, lockTimer = 0, hiTimer = 0;
  const tr = () => T[getUiLang()] || T.kk;
  const nameOf = (p) => (getUiLang() === 'ru' ? p.name_ru : p.name);
  const roleOf = (p) => (p.modern ? (getUiLang() === 'ru' ? p.field_ru : p.field_kk) : (getUiLang() === 'ru' ? 'Историческая личность' : 'Тарихи тұлға')) || '';
  const bioOf = (p) => (getUiLang() === 'ru' && p.bio_ru) ? p.bio_ru : p.bio;

  function visible() {
    return getPeople().filter((p) => (filter === 'all' || (filter === 'modern' ? p.modern : !p.modern)) && (!cat || p.category === cat));
  }

  function renderChrome() {
    const t = tr(), people = getPeople();
    q('.sel-title small').textContent = t.kicker; q('.sel-title h2').textContent = t.title;
    q('.sel-close').setAttribute('aria-label', t.close); q('.sel-hint').textContent = t.hint; q('.sel-go').textContent = t.pick;
    const tabs = q('.sel-tabs'); tabs.innerHTML = '';
    const mk = (id, label, n, isCat) => {
      const b = el('button', 'sel-tab'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.textContent = label; b.append(el('b', '', String(n)));
      const on = isCat ? cat === id : (!cat && filter === id); b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
      b.addEventListener('click', () => { if (isCat) { cat = cat === id ? '' : id; filter = 'modern'; } else { filter = id; cat = ''; } render(); });
      tabs.append(b);
    };
    mk('all', t.all, people.length); mk('modern', t.modern, people.filter((p) => p.modern).length); mk('classic', t.classic, people.filter((p) => !p.modern).length);
    [...new Set(people.filter((p) => p.modern && p.category).map((p) => p.category))].forEach((c) =>
      mk(c, t.cat[c] || c, people.filter((p) => p.category === c).length, true));
  }

  function render() {
    renderChrome();
    list = visible(); grid.innerHTML = '';
    if (!list.length) { grid.append(el('div', 'sel-empty', tr().empty)); sel = null; fillInfo(); return; }
    list.forEach((p) => {
      const b = el('button', 'sel-tile'); b.type = 'button'; b.dataset.id = p.id; b.setAttribute('role', 'option');
      const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = imgOf(p); img.draggable = false;
      const cap = el('span', 'sel-cap'); cap.append(el('b', '', nameOf(p)), el('i', '', p.years || ''));
      b.append(img, el('u', 'sel-corners'), cap);
      if (p.modern) b.append(el('em', 'sel-tag', 'AI'));
      // mouse: hover moves the cursor, click picks. touch: first tap selects, second tap (or the big button) picks.
      b.addEventListener('click', () => { const was = sel && sel.id === p.id; select(p, false); if (!COARSE || was) confirm(); });
      if (!COARSE) b.addEventListener('pointerenter', () => select(p, false));
      grid.append(b);
    });
    if (!sel || !list.some((p) => p.id === sel.id)) select(list[0], false); else select(sel, false);
  }

  function fillInfo() {
    const t = tr(), p = sel;
    root.classList.toggle('empty', !p); if (!p) return;
    q('.sel-name').textContent = nameOf(p);
    q('.sel-name2').textContent = getUiLang() === 'ru' ? p.name : p.name_ru;
    q('.sel-meta').textContent = [p.years, roleOf(p), p.region].filter(Boolean).join(' · ');
    q('.sel-bio').textContent = bioOf(p) || '';
    const badges = q('.sel-badges'); badges.innerHTML = '';
    if (p.modern) badges.append(el('span', 'sel-badge ai', t.ai));
    badges.append(el('span', 'sel-badge lang', (p.lang === 'ru' ? t.ru : t.kk)));
    q('.sel-ai').textContent = p.modern ? t.aiHint : '';
    q('.sel-ai').hidden = !p.modern;
    q('.sel-go').disabled = false;
    root.dataset.cat = p.modern ? 'modern' : 'classic';
  }

  function select(p, scroll = true) {
    if (!p) return;
    const changed = !sel || sel.id !== p.id; sel = p;
    grid.querySelectorAll('.sel-tile').forEach((b) => { const on = b.dataset.id === p.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on && scroll) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    if (!changed) { fillInfo(); return; }
    fillInfo();
    // instant low-res, then swap to hi-res when it has loaded (never blocks the UI)
    const token = ++heroToken; hero.src = imgOf(p); hero.classList.remove('hi'); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
    const hi = hiOf(p);
    clearTimeout(hiTimer);
    const needHi = (card.clientHeight || 0) * (devicePixelRatio || 1) > 1250;      // only when the 900x1200 file would look soft
    if (needHi && hi && hi !== imgOf(p)) hiTimer = setTimeout(() => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { if (token === heroToken) { hero.src = hi; hero.classList.add('hi'); } };
      im.src = hi;
    }, 260);
  }

  function columns() {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }
  function move(dx, dy) {
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((p) => sel && p.id === sel.id)), c = columns();
    let n = i + dx + dy * c;
    if (dy && (n < 0 || n >= list.length)) n = i;            // stay on the edge row
    n = (n + list.length) % list.length;
    select(list[n]); grid.querySelector('.sel-tile.on')?.focus({ preventScroll: true });
  }

  function confirm() {
    if (!sel || root.classList.contains('lock')) return;
    const p = sel;
    if (REDUCED) { close(true); onPick(p); return; }
    root.classList.add('lock');
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { root.classList.remove('lock'); close(true); onPick(p); }, 420);
  }

  function onKey(e) {
    if (!openState) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (k === 'Tab') {                                            // small focus trap
      const f = [...root.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (/^Arrow/.test(k) && !e.target.closest?.('.sel-tabs')) {
      e.preventDefault();
      move(k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0, k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0);
    } else if (k === 'Home' || k === 'End') { e.preventDefault(); select(list[k === 'Home' ? 0 : list.length - 1]); }
    else if (k === 'Enter' && !e.target.closest?.('.sel-tab,.sel-close')) { e.preventDefault(); confirm(); }
  }
  document.addEventListener('keydown', onKey, true);

  // 3D tilt of the big portrait (pointer only; off for reduced motion / touch)
  if (!REDUCED && !COARSE) {
    let raf = 0, tx = 0, ty = 0;
    const stage = q('.sel-stage');
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5); ty = ((e.clientY - r.top) / r.height - 0.5);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; card.style.setProperty('--rx', (-ty * 14).toFixed(2) + 'deg'); card.style.setProperty('--ry', (tx * 18).toFixed(2) + 'deg'); card.style.setProperty('--gx', (50 + tx * 80) + '%'); card.style.setProperty('--gy', (50 + ty * 80) + '%'); });
    });
    stage.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  }

  q('.sel-close').addEventListener('click', () => close());
  q('.sel-go').addEventListener('click', confirm);
  q('.sel-hero').addEventListener('error', () => { if (sel && hero.src !== new URL(imgOf(sel), location.href).href) hero.src = imgOf(sel); });

  function open() {
    if (openState) return;
    opener = document.activeElement; openState = true; root.hidden = false; root.classList.remove('lock');
    document.body.classList.add('selecting');
    render();
    requestAnimationFrame(() => { root.classList.add('show'); (grid.querySelector('.sel-tile.on') || q('.sel-close')).focus({ preventScroll: true }); });
    onOpen && onOpen();
  }
  function close(picked = false) {
    if (!openState) return;
    openState = false; clearTimeout(lockTimer); root.classList.remove('show', 'lock'); root.hidden = true;
    document.body.classList.remove('selecting');
    if (!picked && opener && opener.focus) opener.focus({ preventScroll: true });
    onClose && onClose();
  }
  return { open, close, refresh: () => openState && render(), isOpen: () => openState };
}
