#!/usr/bin/env python3
"""Download VieNeu-TTS v3 Turbo + v3 Nano into project models/ folder."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models" / "vieneu"

V3_ROOT = MODELS / "v3turbo"
V3_ONNX_DIR = V3_ROOT / "onnx"
V3_CODEC_DIR = MODELS / "codec"
V3_REPO = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
V3_CODEC_REPO = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
# SDK ≥3.3: fp32 graphs live in onnx_update/ (config + tokenizer bundled next to graphs).
V3_ONNX_SUBFOLDER = "onnx_update"
V3_ONNX_FILES = [
    "vieneu_prefill.onnx",
    "vieneu_decode_step.onnx",
    "vieneu_acoustic_cached.onnx",
    "vieneu_backbone_shared.data",
    "vieneu_v3_heads.npz",
    "config.json",
    "tokenizer.json",
]
V3_CODEC_FILES = [
    "moss_audio_tokenizer_decode_full.onnx",
    "moss_audio_tokenizer_decode_shared.data",
    "moss_audio_tokenizer_decode_step.onnx",
    "codec_browser_onnx_meta.json",
    "moss_audio_tokenizer_encode.onnx",
    "moss_audio_tokenizer_encode.data",
]

NANO_DIR = MODELS / "v3nano"
NANO_REPO = "pnnbao-ump/VieNeu-TTS-v3-Nano"
# Core synth + cloning + denoiser — đủ offline, không tải HF lúc chạy app.
NANO_FILES = [
    "text_encoder.onnx",
    "duration_predictor.onnx",
    "vector_estimator.onnx",
    "codec_decoder.onnx",
    "config.json",
    "constants.npz",
    "speaker_encoder.onnx",
    "codec_encoder.onnx",
    "reference_encoder.onnx",
    "denoiser.onnx",
]


def fmt_mb(path: Path) -> str:
    if not path.exists():
        return "0 MB"
    size = path.stat().st_size
    if size >= 1024 * 1024:
        return f"{size // (1024 * 1024)} MB"
    return f"{size // 1024} KB"


def download_file(repo: str, filename: str, dest: Path, *, subfolder: str | None = None, force: bool = False) -> Path:
    from huggingface_hub import hf_hub_download

    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"  skip (exists): {dest.name} ({fmt_mb(dest)})")
        return dest

    remote = f"{subfolder}/{filename}" if subfolder else filename
    print(f"  downloading: {repo}/{remote}")
    cached = hf_hub_download(
        repo_id=repo,
        filename=filename,
        repo_type="model",
        subfolder=subfolder or None,
    )
    src = Path(cached)
    if src.resolve() != dest.resolve():
        dest.write_bytes(src.read_bytes())
    print(f"  saved: {dest} ({fmt_mb(dest)})")
    return dest


def needs_layout_upgrade() -> bool:
    """Old onnx/ layout had smaller heads.npz (~25 MB); onnx_update is ~50 MB."""
    heads = V3_ONNX_DIR / "vieneu_v3_heads.npz"
    cfg_in_onnx = V3_ONNX_DIR / "config.json"
    if not heads.exists():
        return True
    if heads.stat().st_size < 40 * 1024 * 1024:
        return True
    if not cfg_in_onnx.exists():
        return True
    return False


def download_v3turbo(*, force: bool = False) -> None:
    print("=== VieNeu-TTS v3 Turbo (ONNX/CPU, onnx_update) ===")
    print(f"Target: {V3_ONNX_DIR}\n")

    V3_ONNX_DIR.mkdir(parents=True, exist_ok=True)
    V3_CODEC_DIR.mkdir(parents=True, exist_ok=True)

    upgrade = force or needs_layout_upgrade()
    if upgrade and not force:
        print("Detected legacy onnx layout -> re-download onnx_update graphs.\n")

    print("[1/2] Backbone ONNX graphs (onnx_update)...")
    for fn in V3_ONNX_FILES:
        download_file(
            V3_REPO,
            fn,
            V3_ONNX_DIR / fn,
            subfolder=V3_ONNX_SUBFOLDER,
            force=upgrade,
        )

    # Keep copies at v3turbo/ root for older tooling that looked there.
    for fn in ("config.json", "tokenizer.json"):
        src = V3_ONNX_DIR / fn
        dst = V3_ROOT / fn
        if src.exists():
            dst.write_bytes(src.read_bytes())

    print("\n[2/2] MOSS audio codec (ONNX)...")
    for fn in V3_CODEC_FILES:
        download_file(V3_CODEC_REPO, fn, V3_CODEC_DIR / fn, force=False)


def download_v3nano(*, force: bool = False) -> None:
    print("=== VieNeu-TTS v3 Nano (ONNX/CPU, 24 kHz) ===")
    print(f"Target: {NANO_DIR}\n")

    NANO_DIR.mkdir(parents=True, exist_ok=True)
    for fn in NANO_FILES:
        download_file(NANO_REPO, fn, NANO_DIR / fn, force=force)


def missing_files(dir_path: Path, names: list[str]) -> list[str]:
    return [fn for fn in names if not (dir_path / fn).is_file() or (dir_path / fn).stat().st_size <= 0]


def verify_bundle() -> None:
    """Fail if Turbo/Nano/codec incomplete — installer must ship full offline models."""
    problems: list[str] = []
    turbo_miss = missing_files(V3_ONNX_DIR, V3_ONNX_FILES)
    if turbo_miss:
        problems.append(f"v3turbo/onnx thiếu: {', '.join(turbo_miss)}")
    codec_miss = missing_files(V3_CODEC_DIR, V3_CODEC_FILES)
    if codec_miss:
        problems.append(f"codec thiếu: {', '.join(codec_miss)}")
    nano_miss = missing_files(NANO_DIR, NANO_FILES)
    if nano_miss:
        problems.append(f"v3nano thiếu: {', '.join(nano_miss)}")
    if problems:
        raise SystemExit(
            "Bundle model chưa đủ (user không được bắt tải thêm):\n  - "
            + "\n  - ".join(problems)
            + "\nChạy: py -3 scripts/download-vieneu-model.py"
        )
    print("Bundle OK: Turbo + Nano + codec (offline).")


def write_config() -> None:
    cfg = {
        "default_mode": "v3turbo",
        "modes": {
            "v3turbo": {
                "backend": "onnx",
                "device": "cpu",
                "threads": 6,
                "precision": "fp32",
                "sample_rate": 48000,
                "onnx_dir": str(V3_ONNX_DIR.relative_to(ROOT)).replace("\\", "/"),
                "codec_dir": str(V3_CODEC_DIR.relative_to(ROOT)).replace("\\", "/"),
                "backbone_repo": V3_REPO,
                "codec_repo": V3_CODEC_REPO,
                "onnx_subfolder": V3_ONNX_SUBFOLDER,
                "silence_line_punct": 0.35,
                "silence_line_no_punct": 0.55,
                "silence_paragraph": 0.75,
                "silence_chunk": 0.15,
            },
            "v3nano": {
                "backend": "onnx",
                "device": "cpu",
                "threads": 6,
                "sample_rate": 24000,
                "onnx_dir": str(NANO_DIR.relative_to(ROOT)).replace("\\", "/"),
                "backbone_repo": NANO_REPO,
                "silence_line_punct": 0.35,
                "silence_line_no_punct": 0.55,
                "silence_paragraph": 0.75,
                "silence_chunk": 0.15,
            },
        },
    }
    meta_path = MODELS / "model-config.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone. Config: {meta_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download VieNeu-TTS v3 Turbo and/or v3 Nano")
    parser.add_argument("--force", action="store_true", help="Re-download even if files exist")
    parser.add_argument(
        "--only",
        choices=("turbo", "nano", "all"),
        default="all",
        help="Which models to download (default: all)",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only check that Turbo+Nano+codec are complete for offline packaging",
    )
    args = parser.parse_args()
    if args.verify_only:
        verify_bundle()
        return 0
    if args.only in ("turbo", "all"):
        download_v3turbo(force=args.force)
    if args.only in ("nano", "all"):
        download_v3nano(force=args.force)
    write_config()
    verify_bundle()
    return 0


if __name__ == "__main__":
    sys.exit(main())
