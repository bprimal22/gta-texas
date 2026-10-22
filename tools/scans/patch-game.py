# Apply the scan-landmark integration to a game.ts (lane copy for type-checking, or a copy of root's).
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b, count=1):
    global s
    if a not in s: raise SystemExit(f'anchor not found: {a[:70]!r}')
    s = s.replace(a, b, count)
rep("import { buildOfflineTowerBase } from './tower-offline-base';",
    "import { buildOfflineTowerBase } from './tower-offline-base';\nimport { loadScanTower, loadScanField, type ScanTower, type ScanField } from './scan-landmarks';")
rep("  private mainBuildingEnvelope?: ReturnType<typeof buildMainBuildingEnvelope>['stats'];",
    "  private mainBuildingEnvelope?: ReturnType<typeof buildMainBuildingEnvelope>['stats'];\n  private scanTower?: ScanTower;\n  private scanField?: ScanField;")
rep("""      markBoot('local-terrain');
      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);""",
"""      markBoot('local-terrain');
      // Aligned Tower photogrammetry loads alongside the terrain; any failure keeps the authored Tower.
      const scanTowerLoad = loadScanTower({ physics: this.physics }).catch(error => {
        console.warn('Tower scan unavailable; keeping the authored Tower.', error);
        return null;
      });
      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);""")
rep("""      // Restore the existing local upper Tower now that no scan supplies it.
      // This builder starts above the authored Main Building pedestrian facades.
      buildTower(this.world);
      buildOfflineTowerBase(this.world);""",
"""      // The aligned scan replaces the authored Tower (and its colliders) above the Main roof;
      // without it, restore the authored Tower. The offline core under the old spot stays.
      const scanTower = await scanTowerLoad;
      if (this.disposed) { scanTower?.dispose(); return; }
      if (scanTower) { this.scanTower = scanTower; this.world.group.add(scanTower.group); }
      else buildTower(this.world);
      buildOfflineTowerBase(this.world);""")
rep("""      this.localContextSolid = localContext.solid;""",
"""      this.localContextSolid = localContext.solid;
      // Visual-only scanned DKR turf on the generated field plane (its collider stays).
      loadScanField({ fieldY: localContext.stats.stadium.fieldY }).then(field => {
        if (this.disposed) { field.dispose(); return; }
        this.scanField = field;
        localContext.group.add(field.group);
      }).catch(error => console.warn('Field scan unavailable; keeping the generated turf.', error));""")
rep("""    this.disposed = true;
    if (this.world) this.world.disposed = true;""",
"""    this.disposed = true;
    if (this.world) this.world.disposed = true;
    // Before physics.free(): scan disposal removes its own colliders.
    this.scanField?.dispose();
    this.scanTower?.dispose();""")
open(p, 'w').write(s)
print('patched', p)
