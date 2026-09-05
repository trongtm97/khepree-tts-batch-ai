# Third-Party Notices — Khepree TTS Batch AI

This document separates **engine code**, **model weights**, **voice assets**, and **runtime dependencies**.
It is an attribution and attention map for release — not legal advice. Always verify upstream licenses before redistribution.

---

## How to read this file

| Column | Meaning |
|--------|---------|
| **Code** | Library / SDK / worker wrapper license |
| **Weights** | Neural network checkpoint / ONNX model license |
| **Voices** | Preset speakers / reference catalogs / community voices |
| **Attention** | Extra UI or redistribute caution |

Third-party / user-supplied checkpoints (e.g. GPT-SoVITS fine-tunes):

> **License determined by model provider.**

---

## Core (bundled / default)

### Khepree TTS Batch AI (this product)

| | |
|---|---|
| **Code** | Khepree product terms (app shell, UI, IPC, catalog integration) |
| **Weights** | n/a (hosts third-party engines) |
| **Attention** | Access gated by Khepree license/trial — see `docs/KHEPREE_INTEGRATION.md` |

### VieNeu Turbo + VieNeu Nano

| | |
|---|---|
| **Code** | [Apache-2.0](https://github.com/pnnbao97/VieNeu-TTS/blob/main/LICENSE) (VieNeu-TTS / `vieneu` SDK) |
| **Weights** | Apache-2.0 (v3 Turbo + v3 Nano + MOSS codec as shipped by VieNeu upstream) |
| **Voices** | Preset voices under VieNeu Apache-2.0 terms |
| **Attention** | Keep Apache-2.0 notice + attribution when redistributing. **VieNeu v4** (vieneu.io proprietary) is **not** used. |

### Edge TTS

| | |
|---|---|
| **Code** | MIT-style (`edge-tts` client) · Khepree wrapper |
| **Weights** | Online Microsoft Edge TTS service — **service terms of Microsoft** |
| **Voices** | Determined by Microsoft Edge neural voices catalog |
| **Attention** | Requires Internet. Not an offline model. Review Microsoft service terms for commercial use. |

### Bundled Python runtime / ffmpeg (installer)

| | |
|---|---|
| **Code** | CPython redistributable · ffmpeg (LGPL/GPL components depending on build) |
| **Weights** | n/a |
| **Attention** | Shipped under `resources/runtime` for clean Windows installs (no system Python/Node/Git/Conda required for **core**). |

---

## Optional engines (userData install — not core installer models)

### Supertonic 3

| | |
|---|---|
| **Code** | MIT (`supertonic-py` / Supertone Inc.) — SDK may be present in core Python site-packages |
| **Weights** | OpenRAIL (Supertone/supertonic-3 on Hugging Face) — **downloaded separately** |
| **Voices** | Packaged with weights / upstream voice set |
| **Attention** | **Separate code vs weights.** Installing weights is optional and must not land under Program Files / resources. |

### KittenTTS

| | |
|---|---|
| **Code** | Apache-2.0 (KittenML/KittenTTS) |
| **Weights** | Apache-2.0 (KittenML kitten-tts variants on Hugging Face) |
| **Voices** | Preset voices with weights |
| **Attention** | Isolated/optional download. |

### Kokoro

| | |
|---|---|
| **Code** | MIT (`kokoro-onnx`) |
| **Weights** | Apache-2.0 (hexgrad/Kokoro-82M lineage as packaged for ONNX) |
| **Voices** | Voice packs with model distribution |
| **Attention** | Optional. |

### Piper — **license attention**

| | |
|---|---|
| **Code** | **GPLv3** (OHF-Voice/piper1-gpl) |
| **Weights** | **Per-voice** `MODEL_CARD` on [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) — licenses vary |
| **Voices** | Same as weights; do not invent Vietnamese voices; catalog-driven |
| **Attention** | **Highlight before install.** UI sets `license.attentionRequired`. Redistribution of GPL runtime has copyleft implications — review before bundling into proprietary products. Khepree does **not** ship Piper in the default installer. |

### Chatterbox (Nano / Turbo)

| | |
|---|---|
| **Code** | MIT (resemble-ai/chatterbox) |
| **Weights** | MIT (ResembleAI chatterbox-nano / chatterbox-turbo) |
| **Voices** | Zero-shot clone from **user reference audio** — user must have rights |
| **Attention** | Isolated PyTorch runtime. Optional. |

### Qwen3-TTS 0.6B

| | |
|---|---|
| **Code** | Apache-2.0 (QwenLM/Qwen3-TTS) |
| **Weights** | Apache-2.0 (Qwen/Qwen3-TTS-12Hz-0.6B-*) |
| **Voices** | Preset speakers (Custom) / clone ref (Base) |
| **Attention** | Optional isolated runtime. Vietnamese **not** officially advertised. |

### Spark-TTS 0.5B

| | |
|---|---|
| **Code** | Apache-2.0 (SparkAudio/Spark-TTS) |
| **Weights** | Apache-2.0 (SparkAudio/Spark-TTS-0.5B) |
| **Voices** | Clone / create controls — no Gradio in product path |
| **Attention** | Optional. Vietnamese **not** official. |

### GPT-SoVITS (Voice Lab)

| | |
|---|---|
| **Code** | MIT (RVC-Boss/GPT-SoVITS — verify upstream tag) |
| **Weights** | **License determined by model provider** (user GPT + SoVITS checkpoints) |
| **Voices** | Reference audio — requires acknowledgement: *“Tôi có quyền sử dụng giọng/reference audio này.”* |
| **Attention** | Inference-only in app. Not in beginner Batch list. No Gradio WebUI. |

---

## Runtime dependency notes (core vs isolated)

| Area | Location | Notes |
|------|----------|-------|
| Core pip set | `python/requirements-bundle.txt` | ONNX / Edge / Supertonic SDK — **no Torch, no Gradio** |
| Isolated engines | `userData/runtimes/<id>/` | Piper, Chatterbox, Qwen3, Spark, GPT-SoVITS — pip `--target` |
| Optional weights | `userData/models/<engine>/` | Never under `resources/models` except bundled VieNeu |
| Node deps | `package.json` | Electron, electron-store, xlsx, etc. — see npm licenses |

---

## Installer contract (release)

- **Bundled models path:** `extraResources` → `models/vieneu` only.
- Optional engines must **not** be copied from a catch-all `models/` folder.
- Clean Windows end-user: no system Python / Node / Git / Conda required for **core** VieNeu + Edge (Edge still needs Internet).

---

*Generated for Khepree multi-engine release QA. Update when adding engines or changing upstream pins.*
