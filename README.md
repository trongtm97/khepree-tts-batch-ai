# Khepree TTS Batch AI

Ứng dụng Electron chuyển văn bản thành giọng nói hàng loạt, tối ưu cho **truyện audio**, dùng [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) (v3 Turbo + v3 Nano).

## Yêu cầu

- Node.js 18+
- Python 3.10+ với `vieneu` ≥ 3.5.4

## Cài đặt

```bash
npm install
py -3 -m pip install -r python/requirements.txt
py -3 scripts/download-vieneu-model.py
```

## Chạy

```bash
npm start
```

## Engine

- **VieNeu-TTS v3 Turbo** — ONNX CPU, 48 kHz (CPU mạnh)
- **VieNeu-TTS v3 Nano** — ONNX CPU, 24 kHz (máy yếu; chất lượng thấp hơn)
- **Edge TTS** — online, cần mạng

SDK: `vieneu` **≥ 3.5.4**.

## Giấy phép VieNeu (thương mại)

- **Code + model v3 Turbo + preset voices:** [Apache License 2.0](https://github.com/pnnbao97/VieNeu-TTS/blob/main/LICENSE) — được dùng, phân phối và **bán thương mại**.
- Khi đóng gói/redistribute: giữ bản copy Apache 2.0 + attribution (VieNeu-TTS, MOSS codec).
- **VieNeu v4** (vieneu.io): proprietary, **không** open-source — không dùng trong app này.

## Bản quyền Khepree

App gắn catalog sản phẩm `khepree-tts-batch-ai` trên nền tảng Khepree (trial 1 ngày / tháng 49k / năm 499k VND).

Chi tiết: [`docs/KHEPREE_INTEGRATION.md`](docs/KHEPREE_INTEGRATION.md). Dev mock: `KHEPREE_DEV_MOCK=1`.

## Tiền xử lý

```
Văn bản gốc → tách theo dòng + khoảng lặng (Python) → VieNeu v3 Turbo → WAV
```

VieNeu v3: tham số `silence_p` (chunk nội bộ, mặc định 0.15s). Pause giữa dòng do app chèn khi ghép audio.

Tuỳ chỉnh trong `models/vieneu/model-config.json`:

| Key | Mặc định | Ý nghĩa |
|-----|----------|---------|
| `silence_line_punct` | 0.35s | Xuống dòng có dấu câu |
| `silence_line_no_punct` | 0.55s | Xuống dòng không dấu câu |
| `silence_paragraph` | 0.75s | Sau dòng trống |
| `silence_chunk` | 0.15s | Chunk dài trong một đoạn |

## Build installer (offline — user không tải model)

```bash
npm run ensure:models   # tải Turbo + Nano + codec vào models/
npm run build:win       # hoặc build:mac — tự ensure:models trước khi pack
```

`electron-builder` đóng gói cả thư mục `models/` vào `extraResources`. App packaged bật `HF_HUB_OFFLINE` — không tải HuggingFace lúc chạy.

## Cấu trúc

```
batch.html
src/batch/          — UI + tiền xử lý truyện
electron/           — VieNeu engine
python/tts_worker.py
models/vieneu/      — v3turbo + v3nano + codec (bundle offline)
```
