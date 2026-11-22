# WorldGen v0.1.33 — Geographic resolution independence

New generations use a fixed 42 km reference scale (1,764 km²) for processes previously coupled to average cell dimensions. This is a calibration of the existing approximate model, not a claim of physical accuracy or identical worlds across different meshes.

- Elevation: propagate signed plate-boundary pressure along geographic graph distances instead of graph hops.
- Coastlines: the narrow bias defaults to 63 km and the broad setback to 420 km; the existing caps of 12% and 16% of the shorter world dimension still apply. The boundary-touching water rule remains intact.
- Erosion: preliminary runoff uses geographic area, hydraulic intensity uses a fixed area reference with a local rainfall floor, and sediment deposition per edge depends on distance. The mean erosion summary is area-weighted.
- Climate: ocean moderation reaches up to 252 km by weighted graph distance. Atmospheric moisture exchange is exponential with distance and uphill rise; orographic precipitation responds to slope, not raw neighboring elevation difference.
- Hydrology: the minimum catchment defaults to 7,056 km², with the corresponding discharge gate. Catchment map colors use the same absolute-area scale.
- Soils: the local relief index uses physical gradients calibrated at the reference distance.
- Biomes and vegetation: correlated patch wavelengths no longer depend on polygon count, and riparian influence decays within 126 km along connected land.
- UI: coastline widths and river threshold display km and km², with converted slider bounds, numerical inputs, stepper increments and help text.

Existing save schema, stored parameter encodings and all previously generated stages remain valid and unchanged. The new calibration applies on regeneration or when generating subsequent layers. Historical previews keep their saved arrays. The explicit minimum lake cell count and guaranteed one-cell coastal rim remain resolution-dependent by design. Plate placement, drainage topology, thermal weathering, cell-based lake detection and other discretization effects mean different meshes can still generate different landscapes. No 3D geometry algorithm or launcher changes.

Verification: 172 automated tests; new tests exercise equivalent physical strips at different resolutions, geographic distance masks, absolute threshold controls, coast widths, runoff, climate and vegetation, and complete worlds at 100, 1,200 and 5,000 polygons for all three shapes. Three actual v0.1.32 worlds (36 locked layers) were generated using the previous code and reloaded unchanged. Both packages build and include the new module in the standalone offline cache. Real-device Safari behavior not tested.
