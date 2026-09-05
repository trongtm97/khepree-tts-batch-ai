#!/usr/bin/env python3
"""JSON-lines worker for KittenTTS (ONNX CPU). Optional local models only.

Official: https://github.com/KittenML/KittenTTS
Loads ONNX + voices from user model storage — no HF download on synthesize.
Does not call hf_hub_download (files pre-installed via Model Download Manager).
English phonemizer (en-us) only; no official Vietnamese.
"""
from __future__ import annotations

import contextlib
import io
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

# Friendly names from upstream available_voices / all_voice_names
BUILTIN_VOICES = ("Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo")


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _require_model_dir(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise ValueError(
            "Thiếu model_dir. Cài một variant KittenTTS (Mini/Micro/Nano) trước khi Generate."
        )
    root = Path(path).expanduser().resolve()
    cfg = root / "config.json"
    if not cfg.is_file():
        raise FileNotFoundError(f"Thiếu config.json trong {root}. Variant chưa được cài đủ.")
    return root


def _load_local(root: Path) -> Any:
    """Instantiate official ONNX backend from pre-downloaded files (no hf_hub_download)."""
    with open(root / "config.json", "r", encoding="utf-8") as f:
        config = json.load(f)

    model_type = config.get("type")
    if model_type not in ("ONNX1", "ONNX2"):
        raise ValueError(f"Unsupported KittenTTS model type: {model_type}")

    model_file = config.get("model_file")
    voices_file = config.get("voices")
    if not model_file or not voices_file:
        raise ValueError("config.json thiếu model_file / voices")

    onnx_path = root / model_file
    voices_path = root / voices_file
    if not onnx_path.is_file():
        raise FileNotFoundError(f"Thiếu ONNX: {onnx_path}")
    if not voices_path.is_file():
        raise FileNotFoundError(f"Thiếu voices: {voices_path}")

    from kittentts.onnx_model import KittenTTS_1_Onnx

    return KittenTTS_1_Onnx(
        model_path=str(onnx_path),
        voices_path=str(voices_path),
        speed_priors=config.get("speed_priors", {}) or {},
        voice_aliases=config.get("voice_aliases", {}) or {},
        backend="cpu",
    )


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "kitten"}


def cmd_init(msg: dict) -> dict:
    global model, model_dir, variant, sample_rate

    root = _require_model_dir(msg.get("model_dir"))
    variant = str(msg.get("variant") or "mini").strip() or "mini"

    # KittenTTS.generate prints to stdout — redirect during load too if noisy
    with contextlib.redirect_stdout(io.StringIO()):
        model = _load_local(root)

    model_dir = str(root)
    voices = list(getattr(model, "all_voice_names", None) or BUILTIN_VOICES)
    return {
        "ok": True,
        "mode": f"kitten-{variant}",
        "variant": variant,
        "voices": voices,
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": ["en"],
    }


def cmd_list_voices(_msg: dict) -> dict:
    if model is None:
        return {"ok": True, "voices": list(BUILTIN_VOICES)}
    voices = list(getattr(model, "all_voice_names", None) or BUILTIN_VOICES)
    return {"ok": True, "voices": voices}


def cmd_synthesize(msg: dict) -> dict:
    if model is None:
        raise RuntimeError("KittenTTS chưa init. Gọi init trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")

    opts = msg.get("options") or {}
    voice = str(msg.get("voice") or opts.get("voice") or "Bella").strip() or "Bella"
    speed = float(opts.get("speed") if opts.get("speed") is not None else 1.0)
    # Upstream accepts wide range; clamp to sane values
    speed = max(0.5, min(2.0, speed))
    clean_text = opts.get("clean_text")
    if clean_text is None:
        clean_text = True

    import soundfile as sf

    # Official generate() prints progress — keep stdout clean for JSON-lines
    with contextlib.redirect_stdout(io.StringIO()):
        audio = model.generate(text, voice=voice, speed=speed, clean_text=bool(clean_text))
    sf.write(str(out), audio, sample_rate)
    return {"ok": True, "path": str(out), "sample_rate": sample_rate}


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
