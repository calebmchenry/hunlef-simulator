# Sprint 024: Player Animation Polish

## Overview

Get player animations visibly working (idle, attack, eat) and add a procedural running effect. The animation infrastructure exists but the idle never starts due to a constructor bug, and there's no walk clip so movement needs a procedural approach.

**What ships**: Working idle/attack/eat animations, procedural run bob+tilt.

## Implementation

### Task 1: Fix idle-at-construction bug

**File:** `src/render/PlayerAnimationController.ts`

Same bug as boss had (fixed in Sprint 023). The constructor sets `currentState = 'idle'` then calls `playIdle()` → `crossFadeTo('idle')`, which no-ops due to the same-state guard. The idle action never gets `.play()` called.

Fix: Replace `this.playIdle()` in the constructor with direct action start:
```ts
const idleAction = this.actions.get('idle');
if (idleAction) {
  idleAction.reset();
  idleAction.play();
  this.mixer.update(0);
}
```

### Task 2: Verify attack and eat triggers

**File:** No changes expected — manual verification only.

`Renderer3D.updatePlayerAnimations()` already triggers:
- `playEat()` on `sim.playerAteThisTick`
- `playAttack()` on `didPlayerAttackThisTick()`

After Task 1 fix, these should work because they transition away from a now-playing idle. Verify visually:
- Eat food → eat animation plays, returns to idle
- Attack boss → attack animation plays, returns to idle

### Task 3: Procedural running effect

**File:** `src/render/Renderer3D.ts` — in `updatePlayer()`

No walk/run clip exists in the GLTFs. Add a subtle procedural bob + forward tilt when the player is moving between tiles:

- Detect movement: compare player's previous and current position
- When moving: apply sinusoidal Y bob (~0.03 units) and slight X-axis rotation (~0.05 rad forward lean) based on `tickProgress`
- When stationary: smoothly reset to neutral
- Effect should be additive — doesn't replace morph animations, just moves the player group

## Files Summary

| File | Change |
|------|--------|
| `src/render/PlayerAnimationController.ts` | Fix constructor to directly play idle action (bypass same-state guard) |
| `src/render/Renderer3D.ts` | Add procedural bob/tilt in `updatePlayer()` when player is moving |

## Definition of Done

- [ ] Player idle animation visibly loops while standing still (including immediately after construction)
- [ ] Player attack animation plays when attacking the boss, returns to idle
- [ ] Player eat animation plays when consuming food, returns to idle
- [ ] Player has visible procedural bob/tilt when running between tiles
- [ ] Bob/tilt resets to neutral when player stops moving
- [ ] Animations work across all 3 weapon variants (bow, staff, halberd)
- [ ] All 193 tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Morph target animations don't visually show | Low | The clips exist and validate passes; if invisible, check morph influence scale |
| Procedural bob conflicts with position interpolation | Low | Bob is applied to Y offset after position is set; keep amplitude small |
| Weapon switch during animation looks glitchy | Low | `setPlayerModel()` recreates the controller, which will start idle cleanly after Task 1 fix |
