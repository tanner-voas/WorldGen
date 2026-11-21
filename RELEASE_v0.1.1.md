# WorldGen v0.1.1 release notes

- Introduces stage 5, **Landforms**, with ridge/detail/valley/volcanic settings, generated classifications, and additional relief data. Locked stage-4 coastlines are left unchanged.
- Adds full-height Explore mode and floating previous/next layer navigation while exploring.
- Adds independently selectable tectonic plate borders, coastlines, mesh outlines, and a map-mode legend.
- Adds PNG export of the currently visible map and a more detailed cell inspector.
- Remembers map zoom/center and viewing preferences after reloading.
- Saves complete checkpoints of the **selected stage**, not necessarily the latest generated stage; exporting a checkpoint is available in the library.
- Stores checkpoint data separately from the library index, with migration of older v0.1.0 checkpoint arrays.
- Debounces automatic persistence while adjusting settings; keeps explicit flush on completed generations and when navigating Home.
- Reports progress for Voronoi generation and cancels replaced worker jobs cleanly.
- Migrates v0.1.0 stage-5 placeholders to new defaults without modifying locked data.
- Validates loaded world geometry and layer arrays more defensively.
- Stays standalone and AppLauncher compatible; no AppLauncher source or Ciyan changes needed.

**Still planned:** spatially selective terrain detail, physical erosion, climate, hydrology, biomes, GPU compute, spherical topology, and automated browser coverage on real iOS/Safari.
