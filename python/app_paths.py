"""Đường dẫn ứng dụng khi dev hoặc bản cài đặt Electron."""
from __future__ import annotations

import os
import shutil
from pathlib import Path


def get_project_root() -> Path:
    env = (
        os.environ.get("KHEPREE_TTS_ROOT", "").strip()
        or os.environ.get("CHAPMEE_TTS_ROOT", "").strip()
    )
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent


def _find_ffmpeg() -> str | None:
    ffmpeg = os.environ.get("FFMPEG_PATH", "").strip()
    if ffmpeg and os.path.isfile(ffmpeg):
        return ffmpeg
    found = shutil.which("ffmpeg")
    if found:
        return found
    root = get_project_root()
    candidates = [
        root / "runtime" / "ffmpeg" / "ffmpeg.exe",
        root / "runtime" / "win32" / "ffmpeg" / "ffmpeg.exe",
        root / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def _find_ffprobe() -> str | None:
    ffprobe = os.environ.get("FFPROBE_PATH", "").strip()
    if ffprobe and os.path.isfile(ffprobe):
        return ffprobe
    found = shutil.which("ffprobe")
    if found:
        return found
    root = get_project_root()
    candidates = [
        root / "runtime" / "ffmpeg" / "ffprobe.exe",
        root / "runtime" / "win32" / "ffmpeg" / "ffprobe.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def configure_ffmpeg() -> None:
    try:
        from pydub import AudioSegment
    except ImportError:
        return
    ffmpeg = _find_ffmpeg()
    ffprobe = _find_ffprobe()
    if ffmpeg:
        AudioSegment.converter = ffmpeg
    if ffprobe:
        AudioSegment.ffprobe = ffprobe
