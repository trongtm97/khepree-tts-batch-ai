# Qwen3-TTS 0.6B

| | |
|---|---|
| **Upstream** | [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) (`qwen-tts`) |
| **Weights** | [0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) · [0.6B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) |
| **Runtime** | **ISOLATED_PYTHON** `runtimeId=qwen3` under `userData/runtimes/qwen3/` |
| **Engine id** | `qwen3` |
| **Variants** | `0.6b-custom` · `0.6b-base` |
| **Worker** | `python/engines/qwen3/worker.py` |

## Scope

- **Only 0.6B** in this product slice — not 1.7B, not VoiceDesign.
- PyTorch / `qwen-tts` / Transformers must **not** enter `python/requirements-bundle.txt`.
- Switching Custom ↔ Base stops the worker (unload / free VRAM) then re-inits.

## Variants

| Variant | Official API | Role |
|---------|--------------|------|
| **0.6b-custom** | `generate_custom_voice` | 9 preset speakers + optional `instruct` |
| **0.6b-base** | `generate_voice_clone` | Local `ref_audio` (+ optional `ref_text`) |

VoiceDesign stays out of UI/capabilities (`voiceDesign: false`) — upstream VoiceDesign is 1.7B.

## Languages

Official (HF / README): Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian (+ Auto).

**Vietnamese is not official.** UI may offer *Vietnamese (Unsupported — thử nghiệm)* with warning:

> Model này không hỗ trợ tiếng Việt chính thức. Khepree khuyên dùng VieNeu hoặc Supertonic.

No Vietnamese badge.

## License

| Component | License |
|-----------|---------|
| qwen-tts / 0.6B weights | Apache-2.0 (Qwen) |

## Layout

```
userData/runtimes/qwen3/
  site-packages/          # pip --target qwen-tts (+ torch)
  .khepree-qwen3-runtime.json
userData/models/qwen3/0.6b-custom/
userData/models/qwen3/0.6b-base/
```

Sources: [Qwen3-TTS README](https://github.com/QwenLM/Qwen3-TTS), HF model cards for 0.6B CustomVoice / Base (Jan 2026).
