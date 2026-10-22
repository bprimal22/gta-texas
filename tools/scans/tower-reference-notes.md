# UT Tower reconstruction and references

Implemented by Claude Opus 5.5 with Codex visual and integration review. The classic unscaffolded Tower is the target. This is a measured, photo-guided reconstruction, with the approximation limits below.

## What changed and why

1. **Relight, done once, as a per-vertex multiplier (both LODs).**
   - The drone capture was lit from the SSW (fitted wall sun az 217°, rms 9.4 sRGB over 24 azimuth bins of the shaft walls). The game sun is the calibrated preset (az 121.2°, el 41.9°).
   - So the east face was dark (luma ~86) and the west face bright (~170), the reverse of the game lighting and of the Tower's own cast shadow.
   - A COLOR_0 multiplier (normalised uint16 ÷ `vertexColorScale` 8) replaces the photographed wall-sun term with the game's. Upward-facing surfaces keep the photographed light.
   - A luminance-only clamp (0.6–1.15× of the modelled wall colour) prevents blow-outs at corners and in cast shadows. It never shifts hue.
   - **The atlas texels are not edited.**
   - Resulting face levels before gain: E 209, SE ~225, S 161, N/W 87.
   - In Codex's baseline/after screenshots, shaded authored walls render at ~90 luma, which matches the relit shade level. This is calibrated, not "brighten every face".

2. **Shaft window strips (near LOD).**
   - All 12 strips are registered to the scan by measurement:
     - centres per face
     - width 1.2 m
     - floor pitch 2.5875 m, fitted from the gilded spandrel (R−B) periodicity, score 0.51
     - extent Y 41.57–82.97, 16 spandrels
   - The scan surface is clipped exactly out of each footprint (601.7 m² removed vs 596.2 m² expected). An authored recessed channel replaces it:
     - recess 0.18 m (estimated)
     - stone reveals, sill and head
     - one panel per floor using a drawn tile: two-light window with bronze mullion over a gilded spandrel with two stepped panels, proportions from the CC0 close-up
   - Brightness is luminance-calibrated to the relit captured strip, so the near and far LODs match at distance.

