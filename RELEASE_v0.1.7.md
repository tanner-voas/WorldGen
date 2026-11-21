# WorldGen v0.1.7 — Climate-driven Hydrology

One `git am` commit against WorldGen v0.1.6. AppLauncher and Ciyan do not need changes. Both standalone and launcher module are packaged from the same sources.

## Layer 9: Hydrology

- Fully functional layer, following the eight existing locked stages. The engine uses a priority-flood drainage algorithm to resolve local depressions and construct connected, acyclic downstream routes. Ocean outlets anchor the graph. Imported hydrology routes are checked for invalid neighbors and cycles.
- Annual surface runoff is calculated from saved climate precipitation and mean temperatures, adjusted by runoff multiplier, ground infiltration, evaporation, and a deterministic small local variation. Accumulation and upstream catchment area are recorded per cell. Annual discharge uses **km³/year**; precipitation is mm/year and geographic cell areas are km².
- River-channel visibility is adjustable via a catchment threshold (multiples of average Voronoi cell area), with an additional runoff minimum that discourages channels in dry basins. The default is tuned for mobile-scale meshes; much finer river morphology will require later spatial subdivision.
- Topographic lakes are identified in filled depressions with user-set minimum depth and contiguous cell count. A moisture/runoff gate suppresses dry-basin lakes. This is a spill-level approximation, not a time-evolving water balance or detailed basin bathymetry; some maps naturally have few or no lakes.
- New map modes: **Rivers and lakes**, **Upstream area**, and **Drainage basins**. Rivers are drawn on the map and individual cells report upstream catchment, annual discharge, downstream connection, and lake details. Mode selection is stage-aware: earlier historical stages never reveal future rivers.

## Settings and compatibility

- Six adjustable hydrology parameters (each with slider, numerical entry, ± buttons, contextual information) plus deterministic seed.
- Save schema remains v2 and IndexedDB namespace remains `worldgen-v1`. Worlds and named checkpoints through v0.1.6 remain valid; a completed climate world now opens on editable stage 9 with defaults filled in. Complete stage-9 checkpoint exports include all actual numeric hydrology arrays plus the first eight layers.
- Layers 1–8 are never regenerated or rewritten automatically. Climate uses the previously locked erosion; hydrology is downstream of both.

## Verification

- Node regression suite plus hydrology-specific deterministic, routing, conservation, lake, malformed-import, migration, and snapshot tests.
- Both distributions created using `python3 package.py`; expected use is iPhone AppLauncher, with separate standalone PWA support.

## Apply

```bash
git am WorldGen_v0.1.6_to_v0.1.7_git_am.patch
npm test
python3 package.py
git push origin main
```
