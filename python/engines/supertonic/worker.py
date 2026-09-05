#!/usr/bin/env python3
"""JSON-lines worker for Supertonic 3 (ONNX CPU). Optional local model only.

No HuggingFace download during synthesize. No VieNeu sea-g2p.
Official SDK: https://supertone-inc.github.io/supertonic-py/
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

# Electron may spawn with cwd = app root; keep package imports resolvable.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

tts: Any = None
model_dir: Optional[str] = None
sample_rate: int = 44100

# Built-in preset voices shipped with open-weight package (not zero-shot clone).
BUILTIN_VOICES = ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")

# Upstream SUPPORTED_LANGUAGES (supertonic-3) + na fallback.
SUPPORTED_LANGS = (
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
    "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
    "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na",
)


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _require_model_dir(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise ValueError(
            "Thiếu model_dir. Cài Supertonic 3 trong Engine Selector trước khi Generate."
        )
    root = Path(path).expanduser().resolve()
    onnx = root / "onnx"
    if not onnx.is_dir():
        raise FileNotFoundError(
            f"Không tìm thấy onnx/ trong {root}. Model chưa được cài đủ."
        )
    return root


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "supertonic"}


def cmd_get_info(_msg: dict) -> dict:
    return {
        "ok": True,
        "engine": "supertonic",
        "model": "supertonic-3",
        "sample_rate": sample_rate if tts else 44100,
        "voices": list(BUILTIN_VOICES),
        "languages": list(SUPPORTED_LANGS),
        "model_dir": model_dir,
        "ready": tts is not None,
        "voice_clone": False,
        "runtime": "onnx-cpu",
        "code_license": "MIT (supertonic-py / Supertone Inc.)",
        "model_license": "OpenRAIL (Supertone/supertonic-3)",
    }


def cmd_init(msg: dict) -> dict:
    global tts, model_dir, sample_rate

    root = _require_model_dir(msg.get("model_dir"))
    threads = msg.get("threads")
    intra = int(threads) if threads not in (None, "", 0, "0") else None

    # Never auto-download — model must already be in user storage.
    from supertonic import TTS

    tts = TTS(
        model="supertonic-3",
        model_dir=str(root),
        auto_download=False,
        intra_op_num_threads=intra,
    )
    model_dir = str(root)
    sample_rate = int(getattr(tts, "sample_rate", 44100) or 44100)

    voices = list(getattr(tts, "voice_style_names", None) or BUILTIN_VOICES)
    return {
        "ok": True,
        "mode": "supertonic-3",
        "voices": voices,
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": list(SUPPORTED_LANGS),
    }


def cmd_list_voices(_msg: dict) -> dict:
    if tts is None:
        return {"ok": True, "voices": list(BUILTIN_VOICES)}
    voices = list(getattr(tts, "voice_style_names", None) or BUILTIN_VOICES)
    return {"ok": True, "voices": voices}


def cmd_synthesize(msg: dict) -> dict:
    if tts is None:
        raise RuntimeError("Supertonic chưa init. Gọi init trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")

    opts = msg.get("options") or {}
    voice = str(msg.get("voice") or opts.get("voice") or "M1").strip() or "M1"
    lang = str(opts.get("lang") or msg.get("lang") or "vi").strip() or "vi"
    if lang not in SUPPORTED_LANGS:
        raise ValueError(f"Ngôn ngữ không hỗ trợ: {lang}")

    speed = float(opts.get("speed") if opts.get("speed") is not None else 1.05)
    speed = max(0.7, min(2.0, speed))

    steps = int(opts.get("total_steps") if opts.get("total_steps") is not None else 8)
    steps = max(5, min(12, steps))

    silence = float(opts.get("silence_duration") if opts.get("silence_duration") is not None else 0.3)
    silence = max(0.0, silence)

    max_chunk = opts.get("max_chunk_length")
    max_chunk_length = int(max_chunk) if max_chunk not in (None, "") else None

    style = tts.get_voice_style(voice_name=voice)
    wav, _dur = tts.synthesize(
        text=text,
        voice_style=style,
        total_steps=steps,
        speed=speed,
        max_chunk_length=max_chunk_length,
        silence_duration=silence,
        lang=lang,
        verbose=False,
    )
    tts.save_audio(wav, str(out))
    return {"ok": True, "path": str(out), "sample_rate": sample_rate}


def cmd_shutdown(_msg: dict) -> dict:
    global tts, model_dir
    tts = None
    model_dir = None
    return {"ok": True, "shutdown": True}


HANDLERS = {
    "ping": cmd_ping,
    "init": cmd_init,
    "list_voices": cmd_list_voices,
    "synthesize": cmd_synthesize,
    "shutdown": cmd_shutdown,
    "get_info": cmd_get_info,
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
