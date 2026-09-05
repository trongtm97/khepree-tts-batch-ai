# Khepree TTS Batch AI

Ứng dụng Electron chuyển văn bản thành giọng nói hàng loạt (multi-engine). Core offline: **VieNeu Turbo + Nano**; online: **Edge TTS**. Nhiều engine optional cài vào `userData` — không nằm trong installer mặc định.

Chi tiết giấy phép bên thứ ba: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Yêu cầu (dev)

- Node.js 18+
- Python 3.10+ (dev); **end-user installer** mang Python runtime nhúng — không cần cài Python/Node/Git/Conda để chạy **core**.

## Cài đặt (dev)

```bash
npm install
py -3 -m pip install -r python/requirements.txt
py -3 scripts/download-vieneu-model.py
```

## Chạy

```bash
npm start
```

## Engine matrix

Không dùng quality star giả. “Phù hợp nhất” = guidance sản phẩm / use-case, không phải điểm chất lượng đo được.

| Engine | Phù hợp nhất | CPU | GPU | Vietnamese | English | Clone | Offline | Optional |
|--------|--------------|-----|-----|------------|---------|-------|---------|----------|
| VieNeu Turbo | VI tổng quát / clone | Yes (mạnh) | Optional | Official | Limited | Yes (preset/ref) | Yes | No (bundled) |
| VieNeu Nano | VI máy yếu | Yes | Optional | Official | Limited | Yes | Yes | No (bundled) |
| Edge TTS | Online đa ngôn ngữ | Yes | n/a | Yes (service) | Yes | No | No (needs net) | No (bundled client) |
| Supertonic | VI multilingual CPU (alt) | Yes | Optional | Yes | Yes | Limited | Yes | Yes (weights) |
| KittenTTS | English nhẹ | Yes | Optional | No | Yes | No | Yes | Yes |
| Kokoro | English nhẹ | Yes | Optional | No | Yes | No | Yes | Yes |
| Piper | CPU multi-voice (GPL) | Yes | Optional | Catalog* | Yes | No | Yes | Yes — **license attention** |
| Chatterbox | EN expressive / clone | Possible | Recommended (Turbo) | No | Yes | Yes | Yes | Yes |
| Qwen3-TTS 0.6B | Advanced | Possible | Recommended | Not official | Yes | Yes (Base) | Yes | Yes |
| Spark-TTS 0.5B | Advanced clone / controls | Possible | Recommended | Not official | Yes (zh/en) | Yes | Yes | Yes |
| GPT-SoVITS | Voice Lab advanced | Possible | Recommended | Not official | Upstream langs | Yes | Yes | Yes (Voice Lab) |

\* Piper Vietnamese voices chỉ khi có trong catalog upstream — không invent.

## Giấy phép (tóm tắt)

- **VieNeu code + v3 weights:** Apache-2.0 — giữ notice khi redistribute.
- **Piper:** GPLv3 runtime + per-voice `MODEL_CARD` — highlight trước khi cài.
- **Supertonic:** tách **code (MIT)** và **weights (OpenRAIL)**.
- **GPT-SoVITS checkpoints:** *License determined by model provider.*
- Full table: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Bản quyền Khepree

App gắn catalog `khepree-tts-batch-ai` (trial / tháng / năm). Chi tiết: [`docs/KHEPREE_INTEGRATION.md`](docs/KHEPREE_INTEGRATION.md). Dev mock: `KHEPREE_DEV_MOCK=1`.

## Build installer (core offline)

```bash
npm run ensure:models   # Turbo + Nano + codec → models/vieneu/
npm run build:win       # hoặc build:mac
```

`electron-builder` **chỉ** đóng gói `models/vieneu` (+ Python workers + `resources/runtime`). Optional engines/weights cài sau vào `userData` — **không** bundle nhầm cả cây `models/`.

Packaged inference bật `HF_HUB_OFFLINE` cho **VieNeu bundled**. Download optional dùng network env riêng.

## Kiểm thử

```bash
npm run test:selfcheck
npm run test:installer-audit   # contract: models/vieneu only, no torch/gradio in core reqs
```

## Cấu trúc

```
batch.html
src/batch/                 — UI Batch + engine selector + benchmark AUTO
electron/                  — registry, pools, IPC, optional packages
python/tts_worker.py       — VieNeu
python/edge_tts_worker.py  — Edge
python/engines/*/worker.py — optional engines
models/vieneu/             — bundled offline (Turbo + Nano + codec)
samples/benchmark/         — corpus benchmark cục bộ
```

## Docs

- [`docs/MULTI_ENGINE_BASELINE.md`](docs/MULTI_ENGINE_BASELINE.md) — baseline contract
- [`docs/BENCHMARK.md`](docs/BENCHMARK.md) — local benchmark / AUTO
- [`docs/engines/`](docs/engines/) — per-engine notes
- [`docs/RELEASE_QA.md`](docs/RELEASE_QA.md) — final QA snapshot
