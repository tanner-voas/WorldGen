# WorldGen v0.1.11 — Vegetation and habitats

One `git am` commit on top of v0.1.10. No AppLauncher code change required.

## Generation layer 12

- Computes realized canopy cover, understory/ground cover, approximate standing biomass index, vegetation height, habitat complexity and riparian proximity on the original Voronoi mesh.
- Distinguishes 13 landscape and habitat classes (ocean, freshwater, bare/ice, tundra, grassland, shrub, woodland, forest, wet forest, wetland, river corridor, alpine meadow and desert scrub).
- Controls: vegetation density, landscape maturity, disturbance pressure, riparian boost, and spatial patchiness. Every control offers slider, numerical entry, ± stepper and help.
- Provides independent map views and per-cell inspection without modifying biomes, soil, climate, hydrology or any earlier locked layer. Riparian boosts follow graph connectivity up to three neighboring cells away, rather than creating unconnected green patches.

## Compatibility

- Previous saves/checkpoints remain loadable, including stage-11 worlds waiting at stage 12. No schema change.
- Stage-12 checkpoints are complete and portable.
- The cell inspector is now scrollable and height-constrained on small screens so detailed environmental readings do not cover the entire map.
- New input-validation tests reject truncated or malformed vegetation fields, wrong water assignments and forged statistics.

## Scope and limitations

The layer is an *instantaneous deterministic approximation*, not a temporal vegetation or ecological simulation. Biomass is relative, not physical tonnes or carbon mass. All detail is limited to the existing Voronoi cells.

## Deployment

From WorldGen v0.1.10:

```bash
git am WorldGen_v0.1.10_to_v0.1.11_git_am.patch
npm test
python3 package.py
git push origin main
```
