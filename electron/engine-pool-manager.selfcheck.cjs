/**
 * Self-check: EnginePoolManager Map semantics.
 * Run: node electron/engine-pool-manager.selfcheck.cjs
 */
const assert = require('assert');
const { EnginePoolManager } = require('./engine-pool-manager.cjs');
const { EnginePool } = require('./engine-pool.cjs');
const registry = require('./engine-registry.cjs');

const mgr = new EnginePoolManager({ defaultMaxSize: 2 });

// --- invalid engine ---
assert.throws(() => mgr.getPool('no-such-engine'), /Unknown engine/);
assert.throws(() => mgr.reloadPool('no-such-engine'), /Unknown engine/);
assert.throws(() => mgr.shutdownPool('no-such-engine'), /Unknown engine/);
assert.strictEqual(mgr.hasPool('no-such-engine'), false);

// --- create three pools ---
const pVieneu = mgr.getPool('vieneu', 2);
const pNano = mgr.getPool('v3nano', 2);
const pEdge = mgr.getPool('edge', 1);

assert.ok(pVieneu instanceof EnginePool);
assert.ok(pNano instanceof EnginePool);
assert.ok(pEdge instanceof EnginePool);
assert.notStrictEqual(pVieneu, pNano);
assert.notStrictEqual(pVieneu, pEdge);
assert.strictEqual(pVieneu.EngineClass, registry.getEngine('vieneu').EngineClass);
assert.strictEqual(pNano.EngineClass, registry.getEngine('v3nano').EngineClass);
assert.strictEqual(pEdge.EngineClass, registry.getEngine('edge').EngineClass);
assert.strictEqual(mgr.pools.size, 3);

// --- same engine twice → same pool (no duplicate) ---
const pVieneu2 = mgr.getPool('vieneu', 2);
const pAlias = mgr.getPool('vieneu-turbo', 3); // alias + resize
assert.strictEqual(pVieneu2, pVieneu);
assert.strictEqual(pAlias, pVieneu);
assert.strictEqual(pVieneu.maxSize, 3);
assert.strictEqual(mgr.pools.size, 3);
assert.ok(mgr.hasPool('vieneu'));
assert.ok(mgr.hasPool('vieneu-turbo'));
assert.ok(mgr.hasPool('v3nano'));
assert.ok(mgr.hasPool('edge'));

// --- shutdown one ---
assert.strictEqual(mgr.shutdownPool('v3nano'), true);
assert.strictEqual(mgr.hasPool('v3nano'), false);
assert.strictEqual(mgr.pools.size, 2);
assert.strictEqual(mgr.shutdownPool('v3nano'), false); // already gone

// --- reload recreates fresh pool ---
const before = mgr.getPool('edge', 1);
const reloaded = mgr.reloadPool('edge', 2);
assert.notStrictEqual(reloaded, before);
assert.ok(mgr.hasPool('edge'));
assert.strictEqual(reloaded.maxSize, 2);
assert.strictEqual(reloaded.slots.length, 0);

// --- shutdownAll ---
mgr.shutdownAll();
assert.strictEqual(mgr.pools.size, 0);
assert.strictEqual(mgr.hasPool('vieneu'), false);
assert.strictEqual(mgr.hasPool('edge'), false);

// --- compat aliases ---
const again = mgr.getPool('vieneu', 1);
assert.ok(mgr.has('vieneu'));
mgr.unload('vieneu');
assert.strictEqual(mgr.hasPool('vieneu'), false);
mgr.getPool('edge', 1);
mgr.unloadAll();
assert.strictEqual(mgr.pools.size, 0);

// --- resizeAll tracks batchWorkers-style concurrency ---
mgr.getPool('vieneu', 1);
mgr.getPool('edge', 1);
mgr.resizeAll(4);
assert.strictEqual(mgr.getPool('vieneu').maxSize, 4);
assert.strictEqual(mgr.getPool('edge').maxSize, 4);
mgr.shutdownAll();

console.log('engine-pool-manager.selfcheck: ok');
