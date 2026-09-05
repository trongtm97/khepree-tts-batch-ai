#!/usr/bin/env python3
"""JSON-lines worker for OHF-Voice Piper (optional, isolated site-packages).

Loads voice .onnx from user model storage — no download on synthesize.
Runtime package piper-tts must be on PYTHONPATH (KHEPREE_PIPER_SITE).
"""
from __future__ import annotations

import json
import os
import sys
import traceback
import wave
from pathlib import Path
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_site = os.environ.get("KHEPREE_PIPER_SITE", "").strip()
if _site and _site not in sys.path:
    sys.path.insert(0, _site)

voice: Any = None
model_dir: Optional[str] = None
voice_key: Optional[str] = None
sample_rate: int = 22050
voice_license: Optional[str] = None


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _parse_model_card(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if line.lower().startswith("license:"):
            return line.split(":", 1)[1].strip() or None
        if "* license:" in line.lower():
            return line.split(":", 1)[1].strip() or None
    # Dataset block often has "- License: ..."
    for line in text.splitlines():
        stripped = line.strip().lstrip("-* ").strip()
        if stripped.lower().startswith("license:"):
            return stripped.split(":", 1)[1].strip() or None
    return None


def _find_onnx(root: Path) -> Path:
    onnx_files = sorted(root.glob("*.onnx"))
    if not onnx_files:
        raise FileNotFoundError(f"Thiếu file .onnx trong {root}")
    return onnx_files[0]


def _require_model_dir(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise ValueError(
            "Thiếu model_dir. Cài một Piper voice (optional) trước khi Generate."
        )
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Model dir không tồn tại: {root}")
    _find_onnx(root)
    return root


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "piper"}


def cmd_init(msg: dict) -> dict:
    global voice, model_dir, voice_key, sample_rate, voice_license

    root = _require_model_dir(msg.get("model_dir"))
    voice_key = str(msg.get("variant") or msg.get("voice") or root.name).strip()

    try:
        from piper import PiperVoice
    except ImportError as e:
        raise RuntimeError(
            "Chưa có runtime Piper (piper-tts). Cài optional runtime trong app "
            "(không nằm trong core requirements)."
        ) from e

    onnx = _find_onnx(root)
    voice = PiperVoice.load(str(onnx))
    model_dir = str(root)
    sample_rate = int(getattr(voice, "config", None) and getattr(voice.config, "sample_rate", None) or 22050)
    voice_license = _parse_model_card(root / "MODEL_CARD")
    return {
        "ok": True,
        "mode": f"piper-{voice_key}",
        "variant": voice_key,
        "voices": [voice_key],
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "license": voice_license,
        "languages": [],
    }


def cmd_list_voices(_msg: dict) -> dict:
    if voice_key:
        return {
            "ok": True,
            "voices": [voice_key],
            "licenses": {voice_key: voice_license} if voice_license else {},
        }
    return {"ok": True, "voices": [], "licenses": {}}


def cmd_synthesize(msg: dict) -> dict:
    if voice is None:
        raise RuntimeError("Piper chưa init. Gọi init trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")

    opts = msg.get("options") or {}
    speed = float(opts.get("speed") if opts.get("speed") is not None else 1.0)
    speed = max(0.5, min(2.0, speed))
    # Piper length_scale: higher = slower
    length_scale = 1.0 / speed

    from piper import SynthesisConfig

    syn = SynthesisConfig(length_scale=length_scale)
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=syn)

    return {
        "ok": True,
        "path": str(out_path),
        "sample_rate": sample_rate,
        "license": voice_license,
    }


def cmd_shutdown(_msg: dict) -> dict:
    global voice, model_dir, voice_key, voice_license
    voice = None
    model_dir = None
    voice_key = None
    voice_license = None
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
