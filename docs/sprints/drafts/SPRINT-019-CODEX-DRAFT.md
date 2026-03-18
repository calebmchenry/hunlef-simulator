# Sprint 019: UX Polish for Animation, Camera, Click Handling, and Viewport

## Overview

This sprint improves five player-facing UX issues in the 3D client: boss attack animation coherence, initial camera framing, countdown camera centering behavior, out-of-bounds click handling, and horizontal viewport width.

The scope is intentionally constrained to renderer/input/camera integration points already in the app. The sprint avoids changes to `cg-sim-player`, avoids new dependencies, and preserves existing fallback behavior for model loading.

## Use Cases

1. As a player, I see Hunlef attack animations that stay visually cohesive instead of looking exploded compared to idle.
2. As a player, I start the fight with a camera that shows substantially more of the arena than the current default zoom.
3. As a player, during countdown I see the camera already centered on my character, so there is no noticeable post-countdown catch-up pan.
4. As a player, if I click outside the arena, my movement command snaps to the nearest valid tile instead of being discarded.
5. As a player, I get a wider battlefield view that increases horizontal visibility while keeping tile readability.
6. As a developer, if GLTF assets fail to load, fallback visuals still render and input/camera still work.
7. As a developer, verification can be done with deterministic checks (build/tests) plus targeted visual captures.

## Architecture

### Current Behavior Snapshot

- `Renderer3D` creates a fixed `576x576` WebGL canvas and a perspective camera with aspect `1`.
- `CameraController` uses fixed pitch (`55deg`), default distance `10`, and target lerp (`0.1`).
- `Renderer3D.draw()` snaps camera target to arena origin during `countdown`, then follows player only after state becomes `running`.
- `Renderer3D.screenToTile()` raycasts to the floor plane and returns `null` when hit tile is outside `[0..11]` in either axis.
- `InputManager` drops click input when `screenToTile()` returns `null`.
- Boss GLTF clips are retargeted for morph tracks, but attack clip amplitudes are not normalized against idle.

### Target Design

1. Boss Attack Morph Normalization (runtime)
- Add a boss-clip preprocessing step in `Renderer3D` after morph retargeting and before creating `AnimationController`.
- Identify idle clip (`idle`, `8417`, `seq_8417`) and attack clips (`attack_magic`, `attack_ranged`, `8430`, `8431`, `seq_8430`, `seq_8431`).
- Compute max absolute morph influence amplitude for idle vs each attack clip.
- Scale attack morph track values down toward a configurable target ratio relative to idle (default around `1.0-1.2x` idle amplitude).
- Clamp scaled values to safe morph ranges and no-op when expected tracks are missing.

2. Countdown Camera Targeting
- Keep orbit controls and lerped follow behavior for normal play.
- During countdown, target the interpolated player world position (not arena origin).
- Use `snapTarget()` while countdown is active so player movement during countdown does not create delayed camera drift.

3. Out-of-Bounds Click Clamping
- Split tile projection into strict and clamped modes in `Renderer3D`.
- Keep strict conversion for existing in-bounds behavior.
- Add nearest-tile conversion that clamps projected tile coordinates to `[0..GRID_SIZE-1]`.
- In `InputManager`, when strict conversion returns `null`, fallback to nearest-tile conversion and queue movement.

4. Wider Viewport + Matching Projection
- Introduce explicit viewport constants (target `1024x576`, 16:9).
- Apply width/height to WebGL renderer size and camera aspect.
- Update initial HTML canvas attributes to match runtime dimensions and avoid startup mismatch.

## Implementation

### Phase 1: Animation Cohesion

- [ ] Add `normalizeBossAttackMorphs(clips)` helper in `Renderer3D.ts`.
- [ ] Detect idle/attack clips using existing naming conventions and sequence ids.
- [ ] Scale only morph target tracks in attack clips; do not alter timing, loop config, or non-morph tracks.
- [ ] Add defensive logs when clips or morph tracks are missing.

### Phase 2: Camera Framing and Countdown Behavior