3. **Crown (both LODs).**
   - Above the clock-block roof (Y > 94.9, within 5.35 m of the measured crown centre (−0.07, −0.03)), the melted scanned belfry is replaced by a fitted, four-fold symmetric belfry. Four-fold symmetry was verified on photographs of four faces from three directions. It has:
     - plinth, podium and podium cap
     - ledge at 97.0–97.55 (the scan's widest band)
     - 16 square pedestals with caps
     - 16 columns (r 0.37 m, at ±0.73/±2.19 m on a 3.93 m line) with base, necking and capital
     - 4 corner piers (2.95–4.30 m)
     - a dark bell chamber
     - architrave, frieze and bed-moulding
     - a two-step cornice (max half-width 4.95 m, matching the scan profile's 4.96)
     - attic, coping and a flat roof at **108.85 m**
   - Heights and half-widths come from the scan half-extent profile and are cross-checked against photo proportions.
   - The attic/roof follows the photographs: a low attic with the guard rail on top. The scan's open rim at 110.02 matches the rail top (109.92), so the scan "lid" was the melted rail and antennas rather than the roof.
   - **Stone finish.** The crown is textured from a 512×512 authored atlas. Its lower half holds **captured limestone**: orthographic 24 px/m resamples of the scanned plain shaft wall between strips on the north and east faces. Those faces were photographed in shade, so the texels carry stone tone variation rather than sun or shadows.
     - Each band is divided by its mean. The vertex colour carries the measured tone (sunlit-equivalent sRGB 228/221/208, de-lit from the shaft stone beside the strips) times the game light per face orientation.
     - Course joints (0.5 m, estimated from the CC0 close-up at ~138 px/m) and staggered head joints (1.2 m) are drawn at world heights, so the coursing lines up across faces. Columns use a joint-free band.
     - Faces wider than a band are split and mirrored, so there are no texture seams.
   - **Clocks.** All four dials are measured from 40 px/m orthographic scan crops (`renders/clock-orthos.png`): centred on each face, centre Y 91.15, outer radius 2.05 m, plane at the median scan depth around the ring.
     - The scan inside r 1.98 is clipped out. An authored disc sits 0.06 m proud with a gilded bezel band back into the wall.
     - The dial is drawn from the photographs: gold bezel, pale blue-green field, dark red radial Roman numerals, minute track.
     - Hands are set to 10:45, the fixed game-sun time.
     - The aedicules, scrolls and corner ornaments of the clock stage remain scanned.
   - **Roof rail and mast (near LOD, untextured metal):**
     - a guard rail round the roof, 1.07 m, posts ≤1.6 m apart, two rails
     - a three-leg lattice mast (top roof +4.6 m) with two whip antennas
     - The mast position, ~2.5 m E and 1.9 m N of the crown centre (±0.7 m), is **triangulated from two GPS-tagged Commons photos**: 54984938073 from bearing 321° and 54984752616 from bearing 124°, by projecting the mast's screen offset relative to the belfry corners in each. Heights are photo estimates.
     - Neither has a collider.

4. **Collision safety.**
   - The shaft cuboid is unchanged.
   - The 73×73 heightfield is re-sampled with the same rule from the visible tops: the scan with cuts plus the authored crown stone. The rail and mast are excluded and are not landable.
   - Max height is now 108.85 (roof), previously 110.20 (scan lid).
   - Registration and transform are untouched; `ut-tower.json` anchor, axes, transform, proxies and tiers are identical to the baseline.

5. **Efficiency and runtime.**
   - Far-LOD textures are the near ones downsampled with the same UVs. The loader (`shareNearTextures`, keyed by glTF `extras.textureKey`/`textureOfNear`) points the far materials at the near textures and disposes the far copies before upload. Each atlas reaches the GPU once.
   - The loader applies `extras.vertexColorScale`.
   - GLBs are written with separate (non-interleaved) attributes, so `assertFinite` still reads plain position arrays.
   - The lid material now carries `authoredInfill`. Previously the flat lid was mislabelled as captured colour; the lid is now gone and every authored material is flagged.
   - Frame pacing, Power saver (30 FPS default), AO, lifecycle and disposal code are unchanged.

## Budgets (before → after)

| | before | after |
|---|---|---|
| near LOD triangles | 56,827 (56,789 scan + 38 lid) | 51,275 (48,011 scan + 3,264 authored: crown 1,896, clocks 480, strip panels 408, reveals 96, rail/mast 384) |
| far LOD triangles | 14,038 | 15,512 (13,136 scan + 2,376 authored crown + clocks) |
| draw calls near / far | 2 / 2 | 3 / 2 (scan, authored textured, authored metal/reveals) |
| download | 2,896,676 B (near 2,294,484 + far 602,192) | 3,578,772 B (near 2,718,892 + far 859,880) |
| GPU textures (RGBA8 + mips) | ~47.5 MB (4096×2048 scan atlas 44.7 + 1024×512 far atlas 2.8) | ~46.1 MB (scan atlas 44.7 once + 512×512 authored atlas 1.4 once) |
| LOD switch | 380 m | 380 m (unchanged) |

- The download rises by ~0.68 MB. Most of that is COLOR_0 (6 B/vertex), the 512² authored PNG (85 KB near, 128² fallback in far), and the far LOD's relight colours.
- GPU texture memory falls by ~1.4 MB.

## Reference evidence

Reference photos guided independently authored geometry and drawings only. None are shipped or sampled as textures; the only captured texels are the MIT drone scan.

| Source | Author / licence | Used for |
|---|---|---|
| https://commons.wikimedia.org/wiki/File:Main_Building_(University_of_Texas_at_Austin)_-_DSC08585.jpg | Daderot, CC0 (2015) | Crown composition: corner piers, 4 columns per face on pedestals, entablature/cornice/attic, dial colours (gold bezel, blue-green field, red numerals), rail on roof |
| https://commons.wikimedia.org/wiki/File:The_Tower_-_UT_Austin_(54984938073).jpg | CC BY 4.0 (2025-12-10), GPS 30.287066,−97.740267 | NW corner view of the belfry; attic height; lattice mast (triangulation) |
| https://commons.wikimedia.org/wiki/File:The_Tower_from_the_Speedway_-_UT_Austin_(54984752616).jpg | CC BY 4.0 (2025-12-10), GPS 30.285227,−97.737850 | ESE view; mast/whips (triangulation); column proportions |
| https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_Tower_Closeup.jpg | CC0 (2011, from the NW) | Window strip anatomy (two-light window, gilded two-panel spandrel, bronze bars); course spacing ~0.5 m |
| https://commons.wikimedia.org/wiki/File:University_of_texas_at_austin_main_building_2014.jpg and the August 2019 / 2013–14 Commons series (CC BY-SA 4.0 / CC0) | various | Whole-Tower proportions from S/E/W; strips read as dark channels with gold dashes |
| seanhlewis/utimagery @13f08efe tower.glb | MIT | All captured texels and geometry (sha256 verified) |

- The complete 26-photo ledger with dates, authors and licences is in [tower-references.json](tower-references.json).
- Photo crops were research inputs only and are not shipped.

## Limitations (honest)

- **Crown geometry is authored and fitted, not survey-exact.** Heights are from the scan profile ± photo proportions, roughly ±0.3 m.
  - Frieze garlands, capital carving, pier pilaster panels and the clock-stage railing/deck fence are not modelled.
  - Joints are drawn, with an estimated course height.
  - The bell-chamber interior is a dark box.
- The clock aedicules and the clock-stage ornaments remain the scan, which is soft at close range.
- Dial numerals use the IIII convention, which was not verifiable at the photo resolution. The hands are fixed at 10:45.
- The shaft away from the strips remains the ~19 texels/m capture. Its texture is blurry within ~20 m.
- The relight is a fitted two-term model:
  - Photographed cast shadows on sunlit faces stay, slightly darkened.
  - The photo's sun elevation is unknown, so equal horizontal sun strength is assumed.
  - The model assumes the fixed game sun preset; a different time of day would not re-relight.
- The far LOD has no window strips or rail/mast; they are below a pixel at 380 m and beyond.
- The heightfield is 0.25 m. The rail and mast are not solid, so a player on the roof can walk through the rail.

## Rebuilding

The game has no new runtime dependencies. Asset authoring uses the pinned manifest [tower-tools.package.json](tower-tools.package.json). With Node 24 and pnpm installed, from the repository root:

```sh
mkdir -p .work/tower-tools .work/scan-inputs
cp tools/scans/tower-tools.package.json .work/tower-tools/package.json
pnpm --dir .work/tower-tools install
ln -s ../.work/tower-tools/node_modules tools/node_modules
node tools/scans/build-tower.mjs
```

Download the pinned raw `tower.glb` URL from `public/assets/scans/sources.json` into `.work/scan-inputs/tower.glb` before building; verify its recorded SHA-256. The alignment input is `tools/scans/tower-transform.json`. Only create the temporary `tools/node_modules` link if that path is absent. Remove the temporary link after authoring. `TOWER_PREVIEW_DIR=<directory>` also exports the detail atlas.

The loader shares both near/far texture atlases, preserves authored versus captured material labels, and keeps one shaft cuboid plus a sampled roof heightfield. Railings and antennas are visual details. Fixed orbit, crown, roof and window review cameras are listed in `lib/campus/blocks/b04-tower/shots.json`.

## Validation

TypeScript, lint, frame-pacing, scan lifecycle, focused Tower geometry/material/roof/registration assertions, render shader checks, all 287 camera-clearance checks, the production build, offline asset audit and static server checks passed. Codex reviewed the real game from opposite crown and shaft diagonals. The broad unchanged campus/stadium suites were stopped rather than treated as completed. The south strip review camera was moved outside the fallback Tower clearance envelope.
