# WorldGen v0.1.21 — 3D hydrology rendering

- First optional water-feature pass for the interactive WebGL2 3D terrain viewer.
- From layer 9 onward, the viewer now derives curved, discharge-scaled river ribbons from the locked downstream drainage graph.
- Lakes render as level water surfaces from their saved spill elevations and cell polygons.
- The new geometry is computed in the 3D mesh worker, transferred to the GPU and drawn with depth testing. It is not part of saved world data.
- Earlier terrain layers remain visually unchanged, while later layers reuse the same established hydrology geometry.
- Added tests for deterministic water geometry, source immutability, world shapes, a synthetic closed-basin lake and earlier-stage absence.

Limitations: lake outlines and river placement are still derived from Voronoi-scale hydrology, so finer channels, banks and shorelines require later sub-cell terrain detail. GPU appearance must be checked on iOS Safari because the local test browser cannot create a WebGL2 context.
