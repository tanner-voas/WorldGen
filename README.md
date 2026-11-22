# WorldGen v0.1.41

An offline-capable, progressively generated landscape explorer with interactive 2D maps and a WebGL2 3D terrain viewer. Build targets:

- `dist/worldgen/` — app module for AppLauncher (launcher owns PWA shell/service worker).
- `dist/standalone/` — self-contained installable PWA with its own manifest/service worker.

Run `npm test` and `python3 package.py` to validate/build both targets; `npm run serve` serves the standalone distribution on port 8766.

## Generation stages

1. **World geometry (new)** — choose rectangle (width and height in km), circle (radius in km), or ellipse (horizontal and vertical radius in km). All worlds are planar; no depth is generated. Bounds for each linear dimension/radius: 50–20,000 km. The selected shape becomes part of each checkpoint and drives geometry clipping and the map's physical units.
2. **Voronoi geometry** — now controlled by **target average polygon area in km²** rather than an arbitrary count. The implied number of sites is `round(world area / target area)`, bounded to 100–5,000. Limits of the logarithmic area slider adapt to world area. Site placement, jitter, relaxation and seed remain adjustable. Circular/elliptical polygons are clipped at the shaped world boundary.
3. **Tectonic plates** — plate territories, crust type and motion.
4. **Elevation** — terrain noise, tectonic uplift and relief.
5. **Oceans and coastlines** — sea level chosen by true polygon area, not site count. The original *edge ocean bias* keeps the outermost ring of polygons underwater with its narrow 63 km default taper (capped at 12% of the shorter world dimension). An independent *continental setback* (default strength 1.15, default width 420 km; capped to 16% of the shorter world dimension) gently depresses a much broader band, discouraging continents from following the world outline. Both effects fade smoothly, the interior elevation layer stays unchanged, and sea level is recalculated to preserve the desired land-area percentage. Border-touching polygons remain water while edge ocean bias is enabled. Existing locked heights and older saved coastlines remain unchanged.
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

Apply the single release `git am` patch to the existing WorldGen repository, then run:

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


## Historical raster-renderer changelog (v0.1.12–v0.1.18)

The following release notes describe the retired static-image renderer; these controls are no longer available. The ordinary editor Map PNG export is still supported.

### v0.1.12

WorldGen now includes a stage-aware static render mode that can generate higher-resolution blended map images from any completed layer 5+ world state without changing the generation pipeline.


## v0.1.13

Fixed the v0.1.12 missing `render.js` deployment module error. Packaging now includes every source JS/CSS module and fails the build if a relative import is absent.


## v0.1.14

Render mode is now a true terrain-render pass rather than a lightly blurred cell map. It synthesizes a continuous raster-style terrain image from the completed world layers, adds relief shading, blends coastlines instead of drawing polygon borders, and can optionally emphasize climate, hydrology, biomes, or vegetation depending on how far generation has progressed. The resulting render opens inside an in-app viewer with drag-to-pan and zoom controls; editing still requires leaving render mode and returning to the normal world-generation interface.


## v0.1.15 — Raster reliability and exploration

- Fixed the terrain renderer's reversed world-boundary arguments. v0.1.14 treated every raster sample as outside the world and drew mostly dark water with only the river overlay visible. No saved world data was changed.
- Added a coordinate-contract regression test for rectangle, circle and ellipse rendering, plus deterministic subcell texture tests.
- Introduced restrained, seeded sub-polygon surface texture and gently curved river paths while retaining all locked terrain and hydrology data.
- Kept maximum sampling work within bounded CPU budgets for large PNG exports. Export dimensions stay as requested; higher resolutions may resample the synthesized terrain field until local-detail tiles are available.
- Improved render exploration with pinch zoom, pointer-centered mouse-wheel zoom, drag-to-pan, fit and zoom buttons, and an expanded map viewing area on phones.
- Cancel render jobs when the render dialog closes to avoid wasted mobile CPU work. Render remains a non-destructive function, not a layer.


## v0.1.16 — continuous raster and viewer refinement

- Replaced Voronoi-owner-dependent blend neighborhoods with a spatially indexed, compact-support interpolation field. Site contributions now depend continuously on geographic distance, reducing cell-aligned seams in rendered terrain.
- Tapping an undragged location in the render viewer displays read-only world coordinates, cell number, relative elevation and available environmental data. This does not edit the map.
- Reuses the completed full-resolution canvas directly in the viewer instead of duplicating it, reducing peak render-preview memory use.
- Render stage selection resets appropriately when changing worlds and is clamped to available completed stages.
- No new generation layer or save-schema change. Existing worlds remain compatible.

