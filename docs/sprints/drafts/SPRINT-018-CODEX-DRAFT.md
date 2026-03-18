# Sprint 018: Fix Tornado Render Corruption, Boss Facing, and Attack Replay Jitter

## Overview

This sprint addresses three renderer-visible regressions found after Sprint 017:
1. Tornado spawn causes a mint/static full-screen visual.
2. Hunlef appears to face away from the player.
3. Boss attack animation rapidly restarts (“spazzes”) instead of playing through.

The implementation is intentionally narrow: keep current model assets, controller APIs, and fallback paths, and fix behavior in the existing renderer/animation control flow.

## Use Cases

1. Tornadoes can spawn and move without corrupting the frame or filling the screen with a static/mint artifact.
2. Tornado visuals remain bounded to arena scale (roughly tile-sized hazard visuals), not world-sized geometry.
3. Hunlef turns toward the player while both entities move.
4. Facing remains stable when player and boss are nearly overlapping (no rotation jitter).
5. Consecutive magic attacks on adjacent ticks play as smooth repeated attacks, not frame-0 resets every trigger.
6. Consecutive ranged attacks behave the same way.
7. Idle and style-switch behavior from Sprint 017 remains intact.
8. Existing fallback visuals still work when GLTFs fail to load.

## Architecture

### Current Runtime Path

- `Renderer3D.draw()` updates mixer state, then boss/player/tornado transforms each frame.
- Tornado template is built in `loadTornadoGLTF()` and instantiated in `updateTornadoes()` via clone/pool.
- Boss facing is computed in `updateBoss()` using `Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET`.
- Boss attack triggers originate in `updateBossAnimations()` and call `AnimationController.playAttack(...)`.
- `AnimationController.crossFadeTo()` always calls `reset().play()`, including when requesting the same state.

### Likely Fault Lines

1. Tornado rendering:
- Tornado GLTF vertices are in large model-space units, while renderer currently applies `scale.set(0.7, 0.7, 0.7)`, which is much larger than arena-scale world units.
- Tornado texture is tiny and sampler-sensitive; texture defaults should be normalized in runtime to avoid unstable sampling behavior.

2. Boss facing:
- A hard-coded yaw offset of `Math.PI` may invert facing after `atan2` heading is computed.

3. Attack jitter:
- Same-state transitions always reset action time to 0, causing visible restart jitter when repeated attacks are requested before previous playback naturally finishes.

### Target Runtime Behavior

- Tornado template is normalized to a safe world scale at load time and rendered with stable texture sampling settings.
- Boss yaw uses a validated offset that makes the model face the player in world coordinates.
- Animation transitions are idempotent for redundant same-state requests unless a deliberate replay is needed.

## Implementation

### Phase 1: Tornado Render Stabilization

- [ ] In `Renderer3D.loadTornadoGLTF()`, compute tornado template bounds (`THREE.Box3`) and derive a scale factor to target arena-relative dimensions (instead of fixed `0.7`).
- [ ] Add a clamp guard on derived scale (min/max) so malformed assets cannot produce world-filling geometry.
- [ ] During tornado material setup, enforce consistent texture parameters on mapped materials:
  - `magFilter = THREE.NearestFilter`
  - `minFilter = THREE.LinearFilter` or `THREE.NearestFilter` (no mip dependence)
  - `generateMipmaps = false`
  - `wrapS/wrapT = THREE.ClampToEdgeWrapping`
- [ ] Keep cone fallback intact and ensure fallback scale remains arena-safe.

### Phase 2: Boss Facing Correction

- [ ] Update boss yaw calibration in `Renderer3D` by validating/removing `BOSS_MODEL_YAW_OFFSET` inversion.
- [ ] Keep existing dead-zone guard (`abs(dx|dz) > 0.01`) to avoid jitter.
- [ ] Verify facing correctness from at least 4 relative player positions (N/E/S/W around boss).

### Phase 3: Attack Animation Transition Guard

- [ ] Add same-state guard logic in `AnimationController.crossFadeTo()`:
  - Ignore redundant request when `state === currentState` and current action is still actively playing.
  - Allow replay only when prior action is finished (or for explicit forced-replay behavior if chosen).
- [ ] Preserve current loop/clamp settings for idle and death.
- [ ] Confirm boss attack trigger dedupe (`lastBossAttackTick`) still prevents multi-trigger in one tick.

### Phase 4: Verification and Regression Checks

- [ ] Capture Playwright screenshots around first tornado spawn and confirm no full-screen mint/static artifact.
- [ ] Capture facing screenshots from multiple player locations and confirm boss nose/chest orientation points toward player.
- [ ] Capture attack sequence frames for repeated same-style attacks and confirm smooth progression.
- [ ] Run:
  - `npm run build`
  - `npm test`
  - `cd ../cg-sim-player && npm test`

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Tornado scale normalization, tornado texture/material stability, boss yaw calibration |
| `src/render/AnimationController.ts` | Modify | Same-state transition guard to prevent rapid reset jitter |
| `tests/playwright/*` (existing visual test path) | Optional modify/add | Screenshot verification for tornado spawn, facing, and repeated attacks |

## Definition of Done

- [ ] Tornado spawn no longer causes screen-wide mint/static corruption.
- [ ] Tornadoes render at stable arena-relative size and move correctly.
- [ ] Boss consistently faces player during active combat movement.
- [ ] Repeated same-style attacks no longer visibly restart every trigger.
- [ ] Idle and style-switch animations still behave as before.
- [ ] Death animation behavior remains unchanged.
- [ ] GLTF failure fallback behavior (boss JSON, player cyan box, tornado cone) still works.
- [ ] Build/tests pass in both repos.

## Risks

- Tornado texture tuning may differ across WebGL contexts; a setting that fixes one browser could alter appearance in another.
- If boss model forward-axis assumptions are wrong, a simple offset change may still be 90°/180° off.
- Overly strict same-state guards can suppress intentional rapid re-attacks if gameplay expects immediate replay.
- Visual verification depends on deterministic capture timing around tick transitions.

## Security

- No new dependencies or external services.
- No new user-input or network surfaces.
- Changes are renderer/controller logic only and do not affect account/state handling.

## Dependencies

- Existing Three.js runtime (`three`, `GLTFLoader`, `AnimationMixer`).
- Existing simulation tick/projectile data from `GameSimulation` used by `Renderer3D`.
- Existing model assets in `public/models`.
- Existing Playwright + system Chrome screenshot workflow used in this project.

## Open Questions

1. What target visual dimensions should tornadoes use in world space (exact height/radius) to match intended gameplay readability?
2. For same-state attacks, should repeated trigger while currently playing be ignored or queued as a replay at clip end?
3. Should style-switch be allowed to preempt an attack when both events occur close together, or should attack always win for readability?
4. Do we want a temporary debug overlay (current anim state + action time) for faster visual diagnosis during this sprint?
