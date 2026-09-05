# RapTok — Full Code Review Report
**Дата:** 2026-09-06
**Ревьюер:** Hermes (автономный агент)
**Скоуп:** Frontend (React 19 + TS) + Backend (FastAPI) + Infrastructure (Docker, disk) + Live-тесты на проде
**Объём:** ~137 проверок (100 бек/инфра + 37 фронт), включая live-эксплойты с подтверждением
**Версия:** commit после "fix: Change button full reset" (v3.0 workflow)

---

## Executive Summary

Найдено **5 критических**, **7 высоких**, **10 средних**, **5 низких** проблем.
Две из критических — **пробиваемые цепочки атак, подтверждённые live-тестами на проде**:
утечка сессионных токенов и БД через file-serving эндпоинты, и известный SECRET_KEY
в git. Продакшн-безопасность сейчас держится на том, что URL не публичен.

Хорошие новости: XSS-поверхность нулевая, npm audit чистый, renders изолированы
в БД по юзеру, cookie flags правильные, path traversal в upload заблокирован.

---

# ЧАСТЬ 1. CRITICAL (5)

## C1. Утечка сессий, БД и любых файлов temp-директории 🔥

**Файлы:** `backend/routers/files.py` (audio-preview), `backend/routers/video.py` (thumbnail)

**Root cause:**
- `/api/audio-preview/{filename}` ищет файл **substring-матчем** (`if filename in f.name`)
  по всей temp-директории
- `/api/thumbnail/{filename}` отдаёт **любой файл** из temp без whitelist расширений

**Live-подтверждение (прод, юзер adminvadik — не админ):**
```
GET /api/audio-preview/sessions  → 200, весь .sessions.json (ВСЕ session токены, включая админские)
GET /api/audio-preview/raptok    → 200, вся SQLite база (156KB)
GET /api/thumbnail/raptok.db     → 200, дамп БД
```

**Цепочка атаки:**
1. Любой залогиненный юзер (free-план) запрашивает `/api/audio-preview/sessions`
2. Получает ВСЕ токены, включая админские
3. `_verify_token()` проверяет HMAC подпись **и** наличие токена в `_sessions` —
   украденный токен проходит обе проверки
4. → Полный админ-доступ без пароля → админ-эндпоинты, чужие проекты, квоты

**Дополнительно:** `/api/download/{filename}` не проверяет владельца рендера.
Live-подтверждено: adminvadik скачал рендер админа `raptok_06ed2b6c32af.mp4` → 200.

**Фикс (≈30 мин):**
```python
# audio-preview: строгий match по basename + whitelist
SAFE_EXT = {'.mp3', '.wav', '.m4a', '.flac', '.aac'}
name = Path(filename).name  # отрезает любые пути
if not name or name.startswith('.'):        # dotfiles запрещены
    raise HTTPException(404)
candidates = [f for f in TEMP_DIR.iterdir() if f.name == name]  # ТОЧНОЕ равенство
if not candidates:
    raise HTTPException(404)
# thumbnail: то же + whitelist {'.jpg', '.png', '.webp'}
# download: проверка ownership — рендер должен принадлежать session["username"]
```

---

## C2. Plaintext пароли + SECRET_KEY захардкожен в git 🔥

**Файлы:** `backend/services/database.py` (seed, verify_user), `backend/routers/auth.py`

**Детали:**
1. Пароли хранятся в SQLite **plaintext**: `verify_user()` делает
   `WHERE username = ? AND password = ?` — прямое сравнение. В `.sessions.json` и
   дампе БД (утекаемом через C1) видны все пароли.
2. `SECRET_KEY = os.environ.get("RAPTOK_SECRET", "raptok-secret-2026-change-me")` —
   fallback-секрет захардкожен и **закоммичен в git**. В `docker-compose.yml`
   переменная `RAPTOK_SECRET` **не задана** (проверено grep-ом) → прод использует
   известный из репо секрет.
3. Следствие: любой, кто прочитал репо, может сгенерировать валидную HMAC-подпись
   токена. Проверка `_sessions` частично защищает, но в связке с C1 (кража реальных
   токенов) — полноценный bypass.

**Также:** подделка токена продемонстрирована локально:
```
payload = admin:1.2.3.4:1788000000
sig = hmac_sha256("raptok-secret-2026-change-me", payload)
```

