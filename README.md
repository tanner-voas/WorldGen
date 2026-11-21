# WorldGen v0.1.3

A layered, offline-capable map generator. Its codebase supports **two separate distributions**:

- `dist/worldgen/`: app-only module for AppLauncher (no app shell or service worker)
- `dist/standalone/`: independent installable PWA (HTML, manifest, service worker)

`python3 package.py` builds both outputs. `npm test` runs Node unit tests. `npm run serve` runs the standalone build locally at `http://localhost:8766/`.

## Working generation layers

1. **Voronoi geometry** — editable cell count (100–3200), placement, jitter, relaxation and seed.
2. **Tectonic plates** — continental/oceanic plate territories, motion, plate boundaries.
3. **Elevation** — terrain noise, continental elevation and approximate plate-boundary uplift.
4. **Oceans and coastlines** — explicit sea level derived from requested land coverage.
5. **Landforms** — further terrain relief, ridges, valleys, slopes, geological landform classification and volcanic fields. Stage 5 *preserves* stage 4's land/water mask.
6. **Erosion** — graph-based runoff and downhill sediment transfer, plus thermal slope weathering. Controls for rainfall, hydraulic power, thermal weathering, rock resistance, passes, and seed. The locked coast mask remains unchanged.

Stages 7–12 (climate, hydrology, soils, biomes, habitats and local detail) remain non-functional placeholders. The current geology is a procedural approximation, **not** a physical tectonic simulator. It uses a Web Worker, not WebGPU; later stages can introduce higher-resolution terrain fields and GPU computation.

## Exploration and stage history

Touch gestures support drag/pan, pinch zoom, cell inspection, and zoom-to-fit. Version 0.1.2 adds a **cell locator** (enter the cell ID to center and inspect it) and a **two-point distance tool** (tap each endpoint to see world-unit length and X/Y offsets; tap again to start another measurement). Pan/zoom remain available while measuring. The new **Expand map** control opens a full-height exploration view; **Show settings** returns to the generation panel. The floating stage navigator switches between generated layers even while the settings panel is hidden. Display modes include natural, Voronoi geometry, plates, elevation, coastlines, landforms, erosion/deposition, and accumulated runoff. A drainage-channel overlay becomes available at stage 6. The overlay legend is collapsed by default on smaller screens. An Overlays popover allows independently showing the mesh, tectonic boundaries, and coastlines, and provides a map legend. You can export the currently visible map as a PNG.

World position, zoom, overlay visibility, display selection, and exploration mode are persisted between sessions. Generation is deterministic per stage seed; Voronoi generation reports progress from the worker. Changing settings invalidates only the current working layer's preview, not locked predecessors. Revising a locked earlier layer requires confirmation and truncates the active branch; make a named checkpoint first to keep the previous result.

## Saving and migration

**Coastline coverage in new layers is calculated from Voronoi polygon area**, not cell count. Older locked coastlines are not changed, and their area coverage is calculated on display. The stage-4 record retains the old `landFraction` field for compatibility and adds `landAreaFraction` for new worlds. At stage 6, erosion is calculated on the existing Voronoi cell graph, not at terrain-pixel resolution; it is an approximation rather than a full hydraulic simulator.

**Exports are stage-aware:** Export selected layer produces a self-contained world through the currently viewed stage; Export entire world includes all completed/working stages and requires the active preview to finish generating.

All work is automatically cached in a dedicated IndexedDB namespace (`worldgen-v1`). Slider adjustments use a short save debounce to avoid serializing the whole world on every input event. Full save/export includes generated data **and** parameters, not only random seeds. Named checkpoints are stored as independent records with a small index, rather than rewriting every historical checkpoint whenever a new one is saved.

**Saving while viewing layer N produces a complete checkpoint through layer N**, including all locked layers through N and, where applicable, a generated working preview at N. It does not inadvertently include later stages. Each checkpoint may be restored or independently exported to JSON. When the selected working layer is still regenerating or has stale preview data, saving that working layer is blocked until it finishes. You can still save an earlier locked layer.

Existing v0.1.0 state and checkpoint arrays migrate to the new representation on first load, without changing the older locked layers. In particular, old worlds ending at layers 4 or 5 are given default settings for the next available stage. A stage-5-complete v0.1.2 world opens at the editable stage 6 without regenerating earlier data. Schema remains 1. Export a downloadable backup periodically; mobile browsers may evict local site data.

## AppLauncher contract

The module entrypoint is `./app.js` and the style entrypoint is `./styles.css` within the distributed app directory. It only renders into the host's `#app` element. If `globalThis.__APP_LAUNCHER__` exists, Home calls `returnToLauncher()` after persisting; otherwise it opens the world library. Source imports and Web Worker URLs are relative to the app module and work under either deployment path.

`package.py` deliberately does not place a manifest or SW in `dist/worldgen`; the launcher owns the installed PWA shell, updates and offline precache. WorldGen's storage namespace is distinct from Ciyan's.

## Updating the existing GitHub repository

Apply the v0.1.1, v0.1.2 and v0.1.3 `git am` patches sequentially to the existing v0.1.0 WorldGen repository. If `origin` is not already configured in the extracted folder, run `git remote add origin https://github.com/tanner-voas/WorldGen.git`. Then:

```bash
git push -u origin main
```

The existing `notify-launcher.yml` workflow dispatches the new commit to AppLauncher, whose `update-worldgen.yml` workflow advances the submodule and triggers its normal deployment. Ensure `APP_LAUNCHER_DISPATCH_TOKEN` remains configured in WorldGen's GitHub Actions secrets. Alternatively, use the provided AppLauncher archive containing this exact pinned WorldGen commit after pushing WorldGen first.

## Implementation notes

This first version uses a *bounded planar 2:1 world* (2048 × 1024 units). Spherical planet topology, tiled sub-cell refinement, complete physical tectonics, erosion, climate, hydrology, GPU compute, 3D terrain, societal simulation and fauna are future work. Data is versioned at schema 1, so later migrations can preserve prior exports. Branching currently means saving a complete checkpoint then revising an earlier layer; it does not yet provide a visual branch graph. A Save operation now refuses to silently select the preceding layer when a newer working preview has not been generated.
