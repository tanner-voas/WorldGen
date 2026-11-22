# WorldGen v0.1.38 — Adaptive detail budgeting

## Changes

- Replace fixed four-tile, uniformly dense close-up requests with projected screen-space demand. The conservative projection accounts for camera orientation, near-plane intersections, actual framebuffer dimensions, and the viewer's relief multiplier; a small viewport margin provides limited prefetch.
- Choose 2×, 4×, 6× or 8× local subdivisions with hysteresis, a deterministic coverage-prioritized allocation, and a maximum of 262,144 requested close-up triangles. This budget excludes the base terrain and separate water geometry. Previously, four complete 32×32 tiles at the actual 8× worker subdivision setting could require 524,288 triangles.
- Keep the global terrain visible until replacement geometry arrives. Reuse matching cached geometry; lower-resolution cached patches can remain during upgrades, but old denser patches cannot exceed the new plan's triangle budget. Coalesce worker requests and reject stale responses by plan signature, including subdivision levels.
- Bound retained close-up GPU geometry buffers by bytes (16 MiB, excluding the global mesh, water, driver overhead and temporary uploads). Report actual active subdivision levels instead of the old inaccurate fixed 6× label.
- Use stitched global tile draws with frustum culling during close-up loading, rather than drawing the entire fine global mesh in that case. Align interpolated material colors as well as heights at shared local tile edges.
- Preserve all saved terrain, water features, physical elevation conversions, relief controls, and generation layers. No new settings or AppLauncher changes. Partially clipped circular/elliptical edge tiles remain ineligible for local refinement until boundary-aware refinement is implemented.

## Verification

Regression tests exercise perspective projection, near-plane handling, portrait and landscape viewports, oblique views, relief changes, deterministic budget allocation, cache eviction, mixed subdivision worker output and shared height/material edges. A synthetic interior close-up requires a single 8× tile (131,072 triangles), versus up to four 8× tiles (524,288 triangles) before. The budget can reduce individual tile density in wider or boundary-spanning views. This is derived geometry, not new geographical detail. Native iPhone WebGL rendering and performance are not measured by the Node tests.
