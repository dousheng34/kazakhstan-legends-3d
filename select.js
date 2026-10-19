// Character-select screen (fighting-game style): big preview with 3D tilt + grid of portraits,
// synthesized UI sounds, a name announcer (browser speech synthesis — not a clone of anyone), random pick, search.
// Pure UI module: it never talks to the voice agent. app.js decides what "pick" does.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;

const T = {
  kk: { title: 'ТҰЛҒАНЫ ТАҢДА', kicker: 'ҚАЗАҚСТАННЫҢ ҰЛЫ ТҰЛҒАЛАРЫ', potd: 'КҮННІҢ ТҰЛҒАСЫ', all: 'Барлығы', modern: 'Замандастар', classic: 'Тарихи тұлғалар',
        pick: 'ТАҢДАУ', close: 'Жабу', ai: 'AI-гид', aiHint: 'Бұл — жасанды интеллект гиді; дауыс нақты адамның дауысы емес.',
        hint: '← ↑ → ↓ таңдау · Enter — ашу · R — кездейсоқ · M — дыбыс · Esc — жабу', kk: 'ҚАЗ', ru: 'РУС', empty: 'Ештеңе табылмады',
        search: 'Іздеу: аты, қала, сала…', random: 'Кездейсоқ', sfxOn: 'Дыбыс: ҚОС', sfxOff: 'Дыбыс: ӨШІРУЛІ', slam: 'СӨЙЛЕСЕЙІК!',
        histShow: 'Тарихи тұлғаларды көрсету', histHide: 'Тарихи тұлғаларды жасыру',
        cat: { music: 'Музыка', sport: 'Спорт', science: 'Ғылым', culture: 'Мәдениет' } },
  ru: { title: 'ВЫБЕРИ ЛЕГЕНДУ', kicker: 'ВЕЛИКИЕ ЛИЧНОСТИ КАЗАХСТАНА', potd: 'ЛИЧНОСТЬ ДНЯ', all: 'Все', modern: 'Современники', classic: 'Исторические',
        pick: 'ВЫБРАТЬ', close: 'Закрыть', ai: 'ИИ-гид', aiHint: 'Это ИИ-гид; голос — не голос реального человека.',
        hint: '← ↑ → ↓ выбор · Enter — открыть · R — случайный · M — звук · Esc — закрыть', kk: 'КАЗ', ru: 'РУС', empty: 'Ничего не найдено',
        search: 'Поиск: имя, город, сфера…', random: 'Случайный', sfxOn: 'Звук: ВКЛ', sfxOff: 'Звук: ВЫКЛ', slam: 'ДАВАЙ ПОГОВОРИМ!',
        histShow: 'Показать исторические личности', histHide: 'Скрыть исторические личности',
        cat: { music: 'Музыка', sport: 'Спорт', science: 'Наука', culture: 'Культура' } },
};
// accent colour per field: tile frame, glow and arena light follow it
const ACC = { music: '#d65cff', sport: '#ff6a3d', culture: '#fec50c', science: '#2fd0ff', classic: '#c9a227' };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---- sounds: tiny WebAudio synth (no files) ----
export function makeSfx() {
  let ctx = null, muted = false;
  const isMuted = () => { try { return localStorage.getItem('kz_sfx') === '0'; } catch (e) { return muted; } };
  const ensure = () => {
    if (isMuted()) return null;
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, dur, type = 'square', vol = 0.04, slideTo = 0, delay = 0) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function whoosh(dur = 0.4, vol = 0.09, delay = 0) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + delay, n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t);
  }
  return {
    move: () => tone(900, 0.045, 'square', 0.025, 1300),
    open: () => { whoosh(0.35, 0.06); tone(220, 0.25, 'triangle', 0.05, 660); },
    pick: () => { whoosh(0.45, 0.12); tone(110, 0.5, 'sawtooth', 0.07, 45); tone(440, 0.18, 'square', 0.05, 1320, 0.06); tone(660, 0.2, 'square', 0.04, 1760, 0.14); },
    random: () => [520, 700, 900, 1180].forEach((f, i) => tone(f, 0.055, 'square', 0.03, 0, i * 0.055)),
    reveal: () => { whoosh(0.5, 0.08); tone(300, 0.2, 'triangle', 0.03, 520, 0.05); },
    isMuted,
    toggle() { muted = !isMuted(); try { localStorage.setItem('kz_sfx', muted ? '0' : '1'); } catch (e) {} if (muted) { try { speechSynthesis.cancel(); } catch (e) {} } else tone(700, 0.08, 'square', 0.04, 1000); return muted; },
  };
}