**Фикс (≈45 мин):**
1. pbkdf2_hmac для паролей (обратной совместимости мешает 2 юзера — миграция тривиальна)
2. `RAPTOK_SECRET` в `docker-compose.yml` env + `.env` в `.gitignore`
3. Ротация: после смены секрета все сессии инвалидируются (допустимо, 2 юзера)

---

## C3. Double-offset: Fragments step сломан при clipRange.start > 0 🔥

**Файлы:**
- Frontend: `CutToolsPanel.tsx` (handleAutoCut), `FragmentEditor.tsx` (handleBeatSync)
- Backend: `routers/audio.py` (auto-cut-by-audio, beat-sync)

**Root cause:** В v3-флоу фронт передаёт в бек **сегмент** (0-based, нарезанный
на Analysis) + `clip_start = clipRange.start` (абсолютный оффсет в полном треке).
Бек фильтрует биты в диапазоне `[clip_start, clip_start + clip_length]` —
но аудио-файл длиной `clip_length`, а не полный трек. Биты 67-99с не существуют
в 32-секундном сегменте → пусто.

**Frontend (CutToolsPanel.tsx):**
```typescript
const clipStart = clipRange?.start ?? 0;  // 67 — абсолют!
const clipLength = clipRange ? clipRange.end - clipRange.start : 0;
const result = await api.autoCutByAudio(
  audioPath || '',  // ← здесь SEGMENT (0-based), а не полный трек
  videoDuration, minFrag, maxFrag, clipStart, clipLength,
);
```

**Live-подтверждение (прод):**
```
segment 32s, clip_start=67 → fragments: 0, beats: 0     ← СЛОМАНО
segment 32s, clip_start=0  → fragments: 8, beats: 44    ← РАБОТАЕТ
```

**Фикс (≈15 мин):** Когда `audioPath` — это segmentPath, слать `clip_start=0`.
Вариант: в App.tsx пробрасывать флаг `isSegment` и в обработчиках подставлять 0.
Фундаментальнее — контракт бека: `clip_start` интерпретируется только относительно
переданного файла, фронт обязан передавать координаты в системе этого файла.

---

## C4. Render блокирует весь event loop 🔥

**Файл:** `backend/routers/render.py:20` (`api_render`)

**Детали:** `async def api_render` внутри синхронно вызывает `render_clip()`
(ffmpeg рендер 1080×1920 — минуты CPU) и `subprocess.run` (ffmpeg аудио-вырезка).
Пока рендер идёт: health-check не отвечает, SSE обрывается, все запросы висят.
Docker healthcheck отсутствует → при внешнем мониторинге контейнер выглядит живым.

То же самое: `subprocess.run` в `files.py` (upload probe), `downloader.py`,
`prepare-preview` в `render.py`.

**Фикс (≈40 мин):**
```python
result = await asyncio.to_thread(render_clip, ...)   # python 3.11 — идеально
# или: loop.run_in_executor(None, functools.partial(render_clip, ...))
```
Для prepare-preview: тоже to_thread. Для SSE-стрима — `request.is_disconnected()`.

---

## C5. Reload теряет segmentPath → слова играют не поверх того аудио 🔥

**Файлы:** `App.tsx` (localStorage restore), `SubtitleEditor.tsx`, `RenderPanel.tsx`

**Детали:** `segmentPath` не сохраняется в localStorage/DB state (осознанное
решение — файлы не персистентны). Но `clipRange` и `wordTimings` (0-based
относительно сегмента) — сохраняются. После F5:
- `segmentPath = null` → `audioPath` откатывается на полный трек
- SubtitleEditor видит `clipRange` → ставит `audioStart=0`, но audioUrl = ПОЛНЫЙ трек
- Слова 0-based играют с начала трека, а не с 67с → полный диссинк
- RenderPanel: `audio_start=0` + полный трек → рендер вырежет не тот кусок
- AIStylePanel: `fetchedRef` уже указывает на старый путь → анализ не обновится

**Фикс (≈20 мин):** useEffect при загрузке: если `clipRange` есть, а
`segmentPath` нет → авто-вызов `api.cutSegment(audioPath, clipRange.start, len)`
→ `setSegmentPath(...)`. Молча, без смены шага.

---

# ЧАСТЬ 2. HIGH (7)

## H1. Диск течёт: 980MB tmp, cleanup отсутствует

**Данные (на момент ревью):**
```
tmp/:  980MB, 221 файлов, из них 101 segment (817MB), 58 preview (70MB)
output/: 596MB, 74 файла
```

