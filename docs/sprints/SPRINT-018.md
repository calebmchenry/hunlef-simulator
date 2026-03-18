# Sprint 018: Fix Tornado Screen Corruption, Boss Facing, and Attack Animation Jitter

## Overview

Three visual bugs discovered during Sprint 017 testing:

1. **Mint green screen when tornadoes spawn** — the entire viewport fills with color/static when tornadoes appear. Most likely cause: the tornado GLTF model has vertices in OSRS pixel-space units (hundreds), and `scale.set(0.7, 0.7, 0.7)` barely shrinks them. A tornado mesh 490+ Three.js units wide fills the camera frustum entirely.

2. **Hunlef faces away from the player** — `BOSS_MODEL_YAW_OFFSET = Math.PI` double-corrects for the OSRS -Z facing convention. `Math.atan2(dx, dz)` in Three.js already computes the correct facing angle; adding π rotates an additional 180° making the boss face away.

3. **Attack animation spazzes/rapid-restarts** — `crossFadeTo()` unconditionally calls `reset().play()` even when the requested state is already playing, restarting the animation from frame 0 on every trigger tick.

All three fixes are surgical: a scale constant, a yaw constant, and a guard clause. No architectural changes.

## Use Cases

1. Tornadoes spawn and render at correct arena-relative size without viewport corruption
2. Hunlef faces toward the player during combat from all positions
3. Boss attack animations play smoothly without rapid-restart jitter
4. Consecutive same-style attacks don't cause visual glitching
5. Idle animation still loops correctly (no regression)
6. Style-switch animations still trigger on style changes (no regression)
7. Death animation still clamps (no regression)
8. Player animations still work correctly (no regression)
9. Fallback paths (static JSON boss, cyan player box, cone tornado) still work

## Architecture

### Bug 1: Tornado Scale

