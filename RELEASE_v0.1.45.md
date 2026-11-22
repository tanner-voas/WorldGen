# WorldGen v0.1.45 — Full stabilization

Completes the v0.1.29–v0.1.45 reliability, geographical consistency, and rendering roadmap. This release fixes recovery and lifecycle edge cases rather than introducing new generation features or changing the renderer's appearance.

## Changes

- Validate saved geometry dimensions, shape, radii, area and corresponding mesh area metadata. Reject malformed generated data (including impossible working-layer payloads after layer 12). Invalid authoritative data continues through the existing fail-closed recovery path, preserving the original stored record.
- Normalize invalid historical-layer selections and viewport metadata consistently on startup, import and checkpoint restore. Validate replacements before interrupting current generation, so an invalid checkpoint does not stop a valid working world.
- Handle message-deserialization failures in generation, initial terrain and local refinement workers. A failed worker response cannot leave initialization suspended or close-up refinement permanently busy.
- On WebGL context loss, cancel pending draws and discard obsolete close-up CPU geometry. Recover the scene on restoration, or report a controlled error if reinitialization fails. Clean up shader handles even if program construction fails. Release the terrain viewer when replacing its modal.
- Handle lost pointer capture in the 2D map without treating cancellation as a selection tap.

## Verification

- 238 automated tests passed (230 existing plus eight stabilization tests).
- Twelve generated worlds across all three shapes, including 100, 1,200 and 5,000 target polygons and extreme dimensions/settings; 144 generation stages, 144 historical checkpoint round trips, and 60 stage-specific 3D mesh checks. JSON round trips preserve generated data (including the JSON convention for signed zero).
- Real OpenGL ES 3.2 software shader compilation, linking and rendered-pixel regression checks passed.
- Both standalone and launcher-module packages build successfully.
- Existing generation routines, rendering shaders, geography, relief controls, and save schema remain unchanged. Device-specific Safari performance and native IndexedDB/WebGL lifecycle behavior are not established by these tests.

No AppLauncher source changes are required.
