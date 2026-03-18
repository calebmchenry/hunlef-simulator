# Sprint 019: UX Polish — Attack Animations, Camera, Click Handling, Viewport

## Overview

Five targeted UX improvements that don't require architectural changes. Four are constant/logic tweaks in existing files; one (attack animation deltas) needs investigation into whether the fix belongs in the export pipeline or at render time.

1. **Attack morph deltas too large** — boss body "explodes" during attack animations because morph target deltas are ~3.4x larger than idle pose deltas. The model looks spread apart/deformed during attacks.
2. **Camera too close on load** — `DEFAULT_DISTANCE = 10` doesn't show the full 12-tile arena. Need to calculate the correct distance for FOV=45° at pitch=55°.
3. **Camera snaps to (0,0,0) during countdown** — should center on the player's spawn tile so there's no jarring pan when the fight starts.
4. **Clicks outside arena are discarded** — `screenToTile()` returns `null` for out-of-bounds clicks. Should clamp to the nearest valid tile instead.
5. **Viewport too narrow** — fixed 576×576 square canvas. Should be wider to give more horizontal view of the arena.

## Use Cases

1. Boss attack animations look cohesive — body parts don't fly apart during magic/ranged attacks
2. On initial load, the full arena (or near-full) is visible without zooming out
3. During countdown, camera is already focused on the player's spawn position (6,10) — no pan transition when fight starts
4. Clicking outside the arena moves the player to the nearest edge tile (e.g., clicking below the arena moves to tile row 11)
5. Wider viewport shows more of the arena horizontally, improving spatial awareness
6. Scroll-wheel zoom and arrow-key rotation still work after camera changes
7. HUD and side panel layout still work with wider canvas
8. Fallback paths (JSON boss, cyan box player) are unaffected

## Architecture

### Item 1: Attack Morph Delta Scaling

The `osrscachereader` `GLTFExporter.addSequence()` writes morph target deltas directly from OSRS frame data. Attack animations have larger vertex displacements than idle. The issue is that morph targets are stored as absolute deltas in GLTF — `morphTargetInfluences[i] = 1.0` applies the full delta.

