#!/usr/bin/env python3
"""JSON-lines worker for Kokoro via kokoro-onnx (ONNX CPU).

Runtime choice: docs/engines/kokoro.md
Loads ONNX + voices from user model storage — no download on synthesize.
English-focused product path; upstream has no official Vietnamese voices.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

model: Any = None
model_dir: Optional[str] = None
variant: Optional[str] = None
sample_rate: int = 24000

# Official example default; product default is English US
DEFAULT_VOICE = "af_heart"

# onnx filename per install variant (voices file shared name)
VARIANT_FILES = {
    "int8": ("kokoro-v1.0.int8.onnx", "voices-v1.0.bin"),
    "fp32": ("kokoro-v1.0.onnx", "voices-v1.0.bin"),
}


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _lang_for_voice(voice: str, explicit: Optional[str]) -> str:
    if explicit and str(explicit).strip():
        return str(explicit).strip().lower()
    v = (voice or "").lower()
    if v.startswith(("bf_", "bm_")):
        return "en-gb"
    return "en-us"


def _require_model_dir(path: str | None, variant_id: str) -> tuple[Path, Path, Path]:
    if not path or not str(path).strip():
        raise ValueError(
            "Thiếu model_dir. Cài variant Kokoro (int8/fp32) trước khi Generate."
        )
    root = Path(path).expanduser().resolve()
    files = VARIANT_FILES.get(variant_id) or VARIANT_FILES["int8"]
    onnx_name, voices_name = files
    onnx_path = root / onnx_name
    voices_path = root / voices_name
    if not onnx_path.is_file():
        raise FileNotFoundError(
            f"Thiếu ONNX: {onnx_path}. Cài lại variant {variant_id}."
        )
    if not voices_path.is_file():
        raise FileNotFoundError(
            f"Thiếu voices: {voices_path}. Cài lại variant {variant_id}."
        )
    return root, onnx_path, voices_path


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "kokoro"}


def cmd_init(msg: dict) -> dict:
    global model, model_dir, variant, sample_rate

    variant_id = str(msg.get("variant") or "int8").strip() or "int8"
    if variant_id not in VARIANT_FILES:
        raise ValueError(f"Variant không hỗ trợ: {variant_id} (int8|fp32)")

    root, onnx_path, voices_path = _require_model_dir(msg.get("model_dir"), variant_id)

    from kokoro_onnx import Kokoro

    model = Kokoro(str(onnx_path), str(voices_path))
    model_dir = str(root)
    variant = variant_id
    voices = list(model.get_voices())
    return {
        "ok": True,
        "mode": f"kokoro-{variant_id}",
        "variant": variant_id,
        "voices": voices,
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": ["en"],
    }


def cmd_list_voices(_msg: dict) -> dict:
    if model is None:
        return {"ok": True, "voices": [DEFAULT_VOICE]}
    return {"ok": True, "voices": list(model.get_voices())}


def cmd_synthesize(msg: dict) -> dict:
    if model is None:
        raise RuntimeError("Kokoro chưa init. Gọi init trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")

    opts = msg.get("options") or {}
    voice = str(msg.get("voice") or opts.get("voice") or DEFAULT_VOICE).strip() or DEFAULT_VOICE
    speed = float(opts.get("speed") if opts.get("speed") is not None else 1.0)
    speed = max(0.5, min(2.0, speed))
    lang = _lang_for_voice(voice, opts.get("lang"))

    import soundfile as sf

    audio, sr = model.create(text, voice=voice, speed=speed, lang=lang)
    sf.write(str(out), audio, int(sr) or sample_rate)
    return {"ok": True, "path": str(out), "sample_rate": int(sr) or sample_rate}


def cmd_shutdown(_msg: dict) -> dict:
    global model, model_dir, variant
    model = None
    model_dir = None
    variant = None
    return {"ok": True, "shutdown": True}


HANDLERS = {
    "ping": cmd_ping,
    "init": cmd_init,
    "list_voices": cmd_list_voices,
    "synthesize": cmd_synthesize,
    "shutdown": cmd_shutdown,
}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            cmd = str(msg.get("cmd") or "").strip()
            handler = HANDLERS.get(cmd)
            if not handler:
                respond({"ok": False, "error": f"Unknown cmd: {cmd}"})
                continue
            respond(handler(msg))
            if cmd == "shutdown":
                break
        except Exception as e:
            respond({
                "ok": False,
                "error": str(e),
                "trace": traceback.format_exc()[-1500:],
            })


if __name__ == "__main__":
    main()
