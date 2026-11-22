# WorldGen v0.1.41 — Terrain materials

- Replace generic noise with visually distinct procedural rock strata, sand ripples, soil grains, grass, forest crown clusters, snow and wetland surface patterns. Multiscale texture contributions are attenuated using screen-space derivatives.
- Keep materials fixed in horizontal geographic kilometres regardless of relief, camera or mesh resolution. These patterns are visual approximations, not individual trees, new landscape geometry, or new saved generation data.
- Use elevation and slope for stages 4–7, climate for stages 8–9, soil categories at 10, biome types at 11, actual vegetation coverage at 12. Preserve submerged material profiles for ocean and known freshwater cells; retain the existing water shader.
- A single linearly filtered RGBA8 texture array supplies eight normalized coverage channels to every global and focused mesh. It uses at most 257 × 257 × 8 bytes (about 0.504 MiB); early stages use a complete neutral 1 × 1 dummy binding. The worker transfers this field only once, and viewer disposal releases the GPU texture.
- Preserve all stored world data, mesh geometry, coastline/lake/river constraints, existing relief control and LOD budgets. No settings or save schema changes.

Verification: tests cover stage isolation, normalized deterministic texture fields, unchanged terrain and water geometry, worker transfer, texture upload and filtering. Standalone and launcher packages include the new module. The actual shaders compile, link and produce distinct pixels for all eight material profiles in a Mesa OpenGL ES 3.2 software context, with unchanged river pixels when switching material profiles; native WebGL2/Safari behavior and visual quality on iPhone still require device testing.
