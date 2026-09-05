# MULTI_ENGINE_BASELINE — Khepree TTS Batch AI v2.x

**Milestone:** P0 — Baseline / Safety Checkpoint  
**Date:** 2026-09-05  
**Scope:** Document current behavior only. No intentional product behavior change in P0.  
**STOP:** This document ends P0. P1+ must not start until this baseline is accepted.

---

## 0. Checkpoint intent

This file is the regression contract for multi-engine work (prompt pack P0→P5).

- **Source of truth for product behavior:** VieNeu Turbo, VieNeu Nano, Edge must keep working (init, voices, preview, batch, pause/resume, retry, save jobs/output).
- **Source of truth for stack:** Electron + Vite; do not rewrite the app or swap frameworks.
- **Installer contract:** VieNeu Turbo + Nano + codec stay offline-bundled; do not bundle future optional models into the installer in early milestones.

---

## 1. Architecture (as of this checkpoint)

### 1.1 Stack

| Layer | Tech |
|-------|------|
| Shell | Electron (`electron/main.cjs`, `electron/preload.cjs`) |
| UI | Vite + vanilla JS (`batch.html`, `src/batch/*`) |
| TTS workers | Python JSON-line processes |
| Pool | `electron/engine-pool.cjs` (`EnginePool`) |
| License/access | Khepree (`requireKhepreeAccess()` on synthesize) |

### 1.2 Engine path (current working tree)

```
Renderer (BatchController / EngineService)
  → preload api (tts:* | edge:* | engine:*)
  → electron/engine-ipc.cjs
  → electron/engine-registry.cjs
  → electron/engine-pool-manager.cjs  (Map<engineId, EnginePool>)
  → EnginePool
  → VieNeuEngine | EdgeTTSEngine
  → python/tts_worker.py | python/edge_tts_worker.py
```

**Note:** A partial multi-engine refactor already exists in the working tree (registry, pool manager, generic IPC, engine selector UI). P0 does **not** revert it; it freezes what must not regress and records divergences from the original P0→P5 pack assumptions (see §9).

### 1.3 Core engine classes (unchanged roles)

| Class | File | Worker | Modes / notes |
|-------|------|--------|----------------|
| `VieNeuEngine` | `electron/vieneu-engine.cjs` | `python/tts_worker.py` | `v3turbo`, `v3nano` |
| `EdgeTTSEngine` | `electron/edge-engine.cjs` | `python/edge_tts_worker.py` | voice modes `vietnamese` / `multilingual` |
| `EnginePool` | `electron/engine-pool.cjs` | — | acquire / release / resize / withEngine |

Both engines speak **JSON lines** over stdin/stdout (`ping`, `init`, `synthesize`, `shutdown`; VieNeu also `list_voices`).

---

## 2. Confirmed product behaviors

### 2.1 VieNeu Turbo

| Item | Value |
|------|--------|
| Worker mode | `v3turbo` |
| Output | WAV |
| Engine class | `VieNeuEngine` |
| Worker | `tts_worker.py` (JSON-line) |
| Pool | Dedicated pool slot key in pool manager (see §9 for id) |
| Features in UI | voice list, preview, batch, pause, resume, stop, retry / run errors, save audio, save jobs |

### 2.2 VieNeu Nano

| Item | Value |
|------|--------|
| Worker mode | `v3nano` |
| Output | WAV |
| Engine class | **same** `VieNeuEngine` (mode switch, not a second class) |
| Pool | Separate pool from Turbo (must stay isolated) |

### 2.3 Edge TTS

| Item | Value |
|------|--------|
| Output | MP3 |
| Network | Online (requires internet at synthesize time) |
| Engine class | `EdgeTTSEngine` |
| Worker | `edge_tts_worker.py` |
| UI | voice mode select + rate / pitch / volume (Edge-style), not VieNeu speed slider |

### 2.4 BatchController capabilities that must survive

Import (folder / Excel / TXT), grid CRUD, search/filter/sort, preview, batch concurrency (`settings.batchWorkers`), pause/resume/stop, retry / run errors, output dir, history, per-engine saved jobs.

---

## 3. IPC surface

### 3.1 Legacy (must keep working)

| Channel | Role |
|---------|------|
| `tts:listModels` | VieNeu mode list |
| `tts:init` | `{ mode, engineOptions }` |
| `tts:synthesize` | `{ text, voice, mode, options }` → WAV buffer |
| `tts:reload` | restart VieNeu pools / re-init turbo path |
| `tts:saveAudio` | write WAV/MP3 to disk |
| `edge:init` | `{ voiceMode, pythonPath }` |
| `edge:synthesize` | `{ text, voice, options }` → MP3 buffer |
| `edge:reload` | restart Edge pool |

