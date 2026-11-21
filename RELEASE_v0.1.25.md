# WorldGen v0.1.25

3D quality and mobile exploration refinement; no generation-layer or save-schema changes.

- Fine material texture now uses two deterministic scales and fades out on distant views, providing close-up surface variation without modifying the height mesh or relying on a blurred raster image. Ocean, river, and lake shaders remain unchanged.
- Double-tap (or double-click with a mouse) in the 3D viewer to focus the camera on the visible terrain. The pick ray uses the actual mesh and ocean datum and respects circular/elliptical world boundaries. Fit restores the whole-world camera.
- The terrain mesh worker supplies its compact boundary mask for focus picking. The mask is rendering-only and not written to checkpoints.
- Fixed the on-screen version label lagging behind the package version in v0.1.24.
- Automated tests cover ray picking, terrain outline exclusions, the generated mesh mask, and focus behavior.

The renderer still uses Voronoi-derived elevation; finer true geography will require the planned local-detail subgrid.
