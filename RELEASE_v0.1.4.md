# WorldGen v0.1.4 — World Geometry & Precision Controls

- Inserts **World geometry** at stage 1, shifting all subsequent stage numbers (Voronoi is now 2; erosion is 7).
- Rectangle (width/height), circle (radius) and ellipse (horizontal/vertical radii) are configured in kilometers. No depth yet.
- Voronoi density is specified by average cell **km²**, with a logarithmic slider and an adaptive 100–5,000 cell cap. Site placement and clipped polygon area are based on the saved world geometry.
- Every slider has numeric entry, minus and plus controls. Wider-range area and dimension changes use ±5%, with bounded linear steps for the other settings.
- Every generation parameter, including shape, distribution and seed, has an information popup explaining its behavior.
- Map measurement, scale, viewport fitting, area computations, and geometry generation use dynamic world size.
- V0.1.0–v0.1.3 saves import with a new rectangular geometry layer prepended; earlier generated arrays remain intact. Named checkpoint stage labels migrate too.
- Engine regression tests now cover all seven active stages, three world shapes, old-save migration, geometry clipping and snapshot completeness.

This remains a CPU/Web Worker generation engine with a bounded planar map. A 5,000-cell limit is a preliminary safety ceiling, not a promise of smooth real-time generation on every device. Future large worlds will require spatial batching and level-of-detail generation.
