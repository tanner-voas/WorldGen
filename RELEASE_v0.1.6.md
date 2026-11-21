# WorldGen v0.1.6 — Continental Setback and Climate

One `git am` commit against WorldGen v0.1.5. AppLauncher source and the Ciyan submodule are unchanged; standalone and launcher module both build.

## Layer 5: Natural-looking map boundaries

- Keep the one-boundary-polygon enforced water rule from v0.1.5 when **Edge ocean bias** is nonzero.
- Add independently adjustable **Continental setback strength** (0–1.8; default **1.15**) and **Continental setback width** (2–18 average Voronoi cell widths; default **10**). Both have sliders, direct number fields, stepper buttons, and information popups.
- The broad, deterministic, smoothstep depression tapers to zero farther inland; it reaches no more than **16% of the shorter world dimension**. It adds no edge-correlated noise, does not change locked elevation, and preserves the area's land fraction through area-weighted sea-level selection. Saved coastlines are not retroactively regenerated.
- Users with already locked layer 5 should **save a checkpoint, then revise layer 5** (or create a new world) to apply the new continental setback. Revising earlier stages invalidates dependent later layers by design.

## Layer 8: Climate (first computational pass)

- Actual computed climate fields, not placeholders: **mean temperature**, **January/July temperatures**, **seasonal temperature amplitude**, **annual precipitation**, **January/July precipitation approximations**, **humidity**, **moisture availability**, and **notional latitude** per polygon.
- Controls: **equatorial temperature**, **center latitude**, **latitude span**, **axial tilt**, **annual rainfall baseline**, **wind direction**, **mountain rain shadow**, **ocean moderation**, and seed. Wind direction is the direction wind blows **toward**, 0° east / 90° north.
- Uses erosion elevations, fixed ocean/land mask, downwind transport, elevation-related cooling, mountain rain shadows, and proximity to the sea. The underlying geometry remains planar; the latitude coordinate is environmental, not a spherical projection. This is an approximate field generator, **not** a physics-complete atmosphere or ocean circulation simulation.
- Added exploration palettes: mean/January/July temperature, annual precipitation, moisture, and seasonality. Cell inspection displays corresponding values. No earlier layer is modified. Erosion still uses its earlier preliminary rain parameter; later coupled climate–erosion work will be a separate design change.

## Saves and migration

- Save schema remains **v2**; prior worlds and existing complete checkpoints are valid and unchanged. A v0.1.5 world that finished erosion has stage 8 climate settings filled when loaded. A checkpoint through layer 8 includes every preceding layer and actual climate output fields, not only seeds.
- Corrupted climate arrays are rejected at import.

## Verification

- 42 Node tests pass, including coast continuity, boundary protection, geographic area, old-save compatibility, deterministic climate, seasonal phase, invalid input rejection, and stage-8 checkpoint round-trips.
- Both standalone (`dist/standalone`) and AppLauncher (`dist/worldgen`) distributions package successfully.
- A mobile-sized Chromium DOM test with a simulated Worker advanced from World Geometry through Climate and exercised parameter/help UI without page errors. True Worker navigation was blocked in the testing environment, so iPhone Safari validation remains important.

## Install

```bash
git am WorldGen_v0.1.5_to_v0.1.6_git_am.patch
npm test
python3 package.py
git push origin main
```