Synthesize paths go through **`requireKhepreeAccess()`** — do not bypass.

### 3.2 Generic (already present in working tree)

| Channel | Role |
|---------|------|
| `engine:list` | public catalog (+ install state) |
| `engine:init` | `{ engineId, options }` |
| `engine:synthesize` | `{ engineId, text, voice, options }` |
| `engine:reload` | unload + re-init |
| `engine:unload` | stop pool for engine |
| `engine:getStatus` | pool/install snapshot |

Preload exposes: `engineList`, `engineInit`, `engineSynthesize`, `engineReload`, `engineUnload`, `engineGetStatus` (plus legacy `tts*` / `edge*`).

**P1 pack gap:** pack also asks for `engine:get` and `engine:status` naming; working tree has `engine:getStatus` only — reconcile in P1 without breaking preload consumers.

### 3.3 Jobs / settings / shell (related)

- `jobs:save` / `jobs:load`
- `settings:load` / `settings:save`
- Import / chunk / dialog / history / Khepree channels (unchanged by engine work)

---

## 4. Job storage

### 4.1 Historical / user-facing legacy files (must remain readable)

| Logical engine (pack P0) | Legacy file |
|--------------------------|-------------|
| Turbo (`vieneu`) | `tts-jobs-vieneu.json` (+ ultra-legacy `tts-jobs.json` seeds **Turbo only**) |
| Nano (`v3nano`) | `tts-jobs-v3nano.json` |
| Edge (`edge`) | `tts-jobs-edge.json` |

Location: `app.getPath('userData')/data/`.

**Isolation rule (proven by `scripts/jobs-isolation.selfcheck.cjs`):**  
`tts-jobs.json` must **never** seed Nano or Edge. Seeding both VieNeu engines duplicates prompts across workspaces.

### 4.2 Working-tree canonical files (post partial refactor)

Canonical writes currently prefer:

- `tts-jobs-vieneu-turbo.json`
- `tts-jobs-vieneu-nano.json`
- `tts-jobs-edge.json`

with migration **from** the legacy filenames in §4.1 (`electron/jobs-store.cjs`).

### 4.3 Pack P0 ID contract (important)

Prompt pack P0 states legacy engine/job IDs that must not change in the first milestone:

- `vieneu`
- `v3nano`
- `edge`

**Working tree divergence:** registry/UI currently use canonical ids `vieneu-turbo` / `vieneu-nano` / `edge`, with aliases `vieneu` → turbo and `v3nano` → nano.  
**P1 must treat pack IDs as the product contract unless an explicit decision supersedes this baseline:** prefer registering `vieneu` / `v3nano` / `edge` as canonical registry ids (or keep dual-read forever). Do not drop ability to load §4.1 files.

---

## 5. Settings (flat, electron-store)

Defaults live in `src/batch/settings.js` (mirrored concepts in `main.cjs` getters).

| Area | Keys |
|------|------|
| Output | `outputDir` |
| VieNeu model hint | `model` (`v3turbo` \| `v3nano`) |
| Voices | `voice`, `voiceNano`, `edgeVoice`, `edgeVoiceMode` |
| VieNeu synth | `speed`, silence\* , `splitByLine`, `stripHash`, `useSeaG2p`, `volume`, `pauseScale` |
| Edge synth | `edgeRate`, `edgePitch`, `edgeVolume` |
| Runtime | `pythonPath`, `device`, `threads`, `hfToken` |
| Batch | `batchWorkers` (1–8; drives pool size) |
| Chunk | `chunkMaxChars`, `chunkAutoOnImport` |
| UI (working tree) | `selectedBatchEngine` |

P4 will introduce `engineSettings` nesting; until then **flat keys remain authoritative**.

---

## 6. Model paths & offline env

### 6.1 `electron/paths.cjs`

| Helper | Behavior |
|--------|----------|
| `getAppRoot()` | packaged → `process.resourcesPath`; else repo root |
| `getModelsDir()` | `{appRoot}/models` — **bundled VieNeu lives here** |
| `getUserModelsDir()` | `app.getPath('userData')/models` — reserved for optional models (P2) |
| `getPythonDir()` / `getWorkerScript()` | `{appRoot}/python` |
| `resolvePythonCmd()` | bundled runtime in packaged builds; system Python in dev |
| `buildWorkerEnv(extra)` | sets `KHEPREE_TTS_ROOT`, UTF-8, ffmpeg paths, `PYTHONPATH` |

