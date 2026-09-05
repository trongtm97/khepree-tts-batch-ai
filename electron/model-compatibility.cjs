/**
 * Model / engine compatibility advisor.
 * Levels from real hardware probes + engine capability flags only.
 * Never invent VRAM GB requirements.
 */
const COMPAT = Object.freeze({
    RECOMMENDED: 'RECOMMENDED',
    SUPPORTED: 'SUPPORTED',
    MAY_BE_SLOW: 'MAY_BE_SLOW',
    NOT_RECOMMENDED: 'NOT_RECOMMENDED',
    UNAVAILABLE: 'UNAVAILABLE',
});

function capsOf(engine) {
    return engine?.capabilities || {};
}

function isLightEngine(engine) {
    const badges = engine?.badges || [];
    if (badges.some((b) => /nhẹ|light|fast/i.test(String(b)))) return true;
    if (engine?.online && capsOf(engine).gpu === false) return true;
    return false;
}

function installOk(engine) {
    if (engine?.bundled) return true;
    const st = engine?.installState;
    if (st == null) return true;
    return st === 'INSTALLED';
}

/**
 * @param {object} engine — registry public entry
 * @param {object} hardware — detectHardware() profile
 * @param {{ variant?: string }} [opts]
 * @returns {{ level: string, message: string, reasons: string[] }}
 */
