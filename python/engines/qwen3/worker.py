#!/usr/bin/env python3
"""JSON-lines worker for Qwen3-TTS 0.6B (CustomVoice + Base only).

Official package: qwen-tts / Qwen3TTSModel
  - 0.6b-custom → generate_custom_voice (preset speakers + instruct)
  - 0.6b-base   → generate_voice_clone (ref_audio + ref_text)

No VoiceDesign (upstream 1.7B-only). No HF download on synthesize.
Isolated site-packages via KHEPREE_QWEN3_SITE / PYTHONPATH.
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

_site = os.environ.get("KHEPREE_QWEN3_SITE", "").strip()
if _site and _site not in sys.path:
    sys.path.insert(0, _site)

model: Any = None
model_dir: Optional[str] = None
variant: Optional[str] = None
device: str = "cpu"
sample_rate: int = 24000
supported_speakers: list[str] = []
supported_languages: list[str] = []

OFFICIAL_LANGS = [
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]

CUSTOM_SPEAKERS = [
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
]

VI_WARN = (
    "Model này không hỗ trợ tiếng Việt chính thức. "
    "Khepree khuyên dùng VieNeu hoặc Supertonic."
)


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _require_model_dir(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise ValueError("Thiếu model_dir. Cài variant Qwen3 0.6B trước khi Generate.")
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Model dir không tồn tại: {root}")
    cfg = root / "config.json"
    weights = root / "model.safetensors"
    if not cfg.is_file():
        raise FileNotFoundError(f"Thiếu config.json trong {root}")
    if not weights.is_file():
        raise FileNotFoundError(f"Thiếu model.safetensors trong {root}")
    return root


def _resolve_device(requested: str | None) -> str:
    req = (requested or "cuda").strip().lower()
    try:
        import torch
        if req.startswith("cuda") and torch.cuda.is_available():
            return "cuda:0" if req in ("cuda", "gpu") else req
    except Exception:
        pass
    return "cpu"


def _load_kwargs(dev: str) -> dict:
    import torch

    kwargs: dict[str, Any] = {
        "device_map": dev,
        "local_files_only": True,
    }
    if dev.startswith("cuda"):
        kwargs["dtype"] = torch.bfloat16
        # flash_attn optional — fall back silently
        kwargs["attn_implementation"] = "sdpa"
    else:
        kwargs["dtype"] = torch.float32
    return kwargs


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "qwen3"}


def cmd_init(msg: dict) -> dict:
    global model, model_dir, variant, device, sample_rate
    global supported_speakers, supported_languages

    variant_id = str(msg.get("variant") or "0.6b-custom").strip() or "0.6b-custom"
    if variant_id not in ("0.6b-custom", "0.6b-base"):
        raise ValueError(f"Variant không hỗ trợ: {variant_id} (0.6b-custom|0.6b-base)")

    root = _require_model_dir(msg.get("model_dir"))
    device = _resolve_device(msg.get("device"))

    try:
        from qwen_tts import Qwen3TTSModel
    except ImportError as e:
        raise RuntimeError(
            "Chưa có runtime Qwen3-TTS (qwen-tts). "
            "Cài isolated runtime — không nằm trong core Khepree."
        ) from e

    # Unload previous before loading another variant (VRAM)
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

    model = Qwen3TTSModel.from_pretrained(str(root), **_load_kwargs(device))
    model_dir = str(root)
    variant = variant_id

    speakers: list[str] = []
    languages: list[str] = list(OFFICIAL_LANGS)
    try:
        if hasattr(model, "get_supported_speakers"):
            speakers = list(model.get_supported_speakers() or [])
    except Exception:
        speakers = []
    try:
        if hasattr(model, "get_supported_languages"):
            raw = list(model.get_supported_languages() or [])
            if raw:
                languages = raw
    except Exception:
        pass

    if variant_id == "0.6b-custom" and not speakers:
        speakers = list(CUSTOM_SPEAKERS)
    if variant_id == "0.6b-base":
        speakers = speakers or ["clone"]

    supported_speakers = speakers
    supported_languages = languages
    sample_rate = int(getattr(model, "sample_rate", None) or getattr(model, "sr", None) or 24000)

    return {
        "ok": True,
        "mode": f"qwen3-{variant_id}",
        "variant": variant_id,
        "device": device,
        "voices": speakers,
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": languages,
        "capabilities": {
            "voice_clone": variant_id == "0.6b-base",
            "preset_speakers": variant_id == "0.6b-custom",
            "voice_design": False,
            "cpu": True,
            "gpu": True,
        },
    }


def cmd_list_voices(_msg: dict) -> dict:
    return {"ok": True, "voices": list(supported_speakers)}


def cmd_list_languages(_msg: dict) -> dict:
    return {"ok": True, "languages": list(supported_languages)}


def _write_wav(path: Path, wav, sr: int) -> None:
    import numpy as np
    import soundfile as sf

    arr = wav
    if isinstance(arr, (list, tuple)):
        arr = arr[0]
    arr = np.asarray(arr)
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
    language = str(opts.get("language") or opts.get("lang") or "Auto").strip() or "Auto"
    allow_unsupported = bool(opts.get("allow_unsupported_lang"))

    if language == "Vietnamese" and not allow_unsupported:
        raise ValueError(VI_WARN + " Bật override Unsupported nếu muốn thử nghiệm.")

    if language == "Vietnamese":
        # Experimental path — still attempt with Auto mapping if model rejects Vietnamese
        pass

    variant_id = variant or "0.6b-custom"

    if variant_id == "0.6b-custom":
        speaker = str(
            opts.get("speaker") or msg.get("voice") or "Vivian"
        ).strip() or "Vivian"
        instruct = opts.get("instruct")
        kwargs: dict[str, Any] = {
            "text": text,
            "language": language,
            "speaker": speaker,
        }
        if instruct is not None and str(instruct).strip():
            kwargs["instruct"] = str(instruct).strip()
        wavs, sr = model.generate_custom_voice(**kwargs)
    else:
        ref = opts.get("ref_audio") or opts.get("audio_prompt_path") or opts.get("ref_wav")
        if not ref:
            raise ValueError("Base variant cần ref_audio (file local).")
        ref_path = Path(str(ref)).expanduser().resolve()
        if not ref_path.is_file():
            raise FileNotFoundError(f"Reference audio không tồn tại: {ref_path}")
        if str(ref).lower().startswith(("http://", "https://", "ftp://")):
            raise ValueError("Reference audio chỉ chấp nhận file local.")

        ref_text = opts.get("ref_text")
        x_vector_only = bool(opts.get("x_vector_only_mode"))
        kwargs = {
            "text": text,
            "language": language,
            "ref_audio": str(ref_path),
        }
        if x_vector_only:
            kwargs["x_vector_only_mode"] = True
        elif ref_text is not None and str(ref_text).strip():
            kwargs["ref_text"] = str(ref_text).strip()
        else:
            # Official: without ref_text, x_vector_only_mode may be used (lower quality)
            kwargs["x_vector_only_mode"] = True

        wavs, sr = model.generate_voice_clone(**kwargs)

    _write_wav(out_path, wavs, int(sr or sample_rate))
    return {
        "ok": True,
        "path": str(out_path),
        "sample_rate": int(sr or sample_rate),
        "variant": variant_id,
        "language": language,
        "warning": VI_WARN if language == "Vietnamese" else None,
    }


def cmd_shutdown(_msg: dict) -> dict:
    global model, model_dir, variant, supported_speakers, supported_languages
    try:
        del model
    except Exception:
        pass
    model = None
    model_dir = None
    variant = None
    supported_speakers = []
    supported_languages = []
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
