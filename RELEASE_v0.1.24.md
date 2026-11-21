# WorldGen v0.1.24

This release refines the interactive 3D viewer without changing the terrain simulation, generation stages or save format.

- **Stable world outlines at every LOD.** Circular and elliptical terrain no longer loses shoreline/boundary triangles when switching mesh detail; an unchanged narrow boundary collar is preserved across all four index levels, including the fast uniform path.
- **GPU tile culling.** Mixed-LOD rendering omits tiles that are conservatively determined to be fully off-screen. Per-tile min/max height bounds protect visible mountain ridges from being culled. Close-up panning benefits most.
- **No new controls or generation layers.** LOD and visibility are automatic. Older saves and existing render stages remain supported.
- **Regression coverage.** Tests check outline equality across all four LODs for rectangles, circles, ellipses and even a synthetic internal cutout; camera culling tests include read-only worker-generated terrain.

Note: Maintaining the correct curved outline requires more coarse-level triangles near the world boundary than earlier builds. This is a deliberate geometry-fidelity tradeoff.
