# Chatterbox (Nano + Turbo)

| | |
|---|---|
| **Upstream** | [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) (`chatterbox-tts`) |
| **Weights** | [ResembleAI/chatterbox-nano](https://huggingface.co/ResembleAI/chatterbox-nano) · [ResembleAI/chatterbox-turbo](https://huggingface.co/ResembleAI/chatterbox-turbo) |
| **Runtime** | **ISOLATED_PYTHON** `runtimeId=chatterbox` under `userData/runtimes/chatterbox/` |
| **Engine id** | `chatterbox` (aliases: `chatterbox-nano`, `chatterbox-turbo`) |
| **Variants** | `nano` · `turbo` (selector: one Chatterbox card) |
| **Worker** | `python/engines/chatterbox/worker.py` (shared) |

## Isolation

- PyTorch + `chatterbox-tts` must **not** enter `python/requirements-bundle.txt` / core Khepree Python.
- Nano and Turbo share one isolated runtime + site-packages; switching variant stops the worker (unload / free VRAM) then re-inits.
- No second runtime.

## Variants

| Variant | Role |
|---------|------|
| **Nano** | CPU-friendly English + expression tags |
| **Turbo** | English voice clone + stronger expression; GPU recommended, CPU supported |

Reference audio (clone): pick local file only — validated path/ext; no URL/upload.

Expression tags source: `added_tokens.json` (identical Nano/Turbo snapshot in `electron/data/chatterbox-nano-tags.json`).

## License

| Component | License |
|-----------|---------|
| chatterbox-tts / Nano · Turbo weights | MIT (Resemble AI) |

## Layout

```
userData/runtimes/chatterbox/
  site-packages/          # pip --target chatterbox-tts (+ torch)
  .khepree-chatterbox-runtime.json
userData/models/chatterbox/nano/
userData/models/chatterbox/turbo/
```
