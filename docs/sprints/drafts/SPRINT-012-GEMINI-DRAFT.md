# Sprint 012: Eat Delay Mechanic & Boss Attack Speed Fidelity

## Overview

This sprint addresses two combat fidelity issues flagged by the cg-sim-player validation harness:

1. **Eat delay is not enforced.** In OSRS, eating standard (non-combo) food resets the player's attack cooldown to `max(attackCooldown, 3)`. The current implementation only blocks the attack on the eat tick itself (via `playerAteThisTick`), meaning the player can attack as early as 1 tick after eating. This is the root cause of the 780 `attack_cooldown` warnings seen across 100 seeds.

2. **Boss attack speed may be wrong.** `Boss.ts` uses `attackSpeed = 5` (3.0s). The OSRS wiki documents Corrupted Hunlef at 6 ticks (3.6s). The project INTENT.md specifies 5 ticks. A decision is needed, and regardless of the outcome, `Boss.reset()` on line 122 hardcodes `this.attackCooldown = 5` instead of referencing `this.attackSpeed`.

### Key observation: the cg-sim-player validator has a mismatch too

The `attackCooldownValidator` in cg-sim-player (line 64-65 of `attackCooldown.ts`) computes expected interval as:
```
expectedInterval = reference.player.attackSpeedTicks + eatDelayTicks
```
where `eatDelayTicks` is the count of ticks with `playerAteThisTick` in the interval. This assumes each eat event adds exactly 1 tick of delay. But the real OSRS mechanic (`max(cooldown, 3)`) adds 0-3 ticks depending on *when* in the attack cycle the player eats. The validator formula only produces correct results when the player eats exactly once per interval and does so on the tick the attack would have fired (cooldown=0, so `max(0,3)=3`, adding 3 ticks minus the base 4 means... it does not work cleanly). **This validator will likely still flag false positives after the sim fix unless it is also updated.** This is the most important cross-project coordination point.

## Use Cases

1. **Eat at cooldown=0 (attack would fire this tick):** Eat delays next attack by 3 full ticks. This is the common case that produces the current warnings.
2. **Eat at cooldown=1:** `max(1, 3) = 3`, adding 2 ticks of delay beyond what the cooldown already imposed.
3. **Eat at cooldown=2:** `max(2, 3) = 3`, adding 1 tick of delay.
4. **Eat at cooldown >= 3:** No additional delay. `max(cd, 3) = cd`. The eat is "free" in terms of DPS.
5. **Eat at full HP:** `processInventoryAction` returns early at line 581 (`if (player.hp >= player.maxHp) return`). No food is consumed, no `playerAteThisTick`, no cooldown push. This is correct -- no delay should apply when no eat actually happens.
6. **Combo food (corrupted paddlefish):** Guarded by `if (!action.comboFood)` at line 585. No delay. Unchanged.
7. **Combo eat (standard + corrupted same tick):** Standard sets `max(cd, 3)`, corrupted does nothing. Net delay comes from standard only.
8. **Eat while out of range:** Delay still applies to cooldown. When player eventually reaches range, cooldown may have already elapsed.
9. **Multiple standard eats in one tick:** Not possible in the current system (inventory action queue processes one eat, the second would be at full HP or same slot). But if it were, `max(max(cd, 3), 3) = max(cd, 3)` -- idempotent. No stacking.

## Architecture

### Tick processing order (relevant excerpt)

```
Step 1b (L217-221): Process inventory actions (eat happens here, sets playerAteThisTick)
Step 6 (L394-397):  Player attack resolution:
                      L394: if (attackCooldown > 0) attackCooldown--
                      L397: if (target && cooldown <= 0 && !ateThisTick) → fire attack
```

### Off-by-one analysis

