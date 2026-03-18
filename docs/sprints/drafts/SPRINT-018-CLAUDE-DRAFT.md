# Sprint 018: Fix Three Visual Bugs (Tornado Screen, Boss Facing, Attack Animation)

## Overview

Three visual bugs discovered during Sprint 017 testing need to be fixed:

1. **Mint green screen when tornadoes spawn** — the entire viewport fills with a solid color when tornadoes appear, suggesting either a failed texture load causing the GLTF fallback cone at enormous scale, or a WebGL state corruption triggered by the tornado rendering path.
2. **Hunlef faces away from the player** — the `BOSS_MODEL_YAW_OFFSET = Math.PI` double-corrects for the OSRS -Z facing convention, producing a 180° error so the boss faces away instead of toward the player.
3. **Attack animation spazzes/rapid-restarts** — `crossFadeTo()` unconditionally calls `reset().play()` even when the requested state is already playing, causing the animation to restart from frame 0 every time the same attack fires on consecutive ticks.

All three fixes are surgical: two constant changes in `Renderer3D.ts` and one guard clause in `AnimationController.ts`. No architectural changes required.

## Use Cases

1. **Tornado rendering:** Tornadoes spawn and render as expected without corrupting the viewport — either as the GLTF tornado model or as the fallback cone placeholder at correct scale.
2. **Boss facing:** Hunlef faces toward the player at all times during combat, from all angles and positions on the arena.
3. **Smooth attack animations:** When the boss fires a magic or ranged projectile, the corresponding attack animation plays once smoothly from start to finish without restarting mid-playback.
4. **Consecutive same-style attacks:** If the boss fires two magic attacks in quick succession, the second does not reset the first — the animation either continues playing or completes and replays naturally.
5. **No regression — idle animation:** Boss idle animation still loops correctly when no attack/switch is active.
6. **No regression — style switch:** Boss style switch animations still fire on combat style changes.
7. **No regression — player animations:** Player attack, eat, and idle animations remain unaffected.
8. **No regression — death animation:** Boss death animation still plays once and clamps.

## Architecture

### Bug 1: Tornado Viewport Corruption

**Diagnosis path:** The tornado GLTF loads asynchronously. When `updateTornadoes()` runs at `Renderer3D.ts:1339`, it clones `this.tornadoTemplate` (line 1360). The template was set up in `loadTornadoGLTF()` at lines 684-707 with `scale.set(0.7, 0.7, 0.7)`.

The mint green/static screen covering the *entire* viewport points to one of:
- **Hypothesis A:** The tornado texture (`tornado_tex0.png`, 40×4 pixels) fails to load, and the material ends up with a broken or missing texture that fills the screen — possibly because `applyUnlitMaterials()` copies a null/broken `map` from the standard material.
- **Hypothesis B:** A WebGL state issue (clear color, depth buffer, blend state) introduced by the tornado mesh rendering.
- **Hypothesis C:** The cloned tornado mesh inherits an incorrectly configured material or geometry that causes it to render as a screen-filling quad.

**Investigation strategy:**
1. Add a Playwright screenshot test that captures the frame immediately after tornadoes spawn (typically tick 15+).
2. Check if the tornado GLTF loads successfully in the test environment (console logs).
3. If the GLTF fails, verify the fallback cone renders at correct scale.
4. If the GLTF succeeds, inspect whether `applyUnlitMaterials()` produces a valid material — specifically check if the texture `map` is null/undefined when it shouldn't be.

**Fix approach:** This bug requires investigation before a definitive fix. Possible fixes:
- If texture loading fails: ensure the fallback cone path works correctly and the GLTF error handler fires.
- If `applyUnlitMaterials()` produces a broken material: add a null-check for `oldMat.map` before transferring it.
- If the clone operation copies stale/invalid state: deep-clone materials when cloning the template.
- If WebGL state corruption: isolate tornado rendering or reset WebGL state after tornado draws.

### Bug 2: Boss Facing Direction

**Root cause:** At `Renderer3D.ts:966`:
```typescript
this.bossGroup.rotation.y = Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET;
```

Where `BOSS_MODEL_YAW_OFFSET = Math.PI` (line 30), `dx = playerX - bossX`, and `dz = playerZ - bossZ`.

