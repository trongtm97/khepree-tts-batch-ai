/**
 * Model Download Manager — optional engines only.
 * Network context is separate from packaged inference (HF offline).
 * Packages must be registered locally; no arbitrary URL / script downloads.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const paths = require('./paths.cjs');

const STATUS = Object.freeze({
    NOT_INSTALLED: 'NOT_INSTALLED',
    INSTALLING: 'INSTALLING',
    INSTALLED: 'INSTALLED',
    BROKEN: 'BROKEN',
});

const MANIFEST_NAME = '.khepree-model-manifest.json';
const MAX_REDIRECTS = 5;

/** @type {Map<string, object>} key = engineId::variant */
const packages = new Map();

/** @type {Map<string, { controller: AbortController, promise: Promise }>} */
const active = new Map();

/** @type {(payload: object) => void | null} */
let progressSink = null;

function pkgKey(engineId, variant) {
    return `${String(engineId || '').trim()}::${sanitizeVariant(variant)}`;
}

function sanitizeVariant(variant) {
    return String(variant || 'default')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 64) || 'default';
}

function sanitizeRel(rel) {
    const clean = String(rel || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    if (!clean || clean.includes('..') || path.isAbsolute(clean)) {
        throw new Error(`Unsafe relative path: ${rel}`);
    }
    return clean;
}

/**
 * Register an allowed download package (local catalog only).
 * @param {{ engineId: string, variant?: string, version?: string, files: Array<{ relativePath: string, url: string, sha256?: string, size?: number }> }} pkg
 */
function registerPackage(pkg) {
    if (!pkg?.engineId) throw new Error('registerPackage requires engineId');
    if (!Array.isArray(pkg.files) || !pkg.files.length) {
        throw new Error('registerPackage requires files[]');
    }
    for (const f of pkg.files) {
        sanitizeRel(f.relativePath);
        assertAllowedUrl(f.url);
    }
    const variant = sanitizeVariant(pkg.variant);
    const key = pkgKey(pkg.engineId, variant);
    packages.set(key, Object.freeze({
        engineId: String(pkg.engineId),
        variant,
        version: String(pkg.version || '1'),
        files: Object.freeze(pkg.files.map((f) => Object.freeze({
            relativePath: sanitizeRel(f.relativePath),
            url: String(f.url),
            sha256: f.sha256 ? String(f.sha256).toLowerCase() : null,
            size: Number.isFinite(f.size) ? Number(f.size) : null,
        }))),
    }));
    return key;
}

function getPackage(engineId, variant) {
    return packages.get(pkgKey(engineId, variant)) || null;
}

function listPackages() {
    return [...packages.values()];
}

function clearPackages() {
    packages.clear();
}

function setProgressSink(fn) {
    progressSink = typeof fn === 'function' ? fn : null;
}

function emitProgress(payload) {
    try {
        progressSink?.(payload);
    } catch (_) { /* never break download on UI sink */ }
}

function assertAllowedUrl(raw) {
    let u;
    try {
        u = new URL(String(raw));
    } catch (_) {
        throw new Error(`Invalid download URL: ${raw}`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`Only http(s) downloads allowed: ${raw}`);
    }
    return u;
}

/**
 * Install root for optional models — always under user models, never bundled/resources.
 */
function getInstallRoot(engineId, variant) {
    const root = path.join(paths.getEngineModelDir(engineId), sanitizeVariant(variant));
    const userRoot = path.resolve(paths.getUserModelsDir());
    const resolved = path.resolve(root);
    if (resolved !== userRoot && !resolved.startsWith(userRoot + path.sep)) {
        throw new Error('Model install path must stay under user models dir');
    }
    // Also refuse if engine resolves to bundled tree
    try {
        const bundled = path.resolve(paths.getBundledModelsDir());
        if (resolved === bundled || resolved.startsWith(bundled + path.sep)) {
            throw new Error('Refusing to download into bundled models dir');
        }
    } catch (e) {
        if (String(e.message || '').includes('Refusing')) throw e;
    }
    return resolved;
}

function manifestPath(engineId, variant) {
    return path.join(getInstallRoot(engineId, variant), MANIFEST_NAME);
}

function readManifest(engineId, variant) {
    const p = manifestPath(engineId, variant);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return { status: STATUS.BROKEN, parseError: true };
    }
}

function writeManifest(engineId, variant, data) {
    const root = getInstallRoot(engineId, variant);
    fs.mkdirSync(root, { recursive: true });
    const tmp = path.join(root, `${MANIFEST_NAME}.partial`);
    const final = path.join(root, MANIFEST_NAME);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    atomicRename(tmp, final);
}

function atomicRename(from, to) {
    try {
        if (fs.existsSync(to)) fs.unlinkSync(to);
    } catch (_) { /* best-effort */ }
    fs.renameSync(from, to);
}

function fileSha256(filePath) {
    const hash = crypto.createHash('sha256');
    const buf = fs.readFileSync(filePath);
    hash.update(buf);
    return hash.digest('hex');
}

