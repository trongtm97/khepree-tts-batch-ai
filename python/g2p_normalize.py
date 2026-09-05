"""sea-g2p text normalization (VieNeu phonemizer stack)."""
from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=4)
def _normalizer(lang: str):
    from sea_g2p import Normalizer

    return Normalizer(lang)


def normalize_with_sea_g2p(text: str, *, lang: str = "vi", enabled: bool = True) -> str:
    """
    Chuẩn hoá văn bản (số, ngày, viết tắt → dạng đọc) bằng sea-g2p Normalizer.
    Giữ xuống dòng để batch pause vẫn hoạt động.
    """
    if not enabled or not text or not str(text).strip():
        return text

    code = (lang or "vi").split("-")[0].lower()
    if code not in ("vi", "en"):
        code = "vi"

    try:
        normalizer = _normalizer(code)
        lines = str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n")
        out: list[str] = []
        for line in lines:
            if line.strip():
                out.append(normalizer.normalize(line))
            else:
                out.append(line)
        return "\n".join(out)
    except Exception:
        return text
