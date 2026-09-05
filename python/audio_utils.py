"""Xử lý audio sau synth."""
from __future__ import annotations

import numpy as np


def adjust_volume(wav: np.ndarray, volume: float) -> np.ndarray:
    """Gain 0.1–2.0 (1.0 = không đổi)."""
    volume = float(volume)
    if wav is None or wav.size == 0 or abs(volume - 1.0) < 0.005:
        return wav
    volume = max(0.1, min(2.0, volume))
    out = wav.astype(np.float32) * volume
    return np.clip(out, -1.0, 1.0).astype(np.float32)


def adjust_playback_speed(wav: np.ndarray, speed: float) -> np.ndarray:
    """Đổi tốc độ phát (0.5–2.0). 1.0 = không đổi. Dùng nội suy tuyến tính."""
    speed = float(speed)
    if wav is None or wav.size == 0 or abs(speed - 1.0) < 0.005:
        return wav
    speed = max(0.5, min(2.0, speed))
    n_out = max(1, int(round(len(wav) / speed)))
    x_in = np.arange(len(wav), dtype=np.float64)
    x_out = np.linspace(0, len(wav) - 1, n_out)
    return np.interp(x_out, x_in, wav.astype(np.float64)).astype(np.float32)
