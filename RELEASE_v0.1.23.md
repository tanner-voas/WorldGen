# WorldGen v0.1.23

- Implement tile-local 3D terrain LOD with nearby tiles kept finer than distant ones while orbiting, panning and zooming.
- Use full-resolution shared tile boundaries and transition triangles to eliminate T-junction cracks between different LODs.
- Retain fast single-draw, non-stitched global index buffers whenever all tiles select the same resolution, reducing far-view triangle counts and draw calls.
- Keep all terrain vertices, environmental materials, rivers, lakes, world stages and save schema unchanged. LOD indices are transient GPU-only derived data.
- Add geometry coverage, triangle-winding, boundary continuity, all-shape and camera-distance tests.
