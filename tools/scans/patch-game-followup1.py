# Follow-up 1: scan lifecycle in game.ts (decode without physics, game-owned prepared scan,
# colliders only after the game is confirmed alive, abort on dispose).
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b):
    global s
    if a not in s: raise SystemExit(f'anchor not found: {a[:80]!r}')
    s = s.replace(a, b, 1)
rep("import { loadScanTower, loadScanField, type ScanTower, type ScanField } from './scan-landmarks';",
    "import { prepareScanTower, loadScanField, type PreparedScanTower, type ScanTower, type ScanField } from './scan-landmarks';")
rep("  private scanTower?: ScanTower;\n",
    "  private scanTower?: ScanTower;\n  /** Decoded Tower scan awaiting commit; owned (and disposed) by the game until committed. */\n  private scanTowerPrepared?: PreparedScanTower;\n")
rep("""      // Aligned Tower photogrammetry loads alongside the terrain; any failure keeps the authored Tower.
      const scanTowerLoad = loadScanTower({ physics: this.physics }).catch(error => {
        console.warn('Tower scan unavailable; keeping the authored Tower.', error);
        return null;
      });""",
"""      // Aligned Tower photogrammetry decodes alongside the terrain without touching physics.
      // Once decoded it belongs to the game (dispose() frees it on every early-return/throw
      // path); aborting the game signal disposes anything still pending or arriving late.
      const scanTowerLoad = prepareScanTower({ signal: this.signal.signal }).then(prepared => {
        if (this.disposed) { prepared.dispose(); return null; }
        this.scanTowerPrepared = prepared;
        return prepared;
      }, error => {
        if (!this.disposed) console.warn('Tower scan unavailable; keeping the authored Tower.', error);
        return null;
      });""")
rep("""      const scanTower = await scanTowerLoad;
      if (this.disposed) { scanTower?.dispose(); return; }
      if (scanTower) { this.scanTower = scanTower; this.world.group.add(scanTower.group); }
      else buildTower(this.world);""",
"""      const prepared = await scanTowerLoad;
      if (this.disposed) return; // dispose() already released this.scanTowerPrepared
      let scanTower: ScanTower | null = null;
      if (prepared) {
        // Colliders are created only now, on a live physics world.
        try { scanTower = prepared.commit(this.physics); } catch (error) {
          console.warn('Tower scan colliders failed; keeping the authored Tower.', error);
          prepared.dispose();
        }
        this.scanTowerPrepared = undefined;
      }
      if (scanTower) { this.scanTower = scanTower; this.world.group.add(scanTower.group); }
      else buildTower(this.world);""")
rep("""      loadScanField({ fieldY: localContext.stats.stadium.fieldY }).then(field => {
        if (this.disposed) { field.dispose(); return; }
        this.scanField = field;
        localContext.group.add(field.group);
      }).catch(error => console.warn('Field scan unavailable; keeping the generated turf.', error));""",
"""      loadScanField({ fieldY: localContext.stats.stadium.fieldY, signal: this.signal.signal }).then(field => {
        if (this.disposed) { field.dispose(); return; }
        this.scanField = field;
        localContext.group.add(field.group);
      }, error => { if (!this.disposed) console.warn('Field scan unavailable; keeping the generated turf.', error); });""")
rep("""    this.scanField?.dispose();
    this.scanTower?.dispose();""",
"""    this.scanField?.dispose();
    this.scanTower?.dispose();
    this.scanTowerPrepared?.dispose();
    this.scanTowerPrepared = undefined;
    // Cancels pending scan loads now (they dispose late arrivals themselves); the generic
    // this.signal.abort() below is then a no-op for them.
    this.signal.abort();""")
open(p, 'w').write(s); print('patched', p)
