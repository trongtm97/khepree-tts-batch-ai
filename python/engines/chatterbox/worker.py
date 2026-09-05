#!/usr/bin/env python3
"""JSON-lines worker for Resemble Chatterbox (Nano + Turbo).

Shared worker for family `chatterbox`. Init selects variant:
  - nano  → ChatterboxTurboTTS.from_local(..., nano=True)
  - turbo → ChatterboxTurboTTS.from_local(..., nano=False)

Isolated site-packages via KHEPREE_CHATTERBOX_SITE / PYTHONPATH.
Models from user storage — no HF download on synthesize.
English only. One runtime for both variants — re-init after unload.
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

_site = os.environ.get("KHEPREE_CHATTERBOX_SITE", "").strip()
if _site and _site not in sys.path:
    sys.path.insert(0, _site)

model: Any = None
model_dir: Optional[str] = None
variant: Optional[str] = None
device: str = "cpu"
sample_rate: int = 24000
expression_tags: list[str] = []


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _load_tags(root: Path) -> list[str]:
    """Official tags from model added_tokens.json — never invent."""
    path = root / "added_tokens.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    tags = [k for k in data.keys() if isinstance(k, str) and k.startswith("[") and k.endswith("]")]
    return sorted(tags)


def _require_model_dir(path: str | None, variant_id: str) -> Path:
    if not path or not str(path).strip():
        raise ValueError(
            "Thiếu model_dir. Cài Chatterbox Nano (optional) trước khi Generate."
        )
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Model dir không tồn tại: {root}")
    ckpt = "t3_nano_v1.safetensors" if variant_id == "nano" else "t3_turbo_v1.safetensors"
    if not (root / ckpt).is_file():
        raise FileNotFoundError(f"Thiếu {ckpt} trong {root}")
    if not (root / "s3gen_meanflow.safetensors").is_file():
        raise FileNotFoundError(f"Thiếu s3gen_meanflow.safetensors trong {root}")
    if not (root / "ve.safetensors").is_file():
        raise FileNotFoundError(f"Thiếu ve.safetensors trong {root}")
    return root


def _pick_device(requested: Optional[str]) -> str:
    raw = (requested or "cpu").strip().lower() or "cpu"
    if raw == "cuda":
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"
    if raw == "mps":
        try:
            import torch
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"
    return "cpu"


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "chatterbox", "family": "chatterbox"}


def cmd_init(msg: dict) -> dict:
    global model, model_dir, variant, device, sample_rate, expression_tags

    variant_id = str(msg.get("variant") or "nano").strip() or "nano"
    if variant_id not in ("nano", "turbo"):
        raise ValueError(f"Variant không hỗ trợ: {variant_id} (nano|turbo)")

    root = _require_model_dir(msg.get("model_dir"), variant_id)
    device = _pick_device(msg.get("device"))

    try:
        from chatterbox.tts_turbo import ChatterboxTurboTTS
    except ImportError as e:
        raise RuntimeError(
            "Chưa có runtime Chatterbox (chatterbox-tts). "
            "Cài isolated runtime — không nằm trong core Khepree."
        ) from e

    # Shared class: nano=True for Nano; turbo uses nano=False (same isolated runtime).
    model = ChatterboxTurboTTS.from_local(str(root), device=device, nano=(variant_id == "nano"))
    model_dir = str(root)
    variant = variant_id
    sample_rate = int(getattr(model, "sr", None) or 24000)
    expression_tags = _load_tags(root)

    return {
        "ok": True,
        "mode": f"chatterbox-{variant_id}",
        "variant": variant_id,
        "device": device,
        "voices": ["default"],
        "sample_rate": sample_rate,
        "model_dir": model_dir,
        "languages": ["en"],
        "expression_tags": expression_tags,
        "capabilities": {
            "voice_clone": True,
            "expression_tags": True,
            "cpu": True,
        },
    }


def cmd_list_voices(_msg: dict) -> dict:
    return {"ok": True, "voices": ["default"]}


def cmd_list_tags(_msg: dict) -> dict:
    return {"ok": True, "tags": list(expression_tags)}


def cmd_synthesize(msg: dict) -> dict:
    if model is None:
        raise RuntimeError("Chatterbox chưa init. Gọi init trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")

    opts = msg.get("options") or {}
    ref = opts.get("audio_prompt_path") or opts.get("ref_wav") or msg.get("voice")
    if ref and str(ref).strip() in ("", "default"):
        ref = None
    if ref:
        ref = str(ref).strip()
        if not Path(ref).is_file():
            raise FileNotFoundError(f"Reference audio không tồn tại: {ref}")

    kwargs: dict[str, Any] = {}
    if ref:
        kwargs["audio_prompt_path"] = ref
    for key in ("temperature", "min_p", "top_p", "top_k", "repetition_penalty"):
        if opts.get(key) is not None:
            kwargs[key] = opts[key]
    if opts.get("norm_loudness") is not None:
        kwargs["norm_loudness"] = bool(opts.get("norm_loudness"))

    import torchaudio as ta

    wav = model.generate(text, **kwargs)
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # generate returns tensor [1, T] or [T]
    if hasattr(wav, "dim") and wav.dim() == 1:
        wav = wav.unsqueeze(0)
    ta.save(str(out_path), wav.detach().cpu(), sample_rate)
    return {"ok": True, "path": str(out_path), "sample_rate": sample_rate, "variant": variant}


def cmd_shutdown(_msg: dict) -> dict:
    global model, model_dir, variant, expression_tags
    model = None
    model_dir = None
    variant = None
    expression_tags = []
    # Free GPU/CPU memory when possible
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    return {"ok": True, "shutdown": True}


HANDLERS = {
    "ping": cmd_ping,
    "init": cmd_init,
    "list_voices": cmd_list_voices,
    "list_tags": cmd_list_tags,
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
