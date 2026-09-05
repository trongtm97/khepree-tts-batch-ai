#!/usr/bin/env python3
"""JSON-lines worker for VieNeu-TTS v3 Turbo / v3 Nano (Electron main process)."""
from __future__ import annotations

import sys
from pathlib import Path

# Embeddable Python không tự thêm thư mục script vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import traceback
import gc
from typing import Any, Optional

import numpy as np

from audio_utils import adjust_playback_speed, adjust_volume
from text_normalize import (
    SilenceConfig,
    silence_config_from_dict,
    split_tts_segments,
)

from app_paths import get_project_root

PROJECT_ROOT = get_project_root()
MODEL_CONFIG_PATH = PROJECT_ROOT / "models" / "vieneu" / "model-config.json"
DEFAULT_MODE = "v3turbo"
SUPPORTED_MODES = frozenset({"v3turbo", "v3nano"})

tts: Any = None
current_mode: Optional[str] = None
engine_kwargs: dict = {}
runtime_engine_opts: dict = {}


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_model_config() -> dict:
    if not MODEL_CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(MODEL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def get_mode_config(mode: str) -> dict:
    cfg = load_model_config()
    if "modes" in cfg and mode in cfg["modes"]:
        return dict(cfg["modes"][mode])
    if cfg.get("mode") == mode or (mode == DEFAULT_MODE and cfg.get("onnx_dir")):
        return dict(cfg)
    return {}


def _patch_onnx_codec_dir(codec_dir: str) -> None:
    """SDK 3.5 không forward codec_dir từ Vieneu() → inject vào OnnxV3LiteEngine."""
    from vieneu._v3_turbo_engine import onnx_runtime_lite as ort_mod

    if getattr(ort_mod, "_tts_codec_dir_patch", None) == codec_dir:
        return
    orig_init = ort_mod.OnnxV3LiteEngine.__init__

    def patched_init(self, *args, **kwargs):
        kwargs.setdefault("codec_dir", codec_dir)
        return orig_init(self, *args, **kwargs)

    ort_mod.OnnxV3LiteEngine.__init__ = patched_init
    ort_mod._tts_codec_dir_patch = codec_dir


def build_engine_kwargs(mode: str, engine_opts: dict | None = None) -> dict:
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Engine không hỗ trợ: {mode}. Chỉ còn {', '.join(sorted(SUPPORTED_MODES))}.")

    mc = get_mode_config(mode)
    opts = engine_opts or {}
    device = opts.get("device") or mc.get("device", "cpu")
    kwargs: dict[str, Any] = {
        "backend": mc.get("backend", "onnx"),
        "device": device,
    }

    # Turbo uses precision; Nano ignores unknown kwargs via **kwargs on V3NanoVieNeuTTS
    if mode == "v3turbo":
        kwargs["precision"] = str(opts.get("precision") or mc.get("precision") or "fp32")

    threads = int(opts.get("threads") or mc.get("threads") or 0)
    if threads > 0:
        kwargs["threads"] = threads

    # Offline-only: luôn bắt buộc onnx_dir local — không để SDK fallback tải HuggingFace.
    onnx_rel = mc.get("onnx_dir")
    if not onnx_rel:
        raise ValueError(f"Thiếu onnx_dir trong model-config cho mode {mode}.")
    onnx_path = PROJECT_ROOT / onnx_rel
    if not onnx_path.is_dir():
        raise ValueError(
            f"Thiếu model local {mode} tại {onnx_path}. "
            "Installer phải đóng gói thư mục models/ (không tải thêm lúc chạy)."
        )
    required = (
        ["vieneu_prefill.onnx", "vieneu_decode_step.onnx", "config.json"]
        if mode == "v3turbo"
        else [
            "text_encoder.onnx",
            "duration_predictor.onnx",
            "vector_estimator.onnx",
            "codec_decoder.onnx",
            "config.json",
            "constants.npz",
        ]
    )
    missing = [fn for fn in required if not (onnx_path / fn).is_file()]
    if missing:
        raise ValueError(f"Model {mode} thiếu file: {', '.join(missing)} (cần bundle offline).")
    kwargs["onnx_dir"] = str(onnx_path)

    if mode == "v3turbo":
        codec_rel = mc.get("codec_dir")
        if not codec_rel:
            raise ValueError("Thiếu codec_dir trong model-config cho v3turbo.")
        codec_path = PROJECT_ROOT / codec_rel
        if not codec_path.is_dir():
            raise ValueError(f"Thiếu codec local tại {codec_path}.")
        # ponytail: SDK chưa expose codec_dir trên V3TurboVieNeuTTS — patch engine đến khi upstream forward kwargs
        _patch_onnx_codec_dir(str(codec_path))

    return kwargs


def effective_silence_config(options: dict | None) -> SilenceConfig:
    base = silence_config_from_dict(get_mode_config(current_mode or DEFAULT_MODE))
    opts = options or {}
    return {
        "line_punct": float(opts.get("silenceLinePunct", base["line_punct"])),
        "line_no_punct": float(opts.get("silenceLineNoPunct", base["line_no_punct"])),
        "paragraph": float(opts.get("silenceParagraph", base["paragraph"])),
        "chunk": float(opts.get("silenceChunk", base["chunk"])),
    }


def build_infer_kwargs(options: dict | None, voice: Any) -> dict[str, Any]:
    opts = options or {}
    kwargs: dict[str, Any] = {"show_progress": False}
    if voice is not None:
        kwargs["voice"] = voice
    return kwargs


def join_with_silences(
    wavs: list[np.ndarray],
    silences_after: list[float],
    sample_rate: int,
) -> np.ndarray:
    if not wavs:
        return np.array([], dtype=np.float32)
    if len(wavs) == 1:
        return wavs[0]

    out = wavs[0]
    for i in range(1, len(wavs)):
        gap = silences_after[i - 1] if i - 1 < len(silences_after) else 0.0
        if gap > 0:
            silence = np.zeros(int(sample_rate * gap), dtype=np.float32)
            out = np.concatenate([out, silence, wavs[i]])
        else:
            out = np.concatenate([out, wavs[i]])
    return out


def synthesize_with_pauses(
    text: str,
    infer_kwargs: dict[str, Any],
    options: dict | None,
) -> np.ndarray:
    opts = options or {}
    silence_cfg = effective_silence_config(opts)
    split_by_line = opts.get("splitByLine", True) is not False
    strip_hash = opts.get("stripHash", True) is not False

    segments = split_tts_segments(
        text,
        silence_cfg,
        split_by_line=split_by_line,
        strip_hash=strip_hash,
        use_sea_g2p=opts.get("useSeaG2p", True) is not False,
        g2p_lang="vi",
    )

    if not segments:
        return np.array([], dtype=np.float32)

    infer_kwargs = {**infer_kwargs}

    if len(segments) == 1 and (not split_by_line or "\n" not in text):
        return tts.infer(
            segments[0][0],
            silence_p=silence_cfg["chunk"],
            **infer_kwargs,
        )

    wavs: list[np.ndarray] = []
    pauses: list[float] = []
    for seg_text, pause_after in segments:
        wav = tts.infer(seg_text, silence_p=0.0, **infer_kwargs)
        wavs.append(wav)
        pauses.append(pause_after)

    sr = int(getattr(tts, "sample_rate", 48000))
    return join_with_silences(wavs, pauses, sr)


def close_engine() -> None:
    global tts, current_mode, engine_kwargs, runtime_engine_opts
    if tts is None:
        return
    try:
        if hasattr(tts, "close") and callable(tts.close):
            tts.close()
    except Exception:
        pass
    tts = None
    current_mode = None
    engine_kwargs = {}
    runtime_engine_opts = {}
    gc.collect()


def cmd_init(mode: str, engine_opts: dict | None = None) -> None:
    global tts, current_mode, engine_kwargs, runtime_engine_opts
    from vieneu import Vieneu

    mode = mode if mode in SUPPORTED_MODES else DEFAULT_MODE
    runtime_engine_opts = dict(engine_opts or {})
    kwargs = build_engine_kwargs(mode, runtime_engine_opts)

    if tts is not None and current_mode == mode and engine_kwargs == kwargs:
        voices = [
            {"id": voice_id, "name": voice_id, "label": label}
            for label, voice_id in tts.list_preset_voices()
        ]
        respond({
            "ok": True,
            "mode": mode,
            "reused": True,
            "local": bool(kwargs.get("onnx_dir")),
            "voices": voices,
        })
        return

    if tts is not None:
        close_engine()

    tts = Vieneu(mode=mode, **kwargs)
    current_mode = mode
    engine_kwargs = kwargs

    voices = [
        {"id": voice_id, "name": voice_id, "label": label}
        for label, voice_id in tts.list_preset_voices()
    ]
    if not voices:
        voices = [{"id": "default", "name": "Mặc định", "label": "Mặc định"}]

    respond({
        "ok": True,
        "mode": mode,
        "backend": kwargs.get("backend"),
        "local": bool(kwargs.get("onnx_dir")),
        "voices": voices,
    })


def cmd_list_voices() -> None:
    if tts is None:
        respond({"ok": False, "error": "Engine chưa khởi tạo"})
        return
    voices = [
        {"id": voice_id, "name": voice_id, "label": label}
        for label, voice_id in tts.list_preset_voices()
    ]
    if not voices:
        voices = [{"id": "default", "name": "Mặc định", "label": "Mặc định"}]
    respond({"ok": True, "voices": voices})


def cmd_get_defaults() -> None:
    mc = get_mode_config(DEFAULT_MODE)
    silence = silence_config_from_dict(mc)
    respond({
        "ok": True,
        "defaults": {
            "silenceLinePunct": silence["line_punct"],
            "silenceLineNoPunct": silence["line_no_punct"],
            "silenceParagraph": silence["paragraph"],
            "silenceChunk": silence["chunk"],
            "device": mc.get("device", "cpu"),
            "backend": mc.get("backend", "onnx"),
            "threads": mc.get("threads", 6),
            "precision": mc.get("precision", "fp32"),
            "speed": 1.0,
            "splitByLine": True,
            "stripHash": True,
            "useSeaG2p": True,
        },
    })


def resolve_voice(voice: Optional[str]) -> Any:
    if not voice or voice in ("default", ""):
        return None
    if tts is None:
        return voice
    try:
        return tts.get_preset_voice(voice)
    except (ValueError, TypeError, AttributeError):
        return voice


def cmd_synthesize(
    text: str,
    voice: Optional[str],
    output_path: str,
    options: dict | None = None,
) -> None:
    if tts is None:
        respond({"ok": False, "error": "Engine chưa khởi tạo"})
        return
    if not text or not str(text).strip():
        respond({"ok": False, "error": "Văn bản rỗng"})
        return

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    opts = options or {}
    resolved = resolve_voice(voice)
    infer_kwargs = build_infer_kwargs(opts, resolved)

    raw_text = str(text).strip()
    segments = split_tts_segments(
        raw_text,
        effective_silence_config(opts),
        split_by_line=opts.get("splitByLine", True) is not False,
        strip_hash=opts.get("stripHash", True) is not False,
        use_sea_g2p=opts.get("useSeaG2p", True) is not False,
        g2p_lang="vi",
    )
    if not segments:
        respond({"ok": False, "error": "Văn bản rỗng sau tiền xử lý"})
        return

    audio = synthesize_with_pauses(raw_text, infer_kwargs, opts)
    speed = float(opts.get("speed", 1.0) or 1.0)
    volume = float(opts.get("volume", 1.0) or 1.0)
    audio = adjust_playback_speed(audio, speed)
    audio = adjust_volume(audio, volume)
    tts.save(audio, str(out))
    respond({"ok": True, "path": str(out.resolve())})


def cmd_ping() -> None:
    respond({"ok": True, "pong": True})


def handle_request(req: dict) -> None:
    cmd = req.get("cmd")
    try:
        if cmd == "ping":
            cmd_ping()
        elif cmd == "get_defaults":
            cmd_get_defaults()
        elif cmd == "init":
            cmd_init(str(req.get("mode") or DEFAULT_MODE), req.get("engine_options"))
        elif cmd == "list_voices":
            cmd_list_voices()
        elif cmd == "synthesize":
            cmd_synthesize(
                text=req.get("text") or "",
                voice=req.get("voice"),
                output_path=req.get("output_path") or "",
                options=req.get("options"),
            )
        elif cmd == "shutdown":
            respond({"ok": True})
            sys.exit(0)
        else:
            respond({"ok": False, "error": f"Lệnh không hợp lệ: {cmd}"})
    except Exception as exc:
        respond({
            "ok": False,
            "error": str(exc),
            "trace": traceback.format_exc(),
        })


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            respond({"ok": False, "error": f"JSON không hợp lệ: {exc}"})
            continue
        handle_request(req)


if __name__ == "__main__":
    main()
