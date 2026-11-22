# WorldGen v0.2.4 — Fix AppLauncher and standalone startup

- Fix a `ReferenceError: Can't find variable: header` during initial UI layout. The drawer-height bounds now pass the measured header height to `applyConsoleHeight()` before computing the map height and toolbar layout.
- Add regression coverage that actually executes the drawer layout calculations with open and collapsed settings on tall and compact viewports, including a larger safe-area header.
- Update the application version and standalone document title to v0.2.4.
- Keep the v0.2.3 development storage namespace unchanged (`worldgen-dev-023`) so worlds created in v0.2.3 stay available. No legacy-save migrations are added.

No AppLauncher code changes are required. Apply this commit on top of WorldGen v0.2.3.
