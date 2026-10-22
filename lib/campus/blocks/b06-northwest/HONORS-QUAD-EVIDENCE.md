# D12 Honors Quad: evidence and residual estimates

This is block b06-northwest, column b. Geometry is in `honors-quad.ts` and its data in `honors-quad.json`. The data comes
from the lane-local `.work/claude-district40/derive.py`; its LiDAR grids are `grid-quad.txt`, `grid-ltd.txt`,
`grid-andeast.txt` and `steps.txt`. Heights are absolute campus Y (NAVD88 − 165). The frame is X east, Z **south**: the
quad lawn lies between CRD (west), BLD (east), LTD (north end) and AND (south end).

## Records

- **Rebuilt (install `replaced`, `context.json` `replaces`):**
  - `549050:385`: one City polygon covering Andrews (UT 398) and Blanton (UT 452). Blanton has no separate City record.
  - `551320:432`: Carothers (UT 629).
  - `654063:872`: Littlefield Residence Hall (UT 409).
  - Their existing `massing` entries stay as the generated fallback if install fails.
- **Unchanged:** Kinsolving `547842:357`. Its official footprint keeps both courtyard holes, and the existing KIN courtyard
  check still passes. The four approved orbit views show KIN only at the frame edges, so no KIN facade was reinterpreted.
  The 40.77 m LiDAR maximum (about 5 m above its tiers) is still unidentified and is not modelled.
- **Not touched:** GWB, GEA, G17, CSS, Littlefield Home, Communications/CMA/CMB/HSM/DMC, the church, bridges, roads,
  ground and scans. The round-2 meshes are byte-identical; the b06 check hashes them and compares against the
  pre-D12 baseline `aa346d0c`.

## Sources used

| Source | Basis | Used for |
|---|---|---|
| UT LIS Campus_Buildings FeatureServer/0 official polygons (via `district-agents-40/packets/D12.json`): AND 398, BLD 452, CRD 629, LTD 409 | official | Wall lines. AND/BLD rings simplified by 0.35 m to drop 0.3–0.6 m micro-jogs (City/UT scatter is 0.1–3.5 m). |
| USGS 3DEP TX_Central_B1_2017 0.5 m building and DTM rasters (`realism-lanes/lidar work/rasters.npz`) | measured | Wing cut lines (steps measured at 0.25 m), flat decks (P50), hip ridges (P98), eave/slope fit (P50), chimneys (local maxima). |
| Approved `district-orbits-30m` views `d12-orbit-southwest`, `-southeast`, `-northwest` and `-northeast-r2` (the original `-northeast` is rejected) | reference-interpreted | Tan brick, red clay tile, cream cornice under the eaves, BLD pale ground storey and pilaster bays, stone quad entry surrounds. |
| `full-map-30m/captures/priority-01.jpg`, `detail-ltd-northeast.jpg`, `detail-ltd-southwest.jpg` | reference-interpreted | LTD central arched quad loggia, hipped wing ends, chimney stacks. |
| `online-photos/ut-ltd-409-directory-photo.jpg` (facade direction unverified) | reference-interpreted | LTD broad dark bracketed eaves, rusticated stone base, paired narrow windows, arched entrance. |

The images are research references only. Nothing was traced, textured or measured from pixels.

## Wings (measured)

| Wing | Record | Roof | Area m² | LiDAR P50 / P98 / max | Model |
|---|---|---|---|---|---|
| AND-pavilion (west) | 549050:385 | hip | 148.5 | 33.55 / 34.82 / 35.32 | eave 32.54, slope 0.373, ridge 34.82 |
| AND-tail (street side) | 549050:385 | flat | 90.6 | 28.07 (P10–P90 28.04–28.19) | deck 28.07 |
| AND-range (E-W) | 549050:385 | hip | 476.7 | 30.13 / 31.58 / 32.04 | eave 28.35, slope 0.466, ridge 31.58; roof runs into the pavilion (party wall) |
| AND-east | 549050:385 | flat | 109.9 | 25.17 | deck 25.17 |
| AND-quadlow / AND-streetlow | 549050:385 | flat | 91.2 / 31.9 | 21.62 / 22.18 | decks 21.62 / 22.18 |
| lobby (AND/BLD) | 549050:385 | flat | 267.9 | 18.59 | deck 18.59 |
| BLD-link | 549050:385 | flat | 53.7 | 21.60 | deck 21.60 |
| BLD-bar (N-S) | 549050:385 | hip | 882.5 | 31.51 / 32.93 / 33.03 | eave 29.88, slope 0.435, ridge 32.93 |
| CRD-range (N-S) | 551320:432 | hip | 890.0 | 31.73 / 33.42 / 33.69 | eave 29.88, slope 0.476, ridge 33.42 |
| CRD-annex (quad side) | 551320:432 | flat | 146.7 | 20.03 | deck 20.03 |
| LTD (U plan) | 654063:872 | hip and valley | 1155.0 | 30.58 / 32.15 / 33.18 | eave 29.15, slope 0.334, ridge 32.15, 0.9 m eaves |
| Chimneys | LTD ×3, CRD ×1 | stacks | — | local maxima 32.34–33.67 | wall stacks 1.6 × 0.9 m from the ground; the interior one starts below the eave |

