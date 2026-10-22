# GTA Texas — Offline Campus Explorer

**Play online:** [gtatexas.pages.dev](https://gtatexas.pages.dev/)

An unofficial, standalone UT Austin campus explorer built with Three.js:
a personal character, walking, scooter, flight, travel map and overview,
on a campus built only from files in this repository. This project is not
affiliated with Rockstar Games or The University of Texas at Austin.

Clone the repository, enter its directory, and run `npm start` with Node.js
22.13 or newer. The checked-in `dist/` includes the playable offline build;
no dependencies, account, map token or internet connection are needed to play
after downloading. Building from source requires installing dependencies once.
See `public/credits.txt` and the asset source/license records for attribution;
third-party assets retain their individual licenses.

## Play

```sh
./start.command          # or: npm start
```

Then open <http://127.0.0.1:5193/>. `start.command` also opens your default
browser; `npm start` only starts the server. Stop it with Ctrl+C.

* No internet, account, token, `npm install` or build step is needed. The
  prebuilt game is in `dist/`, and `scripts/serve.mjs` uses only Node.js
  built-ins (Node 22.13 or newer).
* The server binds to `127.0.0.1:5193` only (override with `PORT=…`). It serves
  `dist/` and nothing else: no APIs, dotfiles or parent paths.
* Every response has a same-origin Content-Security-Policy
  (`default-src 'none'`, `connect-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval'`, …),
  so the browser itself refuses any outside request.
* There is no service worker and no photographic mode. Old URLs such as
  `/?offline=0` or `/?visual=…` still open the same local campus. The
  character viewer is at `/character`.

## Controls

| Key | Action |
| --- | --- |
| ↑ / ↓ | Run forward / backward; scooter throttle / brake; fly forward / descend |
| ← / → | Turn, with the camera following; steer the scooter |
| Hold W | Take off from foot or scooter / rise; release to hover |
| Shift | Run; boost while flying |
| Space | Jump on foot; brake on the scooter; climb while flying |
| F | Get on / off the scooter (clear path needed; stairs need walking) |
| Hold ↓ in flight | Descend while steering; ease into landing; release to hover |
| V | Campus overview / back to the character |
| M | Travel map: click a destination (arrives on foot, outdoors under open sky) |
| Mouse drag, scroll | Look, zoom. Double-click locks the pointer; Esc releases it |

Flight cruise is 28 m/s, boost 48 m/s, and height is capped at 100 m above the
terrain (`lib/campus/flight-motion.ts`, unchanged from the source game). The
scooter tops out at 9.6 m/s. Flight can still land deliberately on roofs; only
map-travel arrivals refuse roofed spots (an atrium or covered court). Travel
tries the 24 nearest candidates first, as in the source game, then up to 96 in
total: mapped path points at least 4 m apart and outdoor radial probes out to
60 m, nearest first. Because all ground is local, rejected candidates are
tested back to back (about 12 ms per frame) instead of waiting to settle. The
player moves only onto a floor that passes every check: visible floor matching
physical floor, capsule clearance, open sky and campus bounds. A click on a
building (for example the Gates–Dell landmark) therefore arrives at the
nearest open spot, typically within 20–30 m and about a second. The DKR
stadium is open to the sky, so its single GIS footprint does not veto
candidates: a click on the stands or the field lands right there (the landing
probe starts above the press box inside the stadium only; elsewhere it stays 5 m
above the terrain so roofs are never landing spots).

## What you are looking at

Sources, from most to least measured:

* **Captured (photogrammetry):** the UT Tower above the Main Building roof is an
  independent MIT-licensed drone scan (seanhlewis/utimagery), cropped and
  aligned to the official footprint (20 corners, 0.60 m RMS; shaft 18.00 m wide,
  top 94.3 m above ground vs published 93.6 m). It replaces the previously
  authored Tower, which turned out to sit about 28 m south of the real shaft
  (confirmed independently by LiDAR). Its collision is a shaft box plus a height
  grid sampled from the visible tops. The DKR turf from the north end zone to
  the south 20-yard line is from the partial stadium scan (visual only, on the
  generated field collider). The scanned DKR west stand (lower bowl and
  overhanging upper deck) is also used, with a collision surface sampled from
  its visible top (median 0.012 m, 96% within 0.1 m). Its torn capture edges
  (upper rim, press-box fragments, streak curtains) are trimmed off and
  replaced by small authored shapes with colliders: a 1.1 m parapet on a
  smoothed rim line, a roof cap and coping, and a plain press-box block sized
  to the surviving scanned slab. The stand keeps the scan's own photo UV
  charts (re-packed at 1:1 source texels; an earlier top-down re-bake had put
  upper-deck photos on lower decks), so it is heavy: ~340k triangles near
  (~254k far), 15.4 MB + 12.7 MB of GLB, and a 4096×2048 atlas per level
  (~43 MiB of GPU texture each; up to ~85 MiB once both levels have been
  shown). Its 622 filled hole cells use a
  separate flat authored material, not photo pixels.
  The seams to the generated stands are closed walls (a visible barrier, up to
  ~10 m step), not walkable joins. East stand, ends and corners stay generated
  (never captured); their seat and concrete colours are medians measured
  through the scan's own photo UVs (grey aluminium benches, warm pale
  concrete). The outer wall is an authored texture interpretation of street-
  level observation (Street View, used only as visual reference): deep flat
  concourse bands, structural piers, lintels/slots and framed glazing on the
  buff north/east sides; tall piers with dense vertical fin panels and one
  window band per level on the pale west (Bellmont) and south sides. Captured colour is
  shown unlit (it already contains the photographed light, including a baked
  afternoon shadow). `?stand=generated` shows the fully generated bowl instead.