### 6.2 Packaged inference offline flags (MUST KEEP for bundled inference)

When `app.isPackaged`, `buildWorkerEnv()` sets:

- `HF_HUB_OFFLINE=1`
- `HF_DATASETS_OFFLINE=1`
- `TRANSFORMERS_OFFLINE=1`

These protect **offline inference** of bundled VieNeu.  
P2 must **not** reuse this env for optional model downloaders (separate network-capable env).

### 6.3 On-disk VieNeu layout (bundled)

```
models/vieneu/
  model-config.json
  v3turbo/onnx/…          # Turbo ONNX + shared data
  codec/…                 # MOSS / codec ONNX
  v3nano/…                # Nano ONNX set
```

Markers used by prepare/ensure scripts include Turbo prefill ONNX and Nano `vector_estimator.onnx`.

---

## 7. Python runtime & installer behavior

### 7.1 Requirements

| File | Role |
|------|------|
| `python/requirements.txt` | Dev: `vieneu`, `sea-g2p`, `edge-tts`, `pydub` |
| `python/requirements-bundle.txt` | Packaged core: onnxruntime + audio/token stack + sea-g2p + edge-tts (+ note: no Torch/Chatterbox) |

`prepare-runtime.mjs` installs bundle deps and pins `vieneu==3.5.4` with `--no-deps` for the packaged Python.

### 7.2 Scripts

| Script | Role |
|--------|------|
| `npm run ensure:models` | `scripts/download-vieneu-model.py` — Turbo + Nano + codec |
| `npm run prepare:runtime` | Bundle Python + verify models offline-complete |
| `npm run build:win` / `build:mac` | ensure models → vite build → prepare runtime → electron-builder |

### 7.3 electron-builder `extraResources` (current)

```json
{ "from": "python", "to": "python" },
{ "from": "models", "to": "models" },
{ "from": "resources/runtime/${platform}", "to": "runtime" }
```

**Risk for later milestones:** `{ "from": "models", "to": "models" }` copies the entire `models/` tree. P2 should narrow to `models/vieneu` so optional trees are never shipped by accident.

### 7.4 Installer offline guarantee

Packaged app must run VieNeu **without** HuggingFace downloads at synthesize time (offline env + complete model tree). Edge still needs network.

---

## 8. UI baseline (working tree)

- Sidebar: single **Batch** nav item (legacy Turbo/Nano/Edge nav labels removed; aliases `nano` / `edge` still route into Batch + engine).
- One `#tab-batch` containing:
  - `#engine-selector` (cards from `engine:list`)
  - three workspaces still present: `#batch-workspace`, `#nano-workspace`, `#edge-workspace` (show/hide by selected engine)
- Settings hub still split VieNeu / Edge panels.
- `BatchController` uses capability metadata (`engine-meta.js`) rather than `isEdge` / `isNano` flags.
- Renderer services: `engine-service.js` + thin wrappers `tts-service.js` / `edge-service.js`.

P4 pack still wants a true single-controller `switchEngine()` and eventual removal of duplicate workspace markup after regression passes.

---

## 9. Divergence register (pack vs working tree)

| Topic | Pack P0 assumption | Working tree at checkpoint | Action for P1 |
|-------|--------------------|----------------------------|---------------|
| Engine ids | Canonical `vieneu`, `v3nano`, `edge` | Canonical `vieneu-turbo`, `vieneu-nano`, `edge` (+ aliases) | Re-align to pack ids **or** ADR accepting new ids with permanent legacy job read |
| Pool variables | `vieneuPool` / `nanoPool` / `edgePool` | Already `EnginePoolManager` Map | Keep Map; finish wrappers/tests as pack specifies |
| Registry file | Create in P1 | Already exists | Extend metadata to pack schema; do not delete |
| Generic IPC | Add in P1 | Mostly present | Add gaps (`engine:get`, naming); keep legacy wrappers |
| JSON worker base | P1 new engines | Not present | Add `json-worker-engine.cjs` without forcing VieNeu/Edge migrate |
| UI selector | P4 | Partially present | Stabilize in P4; do not expand scope in P1 |
| `getUserModelsDir` | P2 | Already stubbed | Wire fully in P2 (custom `modelStorageDir`, builder narrow) |

---

## 10. Test baseline (executed 2026-09-05)

### 10.1 Commands run

```text
npm run test:selfcheck
npm run test:engines
```

### 10.2 Results