function adviseEngine(engine, hardware, opts = {}) {
    const reasons = [];
    if (!engine) {
        return { level: COMPAT.UNAVAILABLE, message: 'Không tìm thấy engine.', reasons: ['missing'] };
    }

    if (!installOk(engine) && engine.optional) {
        return {
            level: COMPAT.UNAVAILABLE,
            message: 'Engine chưa được cài trên máy này.',
            reasons: ['not-installed'],
        };
    }

    const caps = capsOf(engine);
    const cpuOk = caps.cpu !== false;
    const gpuCapable = Boolean(caps.gpu);
    const gpuRequired = gpuCapable && caps.cpu === false;
    const hasNvidia = Boolean(hardware?.gpu?.nvidia);
    const ramGb = Number(hardware?.ram?.totalGb) || 0;
    const light = isLightEngine(engine);

    if (gpuRequired && !hasNvidia) {
        return {
            level: COMPAT.UNAVAILABLE,
            message: 'Model này cần GPU mà máy không có — hiện không khả dụng.',
            reasons: ['gpu-required', 'no-nvidia'],
        };
    }

    // Chatterbox family — variant-aware; never invent VRAM GB floors
    if (engine.family === 'chatterbox' || engine.id === 'chatterbox') {
        const variant = String(
            opts.variant || engine.selectedVariant || engine.modelVariant || 'nano'
        ).toLowerCase();
        if (variant === 'turbo') {
            if (hasNvidia) {
                return {
                    level: COMPAT.RECOMMENDED,
                    message: 'Turbo phù hợp với máy có GPU NVIDIA.',
                    reasons: ['chatterbox-turbo', 'nvidia-present'],
                };
            }
            if (ramGb > 0 && ramGb < 8) {
                return {
                    level: COMPAT.MAY_BE_SLOW,
                    message: 'Turbo chạy được trên CPU nhưng có thể chậm (RAM hạn chế). GPU giúp trải nghiệm tốt hơn.',
                    reasons: ['chatterbox-turbo', 'no-gpu', 'modest-ram'],
                };
            }
            return {
                level: COMPAT.SUPPORTED,
                message: 'Turbo chạy được trên CPU; GPU giúp trải nghiệm tốt hơn.',
                reasons: ['chatterbox-turbo', 'cpu-ok'],
            };
        }
        // nano — CPU-friendly
        if (ramGb > 0 && ramGb < 4) {
            return {
                level: COMPAT.MAY_BE_SLOW,
                message: 'Nano có thể chạy nhưng máy đang hạn chế RAM — batch lớn có thể chậm.',
                reasons: ['chatterbox-nano', 'low-ram'],
            };
        }
        return {
            level: COMPAT.RECOMMENDED,
            message: 'Nano hướng tới CPU / on-device — phù hợp với máy của bạn.',
            reasons: ['chatterbox-nano', 'cpu-friendly'],
        };
    }

    // Qwen3-TTS 0.6B — GPU preferred for consumer PCs; no invented VRAM floors
    if (engine.family === 'qwen3' || engine.id === 'qwen3') {
        if (hasNvidia) {
            return {
                level: COMPAT.RECOMMENDED,
                message: 'Qwen3-TTS 0.6B phù hợp với máy có GPU NVIDIA.',
                reasons: ['qwen3', 'nvidia-present'],
            };
        }
        if (ramGb > 0 && ramGb < 8) {
            return {
                level: COMPAT.MAY_BE_SLOW,
                message: 'Qwen3-TTS có thể chạy trên CPU nhưng chậm (RAM hạn chế). Nên dùng GPU hoặc model ONNX nhẹ hơn.',
                reasons: ['qwen3', 'no-gpu', 'modest-ram'],
            };
        }
        return {
            level: COMPAT.MAY_BE_SLOW,
            message: 'Qwen3-TTS chạy được trên CPU nhưng load/inference chậm hơn; GPU giúp trải nghiệm tốt hơn.',
            reasons: ['qwen3', 'cpu-ok'],
        };
    }

    // Spark-TTS 0.5B — GPU recommended; no invented VRAM floors
    if (engine.family === 'spark' || engine.id === 'spark') {
        if (hasNvidia) {
            return {
                level: COMPAT.RECOMMENDED,
                message: 'Spark-TTS 0.5B phù hợp với máy có GPU NVIDIA.',
                reasons: ['spark', 'nvidia-present'],
            };
        }
        if (ramGb > 0 && ramGb < 8) {
            return {
                level: COMPAT.MAY_BE_SLOW,
                message: 'Spark-TTS có thể chạy trên CPU nhưng chậm (RAM hạn chế). Nên dùng GPU.',
                reasons: ['spark', 'no-gpu', 'modest-ram'],
            };
        }
        return {
            level: COMPAT.MAY_BE_SLOW,
            message: 'Spark-TTS chạy được trên CPU nhưng GPU được khuyến nghị.',
            reasons: ['spark', 'cpu-ok'],
        };
    }

    // GPT-SoVITS Voice Lab — GPU recommended; heavy stack
    if (engine.family === 'gpt-sovits' || engine.id === 'gpt-sovits') {
        if (hasNvidia) {
            return {
                level: COMPAT.RECOMMENDED,
                message: 'GPT-SoVITS Voice Lab phù hợp với máy có GPU NVIDIA.',
                reasons: ['gpt-sovits', 'nvidia-present'],
            };
        }
        if (ramGb > 0 && ramGb < 16) {
            return {
                level: COMPAT.NOT_RECOMMENDED,
                message: 'GPT-SoVITS rất nặng trên CPU/RAM hạn chế. Nên dùng GPU hoặc Chatterbox/VieNeu.',
                reasons: ['gpt-sovits', 'no-gpu', 'modest-ram'],
            };
        }
        return {
            level: COMPAT.MAY_BE_SLOW,
            message: 'GPT-SoVITS chạy được trên CPU nhưng GPU được khuyến nghị mạnh.',
            reasons: ['gpt-sovits', 'cpu-ok'],
        };
    }

    // Light / online CPU engines
    if (light && cpuOk) {
        reasons.push('light-cpu');
        return {
            level: COMPAT.RECOMMENDED,
            message: 'Rất phù hợp với máy của bạn. Model này chạy bằng CPU và không cần GPU.',
            reasons,
        };
    }

    // Strict CPU-only
    if (cpuOk && !gpuCapable) {
        reasons.push('cpu-only');
        if (ramGb > 0 && ramGb < 4) {
            return {
                level: COMPAT.MAY_BE_SLOW,
                message: 'Model có thể chạy nhưng máy đang hạn chế RAM — batch lớn có thể chậm.',
                reasons: [...reasons, 'low-ram'],
            };
        }
        return {
            level: COMPAT.RECOMMENDED,
            message: 'Rất phù hợp với máy của bạn. Model này chạy bằng CPU và không cần GPU.',
            reasons,
        };
    }

    // CPU + optional GPU (VieNeu Turbo, etc.) — no invented VRAM floor
    if (cpuOk && gpuCapable) {
        if (hasNvidia) {
            return {
                level: COMPAT.RECOMMENDED,
                message: 'Rất phù hợp với máy của bạn (có GPU NVIDIA).',
                reasons: ['nvidia-present'],
            };
        }
        if (ramGb > 0 && ramGb < 8) {
            return {
                level: COMPAT.MAY_BE_SLOW,
                message: 'Model có thể chạy nhưng batch lớn có thể chậm.',
                reasons: ['no-gpu', 'modest-ram'],
            };
        }
        return {
            level: COMPAT.NOT_RECOMMENDED,
            message: 'Model này được khuyến nghị dùng với GPU.',
            reasons: ['gpu-helpful', 'no-nvidia'],
        };
    }

    if (gpuCapable && !hasNvidia) {
        return {
            level: COMPAT.NOT_RECOMMENDED,
            message: 'Model này nặng; không có GPU nên không được khuyến nghị trên máy này.',
            reasons: ['gpu-preferred', 'no-nvidia'],
        };
    }

    return {
        level: COMPAT.SUPPORTED,
        message: 'Máy của bạn chạy được model này.',
        reasons: ['default'],
    };
}

function adviseAll(engines, hardware) {
    return (Array.isArray(engines) ? engines : []).map((e) => ({
        engineId: e.id,
        ...adviseEngine(e, hardware),
    }));
}

module.exports = {
    COMPAT,
    adviseEngine,
    adviseAll,
    isLightEngine,
};
