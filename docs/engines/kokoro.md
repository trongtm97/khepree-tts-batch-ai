# Kokoro — runtime choice

## Selected runtime (Windows / local / CPU)

| Item | Choice |
|------|--------|
| **Runtime** | [`kokoro-onnx`](https://github.com/thewh1teagle/kokoro-onnx) (PyPI) + existing **ONNX Runtime** (CPU) |
| **Model** | Kokoro v1.0 ONNX from `model-files-v1.1` release |
| **Default variant** | **int8** (`kokoro-v1.0.int8.onnx` + `voices-v1.0.bin`) — smaller footprint |
| **Optional variant** | **fp32** (`kokoro-v1.0.onnx` + same voices) — higher fidelity |
| **Engine id** | `kokoro` |
| **Worker** | `python/engines/kokoro/worker.py` |

## Why this stack

- Official `hexgrad/kokoro` PyTorch path is heavier and not preferred for this app’s core ONNX/CPU line.
- `kokoro-onnx` is MIT, ships on PyPI, targets CPU ONNX, and is the current stable local path for Windows.
- Models are **optional** assets via Model Download Manager — never downloaded during `synthesize`.
- Prefer **int8** by default (~80MB class) for common PCs; fp32 remains available.

## Languages / product copy

Official voice set (see upstream `VOICES.md`) covers English (US/UK) plus JA/ZH/ES/FR/HI/IT/PT — **no Vietnamese**.

Product marketing: **English nhanh · Nhẹ · Local**. Do **not** advertise Vietnamese for this engine.

## Licenses

| Layer | License |
|-------|---------|
| `kokoro-onnx` runtime | MIT |
| ONNX Runtime (dependency) | MIT |
| Kokoro-82M model weights | Apache-2.0 ([hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)) |

## System note (Windows)

Phonemization needs **espeak-ng** available to the phonemizer used by `kokoro-onnx`. Install espeak-ng on the machine if init fails with espeak-related errors.

## Install layout

```
userData/models/kokoro/int8/
  kokoro-v1.0.int8.onnx
  voices-v1.0.bin
userData/models/kokoro/fp32/
  kokoro-v1.0.onnx
  voices-v1.0.bin
```

Python package (optional, not in core bundle): `python/requirements-kokoro.txt`.
