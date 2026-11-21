# WorldGen v0.1.14

An offline-capable, progressively generated 2D landscape explorer. Build targets:

- `dist/worldgen/` — app module for AppLauncher (launcher owns PWA shell/service worker).
- `dist/standalone/` — self-contained installable PWA with its own manifest/service worker.

Run `npm test` and `python3 package.py` to validate/build both targets; `npm run serve` serves the standalone distribution on port 8766.

## Generation stages

1. **World geometry (new)** — choose rectangle (width and height in km), circle (radius in km), or ellipse (horizontal and vertical radius in km). All worlds are planar; no depth is generated. Bounds for each linear dimension/radius: 50–20,000 km. The selected shape becomes part of each checkpoint and drives geometry clipping and the map's physical units.
2. **Voronoi geometry** — now controlled by **target average polygon area in km²** rather than an arbitrary count. The implied number of sites is `round(world area / target area)`, bounded to 100–5,000. Limits of the logarithmic area slider adapt to world area. Site placement, jitter, relaxation and seed remain adjustable. Circular/elliptical polygons are clipped at the shaped world boundary.
3. **Tectonic plates** — plate territories, crust type and motion.
4. **Elevation** — terrain noise, tectonic uplift and relief.
5. **Oceans and coastlines** — sea level chosen by true polygon area, not site count. The original *edge ocean bias* keeps the outermost ring of polygons underwater with its narrow 1.5-cell-width taper. An independent *continental setback* (default strength 1.15, width 10 cell widths; capped to 16% of the shorter world dimension) gently depresses a much broader band, discouraging continents from following the world outline. Both effects fade smoothly, the interior elevation layer stays unchanged, and sea level is recalculated to preserve the desired land-area percentage. Border-touching polygons remain water while edge ocean bias is enabled. Existing locked heights and older saved coastlines remain unchanged.
6. **Landforms** — ridges, valleys, ruggedness, volcanoes; preserves the locked coast mask.
7. **Erosion** — preliminary rainfall/runoff, sediment transfer, slope weathering, drainage channels; preserves earlier layers and locked coastlines.

8. **Climate** — deterministic, notional-latitude temperature, prevailing-wind rain shadows, annual precipitation, moisture index, and January/July temperatures. Coastal proximity moderates seasonal temperature swings; the model does not simulate global atmospheric circulation. Climate map overlays and per-cell inspection show all fields. Earlier locked erosion runoff remains preliminary and is not silently recomputed.

9. **Hydrology** — priority-flood drainage over the locked erosion elevations, with annual climate-driven runoff, infiltration, temperature-based evapotranspiration, river threshold and approximate topographic lakes. Each non-ocean cell has an acyclic outlet route; catchment area and annual flow are available for inspection. Rivers are center-to-center lines on the Voronoi graph, not high-resolution river geometry. Lake occupancy requires natural closed topographic basins and may be absent from some worlds. This layer does not modify the locked coasts, erosion or climate.

10. **Soils** — derived soil thickness, texture class, organic matter potential, permeability, fertility potential, groundwater recharge potential, and erosion susceptibility. Soil formation uses geology, terrain, erosion/deposition, climate, and hydrology. Ocean and lake cells do not receive soil. Five controls tune weathering, organic accumulation, alluvium, permeability and recharge. Soil maps and per-cell inspection are available without changing earlier layers.

11. **Biomes** — potential natural environments derived from the locked climate, soil, topography, rivers and lakes. The classification distinguishes cold, temperate, tropical, mountain, dryland and wetland environments. Independent settings adjust effective biome temperature, rainfall response, forest moisture threshold, wetland threshold, alpine summer threshold and smooth regional variation without rewriting earlier climate or terrain. Additional Voronoi-scale maps visualize ecological productivity potential, tree-cover potential, drought stress, the thermal growing season and biome transitions. This is environmental suitability, not vegetation growth or animal-population simulation.

12. **Vegetation and habitats** — deterministic, Voronoi-scale canopy and ground cover, biomass index, estimated vegetation height, riparian influence, and structural habitat classes. Density, maturity, disturbance, riverside boost, and spatial patchiness are adjustable. This is a static vegetation snapshot, not a population, ecological succession, or wildlife simulation. Previous biomes, climate, soils and rivers remain immutable.

Future stage: local detail. Generated terrain is a procedural approximation, not a full physical simulation. Computation currently runs in a Web Worker on the CPU, not WebGPU.

## Parameter controls

Every generation parameter has a contextual **i** button explaining the effect of increasing and decreasing it. Numeric parameters have both a **slider**, **editable numerical field**, and **− / + buttons**. Geometry dimensions and average Voronoi area change by ±5% of the current value per tap; the other parameters use fixed linear increments suited to their ranges. Area has a logarithmic slider to support dramatically different world sizes. Choices such as shape and site distribution use dropdowns, also with information buttons. The random seed has a direct number field, help button and reroll action (a slider is not appropriate for a seed).

The first stage previews its geometry immediately. Lock it to proceed to Voronoi generation. Cell inspector area reports km² and the distance ruler reports km; map scale and zoom-to-fit use physical world dimensions.