## v0.1.17 renderer

The render dialog opens on the selected completed layer. Relief uses world-space slopes, isolated islands and lakes retain their influence at their sites, and rivers meet the interpolated shore. Export size sets PNG dimensions. Terrain detail sets the sampling density within a bounded pixel budget.

A module worker samples and shades the terrain. If the browser cannot start the worker, the same renderer runs in short batches on the main thread. Closing the dialog cancels pending work. The viewer refits on rotation and inspects the layer used for the image.

## v0.1.18 terrain comparison and contours

Choose **Elevation change** in the render dialog and select an earlier elevation layer. Comparing layer 7 with layer 6 isolates erosion. Comparing layer 7 with layer 4 includes coastal shaping and landforms as well. Layers 8–12 use layer 7's terrain. Brown indicates a decrease, teal an increase. Both ends of the scale saturate at 0.10 relative elevation. Tap any cell for the saved baseline and signed change.

For other styles, enable **Land contours** to draw lines at a chosen interval above sea level. Every fifth line is heavier. Contours appear in exported PNGs. The viewer's distance scale follows zoom, and a pin keeps the inspected location visible while panning.


## v0.1.19 – Elevation-first 3D viewer

The former raster-render entry point has been replaced with a read-only, interactive WebGL2 elevation viewer. It is available at layer 4 (Elevation) and remains available when viewing later stages, but currently displays only the original layer-4 elevation field. It is deliberately **not** a new generation stage and does not modify any world data.

A separate computation worker converts the saved Voronoi elevations to a smoothly interpolated rectangular terrain grid, clipped to the selected world outline. The GPU displays a perspective-lit 3D mesh and a flat reference sea surface at zero height. The ocean datum is provisional until a future 3D coastline renderer is implemented. Mesh-index LODs change automatically as the camera zooms, without a render-settings dialog or re-generating terrain.

Orbit with one finger, pan with two fingers or Pan mode, pinch or use the zoom buttons, and Fit to recenter. The viewer requires WebGL2 and fails with a visible explanation on unsupported browsers. No external libraries/CDNs are required: all modules are included in the standalone and AppLauncher packages. Existing worlds and the v2 save schema remain unchanged.

Later work can extend this renderer with coastlines, post-erosion elevation, rivers, climate materials and local subgrid detail.


## v0.1.20 — 3D terrain history and physically positioned sea surface

The 3D viewer now follows the generation stage selected in the world explorer. Layer 4 uses the original tectonic elevation, layer 5 uses coast-adjusted elevations and its computed sea level, layer 6 uses refined landforms, and layer 7 uses the eroded terrain. Layers 8–12 currently reuse the layer-7 terrain; later climate, water features and vegetation do not yet appear as 3D effects. The ocean surface is at the saved coastline sea level from layer 5 onward, not at an arbitrary height of zero. Render mode continues to be a read-only WebGL2 viewer without render settings or save-schema changes.


## v0.1.21 — Hydrology in the 3D terrain viewer

- From layer 9 onward, the interactive WebGL2 terrain viewer renders the saved hydrology network as narrow curved river surfaces and level lake surfaces, spatially aligned with the locked layer-7 terrain.
- The water geometry is derived in the existing worker, transferred as typed arrays and drawn with depth testing so streams stay behind obscuring mountain ridges. It does not mutate any generation layer or the checkpoint schema.
- Layers 4–8 retain their existing read-only terrain render and ocean datum. Climate, soils, biome and vegetation materials are still planned later. River widths and lake shores remain limited by the coarse Voronoi data until local terrain generation is introduced.


## v0.1.22 — Environmental materials for the interactive 3D viewer

From layer 8 onward, the existing 3D terrain mesh now receives continuously interpolated environmental colors from the *selected* completed stage. Layers 8–9 use saved climate temperature/moisture; layer 10 additionally uses soil type and fertility; layer 11 adds biome colors; and layer 12 adds vegetation canopy and ground-cover characteristics. The render has one stable visual profile per stage with no extra settings. Layer 9 and later still include the previously implemented river and lake geometry. Levels 4–7 retain their previous elevation-based appearance.

Terrain height, sea level, hydrology, and saved world data are not rewritten. Appearance is calculated in the mesh-generation worker and transferred as an optional RGB vertex buffer. Source fields are blended on the existing 3D mesh; the eventual high-resolution local-detail subgrid remains necessary for realistic fine textures and vegetation geometry.


