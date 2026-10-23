# DKR stadium fidelity pass: references, method, limits, rebuild

Evidence ledger (URLs, authors, licences, dates, what each view supports): `tools/scans/stadium-references.json`.
Newly researched photographs are reference only; their pixels are not shipped. Existing MIT scan imagery is preserved. New textures are procedural painters
(`lib/campus/context-textures.ts`, `lib/campus/blocks/b09-stadium/board-face.ts`).

## What the capture covers (why most of the bowl stays generated)
The pinned MIT `stadium.glb` (sources.json) covers the west stand (shipped only for the `?stadiumscan=1` diagnostic since the 2026-10-23 correction), the SW corner up to
~45 m and the SEZ lower rows to ~16 m. East and north are captured only to ~6 m above the field. So the east, north,
corners and south end are generated geometry, each side from its own evidence; nothing is mirrored from the west.

## Measured inputs
* Front-row rakes (raw capture, `node tools/scans/stadium-rakes.mjs`): east 0.23-0.30 m/m (t 2-11 m), north 0.27-0.32
  (t 2-8.5 m), west 0.30 steepening to 0.45 (to t 40 m, then the upper-deck front at 28 m), SEZ 0.51 (t 2-16 m).
  Generated tiers keep those slopes over their full depth (extrapolation).
* West gantry / press-box top: 67.5-68.0 m above the field, t 74-81 m, v -51..-7 m (north half only in the capture).
* 2017 USGS LiDAR (repository numbers, b09 lidar-reference.json): rims east 43.0 / north 40.5 m above the field;
  NEZ / STD ring median roofs Y 30.79 / 31.28 (concourse roof behind the rim); north round towers.
* City 2023 SEZ top Y 35.0 (flank-tower tops; the b09 check keeps the bowl under 36.0 in the SEZ ring).
* Official board size 160 x 44 ft (48.77 x 13.41 m).

## Reference-interpreted / estimated
* Tier layout per side from the 2025 seating map and the 2022 aerials; row counts, fascia/suite heights, overhangs.
* SEZ: longhorn club-row outline (`sezClub`), three loge rows, one club level under the board, the low block roof,
  flank-tower spans/depths, the SW brick stair tower position and drum heights, the board header height (2.0 m).
* Gantry column pitch/size and its continuation over the south half; east flagpole/light-standard counts and heights;
  pier pitch (east 16 m, north 12 m); round-tower lantern band height (7.2 m).
* Exterior texture proportions (brick pier / band / bay sizes).

## Limitations
* Sections are 1-D profiles lofted around the perimeter: real bays, vomitories, stairs and suite interiors are not
  modelled; corner transitions are interpolated (north corners) or abrupt (east/west upper decks ending at the SEZ,
  hidden by the flank towers).
* The SEZ flank-tower and corner-stand geometry is approximate in plan; the longhorn outline is fitted by eye.
* A full LiDAR section profile could not be re-derived in this pass (USGS tile server returned HTTP 429).
* The far LOD of the scanned stand keeps its 255k triangles (chart seams limit further UV-safe simplification); its
  atlas is now shared with the near LOD.

## Rebuild (authoring only, not game dependencies)
1. Authoring deps: `tools/scans/tower-tools.package.json` (@gltf-transform 4.5.1, sharp 0.34.4, meshoptimizer 1.1.1)
   installed into a scratch folder, `tools/node_modules` symlinked to it (remove afterwards).
