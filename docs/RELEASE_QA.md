# RELEASE QA — Khepree multi-engine (Prompt 24)

**Date:** 2026-09-05  
**Scope:** Final QA + release hardening. **No new product features.**

---

## Automated gates (this workspace)

| Suite | Result |
|-------|--------|
| `npm run test:registry` (registry, pool, settings migrate, jobs isolation, nav, tts-tab, selector) | **PASS** |
| `npm run test:paths-models` | **PASS** |
| `npm run test:model-download` | **PASS** |
| `npm run test:engine-runtime` | **PASS** |
| `npm run test:hardware` | **PASS** (host: no NVIDIA) |
| `npm run test:benchmark` | **PASS** |
| `npm run test:supertonic` … `test:gpt-sovits` | **PASS** |
| `npm run test:khepree` | **PASS** |
| `npm run test:installer-audit` | **PASS** (after hardening) |

### Covered by automation

- Job isolation (per-engine JSON; no cross-leak; corrupt → empty)
- Settings schema migrate / engineSettings buckets
- Engine registry metadata + aliases + Voice Lab category exclusion from beginner “Tất cả”
- Pool create / shutdown / unload
- Optional package markers (not in core bundle paths)
- Hardware advisor (incl. no NVIDIA)
- Benchmark corpus / fingerprint / RTF math / AUTO no-download
- Khepree catalog + auth protocol selfchecks
- Installer contract: `extraResources` → `models/vieneu` only; core reqs without torch/gradio

### Not fully automated here (manual / clean-lab)

- UI: TXT / Excel / Folder import, preview, batch pause/resume/stop/retry/run-errors, history
- Live engine switching with real synth + RAM/VRAM process monitor
- Clean Windows VM without Python/Node/Git/Conda
- Full NSIS rebuild after `models/vieneu` narrowing (size re-measure)
- Disk-full / OOM / download-interrupt on real hardware

---

## Installer audit

### Hardening applied

1. `package.json` `extraResources`: **`models/vieneu` only** (was entire `models/`).
2. `python/requirements-bundle.txt`: **removed unused `gradio`** (core workers never imported it).
3. `THIRD_PARTY_NOTICES.md` added; README engine table updated (no fake stars).

### Size snapshot (dev machine, 2026-09-05)

| Component | Approx size |
|-----------|-------------|
| `models/vieneu` (Turbo + Nano + codec) | **~1,595 MB** uncompressed |
| `resources/runtime` (embedded Python + ffmpeg) | **~182 MB** |
| `python/` workers + req files | **~0.1 MB** |
| Prior NSIS artifact `release/*Setup.exe` (legacy name ChapMee) | **~1,012 MB** compressed |
| Optional engines (Torch stacks) | **Not in installer** — tens of GB possible under `userData` after user install |

**Expected core installer:** ~VieNeu + runtime + Electron shell ≈ **order of 1 GB compressed** (re-run `npm run build:win` to refresh artifact after narrowing).

---

## Regression checklist (manual)

### Core engines

- [ ] VieNeu Turbo — init, voices, preview, batch, pause, resume, stop, retry, run errors
- [ ] VieNeu Nano — same; confirm 24 kHz path / separate jobs file
- [ ] Edge — online synth; offline fails gracefully

### Core product

- [ ] Import TXT / Excel / Folder
- [ ] Preview + history
- [ ] Job save/load per engine
- [ ] Settings persist (silence, workers, device)
- [ ] Khepree login / trial / blocked synthesize messaging

### Switching

- [ ] VieNeu → Supertonic → Kitten → Kokoro → Chatterbox → VieNeu
- [ ] Edge → local engine
- [ ] Confirm jobs/settings/output format isolation; worker unload; no orphan python.exe

### Failure

- [ ] Missing / corrupted model → clear error, no crash
- [ ] Missing optional runtime → install CTA, no auto-download on Generate
- [ ] Worker crash → recoverable / logged
- [ ] Invalid ref audio (URL / missing) → rejected
- [ ] Download cancel / no Internet (optional) / no NVIDIA (advisor MAY_BE_SLOW / NOT_RECOMMENDED)

### Clean Windows

- [ ] Install NSIS on machine **without** Python, Node, Git, Conda
- [ ] Core VieNeu Turbo/Nano runs offline
- [ ] Optional install still works (needs network for download)

---

## Release verdict inputs

See chat / release notes for numbered items 1–10 (architecture, engines, tests, sizes, optional downloads, limitations, licenses, bugs, beginner defaults, holdbacks).