- [ ] Increase `DEFAULT_DISTANCE` in `CameraController.ts` from `10` to calibrated wider framing (start with `14`, tune if needed).
- [ ] Update `Renderer3D.draw()` so countdown camera target is player-centered each frame.
- [ ] Ensure running-state transition does not produce a sudden pan (camera already on player at countdown end).

### Phase 3: Click Handling

- [ ] Refactor screen-raycast tile projection in `Renderer3D.ts` into reusable strict/clamped helpers.
- [ ] Add a method for nearest valid tile projection when hit point is outside arena bounds.
- [ ] Update `InputManager.ts` click flow to fallback to nearest tile instead of dropping the action.
- [ ] Preserve existing in-bounds boss-click attack behavior.

### Phase 4: Wider Viewport

- [ ] Replace square renderer sizing with `1024x576` in `Renderer3D.ts`.
- [ ] Set camera aspect to `1024 / 576`.
- [ ] Update `index.html` canvas width/height attributes to `1024` and `576`.
- [ ] Update stale inline comments referencing `576x576` in `src/main.ts`.

### Phase 5: Verification

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `cd ../cg-sim-player && npm test`.
- [ ] Capture before/after screenshots for:
- boss attack peak pose (cohesion),
- countdown camera framing,
- post-countdown transition,
- outside-click-to-edge movement,
- wider viewport framing.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Boss attack morph normalization; countdown camera targeting; strict+clamped tile projection; viewport sizing/aspect |
| `src/render/CameraController.ts` | Modify | Increase initial camera distance for wider default framing |
| `src/input/InputManager.ts` | Modify | Fallback from strict tile lookup to nearest valid tile on out-of-bounds clicks |
| `index.html` | Modify | Match initial canvas dimensions to wider viewport |
| `src/main.ts` | Modify (minor) | Update comments/assumptions tied to old square viewport |
| `src/__tests__/input-manager.test.ts` | Add | Validate out-of-bounds click clamp behavior at input boundary |

## Definition of Done

- [ ] Boss attack animations no longer appear dramatically more exploded than idle in normal gameplay.
- [ ] Initial camera framing is visibly wider and shows near-full arena context.
- [ ] Countdown camera remains centered on player position; no post-countdown catch-up pan.
- [ ] Clicking outside arena triggers movement to nearest valid tile.
- [ ] In-bounds click behavior remains unchanged (including boss click-to-attack).
- [ ] Wider viewport is active and camera projection is not stretched/distorted.
- [ ] GLTF fallback behavior remains intact.
- [ ] `npm run build`, `npm test`, and `../cg-sim-player` tests pass.

## Risks

- Runtime morph scaling may over-correct and make attacks feel too weak if clip amplitudes vary across assets.
- A larger default camera distance can reduce combat readability on smaller screens.
- Outside-click clamping policy may conflict with expected attack behavior when clamped tile lands on boss footprint.
- Wider viewport can expose edge-of-arena composition issues (UI overlap, empty margins, or off-center framing).

## Security

- No new dependencies.
- No new network surfaces or external data flows.
- Changes remain in rendering/input logic and do not alter save/state persistence.
- Existing CSP and DOM event boundaries remain unchanged.

## Dependencies

- Existing Three.js stack (`three`, `GLTFLoader`, `AnimationMixer`).
- Existing game-state/tick data from `GameSimulation`.
- Existing arena/grid assumptions (`12x12`, centered world mapping).
- Existing asset naming conventions for boss clip IDs and fallback model paths.

## Open Questions

1. Should outside clicks that clamp onto a boss-occupied tile queue movement only, or preserve click-to-attack semantics?
2. Is `1024x576` the final target viewport, or should width be responsive with fixed height/aspect constraints?
3. Should attack morph normalization stay runtime-only, or be migrated into export tooling after validation?
4. What exact target ratio between idle and attack morph amplitudes is preferred for final visual tuning?
5. Do we want automated visual snapshot assertions for these UX changes, or manual screenshot review only for this sprint?
