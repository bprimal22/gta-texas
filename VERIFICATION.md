# Offline realism build verification

Implementation: Claude Opus 5.5 with isolated workers. Codex reviewed the integration, commissioned independent geometry/texture checks, and verified the built game through the Codex in-app browser. Final review: October 19, 2026, America/Chicago.

## Browser and gameplay proof

- Cold load with browser cache disabled and external HTTPS blocked: **84 requests, all local, zero failed requests and zero HTTP errors**. Three event batches have no truncation or omitted pages. Cache and blocking settings were restored. The server also sends a same-origin CSP. This is browser network isolation, not an operating-system airplane-mode test.
- **14 matched camera views** captured from the final v2 distribution. Every view was ready, ambient-occlusion warmup completed, and there were no browser warnings/errors. Fixed-camera shots move the render camera only; the HUD spawn label does not indicate player location.
- Actual final-build map travel to Speedway, the DKR west stand and Tower north; approximately **59 m of scooter travel north on Speedway** without forced dismount; repaired Tower-north ramp crossed while riding; flight rose to **100 m above terrain**, hovered on release, then descended onto the scanned stand. The stand click had zero relocation.
- Earlier staged in-app checks covered normal Capitol travel with AO, arrow-key flight and landing on the Tower roof. Tower assets and flight, game and map-travel code remain byte-identical to that roof check. The later scan-loader change only labels authored infill separately.
- On this M5 Pro at 1280x720 and pixel ratio 1.5, the final inside-stadium sample reported median 60.2 fps, p05 59.5, GPU p95 6.98 ms. Speedway scooter sample: median 59.5 fps, p05 39.8, GPU p95 10.88 ms. Scheduling and route changes affect the rolling windows; these are local observations, not a universal performance guarantee. Startup builds the scene and compiles shaders before play.

## Automated and independent checks

Every step of `npm run verify` ran sequentially in `.work/isolation.sb`, denying non-local network and reads from the original game/release directories. All exited zero. Steps ran as separate calls, not one monolithic command, because collaborator tool calls are limited to ten minutes. Logs: `.work/final-v2/steps.log` and adjacent per-step logs.

- TypeScript, lint, build, offline audit; server check of all **130 served files**, routes, MIME types, path refusals and CSP.
- Travel fixture; **4,305,802** authored walkable samples with zero generated-building overlap; all five Gates-Dell probes outdoors.
- **11,651** trees, zero low-limb violations over paving.
- Ground tie-ins: 49,688 visible/physical samples with zero differences over 5 cm; four walking crossings completed. Independent full paving test: 16,118 new tie-in triangles against 160,122 original paved triangles, **zero conflicting intersections**. This is not proof of every route.
- Scan registration/collision, injected collision-failure rollback, six stand travel requests, field travel, 20 loader lifecycle cases, eight UV-chart tests, renderer checks, all 14 shot-clearance checks and Capitol shader regression.
- Independent photo-UV check: on the same 451 affected near samples, median RGB error improved **74.54 to 2.92**. Final far median error is **5.96** on 431 matched samples. All 340,088 near and 253,812 far captured triangles have coherent source-photo regions. Actual root and `dist` assets match accepted hashes. This measures correspondence to source photographs, not real-world survey accuracy.
- Codex verified all **558 files** in the integrator source/assets/dist snapshot. This report was updated afterward; runtime files were unchanged.
- All **389 original-game baseline hashes** still match. Nothing was committed, published or deployed from this offline project.

## Sources and remaining limits

Only the Tower and parts of DKR are photographic captures. LiDAR supplies measured roof/canopy structure; most facades, street details and landscaping remain authored or generated approximations. Street View was used to interpret architectural features; no Google panorama images were shipped as assets.

The west-stand source has about 6.6 texels/metre (roughly 15 cm per pixel), strong baked shadows, rough seating and incomplete edges. Its plain press box, parapet, roof cap and small hole fills are authored. Both photo textures consume up to about 85 MiB including mipmaps. Joins to generated stands are closed barriers with steps up to about 10 m, not continuous walkable seating. Scooter support on stand patches does not make seat rows rideable.

The stadium exterior uses approximate flat bands, piers, glazing and Bellmont fins; the south end is generic and corner towers are absent. Some Tower-west ground lips remain visible, and canopies obscure some fixed views. This is **not a 1:1 digital twin or GTA-level reconstruction**. The separate Gaussian-splat experiment was not integrated: off-route/free-flight quality and reverse-pass alignment did not pass acceptance.

## Play and evidence

Run `npm start` here, then open <http://127.0.0.1:5193/>. Bundled `dist/` and the Node built-in server need no package installation, account or token. See README.md for controls and rebuilding. Node 22.13+ is recommended; final checks used installed Node 25.

Detailed reports, screenshots, network events, UV validation and runtime records are in `/Users/bprimal/e/ut/research/realism-rebuild-91/`, especially `final-shot-captures.json`, `final-runtime-evidence.json`, `final-offline-network-complete.json`, `stand-uv-independent-review.md`, `final-integrated-hash-check.log` and `original-preservation-check.json`.


