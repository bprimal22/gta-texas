import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { runGdcCheck } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/gdc-check.mjs')).href);
const result = await runGdcCheck();
console.log(JSON.stringify(result, null, 1));
if (result.failures.length) { result.failures.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log('gdc check passed: finite GDC/NHB geometry, roof collider agreement, clear walkable ground, physical roofs and open east court.');
