# WorldGen v0.1.32 — Physical elevation

## Changes

- Introduce a shared physical elevation convention (`src/elevation-units.js`): one existing elevation unit represents 2.7 km or 2,700 m. This adopts the climate model's established scale, rather than changing climates or redefining existing saved values.
- Use the conversion in terrain classification, physical downhill gradients, erosion/weathering, climate lapse rate and orographic ascent, hydrology basin-depth thresholds, soil relief/deposition indices and alpine eligibility. Existing empirical coefficients are recalibrated algebraically, not replaced with a new erosion or climate model.
- Present crust elevation and minimum lake depth controls in metres, including slider range, stepper increments, typed input, and help. Defaults, bounds and values in exports retain their legacy encoding (e.g. a saved lake depth threshold of 0.008 displays as 21.6 m).
- Show cell elevation relative to provisional zero at layer 4 and to the saved sea datum from layer 5. Inspect erosion depth, deposited depth, lake depth and lake surface elevation in metres. The erosion summary includes the converted estimated sediment volume in km³.
- Explicitly distinguish the physical scene scale from the visualization scale. One horizontal scene unit and one unexaggerated vertical scene unit represent the same length. Preserve the established bounded visual baseline (`clamp(worldScale * 18, .004, .24)`) and apply the existing 5% debounced relief control only to the display scale. The expanded relief panel now reports the total physical exaggeration, including the baseline. No simulation uses this exaggeration.

## Compatibility and units

Save schema 2 and all locked fields remain unchanged. `elevations`, `seaLevel`, `spillElevation` and `lakeLevel` are encoded heights; `erosionDepth`, `deposition`, `lakeDepth`, and `lakes[].maxDepth` are encoded thicknesses. To obtain an altitude in metres, subtract the applicable encoded datum and multiply by 2,700. For a thickness multiply by 2,700 without subtracting a datum. `summary.exportedSediment` remains encoded thickness × km²; multiply by 2.7 for the estimated volume in km³. Hydrology discharge remains km³/year and soil depths remain metres; neither is rescaled. Crust and lake settings remain encoded in JSON, including historical checkpoints. No regeneration or migration is required.

This standardizes units, not physical fidelity: the existing generator is an empirical Voronoi-scale approximation and resolution-dependent algorithms will be addressed in v0.1.33. Coastline preservation and water/terrain integration remain later roadmap items.

## Verification

- Six new regression tests for conversion, parameter round trips, physical versus visual scaling, climate lapse rate, physical lake thresholds, and saved-world/mesh compatibility.
- Compared v0.1.31 and v0.1.32 directly: all 12 stage outputs match exactly for nine worlds (all three shapes, 100/1,200/5,000 target cells). For the three 1,200-cell worlds all 27 supported 3D stage meshes match exactly apart from added physical-scale metadata.
- All 163 automated tests and both distribution builds pass. Native Safari interaction and WebGL appearance remain unverified.
