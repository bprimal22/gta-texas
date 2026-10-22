# Follow-up 2: scanned DKR west stand in game.ts (same ownership pattern as the Tower).
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b):
    global s
    if a not in s: raise SystemExit(f'anchor not found: {a[:80]!r}')
    s = s.replace(a, b, 1)
rep("import { prepareScanTower, loadScanField, type PreparedScanTower, type ScanTower, type ScanField } from './scan-landmarks';",
    "import { prepareScanTower, prepareScanStand, loadScanField, SCAN_STAND_SECTOR, type PreparedScanTower, type PreparedScanStand, type ScanTower, type ScanStand, type ScanField } from './scan-landmarks';")
rep("  private scanTowerPrepared?: PreparedScanTower;\n",
    "  private scanTowerPrepared?: PreparedScanTower;\n  private scanStand?: ScanStand;\n  /** Decoded DKR west-stand scan awaiting commit; game-owned until committed. */\n  private scanStandPrepared?: PreparedScanStand;\n")
rep("""      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);""",
"""      // Aligned DKR west-stand photogrammetry, same lifecycle: decode now, commit after the bowl.
      const scanStandLoad = prepareScanStand({ signal: this.signal.signal }).then(prepared => {
        if (this.disposed) { prepared.dispose(); return null; }
        this.scanStandPrepared = prepared;
        return prepared;
      }, error => {
        if (!this.disposed) console.warn('Stand scan unavailable; keeping the generated west stand.', error);
        return null;
      });
      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);""")
rep("""      const localContext = buildLocalContext({""",
"""      // The bowl omits its west-straight rows only when the scanned stand is ready to replace them.
      const standPrepared = await scanStandLoad;
      if (this.disposed) return; // dispose() already released this.scanStandPrepared
      const localContext = buildLocalContext({""")
rep("""        roofs: roofsLidar,
      });""","""        roofs: roofsLidar,
        stadium: { scanSector: standPrepared ? SCAN_STAND_SECTOR : null },
      });""")
rep("""      this.localContextSolid = localContext.solid;""","""      this.localContextSolid = localContext.solid;
      if (standPrepared) {
        // Colliders only now, on a live world and on the generated field plane.
        try {
          this.scanStand = standPrepared.commit(this.physics, localContext.stats.stadium.fieldY);
          localContext.group.add(this.scanStand.group);
        } catch (error) {
          console.error('Stand scan colliders failed; the west sector keeps only its seam/outer walls.', error);
          standPrepared.dispose();
        }
        this.scanStandPrepared = undefined;
      }""")
rep("""    this.scanTowerPrepared?.dispose();
    this.scanTowerPrepared = undefined;""","""    this.scanTowerPrepared?.dispose();
    this.scanTowerPrepared = undefined;
    this.scanStand?.dispose();
    this.scanStandPrepared?.dispose();
    this.scanStandPrepared = undefined;""")
open(p, 'w').write(s); print('patched', p)
