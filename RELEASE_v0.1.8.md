# WorldGen v0.1.8 — Soils and surface conditions

Single `git am` commit against WorldGen v0.1.7. No AppLauncher changes are needed.

## Layer 10 — Soils

- A deterministic, first-pass soil model uses locked plate crust, landform types, terrain ruggedness, erosion and deposition, seasonal climate, annual precipitation, soil wetness, and hydrological catchments.
- Every Voronoi cell receives a soil type, estimated regolith depth (meters), relative organic matter, relative permeability, fertility potential, shallow groundwater recharge potential, and future erosion susceptibility. Ocean and lake cells are masked out.
- Soil categories: open water, exposed rock, thin upland, coarse/sandy, loam, clay-rich, organic wetland, volcanic, arid mineral, and cold/tundra.
- Editable controls: mineral weathering, organic accumulation, alluvial deposition, permeability factor, groundwater recharge potential and random seed, with the existing slider/number/±/help pattern.
- Explore six new maps: soil type, depth, fertility, permeability, groundwater and erosion susceptibility. Cell inspector shows the new fields. Rivers remain available as an overlay.
- The estimates are environmental potentials, not a full geochemical, plant growth, or groundwater flow simulation. No biological or human settlement processes are modeled yet.

## Compatibility and safety

- Existing v0.1.0–v0.1.7 worlds and checkpoints retain all their earlier layers, shapes, coastlines, climate and hydrology. Upgrading a finished layer-9 save simply makes layer 10 available to generate.
- Locking and saving layer 10 includes all 10 layers. Validate imported soils for missing/malformed arrays, bad numeric ranges, classifications on water, and inconsistent summaries.
- Original `worldgen-v1` browser database is retained for in-place upgrades. Export checkpoints to keep portable backups outside the browser.

## Testing

- `npm test`: 54 passing tests (including five added soil tests).
- `python3 package.py`: both standalone and launcher builds.
- Mobile-sized Chromium interface test with a simulated compute worker: reached and displayed soil generation, new views, editable controls and help sheet without page errors. Real iPhone Safari/worker performance still requires device validation.

## Installation

```bash
git am WorldGen_v0.1.7_to_v0.1.8_git_am.patch
npm test
python3 package.py
git push origin main
```
