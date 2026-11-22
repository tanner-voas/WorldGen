# WorldGen v0.1.34 — Generation constraints

- Warn about exceptionally narrow worlds in layer 1 and report the actual boundary-water area constraint of generated meshes in layer 2.
- At layer 5, show the maximum geographic land fraction permitted by the optional protected rim, the requested target, and the generated coverage. Explain unattainable targets and show when the narrow fade or broader setback is capped by world size. Pending previews never report old coverage as the result of new settings.
- Choose the globally closest attainable area-weighted sea-level threshold, including endpoints and equal-height groups. Keep the guaranteed wet boundary intact whenever Edge ocean bias is positive; no silent overrides or automatic changes to earlier layers. All-water or all-land outcomes remain valid and are explicitly identified.
- Store optional coverage metadata on newly generated coast records. Historical records without it retain their original output and are not assigned a retroactive capacity. Existing schema and checkpoint format remain compatible.

Verification: 179 automated tests pass. New tests cover weighted threshold optimality, tied elevations, geographic boundary capacity, all-boundary meshes, pending previews, and extreme rectangular, elliptical and circular worlds through all twelve stages. Nine v0.1.33 saves (108 locked layers) retain their data exactly on loading; their regenerated default coasts match the previous results apart from coverage metadata. Both distributions build; native iPhone Safari UI behavior is not verified.
