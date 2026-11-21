# WorldGen v0.1.16

Quality update for the existing 12-stage generator and render explorer.

- Stable distance-based raster interpolation across Voronoi boundaries, using a site spatial hash and continuous falloff.
- Tap-to-inspect geographic position and stage-appropriate data inside the rendered map, without modifying world data.
- Avoid a duplicate full-resolution preview canvas to reduce memory use.
- Clamp stale render settings and reset them on world changes.
- Regression tests for interpolation continuity, determinism, site-query efficiency, and viewer integration.

The render is still an approximation of the Voronoi-scale simulation; no local-detail subgrid is added in this release.
