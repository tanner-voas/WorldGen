# WorldGen v0.1.37 — River integration

- Project the saved channel network directly onto the rendered base triangles by clipping ribbon triangles at their grid and diagonal boundaries. The result is coplanar with the actual surface rather than offset from a separate continuous sample.
- Use shared Voronoi edges as channel waypoints; curve within convex drainage cells, taper discharge-based widths at junctions, and add rounded joins. Include lake outflows and connect freshwater inlets to their saved footprints. Clip ocean-bound geometry at the actual triangulated sea level.
- Protect the river-bearing base squares at all uniform and adaptive LODs. Pass the river mask into the close-up worker so high-resolution terrain does not move away from the river footprint; a smooth transition preserves close-up refinement elsewhere.
- Use a WebGL polygon depth bias instead of a physical height offset and draw water planes after the river decals. The relief multiplier scales the same surface coordinates together.
- The additional protected geometry and subdivided channel ribbons increase the triangle count in hydrology views. Screen-space terrain budgeting remains the next roadmap release. Rivers are terrain-conforming visualization geometry, not new physically simulated channel cuts or a new generation layer.

Existing saved worlds, locked layers, generation algorithms, and AppLauncher integration are unchanged. No migration is needed.

Verification: regression tests cover exact triangle conformance, sea-level clipping, shared polygon-edge crossing, lake inlets and outlets, all global LODs, close-up worker integration, and saved-source immutability. Native WebGL2 appearance on iPhone is not verified.
