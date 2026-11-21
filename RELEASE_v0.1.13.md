# WorldGen v0.1.13 — launcher startup fix

## Fixed

The v0.1.12 render feature introduced `src/render.js`, but `package.py`
continued copying a fixed list of modules. As a result, the launcher deployed
`app.js` without the `render.js` it imports. On Safari, opening WorldGen failed
with **"Importing a module script failed."**

v0.1.13 packages all JavaScript and CSS source modules automatically,
validates relative module imports before deployment, and includes newly added
modules in both the launcher distribution and the standalone service worker
precache. Regression tests verify the actual distributions and missing-import
failure behavior. The render feature and all twelve generation layers are
unchanged.

## Deployment

Apply the v0.1.12 → v0.1.13 Git AM patch, run `npm test` and
`python3 package.py`, then push `main`. The existing AppLauncher update
workflow should advance its WorldGen submodule. Refresh the installed PWA
using the launcher's update control if it is holding old cached resources.
