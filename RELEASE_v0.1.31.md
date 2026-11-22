# WorldGen v0.1.31 — Legacy cleanup

Third release in the v0.1.29–v0.1.45 stabilization roadmap. This is a cleanup release, not a change to the simulation or 3D terrain algorithms.

## Changes

- Remove the unreachable static raster-render dialog, generation and download code, raster worker, raster-specific settings, event handlers, and styles. The existing editor **Map PNG** screenshot export remains available.
- Retain the shared spatial sampling functions in `terrain-sampler.js`, with identical formulas and nearest-site behavior. Update all active 3D renderer and worker imports, including material sampling and close-up refinement.
- Keep the 3D viewer, terrain history, relief control, and its disposal behavior intact. Simplify modal cleanup by removing retired raster state and document the active Render action.
- Hide the seed field and Reroll button on deterministic geometry and coastline stages, and guard the seed event handlers against stale/historical controls. Show an explanatory hint on layer 5. Retain legacy seed values in save data, defaults, and checkpoint exports; no schema migration or forced regeneration.
- Remove unused formatting code, update version labels, and clarify the historical raster documentation. Both package targets require the active 3D modules and omit the retired ones; the standalone cache is rebuilt from current assets.

## Validation

- 157 automated tests pass. Thirteen raster-only tests were retired with their implementation; five new regressions cover seed control eligibility, deterministic coasts across all world shapes, historical seeds in working and locked checkpoints, active 3D/editor export paths, and the retained sampler API. Existing active geometry, sampling, worker, 3D, storage, recovery and checkpoint tests remain.
- Compared v0.1.30 and v0.1.31 on three 500-cell-target worlds (rectangle, circle, ellipse). For each world, serialized generation data across all 12 stages and derived 3D mesh output for every stage 4–12 matched exactly in SHA-256 comparisons.
- Both standalone and AppLauncher distributions build successfully. Regression checks confirm retired assets are absent from the packages and standalone offline cache.
- Real iPhone Safari GPU appearance and native browser behavior are not verified by these source-level and package checks.

## Compatibility

No generation layer, physical elevation convention, rendering appearance, save-schema, storage-recovery, persistence, or AppLauncher source changes. Existing worlds and checkpoints remain compatible.

Next planned release: v0.1.32 — Physical elevation consistency.
