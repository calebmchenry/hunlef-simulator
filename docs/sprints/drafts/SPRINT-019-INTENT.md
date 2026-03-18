# Sprint 019 Intent: UX Polish — Animation, Camera, Click Handling, Viewport

## Seed

Five items:
1. Attack animations look odd/spread-apart — morph target deltas 3.4x larger than idle
2. Camera should be further zoomed out initially
3. Camera should center on player during countdown (not pan after)
4. Clicking outside arena should snap to nearest tile
5. Game viewport should be wider

## Orientation Summary

- **Project:** CG fight simulator, Sprint 017-018 just landed animation fixes, external .bin/.png models, tornado scale, boss facing, crossfade→stop
- **Key files:** `src/render/Renderer3D.ts`, `src/render/CameraController.ts`, `src/input/InputManager.ts`, `index.html`, `src/world/Arena.ts`
- **Camera:** FOV=45°, pitch=55°, default distance=10, min=4, max=20. During countdown: snaps to (0,0,0). After: lerps to player position.
- **Click handling:** Raycasts to y=0 plane, converts to tile, returns `null` if outside [0,12)×[0,12) grid. InputManager discards null.
- **Viewport:** 576×576px (12 tiles × 48px/tile). Fixed square.
- **Arena:** 12×12 tiles centered at origin. HALF_GRID=6.
- **Constraint:** Never modify cg-sim-player.

## Relevant Codebase Areas

| Area | File | Key Lines | Item |
|------|------|-----------|------|
| Attack morph deltas | `tools/cache-reader/export-gltf.mjs`, `public/models/*.gltf` | Export pipeline | Item 1 |
| Camera distance | `src/render/CameraController.ts` | Line 14: `DEFAULT_DISTANCE = 10` | Item 2 |
| Camera countdown | `src/render/Renderer3D.ts` | Lines 897-902: countdown→(0,0,0), else→player | Item 3 |
| Click-to-tile | `src/render/Renderer3D.ts` | Lines 853-878: `screenToTile()` | Item 4 |
| Input handler | `src/input/InputManager.ts` | Lines 37-47: returns early on null tile | Item 4 |
| Canvas size | `index.html` line 185, `Renderer3D.ts` line 364: 576×576 | Item 5 |
| Arena bounds | `src/world/Arena.ts` | 12×12, HALF_GRID=6 | Items 4,5 |

## Constraints

- Never modify cg-sim-player
- No new npm dependencies
- `npm run build`, `npm test`, `cd ../cg-sim-player && npm test` must pass
- Frame rate > 30fps
- Maintain fallback paths

## Success Criteria

1. Attack animations look less "exploded" — boss body stays more cohesive during attacks
2. Camera shows the full arena or near-full arena on initial load
3. During countdown, camera is already centered on the player (no jarring pan)
4. Clicking outside the arena moves player to the nearest valid tile
5. Viewport is wider — more horizontal space to see the arena

## Verification Strategy

Playwright + system Chrome screenshots:
1. Compare attack animation frames before/after delta scaling
2. Screenshot at countdown showing camera on player
3. Verify wider viewport shows more arena
4. Click-outside behavior verified programmatically or via InputManager test

## Uncertainty Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| Correctness | **Low** for items 2-5, **Medium** for item 1 | Items 2-5 are constants/logic tweaks. Item 1 needs investigation — is the issue in export or rendering? |
| Scope | **Low** | Five well-bounded changes |
| Architecture | **Low** | All extend existing patterns |

## Open Questions

1. **Item 1:** Should we scale down attack morph deltas in the export tool, at GLTF load time in the renderer, or accept the authentic OSRS data?
2. **Item 2:** What camera distance shows the full arena? Current default is 10. The arena is 12 tiles across. Need to calculate the right distance for FOV=45° at pitch=55°.
3. **Item 5:** How wide should the viewport be? Current is 576×576 (square). Options: 16:9 ratio (~1024×576), match window width, or a specific pixel width. This affects the aspect ratio of the Three.js camera.
4. **Item 3:** Should the camera center on the player's spawn tile during countdown, or on the arena center? The player spawns at (6,10) which is south-center.