## v0.1.23 — Crack-free adaptive 3D terrain LOD

The 3D viewer now selects terrain mesh detail **per geographical tile**, instead of using one coarse or fine resolution for the entire scene. Each mixed-detail tile includes full-resolution boundary vertices stitched into its internal coarser triangles, preventing cracks at seams when neighboring tiles have different LODs. A single-draw uniform index buffer remains available whenever the whole world requests the same detail, keeping wide views efficient. All levels share one immutable terrain vertex/material buffer, so generation data, elevation interpolation, and saved worlds remain unchanged. The viewer status shows active adaptive LOD and submitted terrain triangle counts.


## v0.1.24 — Shape-stable LOD and conservative 3D culling

- Fixed the LOD outline problem for circular and elliptical worlds: coarse uniform meshes previously discarded extra boundary triangles, making terrain appear to shrink when zoomed out. An 8-cell boundary collar now preserves the exact same triangulated footprint at all four LODs in both uniform and adaptive draw paths. The collar also preserves internal cutouts if masks gain them later.
- Added conservative clip-space visibility checks for mixed-detail terrain tiles, with per-tile elevation bounds. Invisible tiles skip GPU draw calls during close exploration; uniform wide views retain their single-draw fast path.
- New regression tests verify identical footprint area, strictly upward-facing triangles, monotone coarsening on all three shapes, per-tile vertical containment and culling in the actual 3D draw path.
- There are no changes to generation layers, serialized worlds, checkpoint compatibility or viewer controls. Edge fidelity costs additional triangles on curved shapes compared with the old (incorrect) coarse silhouette.


## v0.1.25 — 3D surface and camera refinement

- The WebGL2 shader adds restrained, deterministic surface-material texture at two spatial frequencies. Screen-space anti-aliasing suppresses detail that is too small to resolve at a distance. This affects appearance only: no invented terrain elevation, geometry changes, or new generator stages.
- Double-tap a visible terrain location in the 3D viewer to focus and zoom the orbit camera on it; Fit restores the global view. The focus ray checks the current generated mesh and the exact world outline. Mouse double-click is also supported.
- Worker output includes a compact shape mask for read-only focus picking, with no changes to stored worlds.

## v0.1.26 — realistic terrain proportions and close-up geometry

- Corrected gross vertical exaggeration in the 3D renderer. Source elevations are not metres; the 3D view now uses a stable world-dimension-based convention (approximately 6 km of relief per model unit, visual exaggeration ×3, with bounds for small/large worlds), replacing the fixed 0.73 multiplier. Ocean, lakes, rivers, tile height bounds, and terrain picking use the same vertical units. No saved elevation data is changed.
- A smoother, finite-slope, compact interpolation kernel replaces the very sharp inverse-distance weighting that created isolated 3D spikes at individual Voronoi centres.
- At close zoom, a Web Worker builds **6×6 finer terrain geometry per base grid square** within at most four tiles near the camera target. Detail blends into the original base-grid heights at shared edges, so neighboring coarse and refined meshes do not crack. Fine terrain still follows the original polygon field; it does not add new generated landforms.
- Zoom can continue until the average original polygon is larger than the field of view. Orbit and pan follow the nearby surface at close range. Up to eight local tiles remain cached while exploring to avoid redundant sampling; leaving the close-up view releases their GPU resources. The global mesh and LOD remain inexpensive.
- Rendering remains stage-aware (4–12), read-only, offline, and has no user-facing render settings. World generation, checkpoints, save schema, and AppLauncher integration are unchanged.
- Tests cover realistic scale, smooth interpolation, exact coarse-to-refined tile seams on all world shapes, close zoom limits, worker-based tile upload/reuse/release, and preservation of source elevation values.

**Constraint:** A polygon may now fill the camera view without the coarse base mesh becoming the limiting factor, but the actual topographic information is still limited to the original polygons until local-detail generation is implemented. WebGL2 on iPhone Safari still requires testing on device.

## v0.1.27 — adjustable relief

The 3D viewer includes a collapsible relief control. Starting at 1×, each plus/minus tap multiplies/divides the visual height by 1.05; the scene updates two seconds after the last adjustment. No physical world data changes.

## v0.1.28 — 3D optimization and stabilization

- Close-up terrain refinement uses a persistent, read-only worker and retains a
  single copy of the source world per zoom session. Only tile coordinates move
  between threads after initialization; rapid camera movements coalesce pending
  requests rather than queueing obsolete mesh builds. Cached GPU tile resources
  remain bounded, and zooming out releases the worker and cache.
