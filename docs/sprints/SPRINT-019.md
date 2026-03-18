# Sprint 019: UX Polish — Animation Scaling, Camera, Click Handling, Viewport

## Overview

Five targeted UX improvements:

1. **Attack animations too spread out** — morph target deltas are 3.4x larger than idle, making the boss look like it's exploding during attacks. Scale down all morph target influences uniformly.
2. **Camera too close** — `DEFAULT_DISTANCE = 10` doesn't show the full 12-tile arena. Increase to 18.
3. **Camera pans after countdown** — currently snaps to arena center (0,0,0) during countdown, then pans to player. Should center on the player from the start.
4. **Clicks outside arena are ignored** — `screenToTile()` returns null for out-of-bounds clicks. Clamp to nearest valid tile instead.
5. **Viewport too narrow** — fixed 576×576 square canvas. Widen to 1024×576 (16:9).

## Use Cases

1. Boss attack animations look cohesive — body stays together, not "exploded"
2. On initial load, most of the arena is visible without zooming out
3. During countdown, camera already focused on the player — no jarring pan when fight starts
4. Clicking outside the arena moves player to nearest edge tile
5. Wider viewport shows more arena horizontally, improving spatial awareness
6. Scroll-wheel zoom and arrow-key rotation still work
7. HUD and side panel still render correctly beside wider canvas
8. Clamped outside-clicks always queue movement (never attack, even if nearest tile is boss-occupied)
9. Sky-clicks (ray misses floor plane) are still ignored

## Architecture

### Item 1: Morph Target Influence Scaling

Morph target deltas are **geometry data shared across all animation clips** — they can't be scaled per-clip. All clips reference the same `geometry.morphAttributes.position` arrays.

**Approach:** Scale all `morphTargetInfluences` values uniformly at animation playback time. In `AnimationController`, cap the maximum influence value by a damping factor (e.g., 0.5). This reduces attack explosiveness while keeping idle visible (idle deltas are already small, so 0.5× idle is still subtle but present).

Implementation: After the mixer updates influences each frame, traverse the boss meshes and scale each `morphTargetInfluences[i]` by a constant factor. This is non-destructive and easily tunable.

### Item 2: Camera Distance

The arena is 12 tiles. With FOV=45° at pitch=55° and the wider 16:9 aspect ratio, the horizontal FOV increases substantially. A default distance of 18 with max of 30 provides good default framing with zoom headroom.

### Item 3: Countdown Camera

Change:
```typescript
// Before: snaps to arena center
if (sim.state === 'countdown') {
  this.cameraController.snapTarget(0, 0, 0);
}

// After: snaps to player position
if (sim.state === 'countdown') {
  const pw = tileToWorld(sim.player.pos.x, sim.player.pos.y);
  this.cameraController.snapTarget(pw.x, 0, pw.z);
}
```

### Item 4: Click Clamping

In `screenToTile()`, clamp tile coordinates to `[0, GRID_SIZE-1]` instead of returning null. But mark clamped results so `InputManager` knows it was an outside-click:

```typescript
// In screenToTile: clamp instead of return null
const clampedX = Math.max(0, Math.min(GRID_SIZE - 1, tileX));
const clampedY = Math.max(0, Math.min(GRID_SIZE - 1, tileY));
const clamped = (tileX !== clampedX || tileY !== clampedY);
return { x: clampedX, y: clampedY, clamped };
```

In `InputManager.handleClick()`: if `tile.clamped`, always queue movement (skip boss-occupancy check). This prevents outside-clicks from accidentally triggering attacks if the nearest tile happens to be boss-occupied.

Keep `if (!hit) return null` for ray-plane misses (sky clicks).

### Item 5: Wider Viewport

Change canvas from 576×576 to 1024×576. Update:
- `index.html` canvas attributes
- `Renderer3D.ts` renderer size and camera aspect ratio
- Add `CANVAS_WIDTH` and `CANVAS_HEIGHT` constants

The `screenToTile()` raycasting is resolution-independent (uses `getBoundingClientRect()`), so no click math changes needed.

## Implementation

### Phase 1: Wider Viewport (Item 5) — do first, affects camera math

**Files:** `index.html`, `src/render/Renderer3D.ts`

- [ ] Add `CANVAS_WIDTH = 1024` and `CANVAS_HEIGHT = 576` constants
- [ ] Update `webglRenderer.setSize()` to use new constants
- [ ] Update camera aspect ratio to `CANVAS_WIDTH / CANVAS_HEIGHT`
- [ ] Update `index.html` canvas: `width="1024" height="576"`
- [ ] Verify CSS layout — HUD/side panel beside wider canvas
- [ ] `npm run build` passes

