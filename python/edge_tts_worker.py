#!/usr/bin/env python3
"""JSON-lines worker for Microsoft Edge TTS (online)."""
from __future__ import annotations

import sys
from pathlib import Path

# Embeddable Python không tự thêm thư mục script vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import asyncio
import io
import json
import traceback

import edge_tts
from pydub import AudioSegment

from app_paths import configure_ffmpeg, get_project_root
from edge_text_split import split_for_edge_tts
from text_normalize import preprocess_with_sea_g2p

configure_ffmpeg()
PROJECT_ROOT = get_project_root()

VIETNAMESE_VOICES = (
    "vi-VN-HoaiMyNeural",
    "vi-VN-NamMinhNeural",
)

VOICE_MODES = (
    {"id": "multilingual", "label": "Đa ngôn ngữ (Multilingual)"},
    {"id": "vietnamese", "label": "Tiếng Việt chuyên"},
)

# Khoảng lặng giữa các đoạn/câu khi ghép (ms)
SEGMENT_PAUSE_MS = 180
RECEIVE_TIMEOUT = 300


def respond(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def edge_rate_string(percent: float) -> str:
    p = max(-50.0, min(100.0, float(percent or 0)))
    sign = "+" if p >= 0 else ""
    return f"{sign}{p:.0f}%"


def edge_pitch_string(hz: float) -> str:
    h = max(-50.0, min(50.0, float(hz or 0)))
    sign = "+" if h >= 0 else ""
    return f"{sign}{h:.0f}Hz"


def edge_volume_string(percent: float) -> str:
    p = max(-50.0, min(50.0, float(percent or 0)))
    sign = "+" if p >= 0 else ""
    return f"{sign}{p:.0f}%"


def preprocess_text(text: str, options: dict | None) -> str:
    opts = dict(options or {})
    opts.setdefault("lang", "vi")
    return preprocess_with_sea_g2p(text, opts, lang_option_key="lang", default_lang="vi")


def _voice_to_dict(v: dict) -> dict:
    return {
        "id": v["ShortName"],
        "name": v["ShortName"],
        "label": v.get("FriendlyName") or v["ShortName"],
        "locale": v.get("Locale", ""),
        "gender": v.get("Gender", ""),
    }


async def fetch_voices(voice_mode: str | None = None) -> list[dict]:
    all_voices = await edge_tts.list_voices()
    mode = (voice_mode or "vietnamese").strip().lower()

    if mode == "multilingual":
        filtered = [v for v in all_voices if "Multilingual" in v.get("ShortName", "")]
    else:
        filtered = [v for v in all_voices if v.get("ShortName") in VIETNAMESE_VOICES]
        if not filtered:
            filtered = [v for v in all_voices if v.get("Locale") == "vi-VN"]

    filtered.sort(key=lambda x: x.get("ShortName", ""))
    return [_voice_to_dict(v) for v in filtered]


async def synth_segment_bytes(
    text: str,
    voice: str,
    rate: str,
    pitch: str,
    volume: str,
) -> bytes:
    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
        receive_timeout=RECEIVE_TIMEOUT,
    )
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    if not audio:
        raise ValueError("Edge TTS không trả về audio")
    return bytes(audio)


async def synth_to_file(
    text: str,
    voice: str,
    output_path: str,
    options: dict | None,
) -> str:
    prepared = preprocess_text(text, options)
    if not prepared:
        raise ValueError("Văn bản rỗng sau tiền xử lý")

    opts = options or {}
    rate = edge_rate_string(opts.get("edgeRate", 0))
    pitch = edge_pitch_string(opts.get("edgePitch", 0))
    volume = edge_volume_string(opts.get("edgeVolume", 0))

    segments = split_for_edge_tts(prepared)
    if not segments:
        raise ValueError("Không tách được đoạn văn bản")

    combined = AudioSegment.empty()
    pause = AudioSegment.silent(duration=SEGMENT_PAUSE_MS)

    for i, segment in enumerate(segments):
        raw = await synth_segment_bytes(segment, voice, rate, pitch, volume)
        part = AudioSegment.from_file(io.BytesIO(raw), format="mp3")
        if len(combined) > 0:
            combined += pause
        combined += part

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    combined.export(str(out), format="mp3")
    return str(out.resolve())


def cmd_ping() -> None:
    respond({"ok": True, "pong": True})


def cmd_init(voice_mode: str | None) -> None:
    mode = voice_mode or "vietnamese"
    voices = asyncio.run(fetch_voices(mode))
    respond({
        "ok": True,
        "voiceMode": mode,
        "voiceModes": VOICE_MODES,
        "voices": voices,
    })


def cmd_list_voices(voice_mode: str | None) -> None:
    voices = asyncio.run(fetch_voices(voice_mode))
    respond({"ok": True, "voices": voices})


def cmd_synthesize(text: str, voice: str, output_path: str, options: dict | None) -> None:
    if not voice:
        respond({"ok": False, "error": "Chưa chọn giọng Edge TTS"})
        return
    path = asyncio.run(synth_to_file(text, voice, output_path, options))
    respond({"ok": True, "path": path})


def handle_request(req: dict) -> None:
    cmd = req.get("cmd")
    try:
        if cmd == "ping":
            cmd_ping()
        elif cmd == "init":
            cmd_init(req.get("voice_mode") or req.get("locale"))
        elif cmd == "list_voices":
            cmd_list_voices(req.get("voice_mode") or req.get("locale"))
        elif cmd == "synthesize":
            cmd_synthesize(
                text=req.get("text") or "",
                voice=req.get("voice") or "",
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
