# WorldGen v0.1.19 — Elevation 3D viewer

- Built on the user-supplied v0.1.18 repository, preserving its terrain-history and contour work.
- Switched the Render action to an interactive, read-only WebGL2 elevation viewer. Available from stage 4 (Elevation); while viewing later stages it still shows the original stage-4 terrain.
- Removed the render-settings dialog from the active workflow. One stable rendering profile handles the elevation stage; higher-level materials are future work.
- Uses a worker-prepared interpolated height mesh, GPU normal lighting and color gradients, a flat reference ocean at height zero, and automatic LOD index selection at different zoom distances.
- Supports touch orbit, pan, pinch zoom, on-screen zoom buttons and camera reset.
- Restores the original generation view on closing without changing locked layers or checkpoint data.
- Standalone and AppLauncher builds include the worker and all local dependencies automatically.

## Scope and limitations

This initial milestone uses only the locked/ready stage-4 elevation array and does not yet render saved stage-5 coastlines, erosion changes, vegetation, rivers or local detail. Smooth interpolation gives a continuous surface but cannot create geological information absent from the source. Its zero-height water plane is a visualization reference rather than the finalized sea level from the coastline stage. WebGL2 hardware support is required.
