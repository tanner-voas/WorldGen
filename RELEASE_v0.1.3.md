# WorldGen v0.1.3 — Erosion and exploration refinement

This is **one `git am` commit** on top of WorldGen v0.1.2. The current AppLauncher integration is unchanged; no launcher or Ciyan changes are required.

## Stage 6: Erosion

- Added an editable and lockable **Erosion** stage based on the stage-5 landforms and the stage-4 sea boundary.
- Parameters: approximate precipitation, hydraulic erosion, thermal weathering, rock resistance, erosion passes, and a deterministic seed.
- A coarse runoff network routes water downhill between Voronoi cells; sediment can erode, deposit, or exit to the ocean. Thermal weathering smooths steep adjacent land cells.
- Stores stage-6 elevations, erosion depth, deposition, downhill cell connections, drainage accumulation, main channel cells, and summary statistics in the complete save file.
- **Locked coastline and predecessor layers are never rewritten.** All layer-4 water cells retain stage-5 elevations; all land cells remain above the locked sea level.
- This is a **mesh-level procedural approximation**, not a full fine-resolution physics simulation. Subsequent climate and hydrology stages remain separate work.

## Explorer and stability

- Added two visualization modes: **Erosion / deposition** and **Drainage flow**, plus a toggle for preliminary downhill channel paths.
- Stage-6 cell inspection includes removed/deposited depth and local runoff. Earlier stages remain viewable without exposing future data.
- Collapsed the large legend inside the overlay popover to preserve map visibility on portrait phones.
- When the currently selected working stage has no generated preview, the map navigator identifies the *last ready* layer rather than claiming the incomplete stage is being rendered.
- Checkpoint creation no longer silently saves the previous stage when a newly selected working layer has no preview. It asks the user to wait or select an earlier layer deliberately.
- Expanded import validation to reject malformed erosion arrays and invalid drainage links.

## Compatibility and verification

- Schema stays at `1`; local IndexedDB database name stays `worldgen-v1`. Existing v0.1.0/v0.1.1/v0.1.2 checkpoints remain readable. Older v0.1.2 worlds with five locked layers upgrade into editable layer 6 without changing the first five layers.
- `python3 package.py` still builds both `dist/worldgen` (launcher) and `dist/standalone` (independent PWA).
- `npm test` includes deterministic erosion, coastline conservation, backward compatibility, and corrupted import tests.
- Chromium DOM-only mobile smoke checks are possible with an in-page mock Worker because network navigation to the local test server is restricted in this environment. This is **not** a substitute for a full real-Worker iPhone end-to-end test.
