# Қазақстан — Ұлы тұлғалар әлемі (3D)

Жарық жер шарының үстінде Қазақстан бедерімен көтеріліп тұрады. Карта үстінде 23 ұлы тұлғаның кітаптары жатыр. Кітапты басқанда ол ашылып, тұлғаның «голограмма-аватары» шығады, онымен **ElevenLabs** арқылы дауыспен тірідей сөйлесуге болады.

**Сайт (GitHub Pages):** https://dousheng34.github.io/kazakhstan-legends-3d/
> Микрофон Gumloop терезесінің ішінде жұмыс істемеуі мүмкін — осы сайттан ашыңыз.

## Басқару
| Әрекет | Тінтуір | Телефон |
|---|---|---|
| Картаны жылжыту | Сол батырмамен тарту | Бір саусақ |
| Айналдыру | Оң батырмамен тарту немесе ⟲ ⟳ | Екі саусақ |
| Жақындату / алыстату | Дөңгелек немесе **+ / −** | Екі саусақпен қысу |
| Еңкейту / солтүстік | ◩ / С батырмалары | — |
| Жер шары / Қазақстан | 🌐 / 📍 | 🌐 / 📍 |

## Құрылым
```
index.html, styles.css, theme.css   — интерфейс
app.js                              — three.js сахна, кітаптар, аватар, ElevenLabs сөйлесу
three.module.js, OrbitControls.js   — three.js r160 (жергілікті)
elevenlabs-client.js                — @elevenlabs/client 1.28.0 (IIFE, жергілікті)
persons.json                        — тұлғалар: аты, жылдары, өңірі, өмірбаяны, сәлемі, дауысы, аузының координаты
cities.json                         — қалалар
meta.json, height.json              — Қазақстан бедері (zoom 7 DEM торы) + шекара + текстура бөліктері
tex_00..11.jpg, mask_*.png          — 8K спутник (рельеф көлеңкесі пісірілген), 4 бөлік
texture.jpg, mask.png               — әлсіз құрылғыларға арналған жеңіл нұсқа
earth.jpg, region.jpg               — жер шары және Орталық Азия бөлшекті қабаты
img/*.jpg                           — нақты фотолар (Wikimedia Commons / Wikipedia)
tools/build_data.py                 — барлық карта деректерін қайта жасайтын скрипт
tools/portrait_sources.json         — әр фотоның көзі
tools/elevenlabs_agent.json         — ElevenLabs агентінің баптаулары және әр тұлғаның дауысы
```

## Жергілікті іске қосу
```bash
python3 -m http.server 8000
# браузерде: http://localhost:8000  (микрофон localhost-та да жұмыс істейді)
```

## ElevenLabs
* Агент: `agent_3001m55e8rm3fmh9bs1cje0r0929` (ашық агент, `app.js` ішіндегі `AGENT_ID`).
* Әр тұлғаның промпты, бірінші сөзі, тілі (kk/ru) және дауысы сөйлесу басталғанда **client overrides** арқылы жіберіледі (агентте бұл overrides рұқсат етілген болуы керек — `tools/elevenlabs_agent.json`).
* Дауысты ауыстыру: `persons.json` ішіндегі `voice` (voice_id) және `speed`.
* Агент ашық болғандықтан, сайтты кім ашса да сіздің кредитіңізбен сөйлеседі. Қажет болса ElevenLabs-та агентке **allowed origins** қойыңыз (`dousheng34.github.io`).

## Жаңа тұлға қосу
1. `img/<id>.jpg` — 900×1200 портрет қосыңыз.
2. `persons.json`-ға жазба қосыңыз (`id, name, name_ru, years, region, bio, greet, female, voice, speed`).
3. `tools/build_data.py` ішіндегі `PERSON_COORDS`-қа координатасын жазып, скриптті іске қосыңыз (немесе `px, py, h` мәндерін қолмен қойыңыз).
4. Аватар аузы қозғалуы үшін `mouth` өрісін қосыңыз (`x, y` — аузының ортасы 0..1, `w` — ені, `fh` — бет биіктігі).

## Деректер көзі және лицензия
* Спутник: © Esri World Imagery · Бедер: AWS Terrain Tiles · Шекара: geoBoundaries (OSM, ODbL)
* Фотолар: Wikimedia Commons / Wikipedia (әр файлдың өз лицензиясы бар — `tools/portrait_sources.json`)
* Дауыс: ElevenLabs