- The worker reuses its spatial sampler and source material colors across
  neighboring high-resolution tiles. Colored terrain samples height and material
  together in one neighborhood visit, preserving the existing independent
  interpolation weights and elevation/material data.
- Sparse-area nearest-site fallback uses an exact spatial-index lookup instead
  of a full scan of every cell. This primarily benefits circular and elliptical
  world edges, including sampling outside the final map mask.
- Adaptive 3D LOD uses a small hysteresis band to prevent repeated mesh changes
  when pinch/zoom gestures hover at a distance threshold. Initial LOD thresholds
  and mesh geometry are unchanged.
- Closing a 3D viewer now cancels and settles an unfinished initial mesh build,
  releasing the worker instead of leaving an unresolved initialization promise.
  A failed close-up worker stops retrying continuously during frame draws.
- Rendering and generation outputs, save format, all 12 stages, checkpoint
  compatibility, relief control, and AppLauncher integration are unchanged.

Use `npm test` and `python3 package.py` to validate this release. Browser-driven
GPU screenshots remain unverified here; real iPhone Safari validation is needed.

## v0.1.29 — Safe startup and recovery

WorldGen now pauses generation and automatic saving when the stored world or checkpoint library cannot be safely loaded. Retry, export the original record or a checkpoint, or explicitly restore a checkpoint/start a replacement world from the recovery screen. Replacement is enabled only after storage can be read and its transaction commits; the existing world is not automatically overwritten on a failed load. See `RELEASE_v0.1.29.md`.

## v0.1.30 — Persistence optimization

Interface-only changes (viewport, display mode, overlays, history selection and expanded-map mode) now use a small separate preferences record rather than rewriting the working world's generated data. Preferences are tied to the saved world's revision; full world saves and recovery replacements clear the prior record atomically. Checkpoint creation/deletion updates checkpoint data and the library index in a single read/write transaction. Automatic saving coalesces changes, skips idle writes, retains failed changes for retry, and reports pending/saving/error states rather than claiming an unfinished write is cached. JSON saves and checkpoints remain self-contained and use the existing schema. See `RELEASE_v0.1.30.md`.

## v0.1.31 — Legacy cleanup

The interactive WebGL2 terrain viewer is the only Render mode, available from layer 4 onward. The retired raster dialog, static terrain PNG generator, worker and styles have been removed. The editor's ordinary **Map PNG** export, 3D relief controls, saved layers, and recovery/persistence behavior remain intact. Shared terrain sampling lives in `terrain-sampler.js`; its interpolation has not changed. Layer 5 no longer displays a random seed or reroll: coastlines are deterministic for the same locked elevation and coastline parameters. Legacy seeds are retained in saved worlds and checkpoints. See `RELEASE_v0.1.31.md`.

## v0.1.32 — Physical elevation

Schema v2 retains its existing encoded elevations: **1 unit = 2.7 km = 2,700 m**, matching the original climate lapse-rate convention. Layer 4 uses provisional zero, layers 5–12 use the selected coastline sea level as the physical datum. Absolute elevation, erosion/deposition thickness, lake depth and surface altitude are shown in metres; crust elevation and minimum lake depth controls accept metres while converting back to the unchanged stored settings. The erosion sediment summary is expressed as an estimated equivalent volume in km³. The shared conversion also defines physical terrain gradients, atmospheric ascent and lake-depth comparisons while preserving the historical empirical calibration. The 3D relief baseline remains visually identical to v0.1.31, explicitly separated from the physical scale: the collapsed control still starts at 1.00×, and its expanded panel displays total exaggeration relative to physical height. Relief never changes simulation or saved data. Existing worlds and checkpoints require no migration. See `RELEASE_v0.1.32.md`.

## v0.1.33 — Geographic resolution independence

New generation uses a fixed 42 km reference distance (1,764 km² reference area) rather than the current average polygon size. Layer 4 propagates signed tectonic pressure by geographic graph distance; layer 5 accepts kilometre-based coastal fade and setback widths, subject to existing world-size caps. Layer 7 integrates preliminary runoff by physical area and scales sediment deposition by travel distance. Layer 8 uses a 252 km maritime reach and distance/ascent-dependent atmospheric moisture transport. Layer 9 uses an absolute catchment threshold (default 7,056 km², plus minimum discharge), layer 10 uses distance-normalized soil gradients, and layers 11–12 use fixed geographic patch scales and a 126 km land-connected riparian reach. The guaranteed boundary-water rule and minimum lake polygon count remain deliberately mesh-dependent. Existing stored parameter keys and numeric encodings are retained; revised settings apply to newly generated results, not historical terrain or water data. Different Voronoi meshes remain approximations, not identical landscapes. See `RELEASE_v0.1.33.md`.

