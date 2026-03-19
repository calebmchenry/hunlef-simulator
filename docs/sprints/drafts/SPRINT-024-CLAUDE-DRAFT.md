# Sprint 024: Player Animation Polish

## Goal
Get player animations visibly working (idle, attack, eat) and add a procedural running effect since no walk clip exists.

## Phase 1 — Fix idle-at-construction bug

**Problem:** `PlayerAnimationController` constructor (line 64) calls `this.playIdle()`, which calls `crossFadeTo('idle')`. But `currentState` is initialized to `'idle'` (line 27), so the same-state guard (`if (state === this.currentState) return`) makes it a no-op. The idle animation never starts playing. This is the same bug the boss `AnimationController` already fixed (lines 102-109).

**Fix:** Replace the `this.playIdle()` call in the constructor with a direct action start, matching the boss controller pattern:

```ts
// Start idle animation directly — bypass crossFadeTo's same-state guard
const idleAction = this.actions.get('idle');
if (idleAction) {
  idleAction.reset();
  idleAction.play();
  this.mixer.update(0);
}
```

**Files:** `src/render/PlayerAnimationController.ts`

## Phase 2 — Verify attack and eat triggers

The wiring in `Renderer3D.updatePlayerAnimations()` (line 1023) already triggers `playEat()` on `sim.playerAteThisTick` and `playAttack()` on projectile creation. After the Phase 1 fix, these should work because they transition away from a now-playing idle state.

**Verification:**
- Run the sim, eat food — confirm eat morph animation plays then returns to idle
- Attack the boss — confirm attack morph animation plays then returns to idle
- If transitions look wrong, check that `crossFadeTo` stop/reset ordering is correct (it matches the boss controller pattern, so should be fine)

**Files:** No changes expected — just manual verification.

## Phase 3 — Procedural running effect

No walk/run clip exists in the player GLTFs. Add a procedural bob+tilt to the player group when the player is moving between tiles.

**Approach:**
- In `Renderer3D.updatePlayer()`, detect movement: compare `player.prevPos` to `player.pos`
- When moving, apply a sinusoidal Y-axis bob and a slight forward tilt (X rotation) to the player group based on `tickProgress`
- When stationary, reset Y offset and tilt to 0
- Keep the effect subtle: ~0.03 units of bob, ~0.05 rad of tilt

```ts
// In updatePlayer(), after setting playerGroup position:
const isMoving = player.prevPos.x !== player.pos.x || player.prevPos.y !== player.pos.y;
if (isMoving) {
  const bobPhase = tickProgress * Math.PI; // half-cycle per tick
  this.playerGroup.position.y = Math.sin(bobPhase) * 0.03;
  this.playerGroup.rotation.x = Math.sin(bobPhase) * 0.05;
} else {
  this.playerGroup.position.y = 0;
  this.playerGroup.rotation.x = 0;
}
```

**Files:** `src/render/Renderer3D.ts` — `updatePlayer()` method

## Phase 4 — Tests

Add a unit test for `PlayerAnimationController` covering:
- Idle action is playing after construction (the bug fix)
- `playAttack()` transitions from idle, returns to idle on finish
- `playEat()` transitions from idle, returns to idle on finish

**Files:** New test file `src/render/__tests__/PlayerAnimationController.test.ts`

## Definition of Done

- [ ] Player idle animation visibly plays when standing still
- [ ] Player attack animation plays when attacking the boss
- [ ] Player eat animation plays when consuming food
- [ ] Player has visible bob/tilt when moving between tiles
- [ ] Animations transition cleanly between states
- [ ] All tests pass, build succeeds