* **Measured (USGS 3DEP LiDAR, 2017):** per-building roof heights, roof form and
  height tiers for 1,145 footprints, and 13,245 canopy tree tops. Buildings built
  or changed since 2017 (133 conflicts) fall back to the City of Austin 2023
  heights. See `public/data/derived/README-lidar.md`.
* **Authored** (from the source game, with fixes): terrain and road/path
  finishes, Speedway paving, East Mall/MLK, Welch, POB, PCL, EER, PMA, Main
  Building, Union, Flawn, Hogg, West 24th, the historic central buildings, DKR
  west frontage, Capitol. Gates–Dell now has a finished east volume, east ends,
  roofs and an open east court instead of a grey closure; Hackerman's rear and
  core have openings and matching colliders.
* **Generated context** (`lib/campus/local-context.ts`, `lib/campus/context/`)
  where nothing is authored: each GIS footprint gets one of 23 UT/Austin
  archetypes from `public/data/building-catalog.json` (each entry records whether
  the building is known, a named estimate or a district default), LiDAR heights
  and stepped tiers, CC0 Poly Haven materials, and real recessed windows, doors
  and storefronts within ~110 m (a matching shader farther away). Footprints with
  authored bodies or walkable routes inside are left alone. DKR's bowl outside the
  scanned west stand is generated (stepped stands, concourse, suites, arcade
  wall); the outside facade seen from the street or the air is all generated.
* **Vegetation (11,651 trees):** the 173 authored placements (154 broad,
  crooked live oaks forking low into heavy limbs, 19 upright plaza trees), then
  official UT TreeKeeper inventory site positions (type 1 only, 4,220 placed)
  wherever the inventory covers the campus, then USGS LiDAR crown peaks outside
  that coverage (7,197, approximate trunks), plus 61 OSM points where neither
  exists. Inventory sites take height/crown from the nearest LiDAR crown within
  7 m (2,964) or a local estimate (1,256). Near trees use many small rounded
  leaf sprays with alpha-to-coverage edges (`?msaa=0` falls back to a cutout)
  and soft backlit translucency. The procedural live-oak/broadleaf forms are
  reference-guided, not scans. Trunk and low-limb capsules are always
  loaded; higher limbs load near the camera. No limb hangs below 2.4 m over
  paving. Lawn uses CC0 ambientCG textures with leaf litter and groundcover beds.
