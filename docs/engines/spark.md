# Spark-TTS 0.5B

| | |
|---|---|
| **Upstream** | [SparkAudio/Spark-TTS](https://github.com/SparkAudio/Spark-TTS) |
| **Weights** | [SparkAudio/Spark-TTS-0.5B](https://huggingface.co/SparkAudio/Spark-TTS-0.5B) |
| **Runtime** | **ISOLATED_PYTHON** `runtimeId=spark` under `userData/runtimes/spark/` |
| **Engine id** | `spark` (alias `spark-tts`) |
| **Worker** | `python/engines/spark/worker.py` |

## Scope

- **Only 0.5B** — official SparkAudio checkpoint.
- **No Gradio** in product path (CLI/API `SparkTTS.inference` only).
- **No Conda** for end-user — `pip install --target` into isolated site-packages + shallow git clone of upstream `sparktts/` + `cli/`.
- Must **not** enter `python/requirements-bundle.txt`.

## Capabilities (official)

| Mode | API | Controls |
|------|-----|----------|
| **Zero-shot clone** | `inference(text, prompt_speech_path, prompt_text=…)` | Local reference audio (+ optional transcript) |
| **Voice creation** | `inference(text, gender=…, pitch=…, speed=…)` | `male`/`female`; pitch/speed: `very_low`…`very_high` |

Languages official: **Chinese**, **English**. No Vietnamese badge; unsupported override shows VieNeu/Supertonic warning.

## License

| Component | License |
|-----------|---------|
| Spark-TTS code / 0.5B weights | Apache-2.0 (SparkAudio) |

## Layout

```
userData/runtimes/spark/
  site-packages/          # pip --target (torch, transformers, … — no gradio)
  upstream/               # shallow clone SparkAudio/Spark-TTS (sparktts + cli)
  .khepree-spark-runtime.json
userData/models/spark/0.5b/   # HF snapshot Spark-TTS-0.5B
```

Sources: [Spark-TTS README](https://github.com/SparkAudio/Spark-TTS), [cli/inference.py](https://github.com/SparkAudio/Spark-TTS/blob/main/cli/inference.py), [cli/SparkTTS.py](https://github.com/SparkAudio/Spark-TTS/blob/main/cli/SparkTTS.py).
