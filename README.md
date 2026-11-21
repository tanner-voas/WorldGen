# WorldGen v0.1.0

A layered, offline-capable map generator. Its codebase supports **two separate distributions**:

- `dist/worldgen/`: app-only module for AppLauncher (no app shell or service worker)
- `dist/standalone/`: independent installable PWA (HTML, manifest, service worker)

`python3 package.py` builds both outputs. `npm test` runs Node unit tests. `npm run serve` runs the standalone build locally at `http://localhost:8766/`.

## Scope of v0.1.0

Working generation stages: (1) Voronoi geometry with adjustable cell count, distribution, jitter, and Lloyd relaxation, (2) tectonic plates, (3) elevation with broad terrain noise and plate-boundary uplift, (4) sea-level and coastlines. Stages 5–12 appear as clearly unavailable placeholders. v0.1.0 terrain/geology is deliberately simplified: it is **not** a physical tectonic simulator and is **not yet GPU accelerated**; intensive work runs in a Web Worker to keep the interface responsive.

The map supports drag, pinch zoom, mouse wheel, fit-to-screen, selectable map modes, a mesh overlay, cell inspection, and viewing earlier locked layers. Generation and viewport rendering are independent. Settings trigger regeneration of only the current stage; a layer must be locked before the next one becomes editable. Revising an earlier stage requires explicit confirmation and removes later stages from the working branch.

State auto-saves to IndexedDB under `worldgen-v1`. Named checkpoints contain complete states through all locked layers **and any generated working layer** (for example, saving a layer-4 preview includes layers 1–4 even before locking layer 4). Export/import uses standalone, human-readable JSON **including all generated geometry and field data**, not just seeds. Export is strongly recommended for external backups because browser data can be evicted. No external services or accounts are required.

## AppLauncher contract

The module entrypoint is `./app.js` and the style entrypoint is `./styles.css` within the distributed app directory. It only renders into the host's `#app` element. If `globalThis.__APP_LAUNCHER__` exists, Home calls `returnToLauncher()` after persisting; otherwise it opens the world library. Source imports and Web Worker URLs are relative to the app module and work under either deployment path.

`package.py` deliberately does not place a manifest or SW in `dist/worldgen`; the launcher owns the installed PWA shell, updates and offline precache. WorldGen's storage namespace is distinct from Ciyan's.

## New repository setup

1. Create an **empty** GitHub repository `tanner-voas/WorldGen`, with no generated README or `.gitignore`.
2. Extract the provided WorldGen repository archive (it contains `.git` with `main` already committed).
3. Add the GitHub remote if not already present and push `main`:

   ```bash
   git remote add origin https://github.com/tanner-voas/WorldGen.git
   git push -u origin main
   ```

4. In the WorldGen repository, create an Actions secret `APP_LAUNCHER_DISPATCH_TOKEN`: a fine-grained PAT authorized for `tanner-voas/AppLauncher` with **Contents: Read and write** (and access to its repository). This token is needed for the WorldGen -> AppLauncher dispatch. If the first push occurred before adding the secret, use WorldGen **Actions -> Notify AppLauncher of WorldGen update -> Run workflow**.
5. Push the separately supplied AppLauncher v0.1.3 update, **after** the WorldGen repository exists and its initial `main` commit is available. The launcher references WorldGen as a real Git submodule, not a copied app directory.
6. Confirm the launcher GitHub Action `update-worldgen.yml` responds to the dispatch and the Cloudflare deployment completes. The launcher should show WorldGen v0.1.0 as an enabled tile. Its standalone site is optional and can be deployed from `dist/standalone` when desired.

GitHub doesn't accept the dispatch secret from a file: configure it in the GitHub repository settings. Do not add any credentials to either archive.

## Implementation notes

This first version uses a *bounded planar 2:1 world* (2048 × 1024 units). Spherical planet topology, tiled sub-cell refinement, complete physical tectonics, erosion, climate, hydrology, GPU compute, 3D terrain, societal simulation and fauna are future work. Data is versioned at schema 1, so later migrations can preserve prior exports. Branching currently means saving a complete checkpoint then revising an earlier layer; it does not yet provide a visual branch graph.
