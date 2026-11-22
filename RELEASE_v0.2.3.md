# WorldGen v0.2.3 — Signed elevation and separate oceans/coastlines

- Layer 3 saves plate territories and their seed only, with no motion, crust classification, elevation or water.
- Layer 4 generates a continuous signed altitude map with fault-line convergence/divergence and relief parameters. Red represents altitude above zero, white zero, and blue below zero.
- Layer 5 applies a global elevation offset and marks all cells at or below zero as water. No target land-percentage algorithm remains.
- Layer 6 independently reshapes coastline relief and flood boundaries without rewriting Layer 4 or Layer 5. All later stages move up one stage number, yielding 13 implemented layers.
- When the mesh overlay is off outside the Voronoi layer, polygon edge strokes match their fill to prevent mesh line artifacts. Other overlays remain independently selectable.
- Mobile map navigation stays on the right-hand rail whenever its controls fit (at least 260 CSS pixels of map height), moving to a separate compact row only for shorter maps.
- No pre-v1.0 save migration or compatibility code. Older JSON saves fail validation, and a separate development IndexedDB namespace starts this incompatible pipeline cleanly; old browser storage is not read or destroyed.

### Build

`npm test` and `npm run build` validate the sources. `python3 package.py` creates both the standalone PWA and the AppLauncher module; no AppLauncher changes are needed.
