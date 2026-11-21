# WorldGen v0.1.20 — stage-aware 3D terrain

- 3D viewer now displays the terrain saved at the selected historical generation stage.
- Layers 5, 6 and 7 use their own coastline, landform and erosion elevation arrays instead of showing the older layer-4 surface.
- Real locked sea level from layer 5 drives the 3D water plane and sea-relative terrain coloring.
- Layers 8–12 currently reuse the layer-7 eroded surface; the viewer states this explicitly.
- The WebGL terrain pipeline remains worker-generated and read-only, with no save-format or upstream-generation changes.
- Added deterministic stage-source, water-surface and immutability regression tests for rectangle, circle and ellipse.