`Math.atan2(dx, dz)` with arguments `(dx, dz)` — note this is `atan2(x, z)`, not the standard `atan2(y, x)` — already computes the angle in Three.js convention where rotation.y = 0 faces +Z. The result already points the model's +Z axis toward the player. Adding `Math.PI` rotates an additional 180°, making the boss face *away*.

The offset was originally intended to correct for OSRS models facing -Z, but `atan2(dx, dz)` already handles this by computing the angle to face the player directly.

**Fix:** Change `BOSS_MODEL_YAW_OFFSET` from `Math.PI` to `0`.

The same pattern exists for the player at line 31 (`PLAYER_MODEL_YAW_OFFSET = Math.PI`) and line 991. Both should be fixed symmetrically — if the boss offset needs to be 0, the player offset likely does too. However, the intent doc only reports the boss facing bug. The player faces the boss, so if the player also has a 180° error, it would face away from the boss — which would be visually obvious. Since the intent doc doesn't mention it, the player offset may be correct. **This needs screenshot verification for both entities.**

**Conservative approach:** Fix `BOSS_MODEL_YAW_OFFSET = 0` first. Capture screenshots to verify both boss and player facing. If the player also faces wrong, fix `PLAYER_MODEL_YAW_OFFSET` in the same sprint.

### Bug 3: Attack Animation Rapid Restart

**Root cause:** In `AnimationController.ts:136-149`, `crossFadeTo()` always runs:
```typescript
nextAction.reset();
nextAction.play();
```

When `playAttack('magic')` is called while `attack_magic` is already the current state (e.g., boss fires two magic attacks on consecutive ticks), this resets the animation to frame 0, creating visible "spazzing."

The guard `sim.tick !== this.lastBossAttackTick` at `Renderer3D.ts:914` prevents re-triggering on the *same* tick, but does not prevent triggering on *consecutive* ticks while the previous attack animation is still playing.

**Fix:** Add an early return in `crossFadeTo()` when the requested state matches the current state:

```typescript
private crossFadeTo(state: AnimState): void {
  if (state === this.currentState) return;  // NEW: don't restart same animation

  const nextAction = this.actions.get(state);
  if (!nextAction) return;
  // ... rest unchanged
}
```

This means calling `playAttack('magic')` while magic attack is already playing is a no-op. The animation continues playing normally and returns to idle via the `finished` event listener.

**Exception — death:** `playDeath()` is already guarded by `if (this.currentState === 'death') return` checks in all calling methods, so the early return won't interfere.

