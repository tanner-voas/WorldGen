# WorldGen v0.1.35 — Coastline preservation

## Changes

- The saved layer-5 water mask now constrains the terrain heightfield for stages 5–12. The elevation-only stage continues to use the previous unconstrained interpolation.
- Separate land and water nearest-site trees identify the correct side of the Voronoi shoreline. The height sampler blends elevations (or depths) on that side of the shore, continuously tapering to the saved sea datum as the two nearest distances approach equality. Legacy mask/height contradictions are handled without modifying source records.
- Both uniform and adaptive LOD preserve mixed land/water blocks at full base-grid resolution. Adjacent coarse blocks stitch to the finer edges. This retains the same sampled shoreline at every global LOD.
- The close-up worker receives the mask and sea level and reuses the constrained sampler when building local tiles. Tile-edge heights still match the base mesh; a narrow transition band connects the base mesh to the more accurate local terrain. River height sampling shares the same surface constraint; this does not yet resolve river-mouth, lake-basin or all water/triangle alignment issues (planned in later releases).
- Existing generation algorithms, physical height units, relief multiplier, saves, and checkpoint schemas are unchanged. No AppLauncher update is necessary.

## Verification

Five added regression tests cover shoreline continuity, legacy contradictions, homogeneous masks, preservation of generated cell-center classifications, matching shoreline-crossing triangles and watertight transitions in a rectangular LOD fixture, and the real detail worker protocol. Six generated benchmark worlds (rectangle, circle, ellipse at 1,200 and 5,000 polygons) showed zero polygon-center disagreements in the new base triangulation, versus 781 in the prior interpolation. This is a sampled benchmark, not proof of exact shoreline geometry at arbitrary scales or aspect ratios. Very narrow features can remain below base grid resolution; refined tiles also have a short edge stitching band. Native WebGL2 appearance and performance on Safari are not verified by the numerical tests.
