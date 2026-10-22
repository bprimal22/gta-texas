// Minimal same-origin static server for the offline campus build.
// Node built-ins only: no npm install, network access or credentials needed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../dist');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 5193);

export const CSP = [
  "default-src 'none'",
  // Rapier instantiates its physics engine from bundled WebAssembly bytes.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // GLTFLoader decodes embedded GLB textures through same-document blob: URLs.
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  // Baked terrain/surfaces are gzip files the game decompresses itself.
  // Never label them Content-Encoding: gzip.
  '.gz': 'application/octet-stream',
};

// Client-side pages served by index.html. Anything else must be a real file.
const pages = new Set(['/', '/index.html', '/character', '/character/']);

const baseHeaders = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

function send(res, status, body = '', extra = {}) {
  res.writeHead(status, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

export function createCampusServer() {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let path;
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname); }
    catch { return send(res, 400, 'Bad request'); }
    // No APIs, dotfiles, traversal or backslashes. This server only hands out dist/.
    if (path.startsWith('/api/') || path.includes('\0') || path.includes('\\') ||
      path.split('/').some(part => part === '..' || part.startsWith('.')))
      return send(res, 404, 'Not found');
    const file = pages.has(path) ? resolve(root, 'index.html') : resolve(root, '.' + path);
    if (file !== root && !file.startsWith(root + sep)) return send(res, 404, 'Not found');
    try {
      if (!(await stat(file)).isFile()) return send(res, 404, 'Not found');
      const data = await readFile(file);
      const ext = extname(file).toLowerCase();
      const hashed = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path);
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': types[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error && error.code === 'ENOENT') return send(res, 404, 'Not found');
      send(res, 500, 'Server error');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await stat(resolve(root, 'index.html')); }
  catch { console.error(`Missing ${root}/index.html. Run "npm run build" once with the bundled dependencies.`); process.exit(1); }
  const server = createCampusServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error); process.exit(1); });
  server.listen(port, host, () => console.log(`UT local campus: http://${host}:${port}/  (Ctrl+C to stop)`));
}
