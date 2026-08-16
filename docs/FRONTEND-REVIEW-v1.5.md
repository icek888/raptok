# RapTok Frontend — Code Review Report

**Date:** 2026-08-16  
**Version:** v1.5  
**Stack:** React 19.2 + Vite 8 + TypeScript 6 + TailwindCSS 4 + lucide-react  
**Files reviewed:** 12 source files, ~1,700 LOC  

---

## ✅ What Works Well

### Architecture
- **Clean wizard pattern** — 4-step flow (Input → Fragments → Subtitles → Render) with `canProceed()` gating
- **Well-typed API client** — every method has explicit return types
- **Comprehensive type definitions** — `types.ts` covers all domain entities
- **Sensible component decomposition** — each step gets its own component, `TimelinePreview` extracted as reusable widget
- **Strict TypeScript config** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`

### Type Safety
- **Zero `any` in application code** — only in `api/client.ts` helpers, immediately narrowed by typed callers
- **Zero `@ts-ignore` / `@ts-expect-error`** — clean
- **Discriminated unions** — `VideoSource`, `SubtitleStyle.position` properly typed
- **No `dangerouslySetInnerHTML` / `innerHTML` / `eval()`** — zero XSS surface

### UX/UI
- **Polished dark theme** — consistent palette, custom scrollbar, gradient text, glow effects
- **Loading states** — every async op shows spinner + disables button
- **Error display** — `InputPanel` and `RenderPanel` show red error boxes
- **Real-time karaoke preview** — word-by-word highlighting, color transitions, scale animations
- **Checklist in RenderPanel** — pre-render summary
- **Collapsible sync panel and word editor** — prevents UI overload

### Security
- **No API keys or secrets** in codebase
- **No XSS attack surface** — all user content rendered via JSX auto-escape
- **File upload restricted** — `accept=".mp3,audio/*"` on input
- **GitHub link uses `rel="noopener"`**

---

## ⚠️ Issues Found

### 🔴 Critical (2)

| # | Issue | File | Description |
|---|---|---|---|
| 1 | **No error boundaries** | main.tsx, App.tsx | Any render crash → white screen, no recovery. Data loss for multi-step wizard. |
| 2 | **No abort/cancel for API calls** | FragmentEditor, SubtitleEditor, RenderPanel | No `AbortController`. Transcribe (10-30s) can't be cancelled. State updates on unmounted components. |

### 🟠 High (4)

| # | Issue | File | Description |
|---|---|---|---|
| 3 | **Errors swallowed silently** | FragmentEditor:47,62,81,112; SubtitleEditor:63,125,143,160 | `console.error(e)` only — user sees spinner disappear and nothing happen. No retry option. |
| 4 | **727-line god component** | SubtitleEditor.tsx | 15+ `useState` hooks. Manages transcription, word splitting, audio, playback, range, sync, word edit, style, karaoke mode, subtitles, timeline. |
| 5 | **useEffect redundant calls** | SubtitleEditor:53-70 | `onAudioStartChange` called twice on initial load. Fragile if parent recreates callback. |
| 6 | **Unthrottled API calls on word edit** | SubtitleEditor:172-213 | `updateWordTiming` / `deleteWord` / `insertWord` → immediate `api.wordSplitSubtitles()` on every keystroke. Race conditions + server load + flickering. |

### 🟡 Medium (10)

| # | Issue | File | Description |
|---|---|---|---|
| 7 | **StyleEditor unused** | StyleEditor.tsx | 140 LOC dead code. Duplicated by inline controls in SubtitleEditor. |
| 8 | **App.css dead boilerplate** | App.css | Vite template leftovers. Imported nowhere. |
| 9 | **formatTime duplicated** | InputPanel:151, FragmentEditor:292 | Identical implementation in two files. |
| 10 | **Color conversion duplicated 3x** | StyleEditor:16-33, TimelinePreview:34-42, SubtitleEditor:476-501 | ASS ↔ hex reimplemented three times. |
| 11 | **Local AudioInfo shadows type** | TimelinePreview:5-13 | Redefines interface instead of importing from types.ts. |
| 12 | **displayMode typed as string** | RenderPanel:14 | Widened from union type — can't catch invalid modes at compile time. |
| 13 | **api.health() URL fragile** | client.ts:31 | `API_BASE.replace('/api', '/health')` breaks if API_BASE changes. No `r.ok` check. |
| 14 | **No URL validation** | InputPanel:22-34 | Only `url.trim()` — no format/protocol/domain check. |
| 15 | **index.html title "frontend"** | index.html:7 | Vite default. Should be "RapTok". |
| 16 | **package.json version "0.0.0"** | package.json:4 | Not tracking version. |

### 🟢 Low (6)

| # | Issue | File | Description |
|---|---|---|---|
| 17 | **handleReroll stuck loading** | FragmentEditor:85-89 | If `selectFragments` throws, `setRerolling(false)` never called. |
| 18 | **Stale thumbnails** | FragmentEditor:33 | Old thumbnails remain on fetch failure. |
| 19 | **Unused audioUrl prop** | TimelinePreview:18,46 | Prop declared but never used. |
| 20 | **style prop no default** | TimelinePreview:29-30 | `displayMode` has default, `style` doesn't — fragile null checks. |
| 21 | **Array index as key** | SubtitleEditor:603, TimelinePreview:315 | Anti-pattern with insert/delete operations. |
| 22 | **activeWordIdx by start time** | TimelinePreview:138 | `findIndex(w.start === activeWord.start)` — wrong if two words share start time. |

---

## 📋 Missing Features

### High Priority
- **Error boundaries** — no recovery from render crashes
- **Request cancellation** — `AbortController` for long operations
- **User-facing errors** in FragmentEditor/SubtitleEditor
- **Debounce** on word-timing live regeneration

### Medium Priority
- **Offline support** — no `navigator.onLine` check, no localStorage persistence
- **Undo/redo** — no history stack for word/subtitle edits
- **Session persistence** — refresh = lost all state
- **Render progress** — no progress bar or ETA
- **Mobile responsive** — step indicator overflows, timeline doesn't stack, word editor overflows

### Low Priority
- **Accessibility** — minimal ARIA, no `aria-label` on icon buttons
- **Code splitting** — no `React.lazy()` for step components
- **Environment config** — `API_BASE` hardcoded
- **Tests** — zero test coverage, no test framework
- **SEO metadata** — no meta description, no Open Graph

---

## 💡 Recommendations

### Immediate (1-2 days)
1. Add `ErrorBoundary` wrapper in App.tsx with "Reset" button
2. Add error state to FragmentEditor + SubtitleEditor (mirror InputPanel pattern)
3. Debounce live subtitle regeneration (500ms or on blur)
4. Fix `index.html` title → "RapTok — TikTok Content Maker for Rappers"
5. Delete `App.css`, use or delete `StyleEditor`

### Short-term (1 week)
6. Extract shared utilities: `formatTime`, `assToHex`/`hexToAss` → `src/utils/`
7. Add `AbortController` to transcribe, render, beat sync
8. Split `SubtitleEditor` into: `AudioRangeSelector`, `SyncAdjustmentPanel`, `WordTimingEditor`, `SubtitleLineList`, `StyleControls`, `KaraokeModeSelector`
9. Fix `displayMode` typing in RenderPanel
10. Add `aria-label` to icon-only buttons

### Medium-term (2-4 weeks)
11. Session persistence via `localStorage`
12. Undo/redo (history stack)
13. Render progress polling
14. Add `vitest` + `@testing-library/react`
15. Mobile responsiveness improvements
16. Lazy-load step components

---

## 📊 Summary

| Metric | Score | Notes |
|---|---|---|
| Type Safety | 9/10 | Zero `any` in app code, strict config |
| Security | 9/10 | No XSS, no secrets, upload restricted |
| UX/UI | 7/10 | Polished but errors silent in key components |
| Performance | 5/10 | Unthrottled API calls, no abort, no lazy load |
| Error Handling | 3/10 | No error boundaries, errors swallowed |
| Test Coverage | 0/10 | No tests |
| Accessibility | 2/10 | Minimal ARIA |
| Mobile | 4/10 | Designed for desktop |

**Overall: 5/10** — Solid foundation, good types, needs resilience work.

---

*Generated by Hermes Agent (subagent review) — 2026-08-16*