import { loadScan, render } from './scanlib.mjs';
const scan = await loadScan(process.argv[2]); const R = 5, hw = 40, hl = 66;
await render(scan, scan.pos, 2 * hw * R, 2 * hl * R, (x, y, z) => [(x + hw) * R, (z + hl) * R, y], process.argv[3], { shade: false });