**Option A — Scale at load time (recommended):** After GLTF load in `Renderer3D.loadBossGLTF()`, traverse morph target geometry attributes for attack clips and scale the position deltas down by a damping factor. This is non-destructive (doesn't change exported files) and tunable.

**Option B — Scale in export tool:** Modify `export-gltf.mjs` to scale frame deltas during `addSequence()`. Requires re-exporting and understanding the `osrscachereader` internal API.

**Option C — Scale `morphTargetInfluences` at runtime:** Instead of playing influences at full 1.0, cap them at ~0.3. Simple but affects all morph targets uniformly and breaks the intended animation weights.

Recommend **Option A**: post-load geometry scaling of morph target position attributes for attack animation clips. This can be done by iterating `geometry.morphAttributes.position` arrays and scaling their values by a damping factor (e.g., 0.3).

### Item 2: Camera Distance

The arena is 12 tiles across. At FOV=45° vertical and pitch=55°, the camera needs to be far enough to frame the full arena. The horizontal extent is 12 units. With aspect ratio 1:1, the horizontal FOV equals the vertical FOV (45°).

Visible width at ground level ≈ `2 * distance * cos(pitch) * tan(FOV/2)`. For full 12-unit arena:

```
12 = 2 * d * cos(55°) * tan(22.5°)
12 = 2 * d * 0.5736 * 0.4142
12 = d * 0.4752
d ≈ 25.3
```

That exceeds `MAX_DISTANCE = 20`. Options:
- Increase `MAX_DISTANCE` and `DEFAULT_DISTANCE` to ~18 (shows most of the arena, not all)
- Increase `MAX_DISTANCE` to 26 and default to ~25 (shows full arena)
- Change default to 16-18 to show "near-full" arena and leave max at 20

Recommend `DEFAULT_DISTANCE = 18` and `MAX_DISTANCE = 30` — shows most of the arena by default, lets users zoom in/out further. With the wider viewport (Item 5), the horizontal FOV increases, so the effective visible area grows too.

**Note:** With a wider (non-square) viewport, the aspect ratio changes and horizontal FOV widens. A 16:10 canvas at distance=18 would show significantly more arena horizontally.

### Item 3: Camera Countdown Target

Currently in `Renderer3D.draw()` (line 897-901):
```typescript
if (sim.state === 'countdown') {
  this.cameraController.snapTarget(0, 0, 0);  // arena center
} else {
  this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
}
```

Player spawns at tile (6,10), which in world coordinates is `tileToWorld(6, 10)` = `(0.5, 0, 4.5)`. Change the countdown snap target to the player's spawn world position so the camera is already looking at the player when the fight begins.

### Item 4: Click-to-Nearest-Tile

Currently `screenToTile()` returns `null` for clicks outside [0,12)×[0,12). Instead of returning null, clamp the tile coordinates to `[0, 11]`:

```typescript
const tileX = Math.floor(hit.x + HALF_GRID);
const tileY = Math.floor(hit.z + HALF_GRID);
// Clamp to arena bounds instead of returning null
const clampedX = Math.max(0, Math.min(GRID_SIZE - 1, tileX));
const clampedY = Math.max(0, Math.min(GRID_SIZE - 1, tileY));
return { x: clampedX, y: clampedY };
```

The `InputManager.handleClick()` already handles any valid tile (boss occupancy check, then queue move), so no changes needed there.

The raycast itself may still fail to hit the floor plane if the click is aimed at the sky — keep the `if (!hit) return null` guard for that case.

### Item 5: Wider Viewport

Current: `576×576` (12 tiles × 48px, square, aspect=1).

Change to a wider aspect ratio. A 16:10 ratio at similar height gives `~922×576`. Round to a clean number: **920×576** (aspect ≈ 1.597).

Changes needed:
- `index.html` line 185: `<canvas width="920" height="576">`
- `Renderer3D.ts` line 364: `this.webglRenderer.setSize(920, 576)` — or compute from constants
- `Renderer3D.ts` line 384: `const aspect = 920 / 576` instead of `1`
- `#canvas-wrapper` and overlay CSS may need width adjustment
- `#game-container` flexbox should handle the wider canvas naturally

Add constants:
```typescript
const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 576;
```

The `screenToTile()` raycasting is already resolution-independent (uses `getBoundingClientRect()`), so no changes needed there.

## Implementation

### Phase 1: Wider Viewport (Item 5) — ~20% effort

Do this first because it changes the aspect ratio, which affects the camera distance calculation.

**Files:** `index.html`, `src/render/Renderer3D.ts`

- [ ] Add `CANVAS_WIDTH = 920` and `CANVAS_HEIGHT = 576` constants to `Renderer3D.ts`
- [ ] Update `webglRenderer.setSize()` to use the new constants
- [ ] Update camera aspect ratio from `1` to `CANVAS_WIDTH / CANVAS_HEIGHT`
- [ ] Update `index.html` canvas element: `width="920" height="576"`
- [ ] Verify layout: HUD/side panel still positioned correctly beside wider canvas
- [ ] `npm run build` passes

### Phase 2: Camera Distance (Item 2) — ~10% effort

**Files:** `src/render/CameraController.ts`

- [ ] Change `DEFAULT_DISTANCE` from `10` to `18`
- [ ] Change `MAX_DISTANCE` from `20` to `30`
- [ ] Verify: arena is mostly visible on load without scrolling/zooming
- [ ] Verify: zoom in/out with scroll wheel still works within new range

### Phase 3: Camera Countdown Target (Item 3) — ~10% effort

**Files:** `src/render/Renderer3D.ts`

- [ ] In `draw()`, change the countdown snap target from `(0, 0, 0)` to the player spawn world position
- [ ] Compute spawn world pos: `tileToWorld(6, 10)` → `(0.5, 0, 4.5)` — or read from `sim.player.pos` since the player is already at spawn during countdown
- [ ] Use `tileToWorld(sim.player.pos.x, sim.player.pos.y)` for the snap target during countdown so it works regardless of spawn position
- [ ] Verify: camera is centered on the player during countdown, no pan when fight starts

### Phase 4: Click Clamping (Item 4) — ~10% effort

**Files:** `src/render/Renderer3D.ts`

- [ ] In `screenToTile()`, replace the out-of-bounds `return null` with `Math.max(0, Math.min(GRID_SIZE - 1, tileX/tileY))`
- [ ] Keep the `if (!hit) return null` guard for ray-plane miss
- [ ] Verify: clicking outside arena moves player to nearest edge tile
- [ ] Verify: clicking inside arena still works normally

### Phase 5: Attack Morph Delta Scaling (Item 1) — ~50% effort

**Files:** `src/render/Renderer3D.ts`

- [ ] Add a helper function `scaleMorphTargetDeltas(model: THREE.Object3D, clips: THREE.AnimationClip[], clipNames: string[], scaleFactor: number)` that:
  - Traverses all meshes in the model
  - For each mesh with `geometry.morphAttributes.position`, scales the position array values by `scaleFactor`
  - Only targets meshes referenced by the named clips (attack animations)
- [ ] In `loadBossGLTF()`, after model load and before creating `AnimationController`, call the scaler for attack clips (`attack_magic`, `attack_ranged`) with a damping factor (start with 0.3, tune visually)
- [ ] Alternative simpler approach: scale ALL morph target position attributes uniformly since idle uses small deltas anyway — a uniform 0.3x scale would make idle nearly invisible but attacks more cohesive
- [ ] Screenshot-compare attack animations before/after
- [ ] Verify idle animation is not visually degraded
- [ ] Verify death animation still looks correct
- [ ] `npm run build` passes

### Phase 6: Verification — ~0% additional effort (integrated above)

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Visual check: wider viewport, zoomed-out camera, countdown camera position, click-outside behavior, attack animations

## Files Summary

| File | Changes |
|------|---------|
| `src/render/Renderer3D.ts` | Canvas size constants, aspect ratio, countdown camera target, click clamping, morph delta scaling |
| `src/render/CameraController.ts` | `DEFAULT_DISTANCE`, `MAX_DISTANCE` |
| `index.html` | Canvas width/height attributes |

## Definition of Done

- [ ] Wider viewport renders at ~920×576 with correct aspect ratio
- [ ] Camera defaults to distance ~18, showing most of the arena on load
- [ ] During countdown, camera is centered on the player (no pan when fight starts)
- [ ] Clicking outside the arena snaps to nearest valid tile and queues a move
- [ ] Attack animations look more cohesive (less "exploded" body)
- [ ] Idle, death, and style-switch animations are not visually degraded
- [ ] HUD and side panel layout intact beside wider canvas
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps
- [ ] Fallback paths (JSON boss, cyan box, cone tornado) still work

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Morph delta scaling breaks other animations (death, style switch) | Medium | Medium | Scale only attack clip morph targets, or use a conservative factor; screenshot all animation states |
| Wider canvas breaks responsive layout on small screens | Low | Low | Test at common resolutions; the layout is already fixed-width |
| Camera distance too far — arena looks tiny | Low | Low | Easily tunable constant; start with 18 and adjust |
| Click clamping feels wrong — player walks to edge when user didn't intend to click arena | Low | Low | Only fires when raycast hits the floor plane, so wild sky-clicks still return null |
| `osrscachereader` morph target format differs from expectations | Medium | Medium | If geometry attribute scaling doesn't work, fall back to capping `morphTargetInfluences` in the animation mixer |

## Security

No security implications. All changes are client-side rendering constants and click handling logic. No new inputs, no network calls, no new dependencies.

## Dependencies

- No new npm dependencies
- No changes to `cg-sim-player`
- No changes to the export pipeline (morph fix is at load time)

## Open Questions

1. **Morph delta scaling factor:** What value produces the best visual result? Starting with 0.3 but will need visual tuning. Should we scale all morph targets uniformly or only attack-clip-specific ones?
2. **Exact canvas width:** 920×576 is proposed (≈16:10). Would 960×576 (5:3) or 1024×576 (16:9) be better? This depends on how much horizontal space the user's screen has alongside the 249px side panel.
3. **Camera default distance:** 18 is proposed. With the wider aspect ratio, the effective visible area increases — should this be adjusted down to ~16?
4. **Countdown camera target:** Should it use the player's actual position (`sim.player.pos`) or the hardcoded spawn `(6,10)`? Using `sim.player.pos` is more robust if spawn ever changes.
5. **Item 1 approach confidence:** The morph delta scaling approach assumes morph target position attributes are directly accessible after GLTF load. If Three.js optimizes or compresses these attributes, the approach may need adjustment. Needs a prototype to validate.