**Exception — idle:** `playIdle()` is called from the `finished` event handler. If the current state is already `idle` (shouldn't happen but defensive), the early return harmlessly skips the redundant reset.

**Note:** The same bug exists in `PlayerAnimationController.ts:90-103` with an identical `crossFadeTo()` method. The same fix should be applied there for consistency, though the player attack spazzing may be less visible since player attacks have a longer cooldown.

## Implementation

### Phase 1: Fix Attack Animation (Bug 3)

**File: `src/render/AnimationController.ts`**

Add same-state guard to `crossFadeTo()`:

```typescript
private crossFadeTo(state: AnimState): void {
  if (state === this.currentState) return;

  const nextAction = this.actions.get(state);
  if (!nextAction) return;

  const prevAction = this.actions.get(this.currentState);
  this.currentState = state;

  nextAction.reset();
  nextAction.play();

  if (prevAction && prevAction !== nextAction) {
    nextAction.crossFadeFrom(prevAction, 0.1, false);
  }
}
```

**File: `src/render/PlayerAnimationController.ts`**

Apply the same guard for consistency:

```typescript
private crossFadeTo(state: PlayerAnimState): void {
  if (state === this.currentState) return;

  // ... rest unchanged
}
```

### Phase 2: Fix Boss Facing (Bug 2)

**File: `src/render/Renderer3D.ts`**

Change the boss yaw offset constant:

```typescript
const BOSS_MODEL_YAW_OFFSET = 0; // was Math.PI
```

Verify with screenshots. If the player also faces wrong, additionally change:

```typescript
const PLAYER_MODEL_YAW_OFFSET = 0; // was Math.PI
```

### Phase 3: Investigate and Fix Tornado Screen (Bug 1)

This phase requires investigation. Steps:

1. **Write a Playwright test** that advances the simulation to a tick where tornadoes are active and captures a screenshot.
2. **Check console output** for `[Renderer3D] Tornado GLTF loaded` vs the fallback warning.
3. **If GLTF loads successfully:** The issue is in `applyUnlitMaterials()` or the clone path. Inspect the cloned materials for broken texture references.
4. **If GLTF fails to load:** The fallback cone should render fine — check if the issue is the cone filling the viewport due to camera/scale issues.
5. **Apply fix** based on investigation findings.
6. **Verify** with before/after screenshots.

### Phase 4: Verification

1. Run `npm run build` and `npm test`.
2. Run `cd ../cg-sim-player && npm test`.
3. Capture Playwright screenshots:
   - Boss facing player from multiple angles.
   - Attack animation frames showing smooth progression (not restarting).
   - Tornado spawn moment showing correct rendering.
4. Verify idle and style-switch animations are unaffected.

## Files Summary

| File | Changes | Bug |
|------|---------|-----|
| `src/render/AnimationController.ts` | Add same-state guard in `crossFadeTo()` | Bug 3 |
| `src/render/PlayerAnimationController.ts` | Add same-state guard in `crossFadeTo()` | Bug 3 (consistency) |
| `src/render/Renderer3D.ts` | Change `BOSS_MODEL_YAW_OFFSET` to `0` | Bug 2 |
| `src/render/Renderer3D.ts` | Possibly change `PLAYER_MODEL_YAW_OFFSET` to `0` | Bug 2 (if needed) |
| `src/render/Renderer3D.ts` | Fix tornado rendering (TBD after investigation) | Bug 1 |
| `tests/` | New or updated Playwright screenshot tests | Verification |

## Definition of Done

1. **No mint green screen** when tornadoes spawn — tornadoes render as expected (GLTF model or fallback cone).
2. **Hunlef faces toward the player** during combat, verified from multiple positions via screenshots.
3. **Attack animations play smoothly** — calling `playAttack()` with the same style while it's already playing does not restart the animation.
4. **Idle animation** still loops correctly (no regression).
5. **Style-switch animations** still trigger on style changes (no regression).
6. **Death animation** still plays once and clamps (no regression).
7. **Player animations** (attack, eat, idle) still work correctly (no regression).
8. `npm run build` passes.
9. `npm test` passes.
10. `cd ../cg-sim-player && npm test` passes.
11. Frame rate stays above 30 fps.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bug 1 root cause differs from hypotheses | Medium | Medium | Investigation-first approach with screenshot capture before attempting fixes |
| Changing yaw offset breaks player facing too | Low | Low | Screenshot verification of both entities; symmetric fix if needed |
| Same-state guard prevents legitimate re-triggers | Low | Low | Attack animations return to idle via `finished` event, so next attack will transition from idle (different state) |
| Player `crossFadeTo` fix causes regression | Very Low | Low | Player animations have longer cooldowns; same logic as boss fix |

## Security

No security implications. All changes are to client-side rendering logic. No user input, network requests, or data persistence is affected.

## Dependencies

- No new npm dependencies.
- Existing Three.js r183 and GLTFLoader.
- Playwright + system Chrome for screenshot verification (already set up from Sprint 017).
- `cg-sim-player` test suite (read-only, never modified).

## Open Questions

1. **Bug 1 root cause:** Is the mint green screen caused by a failed GLTF texture load, a WebGL state issue, or something else? Needs investigation with screenshots before a definitive fix can be written.
2. **Player yaw offset:** Does `PLAYER_MODEL_YAW_OFFSET` also need to change to `0`, or is `Math.PI` correct for the player? Need screenshot verification.
3. **Same-state re-trigger semantics:** The proposed fix makes `playAttack('magic')` a no-op while magic attack is already playing. If the design intent is to *extend* or *restart* the attack animation on consecutive attacks, a different approach is needed (e.g., only skip if the animation is less than 50% complete). The intent doc suggests a complete no-op is correct.
