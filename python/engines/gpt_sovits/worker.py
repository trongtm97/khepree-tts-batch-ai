#!/usr/bin/env python3
"""JSON-lines worker for GPT-SoVITS inference only (RVC-Boss).

Calls GPT_SoVITS.TTS_infer_pack.TTS (same core as api_v2) — no Gradio WebUI,
no FastAPI server, no training.

Required synth fields (upstream):
  text, text_lang, ref_audio_path, prompt_text, prompt_lang
Plus checkpoint paths: gpt_weights, sovits_weights (set on init or per-call).
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

_src = os.environ.get("KHEPREE_GPT_SOVITS_SRC", "").strip()
if _src:
    if _src not in sys.path:
        sys.path.insert(0, _src)
    gpt_pkg = str(Path(_src) / "GPT_SoVITS")
    if gpt_pkg not in sys.path:
        sys.path.insert(0, gpt_pkg)

_site = os.environ.get("KHEPREE_GPT_SOVITS_SITE", "").strip()
if _site and _site not in sys.path:
    sys.path.insert(0, _site)

pipeline: Any = None
config_obj: Any = None
sample_rate: int = 32000

# Upstream v2 language set (TTS_Config.v2_languages) — no Vietnamese official.
OFFICIAL_LANGS = [
    "auto", "auto_yue", "en", "zh", "ja", "yue", "ko",
    "all_zh", "all_ja", "all_yue", "all_ko",
]

VI_WARN = (
    "GPT-SoVITS checkpoint/upstream hiện tại không quảng cáo tiếng Việt chính thức. "
    "Khepree khuyên dùng VieNeu cho Instant Vietnamese clone."
)

ACK_TEXT = "Tôi có quyền sử dụng giọng/reference audio này."


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _require_file(path: str | None, label: str) -> Path:
    if not path or not str(path).strip():
        raise ValueError(f"Thiếu {label}")
    raw = str(path).strip()
    if raw.lower().startswith(("http://", "https://", "ftp://")):
        raise ValueError(f"{label} chỉ chấp nhận file local.")
    p = Path(raw).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(f"{label} không tồn tại: {p}")
    return p


def _unload() -> None:
    global pipeline, config_obj
    try:
        del pipeline
    except Exception:
        pass
    pipeline = None
    config_obj = None
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def cmd_ping(_msg: dict) -> dict:
    return {"ok": True, "pong": True, "engine": "gpt-sovits", "training": False}


def cmd_init(msg: dict) -> dict:
    global pipeline, config_obj, sample_rate

    _unload()

    if not _src or not Path(_src).is_dir():
        raise RuntimeError(
            "Chưa có upstream GPT-SoVITS (ISOLATED). "
            "Cài Voice Lab runtime — không Gradio WebUI / không Conda."
        )

    # Ensure CWD-relative pretrained paths resolve inside upstream tree
    try:
        os.chdir(_src)
    except Exception:
        pass

    gpt_path = str(_require_file(msg.get("gpt_weights") or msg.get("gpt_checkpoint"), "GPT checkpoint"))
    sovits_path = str(
        _require_file(msg.get("sovits_weights") or msg.get("sovits_checkpoint"), "SoVITS checkpoint")
    )

    config_path = msg.get("config_path") or str(Path(_src) / "GPT_SoVITS" / "configs" / "tts_infer.yaml")
    if not Path(config_path).is_file():
        raise FileNotFoundError(f"Thiếu tts_infer.yaml: {config_path}")

    device = str(msg.get("device") or "cuda").strip().lower()
    is_half = bool(msg.get("is_half", True))
    if device in ("cpu",):
        is_half = False

    try:
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
    except ImportError:
        try:
            from TTS_infer_pack.TTS import TTS, TTS_Config  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "Không import được TTS_infer_pack.TTS (inference core). "
                "Không dùng Gradio WebUI."
            ) from e

    cfg = TTS_Config(str(config_path))
    if device in ("cuda", "gpu") and hasattr(cfg, "device"):
        try:
            import torch
            cfg.device = "cuda" if torch.cuda.is_available() else "cpu"
            if cfg.device == "cpu":
                is_half = False
        except Exception:
            cfg.device = "cpu"
            is_half = False
    elif device == "cpu" and hasattr(cfg, "device"):
        cfg.device = "cpu"

    if hasattr(cfg, "is_half"):
        cfg.is_half = is_half

    pipeline = TTS(cfg)
    pipeline.init_t2s_weights(gpt_path)
    pipeline.init_vits_weights(sovits_path)
    config_obj = cfg
    sample_rate = 24000 if getattr(cfg, "version", "") == "v3" else 32000

    langs = list(getattr(cfg, "languages", None) or OFFICIAL_LANGS)
    return {
        "ok": True,
        "mode": "gpt-sovits-infer",
        "device": str(getattr(cfg, "device", device)),
        "version": getattr(cfg, "version", None),
        "sample_rate": sample_rate,
        "languages": langs,
        "gpt_weights": gpt_path,
        "sovits_weights": sovits_path,
        "capabilities": {
            "voice_clone": True,
            "training": False,
            "gradio": False,
            "custom_checkpoints": True,
            "cpu": True,
            "gpu": True,
        },
        "voice_profile_ack": ACK_TEXT,
    }


def cmd_list_languages(_msg: dict) -> dict:
    langs = list(getattr(config_obj, "languages", None) or OFFICIAL_LANGS) if config_obj else list(OFFICIAL_LANGS)
    return {"ok": True, "languages": langs}


def cmd_synthesize(msg: dict) -> dict:
    if pipeline is None:
        raise RuntimeError("Model chưa init — chọn GPT + SoVITS checkpoint trước.")

    text = str(msg.get("text") or "").strip()
    if not text:
        raise ValueError("Thiếu target text")

    out = msg.get("output_path")
    if not out:
        raise ValueError("Thiếu output_path")
    out_path = Path(str(out)).expanduser().resolve()

    opts = msg.get("options") if isinstance(msg.get("options"), dict) else {}

    text_lang = str(opts.get("text_lang") or opts.get("language") or opts.get("lang") or "auto").strip().lower()
    prompt_lang = str(opts.get("prompt_lang") or opts.get("ref_lang") or text_lang).strip().lower()
    allow_unsupported = bool(opts.get("allow_unsupported_lang"))

    if text_lang in ("vi", "vietnamese") or prompt_lang in ("vi", "vietnamese"):
        if not allow_unsupported:
            raise ValueError(VI_WARN + " Bật override Unsupported nếu muốn thử nghiệm.")
        # Map experimental VI to auto so upstream tokenizer may still run
        if text_lang in ("vi", "vietnamese"):
            text_lang = "auto"
        if prompt_lang in ("vi", "vietnamese"):
            prompt_lang = "auto"

    ref = opts.get("ref_audio") or opts.get("ref_audio_path") or opts.get("prompt_speech_path")
    ref_path = _require_file(ref, "reference audio")
    prompt_text = str(opts.get("prompt_text") or opts.get("ref_text") or "").strip()

    # Optional mid-session checkpoint switch (no training)
    gpt_w = opts.get("gpt_weights") or opts.get("gpt_checkpoint")
    sovits_w = opts.get("sovits_weights") or opts.get("sovits_checkpoint")
    if gpt_w:
        pipeline.init_t2s_weights(str(_require_file(gpt_w, "GPT checkpoint")))
    if sovits_w:
        pipeline.init_vits_weights(str(_require_file(sovits_w, "SoVITS checkpoint")))

    req = {
        "text": text,
        "text_lang": text_lang,
        "ref_audio_path": str(ref_path),
        "prompt_text": prompt_text,
        "prompt_lang": prompt_lang,
        "top_k": int(opts.get("top_k") or 15),
        "top_p": float(opts.get("top_p") if opts.get("top_p") is not None else 1),
        "temperature": float(opts.get("temperature") if opts.get("temperature") is not None else 1),
        "text_split_method": str(opts.get("text_split_method") or "cut5"),
        "batch_size": int(opts.get("batch_size") or 1),
        "speed_factor": float(opts.get("speed_factor") or opts.get("speed") or 1.0),
        "seed": int(opts.get("seed") if opts.get("seed") is not None else -1),
        "parallel_infer": bool(opts.get("parallel_infer", True)),
        "repetition_penalty": float(opts.get("repetition_penalty") or 1.35),
        "sample_steps": int(opts.get("sample_steps") or 32),
        "super_sampling": bool(opts.get("super_sampling", False)),
        "streaming_mode": False,
        "return_fragment": False,
    }

    import numpy as np
    import soundfile as sf

    gen = pipeline.run(req)
    sr, audio = next(gen)
    arr = np.asarray(audio).squeeze()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), arr, int(sr))

    return {
        "ok": True,
        "path": str(out_path),
        "sample_rate": int(sr),
        "text_lang": text_lang,
        "prompt_lang": prompt_lang,
        "warning": VI_WARN if allow_unsupported else None,
    }


def cmd_shutdown(_msg: dict) -> dict:
    _unload()
    return {"ok": True, "shutdown": True, "training": False}


HANDLERS = {
    "ping": cmd_ping,
    "init": cmd_init,
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
