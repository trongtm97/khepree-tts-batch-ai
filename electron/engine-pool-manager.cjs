/**
 * Generic multi-engine pool manager.
 * Keeps EnginePool unchanged — one Map<entry.id, EnginePool>, no per-engine globals.
 */
const { EnginePool } = require('./engine-pool.cjs');
const registry = require('./engine-registry.cjs');

class EnginePoolManager {
    /**
     * @param {{ defaultMaxSize?: number }} [opts]
     */
    constructor(opts = {}) {
        /** @type {Map<string, import('./engine-pool.cjs').EnginePool>} */
        this.pools = new Map();
        this.defaultMaxSize = Math.max(1, Number(opts.defaultMaxSize) || 1);
    }

    /**
     * Resolve registry entry or throw for invalid / unusable engines.
     * @param {string} engineId
     */
    _requireEntry(engineId) {
        const entry = registry.getEngine(engineId);
        if (!entry) {
            throw new Error(`Unknown engine: ${engineId}`);
        }
        if (!entry.EngineClass) {
            throw new Error(`Engine chưa có runtime/EngineClass: ${entry.id}`);
        }
        return entry;
    }

    /**
     * Get or create the pool for engineId.
     * Same canonical id always returns the same pool instance.
     * @param {string} engineId
     * @param {number} [maxSize] — defaults to previous size or defaultMaxSize (settings.batchWorkers)
     */
    getPool(engineId, maxSize) {
        const entry = this._requireEntry(engineId);
        const id = entry.id;
        const size = Math.max(
            1,
            Number(maxSize) > 0 ? Number(maxSize) : (this.pools.get(id)?.maxSize || this.defaultMaxSize)
        );

        let pool = this.pools.get(id);
        if (!pool) {
            pool = new EnginePool(entry.EngineClass, size);
            pool.engineId = id;
            pool.EngineClass = entry.EngineClass;
            this.pools.set(id, pool);
        } else {
            pool.resize(size);
        }
        return pool;
    }

    hasPool(engineId) {
        const id = registry.resolveId(engineId);
        return Boolean(id && this.pools.has(id));
    }

    /**
     * Stop workers and remove pool, then create a fresh empty pool.
     * @param {string} engineId
     * @param {number} [maxSize]
     */
    reloadPool(engineId, maxSize) {
        const entry = this._requireEntry(engineId);
        const prevSize = this.pools.get(entry.id)?.maxSize;
        this.shutdownPool(engineId);
        return this.getPool(entry.id, maxSize || prevSize || this.defaultMaxSize);
    }

    /**
     * Stop all workers for engineId and drop the pool entry.
     * @returns {boolean} true if a pool existed
     */
    shutdownPool(engineId) {
        const id = registry.resolveId(engineId);
        if (!id) {
            throw new Error(`Unknown engine: ${engineId}`);
        }
        const pool = this.pools.get(id);
        if (!pool) return false;
        try { pool.stopAll(); } catch (_) { /* ignore */ }
        this.pools.delete(id);
        return true;
    }

    shutdownAll() {
        for (const pool of this.pools.values()) {
            try { pool.stopAll(); } catch (_) { /* ignore */ }
        }
        this.pools.clear();
    }

    /** Apply concurrency from settings.batchWorkers to every live pool. */
    resizeAll(maxSize) {
        const size = Math.max(1, Number(maxSize) || this.defaultMaxSize);
        this.defaultMaxSize = size;
        for (const pool of this.pools.values()) {
            pool.resize(size);
        }
    }

    getStatus(engineId) {
        const entry = registry.getEngine(engineId);
        if (!entry) return { error: `Unknown engine: ${engineId}` };
        const pool = this.pools.get(entry.id) || null;
        const primary = pool?.primary || null;
        return {
            engineId: entry.id,
            poolSize: pool?.maxSize ?? 0,
            slots: pool?.slots?.length ?? 0,
            ready: Boolean(primary?.ready),
            mode: primary?.mode || primary?.locale || entry.mode || entry.workerMode || null,
            hasPool: this.hasPool(entry.id),
        };
    }

    // --- Compatibility aliases (existing main/ipc callers) ---

    has(engineId) {
        return this.hasPool(engineId);
    }

    unload(engineId) {
        try {
            return this.shutdownPool(engineId);
        } catch (_) {
            return false;
        }
    }

    unloadAll() {
        this.shutdownAll();
    }
}

module.exports = { EnginePoolManager };
