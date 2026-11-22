# WorldGen v0.2.1 — Voronoi controls and compact map workflow

Applies on top of **v0.2.0**. AppLauncher is unchanged; standalone and launcher outputs continue to be supported.

## Map and panel workflow

The bottom of the map now uses one row with a native layer dropdown, Lock/Unlock, and Settings. When the settings panel is open this row disappears: layer selection remains available in the existing pipeline chips and Lock/Unlock appears in the stage header instead. The map scale remains visible. Dragging the panel handle down beyond the minimum height closes the panel; tapping the handle can also toggle it. The Settings button restores the panel.

On layer 2 there is no redundant Natural/Cell geometry palette choice, but the Voronoi mesh overlay remains. The Map legend is removed. Map utility buttons keep a right-hand lane when vertical, and use a distinct second row on very short map viewports without running into the palette and overlay controls.

Random-seed help uses the standard round `i` icon; reroll is an icon-only button in a full-width field row. Settings remain single-column, and the existing layer/history semantics are unchanged.

## Voronoi generation

- Default site placement is **Blue-noise random** for newly created layer-2 settings. Older saved settings and locked meshes are not overwritten.
- Position jitter is only exposed for **Even / jittered** mode, and affects only that mode. Clustered placement retains a fixed baseline perturbation.
- Maximum cells increased from **5,000 to 20,000**. The UI slider, generator, saved-data bounds, and upgrade normalization share the same maximum.
- Lloyd relaxation maximum increased from **3 to 8** in UI, generation and upgrade normalization.

20,000-cell meshes were benchmarked in Node.js on a desktop environment with blue-noise placement: approximately 0.9 seconds at 0 relaxation passes and 6.6 seconds at 8 passes. Results can vary significantly on iPhone and with world geometry; 20,000 is an optional high-resolution ceiling rather than a performance guarantee.

## Validation

The test suite covers 20,000-cell saved-world validation and updated interface/engine limits. Legacy visual test fixtures explicitly retain their old even/jittered distribution so changing the default does not silently alter their baseline.
