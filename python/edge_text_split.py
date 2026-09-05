"""Tách văn bản dài cho Edge TTS (giới hạn ~4096 byte SSML)."""
from __future__ import annotations

import re

# An toàn dưới 4096 byte (SSML + ký tự tiếng Việt UTF-8)
DEFAULT_MAX_BYTES = 3200

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…:;])\s+")
_WORD_SPLIT = re.compile(r"\s+")


def byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


def split_paragraphs(text: str) -> list[str]:
    """Tách theo đoạn (dòng trống hoặc xuống dòng)."""
    t = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not t:
        return []
    if "\n\n" in t:
        parts = re.split(r"\n\s*\n", t)
    else:
        parts = t.split("\n")
    return [p.strip() for p in parts if p.strip()]


def split_sentences(paragraph: str) -> list[str]:
    """Tách đoạn dài thành câu."""
    p = paragraph.strip()
    if not p:
        return []
    parts = _SENTENCE_SPLIT.split(p)
    out = [s.strip() for s in parts if s.strip()]
    return out or [p]


def split_by_words(text: str, max_bytes: int) -> list[str]:
    """Tách câu quá dài theo khoảng trắng."""
    words = _WORD_SPLIT.split(text.strip())
    if not words:
        return []
    chunks: list[str] = []
    buf = ""
    for w in words:
        candidate = f"{buf} {w}".strip() if buf else w
        if byte_len(candidate) <= max_bytes:
            buf = candidate
            continue
        if buf:
            chunks.append(buf)
        if byte_len(w) > max_bytes:
            # Ký tự liên tiếp không có space — cắt cứng theo byte UTF-8
            b = w.encode("utf-8")
            start = 0
            while start < len(b):
                end = min(start + max_bytes, len(b))
                while end > start and (b[end - 1] & 0xC0) == 0x80:
                    end -= 1
                if end == start:
                    end = min(start + 1, len(b))
                chunks.append(b[start:end].decode("utf-8", errors="ignore"))
                start = end
            buf = ""
        else:
            buf = w
    if buf:
        chunks.append(buf)
    return chunks


def merge_small_chunks(chunks: list[str], max_bytes: int) -> list[str]:
    """Gộp các mẩu ngắn liền kề."""
    if not chunks:
        return []
    merged: list[str] = []
    buf = ""
    for c in chunks:
        c = c.strip()
        if not c:
            continue
        candidate = f"{buf}\n{c}".strip() if buf else c
        if byte_len(candidate) <= max_bytes:
            buf = candidate
        else:
            if buf:
                merged.append(buf)
            if byte_len(c) > max_bytes:
                merged.extend(split_by_words(c, max_bytes))
                buf = ""
            else:
                buf = c
    if buf:
        merged.append(buf)
    return merged


def split_for_edge_tts(text: str, max_bytes: int = DEFAULT_MAX_BYTES) -> list[str]:
    """
    1. Tách theo đoạn (paragraph)
    2. Đoạn dài → tách theo câu
    3. Câu vẫn dài → tách theo từ / byte
    4. Gộp mẩu ngắn nếu còn chỗ
    """
    if not text or not str(text).strip():
        return []

    raw: list[str] = []
    for para in split_paragraphs(text):
        if byte_len(para) <= max_bytes:
            raw.append(para)
            continue
        for sent in split_sentences(para):
            if byte_len(sent) <= max_bytes:
                raw.append(sent)
            else:
                raw.extend(split_by_words(sent, max_bytes))

    return merge_small_chunks(raw, max_bytes)
