# WorldGen v0.1.28 — optimization, cleanup, and stabilization

Applies directly to v0.1.27 via one `git am` commit.

## Rendering and performance

1. **Persistent close-up worker.** Previous versions cloned the complete world
   mesh every time the camera entered a new tile region. The worker now caches
   an immutable geometry/elevation/material source and accepts small tile-only
   requests. Only one request may be active; newer camera locations supersede
   queued requests, and stale results are ignored. Zooming out terminates the
   worker and releases cached close-up GPU buffers.
2. **Shared neighborhood sampling.** The worker reuses its spatial hash and
   material colors for multiple high-resolution patches. When environmental
   colors are present, one visit computes both continuous elevation and color,
   preserving their distinct weighting functions and exact fallback semantics.
3. **Indexed sparse-boundary fallback.** An exact bucket-ring nearest-site
   lookup replaces whole-world scans near the otherwise-empty corners of
   circular and elliptical maps. Regression tests compare against exhaustive
   scans for deterministic equivalence.
4. **LOD transition stability.** A 12% threshold hysteresis reduces visible
   oscillation between coarse and fine tile meshes during touch zooming without
   changing first-frame LOD selection or existing terrain coverage.

## Reliability

5. **Reliable viewer cancellation.** Closing during initial terrain generation
   settles and rejects its pending promise with `AbortError`, rather than
   leaving the operation suspended after terminating its worker.
6. **Worker failure containment.** A failed close-up build reports an error
   once and does not start a new failing worker every animation frame.

All existing stage generation, imported/saved data, 3D mesh geometry, height
multiplier control, and the standalone/AppLauncher split are preserved.

## Validation

`npm test` (138 tests) and `python3 package.py`, plus clean application of the
single-commit patch to v0.1.27. The browser available in this environment
blocks locally hosted pages and cannot create a WebGL2 context; actual GPU
appearance and mobile performance require iPhone Safari verification.