Причины:
1. **Каждое** изменение range на Analysis создаёт новый segment-файл
   (`_segment_67_32`, `_segment_67_33`...) — старые не удаляются
2. **`hash()` в именах сегментов** (`routers/transcription.py`): Python hash
   нестабилен между рестартами процесса (проверено: до/после рестарта значения
   разные) → кэш сегментов никогда не хитит, файлы копятся при каждом транскрайбе
3. Preview-файлы (`preview_{job}.mp4`) **никогда не удаляются** — каждое нажатие
   превью = новый файл
4. Renders в output/ не чистятся (ок для юзера, но нужен retention)

**Фикс (≈30 мин):**
- `hash()` → `hashlib.md5(f"{path}:{start}:{length}")` (стабильно)
- Cron/systemd-timer: tmp-файлы старше 24h → delete
- prepare-preview: удалять preview-файл при следующем запросе того же проекта

## H2. Swagger/OpenAPI публичны

```
GET /docs          → 200 без авторизации
GET /openapi.json  → 200 без авторизации
```
Вся карта эндпоинтов, схемы моделей — на виду.

**Фикс:** `RAPTOK_DOCS=0` env → `docs_url=None`, либо проксировать через nginx
только с внутреннего IP.

## H3. Upload без size-лимитов и валидации формата

`/api/upload/audio`, `/api/upload/video`: нет ограничения размера, нет проверки
magic bytes (только расширение). Любой юзер льёт гигабайты → диск (31GB free)
закончится → рендеры падают у всех. Кривое имя файла → **500** вместо 400
(live: `FileNotFoundError: '/tmp/raptok/audio_..._../../tmp/raptok/pwned.mp3'`).

**Фикс:** лимит (напр. 500MB) + Content-Type probe через ffprobe + 400 на невалид.

## H4. Preview race condition + необработанные ошибки (VideoPreviewEditor.tsx:70-102)

`prepare-preview` вызывается при изменении фрагментов/слов **без AbortController
и без stale-guard**: быстрое редактирование двух слов → поздний старый ответ
затирает свежие данные. Плюс `fetch(...).then(r => r.json())` без `res.ok` —
на 500-й юзер видит криптичный парсинг-эджект.

**Фикс:**
```typescript
useEffect(() => {
  const ctrl = new AbortController();
  fetch('/api/prepare-preview', { signal: ctrl.signal, ... })
    .then(r => { if (!r.ok) throw new Error('Preview failed'); return r.json(); })
    .then(setPreviewData)
    .catch(err => { if (err.name !== 'AbortError') setPreviewError(err.message); });
  return () => ctrl.abort();
}, [deps]);
```

## H5. Word-drag: 60 state-updates/сек (TimelinePreview.tsx:185-213)

Каждый `mousemove` при перетаскивании слова:
```
onWordTimingsChange → sort массива + identity-lookup → regenSubtitles
→ App setWordTimings → localStorage JSON.stringify(ВЕСЬ state)
→ debounce autosave reset
```
На треке с 500+ слов — фризы UI прямо во время драга.

**Фикс:** во время драга держать локальный state (ref), коммитить в parent
только на `mouseup`. Плюс debounce на localStorage (см. M6).

## H6. Waveform: ~10k divs ре-рендерятся 4×/сек (AnalysisPanel.tsx:106, 286)

Бек отдаёт `rms[::50]` (audio.py:98) → для 4-мин трека ~10 500 баров.
`onTime` → `setPlayTime` (4×/сек) → React reconcile 10k divs каждые 250мс.
Это причина jank-а на Analysis-шаге при воспроизведении.

**Фикс:** bars вынести в `React.memo`-компонент (stable prop `rmsValues`),
playhead оставить в родителе.

## H7. WhisperX загружен с захардкоженным language="ru"

`speech_recognizer.py`: `whisperx.load_model(size, ..., language="ru")` —
токенизатор привязан к RU на уровне модели. Выбор языка в UI передаётся в
`transcribe()`, но RU-пребинд деградирует EN-треки. Пользователь работает
с RU-контентом — не горит, но при экспансии выстрелит.

**Фикс:** не пребиндить язык в load_model; для RU-кейса достаточно
`language="ru"` в transcribe.

---

# ЧАСТЬ 3. MEDIUM (10)

## M1. `_jobs` dict в video.py растёт бесконечно
Каждый upload/analyze видео добавляет запись. Нет eviction. **Фикс:** LRU или TTL-чистка.

