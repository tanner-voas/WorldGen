# WorldGen v0.2.0 — Manual revision: shared mobile controls

First stage-by-stage manual UX revision on top of v0.1.45. No map-generation algorithms or AppLauncher integrations were changed.

- All twelve layer settings pages use **one parameter per row** at mobile and desktop sizes; sliders, numeric steppers, and inline help share the full available width. Seed configuration uses its own row.
- Drag the grabber on the generation drawer **up or down** to resize it. Tap it to collapse/expand as before. Height persists as a viewport ratio, with bounds that keep the map and pipeline usable even on small displays; the map recenters smoothly while resizing.
- Button text wraps within its container, with flexible controls and sufficient touch targets; reset and regenerate have balanced widths.
- **Lock / Unlock layer** is an independent button on the map, outside the drawer, accessible even when settings are collapsed. Unlocking requires no confirmation. A historical unlock automatically checkpoints the current branch before removing later locked stages; if checkpointing fails, the unlock is refused to prevent silent data loss.
- Map display modes and overlay choices that are not yet meaningful for the selected generated stage are omitted, not merely disabled. At layer 1, the entire display chooser is hidden. Overlay choices become available with the Voronoi mesh (2), plates (3), coastlines (5), and drainage (7).

The new `consoleHeightRatio` field is optional metadata in persisted worlds and upgrades cleanly from older saves. The existing generation and checkpoint schema remains compatible.

Verification: `node --test tests/*.test.js`, node syntax checks, and the standalone/launcher builds. Native iOS Safari interaction should be checked on-device.
