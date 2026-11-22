# WorldGen v0.1.39 — Boundary refinement

## Changes

- Allow the screen-space close-up planner to select nonempty, partially clipped tiles along circular and elliptical world boundaries. Empty tiles remain excluded.
- Subdivide each existing base triangle into an exact set of fine triangles, rather than independently masking the finer grid against the analytic world outline. This preserves the base mesh's projected footprint, diagonal edges and topology at every supported subdivision level, including clipped tiles and mixed resolutions. The existing base outline is retained; this is not a new geographic boundary generation algorithm.
- Fade refined terrain heights, normals and material colors into the base interpolation near exposed outline edges. A one-cell halo makes the edge constraints consistent across neighboring tiles. Interior terrain retains local refinement, and existing river protection and lake/coast sampling are preserved.
- Send the original base mesh mask to the long-lived worker once per refinement session. Direct calls without the mask can reconstruct it from world geometry.
- Keep the screen-space detail budget of 262,144 requested triangles and the 16 MiB retained GPU buffer budget. Bounds use full tile rectangles, so the triangle estimate is conservative for clipped tiles; unused vertex slots still consume memory and are accounted for by the cache.
- No changes to generation, saved worlds, checkpoints, visual relief controls, or AppLauncher.

## Verification

New regression tests exhaust all sixteen corner masks and subdivisions 2, 3, 4, 6 and 8, verify exact parent-triangle coverage and orientation, and test generated circular/elliptical maps. Additional checks cover camera selection of clipped tiles, empty-tile exclusion, the detail budget, matching boundary heights/materials, refinement away from edges, preservation of river-covered terrain, and the actual worker protocol for mixed-resolution patches. Native iPhone visual appearance and WebGL performance are not measured by the Node tests.