## M2. `except: pass` в render.py:191
Глотает ВСЁ, включая KeyboardInterrupt-классы. **Фикс:** `except OSError: pass`.

## M3. Docker: root, нет healthcheck, нет resource limits
Контейнер под root → компромисс = root на host volume. Нет mem_limit —
ffmpeg на длинном рендере может съесть RAM. **Фикс:** USER appuser, healthcheck
на /api/health, mem_limit 8g.

## M4. Number-инпуты без JS-клампа (CutToolsPanel.tsx:107-130)
`min/max` — только HTML-атрибуты. Юзер тащит `count=999` → бек честно нарежет
999 фрагментов. Бек-валидации тоже нет. **Фикс:** clamp в onChange + Form
валидация в беке.

## M5. canProceed(5)/(6) = true (App.tsx:296-297)
Юзер может уйти на Preview/Render с нулём фрагментов → 400 "No fragments"
из бека в лицо. **Фикс:** `case 5: return fragments.length > 0`.

## M6. localStorage пишется на КАЖДОЕ изменение state (App.tsx:118-133)
Без debounce — в отличие от DB-автосейва (3s). В связке с H5 — сотни
stringify/сек при драге. **Фикс:** debounce 500ms.

## M7. Автосейв теряет последние 3 секунды (App.tsx:136-155)
Юзер закрыл вкладку до срабатывания debounce → правки в DB не попали.
localStorage частично выручает при следующем открытии того же проекта.
**Фикс:** beforeunload → sendBeacon со state.

## M8. SSE-транскрибация не отменяется (client.ts:275-283)
Нет AbortController → ушёл со шага Lyrics, а large-v3 жрёт CPU ещё минуты.
Бек не проверяет `request.is_disconnected()`. **Фикс:** signal + is_disconnected
в генераторе.

## M9. insertWord может создать слово внутри соседнего (SubtitleEditor.tsx)
Если слова пересекаются после драга (`nextStart < prevEnd`), `midTime`
уезжает внутрь чужого слова → оверлап в ASS-рендере. **Фикс:** clamp
`nextStart = Math.max(nextStart, prevEnd)`.

## M10. X-Forwarded-For слепо доверяется + IP не проверяется при verify
IP в сессии хранится, но `_verify_token` не сравнивает его с текущим.
Спуф XFF при прямом доступе к порту меняет клиентский IP. **Фикс:** при
прокси через nginx доверять XFF только с proxy-IP, либо проверить
`session["ip"] == client_ip` (осторожно с мобильными юзерами).

---

# ЧАСТЬ 4. LOW (5)

## L1. AnalysisPanel.tsx:77 — аудио-листенеры пересоздаются на каждое изменение range
Deps включают `rangeStart/rangeEnd`, но листенеры их не используют.

## L2. dataVersion в deps только для console.log (VideoPreviewEditor.tsx:103)
Мёртвый проп в зависимостях.

## L3. handleAutoCut vs handleSnapToBeats — inconsistent id (App.tsx:327-341)
Один перенумеровывает (`id: i`), второй сохраняет (`f.id`).

## L4. Fallback waveform slice(0,100) (AnalysisPanel.tsx:300-306)
Если rms_values пуст — показывает только первые 100 значений energy_curve.

## L5. 19 `any`-кастов
`handleAutoCut(newFrags: any[])` при существующем типе `Fragment` и др.

---

# ЧАСТЬ 5. Что чисто ✅

