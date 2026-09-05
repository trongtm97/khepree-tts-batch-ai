# Piper — optional component (OHF-Voice)

## Selected runtime (Windows / local / CPU)

| Item | Choice |
|------|--------|
| **Upstream** | [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts` on PyPI) |
| **Runtime layout** | **Isolated** site-packages under `userData/runtimes/piper/` (not core bundle) |
| **Why not native exe** | Current official releases ship **Python wheels** (e.g. `piper_tts-*-win_amd64.whl`). Standalone Windows `piper.exe` is not in the current official release assets. |
| **Voices** | Official catalog [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (`voices.json`) |
| **Default voice** | `en_US-lessac-medium` (documented example) |
| **Engine id** | `piper` |
| **Worker** | `python/engines/piper/worker.py` |

## Isolation / installer contract

- Piper is an **optional** component. Khepree does **not** bundle Piper into the default installer for this milestone.
- Do **not** add `piper-tts` to `python/requirements-bundle.txt`.
- Runtime + voice models live only under user storage (`userData/runtimes/piper`, `userData/models/piper/<voice>/`).
- Install/uninstall of Piper must not modify core VieNeu/Edge packages.

## License attention

- Engine/runtime: **GPLv3** (OHF-Voice `piper1-gpl` / COPYING). See upstream for full text.
- Individual voice models: each ships a `MODEL_CARD` — licenses vary; show per-voice when available.
- UI must warn before install. Do not invent legal conclusions beyond stating license identifiers and pointing to upstream texts.

`license.attentionRequired` / `licenseAttentionRequired`: **true**.

## Voice catalog

- Source of truth: bundled snapshot of official `voices.json` (refresh from Hugging Face when updating).
- Vietnamese voices exist in the official catalog (`vi_VN-*`) — list them when present; **do not** invent Vietnamese voices; **do not** hard-default to Vietnamese (default remains English example voice).

## Install layout

```
userData/runtimes/piper/
  site-packages/          # pip install --target piper-tts
  .khepree-piper-runtime.json
userData/models/piper/<voice-key>/
  <voice>.onnx
  <voice>.onnx.json
  MODEL_CARD
```
