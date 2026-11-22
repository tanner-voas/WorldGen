# WorldGen v0.1.40 — Seamless LOD

- Global LOD changes use a 220 ms smoothstep geomorph via worker-prepared reference textures. A transition draws the base grid once per affected tile, interpolating between the previous and desired indexed geometry. Reversals retrace the original transition; other requests finish the current transition first.
- The same references blend local detail in and out through the base triangulation. A visible patch awaiting replacement fades out before its new worker request. Retiring patches only remain visible if the existing close-up triangle budget can accommodate them; otherwise they are dropped immediately. Higher-detail transitions cannot force a budget overrun.
- All global LODs retain shared tile-edge vertices and protected shoreline, lake and river triangles. Normal and material fields are blended as well as elevations. Water draws use the unchanged non-morphing shader path, and relief remains a separate height multiplier.
- Batched global draws now use the same stitched index buffers as mixed-detail views, eliminating a separate topology switch. During global transitions, affected tiles temporarily draw at base resolution. Reference textures add bounded memory (up to approximately 12.6 MiB of RGBA32F data for two 321×321×4 arrays; the material array is omitted at elevation-only stages), and are released with the viewer. Uniform index GPU buffers are no longer duplicated in the morphing path.
- Coarse fan triangulations are not a strictly nested subdivision of the base mesh. Projecting them onto base-grid vertices reduces surface displacement but may leave small residual differences at the final topology switch. Exact seamless visual performance, shader appearance and device frame rates require Safari testing. The browser GPU process in this environment failed to initialize.
- Generation, save schema, checkpoints, controls and AppLauncher compatibility are unchanged.

## Verification

209 automated tests, including six new regressions covering reference projection, fixed boundaries and protected blocks, transition reversal, close-up activation/replacement, triangle-budget enforcement and shader wiring. Standalone and launcher builds, offline cache and clean patch application checked.
