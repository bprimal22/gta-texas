// Offline audit for the standalone campus build. Exits non-zero on any failure.
// Checks: runtime URL strings, forbidden provider/secret strings, same-origin
// asset closure, GLB external resources/extensions, symlinks and independence.
import { readFile, readdir, lstat, readlink, stat } from 'node:fs/promises';
import { resolve, relative, join, dirname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const failures = [], notes = [];
const fail = (m) => failures.push(m), note = (m) => notes.push(m);

async function walk(dir, { skip = [] } = {}) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip.some(s => path === join(root, s))) continue;
    if (entry.isDirectory()) out.push(...await walk(path, { skip }));
    else out.push(path);
  }
  return out;
}
const rel = (p) => relative(root, p);

// 1. URL strings in the shipped code. These hosts appear only as XML
// namespaces, attribution/source metadata or library error-message links;
// none is fetched. Any new host fails the audit until it is reviewed.
const allowedHosts = {
  'www.w3.org': 'SVG/XHTML/MathML namespace URIs',
  'raw.githubusercontent.com': 'Rocketbox source manifest metadata (character sources.json)',
  'react.dev': 'React production error-message link text',
  'base-ui.com': 'Base UI production error-message link text',
  'tailwindcss.com': 'license banner comment in CSS',
  'landmarks.utexas.edu': 'artwork source metadata',
  'www.payette.com': 'Welch roof plan source metadata',
  'utaustin.treekeepersoftware.com': 'tree inventory source metadata',
  'maps.austintexas.gov': 'DKR surfaces source metadata',
  'jcgt.org': 'three.js shader reference comment',
  'github.com': 'scan provenance metadata (seanhlewis/utimagery repository URL in ut-tower.json/dkr-field.json)',
  'americanarchive.org': 'MLK memorial source metadata',
};
// JSON under dist/data and dist/assets is campus data or license/source metadata,
// never interpreted as code. Their URL strings are reviewed via the credits file.
const code = (await walk(dist)).filter(f => /\.(?:js|css|html|webmanifest)$/.test(f));
const hosts = new Map();
for (const file of code) {
  const text = await readFile(file, 'utf8');
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)) {
    const list = hosts.get(m[1]) ?? []; list.push(rel(file)); hosts.set(m[1], list);
  }
  // Protocol-relative script/style/fetch targets.
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']\/\/[^"']+/g)) fail(`protocol-relative reference in ${rel(file)}: ${m[0]}`);
  for (const m of text.matchAll(/fetch\(\s*([`'"])((?:https?:)?\/\/[^`'"]+)/g)) fail(`absolute fetch in ${rel(file)}: ${m[2]}`);
  for (const m of text.matchAll(/import\(\s*([`'"])(https?:[^`'"]+)/g)) fail(`remote dynamic import in ${rel(file)}: ${m[2]}`);
}
for (const [host, files] of hosts) {
  if (allowedHosts[host]) note(`URL string host ${host} ×${files.length} — ${allowedHosts[host]}`);
  else fail(`unreviewed URL host ${host} in ${[...new Set(files)].join(', ')}`);
}
const html = await readFile(join(dist, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g))
  if (!m[1].startsWith('/') || m[1].startsWith('//')) fail(`index.html non-local reference ${m[1]}`);

// 2. Provider, service-worker, secret and old-tree strings in dist and app source.
const forbidden = [
  // Cesium as a dependency or request target (hosts, imports, API, tokens). Plain
  // provenance prose such as "author Cesium placement NOT used" is not a dependency.
  /cesium\.com|ion\.cesium|from ['"`]cesium|import\(['"`]cesium|require\(['"`]cesium|\bCesium\.[A-Z]|CESIUM_|cesium-?ion|cesium\.js/i,
  /googleapis/i, /gstatic/i, /3d-tiles/i, /tiles-config/i, /guest-session/i,
  /serviceWorker\s*\.\s*register/, /\bsw\.js\b/, /CESIUM_ION_TOKEN/, /credentials\.env/,
  /\/Users\/bprimal\/e\/ut\b/, /ut-release-83/, /\.local\/cesium/,
  /AIza[0-9A-Za-z_-]{30,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{20,}/,
];
const sourceFiles = (await walk(root, { skip: ['node_modules', '.work'] }))
  .filter(f => /\.(?:ts|tsx|mjs|js|css|html|json|webmanifest|txt|md|command)$/.test(f) &&
    // These two files name the forbidden strings/paths on purpose (patterns and refusal tests).
    !f.endsWith(`${sep}audit-offline.mjs`) && !f.endsWith(`${sep}check-server.mjs`) && !f.endsWith(`${sep}README.md`) &&
    // Verification log written by the independent reviewer; documentation, never shipped.
    !f.endsWith(`${sep}VERIFICATION.md`));
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) fail(`forbidden ${pattern} in ${rel(file)}`);
}
// `.work/` is unshipped development scratch (isolated lane copies, Python venvs).
for (const file of await walk(root, { skip: ['node_modules', '.work'] })) {
  const name = file.split(sep).pop();
  if (name.startsWith('.env') || name.endsWith('.pem')) fail(`secret-like file ${rel(file)}`);
}

// 3. Same-origin asset closure. Literal paths come from the built code; the
// template-built texture/model names come from their call sites in source.
const referenced = new Set();
for (const file of code) {
  const text = await readFile(file, 'utf8');
  for (const m of text.matchAll(/[`'"](\/(?:assets|data)\/[^`'"?$\s]+\.[a-z0-9.]+)/g)) referenced.add(m[1]);
}
const lib = join(root, 'lib', 'campus');
for (const file of ['walkway.ts', 'materials.ts']) {
  const text = await readFile(join(lib, file), 'utf8');
  for (const m of text.matchAll(/\btex(?:ture)?\(\s*'([a-z0-9-]+)'/g)) referenced.add(`/assets/${m[1]}.jpg`);
}
// Legacy template-built tree LOD paths, only if a module still builds them.
const trees = await readFile(join(lib, 'foreground-trees.ts'), 'utf8');
if (trees.includes('foreground-tree/${level}.glb')) {
  const levels = trees.match(/\[(\s*'(?:near|mid|far)'\s*,?)+\]/)?.[0].match(/near|mid|far/g) ?? ['near', 'mid', 'far'];
  for (const level of levels) referenced.add(`/assets/foreground-tree/${level}.glb`);
}
referenced.add('/favicon.svg'); referenced.add('/manifest.webmanifest'); referenced.add('/credits.txt');
for (const path of [...referenced].sort((a, b) => a.localeCompare(b))) {
  try { if (!(await stat(join(dist, path))).isFile()) fail(`referenced asset is not a file: ${path}`); }
  catch { fail(`referenced asset missing from dist: ${path}`); }
}
note(`asset closure: ${referenced.size} referenced same-origin files present`);

// 4. GLB resources: no external URIs and no extensions needing absent decoders.
const supported = new Set(['KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_materials_specular',
  'KHR_materials_ior', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_mesh_quantization',
  'KHR_materials_unlit', 'KHR_materials_volume', 'KHR_materials_sheen']);
for (const path of [...referenced].filter(p => p.endsWith('.glb'))) {
  const buffer = await readFile(join(dist, path));
  if (buffer.readUInt32LE(0) !== 0x46546c67) { fail(`${path} is not a GLB`); continue; }
  const length = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
  for (const kind of ['images', 'buffers']) for (const item of json[kind] ?? []) {
    if (item.uri === undefined) continue;
    if (item.uri.startsWith('data:')) { note(`${path} ${kind} uses an embedded data: URI`); continue; }
    if (/^[a-z]+:|^\/\//i.test(item.uri)) { fail(`${path} ${kind} external URI ${item.uri}`); continue; }
    try { await stat(join(dist, dirname(path), item.uri)); } catch { fail(`${path} ${kind} missing relative URI ${item.uri}`); }
  }
  for (const ext of json.extensionsRequired ?? json.extensionsUsed ?? [])
    if (!supported.has(ext)) fail(`${path} requires unsupported extension ${ext}`);
  note(`${path}: ${json.images?.length ?? 0} images, ${json.meshes?.length ?? 0} meshes, extensions ${(json.extensionsUsed ?? []).join(',') || 'none'}`);
}

// 5. Symlinks must stay inside this directory (relative node_modules/.bin links are fine).
for (const file of await walk(root, { skip: ['.work'] })) {
  if (!(await lstat(file)).isSymbolicLink()) continue;
  const target = resolve(dirname(file), await readlink(file));
  if (!target.startsWith(root + sep)) fail(`symlink leaves project: ${rel(file)} -> ${target}`);
}

// 6. Informational: shipped files that nothing references.
const shipped = (await walk(dist)).map(f => '/' + relative(dist, f).split(sep).join('/'));
const unused = shipped.filter(p => !p.startsWith('/assets/') || p.split('/').length > 2)
  .filter(p => /\.(?:jpg|png|glb|gz|bin)$/.test(p) && !referenced.has(p));
if (unused.length) note(`unreferenced shipped media (license/source copies or unused): ${unused.join(', ')}`);

for (const line of notes) console.log('note:', line);
if (failures.length) { for (const line of failures) console.error('FAIL:', line); process.exit(1); }
console.log(`audit passed: ${code.length} code files, ${hosts.size} reviewed URL-string hosts, ${referenced.size} assets.`);
