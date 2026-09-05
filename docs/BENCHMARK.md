# Local benchmark + AUTO recommender

| | |
|---|---|
| **Corpus** | `samples/benchmark/corpus.json` (project-authored) |
| **Store** | `userData/benchmarks/<fingerprint>/…` |
| **UI** | Engine selector — “Đo trên máy của bạn” / “AUTO đề xuất” |

## Non-goals

- No inference engine changes.
- No fake quality scores.
- AUTO **never** auto-downloads models — only suggests install.

## Metrics (when measured)

- init/load time
- synthesis time
- audio duration (WAV header; ffprobe fallback)
- RTF / × realtime
- VRAM delta only if nvidia-smi trusted
- RAM: not reported (not trustworthy from Node heap)
- success/error counts

## Result key

`hardwareFingerprint` + `engineId` + `variant` + `modelVersion` + `runtimeVersion`

## AUTO inputs

1. language / task (default guidance)
2. installed engines
3. hardware compatibility (`adviseEngine`)
4. local benchmark (median RTF when present)
5. user preference

### Default guidance

| Task | Prefer |
|------|--------|
| Vietnamese general / clone | VieNeu |
| Vietnamese multilingual CPU | VieNeu / Supertonic |
| English light | Kokoro / Kitten |
| English expressive | Chatterbox |
| English clone | Chatterbox Turbo |
| Advanced | Qwen / Spark |

## UI copy (only after benchmark)

```
Đo trên máy của bạn
Khởi động: 2.3 giây
Tốc độ: 3.8× realtime
```
