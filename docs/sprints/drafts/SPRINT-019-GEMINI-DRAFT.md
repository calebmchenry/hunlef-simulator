# Sprint 019: UX Polish — Animation, Camera, Click Handling, Viewport

## Overview
This sprint addresses several UX and visual polish items identified in the previous sprint. It focuses on resolving attack animation morph target scaling issues, improving the initial camera distance to show the whole arena, correcting the camera's focus during the countdown, refining click handling to clamp out-of-bounds clicks, and expanding the game viewport horizontally.

## Use Cases
- As a player, I want attack animations to look cohesive and not "explode" due to exaggerated morph target deltas.
- As a player, I want the camera to be sufficiently zoomed out when the fight starts so I can see the entire arena.
- As a player, I want the camera to start focused on my character during the countdown rather than jarringly panning from the center.
- As a player, if I misclick slightly outside the arena, my character should move to the nearest edge tile instead of ignoring the click.
- As a player, I want a wider game viewport to give me a better peripheral view of the arena.

## Architecture
- **Animation Scaling:** The morph target deltas (which appear 3.4x larger than idle) need to be scaled down. This can be addressed by applying a scale modifier to the animation tracks at runtime in `Renderer3D.ts`, or by adjusting the `export-gltf.mjs` script. Correcting the export pipeline is the preferred long-term fix, preventing runtime overhead.
- **Camera Initialization:** The `DEFAULT_DISTANCE` in `CameraController.ts` will be increased to ensure the full 12x12 grid is visible given the fixed 45° FOV and 55° pitch.
- **Camera Focus:** The `Renderer3D.draw` logic will be updated to snap the camera to the player's world coordinates during the `countdown` state, removing the hardcoded `(0,0,0)` target.
- **Click Handling:** `Renderer3D.screenToTile` will clamp the raycast hit tile coordinates to `[0, GRID_SIZE - 1]` instead of returning `null` when out of bounds. This guarantees a valid tile is returned for edge clicks.
- **Viewport Expansion:** The canvas width in `index.html` and the rendering dimensions in `Renderer3D.ts` will be updated to a widescreen format (e.g., 1024x576 for a 16:9 ratio). The camera's aspect ratio will be dynamically calculated.

## Implementation
1. **Attack Morph Targets:** Investigate where the 3.4x scaling originates. Either adjust `tools/cache-reader/export-gltf.mjs` to scale down morph influences and regenerate assets, or scale the values inside the loaded `AnimationClip` tracks in `Renderer3D.loadBossGLTF()`.
2. **Camera Zoom:** In `src/render/CameraController.ts`, change `DEFAULT_DISTANCE = 10` to `16` (or a mathematically calculated value for 12 tiles at 45° FOV).
3. **Countdown Camera:** In `src/render/Renderer3D.ts`'s `draw` method, update the countdown block to `this.cameraController.snapTarget(playerWorld.x, 0, playerWorld.z)`.
4. **Click Clamping:** In `src/render/Renderer3D.ts`'s `screenToTile(clientX, clientY)`, modify the bounds check:
   ```typescript
   const tileX = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(hit.x + HALF_GRID)));
   const tileY = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(hit.z + HALF_GRID)));
   ```
   Remove the early return for out-of-bounds, ensuring a click always resolves to the nearest valid tile.
5. **Wider Viewport:** 
   - Update `index.html` canvas dimensions to `width="1024"` and `height="576"`.
   - In `Renderer3D.ts`, update `this.webglRenderer.setSize(1024, 576)` (or decouple it from `GRID_SIZE * TILE_SIZE_PX`) and update the `aspect` ratio for `PerspectiveCamera` to `1024 / 576`.

## Files Summary
- `docs/sprints/drafts/SPRINT-019-GEMINI-DRAFT.md`: Sprint design document.
- `src/render/Renderer3D.ts`: Update camera focus during countdown, clamp click coordinates in `screenToTile`, update renderer/camera aspect ratio, and potentially scale animation morph targets.
- `src/render/CameraController.ts`: Increase `DEFAULT_DISTANCE` to show the full arena.
- `index.html`: Update `<canvas>` element dimensions to a wider aspect ratio.
- `tools/cache-reader/export-gltf.mjs`: (Optional depending on approach) Fix morph target delta scale during GLTF export.

## Definition of Done
- Boss attack animations maintain cohesive geometry without excessive stretching.
- Camera `DEFAULT_DISTANCE` is large enough to view the entire arena on load.
- Camera begins perfectly centered on the player during the countdown phase.
- Clicking outside the 12x12 grid results in moving to the nearest valid boundary tile.
- Game viewport is noticeably wider (e.g., 1024x576) and rendered without distortion.
- All tests pass (`npm run build`, `npm test`, `cd ../cg-sim-player && npm test`).
- Frame rate remains > 30fps.

## Risks
- **Animation Scaling:** Scaling morph targets dynamically might introduce edge cases if the clips have complex keyframe interpolation, or changing the exporter might require a full re-export and validation of all models.
- **Viewport Adjustments:** Changing the viewport might break the UI layout or click-to-tile coordinate math if not correctly synced between CSS, HTML attributes, and Three.js sizes.

## Security
- No new external dependencies or sensitive data handled. Standard browser sandbox rules apply. No changes to the authentication or network surface.

## Dependencies
- Requires completion of previous sprint fixes (Sprints 017-018) for baseline animation and camera controllers.
- No new NPM packages required.

## Open Questions
1. **Item 1:** Should we scale down attack morph deltas in the export tool or at GLTF load time? (Recommendation: Fix at the source in the export tool if possible, or scale animation tracks dynamically as a fallback).
2. **Item 2:** What is the exact mathematical `DEFAULT_DISTANCE`? (Recommendation: Start with 16 based on FOV 45° and adjust visually).
3. **Item 5:** What exact width should the viewport be? (Recommendation: 1024x576 for a standard 16:9 ratio, integrating cleanly with the side panel layout).
4. **Item 3:** Center on player spawn tile or arena center? (Recommendation: Center on the player directly to avoid panning once the fight begins).