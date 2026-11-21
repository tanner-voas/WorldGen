# WorldGen v0.1.10 — Biomes and ecological potential

This release adds **layer 11: Biomes** without changing the existing terrain, tectonic, erosion, climate, hydrology or soils calculations.

## Generation

Cells are categorized into 17 possible environment/water classes, including ocean and freshwater, polar ice, tundra, boreal forest, temperate forest, rainforest, grasslands, dry steppe, desert, dry shrubland, tropical forests, savanna, alpine, wetlands and montane forest.

Biome formation depends on temperature seasonality, rainfall relative to expected evaporative demand, topography, groundwater and soil fertility. A deterministic low-frequency variation field can gently vary biome boundaries while preserving the same seeds and inputs on regeneration.

Layer-specific controls (all with slider, direct value, ± buttons, and information popup): temperature offset, precipitation response, forest moisture threshold, wetland groundwater threshold, alpine summer threshold, and regional patch variation. They **do not modify any previously locked layer**.

### Exploration

New map views: **Biomes, Ecological productivity, Tree-cover potential, Drought stress, Thermal growing season, and Biome transitions**. Cell inspection adds biome and ecological estimates. A full named legend identifies every biome. Water cells have no terrestrial productivity, tree-cover or thermal growing season.

Potential is not actual biomass, tree density, wildlife population or ecological succession. The thermal growing season only counts approximate months above 5 °C; it does not imply enough rainfall for plants to grow. Biome edges are Voronoi-resolution approximations, not a high-resolution vegetation model.

## Compatibility and verification

- v0.1.9 workspaces, exports and checkpoints use the same save schema and can advance to layer 11.
- A stage-11 checkpoint contains the complete generated world through layer 11; a stage-10 checkpoint remains self-contained.
- Earlier layer outputs and locked coasts are not regenerated.
- `npm test` and `python3 package.py` cover engine tests and both standalone/launcher packaging.

Apply with `git am WorldGen_v0.1.9_to_v0.1.10_git_am.patch` from an unmodified v0.1.9 checkout, then `npm test && python3 package.py && git push origin main`. Your existing AppLauncher submodule-update action will pick up the new version; no launcher source update is necessary.