/**
 * Verify on-disk files against package and/or manifest.
 * Trusted checks: sha256 and/or exact size when provided.
 */
function verifyFiles(engineId, variant, pkg, man) {
    const root = getInstallRoot(engineId, variant);
    const files = pkg?.files || man?.files || [];
    if (!files.length) {
        return { ok: false, reason: 'no files to verify' };
    }
    for (const f of files) {
        const rel = sanitizeRel(f.relativePath);
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) {
            return { ok: false, reason: `missing: ${rel}` };
        }
        const st = fs.statSync(full);
        if (!st.isFile() || st.size === 0) {
            return { ok: false, reason: `empty or not a file: ${rel}` };
        }
        const expectSize = f.size ?? null;
        if (expectSize != null && st.size !== expectSize) {
            return { ok: false, reason: `size mismatch: ${rel}` };
        }
        const expectHash = f.sha256 || null;
        if (expectHash) {
            const got = fileSha256(full);
            if (got !== String(expectHash).toLowerCase()) {
                return { ok: false, reason: `checksum mismatch: ${rel}` };
            }
        }
        // Incomplete download leftover
        if (fs.existsSync(`${full}.partial`)) {
            return { ok: false, reason: `partial leftover: ${rel}` };
        }
    }
    return { ok: true };
}

function getStatus(engineId, variant) {
    const key = pkgKey(engineId, variant);
    if (active.has(key)) return STATUS.INSTALLING;

    const man = readManifest(engineId, variant);
    if (!man) return STATUS.NOT_INSTALLED;
    if (man.parseError) return STATUS.BROKEN;
    if (man.status === STATUS.INSTALLING) {
        // Crashed mid-install — never treat as installed
        return STATUS.BROKEN;
    }
    if (man.status !== STATUS.INSTALLED) return STATUS.NOT_INSTALLED;

    const pkg = getPackage(engineId, variant);
    const check = verifyFiles(engineId, variant, pkg, man);
    return check.ok ? STATUS.INSTALLED : STATUS.BROKEN;
}

function verify(engineId, variant) {
    const status = getStatus(engineId, variant);
    const pkg = getPackage(engineId, variant);
    const man = readManifest(engineId, variant);
    const check = verifyFiles(engineId, variant, pkg, man);
    return {
        ok: status === STATUS.INSTALLED && check.ok,
        status,
        reason: check.ok ? null : check.reason,
        installRoot: (() => {
            try { return getInstallRoot(engineId, variant); } catch (_) { return null; }
        })(),
    };
}

