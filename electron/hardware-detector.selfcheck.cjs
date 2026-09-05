/**
 * Self-check: hardware detector + compatibility (no crash without NVIDIA).
 * Run: electron electron/hardware-detector.selfcheck.cjs
 */
const assert = require('assert');
const { app } = require('electron');
const { detectHardware, parseNvidiaSmi } = require('./hardware-detector.cjs');
const { adviseEngine, COMPAT } = require('./model-compatibility.cjs');

app.whenReady().then(() => {
    try {
        assert.strictEqual(parseNvidiaSmi(''), null);
        const parsed = parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288, 560.00, 12.6');
        assert.ok(parsed);
        assert.strictEqual(parsed.name, 'NVIDIA GeForce RTX 3060');
        assert.strictEqual(parsed.vramMb, 12288);
        assert.strictEqual(parsed.trustedVram, true);

        const hw = detectHardware({ probeOnnx: false });
        assert.ok(hw.os?.platform);
        assert.ok(hw.cpu?.name);
        assert.ok(Number(hw.cpu?.cores) >= 1);
        assert.ok(Number(hw.ram?.totalBytes) > 0);
        assert.ok(typeof hw.gpu?.nvidia === 'boolean');
        assert.ok(hw.gpu?.nvidiaSmiAvailable === true || hw.gpu?.nvidiaSmiAvailable === false);
        // Missing NVIDIA must not throw / must not invent VRAM
        if (!hw.gpu.nvidia) {
            assert.strictEqual(hw.gpu.vramMb, null);
            assert.strictEqual(hw.cuda.available, false);
        } else if (hw.gpu.vramTrusted) {
            assert.ok(hw.gpu.vramMb > 0);
        }

        const edge = {
            id: 'edge',
            online: true,
            bundled: true,
            capabilities: { cpu: true, gpu: false },
            badges: ['Nhẹ', 'Online'],
        };
        const turbo = {
            id: 'vieneu',
            online: false,
            bundled: true,
            capabilities: { cpu: true, gpu: true },
            badges: ['Nâng cao'],
        };
        const gpuOnly = {
            id: 'fake-gpu',
            optional: true,
            installState: 'INSTALLED',
            capabilities: { cpu: false, gpu: true },
            badges: [],
        };

        const noGpuHw = {
            ram: { totalGb: 16 },
            gpu: { nvidia: false },
        };
        const withGpuHw = {
            ram: { totalGb: 16 },
            gpu: { nvidia: true, name: 'RTX', vramMb: 8, vramTrusted: true },
        };
        const lowRamHw = {
            ram: { totalGb: 4 },
            gpu: { nvidia: false },
        };

        assert.strictEqual(adviseEngine(edge, noGpuHw).level, COMPAT.RECOMMENDED);
        assert.ok(/CPU/.test(adviseEngine(edge, noGpuHw).message));

        assert.strictEqual(adviseEngine(turbo, withGpuHw).level, COMPAT.RECOMMENDED);
        assert.strictEqual(adviseEngine(turbo, noGpuHw).level, COMPAT.NOT_RECOMMENDED);
        assert.ok(/GPU/.test(adviseEngine(turbo, noGpuHw).message));

        assert.strictEqual(adviseEngine(turbo, lowRamHw).level, COMPAT.MAY_BE_SLOW);
        assert.ok(/chậm/.test(adviseEngine(turbo, lowRamHw).message));

        assert.strictEqual(adviseEngine(gpuOnly, noGpuHw).level, COMPAT.UNAVAILABLE);

        const cb = {
            id: 'chatterbox',
            family: 'chatterbox',
            optional: true,
            installState: 'INSTALLED',
            capabilities: { cpu: true, gpu: true },
            modelVariant: 'nano',
        };
        assert.strictEqual(
            adviseEngine(cb, withGpuHw, { variant: 'turbo' }).level,
            COMPAT.RECOMMENDED
        );
        assert.strictEqual(
            adviseEngine(cb, noGpuHw, { variant: 'turbo' }).level,
            COMPAT.SUPPORTED
        );
        assert.strictEqual(
            adviseEngine(cb, lowRamHw, { variant: 'turbo' }).level,
            COMPAT.MAY_BE_SLOW
        );
        assert.strictEqual(
            adviseEngine(cb, noGpuHw, { variant: 'nano' }).level,
            COMPAT.RECOMMENDED
        );

        const qwen = {
            id: 'qwen3',
            family: 'qwen3',
            optional: true,
            installState: 'INSTALLED',
            capabilities: { cpu: true, gpu: true },
        };
        assert.strictEqual(adviseEngine(qwen, withGpuHw).level, COMPAT.RECOMMENDED);
        assert.strictEqual(adviseEngine(qwen, noGpuHw).level, COMPAT.MAY_BE_SLOW);

        const spark = {
            id: 'spark',
            family: 'spark',
            optional: true,
            installState: 'INSTALLED',
            capabilities: { cpu: true, gpu: true },
        };
        assert.strictEqual(adviseEngine(spark, withGpuHw).level, COMPAT.RECOMMENDED);
        assert.strictEqual(adviseEngine(spark, noGpuHw).level, COMPAT.MAY_BE_SLOW);

        const gsv = {
            id: 'gpt-sovits',
            family: 'gpt-sovits',
            optional: true,
            installState: 'INSTALLED',
            capabilities: { cpu: true, gpu: true },
        };
        assert.strictEqual(adviseEngine(gsv, withGpuHw).level, COMPAT.RECOMMENDED);
        assert.ok(
            [COMPAT.MAY_BE_SLOW, COMPAT.NOT_RECOMMENDED].includes(
                adviseEngine(gsv, noGpuHw).level
            )
        );

        console.log('hardware-detector.selfcheck: ok');
        console.log('  platform:', hw.os.platform);
        console.log('  cpu:', hw.cpu.name);
        console.log('  ramGb:', hw.ram.totalGb);
        console.log('  nvidia:', hw.gpu.nvidia, hw.gpu.name || '');
        app.quit();
    } catch (e) {
        console.error('hardware-detector.selfcheck FAILED:', e);
        app.exit(1);
    }
});
