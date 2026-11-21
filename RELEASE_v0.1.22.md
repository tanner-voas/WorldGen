# WorldGen v0.1.22

## Environmental materials in the 3D viewer

- Stages 8–9: climate-informed color from saved temperature and moisture, with rivers/lakes continuing at stage 9.
- Stage 10: blends soil type and fertility.
- Stage 11: adds physically motivated biome palette and tree-cover potential.
- Stage 12: adds vegetation canopy and ground cover, without simulating individual trees.
- Material color fields are interpolated smoothly from Voronoi sites onto the triangulated terrain; there are no new simulation layers or settings.
- Early stages 4–7 keep their original elevation colors.
- New worker-transfer RGB buffer is created only when environmental information is available, reducing unnecessary allocation for early stages.
- All rendering remains read-only, preserving complete checkpoints, saved elevations, sea levels and hydrology.

## Limitations

These are continuous colors driven by the current polygon-scale data, not high-resolution terrain textures or object-level vegetation geometry. Detailed local features remain a future subgrid feature.
