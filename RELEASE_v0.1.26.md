# WorldGen v0.1.26

3D terrain quality and close-up exploration refinement. Applies directly to v0.1.25.

- Lower, world-scale-aware vertical relief (no more massive spikes or underwater walls from fixed 0.73 height scaling). A model-elevation unit uses a notional 6 km base relief with approximately 3× cartographic exaggeration; rendering only.
- Compact, smooth interpolation of polygon elevations avoids high-frequency isolated cones at site centres. The locked elevation arrays are untouched.
- Four camera-local refined tiles at most, each resolving the original base grid at **6× higher resolution per axis**, sharing the original coarse border heights and preserving no-gap geometry. A Web Worker computes close-up geometry on demand; eight local tile buffers at most are cached and disposed when zooming back out.
- Close zoom accommodates a polygon occupying at least the full screen; low near-clip plane, local-surface-following camera pan and zoom. Existing Orbit, Pan and Fit workflow unchanged.
- Oceans, river and lake geometry and camera picking follow the revised height conversion.
- All 12 generation stages and historical checkpoints remain unchanged. No AppLauncher update or new render controls.
- Full automated tests and package verification, plus clean `git am` patch verification. Hardware WebGL2 appearance must be verified on iPhone Safari.
