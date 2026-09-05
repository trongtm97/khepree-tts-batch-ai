#!/usr/bin/env python3
"""JSON-lines worker for Spark-TTS 0.5B (SparkAudio).

Official inference: cli.SparkTTS.SparkTTS.inference
  - clone: prompt_speech_path (+ optional prompt_text)
  - create: gender + pitch + speed (very_low…very_high)

No Gradio. Isolated site-packages + upstream Spark-TTS source tree.
Languages official: Chinese, English.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_src = os.environ.get("KHEPREE_SPARK_SRC", "").strip()
if _src and _src not in sys.path:
    sys.path.insert(0, _src)

_site = os.environ.get("KHEPREE_SPARK_SITE", "").strip()
if _site and _site not in sys.path:
    sys.path.insert(0, _site)

model: Any = None
model_dir: Optional[str] = None
device_obj: Any = None
sample_rate: int = 16000

OFFICIAL_LANGS = ["Chinese", "English"]
GENDERS = ("male", "female")
LEVELS = ("very_low", "low", "moderate", "high", "very_high")

VI_WARN = (
    "Model này không hỗ trợ tiếng Việt chính thức. "
    "Khepree khuyên dùng VieNeu hoặc Supertonic."
)


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _require_model_dir(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise ValueError("Thiếu model_dir. Cài Spark-TTS 0.5B trước khi Generate.")
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Model dir không tồn tại: {root}")
    cfg = root / "config.yaml"
    llm = root / "LLM"
    if not cfg.is_file():
        raise FileNotFoundError(f"Thiếu config.yaml trong {root}")
    if not llm.is_dir():
        raise FileNotFoundError(f"Thiếu thư mục LLM trong {root}")
    return root


def _resolve_device(requested: str | None):
    import torch
    import platform as py_platform

    req = (requested or "cuda").strip().lower()
    if py_platform.system() == "Darwin" and torch.backends.mps.is_available() and req in ("mps", "cuda", "gpu"):
        return torch.device("mps:0")
    if req.startswith("cuda") and torch.cuda.is_available():
        return torch.device("cuda:0" if req in ("cuda", "gpu") else req)
    return torch.device("cpu")


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "spark"}


def cmd_init(msg: dict) -> dict:
    global model, model_dir, device_obj, sample_rate

    root = _require_model_dir(msg.get("model_dir"))
    device_obj = _resolve_device(msg.get("device"))

    # Unload previous (VRAM)
    if model is not None:
        try:
            del model
        except Exception:
            pass
        model = None
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    try:
        from cli.SparkTTS import SparkTTS
    except ImportError as e:
        raise RuntimeError(
            "Chưa có upstream Spark-TTS (cli.SparkTTS). "
            "Cài isolated runtime — không Conda / không Gradio."
        ) from e

    model = SparkTTS(str(root), device_obj)
    model_dir = str(root)
    sample_rate = int(getattr(model, "sample_rate", None) or 16000)

    return {
        "ok": True,
        "mode": "spark-0.5b",
        "device": str(device_obj),
        "voices": ["clone", "create"],
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": list(OFFICIAL_LANGS),
        "capabilities": {
            "voice_clone": True,
            "speaker_controls": True,
            "gender": True,
            "pitch": True,
            "speed": True,
            "voice_design": False,
            "cpu": True,
            "gpu": True,
        },
    }


def cmd_list_voices(_msg: dict) -> dict:
    return {"ok": True, "voices": ["clone", "create"]}


def cmd_list_languages(_msg: dict) -> dict:
    return {"ok": True, "languages": list(OFFICIAL_LANGS)}


def _write_wav(path: Path, wav, sr: int) -> None:
    import numpy as np
    import soundfile as sf

    arr = wav
    if hasattr(arr, "detach"):
        arr = arr.detach().cpu().numpy()
    arr = np.asarray(arr).squeeze()
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), arr, int(sr))


def cmd_synthesize(msg: dict) -> dict:
    if model is None:
        raise RuntimeError("Model chưa init")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")
    out_path = Path(str(out)).expanduser().resolve()

    opts = msg.get("options") if isinstance(msg.get("options"), dict) else {}
    language = str(opts.get("language") or opts.get("lang") or "Chinese").strip() or "Chinese"
    allow_unsupported = bool(opts.get("allow_unsupported_lang"))
    if language == "Vietnamese" and not allow_unsupported:
        raise ValueError(VI_WARN + " Bật override Unsupported nếu muốn thử nghiệm.")

    mode = str(
        opts.get("spark_mode") or opts.get("mode") or msg.get("voice") or "clone"
    ).strip().lower() or "clone"

    import torch

    with torch.no_grad():
        if mode == "create":
            gender = str(opts.get("gender") or "male").strip().lower()
            pitch = str(opts.get("pitch") or "moderate").strip().lower()
            speed = str(opts.get("speed") or opts.get("rate") or "moderate").strip().lower()
            if gender not in GENDERS:
                raise ValueError(f"gender không hỗ trợ: {gender} (male|female)")
            if pitch not in LEVELS:
                raise ValueError(f"pitch không hỗ trợ: {pitch}")
            if speed not in LEVELS:
                raise ValueError(f"speed không hỗ trợ: {speed}")
            wav = model.inference(
                text,
                gender=gender,
                pitch=pitch,
                speed=speed,
            )
        else:
            ref = opts.get("ref_audio") or opts.get("prompt_speech_path") or opts.get("audio_prompt_path")
            if not ref:
                raise ValueError("Clone mode cần prompt_speech_path / ref_audio (file local).")
            ref_path = Path(str(ref)).expanduser().resolve()
            if not ref_path.is_file():
                raise FileNotFoundError(f"Reference audio không tồn tại: {ref_path}")
            if str(ref).lower().startswith(("http://", "https://", "ftp://")):
                raise ValueError("Reference audio chỉ chấp nhận file local.")
            prompt_text = opts.get("prompt_text") or opts.get("ref_text")
            kwargs = {
                "prompt_speech_path": str(ref_path),
            }
            if prompt_text is not None and str(prompt_text).strip():
                kwargs["prompt_text"] = str(prompt_text).strip()
            wav = model.inference(text, **kwargs)

    _write_wav(out_path, wav, sample_rate)
    return {
        "ok": True,
        "path": str(out_path),
        "sample_rate": sample_rate,
        "mode": mode,
        "language": language,
        "warning": VI_WARN if language == "Vietnamese" else None,
    }


def cmd_shutdown(_msg: dict) -> dict:
    global model, model_dir, device_obj
    try:
        del model
    except Exception:
        pass
    model = None
    model_dir = None
    device_obj = None
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return {"ok": True, "shutdown": True}


HANDLERS = {
    "ping": cmd_ping,
    "init": cmd_init,
    "list_voices": cmd_list_voices,
    "list_languages": cmd_list_languages,
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
                "trace": traceback.format_exc()[-800:],
            })


if __name__ == "__main__":
    main()
