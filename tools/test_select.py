"""Browser checks for the character-select screen and the map (needs `python3 -m http.server 8000` in the repo root).
Run:  python3 tools/test_select.py            (or KZ_URL=https://... python3 tools/test_select.py)
"""
import asyncio, json, os
from playwright.async_api import async_playwright

URL = os.environ.get('KZ_URL', 'http://127.0.0.1:8000/')
CHROMIUM = os.environ.get('CHROMIUM', '/usr/bin/chromium')

async def run_case(b, name, w, h, dpr, touch, hist, n_people):
  ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch)
  if not hist: await ctx.add_init_script("localStorage.setItem('kz_hist','0');")   # historical figures are on by default
  pg = await ctx.new_page(); errs = []; bad = []
  pg.on('pageerror', lambda e: errs.append(str(e)))
  pg.on('response', lambda r: bad.append((r.status, r.url)) if r.status >= 400 and 'favicon' not in r.url else None)
  sep = '&' if '?' in URL else '?'
  await pg.goto(URL + sep + 'debug', wait_until='domcontentloaded')
  await pg.wait_for_function("!document.getElementById('enter-btn').disabled", timeout=120000)
  info = {'case': name, 'hist': hist}
  info['map_photos'] = await pg.evaluate('window.__kz.pins.length')
  info['old_buttons_hidden'] = await pg.evaluate("['list-toggle','panel'].every(id => getComputedStyle(document.getElementById(id)).display === 'none') && getComputedStyle(document.querySelector('.search-wrap')).display === 'none'")
  await pg.locator('#enter-btn').click()
  await pg.wait_for_selector('#warp', timeout=15000); info['teleport'] = True      # warp overlay during the descent
  await pg.wait_for_function("!document.getElementById('warp')", timeout=20000)       # landed on the map with the photos
  await pg.locator('#select-btn').click()
  await pg.wait_for_selector('#select-screen.show', timeout=20000)
  await pg.wait_for_timeout(600)
  info['tiles'] = await pg.locator('.sel-tile').count()
  info['overflow_x'] = await pg.evaluate('document.documentElement.scrollWidth > innerWidth')
  info['overlap'] = await pg.evaluate("""(() => { const t=[...document.querySelectorAll('.sel-tile')].slice(0,12).map(e=>e.getBoundingClientRect());
     for (let i=0;i<t.length;i++) for (let j=i+1;j<t.length;j++){ const a=t[i],c=t[j]; if (a.left<c.right-3&&c.left<a.right-3&&a.top<c.bottom-3&&c.top<a.bottom-3) return true;} return false; })()""")
  assert info['tiles'] == n_people and info['map_photos'] == n_people, info   # every person is a photo on the map, no books
  assert info['old_buttons_hidden'] and not info['overflow_x'] and not info['overlap'], info
  if not touch and not hist:
    await pg.locator('.sel-search input').fill('голов'); await pg.wait_for_timeout(200)
    info['search_tiles'] = await pg.locator('.sel-tile').count(); assert info['search_tiles'] == 1, info
    await pg.locator('.sel-search input').fill(''); await pg.wait_for_timeout(100)
    await pg.locator('.sel-name').click()                      # leave the input
    first = await pg.locator('.sel-name').inner_text()
    await pg.keyboard.press('r'); await pg.wait_for_timeout(150)
    info['random_changed'] = (await pg.locator('.sel-name').inner_text()) != first
    await pg.keyboard.press('m'); info['sfx_label_after_m'] = await pg.locator('.sel-sfx').inner_text()
    await pg.keyboard.press('m')
    await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(100)
    await pg.keyboard.press('Enter')
  elif not touch:
    await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('Enter')
  else:
    await pg.locator('.sel-tile').nth(1).tap(); await pg.locator('.sel-go').tap()
  await pg.wait_for_function("document.getElementById('talk-overlay').classList.contains('show')", timeout=20000)
  await pg.wait_for_timeout(800)
  info['opened'] = await pg.locator('#talk-name').inner_text()
  info['ai_note'] = bool(await pg.evaluate("!!document.getElementById('ai-note')"))
  info['voice_disclosure'] = 'нақты адамның дауысы емес' in (await pg.evaluate("document.querySelector('.credit-small')?.textContent||''"))
  info['photo_credit'] = await pg.locator('.credit-small').inner_text()
  assert not info['ai_note'] and info['voice_disclosure'] and errs == [] and bad == [], (info, errs, bad)
  await ctx.close()
  return info

async def main():
  people = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'modern.json'), encoding='utf-8'))
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROMIUM, headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
    n = len(people); report = []
    for args in [('desktop', 1440, 900, 1, False, False, n), ('4k', 3840, 2160, 2, False, True, n + 23), ('mobile', 412, 839, 2, True, True, n + 23),
                 ('desktop+history', 1440, 900, 1, False, True, n + 23)]:
      report.append(await run_case(b, *args))
    print(json.dumps(report, ensure_ascii=False, indent=1)); await b.close()

asyncio.run(main())
