# Apply the scan-mode extension to a scripts/harness/context-check.ts (root copy -> patch for the integrator).
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b):
    global s
    if a not in s: raise SystemExit(f'anchor not found: {a[:70]!r}')
    s = s.replace(a, b, 1)
rep("import { BakedGround } from '../../lib/campus/baked-ground';",
    "import { BakedGround } from '../../lib/campus/baked-ground';\nimport { loadScanTower, loadScanField, type ScanTower, type ScanField } from '../../lib/campus/scan-landmarks';\nimport { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';")
rep("export async function run() {", """/** Headless GLB load for the scan assets (textures are decoded by the stubbed createImageBitmap). */
export const loadLocalGltf = (url: string) => {
  const b = readFileSync(resolve(root, 'public' + url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};

export async function run(options: { scan?: boolean } = {}) {""")
rep("  buildTower(world); buildOfflineTowerBase(world); world.flush();", """  // Scan mode mirrors the game integration: the aligned Tower scan replaces buildTower.
  let scanTower: ScanTower | null = null;
  if (options.scan) {
    scanTower = await loadScanTower({ physics, load: loadLocalGltf });
    world.group.add(scanTower.group);
  } else buildTower(world);
  buildOfflineTowerBase(world); world.flush();""")
rep("  // Every generated vertex must be finite and every mesh non-empty.", """  let scanField: ScanField | null = null;
  if (options.scan) {
    scanField = await loadScanField({ fieldY: context.stats.stadium.fieldY, load: loadLocalGltf });
    context.group.add(scanField.group);
  }
  // Every generated vertex must be finite and every mesh non-empty.""")
rep("    player, routeViolations, walkableSamples, travel,", "    player, routeViolations, walkableSamples, travel, scanTower, scanField, ground,")
open(p, 'w').write(s); print('patched', p)
