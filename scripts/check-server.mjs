// Starts the production server on an ephemeral port and checks every shipped
// file, the page routes and the refusal cases. Exits non-zero on failure.
import { request } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep, extname, resolve } from 'node:path';
import { createCampusServer } from './serve.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const server = createCampusServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const failures = [];
const get = (path, method = 'GET') => new Promise((resolveResponse, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
const expectType = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gz': 'application/octet-stream', '.wasm': 'application/wasm',
};
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
let files = 0, bytes = 0;
for (const file of await walk(dist)) {
  const path = '/' + relative(dist, file).split(sep).join('/');
  const res = await get(path);
  const size = (await stat(file)).size;
  files++; bytes += size;
  const type = expectType[extname(file)];
  if (res.status !== 200) failures.push(`${path}: status ${res.status}`);
  else {
    if (type && !String(res.headers['content-type']).startsWith(type)) failures.push(`${path}: content-type ${res.headers['content-type']}`);
    if (res.body.length !== size) failures.push(`${path}: length ${res.body.length} != ${size}`);
    if (res.headers['content-encoding']) failures.push(`${path}: unexpected content-encoding`);
    if (!String(res.headers['content-security-policy']).includes("default-src 'none'")) failures.push(`${path}: missing CSP`);
  }
}
// Page routes, including former online-mode parameters, all serve the offline app.
for (const path of ['/', '/?offline=0', '/?visual=procedural', '/?visual=local', '/?walkway=scan', '/character', '/character/']) {
  const res = await get(path);
  if (res.status !== 200 || !res.body.toString().includes('<div id="root">')) failures.push(`${path}: page not served (${res.status})`);
}
const head = await get('/', 'HEAD');
if (head.status !== 200 || head.body.length) failures.push('HEAD / failed');
// Refusals.
for (const [path, status] of [
  ['/api/tiles-config', 404], ['/api/guest-session', 404], ['/.env', 404], ['/.local/cesium/credentials.env', 404],
  ['/../package.json', 404], ['/%2e%2e/package.json', 404], ['/assets/%2e%2e/%2e%2e/package.json', 404],
  ['/sw.js', 404], ['/node_modules/three/package.json', 404], ['/assets/missing.jpg', 404], ['/draco/draco_decoder.wasm', 404],
]) {
  const res = await get(path);
  if (res.status !== status) failures.push(`${path}: expected ${status}, got ${res.status}`);
}
const post = await get('/', 'POST');
if (post.status !== 405) failures.push(`POST /: expected 405, got ${post.status}`);
const csp = String((await get('/')).headers['content-security-policy']);
for (const directive of ["connect-src 'self' blob:", "script-src 'self' 'wasm-unsafe-eval'", "default-src 'none'"])
  if (!csp.includes(directive)) failures.push(`CSP lacks ${directive}`);
server.close();
if (failures.length) { failures.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log(`server check passed: ${files} files (${(bytes / 1048576).toFixed(1)} MiB), page routes, refusals and CSP.`);
