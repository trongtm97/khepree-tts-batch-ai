"""Tiền xử lý văn bản trước khi đưa vào VieNeu v3 / Edge TTS."""
from __future__ import annotations

import re
from typing import TypedDict

from g2p_normalize import normalize_with_sea_g2p

_HASH_RE = re.compile(r"#+")
_STRONG_END_PUNCT = re.compile(r"[.!?…]\s*$")
_ANY_END_PUNCT = re.compile(r"[.!?…:;,]\s*$")


class SilenceConfig(TypedDict):
    line_punct: float
    line_no_punct: float
    paragraph: float
    chunk: float


DEFAULT_SILENCE: SilenceConfig = {
    "line_punct": 0.35,
    "line_no_punct": 0.55,
    "paragraph": 0.75,
    "chunk": 0.15,
}


def silence_config_from_dict(cfg: dict | None) -> SilenceConfig:
    src = cfg or {}
    return {
        "line_punct": float(src.get("silence_line_punct", DEFAULT_SILENCE["line_punct"])),
        "line_no_punct": float(src.get("silence_line_no_punct", DEFAULT_SILENCE["line_no_punct"])),
        "paragraph": float(src.get("silence_paragraph", DEFAULT_SILENCE["paragraph"])),
        "chunk": float(src.get("silence_chunk", DEFAULT_SILENCE["chunk"])),
    }


def normalize_raw_text(text: str, *, strip_hash: bool = True) -> str:
    t = str(text).replace("\r\n", "\n").replace("\r", "\n")
    if strip_hash:
        t = _HASH_RE.sub(" ", t)
    return t


def split_tts_segments(
    text: str,
    silence: SilenceConfig | None = None,
    *,
    split_by_line: bool = True,
    strip_hash: bool = True,
    use_sea_g2p: bool = True,
    g2p_lang: str = "vi",
) -> list[tuple[str, float]]:
    """
    Tách văn bản theo dòng để VieNeu chèn pause thật (giây) khi ghép audio.

    VieNeu v3 chỉ có ``silence_p`` giữa các chunk nội bộ — không có tuỳ chỉnh
    riêng “tốc độ dấu chấm” như v2 (0.3s/câu). Tách dòng + silence khi ghép
    mô phỏng pause dài/ngắn theo dấu câu cuối dòng.
    """
    cfg = silence or DEFAULT_SILENCE
    t = normalize_raw_text(text, strip_hash=strip_hash).strip()
    if use_sea_g2p:
        t = normalize_with_sea_g2p(t, lang=g2p_lang, enabled=True).strip()
    if not t:
        return []

    if not split_by_line or "\n" not in t:
        return [(t, 0.0)]

    segments: list[tuple[str, float]] = []
    pending_para = False

    for raw in t.split("\n"):
        line = raw.strip()
        if not line:
            pending_para = True
            continue

        if pending_para and segments:
            prev_text, _ = segments[-1]
            segments[-1] = (prev_text, cfg["paragraph"])
            pending_para = False
        elif pending_para:
            pending_para = False

        if _STRONG_END_PUNCT.search(line) or _ANY_END_PUNCT.search(line):
            pause = cfg["line_punct"]
        else:
            line = f"{line}."
            pause = cfg["line_no_punct"]

        segments.append((line, pause))

    return segments


def preprocess_for_tts(text: str) -> str:
    """Giữ tương thích: nối các segment (không dùng cho synth có pause)."""
    segments = split_tts_segments(text)
    if not segments:
        return ""
    return " ".join(seg for seg, _ in segments)


def sea_g2p_lang_for_code(lang_code: str | None) -> str | None:
    """
    Ánh xạ mã ngôn ngữ engine → mã sea-g2p (vi/en).
    Trả về None nếu engine không dùng sea-g2p cho ngôn ngữ đó.
    """
    code = (lang_code or "vi").strip().lower()
    if code in ("vi", "na", ""):
        return "vi"
    if code == "en":
        return "en"
    return None


def preprocess_with_sea_g2p(
    text: str,
    options: dict | None,
    *,
    lang_option_key: str = "lang",
    default_lang: str = "vi",
) -> str:
    """
    Tiền xử lý văn bản giống Edge/VieNeu: strip #, sea-g2p đọc số/ngày tự nhiên.
    Giữ xuống dòng để engine tự chunk.
    """
    opts = options or {}
    t = normalize_raw_text(text, strip_hash=opts.get("stripHash", True) is not False)
    if opts.get("useSeaG2p", True) is False:
        return t.strip()

    lang_code = opts.get(lang_option_key) or default_lang
    g2p_lang = sea_g2p_lang_for_code(lang_code)
    if g2p_lang:
        t = normalize_with_sea_g2p(t, lang=g2p_lang, enabled=True)
    return t.strip()
