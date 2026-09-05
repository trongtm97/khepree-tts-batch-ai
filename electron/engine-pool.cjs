/**
 * Pool of TTS engine workers for parallel batch synthesis.
 */
class EnginePool {
    constructor(EngineClass, maxSize = 1) {
        this.EngineClass = EngineClass;
        this.maxSize = Math.max(1, maxSize);
        /** @type {Array<{ engine: import('./vieneu-engine.cjs').VieNeuEngine, busy: boolean }>} */
        this.slots = [];
        this.waitQueue = [];
    }

    resize(maxSize) {
        this.maxSize = Math.max(1, maxSize);
        while (this.slots.length > this.maxSize) {
            const slot = this.slots.pop();
            try { slot?.engine?.stop(); } catch (_) { /* ignore */ }
        }
    }

    stopAll() {
        for (const slot of this.slots) {
            try { slot.engine.stop(); } catch (_) { /* ignore */ }
        }
        this.slots = [];
        this.waitQueue = [];
    }

    async acquire() {
        const free = this.slots.find((s) => !s.busy);
        if (free) {
            free.busy = true;
            return free.engine;
        }
        if (this.slots.length < this.maxSize) {
            const engine = new this.EngineClass();
            this.slots.push({ engine, busy: true });
            return engine;
        }
        return new Promise((resolve) => {
            this.waitQueue.push(resolve);
        }).then(() => this.acquire());
    }

    release(engine) {
        const slot = this.slots.find((s) => s.engine === engine);
        if (slot) slot.busy = false;
        const next = this.waitQueue.shift();
        if (next) next();
    }

    async withEngine(fn) {
        const engine = await this.acquire();
        try {
            return await fn(engine);
        } finally {
            this.release(engine);
        }
    }

    get primary() {
        return this.slots[0]?.engine ?? null;
    }
}

module.exports = { EnginePool };
