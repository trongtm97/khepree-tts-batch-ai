# GPT-SoVITS (Voice Lab)

| | |
|---|---|
| **Upstream** | [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) |
| **Runtime** | **ISOLATED_PYTHON** `runtimeId=gpt-sovits` under `userData/runtimes/gpt-sovits/` |
| **Engine id** | `gpt-sovits` (aliases `gptsovits`, `gpt_sovits`) |
| **Category** | **Voice Lab** — not in Batch beginner default list (`Tất cả`) |
| **Worker** | `python/engines/gpt_sovits/worker.py` |

## Scope

- **Inference only** — no training / fine-tuning in this milestone.
- Calls **`GPT_SoVITS.TTS_infer_pack.TTS`** (same core as `api_v2.py`) — **no Gradio WebUI**, no FastAPI server.
- **No Conda** for end-user — `pip install --target` + shallow git clone.
- Must **not** enter `python/requirements-bundle.txt`.

## Capabilities (upstream inference)

| Field | Role |
|-------|------|
| `ref_audio_path` | Reference audio (local) |
| `prompt_text` | Reference transcript |
| `prompt_lang` | Reference language |
| `text` | Target text |
| `text_lang` | Target language |
| GPT checkpoint | `init_t2s_weights` |
| SoVITS checkpoint | `init_vits_weights` |

Official language set (v2): `auto`, `en`, `zh`, `ja`, `yue`, `ko`, … — **no Vietnamese badge**. Unsupported VI override warns toward VieNeu.

## Voice profiles

Creating a profile requires acknowledgement:

> Tôi có quyền sử dụng giọng/reference audio này.

Stored under `userData/models/gpt-sovits/gpt-sovits-voice-profiles.json`.

## License

| Component | License |
|-----------|---------|
| GPT-SoVITS code | MIT (verify upstream) |
| Checkpoints | User-provided (community / own) — `attentionRequired` |

## Layout

```
userData/runtimes/gpt-sovits/
  site-packages/          # pip --target (no gradio)
  upstream/               # shallow clone RVC-Boss/GPT-SoVITS
  .khepree-gpt-sovits-runtime.json
userData/models/gpt-sovits/
  .khepree-gpt-sovits-infer.json   # install sentinel
  gpt-sovits-voice-profiles.json
```

Sources: [api_v2.py](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/api_v2.py), [TTS_infer_pack/TTS.py](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/GPT_SoVITS/TTS_infer_pack/TTS.py).
