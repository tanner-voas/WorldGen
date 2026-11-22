# WorldGen v0.2.5 — Guided generation and editable 3D relief

## What changed

- All implemented generation layers (1–13) now have a **Starting preset** dropdown at the top of the editable settings panel. Each preset describes the type of world it produces. Choosing one replaces that layer's parameters while keeping the existing random seed; every parameter is still editable afterward. Manually adjusting a parameter identifies the result as **Custom settings**.
- Presets scale with the locked world geometry where appropriate. Voronoi preset densities target a cell **count** rather than a fixed cell area; tectonic plate counts, uplift reach, coastline adjustment widths and river thresholds adapt to world size. Caps in the engine still apply. Other presets use meaningful dimensionless or physically fixed ranges as appropriate.
- Stages 7–13 now initially show the preset and a brief list of map views where the changes are visible, with the full advanced controls under **Fine-tune parameters**. The expansion remains open while adjusting settings or regenerating and can be reopened at any time.
- The erosion-stage control formerly called "Approx. rainfall" is now labelled **Erosion water input** to distinguish its immediately visible erosion effects from the actual annual precipitation computed in the later climate stage. The algorithms and established stage boundaries are unchanged.
- 3D terrain's **Vertical relief** multiplier is directly editable as a number from 0.01× to 1,000×. It uses the same display-only GPU height exaggeration as the existing ±5% buttons and does not rewrite any world data. The selected multiplier is remembered in the current browser session, including across modal closures and generation-layer changes.

## Testing

- Full automated suite includes tests for every preset, world-size-dependent settings, three contrasting end-to-end worlds, stage 7–13 data sensitivity and typed/session-persistent relief.
- `tests/browser-smoke.py` uses real Chromium DOM, CSS, canvas, and input interactions to step through all 13 layers and presets, including the 3D relief control. Because this execution environment forbids browser navigation to file, localhost or HTTPS pages, it loads the source ES modules in-memory with test-only asynchronous IndexedDB and Worker bridges. This is **not** a replacement for a live deployed PWA check on iPhone or true GPU/WebGL2 rendering.
- Standalone and AppLauncher distributions continue to use the same common source. No AppLauncher changes or old-format world migrations.

## Developer usage

```bash
npm test
npm run build
python3 tests/browser-smoke.py  # Optional: requires Python Playwright and Chromium
```

Apply the single commit patch directly after v0.2.4 using `git am`.
