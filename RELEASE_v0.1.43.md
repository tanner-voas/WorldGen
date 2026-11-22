# WorldGen v0.1.43 — Camera and exploration

- Fit uses the entire conservative world bound, vertical relief and both perspective axes; it stays active during viewport resizing until navigation begins. The far clip plane adjusts for large fitted scenes.
- The double-tap/click picker intersects actual submitted triangle index ranges, accounting for global and local geomorphs, relief, clipping, and ocean, lake and river surfaces. It uses the last rendered camera rather than an approximate ray march on the base grid. Refined vertex/index arrays are retained in CPU memory while their corresponding GPU buffers are cached; no GPU readback or extra GPU buffers are required.
- Close-up camera tracking uses triangle heights and local lake surfaces. Clearance checks grid intersections and bounded intermediate samples to raise the eye over terrain between it and the target. This is a terrain-aware guard for close exploration, not a full collision solver; separate water boundaries and differences between coarse and base surfaces can still create edge cases.
- Touch and wheel zoom anchor to a projected horizontal plane where possible; pan scales with viewport perspective. Pinch begins from the second pointer-down; cancellation and lost capture clear gesture state. Small touch jitter no longer orbits the camera during a tap.
- No generation, save format, rendering-material, relief-control or AppLauncher changes.

Verification: `npm test`, `python3 package.py`, optional `python3 tests/shader-smoke.py`, clean `git am` round trip. Native iPhone Safari interactions and performance require device verification.
