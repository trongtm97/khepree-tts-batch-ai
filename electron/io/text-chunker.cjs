/**
 * Tách văn bản dài thành các đoạn ngắn — giữ mạch đoạn/câu/hội thoại.
 * Dùng khi import và khi người dùng nhập/dán văn bản dài trên bảng batch.
 */
const SENTENCE_SPLIT = /(?<=[.!?…:;])\s+/;
const DIALOGUE_START = /^[—\-–""「『»«]/;
const SCENE_BREAK = /^(\*{3,}|-{3,}|_{3,}|={3,}|#{3,})$/i;
const CHAPTER_HEAD = /^(chương|phan|phần|hồi|chapter|part)\s+[\dIVXLC]+/i;
const DEFAULTS = {
    maxChars: 1200,
    minChars: 0,
};

function charLen(text) {
    return String(text || '').length;
}

function normalizeNewlines(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isSceneBreak(line) {
    const t = line.trim();
    return SCENE_BREAK.test(t) || CHAPTER_HEAD.test(t);
}

function isDialogueLine(line) {
    const t = line.trim();
    if (!t) return false;
    if (DIALOGUE_START.test(t)) return true;
    if (/^[""「『].+[""」』]$/.test(t)) return true;
    return false;
}

function isAttributionLine(line) {
    const t = line.trim();
    if (!t || isDialogueLine(t)) return false;
    if (t.length > 120) return false;
    return /\b(nói|thì thầm|lẩm bẩm|hỏi|đáp|reo|thốt|gằn|thở dài|cười|khẽ)\b/i.test(t)
        || /^(cô|anh|chị|em|ông|bà|hắn|nàng|y|họ|ai đó)\b/i.test(t);
}

function splitSentences(text) {
    const p = text.trim();
    if (!p) return [];
    const parts = SENTENCE_SPLIT.split(p);
    const out = parts.map((s) => s.trim()).filter(Boolean);
    return out.length ? out : [p];
}

function splitByWords(text, maxChars) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const chunks = [];
    let buf = '';
    for (const w of words) {
        const candidate = buf ? `${buf} ${w}` : w;
        if (charLen(candidate) <= maxChars) {
            buf = candidate;
            continue;
        }
        if (buf) chunks.push(buf);
        if (charLen(w) > maxChars) {
            for (let i = 0; i < w.length; i += maxChars) {
                chunks.push(w.slice(i, i + maxChars));
            }
            buf = '';
        } else {
            buf = w;
        }
    }
    if (buf) chunks.push(buf);
    return chunks;
}

function splitOversizedUnit(unit, maxChars) {
    const u = unit.trim();
    if (charLen(u) <= maxChars) return [u];

    const lines = u.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const packed = packUnits(lines, maxChars, { hardBreakOnScene: false });
        if (packed.every((c) => charLen(c) <= maxChars)) return packed;
    }

    const sentences = splitSentences(u.replace(/\n/g, ' '));
    if (sentences.length > 1) {
        const packed = packUnits(sentences, maxChars, { hardBreakOnScene: false });
        if (packed.every((c) => charLen(c) <= maxChars)) return packed;
    }

    return splitByWords(u.replace(/\n/g, ' '), maxChars);
}

function linesToUnits(lines) {
    const units = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i += 1;
            continue;
        }
        if (isSceneBreak(line)) {
            units.push({ text: line, hardBreak: true });
            i += 1;
            continue;
        }
        if (isDialogueLine(line) && i + 1 < lines.length) {
            const next = lines[i + 1].trim();
            if (next && isAttributionLine(next)) {
                units.push({ text: `${line}\n${next}`, hardBreak: false });
                i += 2;
                continue;
            }
        }
        units.push({ text: line, hardBreak: false });
        i += 1;
    }
    return units;
}

function splitParagraphToUnits(paragraph) {
    const p = paragraph.trim();
    if (!p) return [];
    const lines = p.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (lines.length <= 1) {
        if (charLen(p) <= 0) return [];
        return [{ text: p, hardBreak: false }];
    }
    return linesToUnits(lines);
}

function splitIntoParagraphs(text) {
    const t = normalizeNewlines(text).trim();
    if (!t) return [];

    if (t.includes('\n\n')) {
        return t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    }

    const paragraphs = [];
    let buf = [];
    for (const raw of t.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            if (buf.length) {
                paragraphs.push(buf.join('\n'));
                buf = [];
            }
            continue;
        }
        if (isSceneBreak(line.trim()) && buf.length) {
            paragraphs.push(buf.join('\n'));
            buf = [line.trim()];
            paragraphs.push(buf.join('\n'));
            buf = [];
            continue;
        }
        buf.push(line);
    }
    if (buf.length) paragraphs.push(buf.join('\n'));
    return paragraphs;
}