## Launcher-startup fix

v0.1.5 also fixes the JavaScript `ReferenceError: Can't find variable: stored` shown when opening WorldGen from AppLauncher. The loaded workspace variable is now correctly scoped across storage recovery and interface initialization. The fix lives in WorldGen; no AppLauncher update is required.

## Navigation, saving and compatibility

Drag and pinch to navigate, use the view selector for terrain/tectonic/erosion/climate/hydrology modes, toggle mesh and geographic overlays, examine individual cells, compare previously generated stages, and export the visible canvas to PNG.

Automatic caching and named checkpoints preserve all generated layers, parameters, seeds and data. A checkpoint saved through layer N contains every layer 1–N; revising a locked layer creates a new working branch after confirmation. Exports are complete JSON records; keep an external copy because mobile browser storage may be evicted.

**Save schema v2:** Existing WorldGen v0.1.0–v0.1.3 saves are upgraded on import or local load. Migration prepends a 2,048 × 1,024 km rectangular geometry layer, increases all previous layer numbers by one, and retains generated polygon coordinates, tectonic data, elevations, coastlines, landforms, and erosion data rather than regenerating them. Previously saved checkpoints and a working Voronoi preview are supported. The internal IndexedDB namespace remains `worldgen-v1` to preserve upgrades.

## v0.1.9 refinement and performance pass

- Indexed bounds-grid culls most off-screen Voronoi polygons when zoomed in. Full-world rendering retains the cheap sequential scan. Cell taps use the same spatial index rather than examining every site in normal cases. This index is purely transient: it does not change the cell count, shape, polygon data, save schema or regeneration seeds.
- Voronoi graph construction only accepts a neighbor when an actual site bisector produces a polygon edge; clipped outer-boundary segments cannot be mistaken for connecting edges.
- Blank number input no longer silently becomes zero, and invalid seeds are rejected and restored in the control instead of changing the world inadvertently.
- The IndexedDB connection can retry after transient open failures. Saving remains self-contained and existing world/checkpoint data is not rewritten by the index.
- Regression tests compare indexed lookups with an exhaustive scan on rectangles, circles and ellipses, verify cell picking and preserve historical checkpoint data.

## Deployment

Apply the single v0.1.10 → v0.1.11 `git am` patch to the existing WorldGen repository, then run:

```bash
npm test
python3 package.py
git push origin main
```

The existing GitHub Action notifies AppLauncher to advance the pinned WorldGen submodule, with no required launcher-code changes. For independent testing, deploy `dist/standalone/` as a standalone PWA.

## v0.1.10 biome and exploration pass

- A full eleventh generation layer calculates biome classes, thermal growing window, tree-cover potential, relative productivity, drought stress and transitions between neighboring biome cells.
- The natural map now shows biome colors at stage 11; prior-stage palettes remain available. Five additional numerical overlays, a legend and per-cell inspection show underlying ecological conditions.
- Ocean and freshwater lakes remain separate classes. Locked upstream layers are immutable; the climate/forest modifiers affect only biome interpretation.
- Stage-11 snapshots include all prior generation data. v0.1.9 worlds and their stage-10 checkpoints can advance directly after upgrade. Save schema stays at v2.
- Automated tests cover deterministic generation, three world shapes, controls, complete checkpoint/save validation and corrupted import rejection.

Future work includes adaptive polygon batching for much larger worlds, higher-resolution terrain tiles, GPU compute, spherical topology, depth, population, ecology, and societal simulations.

## v0.1.11 vegetation and habitats pass

- Layer 12 converts ecological potential into a deterministic static vegetation snapshot. Five controls tune density, maturity, disturbance, riparian growth, and low-frequency patchiness. All existing slider, number-entry, stepper, and help behavior applies.
- New map modes display vegetation cover, habitat classes, canopy, ground vegetation, biomass index, structural complexity, and riparian influence. Cell inspection shows each measurement.
- River and lakeshore effects propagate across only a few mesh neighbors. Oceans and lakes have no vegetation; permanent snow/ice remains bare. None of the earlier locked layers are modified.
- Stage-12 named checkpoints store all twelve layers. Earlier WorldGen saves (including v0.1.10 stage-11 worlds) are compatible without a schema migration, and the layer can be generated from those saved projects.
- The model is a spatial approximation. It does not model species, animal populations, yearly growth, wildfire chronology, or true physical biomass units.


## v0.1.12

WorldGen now includes a stage-aware static render mode that can generate higher-resolution blended map images from any completed layer 5+ world state without changing the generation pipeline.


## v0.1.13

Fixed the v0.1.12 missing `render.js` deployment module error. Packaging now includes every source JS/CSS module and fails the build if a relative import is absent.


## v0.1.14

Render mode is now a true terrain-render pass rather than a lightly blurred cell map. It synthesizes a continuous raster-style terrain image from the completed world layers, adds relief shading, blends coastlines instead of drawing polygon borders, and can optionally emphasize climate, hydrology, biomes, or vegetation depending on how far generation has progressed. The resulting render opens inside an in-app viewer with drag-to-pan and zoom controls; editing still requires leaving render mode and returning to the normal world-generation interface.