| Проверка | Результат |
|----------|-----------|
| XSS (`dangerouslySetInnerHTML`, `innerHTML`, `document.write`) | **Ноль** вхождений |
| npm audit | **0 уязвимостей** |
| Renders в БД изолированы по юзеру | ✓ (vadik видит 0 чужих через /api/renders) |
| Cookie flags | httponly, secure, samesite=lax ✓ |
| CORS | restricted to jimmy.hotloads.llc ✓ |
| /api/* без куки | 401 ✓ |
| Path traversal в upload | заблокирован префиксом job_id ✓ (но 500 вместо 400) |
| useTemplates | module-level кэш, один fetch на сессию ✓ |
| postJSON/postForm/getJSON | единый error handling, credentials: 'include' ✓ |
| Resize-хендлеры слов | клампятся (min 0.05s, границы [0, duration]) ✓ |
| Сессии | просроченные чистятся при загрузке ✓ |
| Партиционирование рендеров | квоты пишутся/проверяются в render.py ✓ |
| Timeline word-drag | границы [0, duration-wordW] ✓ |
| insertWord duration | Math.max(0.2, ...) ✓ |

---

# ЧАСТЬ 6. План фиксов (приоритет: выгода/время)

| # | Фикс | Время | Закрывает |
|---|------|-------|-----------|
| 1 | Файл-серверы: strict basename + whitelist ext + dotfiles ban | ~30 мин | C1 |
| 2 | Double-offset: clip_start=0 для сегмента | ~15 мин | C3 |
| 3 | pbkdf2 пароли + RAPTOK_SECRET в compose | ~45 мин | C2 |
| 4 | asyncio.to_thread для render/subprocess | ~40 мин | C4 |
| 5 | Re-cut сегмента на reload | ~20 мин | C5 |
| 6 | md5 вместо hash() + cleanup-крон tmp 24h | ~30 мин | H1 |
| 7 | Word-drag: commit на mouseup + React.memo bars | ~40 мин | H5, H6 |
| 8 | Preview AbortController + res.ok | ~15 мин | H4 |
| 9 | Docs off + upload limits + Docker hardening | ~45 мин | H2, H3, M3 |
| 10 | Остальное (MEDIUM/LOW) | следующий заход | M1-M10 |

**Итого critical-пакет (1-5): ~2.5 часа работы.**

---

# Приложение: методология

- Ручной проход ~137 проверок: routers (files, auth, render, transcription, audio,
  admin, projects), services (speech_recognizer, video_renderer, database),
  frontend (App.tsx, все компоненты, api/client, utils)
- Live-тесты на проде jimmy.hotloads.llc под двумя аккаунтами (admin, adminvadik):
  path traversal, утечка сессий/БД, cross-user download, double-offset (2 запроса),
  спуф X-Forwarded-For, фордж токена, 500-е на upload
- Дисковая разведка: du/ls по tmp/ и output/
- Docker: compose без секретов/лимитов/healthcheck — проверено
- Git: .gitignore не защищает SECRET_KEY fallback (он в коде auth.py)
- Delegation-агент #3 (services-слой, 399s, 15 вызовов) завершился успешно —
  его находки в Приложении B ниже
- Два delegation-агента (бек/фронт deep-dive) упали по 600s таймауту — их скоуп
  покрыт ручным проходом

*Отчёт сгенерирован автономным ревью Hermes Agent. Все live-эксплойты выполнены
только на собственном продакшн-сервере проекта, с аккаунтов владельца.*

---
---

# Приложение B: Services-слой — глубокий ревью (delegation-агент)

**Метод:** read-only проход 9 целевых файлов services/ + beat_effects.py + Form-валидация
routers (audio, video, transcription). Без live-тестов.
**Итог:** 2 critical, 8 high, 13 medium, 9 low + dead-code дубликация.

## CRITICAL

**S-C1. `services/ai_style.py:191` — `os.chdir(m2e_path)` мутирует CWD всего процесса**
Вызывается при ленивой загрузке Music2Emo и навсегда меняет рабочую директорию на
site-packages. Все последующие относительные пути (ffmpeg concat-списки, временные
файлы, upload'ы) ломаются непредсказуемо и незаметно.
**Фикс:** убрать `os.chdir` вообще; при необходимости — патчить `sys.path` и передавать
рабочую директорию в модель, либо `contextlib.chdir` локально в `try/finally`.

**S-C2. `services/stem_separator.py:43` + `routers/audio.py:28` — кэш вокала по хэшу
пути даёт вокал ДРУГОГО трека**
Кэш ключуется `md5(audio_path)`, а сегменты именуются детерминированно
(`{base}_segment_{start}_{len}.wav`). Перезалив/замена песни → тот же путь →
`separate_vocals` возвращает закэшированный вокал предыдущего трека → whisper
транскрибирует чужой аудио → мусорная транскрипция и рендер.
**Фикс:** ключ кэша = path + mtime + size (или хэш первых N байт контента);
инвалиировать при несовпадении.

## HIGH

**S-H1. `video_renderer.py:79, 98, 214` — нет try/finally: утечка work_dir при любой
ошибке + необработанный `TimeoutExpired`**
Исключение на любом шаге (fragment fail, concat fail, timeout) → `shutil.rmtree`
не выполняется → `TEMP_DIR/render_*` с частичными фрагментами копится на диске.
Плюс `subprocess.run(timeout=300)` кидает сырой `TimeoutExpired` — рендер 1080×1920
с gblur+subtitles на CPU легко превышает 300с → частый отказ с необработанным
исключением.
**Фикс:** обернуть Steps 2–4 в `try/finally: shutil.rmtree(work_dir,
ignore_errors=True)`; ловить `TimeoutExpired` → `RuntimeError`; поднять timeout
финального рендера (или стримить вывод без capture_output и убрать таймаут в
пользу progress-мониторинга).

**S-H2. `video_renderer.py:63–87` — нет валидации fragments: пустой список /
duration<=0 → невнятные падения**
`fragments=[]` → пустой concat_list → ffmpeg concat падает с cryptic ошибкой;
`duration=0` → `-t 0` → ошибка посреди цикла (плюс утечка из S-H1).
**Фикс:** upfront-валидация: `fragments` непуст, `frag.start >= 0`,
`frag.duration > 0`, суммарная длительность > 0.

**S-H3. `forced_alignment.py:123–143` — DTW backtrack не соответствует
forward-recurrence**
Forward: `cost[i][j] = match_cost + min(up, left, diag)` — `match_cost` прибавляется
ко ВСЕМ трём переходам (включая скипы). Backtrack же предполагает модель
«скип = +1» (`cost[i-1][j] + 1 == cost[i][j]`). Путь восстановления ≠ оптимальный
путь DP → тайминги слов привязываются к неправильным whisper-словам.
**Фикс:** корректный edit-distance DTW (match_cost только на диагонали, skip cost 1)
либо хранить матрицу шагов при forward и восстанавливать по ней.

**S-H4. `forced_alignment.py:134–143, 78` — DTW молча теряет слова лирики**
Скипнутые user-слова вообще не попадают в результат; порог приёма — всего 30% слов
(`len(aligned) >= len(user_words) * 0.3`). Итог: до 70% лирики может бесследно
исчезнуть из субтитров.
**Фикс:** для скипнутых user-слов интерполировать тайминг между соседними
спаренными; поднять порог покрытия.

**S-H5. `video_renderer.py:56 + 220` — ASS-файл утекает в TEMP_DIR при каждом рендере**
`generate_ass` пишет в `TEMP_DIR/{job_id}.ass` (сиблинг work_dir), `rmtree(work_dir)`
его не удаляет → один .ass на каждый рендер навсегда.
**Фикс:** писать .ass внутрь `work_dir`, либо `os.unlink(ass_path)` в finally.

**S-H6. `database.py` (все функции, напр. 141–149, 283–290) — утечки коннектов +
отсутствие busy_timeout**
Каждая функция `conn = _get_db()` … `conn.close()` без try/finally: любое исключение
в `execute` (locked, malformed JSON) → коннект утекает. Нет `PRAGMA busy_timeout` →
при конкурентных запросах мгновенный `SQLITE_BUSY`. WAL не спасает от write-write
конфликтов.
**Фикс:** `contextlib.closing(_get_db())` / try-finally везде;
`PRAGMA busy_timeout=5000` в `_get_db`.

**S-H7. `bpm_detector.py:23–43` — тишина → BPM = NaN → невалидный JSON ответа**
`beat_track` на тишине/очень коротком клипе возвращает NaN tempo. Все сравнения с NaN
False → nan проходит насквозь; `json.dumps` с allow_nan выпускает токен `NaN` →
клиентский `JSON.parse` падает.
**Фикс:** `if math.isnan(tempo_val) or tempo_val <= 0: return {"bpm": 0, "beats": [],
...}`.

**S-H8. `routers/audio.py:16–18, 28–30` — Form-поля без ограничений + «зашитый» битый
кэш сегмента**
`clip_start`/`clip_length` без `ge=0`: отрицательный `-ss` → ffmpeg сик с конца
(неверный кат); `clip_length<=0` → пустой/битый файл, который **навсегда
закэширован** (`if not os.path.exists(seg_path)` пропускает перегенерацию), а
`duration` в ответе ложно равна запрошенному clip_length.
**Фикс:** `Form(..., ge=0)` + `clip_length: Form(..., gt=0)`; перед кэшированием
проверять размер>0 и фактическую длительность через ffprobe.

## MEDIUM (services)

**S-M1. `subtitle_generator.py:404–441` — режим `line_highlight` фактически показывает
одно слово за раз**
Комментарий обещает «full line visible», но код эмитит отдельный Dialogue на каждое
слово с текстом только этого слова → визуально идентично `word_by_word`.
Функциональное несоответствие названию/спеке.
**Фикс:** один Dialogue на строку с inline-переопределением цвета активного слова,
либо честно переименовать режим.

**S-M2. `subtitle_generator.py:349–354` — `_format_time` падает на отрицательных
секундах**
`int(seconds // 3600)` для отрицательных → `-1:...` невалидный ASS; возможные
инверсии start>end приводят к тихому дропу строк libass.
**Фикс:** clamp `max(0, seconds)` и guard `end <= start` → пропуск/сваp.

**S-M3. `forced_alignment.py:288–317` — `_bpm_aware_distribute`: start не зажат в
fragment_duration**
При медленном BPM и малом числе слов `w_start = i * word_dur` может превысить
длительность → start > end → слово исчезает из ASS.
**Фикс:** `w_start = min(w_start, max(0, fragment_duration - 0.1))`,
`w_end = max(w_end, w_start + 0.05)`.

**S-M4. `subtitle_generator.py:397, 425, 437` — сломанный `\fade`: 7 аргументов
вместо 6**
`\fade(255,255,0,0,{ms},0,0)` — libass ожидает 6 (`a1,a2,a3,t1,t2,t3`); тег невалиден
и молча игнорируется → `fade_in` не работает ни в одном шаблоне.
**Фикс:** `\fad(0,{ms})` или корректный 6-аргументный `\fade`.

**S-M5. `stem_separator.py:167–176, 217–222` — нет таймаута на ffmpeg-сабпроцессы +
игнор returncode**
`await proc.communicate()` без таймаута → зависший ffmpeg вешает endpoint навсегда;
в `separate_vocals_with_stems` returncode instrumental не проверяется → возвращается
несуществующий путь.
**Фикс:** `asyncio.wait_for(proc.communicate(), 120)` + kill; проверять returncode
и os.path.exists.

**S-M6. `video_renderer.py:152, 168, 183` — `subtitles={ass_path}` без экранирования
в filter_complex**
TEMP_DIR конфигурируется env-переменной; пробел/`:`/`,` в пути ломают парсинг фильтра.
**Фикс:** `subtitles='{path}'` с экранированием или передавать через `chdir` +
относительное имя.

**S-M7. `downloader.py:72, 159, 196` — таймауты кидают сырой TimeoutExpired,
частичные загрузки не чистятся; формат может не совпасть с .mp4**
`best[ext=mp4]/best` при fallback может дать webm в файл с именем .mp4; при таймауте
yt-dlp partial-файл остаётся.
**Фикс:** try/except + cleanup; `--merge-output-format mp4` / `-o ...%(ext)s` с
последующим rename.

**S-M8. `ai_style.py:26` (+ emotion_style:14, genre_template:16) — неограниченные кэши,
ключ = путь**
Та же проблема stale-кэша, что и S-C2, плюс рост памяти.
**Фикс:** ключ path+mtime+size, LRU/TTL-ограничение.

**S-M9. `database.py:584–607` — квота: TOCTOU + render_quota никогда не чистится**
Два параллельных рендера проходят check до record → перерасход лимита; таблица растёт
бесконечно.
**Фикс:** атомарный `INSERT ... SELECT` с count-проверкой в одной транзакции;
периодическая чистка записей старше 48ч.

**S-M10. `bpm_detector.py:38–43` — эвристика октавного деления ломает честные
>140 BPM жанры**
Легитимные 150–170 BPM (d&b) урезаются вдвое → неверная бит-сетка для beat-effects.
**Фикс:** выбирать октаву по уверенности beat_track (tempo interval) или отдавать
оба и решать по автокорреляции.

**S-M11. `database.py:111–126` — init_db глотает все исключения** → приложение тихо
работает без БД. Фикс: перечислить известные невинные ошибки, остальные re-raise
при старте.

**S-M12. `audio_analyzer.py:98–108` — corrcoef → NaN на постоянной хроме
(тишина/дрон)**
`best_score` остаётся -1 → key «C major» с confidence −1 в API.
**Фикс:** `np.nan_to_num` + guard `best_score < -0.5` → «unknown».

**S-M13. `routers/transcription.py:110–111` — clip_start/clip_length Form без
валидации** — отрицательные утекают в ffmpeg/whisper. Фикс: `ge=0` / `gt=0`.

## LOW (services)

- `stem_separator.py:84, 229` — `asyncio.get_event_loop()` deprecated в 3.11 →
  `get_running_loop()`.
- `stem_separator.py:214` — side-channel pan-трюк не даёт настоящий instrumental
  (центровые инструменты теряются) — функциональная неточность.
- `video_renderer.py:26` — `progress_callback` нигде не используется (мёртвый
  параметр).
- `subtitle_generator.py:20` — `total_dur` вычислен и не используется;
  `forced_alignment.py:30–40` `_group_lyrics_lines` — dead code.
- `subtitle_generator.py:343` — SecondaryColour задаётся для karaoke, но `\k`-теги
  не генерируются → мёртвое поле.
- `bpm_detector.py:108` — в interpolation-ветке `starts.append(beats[-1])` без
  проверки `< duration` (несогласовано с фильтром выше).
- `routers/video.py:60` — `timestamps=""` → `float('')` → необработанный 500.
- `database.py:268` — delete_project не чистит render_quota и файлы рендеров на диске.
- `downloader.py:39` — duration по умолчанию 0 при отсутствии метаданных → риск
  деления на 0 ниже по стеку.

## ДУБЛИКАЦИЯ: ai_style.py / emotion_style.py / genre_template.py

**Ключевой вывод: `genre_template.py` и `emotion_style.py` — мёртвый код.**
Grep по всему бэкенду: `from services.genre_template import` /
`from services.emotion_style import` — **0 импортов**. Единственный живой путь —
`ai_style.analyze_style` (используется в `routers/features.py`).

Что дублируется (уже с дрейфом):
- `GENRE_TEMPLATE_MAP` ×2: `genre_template.py:20` vs `ai_style.py:31` — в ai_style
  добавлены ключи `hiphop`, `reggae` → словари уже разошлись.
- `MOOD_STYLE_MAP` ×2: `emotion_style.py:19` vs `ai_style.py:112` — пока идентичны,
  но дрейф неизбежен.
- `_mood_to_style`, `_genre_to_template`, HF-классификация (30s mid-sample),
  heuristic-fallback маппинги — продублированы целиком между ai_style и мёртвыми
  модулями (`ai_style.py:296–331` ≈ `emotion_style.py:164–198` +
  `genre_template.py:177–208`).
- Три отдельных кэша (`_style_cache`, `_emotion_cache`, `_genre_cache`) для одного
  и того же аудио.
- `genre_template.py:141` создаёт HF pipeline **на каждый вызов** (медленно) vs
  singleton в ai_style.
- Интеграция Music2Emo сделана двумя разными способами: ai_style — через `os.chdir`-хак
  (см. S-C1), emotion_style — прямой импорт.
- Дополнительно: `_heuristic_fallback` в ai_style и `_fallback_emotion` в
  emotion_style содержат идентичный dict `mood_map`.

**Рекомендация:** удалить `genre_template.py` и `emotion_style.py` (или оставить
re-export из ai_style на случай внешних callers); убрать `os.chdir` (S-C1) при
рефакторинге.

---

## Обновлённый сводный итог (весь проект, обе части ревью)

| Слой | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Routers + Security + Infra (Часть 1) | 5 | 7 | 10 | 5 |
| Services (Приложение B) | 2 | 8 | 13 | 9 |
| **Всего (уникальных)** | **7** | **15** | **23** | **14** |

### Топ-приоритет фиксов (обновлённый, объединённый):

| # | Фикс | Время | Закрывает |
|---|------|-------|-----------|
| 1 | Файл-серверы: strict basename + whitelist ext + dotfiles ban | ~30 мин | C1 |
| 2 | Double-offset: clip_start=0 для сегмента | ~15 мин | C3 |
| 3 | pbkdf2 пароли + RAPTOK_SECRET в compose | ~45 мин | C2 |
| 4 | asyncio.to_thread для render/subprocess | ~40 мин | C4 |
| 5 | Re-cut сегмента на reload | ~20 мин | C5 |
| 6 | **os.chdir убрать из ai_style.py** (Music2Emo ломает CWD!) | ~15 мин | S-C1 |
| 7 | **Кэш вокала по mtime+size** (чужой вокал в транскрипции!) | ~20 мин | S-C2 |
| 8 | try/finally work_dir + .ass cleanup + TimeoutExpired | ~30 мин | S-H1, S-H5 |
| 9 | Form-валидация (ge=0/gt=0) на audio + transcription | ~15 мин | S-H8, S-M13 |
| 10 | md5 вместо hash() + cleanup-крон tmp 24h | ~30 мин | H1 |

**Critical-пакет (1-7): ~3 часа работы.**