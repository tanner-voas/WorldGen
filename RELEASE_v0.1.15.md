# WorldGen v0.1.15

## Critical fix

Corrected the world-boundary argument order in the raster sample loop. v0.1.14 rendered all terrain pixels as outside its world, leaving a dark canvas with river overlays. This is a render-only fix and does not regenerate any saved layers.

## Improvements

- Geometry API regression tests for rectangular, circular and elliptical raster masks.
- Subcell texture in terrain color, coastal contours and relief, with smooth river spline paths.
- Bounded CPU sample budget for large render exports and stable output dimensions.
- Expanded in-app render viewer, pinch zoom, anchor-relative wheel zoom and pan controls.
- Cancellation when closing the render dialog; no changes to the checkpoint/save format.

## Verification

Run `npm test` and `python3 package.py`. Rendering was also smoke-tested in a mobile-sized Chromium environment using a simulated computation Worker. Physical iPhone Safari still needs validation.
