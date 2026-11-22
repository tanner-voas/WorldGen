# WorldGen v0.2.2 — Map toolbar layout and geological ownership

Applies as a single `git am` commit on **v0.2.1**. No AppLauncher changes.

## Map controls when settings are open

On phone-sized screens, the display palette and Overlays control occupy the first row; the five map tool buttons occupy a separate second row. The overlay menu opens *below* both rows, using a scrollable maximum height that adapts to the remaining map space. The rows remain separated even when the generation drawer is enlarged or reduced. On wider screens, the normal right-hand vertical map controls remain, with the short-map horizontal fallback.

The existing drawer resizing, map-scale readout, closed-drawer three-button row, and stage-level Lock/Unlock workflow are preserved.

## Stage 3 — tectonic plates

Stage 3 now locks plate territory centers, IDs, and cell ownership **only**. The controls here are plate count and seed. Plate coloring is by territory identity and no longer misleadingly previews a crust type that has not yet been assigned. Plate-boundary overlays remain available.

## Stage 4 — elevation

Continental crust ratio and plate motion have moved from Stage 3 to Stage 4, alongside uplift strength, surface roughness, crust elevation and seed. This is a generation dependency change, not merely hiding controls: Stage 4 assigns deterministic geological properties to the previously locked territories and stores them in the elevation layer. Changing continental ratio or plate motion now updates the visible elevation while preserving the exact Stage 3 plate boundaries.

Stages 6 and 10 (landforms and soils) consume the properties locked in Stage 4. Other stages and generation settings are unchanged.

## Existing worlds and checkpoints

- Historical Stage 3 records from v0.2.1 with crust and motion fields remain valid and unmodified.
- When opening an unfinished Stage 4, the prior Stage 3 continental ratio and motion settings are inherited, reproducing the prior elevation calculation for equivalent inputs.
- Locked historical Stage 4 data is **never regenerated or rewritten** during import or upgrade. Existing later layers continue to read historical plate properties until that history is explicitly unlocked and regenerated.
- New Stage 3 saves contain only plate territory geometry and ownership, and new Stage 4 saves contain the actual geological properties.
- Schema version remains 2; validation understands both legacy and new records and rejects inconsistent mixed records.

## Validation

The automated suite exercises separate stage ownership, fixed plate borders across changing geology, deterministic elevation, legacy upgrade and checkpoint settings, new/legacy landform compatibility, and tampering detection. The responsive map toolbar was checked in headless Chromium mock layouts at 320, 390, 430 and 768 CSS-pixel widths with multiple drawer heights. Native iOS Safari behavior remains to be verified on-device.
