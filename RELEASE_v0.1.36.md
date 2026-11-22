# WorldGen v0.1.36 — Lake integration

Rendering-only follow-up to v0.1.35 coastline preservation.

- Layer 9 and later use the saved lake membership, spill levels and depths to constrain the continuous terrain sampler. Same-lake depths blend using the existing compact-support kernel. Basins taper to their lake levels, and neighboring dry banks transition back to the surrounding terrain, respecting the ocean mask.
- Draw freshwater surfaces at their actual saved level, removing the arbitrary positive height offset. Lake footprints still use the saved Voronoi polygons.
- Preserve the base terrain tessellation in lake/bank blocks at every global LOD and stitch neighboring coarse blocks; close-up workers receive the same saved hydrology and share the base mesh edge heights.
- Earlier stages and worlds without lakes retain their previous meshes. No saved-layer values, generation algorithms, settings or schema changes. River ribbons sample the corrected terrain; full river integration remains a separate release.

## Verification

189 automated tests pass. Five new regressions check lake depth/shore continuity, generated lake visibility and preserved ocean classification, lake-free compatibility, watertight uniform/adaptive LOD geometry, and the actual close-up worker protocol. Existing lake-level and worker-protocol tests are updated.

Across six default generated worlds (rectangle, circle and ellipse, at 1,200 and 5,000 target polygons), 72 of 227 lake-cell centers were at or above the saved water surface in the previous terrain mesh; 0 were in the updated mesh. No ocean classifications changed at polygon centers. These are triangulated-height measurements, not a guarantee of pixel-perfect lake outlines. Small shoreline deviations and adjacent basins with differing water levels remain subject to spatial resolution. Native WebGL2 appearance and iPhone performance have not been verified.

Both standalone and launcher-module distributions build; the standalone offline cache includes the lake constraint module. No AppLauncher modification required.