## West Campus identity pass — October 21, 2026

Implemented in isolated Claude Opus 5.5 lanes, then combined and independently checked by Codex. This pass changes 24 locations: Dobie Twenty21; Cane’s, Chick-fil-A, P. Terry’s and the Domino’s host storefront; 16 generated building profiles; Skyloft and Moody finishes; and one deep-West tower finish. Four other authored towers were audited and retained.

Dobie now has reflective blue-green glazing, dark horizontal bands and its measured stepped podium/tower envelope. The stores have individually authored entrances, awnings, canopies and materials. Tower profiles use building-specific glazing, floor spacing and finishes instead of a uniform pale apartment treatment. Reference photos remain research inputs; they are not runtime facade textures.

Independent checks passed: TypeScript/lint, production build, harness build, final global context checks, all 14 block checks, 33 high-rise assertions, standalone and combined-scene retail checks, camera/render clearance, extension checks, narrow-gap collider regression cases, offline asset audit and local-server checks. The initial global scale check classified new apartment profile names as offices; exact-name, dimension-guarded contracts corrected that test classification, with 50 positive/negative cases and the full context rerun passing. Original scale rules were retained.

The retail suite tested 170 scooter rides, approximately 3.7 km, with zero retail-owned forced stops. Twelve contacts from existing generated context near the Otis corner remain. Dobie’s source-aligned envelope also exposes an existing Whitis footway/building conflict and a small new contact where the measured City footprint closes an old gap. Render/collider agreement is verified; this is not a claim that every mapped route is unobstructed.

Visual review used only the Codex in-app browser. The build remains an approximation: shared glass shading, simplified lettering, unmodeled balconies and secondary facade details still limit realism. A raw deep-West high-rise excluded by the existing district seam remains a coverage gap. This pass does not make the world 1:1.

Run evidence and guarded promotion records: `/Users/bprimal/e/local-ut/.work/west-campus-identity-20261021/`. Review screenshots and a portable summary: `/Users/bprimal/e/ut/research/whole-campus-92/district-agents-40/verification/west-campus-identity-20261021/`. The original online game is untouched; no public deployment was performed.

## GPU efficiency pass — October 22, 2026

Rendering now has a 60 FPS budget independent of the 60 Hz physics step, a 30 FPS
Power saver option, 5 FPS intro/map/settled-idle rendering, and no rendering while
the document is hidden or unfocused. Focus/mode transitions discard elapsed time
debt. Dynamic shadows, geometry/LOD settings, lighting, pixel ratio, AO samples,
and scene antialiasing retain their previous settings. The final fullscreen
output no longer requests a second multisampled canvas framebuffer.

AO multiplication is fused into output conversion. A controlled local Chromium
comparison at 1280×720, DPR 1, `?shot=spawn-east-mall-west` used the same new frame
budget in both runs and switched only `aocomposite=legacy` versus the fused path.
After 10 seconds of warm-up:

| Measure | Legacy composition | Fused composition |
| --- | --- | --- |
| GPU frame time, median / p95 | 6.08 / 6.92 ms (50 samples) | 5.68 / 6.39 ms (33 samples) |
| Draw calls | 650 | 648 |
| Triangles | 4,692,263 | 4,692,261 |
| Fullscreen passes | 5 | 3 |
| Extra full-resolution half-float composite | 1280×720 | unused 1×1 placeholder |

This is about a 7% per-frame GPU reduction in one fixed view, not a prediction
of temperature or battery improvements. The full-size composite colour buffer
alone was 7.0 MiB at this resolution. The unchanged scene region in screenshots
had mean absolute RGB difference 0.86 on the 0–255 scale; independently randomized
Poisson denoising noise and removal of intermediate half-float rounding prevent
a pixel-identical comparison. Visual review retained edges, foliage and shadows.

Browser checks exercised running, scooter riding/steering/braking, takeoff,
forward flight and landing at 30 FPS; the live power toggle, expanded map and
960×600 target resize worked. Active render intervals were approximately
33.4 ms at 30 FPS and 16.7 ms at 60 FPS; quiet mode reported a 5 FPS target.
An initially unfocused document reported a zero render target. Deterministic
scheduler tests cover blur/hidden/resume without catch-up, idle/input transitions,
mode switches, and pacing at display rates from 59.94 through 165 Hz. The browser
automation's tab/window visibility controls did not reliably change DOM focus,
so those controls were not used to claim an OS-level background-power measurement.

TypeScript, lint, production build, offline audit, local-server checks, render
checks (including actual fused shader submission/pass counts and resize/DPR
coalescing), 270 physical camera-clearance checks, and the Capitol shader check
passed. Temporary measurement code was removed from the production entrypoint.
Local raw evidence is retained under `.work/ao-legacy.*`, `.work/ao-fused.*`,
`.work/visual-comparison.json`, and `.work/performance-*.json`.