### Phase 2: Camera Distance & Countdown (Items 2-3)

**Files:** `src/render/CameraController.ts`, `src/render/Renderer3D.ts`

- [ ] Change `DEFAULT_DISTANCE` from 10 to 18
- [ ] Change `MAX_DISTANCE` from 20 to 30
- [ ] In `draw()`, change countdown snap target from `(0,0,0)` to player world position via `tileToWorld(sim.player.pos.x, sim.player.pos.y)`
- [ ] Screenshot verify: arena mostly visible, camera on player during countdown

### Phase 3: Click Clamping (Item 4)

**Files:** `src/render/Renderer3D.ts`, `src/input/InputManager.ts`

- [ ] In `screenToTile()`: replace out-of-bounds `return null` with clamped coordinates + `clamped` flag
- [ ] Update return type to include `clamped: boolean`
- [ ] In `InputManager.handleClick()`: if `tile.clamped`, always `queueMove(tile)` (skip boss check)
- [ ] Keep `if (!hit) return null` for ray-plane miss
- [ ] Verify: clicking outside arena moves to nearest edge tile
- [ ] Verify: clicking inside arena still works normally (boss click → attack)

### Phase 4: Morph Influence Scaling (Item 1)

**Files:** `src/render/Renderer3D.ts`

- [ ] After `this.animController.update(dt)` in the render loop, traverse boss meshes and scale `morphTargetInfluences` by a damping factor
- [ ] Start with factor `0.5` — tune visually via screenshots
- [ ] Add constant `BOSS_MORPH_INFLUENCE_SCALE = 0.5`
- [ ] Screenshot-compare attack poses before/after
- [ ] Verify idle animation still visible (not completely flat)
- [ ] Verify death and style-switch animations still look correct

### Phase 5: Verification

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Playwright screenshots:
  - [ ] Wider viewport renders correctly at 1024×576
  - [ ] Arena mostly visible at default zoom
  - [ ] Camera on player during countdown (no pan when fight starts)
  - [ ] Attack animation looks more cohesive
  - [ ] Idle animation still visible
- [ ] Frame rate > 30fps

## Files Summary

| File | Changes |
|------|---------|
| `index.html` | Canvas width/height: 1024×576 |
| `src/render/Renderer3D.ts` | Canvas size constants, aspect ratio, countdown target, click clamping, morph influence scaling |
| `src/render/CameraController.ts` | DEFAULT_DISTANCE=18, MAX_DISTANCE=30 |
| `src/input/InputManager.ts` | Handle `clamped` flag — always queue movement for outside clicks |

## Definition of Done

- [ ] Viewport renders at 1024×576 with correct 16:9 aspect ratio
- [ ] Camera defaults to distance 18, showing most of the arena
- [ ] During countdown, camera centered on player (no pan when fight starts)
- [ ] Clicking outside arena snaps to nearest valid tile and queues movement
- [ ] Clamped outside-clicks never trigger boss attack (always movement)
- [ ] Sky-clicks (ray miss) still ignored
- [ ] Attack animations visually less "exploded" than before
- [ ] Idle, death, and style-switch animations not degraded
- [ ] HUD and side panel layout intact
- [ ] Fallback paths (JSON boss, cyan box, cone tornado) still work
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Uniform morph scaling makes idle invisible | Low | Medium | Idle deltas are small (avg 32); at 0.5× they're 16 — still visible. Tune factor visually |
| Wider canvas breaks layout on narrow screens | Low | Low | Layout is already fixed-width; test at common resolutions |
| Camera distance too far — arena looks tiny | Low | Low | Easily tunable; start at 18, adjust based on screenshots |
| Click clamping feels unintuitive at corners | Low | Low | Standard game pattern; users expect nearest-tile behavior |
| Morph influence scaling interacts poorly with death animation | Low | Medium | Death uses same morph system; verify clamp doesn't affect it |

## Security

No security implications. Client-side rendering constants and input handling logic only.

## Dependencies

- No new npm dependencies
- No changes to cg-sim-player
- No changes to export pipeline or model files

## Open Questions

1. **Morph damping factor:** 0.5 is a starting guess. May need visual tuning to find the right balance between attack cohesion and animation visibility.
2. **CSS layout:** Does the 1024px canvas fit beside the existing side panel without overflow? Need to verify with the actual page layout.
3. **Camera distance:** 18 may be too far or too close once the wider aspect ratio is in play. Tune after viewport change.

## MVP Scope Cuts (if sprint runs long)

1. Cut morph scaling (Item 1) — most complex, can be a follow-up
2. Cut click clamping (Item 4) — nice-to-have
3. **Absolute minimum:** Wider viewport + camera distance + countdown target
