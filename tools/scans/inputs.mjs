// Upstream scan inputs (seanhlewis/utimagery @13f08efe, MIT; URLs and sha256 in
// public/assets/scans/sources.json). Point UTIMAGERY_DIR at a folder holding
// tower.glb and stadium.glb; default is the unshipped scratch copy below.
import { resolve } from 'node:path';
export const SCAN_INPUT_DIR = process.env.UTIMAGERY_DIR ?? resolve(import.meta.dirname, '../../.work/scan-inputs');
export const scanInput = (name) => resolve(SCAN_INPUT_DIR, name);
