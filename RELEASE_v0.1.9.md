# WorldGen v0.1.9 — optimization, cleanup, and safeguards

This is a refinement-only release built on v0.1.8: **no added simulation layers, no changes to the saved schema, and no automatic regeneration of earlier locked worlds**.

## Responsiveness

A reusable spatial index is built in memory whenever a Voronoi mesh is displayed. Zoomed-in redraws visit only polygons whose bounding boxes intersect the viewport, rather than scanning every polygon each frame. For a fully visible map, rendering still uses the original simple pass. Cell inspection uses the same index and normally tests a handful of candidate polygons. At particularly rare geometric seams, it falls back to nearest-site lookup.

The index is not persisted. Existing files keep the same complete mesh and data arrays, and deterministic generation remains supported.

## Reliability and cleanup

- Clipped Voronoi boundaries (especially curved world boundaries) are not automatically treated as connections in the neighbor graph. A candidate neighbor must be equidistant from the edge midpoint to be accepted.
- Empty numeric fields no longer accidentally become zero on commit; invalid entries restore the saved setting.
- Seed entry now rejects blank, fractional and out-of-range values rather than silently using zero.
- An IndexedDB open failure no longer permanently prevents later attempts to connect.
- Both standalone and launcher builds include the new `spatial.js` module.

## Testing

`npm test` includes additional spatial-index equivalence and polygon-picking tests for rectangles, circles, and ellipses, plus regression checks on save format and previous layers. `python3 package.py` builds standalone and launcher targets.

If you previously locked a world, its geometry is preserved. Only newly generated or explicitly revised Voronoi layers use the tightened graph construction; no changes are made behind your back.
