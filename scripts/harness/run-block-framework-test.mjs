// Whole-campus block framework fixtures (needs the harness bundle).
import './stubs.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { runBlockFrameworkTest } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/block-framework-test.mjs')).href);
const { failures, report } = await runBlockFrameworkTest();
console.log('BLOCK-FRAMEWORK', JSON.stringify(report));
if (failures.length) { for (const f of failures) console.error('FAIL', f); process.exit(1); }
console.log('BLOCK-FRAMEWORK-TEST OK');
