const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.wav': 'audio/wav',
};

function createStaticServer({ rootDir, publicDir, port = 0 }) {
    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            const pathname = decodeURIComponent(url.pathname);

            let filePath = path.join(rootDir, pathname === '/' ? 'batch.html' : pathname.replace(/^\//, ''));
            if (pathname.startsWith('/favicon')) {
                filePath = path.join(publicDir, 'khepree-logo.png');
            }

            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const data = fs.readFileSync(filePath);
            res.writeHead(200, {
                'Content-Type': MIME[ext] || 'application/octet-stream',
                'Content-Length': data.length,
            });
            res.end(data);
        } catch (err) {
            res.writeHead(500);
            res.end(String(err.message || err));
        }
    });

    return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                port: address.port,
                url: `http://127.0.0.1:${address.port}/batch.html`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
        server.on('error', reject);
    });
}

module.exports = { createStaticServer };