export function initSelect({ getPeople, imgOf, hiOf, getUiLang = () => 'kk', onPick, onOpen, onClose, historyOn = false, onToggleHistory }) {
  const root = el('div'); root.id = 'select-screen'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="sel-bg"></div>
    <header class="sel-top">
      <div class="sel-title"><small></small><h2></h2></div>
      <div class="sel-tools">
        <label class="sel-search"><input type="search" autocomplete="off" spellcheck="false"></label>
        <button type="button" class="sel-btn sel-rand"></button>
        <button type="button" class="sel-btn sel-sfx"></button>
      </div>
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
    <footer class="sel-hint"><span class="sel-hint-text"></span><button type="button" class="sel-hist"></button></footer>
    <div class="sel-slam" aria-hidden="true"></div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const grid = q('.sel-grid'), hero = q('.sel-hero'), card = q('.sel-card3d'), search = q('.sel-search input');
  const sfx = makeSfx();

  let filter = 'all', cat = '', query = '', sel = null, list = [], opener = null, openState = false, heroToken = 0, lockTimer = 0, hiTimer = 0, speakTimer = 0, pending = null;
  const tr = () => T[getUiLang()] || T.kk;
  const nameOf = (p) => (getUiLang() === 'ru' ? p.name_ru : p.name);
  const roleOf = (p) => (p.modern ? (getUiLang() === 'ru' ? p.field_ru : p.field_kk) : (getUiLang() === 'ru' ? 'Историческая личность' : 'Тарихи тұлға')) || '';
  const bioOf = (p) => (getUiLang() === 'ru' && p.bio_ru) ? p.bio_ru : p.bio;
  const accOf = (p) => ACC[p.modern ? p.category : 'classic'] || ACC.culture;
  function potdId() {
    const pool = getPeople().filter((p) => p.modern); if (!pool.length) return null;
    const d = new Date(), key = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
    return pool[(key * 2654435761 >>> 0) % pool.length].id;
  }

  function visible() {
    const k = query.trim().toLowerCase();
    return getPeople().filter((p) => (filter === 'all' || (filter === 'modern' ? p.modern : !p.modern)) && (!cat || p.category === cat)
      && (!k || [p.name, p.name_ru, p.region, p.field_kk, p.field_ru].filter(Boolean).join(' ').toLowerCase().includes(k)));
  }

  // name announcer: browser speech synthesis (generic voice; never a clone of the person)
  function announce(p) {
    if (sfx.isMuted() || !('speechSynthesis' in window)) return;
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(nameOf(p));
        const want = getUiLang() === 'ru' ? 'ru' : 'kk', voices = speechSynthesis.getVoices();
        const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(want)) || voices.find((x) => x.lang && x.lang.toLowerCase().startsWith('ru'));
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ru-RU';
        u.pitch = 0.55; u.rate = 0.9; u.volume = 1;
        speechSynthesis.speak(u);
      } catch (e) {}
    }, 420);
  }

  function renderChrome() {
    const t = tr(), people = getPeople();
    q('.sel-title small').textContent = t.kicker; q('.sel-title h2').textContent = t.title;
    q('.sel-close').setAttribute('aria-label', t.close); q('.sel-hint-text').textContent = t.hint; q('.sel-go').textContent = t.pick;
    search.placeholder = t.search; search.setAttribute('aria-label', t.search);
    q('.sel-rand').textContent = '↻ ' + t.random; q('.sel-sfx').textContent = '♪ ' + (sfx.isMuted() ? t.sfxOff : t.sfxOn);
    q('.sel-slam').textContent = t.slam;
    const hist = q('.sel-hist'); hist.textContent = historyOn ? t.histHide : t.histShow; hist.hidden = !onToggleHistory;
    const tabs = q('.sel-tabs'); tabs.innerHTML = '';
    const mk = (id, label, n, isCat) => {
      const b = el('button', 'sel-tab'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.textContent = label; b.append(el('b', '', String(n)));
      const on = isCat ? cat === id : (!cat && filter === id); b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
      b.addEventListener('click', () => { sfx.move(); if (isCat) { cat = cat === id ? '' : id; filter = 'all'; } else { filter = id; cat = ''; } render(); });
      tabs.append(b);
    };
    mk('all', t.all, people.length);
    if (people.some((p) => p.modern) && people.some((p) => !p.modern)) { mk('modern', t.modern, people.filter((p) => p.modern).length); mk('classic', t.classic, people.filter((p) => !p.modern).length); }
    [...new Set(people.filter((p) => p.modern && p.category).map((p) => p.category))].forEach((c) =>
      mk(c, t.cat[c] || c, people.filter((p) => p.category === c).length, true));
  }

  function render() {
    renderChrome();
    list = visible(); grid.innerHTML = '';
    if (!list.length) { grid.append(el('div', 'sel-empty', tr().empty)); sel = null; fillInfo(); return; }
    list.forEach((p) => {
      const b = el('button', 'sel-tile'); b.type = 'button'; b.dataset.id = p.id; b.setAttribute('role', 'option');
      b.style.setProperty('--acc', accOf(p));
      const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = imgOf(p); img.draggable = false;
      const cap = el('span', 'sel-cap'); cap.append(el('b', '', nameOf(p)), el('i', '', p.years || ''));
      b.append(img, el('u', 'sel-corners'), cap);
      if (p.id === potdId()) b.append(el('em', 'sel-potd', tr().potd));
      // mouse: hover moves the cursor, click picks. touch: first tap selects, second tap (or the big button) picks.
      b.addEventListener('click', () => { const was = sel && sel.id === p.id; select(p, false); if (!COARSE || was) confirm(); });
      if (!COARSE) b.addEventListener('pointerenter', () => select(p, false));
      grid.append(b);
    });
    const keep = (sel && list.find((p) => p.id === sel.id)) || (pending && list.find((p) => p.id === pending)) || list[0];
    pending = null; sel = null; select(keep, false, true);      // always (re)loads the hero image
  }

  function fillInfo() {
    const t = tr(), p = sel;
    root.classList.toggle('empty', !p); if (!p) return;
    q('.sel-name').textContent = nameOf(p);
    q('.sel-name2').textContent = getUiLang() === 'ru' ? p.name : p.name_ru;
    q('.sel-meta').textContent = [p.years, roleOf(p), p.region].filter(Boolean).join(' · ');
    q('.sel-bio').textContent = bioOf(p) || '';
    const badges = q('.sel-badges'); badges.innerHTML = '';
    if (p.id === potdId()) badges.append(el('span', 'sel-badge potd', t.potd));
    if (p.modern && p.category) badges.append(el('span', 'sel-badge cat', t.cat[p.category] || p.category));
    badges.append(el('span', 'sel-badge lang', (p.lang === 'ru' ? t.ru : t.kk)));
    q('.sel-ai').hidden = true;
    q('.sel-go').disabled = false;
    root.dataset.cat = p.modern ? 'modern' : 'classic';
    root.style.setProperty('--acc', accOf(p));
  }

  function select(p, scroll = true, silent = false) {
    if (!p) return;
    const changed = !sel || sel.id !== p.id; sel = p;
    grid.querySelectorAll('.sel-tile').forEach((b) => { const on = b.dataset.id === p.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on && scroll) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    if (!changed) { fillInfo(); return; }
    fillInfo();
    if (!silent) { sfx.move(); announce(p); }
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
  function randomPick() {
    if (!list.length) return;
    sfx.random();
    let n = Math.floor(Math.random() * list.length);
    if (list.length > 1 && sel && list[n].id === sel.id) n = (n + 1) % list.length;
    select(list[n]); grid.querySelector('.sel-tile.on')?.focus({ preventScroll: true });
  }

  function confirm() {
    if (!sel || root.classList.contains('lock')) return;
    const p = sel;
    try { speechSynthesis.cancel(); } catch (e) {} clearTimeout(speakTimer);
    sfx.pick();
    if (REDUCED) { close(true); onPick(p); return; }
    root.classList.add('lock');
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { root.classList.remove('lock'); close(true); onPick(p); }, 780);
  }

  function onKey(e) {
    if (!openState) return;
    const k = e.key, typing = e.target && e.target.tagName === 'INPUT';
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typing && search.value) { search.value = ''; query = ''; render(); } else close(); return; }
    if (k === 'Tab') {                                            // small focus trap
      const f = [...root.querySelectorAll('button:not([disabled]):not([hidden]), input')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (typing) {                                                 // typing in the search box: only Down/Enter are special
      if (k === 'ArrowDown') { e.preventDefault(); grid.querySelector('.sel-tile.on')?.focus({ preventScroll: true }); }
      else if (k === 'Enter') { e.preventDefault(); confirm(); }
      return;
    }
    if (/^Arrow/.test(k) && !e.target.closest?.('.sel-tabs')) {
      e.preventDefault();
      move(k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0, k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0);
    } else if (k === 'Home' || k === 'End') { e.preventDefault(); select(list[k === 'Home' ? 0 : list.length - 1]); }
    else if (k === 'r' || k === 'R' || k === 'к' || k === 'К') { e.preventDefault(); randomPick(); }
    else if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') { e.preventDefault(); toggleSfx(); }
    else if (k === 'Enter' && !e.target.closest?.('.sel-tab,.sel-close,.sel-btn,.sel-hist')) { e.preventDefault(); confirm(); }
  }
  document.addEventListener('keydown', onKey, true);

  function toggleSfx() { sfx.toggle(); q('.sel-sfx').textContent = '♪ ' + (sfx.isMuted() ? tr().sfxOff : tr().sfxOn); }

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
  q('.sel-rand').addEventListener('click', randomPick);
  q('.sel-sfx').addEventListener('click', toggleSfx);
  q('.sel-hist').addEventListener('click', () => onToggleHistory && onToggleHistory());
  search.addEventListener('input', () => { query = search.value; render(); });
  q('.sel-hero').addEventListener('error', () => { if (sel && hero.src !== new URL(imgOf(sel), location.href).href) hero.src = imgOf(sel); });

  function open() {
    if (openState) return;
    opener = document.activeElement; openState = true; root.hidden = false; root.classList.remove('lock');
    document.body.classList.add('selecting');
    query = ''; search.value = '';
    if (!sel) pending = potdId();
    render(); sfx.reveal();
    requestAnimationFrame(() => { root.classList.add('show'); (grid.querySelector('.sel-tile.on') || q('.sel-close')).focus({ preventScroll: true }); });
    if (sel) announce(sel);
    onOpen && onOpen();
  }
  function close(picked = false) {
    if (!openState) return;
    openState = false; clearTimeout(lockTimer); clearTimeout(speakTimer); root.classList.remove('show', 'lock'); root.hidden = true;
    try { speechSynthesis.cancel(); } catch (e) {}
    document.body.classList.remove('selecting');
    if (!picked && opener && opener.focus) opener.focus({ preventScroll: true });
    onClose && onClose();
  }
  return { open, close, refresh: () => openState && render(), isOpen: () => openState };
}