| Suite | Result |
|-------|--------|
| `electron/engine-registry.selfcheck.cjs` | PASS |
| `scripts/jobs-isolation.selfcheck.cjs` | PASS |
| `src/batch/nav-alias.selfcheck.cjs` | PASS |
| `electron/khepree/catalog.selfcheck.cjs` | PASS |
| `electron/khepree/auth-protocol.selfcheck.cjs` | PASS |
| `src/batch/khepree-access-messages.selfcheck.mjs` | PASS |
| `npm run test:engines` (Edge + Turbo + Nano via pool manager) | PASS |

`test:engines` observed outputs at checkpoint:

- Edge: `vietnamese`, 2 voices  
- VieNeu Turbo: `v3turbo`, 23 voices  
- VieNeu Nano: `v3nano`, 11 voices  

### 10.3 Known non-blocking warnings (BASELINE NOTES — not treated as blockers)

1. **VieNeu stderr — perth watermarker:**  
   `Watermarker init failed … module 'perth' has no 'PerthImplicitWatermarker'`  
   Pre-existing packaging/dependency skew. Synthesis still succeeds.  
   **Classification:** BASELINE WARNING (do not “fix” as part of multi-engine unless scoped).

2. **HF Hub unauthenticated warning in dev:** appears during engine init in unpackaged runs. Packaged inference must remain offline via §6.2.  
   **Classification:** BASELINE WARNING for dev; packaged offline is a hard requirement.

### 10.4 Not covered by automated baseline (manual smoke still required before calling a later milestone done)

Full UI path: import → preview → batch → pause/resume → retry → save output for all three engines inside the Electron window. P0 did not re-run that manual matrix in this document write.

---

## 11. Files P1 is allowed/expected to touch

P1 = Engine registry completion + pool manager polish + JSON-line base for **new** engines + generic IPC completeness + preload + tests.  
**Do not** implement P2 downloaders, P3 hardware UI, or delete Batch workspaces in P1.

### 11.1 Create / extend (primary)

- `electron/engine-registry.cjs` (extend schema toward pack; id policy per §9)
- `electron/engine-pool-manager.cjs` (already present — verify API vs pack)
- `electron/json-worker-engine.cjs` (**new** — for future engines only)
- `electron/engine-ipc.cjs` (gaps + stable wrappers)
- `electron/engine-registry.selfcheck.cjs` / related selfchecks
- `electron/preload.cjs` (generic API completeness)
- `scripts/test-engines.cjs` (generic init/synth coverage)

### 11.2 Edit carefully (compatibility)

- `electron/main.cjs` (wire only; no feature rewrite)
- `electron/jobs-store.cjs` (only if id policy changes — must keep legacy file reads)
- Possibly thin updates to `src/batch/engine-meta.js` / `engine-service.js` if registry public fields change

### 11.3 Do **not** change in P1 (unless proven required for compile)

- `electron/engine-pool.cjs` (keep; no rewrite)
- Forced refactor of `vieneu-engine.cjs` / `edge-engine.cjs` onto JSON base
- `python/tts_worker.py` / `edge_tts_worker.py` algorithms / text normalize
- `scripts/prepare-runtime.mjs` / `download-vieneu-model.py` bundle set
- `python/requirements-bundle.txt` (no Torch / optional heavy deps)
- License/Khepree flow
- Full BatchController rewrite / wholesale `batch.html` deletion of workspaces (that is P4)

### 11.4 Explicit non-goals until later milestones

| Milestone | Deferred |
|-----------|----------|
| P2 | Optional download manager, narrow electron-builder models copy, inference vs network env split |
| P3 | Hardware profile / compatibility advisor UI |
| P4 | Single BatchController.switchEngine, settings.engineSettings, final nav cleanup |
| P5 | Isolated Python runtimes for Chatterbox/Qwen/etc. |

---

## 12. P0 exit criteria checklist

- [x] Architecture / IPC / jobs / settings / paths / runtime / installer documented  
- [x] Offline HF env flags documented as must-keep for bundled inference  
- [x] Tests executed and recorded  
- [x] Warnings classified (not silently “fixed”)  
- [x] P1 file touch list written  
- [x] No intentional product behavior change as part of writing this baseline  
- [x] **STOP after P0** — do not start P1 in the same turn as accepting this file  

---

## 13. Acceptance note for humans

If P1 begins: first decision is **engine id canonicalization** (§9). Wrong choice here breaks saved jobs for existing users. Prefer pack ids `vieneu` / `v3nano` / `edge` unless product explicitly accepts `vieneu-turbo` / `vieneu-nano` with permanent migration.