The tornado GLTF model (`corrupted_hunlef`'s tornado NPC model 38601) has vertices in OSRS coordinate space. The boss model uses `BOSS_MODEL_SCALE = 5 / 675` to convert from OSRS units (~675 units for a 5-tile boss) to world space. The tornado needs a similar measured scale factor.

Current: `scale.set(0.7, 0.7, 0.7)` — barely reduces a model that's hundreds of units wide.
Fix: Measure the tornado model bounds, compute a `TORNADO_MODEL_SCALE` constant targeting ~1 tile height.

Additionally, the tornado texture (`tornado_tex0.png`, 40×4 pixels) should have explicit filter settings to avoid mipmap degeneration on such a tiny texture.

### Bug 2: Boss Yaw

```
Current:  rotation.y = Math.atan2(dx, dz) + Math.PI  → faces AWAY
Fix:      rotation.y = Math.atan2(dx, dz)             → faces TOWARD
```

`Math.atan2(dx, dz)` with `dx = playerX - bossX` already computes the angle to face the player in Three.js convention. The `Math.PI` offset was intended for OSRS -Z facing but double-corrects.

The same pattern exists for the player (`PLAYER_MODEL_YAW_OFFSET = Math.PI`). Both need screenshot verification.

### Bug 3: Animation Same-State Guard

```typescript
// Before: always restarts
private crossFadeTo(state: AnimState): void {
  const nextAction = this.actions.get(state);
  nextAction.reset();  // ← restarts from frame 0
  nextAction.play();
}

// After: skip if already playing this state
private crossFadeTo(state: AnimState): void {
  if (state === this.currentState) return;  // ← NEW
  const nextAction = this.actions.get(state);
  nextAction.reset();
  nextAction.play();
}
```

This works because the `finished` event handler returns to idle, so the next attack fires as a state change (idle→attack), not same-state.

## Implementation

### Phase 1: Attack Animation Fix (Bug 3) — ~10% effort

**Files:** `src/render/AnimationController.ts`, `src/render/PlayerAnimationController.ts`

- [ ] Add `if (state === this.currentState) return;` at the top of `crossFadeTo()` in `AnimationController.ts`
- [ ] Add `if (state === this.currentState) return;` at the top of `crossFadeTo()` in `PlayerAnimationController.ts`
- [ ] Verify: `npm run build` passes

### Phase 2: Boss Facing Fix (Bug 2) — ~15% effort

**File:** `src/render/Renderer3D.ts`

- [ ] Change `BOSS_MODEL_YAW_OFFSET` from `Math.PI` to `0`
- [ ] Take Playwright screenshots of boss from multiple angles to verify facing
- [ ] If boss faces correctly: also test `PLAYER_MODEL_YAW_OFFSET = 0` and screenshot verify
- [ ] If either offset needs a different value (π/2, -π/2), adjust and re-verify

### Phase 3: Tornado Screen Fix (Bug 1) — ~50% effort

**File:** `src/render/Renderer3D.ts`

- [ ] Take a Playwright screenshot at a tick when tornadoes are active to confirm the visual bug
- [ ] Measure tornado model bounds: add temporary logging of `THREE.Box3` from the loaded GLTF
- [ ] Compute `TORNADO_MODEL_SCALE` constant: target ~1 tile width/height (1 Three.js unit)
  - Formula: `TORNADO_MODEL_SCALE = 1.0 / measuredModelWidth` (similar to `BOSS_MODEL_SCALE = 5/675`)
- [ ] Replace `scale.set(0.7, 0.7, 0.7)` with `scale.set(TORNADO_MODEL_SCALE, TORNADO_MODEL_SCALE, TORNADO_MODEL_SCALE)`
- [ ] Add texture filter hardening after `applyUnlitMaterials` for tornado:
  ```typescript
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) {
        mat.map.magFilter = THREE.NearestFilter;
        mat.map.minFilter = THREE.NearestFilter;
        mat.map.generateMipmaps = false;
        mat.map.needsUpdate = true;
      }
    }
  });
  ```
- [ ] Take Playwright screenshot to verify tornado renders at correct size
- [ ] Verify fallback cone still works if GLTF fails (rename tornado GLTF temporarily)

### Phase 4: Verification — ~25% effort

- [ ] Take Playwright screenshots verifying:
  - [ ] Boss faces player from N/E/S/W positions
  - [ ] Attack animation plays smoothly across consecutive attacks
  - [ ] Tornadoes render at correct scale (not filling viewport)
  - [ ] Idle animation still loops
- [ ] `npm run build` — no errors
- [ ] `npm test` — all tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass
- [ ] Frame rate > 30fps with tornadoes + animations active

## Files Summary

| File | Changes | Bug |
|------|---------|-----|
| `src/render/AnimationController.ts` | Same-state guard in `crossFadeTo()` | Bug 3 |
| `src/render/PlayerAnimationController.ts` | Same-state guard in `crossFadeTo()` | Bug 3 |
| `src/render/Renderer3D.ts` | `BOSS_MODEL_YAW_OFFSET = 0` | Bug 2 |
| `src/render/Renderer3D.ts` | Possibly `PLAYER_MODEL_YAW_OFFSET = 0` | Bug 2 |
| `src/render/Renderer3D.ts` | `TORNADO_MODEL_SCALE` constant + texture filters | Bug 1 |

## Definition of Done

- [ ] No mint green/static screen when tornadoes spawn — tornadoes render at arena-relative size
- [ ] Hunlef faces toward the player during combat (verified from multiple angles)
- [ ] Attack animations play smoothly — same-style consecutive attacks don't restart/spaz
- [ ] Idle animation still loops (no regression)
- [ ] Style-switch animations still trigger (no regression)
- [ ] Death animation still clamps (no regression)
- [ ] Player animations (attack, eat, idle) still work (no regression)
- [ ] Fallback paths work: static JSON boss, cyan player box, cone tornado placeholder
- [ ] Frame rate > 30fps with all animations + tornadoes active
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bug 1 root cause differs from scale hypothesis | Medium | Medium | Screenshot investigation before fixing. Fallback: check WebGL state, material, texture path |
| Yaw offset needs value other than 0 | Medium | Low | Screenshot testing from 4 directions. Try 0, π/2, -π/2 if needed |
| Same-state guard prevents legitimate re-triggers | Low | Low | `finished` event returns to idle, so next attack is always a state change |
| Player yaw also needs fixing | Medium | Low | Test symmetrically in Phase 2 |
| Tornado texture still renders incorrectly after scale fix | Low | Low | Texture filter hardening as additional fix |

## Security

No security implications. All changes are client-side rendering logic.

## Dependencies

- Existing Three.js r183 + GLTFLoader
- Playwright + system Chrome for screenshot verification
- No new npm dependencies
- Never modify cg-sim-player

## Open Questions

1. **Tornado model bounds:** What are the actual vertex extents of the tornado GLTF? Needs measurement at load time to compute the correct scale constant.
2. **Player yaw:** Does `PLAYER_MODEL_YAW_OFFSET` also need to change to 0? Needs screenshot verification.

## MVP Scope Cuts (if sprint runs long)

1. Cut player yaw fix (keep boss only)
2. Cut texture filter hardening (keep scale fix only)
3. **Absolute minimum:** All three bugs fixed with basic verification
