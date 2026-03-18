# Sprint 012: Fix Eat Delay Mechanic

## Overview

Eating standard food (paddlefish) blocks the player's attack on the eat tick but does NOT delay the next attack. In real OSRS, eating non-combo food sets `attackCooldown = max(attackCooldown, 3)`, meaning the next attack is delayed by 3 ticks from the eat tick. Currently the player fires as early as 1 tick after eating, producing 780 `attack_cooldown` warnings across 100 cg-sim-player seeds.

**Root cause:** `processInventoryAction()` sets `playerAteThisTick = true` (L586) which blocks the attack on the current tick (L397), but never pushes `attackCooldown` forward. The attack fires on the very next tick.

**Fix:** Add `player.attackCooldown = Math.max(player.attackCooldown, 3)` in step 6 of tick processing, AFTER the cooldown decrement and BEFORE the attack gate. This placement is critical — putting it in `processInventoryAction()` (step 1b) would cause an off-by-one error because the decrement at L394 runs after step 1b, consuming one tick of delay on the eat tick itself.

## Use Cases

1. **Eat at cooldown=0** — Player eats, cooldown set to 3 (after decrement). Next attack fires 3 ticks later. This is the common case producing current warnings.
2. **Eat at cooldown >= 3** — `max(cd_after_decrement, 3)` = no change. Eat is "free" in terms of DPS.
3. **Eat at cooldown=1 or 2** — Delay extended to 3 ticks total from eat tick.
4. **Combo food (corrupted paddlefish)** — No delay. `playerAteThisTick` is not set for combo food, so the cooldown push doesn't trigger.
5. **Combo eat (standard + corrupted same tick)** — Standard sets 3-tick delay. Corrupted adds nothing.
6. **Eat at full HP** — Early return at L581 prevents food consumption and `playerAteThisTick` from being set. No delay.
7. **Eat while out of range** — Delay applies to cooldown regardless. When player reaches range, cooldown may have already elapsed.

## Architecture

### Tick processing order (relevant excerpt)

```
Step 1b (L217-221): Process inventory actions
  → eat sets playerAteThisTick = true (L586)
  → does NOT touch attackCooldown

[Steps 2-5: prayer drain, movement, floor hazards, boss attack]

Step 6 (L394-397): Player attack resolution
  L394: if (attackCooldown > 0) attackCooldown--    ← decrement first
  NEW:  if (playerAteThisTick) attackCooldown = max(attackCooldown, 3)  ← eat delay AFTER decrement
  L397: if (target && cooldown <= 0 && !ateThisTick) → fire attack
```

### Why the fix goes AFTER the decrement (not in step 1b)

If placed in `processInventoryAction()` (step 1b), the decrement at L394 runs after and consumes one tick of delay:
- Step 1b: eat, cooldown = max(0, 3) = 3
- Step 6: decrement 3→2, then 2→1, then 1→0 = attack on tick N+2 (**wrong, only 2 ticks**)

Placed after the decrement in step 6:
- Step 6: decrement 0→0 (guarded), eat delay max(0, 3) = 3
- Next ticks: 3→2→1→0 = attack on tick N+3 (**correct, 3 ticks**)

### Verification walkthrough: eat at cooldown=0

```
Tick N (eat tick):
  Step 1b: eat paddlefish, playerAteThisTick = true
  Step 6:  decrement: cd=0, guard (>0) fails, stays 0
           eat delay: max(0, 3) = 3
           attack gate: cd=3, blocked (also blocked by playerAteThisTick)

Tick N+1: decrement 3→2, attack gate blocked (cd > 0)
Tick N+2: decrement 2→1, attack gate blocked (cd > 0)
Tick N+3: decrement 1→0, attack gate passes → player attacks ✓
```

## Implementation

### Phase 1: Fix Eat Delay (~30% of effort)

**File:** `src/engine/GameSimulation.ts`

**Tasks:**
- [ ] Add eat delay cooldown push between the decrement and the attack gate in step 6 (between L396 and L397):

```typescript
// 6. Player attack resolution — only when target is set
if (this.player.attackCooldown > 0) {
  this.player.attackCooldown--;
}
// OSRS eat delay: standard food delays next attack by 3 ticks.
// Applied after decrement so the eat tick's decrement doesn't consume a delay tick.
if (this.playerAteThisTick) {
  this.player.attackCooldown = Math.max(this.player.attackCooldown, 3);
}
if (this.player.attackTarget === 'boss' && this.player.attackCooldown <= 0 && !this.playerAteThisTick) {
```

Note: the `!this.playerAteThisTick` guard on the attack gate is now redundant for timing (cooldown is guaranteed >= 3 when `playerAteThisTick` is true), but kept for defensive correctness and semantic clarity.

### Phase 2: Fix Boss.reset() Hardcode (~5% of effort)

**File:** `src/entities/Boss.ts`

**Tasks:**
- [ ] Change line 122 in `reset()` from `this.attackCooldown = 5` to `this.attackCooldown = this.attackSpeed`

