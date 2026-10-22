import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { runTravelFixture } = await import(pathToFileURL(resolve(import.meta.dirname, '../../.work/harness-dist/travel-fixture.mjs')).href);
const { results, fail } = await runTravelFixture();
console.log(JSON.stringify(results));
if (fail.length) { fail.forEach(f => console.error('FAIL:', f)); process.exit(1); }
console.log('travel fixture passed: roofed floor and no-ground refused, open path fallback chosen, branch allowed, flight roof landing intact, indoor-only nearest paths resolved by broader search within bounds.');
