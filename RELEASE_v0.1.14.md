# WorldGen v0.1.14

- Replaced the old smoothed-cell render with a continuous terrain render aimed at a satellite/physical-map look.
- Added a pan/zoom render viewer inside the render dialog so the generated image can be explored in-app without changing the saved world.
- Render styles now focus on satellite terrain, physical relief, climate, hydrology, biomes and vegetation rather than polygon-style overlays.
- Kept render generation stage-aware and non-destructive: it works from any completed layer 5+ snapshot and does not create a new layer.
