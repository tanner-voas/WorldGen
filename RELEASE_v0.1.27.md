# WorldGen v0.1.27 — adjustable 3D vertical relief

The renderer now includes a compact collapsed **Relief** control beneath the camera controls. Opening it reduces the viewport by only the control height. Its two buttons adjust height by exact factors of 1.05 and 1/1.05 with no UI limit. The multiplier starts at 1.00× for every viewer session, relative to the world-aware relief calculation established in v0.1.26. The displayed value updates immediately, but the rendering change is debounced until two seconds after the last tap.

The WebGL vertex shader transforms all Y positions (terrain, ocean, rivers and lakes) and corrects terrain normals for the scaled slope; no mesh worker rerun or source elevation mutation is required. Picking, camera target tracking, and tile frustum culling honor the rendered height. Pending updates cancel when the viewer closes. All 12 generation stages and save/checkpoint formats are unchanged.

Tests: `npm test`; build: `python3 package.py`. The WebGL2 visual result requires confirmation on a real device.
