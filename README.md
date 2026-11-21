# WorldGen v0.1.5

An offline-capable, progressively generated 2D landscape explorer. Build targets:

- `dist/worldgen/` — app module for AppLauncher (launcher owns PWA shell/service worker).
- `dist/standalone/` — self-contained installable PWA with its own manifest/service worker.

Run `npm test` and `python3 package.py` to validate/build both targets; `npm run serve` serves the standalone distribution on port 8766.

## Generation stages

1. **World geometry (new)** — choose rectangle (width and height in km), circle (radius in km), or ellipse (horizontal and vertical radius in km). All worlds are planar; no depth is generated. Bounds for each linear dimension/radius: 50–20,000 km. The selected shape becomes part of each checkpoint and drives geometry clipping and the map's physical units.
2. **Voronoi geometry** — now controlled by **target average polygon area in km²** rather than an arbitrary count. The implied number of sites is `round(world area / target area)`, bounded to 100–5,000. Limits of the logarithmic area slider adapt to world area. Site placement, jitter, relaxation and seed remain adjustable. Circular/elliptical polygons are clipped at the shaped world boundary.
3. **Tectonic plates** — plate territories, crust type and motion.
4. **Elevation** — terrain noise, tectonic uplift and relief.
5. **Oceans and coastlines** — sea level chosen by true polygon area, not site count. An optional *edge ocean bias* pushes the immediate outer boundary underwater for rectangles, circles, and ellipses. Its smooth falloff is adjustable in typical cell widths; the default is narrow (1.5 cell widths), capped at 12% of the shorter world dimension. Boundary-touching cells are always water while this setting is enabled, and the land-area target accounts for that forced edge water. Existing locked heights and older saved coastlines remain unchanged.
6. **Landforms** — ridges, valleys, ruggedness, volcanoes; preserves the locked coast mask.
7. **Erosion** — preliminary rainfall/runoff, sediment transfer, slope weathering, drainage channels; preserves earlier layers and locked coastlines.

Future stages: climate, hydrology, soils, biomes, habitats and local detail. Generated terrain is a procedural approximation, not a full physical simulation. Computation currently runs in a Web Worker on the CPU, not WebGPU.

## Parameter controls

Every generation parameter has a contextual **i** button explaining the effect of increasing and decreasing it. Numeric parameters have both a **slider**, **editable numerical field**, and **− / + buttons**. Geometry dimensions and average Voronoi area change by ±5% of the current value per tap; the other parameters use fixed linear increments suited to their ranges. Area has a logarithmic slider to support dramatically different world sizes. Choices such as shape and site distribution use dropdowns, also with information buttons. The random seed has a direct number field, help button and reroll action (a slider is not appropriate for a seed).

The first stage previews its geometry immediately. Lock it to proceed to Voronoi generation. Cell inspector area reports km² and the distance ruler reports km; map scale and zoom-to-fit use physical world dimensions.

## Launcher-startup fix

v0.1.5 also fixes the JavaScript `ReferenceError: Can't find variable: stored` shown when opening WorldGen from AppLauncher. The loaded workspace variable is now correctly scoped across storage recovery and interface initialization. The fix lives in WorldGen; no AppLauncher update is required.

## Navigation, saving and compatibility

Drag and pinch to navigate, use the view selector for terrain/tectonic/erosion modes, toggle mesh and geographic overlays, examine individual cells, compare previously generated stages, and export the visible canvas to PNG.

Automatic caching and named checkpoints preserve all generated layers, parameters, seeds and data. A checkpoint saved through layer N contains every layer 1–N; revising a locked layer creates a new working branch after confirmation. Exports are complete JSON records; keep an external copy because mobile browser storage may be evicted.

**Save schema v2:** Existing WorldGen v0.1.0–v0.1.3 saves are upgraded on import or local load. Migration prepends a 2,048 × 1,024 km rectangular geometry layer, increases all previous layer numbers by one, and retains generated polygon coordinates, tectonic data, elevations, coastlines, landforms, and erosion data rather than regenerating them. Previously saved checkpoints and a working Voronoi preview are supported. The internal IndexedDB namespace remains `worldgen-v1` to preserve upgrades.

## Deployment

Apply the single v0.1.4 → v0.1.5 `git am` patch to the existing WorldGen repository, then run:

```bash
npm test
python3 package.py
git push origin main
```

The existing GitHub Action notifies AppLauncher to advance the pinned WorldGen submodule, with no required launcher-code changes. For independent testing, deploy `dist/standalone/` as a standalone PWA.

Future work includes adaptive polygon batching for much larger worlds, higher-resolution terrain tiles, GPU compute, spherical topology, depth, population, ecology, and societal simulations.