With the fix, eating at cooldown=0 on tick N:
- Step 1b: `player.attackCooldown = max(0, 3) = 3`, `playerAteThisTick = true`
- Step 6: `attackCooldown > 0` is true, so `attackCooldown-- → 2`. Attack gate also blocked by `playerAteThisTick`.
- Tick N+1: Step 6 decrements `2 → 1`. Gate blocked by cooldown > 0.
- Tick N+2: Step 6 decrements `1 → 0`. Gate passes (cooldown=0, ate=false, target=boss). Player attacks.

Result: Player attacks on tick N+2, which is **2 ticks after** eating, not 3. This is because the decrement on the eat tick itself counts as one of the 3 ticks. The eat delay in OSRS means "3 ticks including the eat tick" (i.e., the attack timer is set to 3 and counts down from there, with the first countdown happening on the eat tick).

**This is correct OSRS behavior.** In OSRS, if you eat on tick 0, your next attack is tick 3 (0→3, tick 0 decrements to 2, tick 1→1, tick 2→0, attack fires tick 2... wait, that's tick 2 not tick 3).

Let me re-examine. The key question is: does the cooldown decrement happen on the same tick as the eat, or the next tick?

In the current code, step 6 runs AFTER step 1b. On the eat tick:
- Eat sets cooldown to 3
- Step 6 decrements to 2
- Step 6 checks cooldown <= 0: NO (it's 2), so no attack

Tick N+1: decrement 2→1, no attack
Tick N+2: decrement 1→0, attack fires

That's N+2, meaning 2 ticks after eating. In OSRS the eat delay is described as "3 game ticks" meaning the player cannot attack for 3 ticks (the eat tick plus 2 more). The next attack fires on the **3rd tick after** eating if we count zero-indexed, or the **4th tick** in 1-indexed terms... This gets confusing.

**OSRS wiki states:** "Eating most foods will delay your next attack by 3 ticks." If you were about to attack on tick 100 and you eat instead, your next attack is tick 103. That means:
- Tick 100: eat (no attack)
- Tick 101: no attack
- Tick 102: no attack
- Tick 103: attack fires

With `max(cd, 3)` and the current decrement-on-same-tick ordering, we get attack on tick 102 (N+2). This is **one tick too early**.

**Fix: use `max(attackCooldown, 3)` but ensure the eat-tick decrement doesn't count.** There are two approaches:

**Option A:** Move the eat delay assignment to AFTER the cooldown decrement in step 6. This means: step 6 decrements cooldown (3→2 doesn't happen because eat hasn't set it yet; it's still 0→stays at 0 since the `if > 0` guard), then eat sets it to 3. Next tick decrements 3→2, then 2→1, then 1→0 = attack on N+3. Correct.

But this requires restructuring: inventory actions currently run in step 1b, well before step 6. Moving just the cooldown assignment is awkward.

**Option B:** Set cooldown to `max(attackCooldown, 3) + 1` to account for the same-tick decrement. This would be a hack.

**Option C (recommended):** Move the eat delay cooldown push to run alongside the attack gate in step 6, AFTER the decrement. Something like:

```typescript
// Step 6
if (this.player.attackCooldown > 0) {
  this.player.attackCooldown--;
}
// Apply eat delay AFTER decrement
if (this.playerAteThisTick) {
  this.player.attackCooldown = Math.max(this.player.attackCooldown, 3);
}
```

With this approach, on the eat tick (cooldown was 0):
- Decrement: 0 stays 0 (guarded by > 0)
- Eat delay: `max(0, 3) = 3`
- Attack gate: cooldown is 3, blocked

Tick N+1: decrement 3→2, blocked
Tick N+2: decrement 2→1, blocked
Tick N+3: decrement 1→0, attack fires

Result: attack on N+3. **Correct.**

If cooldown was already 2 before eating:
- Decrement: 2→1
- Eat delay: `max(1, 3) = 3`
- Tick N+1: 3→2
- Tick N+2: 2→1
- Tick N+3: 1→0, attack

Also correct -- eating pushed the timer forward.

## Implementation

### Phase 1: Fix Eat Delay in cg-sim (~30% of effort)

**File:** `src/engine/GameSimulation.ts`

**Task 1.1: Add eat delay cooldown push in player attack resolution (step 6)**

At lines 394-397, restructure to apply eat delay between decrement and attack gate:

Current code (lines 394-397):
```typescript
if (this.player.attackCooldown > 0) {
  this.player.attackCooldown--;
}
if (this.player.attackTarget === 'boss' && this.player.attackCooldown <= 0 && !this.playerAteThisTick) {
```

New code:
```typescript
if (this.player.attackCooldown > 0) {
  this.player.attackCooldown--;
}
// OSRS eat delay: standard food delays next attack by 3 ticks from the eat tick.
// Applied after decrement so the eat tick's decrement doesn't consume a delay tick.
if (this.playerAteThisTick) {
  this.player.attackCooldown = Math.max(this.player.attackCooldown, 3);
}
if (this.player.attackTarget === 'boss' && this.player.attackCooldown <= 0 && !this.playerAteThisTick) {
```

Note: the `!this.playerAteThisTick` guard on the attack gate is now truly redundant (if `playerAteThisTick` is true, cooldown is guaranteed >= 3, so `attackCooldown <= 0` is false). However, keeping it is good defensive practice and documents intent.

**Task 1.2: Do NOT put the cooldown push in `processInventoryAction()`**

The Claude draft proposes adding the push at line 587 inside `processInventoryAction()`. I recommend against this because of the off-by-one issue described above: the decrement at line 394 runs after the eat action, consuming one tick of the delay on the eat tick itself. Placing the push after the decrement in step 6 produces the correct 3-tick delay.

### Phase 2: Fix Boss.reset() hardcoded value (~5% of effort)

**File:** `src/entities/Boss.ts`

**Task 2.1: Change `reset()` to use `this.attackSpeed`**

Line 122 currently reads:
```typescript
this.attackCooldown = 5;
```

Change to:
```typescript
this.attackCooldown = this.attackSpeed;
```

This is a correctness fix regardless of whether boss speed stays at 5 or changes to 6. The `attackSpeed` readonly property is defined on line 17 and used in `fireAttack()` on line 101. `reset()` should use it too.

### Phase 3: Boss Attack Speed Decision (~10% of effort)

**Task 3.1: Decide 5 vs 6 ticks**

This is a design decision. My recommendation: **keep 5 ticks for now** with a comment noting the OSRS wiki discrepancy. Reasons:
- INTENT.md explicitly specifies 5 ticks and the entire simulation was designed around it
- The cg-sim-player bot strategy, fight pacing, prayer drain calculations, and DPS estimates are all tuned for 5-tick boss speed
- Changing to 6 ticks is a separate balance change that should be its own sprint with full regression analysis
- The simulator already deviates from OSRS in other minor ways (fixed arena, no pillars, etc.)

If the decision is to change to 6 ticks, update:
| File | Location | Change |
|------|----------|--------|
| `src/entities/Boss.ts` | L16: `attackCooldown` initial value | `5` to `6` |
| `src/entities/Boss.ts` | L17: `readonly attackSpeed` | `5` to `6` |
| `docs/INTENT.md` | L123: Attack Speed row | `5 ticks (3.0 s)` to `6 ticks (3.6 s)` |
| `cg-sim-player/.../reference.ts` | L67: `attackSpeedTicks` | `5` to `6` |

Note: `Boss.reset()` line 122 is covered by Task 2.1 (uses `this.attackSpeed`).

### Phase 4: Update INTENT.md eat delay description (~5% of effort)

**File:** `docs/INTENT.md`

**Task 4.1: Update line 15**

Current text:
> Eating standard food occupies the action slot for that tick; combo food (corrupted paddlefish) can be eaten the same tick as a regular fish with no delay

Updated text:
> Eating standard food delays the player's next attack by 3 ticks (attackCooldown = max(current, 3)); combo food (corrupted paddlefish) can be eaten the same tick as a regular fish with no attack delay

**Task 4.2: Update the Fish table (around line 92-96)**

The `Eat Delay` column currently shows `1 tick` for Paddlefish. This should be `3 ticks` to match the actual mechanic.

### Phase 5: Update cg-sim-player validator and reference (~20% of effort)

**File:** `cg-sim-player/src/report/mechanics/validators/attackCooldown.ts`

**Task 5.1: Fix the player attack interval validation logic**

The current validator logic (lines 64-65) is:
```typescript
const eatDelayTicks = intervalRows.filter((row) => row.playerAteThisTick).length;
const expectedInterval = reference.player.attackSpeedTicks + eatDelayTicks;
```

This assumes each eat event adds exactly 1 tick. With the `max(cooldown, 3)` mechanic, the actual delay depends on when in the cycle the eat happens. The validator needs to simulate the cooldown to compute the correct expected interval.

Proposed replacement logic:
```typescript
// Simulate cooldown progression between attacks to compute expected interval
let simulatedCooldown = reference.player.attackSpeedTicks; // set after previous attack
for (const row of intervalRows) {
  if (simulatedCooldown > 0) simulatedCooldown--;
  if (row.playerAteThisTick) {
    simulatedCooldown = Math.max(simulatedCooldown, 3);
  }
}
// The attack fires when simulatedCooldown reaches 0
// The expected interval is the number of ticks we iterated
const expectedInterval = intervalRows.length;
// But we need to check: did the cooldown actually reach 0?
```

Actually, a cleaner approach: compute expected interval by simulating tick-by-tick:

```typescript
let cd = reference.player.attackSpeedTicks;
let expectedInterval = 0;
for (const row of intervalRows) {
  expectedInterval++;
  if (cd > 0) cd--;
  if (row.playerAteThisTick) {
    cd = Math.max(cd, 3);
  }
  if (cd <= 0) break;
}
```

This mirrors the sim's actual tick processing order (decrement, then eat delay, then check). Wait -- the eat delay is applied after decrement in the sim (per our Phase 1 fix), but the validator iterates row-by-row. The order within each row matters.

Given the complexity, the simplest correct approach is:

```typescript
// After fixing the sim, the eat delay is applied post-decrement in step 6.
// Simulate the same ordering to predict the expected interval.
let cd = reference.player.attackSpeedTicks; // cooldown set when previous attack fired
let ticksElapsed = 0;
for (const row of intervalRows) {
  // Decrement
  if (cd > 0) cd--;
  // Eat delay (applied after decrement, matching sim step 6)
  if (row.playerAteThisTick) {
    cd = Math.max(cd, 3);
  }
  ticksElapsed++;
  if (cd <= 0) break;
}
const expectedInterval = ticksElapsed;
```

If the loop exhausts all rows without cd reaching 0, the interval should equal `intervalRows.length` and it may or may not match (this handles cases where the player walked out of range mid-interval, which is already filtered by the `ambiguous` check).

**File:** `cg-sim-player/src/report/mechanics/reference.ts`

**Task 5.2: Add eat delay constant to reference**

Add a new field to the `MechanicsReference` interface and implementation:

```typescript
// In the interface, under player:
eatDelayTicks: number;

// In the implementation:
eatDelayTicks: 3,
```

This makes the magic number `3` configurable and documents it as part of the oracle.

**File:** `cg-sim-player/src/report/mechanics/validators/attackCooldown.ts`

**Task 5.3: Use `reference.player.eatDelayTicks` in the simulation loop**

Replace the hardcoded `3` in the simulation with `reference.player.eatDelayTicks`.

### Phase 6: Update cg-sim-player bot strategy (~10% of effort)

**File:** `cg-sim-player/src/bot/TickPlanner.ts`

**Task 6.1: Review bot eat timing heuristic**

Line 107 currently reads:
```typescript
snapshot.playerAttackCooldown > 1
```

This means the bot only eats when cooldown > 1 (i.e., at least 2 ticks until the next attack). With the eat delay fix, eating at cooldown=2 means: decrement 2→1, eat delay `max(1,3)=3`, then 3 more ticks = total 4 ticks until attack. This is worse than not eating (would have been 2 ticks).

The bot should be smarter. Optimal strategy: eat immediately AFTER attacking (when cooldown is at its maximum, e.g., 4 for a 4-tick weapon), so the eat delay's `max(cd, 3)` has no effect (`max(3, 3) = 3`, since one decrement already happened). This means the condition should be:

```typescript
snapshot.playerAttackCooldown >= 3
```

At cooldown=3 (right after the first decrement post-attack): eat sets `max(2 [after decrement], 3) = 3`. Then 3→2→1→0 = 3 more ticks, same as if no eat happened (the attack was already 3 ticks away after decrement). Wait, without eating it would be 2 more ticks (2→1→0), so eating DID add 1 tick. Let me recalculate.

If player attacks on tick T, cooldown = 4.
- Tick T+1: decrement 4→3. If bot eats: `max(3, 3) = 3`. No change.
- Tick T+2: decrement 3→2.
- Tick T+3: decrement 2→1.
- Tick T+4: decrement 1→0. Attack fires.

Without eating on T+1: same result -- attack on T+4. **Zero DPS loss.** This is the ideal eat timing.

If bot eats on tick T+2 (cooldown was 3, decremented to 2, then `max(2, 3) = 3`):
- Tick T+3: 3→2
- Tick T+4: 2→1
- Tick T+5: 1→0. Attack fires on T+5 instead of T+4. **1 tick lost.**

So the optimal condition is: eat when `attackCooldown >= 4` (before the first decrement, which means right after the attack -- but on the next tick). Actually, the snapshot's `playerAttackCooldown` is read before `processTick`, so if the player just attacked, the cooldown is 4 (set at L491). The bot plans on the pre-tick snapshot.

Sequence:
- Player attacks on tick T: cooldown set to 4
- Pre-tick T+1 snapshot: cooldown = 4. Bot plans eat.
- Tick T+1 step 1b: eat happens, `playerAteThisTick = true`
- Tick T+1 step 6: decrement 4→3, eat delay `max(3, 3) = 3`. No change.
- Tick T+2: 3→2
- Tick T+3: 2→1
- Tick T+4: 1→0, attack. Same as without eating.

So the optimal heuristic is `snapshot.playerAttackCooldown >= 4` for zero-cost eating. The current `> 1` (i.e., `>= 2`) causes DPS loss.

**However**, changing to `>= 4` means the bot can only eat on one specific tick per cycle, which may not be sufficient for emergency eating. The current emergency eat path (lines 52-58) does NOT check cooldown, which is correct -- survival takes priority over DPS.

Recommended change for non-emergency eating (line 107):
```typescript
snapshot.playerAttackCooldown >= reference.player.attackSpeedTicks
```

Wait, the bot doesn't have access to `reference`. Use the literal:
```typescript
snapshot.playerAttackCooldown >= 4
```

Or better, since the bot reads `attackCooldown` from the snapshot and we know weapon speed is 4:
```typescript
snapshot.playerAttackCooldown > 3
```

This is `>= 4` equivalently, meaning the bot eats only on the tick immediately after attacking.

**This is a quality-of-life improvement for the bot, not strictly required.** The bot wins 100/100 currently. With the eat delay fix and current `> 1` heuristic, it may still win 100/100 since the DPS loss per eat is small. Monitor after the sim fix and tighten if needed.

### Phase 7: Tests (~20% of effort)

**File:** `src/__tests__/inventory.test.ts` (or new test file if appropriate)

**Task 7.1: Test eat at cooldown=0 delays attack by exactly 3 ticks**

```typescript
it('eating paddlefish at cooldown=0 delays next attack by 3 ticks', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 0;
  sim.player.attackTarget = 'boss';
  sim.boss.attackCooldown = 100;
  // Position player in range
  sim.player.pos = { x: 1, y: 1 };

  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick(); // Tick N: eat, cooldown set to 3 after decrement
  expect(sim.player.attackCooldown).toBe(3);

  sim.processTick(); // N+1: cooldown 3→2
  expect(sim.player.attackCooldown).toBe(2);

  sim.processTick(); // N+2: cooldown 2→1
  expect(sim.player.attackCooldown).toBe(1);

  // N+3: cooldown 1→0, attack fires, cooldown reset to weapon speed (4)
  sim.processTick();
  expect(sim.player.attackCooldown).toBe(4);
});
```

**Task 7.2: Test eat at cooldown >= 3 does not extend delay**

```typescript
it('eating with cooldown >= 3 does not increase cooldown', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 4;
  sim.boss.attackCooldown = 100;
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  // Decrement 4→3, eat delay max(3,3)=3, no change
  expect(sim.player.attackCooldown).toBe(3);
});
```

**Task 7.3: Test combo food does not apply eat delay**

```typescript
it('corrupted paddlefish does not set eat delay', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 0;
  sim.boss.attackCooldown = 100;
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  expect(sim.player.attackCooldown).toBe(0);
});
```

**Task 7.4: Test eating at full HP does nothing**

```typescript
it('eating at full HP does not consume food or set eat delay', () => {
  const sim = createSim();
  sim.player.hp = 99; // full HP
  sim.player.attackCooldown = 0;
  sim.boss.attackCooldown = 100;
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  const slotsBefore = sim.player.inventory.slots.filter(s => s !== null).length;
  sim.useInventoryItem(idx);
  sim.processTick();
  expect(sim.player.attackCooldown).toBe(0);
  expect(sim.playerAteThisTick).toBe(false);
  expect(sim.player.inventory.slots.filter(s => s !== null).length).toBe(slotsBefore);
});
```

**Task 7.5: Test combo eating (standard + corrupted same tick)**

```typescript
it('combo eating: standard food sets 3-tick delay, corrupted adds nothing', () => {
  const sim = createSim();
  sim.player.hp = 50;
  sim.player.attackCooldown = 0;
  sim.boss.attackCooldown = 100;
  const paddleIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  const corruptedIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
  sim.useInventoryItem(paddleIdx);
  sim.useInventoryItem(corruptedIdx);
  sim.processTick();
  // Standard food triggers eat delay: decrement 0→0 (guarded), eat delay max(0,3)=3
  expect(sim.player.attackCooldown).toBe(3);
});
```

**Task 7.6: Test Boss.reset() uses attackSpeed**

```typescript
it('Boss.reset() sets attackCooldown to attackSpeed', () => {
  const boss = new Boss({ x: 3, y: 3 });
  boss.attackCooldown = 1;
  boss.reset({ x: 3, y: 3 });
  expect(boss.attackCooldown).toBe(boss.attackSpeed);
});
```

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `cg-sim/src/engine/GameSimulation.ts` | Modify L394-397 | Add eat delay cooldown push between decrement and attack gate |
| `cg-sim/src/entities/Boss.ts` | Modify L122 | Change hardcoded `5` to `this.attackSpeed` in `reset()` |
| `cg-sim/docs/INTENT.md` | Modify L15, L92-96 | Update eat delay description from "1 tick" to "3 ticks" |
| `cg-sim/src/__tests__/inventory.test.ts` | Modify (add 6 tests) | Eat delay edge case tests |
| `cg-sim-player/src/report/mechanics/reference.ts` | Modify interface + impl | Add `eatDelayTicks: 3` to player section |
| `cg-sim-player/src/report/mechanics/validators/attackCooldown.ts` | Modify L60-66 | Replace additive formula with cooldown simulation loop |
| `cg-sim-player/src/bot/TickPlanner.ts` | Modify L107 | Tighten eat timing heuristic (optional, if win rate drops) |

## Definition of Done

- [ ] Eating standard food sets `attackCooldown = max(attackCooldown, 3)` AFTER the cooldown decrement in step 6
- [ ] Player cannot attack until 3 full ticks after eating (verified by tick-by-tick test)
- [ ] Eating at full HP does not trigger eat delay or consume food
- [ ] Combo food does not trigger eat delay
- [ ] `Boss.reset()` uses `this.attackSpeed` instead of hardcoded `5`
- [ ] Boss attack speed decision documented (keep 5 or change to 6)
- [ ] INTENT.md updated: eat delay description and fish table
- [ ] cg-sim-player `attackCooldownValidator` updated with simulation-based expected interval
- [ ] cg-sim-player `reference.ts` includes `eatDelayTicks: 3`
- [ ] All cg-sim tests pass (178 existing + ~6 new)
- [ ] All cg-sim-player tests pass (47 existing, update `attackCooldown.test.ts` if needed)
- [ ] `npm run build` succeeds in both projects
- [ ] cg-sim-player 100-seed run reports 0 `attack_cooldown` warnings

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Off-by-one in eat delay timing (2 ticks instead of 3) | High if placed in `processInventoryAction` | High | Place the cooldown push AFTER the decrement in step 6 (L394-397), not in step 1b. Verify with tick-by-tick test. |
| cg-sim-player validator still produces false positives after sim fix | High | Medium | Update the validator to simulate cooldown progression instead of using the additive formula. The additive formula is fundamentally wrong for `max(cd, 3)` semantics. |
| Bot win rate drops below 100% due to DPS loss from eat delay | Medium | Medium | Monitor after fix. If needed, tighten the bot's eat timing to `attackCooldown >= 4` (eat only right after attacking). Emergency eats should bypass the heuristic as they already do. |
| Changing boss speed to 6 ticks cascades across both projects | Low (if we keep 5) | High | Recommend keeping 5 ticks for now. If changed, update Boss.ts (2 locations), INTENT.md, and cg-sim-player reference.ts. |
| Existing integration tests fail due to changed fight timings | Medium | Medium | Eat delay changes DPS, so seeds may produce different fight outcomes. Integration tests should assert ranges, not exact values. Review any seed-specific assertions. |

## Security Considerations

No security impact. All changes are local combat simulation logic with no new inputs, dependencies, or external interactions.

## Dependencies

- No new npm dependencies
- Cross-project: cg-sim-player must be updated alongside cg-sim (validator + reference)
- Both projects must be tested together for the 0-warning validation

## Open Questions

1. **Boss attack speed: 5 or 6 ticks?** Recommend keeping 5 for now with a code comment noting the wiki discrepancy. Changing to 6 should be a separate focused sprint.

2. **Is the eat delay exactly 3 ticks, counting from the eat tick?** OSRS wiki says "delays next attack by 3 ticks." My analysis shows the delay should produce an attack 3 ticks AFTER the eat tick (not 2). This means the cooldown push must happen AFTER the same-tick decrement, not before. The placement of the fix (step 6 vs step 1b) is critical.

3. **Should the cg-sim-player bot eat timing be tightened in this sprint or a follow-up?** The optimal window is `attackCooldown >= 4` (immediately after attacking) for zero DPS loss. The current `> 1` will cause measurable DPS loss with eat delay active. Recommend including it in this sprint if bot win rate drops, deferring otherwise.

4. **Should `playerAteThisTick` remain on the attack gate?** After the fix, the cooldown alone prevents attacking on the eat tick (cooldown is set to 3 in step 6). The `playerAteThisTick` guard is redundant but provides defense-in-depth. Recommend keeping it.

5. **Does the cg-sim-player `attackCooldown.test.ts` need new test cases?** Yes -- the existing tests likely use the additive formula assumption. Add tests for eat-at-various-cooldown-levels scenarios to verify the simulation-based validator logic.