## v0.1.34 — Generation constraints

Extreme world aspect ratios now receive an advisory in layer 1. The layer 2 mesh reports the geographic area that could remain land with the protected boundary rim enabled; layer 5 displays the requested and attainable land coverage, actual generated land area, and any world-size limits on coastline widths. The rim remains mandatory whenever Edge ocean bias is positive. Sea-level selection considers all attainable area-weighted thresholds, including the endpoints, and never splits equal-height groups. Historical worlds remain unchanged. See `RELEASE_v0.1.34.md`.

## v0.1.35 — Coastline preservation

From layer 5 onward, the 3D heightfield preserves the locked Voronoi land/ocean mask by separating land elevations and seabed depths and tapering both to sea level where nearest land and water distances meet. Global and adaptive LODs keep shoreline-crossing triangles at base resolution and stitch adjacent coarse blocks. The focused worker and river-height sampler use the same constraint. This changes only derived render geometry; layer 4 and saved generation data remain unchanged. Fine shoreline placement is still limited by the terrain tessellation. See `RELEASE_v0.1.35.md`.

## v0.1.36 — Lake integration

From layer 9 onward, the shared 3D sampler uses saved lake membership, depths and spill elevations to keep freshwater basins below their surfaces, with smoothly interpolated depths between member sites and tapered banks. Lake surfaces are drawn at their saved elevations, without the previous vertical offset. Global LODs retain detailed basin and bank geometry, and the close-up worker receives the same hydrology source. Existing generation records and the relief setting are unchanged. Lake outlines still depend on the Voronoi geometry and terrain tessellation; river mouth/ribbon integration is a separate follow-up. See `RELEASE_v0.1.36.md`.

## v0.1.37 — River integration

The 3D viewer routes channels through shared Voronoi edges, including lake inlets and outlets, and projects their discharge-scaled ribbons onto the exact terrain triangles. Ocean outlets are clipped at the rendered sea level. Protected LOD blocks and a narrow local refinement mask keep the terrain beneath the ribbons consistent; the remaining terrain can refine normally. Round joins connect tributaries, and the renderer uses depth bias instead of lifting rivers above terrain. Saved layers and relief controls are unchanged. See `RELEASE_v0.1.37.md`.

## v0.1.38 — Adaptive detail budgeting

Close-up terrain requests are selected using the camera frustum, projected screen coverage, relief-adjusted tile bounds and framebuffer dimensions. Tiles use 2×, 4×, 6× or 8× subdivisions, with at most 262,144 requested close-up triangles. The viewer retains the base mesh as a fallback and limits retained detail buffers to 16 MiB of vertex, material and index data. Different subdivision levels share base edge heights and material colors; saved terrain and hydrology are unchanged. Partially clipped boundary tiles remain at base resolution until the next release. See `RELEASE_v0.1.38.md`.

## v0.1.39 — Boundary refinement

Close-up refinement now includes every nonempty boundary tile in circular and elliptical worlds. The detail worker subdivides the original base triangles rather than clipping against a second outline. Heights and material colors taper to the base mesh at boundary edges, preserving the world footprint during zoom and keeping the existing coastline, lake and river constraints. The screen-space triangle and GPU buffer budgets remain unchanged. See `RELEASE_v0.1.39.md`.

## v0.1.40 — Seamless LOD

Global terrain detail and close-up refinement now use 220 ms eased geometric transitions, with shared elevation, normal and material reference textures constructed from the stitched terrain triangles. Local replacements fade through the base shape; retiring patches are retained only when the existing triangle budget permits. Settled uniform views batch the same stitched geometry in a single draw. No terrain generation or saved-world data changes. See `RELEASE_v0.1.40.md`.

## v0.1.41 — Terrain materials

The 3D viewer now uses geographically anchored procedural surface materials for rock, sand, soil, grass, forest, snow and wetlands. A compact normalized RGBA8 coverage field blends the saved climate, soils, biomes and vegetation by stage, while elevation-only views use a height/slope profile. The same field is shared by global and focused meshes; screen-space filtering reduces texture aliasing at distance. Water geometry and generated elevations remain unchanged. See `RELEASE_v0.1.41.md`.