This is a correctness fix — `reset()` should use the same `attackSpeed` readonly property that `fireAttack()` uses (L101), not a hardcoded literal.

### Phase 3: Update INTENT.md (~5% of effort)

**File:** `docs/INTENT.md`

**Tasks:**
- [ ] Update line 15 eat delay description:
  - From: "Eating standard food occupies the action slot for that tick"
  - To: "Eating standard food delays the player's next attack by 3 ticks (attackCooldown = max(current, 3))"
- [ ] Update fish table (~line 92-96): Change Paddlefish eat delay from "1 tick" to "3 ticks"

### Phase 4: Tests (~50% of effort)

**File:** `src/__tests__/inventory.test.ts`

**Tasks:**
- [ ] Test: eating paddlefish at cooldown=0 delays next attack by exactly 3 ticks (tick-by-tick verification showing cooldown values 3, 2, 1, 0 across 4 processTick calls)
- [ ] Test: eating with cooldown >= 3 does not increase cooldown (max semantics, not additive)
- [ ] Test: corrupted paddlefish does NOT set eat delay (cooldown stays at 0)
- [ ] Test: eating at full HP does not trigger eat delay or consume food
- [ ] Test: combo eating — standard food sets 3-tick delay, corrupted adds nothing
- [ ] Test: Boss.reset() sets attackCooldown to attackSpeed

### Phase 5: Validation (~10% of effort)

**Tasks:**
- [ ] `npm run build` succeeds
- [ ] `npm test` — all existing 178 tests pass + new tests pass
- [ ] `cd ../cg-sim-player && npm run run -- --fights 100 --start-seed 1` — target 0 `attack_cooldown` warnings
- [ ] `cd ../cg-sim-player && npm test` — all 47 tests pass

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/engine/GameSimulation.ts` | Modify (3 lines added between L396-397) | Add eat delay cooldown push after decrement, before attack gate |
| `src/entities/Boss.ts` | Modify (L122) | Change hardcoded `5` to `this.attackSpeed` in `reset()` |
| `docs/INTENT.md` | Modify (L15, L92-96) | Update eat delay description and fish table |
| `src/__tests__/inventory.test.ts` | Modify (add ~6 tests) | Eat delay and Boss.reset() tests |

## Definition of Done

- [ ] Eating standard food sets `attackCooldown = max(attackCooldown, 3)` AFTER the cooldown decrement in step 6
- [ ] Player cannot attack until 3 full ticks after eating (verified by tick-by-tick test)
- [ ] Eating combo food (corrupted paddlefish) does NOT modify `attackCooldown`
- [ ] Eating at full HP does not trigger eat delay or consume food
- [ ] Eating with cooldown >= 3 does not increase cooldown (max, not additive)
- [ ] `Boss.reset()` uses `this.attackSpeed` instead of hardcoded `5`
- [ ] INTENT.md updated: eat delay description (L15) and fish table (L92-96)
- [ ] All cg-sim tests pass (178 existing + ~6 new)
- [ ] `npm run build` succeeds
- [ ] cg-sim-player 100-seed run reports 0 `attack_cooldown` warnings
- [ ] cg-sim-player tests all pass (47)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Off-by-one: fix placed in wrong location produces 2-tick delay | High if misplaced | High | Fix goes AFTER the decrement in step 6, NOT in processInventoryAction. Tick-by-tick test verifies exact timing. |
| Eat delay changes fight outcomes, breaking integration tests | Medium | Medium | Integration tests assert ranges, not exact values. Deterministic seeds produce same RNG sequences. Review assertions. |
| cg-sim-player validator still flags warnings after fix | Medium | Low | The validator's additive formula may not perfectly match `max(cd,3)` semantics. If warnings persist, they're false positives in the validator — note as known issue, do not modify cg-sim-player. |
| DPS loss from eat delay makes fights harder | Low | Low | The bot currently wins 100/100. 3-tick delay per eat is small (~10 eats/fight = ~30 ticks lost max). The effect is minor. |
| `playerAteThisTick` gate becomes redundant | Low | Low | Keep it for defensive correctness. With eat delay, cooldown is always >= 3 when ate=true, so `cooldown <= 0` is false regardless. But the guard costs nothing and documents intent. |

## Security Considerations

No security surface changes. All modifications are local combat simulation logic. No new dependencies, network requests, or user input handling.

## Dependencies

- No new dependencies required
- Cross-project validation: cg-sim-player used for validation only (never modified)

## Open Questions

1. **Resolved: Boss attack speed** — Confirmed at 5 ticks per user (matches wiki for Corrupted Hunlef). No change needed.
2. **Resolved: cg-sim-player modifications** — Never modify cg-sim-player. Use for validation only.
3. **If cg-sim-player warnings persist after fix** — The validator uses an additive formula that may not perfectly model `max(cd, 3)`. Any remaining warnings are false positives in the validator. Note in the sprint summary but do not modify cg-sim-player.