function packUnits(unitEntries, maxChars, { hardBreakOnScene = true } = {}) {
    const chunks = [];
    let buf = '';

    const flush = () => {
        if (buf.trim()) {
            chunks.push(buf.trim());
            buf = '';
        }
    };

    for (const entry of unitEntries) {
        const unit = typeof entry === 'string' ? entry : entry.text;
        const hardBreak = typeof entry === 'object' && entry.hardBreak;

        if (hardBreakOnScene && hardBreak) {
            flush();
            chunks.push(unit.trim());
            continue;
        }

        const u = unit.trim();
        if (!u) continue;

        if (charLen(u) > maxChars) {
            flush();
            chunks.push(...splitOversizedUnit(u, maxChars));
            continue;
        }

        const joiner = buf.includes('\n') || u.includes('\n') ? '\n' : '\n\n';
        const candidate = buf ? `${buf}${joiner}${u}` : u;
        if (charLen(candidate) <= maxChars) {
            buf = candidate;
        } else {
            flush();
            buf = u;
        }
    }
    flush();
    return chunks;
}

function collectUnits(text, maxChars) {
    const paragraphs = splitIntoParagraphs(text);
    const units = [];
    for (const para of paragraphs) {
        const paraUnits = splitParagraphToUnits(para);
        if (!paraUnits.length) continue;

        if (charLen(para) <= 0) continue;

        const paraLen = charLen(para);
        if (paraUnits.length === 1 && paraLen <= maxChars) {
            units.push({ text: para, hardBreak: paraUnits[0].hardBreak });
            continue;
        }
        units.push(...paraUnits);
    }
    return units;
}

function chunkText(text, options = {}) {
    const maxChars = Math.max(400, Math.min(5000, Number(options.maxChars) || DEFAULTS.maxChars));
    const t = normalizeNewlines(text).trim();
    if (!t) return [];
    if (charLen(t) <= maxChars) return [t];

    const units = collectUnits(t, maxChars);
    if (!units.length) return [t];

    const packed = packUnits(units, maxChars, { hardBreakOnScene: true });
    return packed.length ? packed : [t];
}

function expandImportRows(rows, options = {}) {
    const maxChars = Math.max(400, Math.min(5000, Number(options.maxChars) || DEFAULTS.maxChars));
    const threshold = Number(options.thresholdChars) || maxChars;
    const out = [];

    for (const row of rows || []) {
        const text = String(row.text || '').trim();
        if (!text) continue;

        if (charLen(text) <= threshold) {
            out.push({
                text,
                nameSave: row.nameSave || '',
                group: row.group || '',
            });
            continue;
        }

        const chunks = chunkText(text, { maxChars });
        if (chunks.length <= 1) {
            out.push({
                text: chunks[0] || text,
                nameSave: row.nameSave || '',
                group: row.group || '',
            });
            continue;
        }

        const baseName = String(row.nameSave || 'doan').replace(/_\d{2,}$/i, '') || 'doan';
        chunks.forEach((chunk, idx) => {
            out.push({
                text: chunk,
                nameSave: `${baseName}_${String(idx + 1).padStart(2, '0')}`,
                group: row.group || '',
            });
        });
    }
    return out;
}

function splitJobs(jobs, options = {}) {
    const maxChars = Math.max(400, Math.min(5000, Number(options.maxChars) || DEFAULTS.maxChars));
    const onlySelected = options.onlySelected !== false;
    const result = [];

    for (const job of jobs || []) {
        if (onlySelected && !job.checked) {
            result.push(job);
            continue;
        }

        const text = String(job.text || '').trim();
        if (!text || charLen(text) <= maxChars) {
            result.push(job);
            continue;
        }

        const chunks = chunkText(text, { maxChars });
        if (chunks.length <= 1) {
            result.push(job);
            continue;
        }

        const baseName = String(job.nameSave || job.id || 'doan').replace(/_\d{2,}$/i, '');
        chunks.forEach((chunk, idx) => {
            result.push({
                ...job,
                id: undefined,
                text: chunk,
                nameSave: `${baseName}_${String(idx + 1).padStart(2, '0')}`,
                status: 'pending',
                progress: 0,
                result: '',
                outputPath: '',
                checked: job.checked,
            });
        });
    }
    return result;
}

module.exports = {
    DEFAULTS,
    chunkText,
    expandImportRows,
    splitJobs,
};