* **Ground tie-ins** (`lib/campus/ground/`): along MLK/East Mall → Speedway →
  Tower/West Mall/West 24th, exposed vertical slab edges between authored
  paving and the terrain are replaced by graded lawn batters, short paved
  ramps or limestone retaining walls, each with a collider built from the same
  triangles. Every upward tie-in triangle is clipped in plan against the
  authored hard ground below it, so no lawn or wall covers or raises existing
  paving; authored tops, stairs and their colliders are unchanged.
* **Lighting:** late-morning Austin sun, a clear sky, deeper but readable shade,
  height fog, and ambient occlusion on by default. Settings live in
  `lib/campus/render/`.

This is **not** a 1:1 or survey-accurate twin. Only the Tower and parts of the
stadium are captured; most buildings are reference-guided or rule-based
estimates, and only the character and gameplay are accepted work.

### Whole-campus block pass (October 2026)

The campus rectangle is divided into 14 non-overlapping geographic blocks (`tools/blocks/partition.mjs`; cut on
measured street centrelines). Every GIS building record and mapped path has exactly one owning block, and every
block was compared record by record with official UT building polygons and pages, the 2017 USGS LiDAR (in the
same campus-Y datum), City of Austin data, OSM names and reference photographs, then corrected:

* **Data corrections** (`lib/campus/blocks/<block>/context.json`): corrected or split footprints (City outlines that
  merged several real buildings, e.g. the "NHB" record that contained five buildings, PMA+ECJ, the Law School,
  Dell Medical, St. David's), demolished buildings removed (Erwin Center, Cooley Pavilion, Whitis Court, Cain &
  Abel's), missing buildings added, building types/identities, and explicit massing measured from the LiDAR with
  an explicit height datum. Roughly a thousand generated roofs moved from "metres above a guessed grade" to their
  measured LiDAR heights; buildings newer than 2017 use official or City 2023 heights and are labelled.
* **Authored geometry** (`lib/campus/blocks/<block>/index.ts` and the authored modules a block owns): EER (wings,
  upper court curtain walls, roof screen), PMA/ECJ, the Dean Keeton pedestrian bridge, Goldsmith and Gebauer,
  hollow POB/Welch/MBB/NMS/FNT bodies, the Main Building roof zones and south facade, the Main/South Mall forecourt,
  lawns and the George Washington statue, PCL, the Capitol dome/north face, the Capitol south strip (ground +
  262 City footprints), Speedway north to Dean Keeton, power-plant chimneys, stadium rim heights.
* **How the pieces fit** (for maintainers): `lib/campus/blocks/registry.ts` is the only integration point.
  `applyBlockData()` validates every block's data atomically (ownership by immutable record key, schema,
  evidence, conflicts) before anything is built; `installBlocks()` installs block geometry as a transaction
  (colliders tracked and rolled back on failure; a generated building is only replaced once its replacement
  actually installed). Block solids join the world group and walkable surfaces join the walkway, so map travel,
  the scooter, tree placement and the generated context all respect them.