## Corrections against the base

- **AND/BLD:** the base had a 6.1 m flat base with two hipped bars and one 9.1 m flat "junction". It is now nine
  official-polygon wings at measured levels. The base junction held only the 21.62 median over a mixed area that the
  LiDAR shows as four levels: 18.6 / 21.6 / 25.2 / roof ends.
- **CRD:** the base used the City ring with one hip. It now uses the official outline with a hipped range, the low
  quad-side annex as its own flat wing, and a north-end stack. The 3 m south arm in the official polygon (toward AND,
  43 m²) has 11% building-class coverage in the raster, all of it eave spill. I did not build it. Check `armOpen`
  confirms no b06 geometry there beyond adjacent eaves.
- **LTD:** the base used the City ring with one generated hip, P50 +0.68 m high. It now uses the official U with a fitted
  hip-and-valley roof (P50 +0.09, P98 −0.31), broad eaves, three stacks and the arched quad loggia.
- **Facades** (all records), on the exterior walls only:
  - limestone base course (BLD: pale ground storey 3.6 m)
  - cream cornice band under the eaves (LTD: dark eave band and soffit)
  - flush batched windows: 3.0–3.4 m bays, paired on LTD
  - BLD pilaster strips every 4 bays
  - stone entry surrounds 0.7 m deep on the quad faces of BLD, AND and CRD
  - a 7.2 m brick arcade with three arched openings on the LTD quad face

## Roof geometry: exact planar facets (roof fixes 1 and 2, 2026-10-21)

The first staged build was rejected. Its hip roofs were a distance-to-edge height field sampled on a 0.9 m triangulation,
so triangles crossing ridge, hip, valley or cap lines were interpolated, and the AND and BLD ridges came out jagged. The
roofs are now built from exact planes (`honorsRoofs()` in `honors-quad.ts`):

- **Single-rectangle wings.** Each hipped wing gets a rectangle: AND-range uses the explicit `roofRect` (main-body
  official long sides); the others use the minimum rectangle of the official ring. Each non-party side carries an eave
  plane (eave line = side + overhang, rising at the fitted slope), plus a flat cap at the measured ridge. The roof is the
  lower envelope of these planes. Each plane's region is cut out exactly by convex clipping, then trimmed to the real
  eave outline.
- **LTD (concave U).** Three parts: two hipped wings and the central range. The central range ends exactly on each
  wing's ridgeline. Its cap is no higher than the wing ridges, and it includes the wings' hip-end planes, so it never
  rises above them. The parts are joined by their upper envelope, which forms the two valleys without steps or spikes.
- **Closure.** Soffits and party-wall tops follow the exact roof profile along each edge. Colliders are built from the
  same triangles.
- **AND-range.** The pavilion/range cut line nearly coincided with the official notch edge beside AND-tail. That left a
  spike up to 1.9 m wide at its base and 21 m long, plus a second small spike near x −241.5 (1.06 m² removed in total).
  The spike buried a wall against the tail parapet (a side-face failure) and stretched the fitted rectangle. The spikes
  were removed by a morphological opening, and the same 1,668 measured raster cells all lie inside the cleaned ring.
  The new eave/slope (`roofFit`: eave 28.271, slope 0.4761, ridge 31.58) gives a median of 30.13 on those cells,
  against the measured P50 of 30.13. The original `lidar` statistics and first-fit `eave`/`slope` are kept in the JSON.
- **Checks (b06 section 7b).** Every roof triangle, with no area skip, must have all 3 vertices within 1 mm of one
  declared plane, and its vertices and centroid within 1 mm of the evaluated upper roof surface. The physical roof on
  b06's colliders must equal the exact roof within 0.02 m on a 0.7 m grid in every hipped wing.
  Result: 316/316 facets pass, and the worst surface error is 0.000 m.

## Remaining estimates and conflicts (for Codex)

1. **LTD gable.** The directory photo shows a gabled end with broad eaves. The 2017 LiDAR shows every LTD wing end
   hipped: the cross-profiles at the end rows fall to eave height. The photographed gable is therefore not placed. It
   could be a small cross-gable or a later or older state; its direction is unverified. A ground photo with a known
   position would settle it.
2. **Facade rhythm.** Bay widths, storey heights, window sizes and pilaster spacing are estimates. They are consistent
   with the orbit views but not counted from calibrated photos. The arcade openings are flush dark panels, not recesses,
   which avoids unbacked colliders.
3. **Entrance positions** are interpreted along the face (BLD mid-quad face, AND quad face near x −258, CRD quad face
   near z −309, LTD central range). The street entrances on University Ave, Whitis and W 24th are not modelled.
4. **Wing cut lines** follow raster steps at 0.25 m. Interior walls between wings are not surveyed.
5. **KIN:** no new evidence. The 40.77 high element is unidentified and omitted.
6. **Courtyard grade and stoops** stay on the shared `ctx.groundHeight`. No ground request is made: rays reach the
   physical ground of the quad lawn at about the DTM, and no D12 path record is blocked.
