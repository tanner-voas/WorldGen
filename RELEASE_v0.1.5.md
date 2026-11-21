# WorldGen v0.1.5 — Edge Oceans and Launcher Startup Fix

Applies as one `git am` commit on top of WorldGen v0.1.4; no launcher source changes.

## Launcher compatibility

- Fix a startup `ReferenceError: Can't find variable: stored`. The IndexedDB workspace variable was declared inside the storage `try` block but referenced after it. WorldGen can now initialize even when storage is unavailable. Existing local saves and the IndexedDB namespace are unaffected.
- The fix is included in both `dist/worldgen` (AppLauncher) and the standalone PWA output.

## Oceans and coasts (layer 5)

- Add **Edge ocean bias** (0–1.5, default 0.9) and **Edge falloff** (0.5–5 average Voronoi cell widths, default 1.5), with the standard slider, typed value, steppers, and informational popups.
- Use the distance to the actual clipped rectangle/circle/ellipse outline to apply a tapered *subtractive* elevation bias near map edges. The taper is a smoothstep curve and is limited to at most 12% of the shorter world dimension, minimizing inland influence.
- When bias is greater than zero, guarantee that every polygon touching the outer boundary is ocean. Include those cells in the requested geographic water-area share when selecting sea level. In very coarse meshes and extreme land-coverage settings, the edge-water requirement takes priority over the requested percentage.
- Save the resulting **coastal elevation field** separately. Elevation layer 4 remains untouched; layers 6/7 use the coastal field, preserving water classification through landforms and erosion.
- New saved coast fields are optional, so earlier locked worlds are not changed or recomputed. Previously unfinished coastline previews may be regenerated to use the new defaults.

## Verification

- 35 Node engine tests pass, including new tests for every outline shape, area share, inland preservation, edge-bias-off behavior, data immutability, downstream coherence, legacy checkpoints, and invalid imports.
- Standalone and launcher-module packages build.
- A mobile-sized Chromium DOM smoke test (with a simulated computation Worker, because network navigation is blocked in this environment) opened WorldGen, advanced through the first four layers, and displayed the layer-5 edge controls and help popup with no JavaScript errors. This is not a full iOS Safari end-to-end test.

## Install

```bash
git am WorldGen_v0.1.4_to_v0.1.5_git_am.patch
npm test
python3 package.py
git push origin main
```

The existing WorldGen → AppLauncher GitHub Action should advance the launcher submodule automatically after the push.