* **Checks:** `scripts/harness/run-block-checks.mjs` (shared rules: data accepted, walkable surfaces equal their
  own colliders, solid tops/sides have colliders, nothing blocks other walkable ground, shots valid; plus each
  block's own measurements against LiDAR/official polygons), `run-block-framework-test.mjs`,
  `run-root-shared-check.mjs`. These prove geometric consistency with the cited sources, not visual likeness.
* **Evidence:** per-record ledgers, sources and remaining estimates are kept outside the build
  (`research/whole-campus-92/<block>/ledger.json`, `EVIDENCE.md`, `LEDGER-SUMMARY.md`). Most facades are still
  generic archetypes; visual review of the blocks is pending. This is not a 1:1 copy of the campus.
* Block QA cameras: `?shot=<id>` for every id in `lib/campus/blocks/*/shots.json`; `?shot=<unit>-overview` for the
  153 research overview poses (`lib/campus/render/atlas-shots.json`, staged comparison only).

### Review and switches (developer, read-only)

* `?shot=<id>` or `__campus.shot(id)` puts the render camera at one of 14 fixed
  views (`__campus.shots()` lists them; any key or click exits). With `?shot=` in
  the URL the intro panel is hidden so the view is unobstructed; the plain URL is
  unchanged. It never moves the player. For "before" lighting use `?lighting=legacy&occlusion=off&shot=<id>`.
* `?stand=generated` replaces the scanned DKR west stand with the generated
  bowl (for same-camera comparison).
* `?occlusion=off` disables ambient occlusion; `?shadows=csm` tries cascaded
  shadows (opt-in, unmeasured); `?contactao=on` adds contact darkening bands.
* `__campus.snapshot().timing` reports fps, draw calls, triangles and GPU time
  where available.

## Layout

| Path | Purpose |
| --- | --- |
| `dist/` | Ready-to-serve build (what the server hands out) |
| `scripts/serve.mjs` | Local static server (127.0.0.1, CSP, MIME types) |
| `app/`, `web/` | React pages (`/` game, `/character` viewer) and the Vite entry |
| `lib/campus/game.ts` | Renderer, controls, physics loop; local-only boot path |
| `lib/campus/walkway.ts` and building modules | Authored campus (from the source game) |
| `lib/campus/local-context.ts`, `context-*.ts`, `lib/campus/context/`, `stadium-bowl.ts`, `road-infill.ts`, `baked-ground.ts` | Generated context |
| `lib/campus/scan-landmarks.ts`, `public/assets/scans/` | Tower, DKR west-stand and stadium-turf photogrammetry |
| `lib/campus/vegetation/` | Trees, lawn and groundcover |
| `lib/campus/render/` | Lighting, sky, fog, shadows, camera shots |
| `public/data/derived/`, `tools/lidar/` | LiDAR products and the pipeline that made them |
| `tools/scans/`, `tools/context/` | Scan alignment/crop pipeline (needs the upstream GLBs via `UTIMAGERY_DIR`), catalogue generator |
| `public/` | Data, models and textures copied into `dist/` at build |
| `public/credits.txt`, `public/assets/**/sources.json`, `LICENSE.txt` files | Attribution and licenses |

Coordinates are metres around longitude -97.73716, latitude 30.2861: X east,
Z south, Y up.

## Rebuild and verify (optional, works offline)

Dependencies are bundled in `node_modules/` (a real copy; no links outside this
folder). Use Node 22.13+ for the toolchain, e.g.
`PATH=/opt/homebrew/opt/node@25/bin:$PATH`.

```sh
npm run check          # TypeScript + oxlint
npm run build          # vite build -> dist/
npm run audit          # runtime URL/forbidden-string/asset-closure/GLB/symlink audit of dist/
npm run check:server   # every shipped file, page routes, refusals, CSP
npm run check:context  # headless: travel fixture, real scene + context/trees, ground, GDC, scan, stand, block checks
npm run check:render   # lighting/shader checks and fixed-camera clearance
npm run verify         # all of the above
```

`check:context` first runs a synthetic Rapier fixture for map travel: a floor
that fits the player under a roof is refused, a spot without floor is refused,
the open-path fallback is chosen, an isolated overhead branch is allowed, and
flight can still land on the roof. In an atrium whose nearest mapped paths all
run indoors, the original 24 candidates find nothing, the broader search lands
outside, and nothing outside the bounds or inside a footprint is offered.
The ground checks report exposed edges before/after the tie-ins, visible vs
physical agreement on the shared tie-in triangles, four replayed walking
crossings, and an independent test that original paving triangles are not
covered by new tie-in output. The stand check injects a collider failure after
a successful scan decode (the full generated bowl must come back with nothing
of the scan left) and travels into the stand and onto the field.
It then runs the real walkway, terrain, Main Building envelope and generated
context under Node (textures stubbed) and reports:
* which footprints were left to authored work or kept open for routes;
* triangle and collider counts;
* authored walkable samples inside generated footprints (must be zero);
* capsule clearance at the spawn point and each landmark;
* simulated map travel for five Gates–Dell requests, including the landmark
  itself: each must land under open sky within 60 m and 8 s of search.

## Known limitations

* The integrator renders nothing in a browser. Codex's in-app browser checks so
  far covered isolated previews (near trees ~62 fps at Speedway, optional CSM,
  the west stand) and the Capitol/ambient-occlusion fix on an earlier build;
  the final combined build still awaits its browser review.
* Generated buildings are archetype-based estimates: 103 catalogue entries are
  known buildings, 61 named estimates and 1,115 district defaults. Colours and
  window modules are reference-guided, not measured.
* The Tower scan has photographed (baked) lighting: its north and east faces are
  in shade as captured. Its lantern top is an added lid. Ambient occlusion can
  still darken captured pixels at 30–65 m.
* The stadium is partly captured: west stand and north end zone → south
  20-yard line of turf. The rest of the bowl and the whole outside facade are
  generated, and the facade is a flat textured wall up to the ~50 m rim (no
  corner towers or relief; proportions estimated; south end generic; hard
  material seam at the NW/SE corners). The west-stand scan is soft (6.6
  source texels per metre, about 15 cm; seat rows exist only in the texture;
  steps are rough) and keeps its photographed shadow; under the
  overhang it is solid. The scooter can mount on the stand but cannot ride
  along the seat rows. The generated field height (−2.9) and the LiDAR stadium
  ground (−8.0) disagree.
* Tree positions: inventory type-1 sites may include stale, stump or newly
  planted sites (the type codes are unpublished); trees outside inventory
  coverage stand at 2017 LiDAR crown peaks, which can be a few metres from the
  real trunk. 1,264 inventory trees have estimated sizes.
* The Tower's simplified collision (shaft box plus height grid) agrees with the
  visible tops at a median of 0.001–0.007 m, with 84–100 % of sampled points
  within 0.1 m depending on the level — not everywhere.
* Ground tie-ins: where a lawn batter used to cross paving it now stops at the
  paving edge, leaving small open lips (16 m of exposed edges >0.15 m remain in
  the tie-in modules on the hero route, down from 867 m). Generated limestone
  walls (~580 m, up to ~3.3 m where the WCH/East Mall soil yards sit 2–3 m
  above the terrain) are scene changes, not surveyed walls. Exposed edges in
  other modules remain (Welch approach, GDC sculpture joints, walkway
  transitions near (−24, 78…93), EPS/POB/NHB forecourt). Smooth walking is
  replayed only on four crossings; steep collider faces are counted, not
  claimed smooth.
* Twelve footprints with authored walkable ground inside are left empty;
  `check:context` confirms none of the 4.25 million authored walkable samples
  lies inside a generated footprint, and no tree limb hangs below 2.4 m over
  paving.
* Near-detail window cells stream in as you move; the densest cells can take up
  to ~25–40 ms, which can hitch a frame during fast flight.
* The JavaScript bundle is large (≈6 MB) and a cold load spends a few seconds
  generating context and trees. Performance targets (60 fps hero route, ≥45 fps
  at 100 m flight on the M5 Pro) are goals, not yet measured in the browser.


## Cloudflare Pages hosting

The hosted copy is a Direct Upload Pages project named `gtatexas`. Upload the
contents of `dist/` (or a ZIP with `index.html` at its root) to deploy the same
prebuilt game. This project currently uses manual deployments; pushing to GitHub
does not automatically update Cloudflare.

`public/_headers` is copied into `dist/` during a build and keeps the same-origin
security policy used by the local server. Pages serves the character viewer at
`/character` using its default SPA fallback; no rewrite to `/index.html` is
needed because Pages canonicalizes that path to `/`.

The hosted copy needs internet to download its bundled files. For fully offline
play, download/clone the repository and use `npm start` locally. Neither version
uses Cesium tokens or streamed provider tiles.