2. Raw input: download the pinned `stadium.glb` into `.work/scan-inputs/` and verify the sha256 in sources.json.
3. `node tools/scans/stadium-rakes.mjs` (measurements above).
4. After any `build-stand.mjs` rebuild: `node tools/scans/stand-share-atlas.mjs` (tags the near atlas, swaps the far
   GLB's atlas copy for a 512x256 placeholder, updates dkr-west-stand.json), then update sources.json hashes.
5. Generated geometry is built at load time from `lib/campus/stadium-bowl.ts`; after changing it, re-measure
   `exterior-plan.json` `bowlBaseline` / `southWall` (`node tools/scans/stadium-southwall.mjs`) / `board.centre` (the
   b09 check asserts them) and rerun
   `node scripts/harness/run-block-checks.mjs b09-stadium`, the stand runtime check and the shot clearance.


## In-game review and measured rendering cost

Codex reviewed all eight exterior compass/corner views, the north aerial, field-level south view and the Longhorn
terraces in the real WebGL game after two visual correction rounds. Default power saver remained on at 30 FPS.
The comparisons below deliberately used `?fps=60`, a fixed 1280 x 720 viewport at DPR 1, the same released lighting,
and the same original camera poses. Each timing window starts after a 12-second warm-up and contains at least
192 asynchronous GPU samples, with no disjoint timer events. Sequential timings vary with the machine workload;
these are rendering measurements, not measurements of energy use or temperature.

| Original fixed camera | Metric | Before | After |
|---|---|---:|---:|
| `b09-aerial-stadium` | GPU median / p95 (ms) | 6.51 / 10.76 | 6.81 / 10.58 |
| | CPU median (ms) | 1.80 | 1.70 |
| | Draw calls, all passes | 223 | 229 |
| | Triangles, all passes | 1,549,148 | 1,547,877 |
| `b04-tower-crown-northwest` (distant stadium) | GPU median / p95 (ms) | 9.00 / 11.11 | 9.89 / 11.57 |
| | CPU median (ms) | 2.50 | 2.60 |
| | Draw calls, all passes | 596 | 602 |
| | Triangles, all passes | 4,031,825 | 4,030,554 |

The added architecture has a small draw-call cost; this pass does not claim a frame-time improvement. The stand
saves 2,422,040 download bytes and one full 4096 x 2048 GPU atlas, while the additional procedural textures are
small. Both stand LODs retain byte-identical geometry/UV accessor buffers; the near photograph bytes are also
unchanged. Global graphics quality, AO, frame pacing, controls and Tower geometry are unchanged by this pass.

## Targeted correction (2026-10-23): default west stand and turf

Scope: only the dark/grey partial west-stand capture and the muddy partial field capture, which clashed with the
authored bowl. Everything else in the stadium is unchanged: outside the west zone (field-frame u < -30 m) every bowl
and b09 exterior triangle is identical to commit 253a2aa (headless comparison, 0 differences per mesh).

* **Default mode:** the stadium is fully authored. `lib/campus/game.ts` requests `dkr-west-stand-*.glb` and
  `dkr-field.glb` only when `stadiumScanRequested(location.search)` is true (`?stadiumscan=1`, or the legacy
  `?stand=scan`); otherwise neither file is fetched, so no scan collider or ground root exists. The Tower scan is unchanged.
* **West stand (default):** the existing generated west profile, built from the capture's measured section (STAND_PROFILES.west),
  using the same seat/concrete/suite materials as the other stands. Bounded closure, west only:
  * the Bellmont roof (b09 datum Y 32.2 = 35.1 m above the field) runs from the upper-deck rear to the measured west wall;
  * the gantry sits on the upper-deck rim;
  * a press box (v -49..-10.5 m, 7 m deep, top 66.0 m) is built in default mode too. Its along-field extent and depth preserve the previous authored box from scan metadata; its front meets the generated rim.
* **Turf:** `fieldCanvas` (context-textures.ts) is the only painter changed: a 1024 x 2048 texture over the 71 x 126 m
  plate (14.4 / 16.3 px/m).
  * Exact NCAA dimensions: 53 1/3 x 120 yd, hashes 60 ft from the sidelines, 6 ft numbers with tops 9 yd from the
    sidelines.
  * Following the official 2022 aerials: TEXAS in the north end zone and LONGHORNS in the south, both reading from the
    field; number tops toward the nearer sideline; white team-area bands.
  * The midfield steer-head is a simplified authored silhouette, not the official artwork.
  * Colours, lettering and band extents are estimates. No photo pixels.
* **Diagnostic mode (`?stadiumscan=1`):** the previous scan sector, field decal and lifecycle are unchanged. They are
  covered by `scripts/harness/run-stand-runtime-check.mjs` and `run-scan-lifecycle.mjs`.
* **Checks:** `scripts/harness/run-stadium-default-check.mjs` covers:
  * the gate;
  * no dkr-* requests in default mode;
  * visible = physical on the west stand, field and press box (0.05 m);
  * STD travel and flight landing;
  * turf text orientation and mirroring.
* **Default runtime cost.** Before = the deployed default (with captures); after = the authored west and turf.

| | Before | After |
|---|---|---|
| Bowl visual triangles | 34,103 | 45,301 (+11,198 generated west) |
| Bowl collider triangles | 33,053 | 44,783 (the 15,410-triangle stand trimesh is removed) |
| Stand capture | ~341k (near) / 255k (far) triangles, one 4096 x 2048 atlas (~45 MB GPU with mips), 25.7 MB download | not loaded |
| Field decal | 43,119 triangles, 4096 x 1024 atlas (~22 MB GPU), 1.9 MB download | not loaded |
| Turf canvas | 512 x 1024 (~2.8 MB GPU) | 1024 x 2048 (~11 MB GPU) |
| Bowl draw calls | 13 | 13 (the stand and decal meshes are gone) |