function downloadToPartial(urlStr, destPartial, { signal, onBytes, expectedHost } = {}) {
    return new Promise((resolve, reject) => {
        let redirects = 0;

        const go = (currentUrl) => {
            if (signal?.aborted) {
                reject(Object.assign(new Error('Download cancelled'), { code: 'CANCELLED' }));
                return;
            }
            let u;
            try {
                u = assertAllowedUrl(currentUrl);
            } catch (e) {
                reject(e);
                return;
            }
            if (expectedHost && u.hostname !== expectedHost) {
                reject(new Error(`Redirect host not allowed: ${u.hostname}`));
                return;
            }

            const lib = u.protocol === 'https:' ? https : http;
            const req = lib.get(u, { signal }, (res) => {
                const code = res.statusCode || 0;
                if (code >= 300 && code < 400 && res.headers.location) {
                    res.resume();
                    if (++redirects > MAX_REDIRECTS) {
                        reject(new Error('Too many redirects'));
                        return;
                    }
                    go(new URL(res.headers.location, u).href);
                    return;
                }
                if (code !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${code} for ${u.href}`));
                    return;
                }

                fs.mkdirSync(path.dirname(destPartial), { recursive: true });
                const out = fs.createWriteStream(destPartial);
                let received = 0;
                res.on('data', (chunk) => {
                    received += chunk.length;
                    onBytes?.(received, Number(res.headers['content-length']) || null);
                });
                res.pipe(out);
                out.on('finish', () => resolve({ bytes: received }));
                out.on('error', reject);
                res.on('error', reject);
            });
            req.on('error', reject);
        };

        go(urlStr);
    });
}

async function install(engineId, variant) {
    const pkg = getPackage(engineId, variant);
    if (!pkg) {
        throw Object.assign(
            new Error(`No download package registered for ${engineId}/${sanitizeVariant(variant)}`),
            { code: 'NO_PACKAGE' }
        );
    }

    const key = pkgKey(engineId, variant);
    if (active.has(key)) {
        return active.get(key).promise;
    }

    const controller = new AbortController();
    const root = getInstallRoot(engineId, variant);

    const run = (async () => {
        // Never mark INSTALLED until all files land
        writeManifest(engineId, variant, {
            engineId: pkg.engineId,
            variant: pkg.variant,
            version: pkg.version,
            status: STATUS.INSTALLING,
            files: pkg.files,
            startedAt: new Date().toISOString(),
        });

        emitProgress({
            engineId: pkg.engineId,
            variant: pkg.variant,
            status: STATUS.INSTALLING,
            phase: 'start',
            percent: 0,
            downloadedBytes: 0,
            totalBytes: null,
            currentFile: null,
        });

        const totalKnown = pkg.files.reduce((s, f) => s + (f.size || 0), 0) || null;
        let downloadedBytes = 0;

        try {
            for (let i = 0; i < pkg.files.length; i++) {
                const f = pkg.files[i];
                const dest = path.join(root, f.relativePath);
                const partial = `${dest}.partial`;
                const expectedHost = assertAllowedUrl(f.url).hostname;

                if (fs.existsSync(partial)) {
                    try { fs.unlinkSync(partial); } catch (_) { /* ok */ }
                }

                let fileBase = downloadedBytes;
                await downloadToPartial(f.url, partial, {
                    signal: controller.signal,
                    expectedHost,
                    onBytes: (n, contentLen) => {
                        const fileTotal = f.size || contentLen;
                        const overall = fileBase + n;
                        const denom = totalKnown || (fileTotal != null
                            ? fileBase + fileTotal + estimateRemaining(pkg.files, i + 1)
                            : null);
                        emitProgress({
                            engineId: pkg.engineId,
                            variant: pkg.variant,
                            status: STATUS.INSTALLING,
                            phase: 'download',
                            percent: denom ? Math.min(99, Math.round((overall / denom) * 100)) : null,
                            downloadedBytes: overall,
                            totalBytes: denom,
                            currentFile: f.relativePath,
                            fileIndex: i,
                            fileCount: pkg.files.length,
                        });
                    },
                });

                const st = fs.statSync(partial);
                if (st.size === 0) {
                    throw new Error(`Downloaded empty file: ${f.relativePath}`);
                }
                if (f.size != null && st.size !== f.size) {
                    throw new Error(`Size mismatch for ${f.relativePath}: got ${st.size}, expected ${f.size}`);
                }
                if (f.sha256) {
                    const got = fileSha256(partial);
                    if (got !== f.sha256) {
                        throw new Error(`Checksum mismatch for ${f.relativePath}`);
                    }
                }

                atomicRename(partial, dest);
                downloadedBytes += st.size;
            }

            const check = verifyFiles(engineId, variant, pkg, null);
            if (!check.ok) {
                throw new Error(`Post-download verify failed: ${check.reason}`);
            }

            writeManifest(engineId, variant, {
                engineId: pkg.engineId,
                variant: pkg.variant,
                version: pkg.version,
                status: STATUS.INSTALLED,
                files: pkg.files,
                installedAt: new Date().toISOString(),
            });

            emitProgress({
                engineId: pkg.engineId,
                variant: pkg.variant,
                status: STATUS.INSTALLED,
                phase: 'done',
                percent: 100,
                downloadedBytes,
                totalBytes: downloadedBytes,
                currentFile: null,
            });

            return {
                ok: true,
                status: STATUS.INSTALLED,
                installRoot: root,
            };
        } catch (e) {
            // Leave .partial / incomplete tree; never claim INSTALLED
            try {
                writeManifest(engineId, variant, {
                    engineId: pkg.engineId,
                    variant: pkg.variant,
                    version: pkg.version,
                    status: STATUS.BROKEN,
                    files: pkg.files,
                    error: e.message,
                    failedAt: new Date().toISOString(),
                });
            } catch (_) { /* ignore */ }

            emitProgress({
                engineId: pkg.engineId,
                variant: pkg.variant,
                status: STATUS.BROKEN,
                phase: 'error',
                error: e.message,
                code: e.code || null,
            });
            throw e;
        } finally {
            active.delete(key);
        }
    })();

    active.set(key, { controller, promise: run });
    return run;
}

function estimateRemaining(files, fromIndex) {
    let n = 0;
    for (let i = fromIndex; i < files.length; i++) n += files[i].size || 0;
    return n;
}

function cancel(engineId, variant) {
    const key = pkgKey(engineId, variant);
    const job = active.get(key);
    if (!job) return { ok: true, cancelled: false };
    job.controller.abort();
    return { ok: true, cancelled: true };
}

function uninstall(engineId, variant) {
    const key = pkgKey(engineId, variant);
    if (active.has(key)) {
        cancel(engineId, variant);
    }
    const root = getInstallRoot(engineId, variant);
    if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    emitProgress({
        engineId: String(engineId),
        variant: sanitizeVariant(variant),
        status: STATUS.NOT_INSTALLED,
        phase: 'uninstalled',
    });
    return { ok: true, status: STATUS.NOT_INSTALLED };
}

/**
 * Network env for download helpers — never inherits packaged HF offline flags.
 * Inference must keep using paths.buildWorkerEnv().
 */
function getNetworkEnv(extra = {}) {
    return paths.buildNetworkEnv(extra);
}

module.exports = {
    STATUS,
    MANIFEST_NAME,
    registerPackage,
    getPackage,
    listPackages,
    clearPackages,
    setProgressSink,
    getInstallRoot,
    getStatus,
    install,
    cancel,
    verify,
    uninstall,
    getNetworkEnv,
};
