# Sprint 012: Fix Eat Delay & Audit Boss Attack Speed

## Overview

Two combat fidelity fixes targeting OSRS accuracy:

1. **Eat delay bug:** Eating standard food (paddlefish) blocks the player's attack on the same tick but does NOT push `attackCooldown` forward. In real OSRS, eating standard food sets `attackCooldown = max(attackCooldown, 3)`, meaning the next attack is delayed by at least 3 ticks from the eat tick. Currently the player fires on tick N+1 instead of N+3, producing 780 `attack_cooldown` warnings across 100 cg-sim-player seeds.

2. **Boss attack speed audit:** `Boss.ts` line 17 sets `attackSpeed: 5` (3.0s). The OSRS wiki lists Corrupted Hunlef at 6 ticks (3.6s). INTENT.md also specifies 5 ticks. This needs a design decision and, if changed, propagation to all references.

## Use Cases

1. **Standard food eat delay** — Player eats paddlefish on tick N. Next player attack fires no earlier than tick N+3, regardless of prior cooldown state.
2. **Eat when cooldown already high** — Player eats with `attackCooldown = 5`. Cooldown stays at 5 (max(5, 3) = 5). No change in behavior.
3. **Combo food no delay** — Player eats corrupted paddlefish. No cooldown modification. Attack fires at normal cadence.
4. **Combo eat (standard + corrupted same tick)** — Standard paddlefish sets 3-tick delay. Corrupted paddlefish consumed same tick has no additional delay. Net result: 3-tick delay from the standard food only.
5. **Eat while out of range** — Player eats while walking toward boss. Cooldown still set to max(current, 3). When player arrives in range, cooldown may or may not have elapsed depending on distance.
6. **Boss attack cadence** — Boss fires attacks at the correct tick interval throughout the fight.

## Architecture

### Current flow (broken)

```
Player eats food (L580-587) → playerAteThisTick = true
Player attack gate (L397) → checks !playerAteThisTick → blocks attack THIS tick only
Next tick → playerAteThisTick reset to false → player attacks freely (cooldown may be 0)
```

### Fixed flow

```
Player eats food (L580-587) → playerAteThisTick = true
                             → attackCooldown = max(attackCooldown, 3)  ← NEW
Player attack gate (L397) → checks !playerAteThisTick → blocks attack THIS tick
Next tick → playerAteThisTick = false, but attackCooldown is 2 → attack still blocked
Tick N+3 → attackCooldown reaches 0 → player attacks
```

No new modules, types, or architectural changes. The fix is a single line addition in `processInventoryAction()`. The `playerAteThisTick` gate at line 397 becomes redundant for timing purposes (the cooldown alone would prevent the attack), but should be kept for semantic clarity and to prevent edge cases where cooldown was already 0 but hasn't decremented yet on the eat tick.

## Implementation

### Phase 1: Fix Eat Delay (Primary Fix — ~30% of effort)

**File:** `src/engine/GameSimulation.ts`

**Task 1.1: Add eat delay cooldown push in `processInventoryAction()`**

At line 586, after `this.playerAteThisTick = true;`, add the 3-tick eat delay:

```typescript
case 'eat': {
  if (player.hp >= player.maxHp) return;
  const heal = Math.min(action.healAmount, player.maxHp - player.hp);
  player.hp += heal;
  inv.removeItem(action.slotIndex);
  if (!action.comboFood) {
    this.playerAteThisTick = true;
    // OSRS eat delay: eating standard food delays next attack by at least 3 ticks
    player.attackCooldown = Math.max(player.attackCooldown, 3);
  }
  break;
}
```

This is a one-line addition: `player.attackCooldown = Math.max(player.attackCooldown, 3);` inserted at `GameSimulation.ts` line 587 (after `this.playerAteThisTick = true;` on line 586).

**Why `max(attackCooldown, 3)` not `attackCooldown += 3`:** In OSRS, eating resets the attack timer to 3 ticks if it was lower, but doesn't stack additively. If the player just attacked and has 4 ticks of cooldown left, eating doesn't penalize further.

**Task 1.2: Verify combo food path is unaffected**

The `if (!action.comboFood)` guard at line 585 ensures corrupted paddlefish skips both `playerAteThisTick = true` and the new cooldown push. No changes needed to the combo food path — just verify in tests.

### Phase 2: Boss Attack Speed Audit (~20% of effort)

**Task 2.1: Design decision on boss attack speed**

The intent document flags this as an open question. Two options:

- **Option A: Keep 5 ticks (3.0s)** — Matches INTENT.md and cg-sim-player reference. Faster pace, slightly easier (more player attacks between boss attacks).
- **Option B: Change to 6 ticks (3.6s)** — Matches OSRS wiki for Corrupted Hunlef. More faithful, slightly easier for player (more time between boss attacks to react).

**Files to update if changing to 6 ticks:**
| File | Location | Current | New |
|------|----------|---------|-----|
| `src/entities/Boss.ts` | Line 16: `attackCooldown: number = 5` | 5 | 6 |
| `src/entities/Boss.ts` | Line 17: `readonly attackSpeed: number = 5` | 5 | 6 |
| `src/entities/Boss.ts` | Line 122: `this.attackCooldown = 5` (in `reset()`) | 5 | 6 |
| `docs/INTENT.md` | Line 123: `Attack Speed | **5 ticks (3.0 s)**` | 5 ticks (3.0 s) | 6 ticks (3.6 s) |

**Note:** `Boss.reset()` at line 122 hardcodes `this.attackCooldown = 5` rather than using `this.attackSpeed`. If we change attack speed, `reset()` must be updated to use `this.attackSpeed` or the new literal value.

**Task 2.2: Update INTENT.md eat delay description**

`docs/INTENT.md` line 15 currently says: "Eating standard food occupies the action slot for that tick". This should be updated to reflect the 3-tick delay:

> Eating standard food delays the player's next attack by 3 ticks (sets attack cooldown to max(current, 3)); combo food (corrupted paddlefish) can be eaten the same tick as a regular fish with no delay

### Phase 3: Tests (~40% of effort)

**File:** `src/__tests__/inventory.test.ts` (extend existing eat tests)

**Task 3.1: Test eat delay sets cooldown to 3 when cooldown is 0**

```typescript
it('eating paddlefish sets attackCooldown to 3 (eat delay)', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 0;
  sim.boss.attackCooldown = 100; // prevent boss interference
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  // Cooldown should be 3 (set by eat delay), then decremented by 0 or 1
  // depending on whether attack gate runs. Since playerAteThisTick blocks
  // the attack, cooldown won't be reset by weapon speed.
  // After processTick: eat sets cooldown to max(0, 3) = 3.
  // Player attack gate at L394 decrements cooldown: 3 -> 2.
  // But the attack doesn't fire (playerAteThisTick), so cooldown stays at 2.
  expect(sim.player.attackCooldown).toBe(2);
});
```

**Task 3.2: Test eat delay is `max` not additive when cooldown > 3**

```typescript
it('eating with high cooldown does not increase it further', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 5;
  sim.boss.attackCooldown = 100;
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  // max(5, 3) = 5, then decremented by 1 = 4
  expect(sim.player.attackCooldown).toBe(4);
});
```

**Task 3.3: Test combo food does NOT set eat delay**

```typescript
it('corrupted paddlefish does NOT set eat delay', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 0;
  sim.boss.attackCooldown = 100;
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  // No eat delay applied; cooldown was 0, no attack fired (no target set)
  expect(sim.player.attackCooldown).toBe(0);
});
```

**Task 3.4: Test combo eating — standard delays, corrupted doesn't stack**

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
  // Standard paddlefish sets cooldown to max(0, 3) = 3
  // Corrupted paddlefish does not modify cooldown
  // After decrement in attack resolution: 3 - 1 = 2
  expect(sim.player.attackCooldown).toBe(2);
});
```

**Task 3.5: Test eat delay while out of range**

```typescript
it('eat delay applies even when out of attack range', () => {
  const sim = createSim();
  sim.player.hp = 60;
  sim.player.attackCooldown = 0;
  sim.player.attackTarget = null; // not targeting boss
  sim.boss.attackCooldown = 100;
  // Move player far from boss
  sim.player.pos = { x: 0, y: 0 };
  const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
  sim.useInventoryItem(idx);
  sim.processTick();
  // Eat delay still sets cooldown, even though player can't attack
  // After decrement: max(0,3) = 3, then 3-1 = 2
  expect(sim.player.attackCooldown).toBe(2);
});
```

**Task 3.6: Ensure existing tests still pass**

All 178 existing tests must continue to pass. The eat delay change should not affect tests that don't involve eating, and the existing eat tests need review:

- `inventory.test.ts` line 181-187: "eating paddlefish consumes action" — still passes (playerAteThisTick still set)
- `inventory.test.ts` line 190-197: "corrupted paddlefish does NOT consume action" — still passes (combo food path unchanged)
- `integration.test.ts` — run all integration tests; eat delay may change fight outcomes for specific seeds but tests assert ranges, not exact values

### Phase 4: Validation (~10% of effort)

**Task 4.1: Run cg-sim tests**
```bash
cd /Users/caleb.mchenry/code/me/cg-sim && npm test
```
All 178 tests must pass.

**Task 4.2: Run cg-sim-player validation (if available)**
```bash
cd ../cg-sim-player && npm run run -- --fights 100 --start-seed 1
```
Target: 0 `attack_cooldown` warnings.

**Task 4.3: Build verification**
```bash
npm run build
```
Must succeed with no errors.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/engine/GameSimulation.ts` | Modify (1 line add at ~L587) | Add `player.attackCooldown = Math.max(player.attackCooldown, 3)` after standard food eat |
| `src/entities/Boss.ts` | Modify (if changing to 6-tick) | Update `attackSpeed`, `attackCooldown` init, and `reset()` |
| `docs/INTENT.md` | Modify (L15, optionally L123) | Update eat delay description; update boss attack speed if changed |
| `src/__tests__/inventory.test.ts` | Modify (add ~5 new tests) | Eat delay unit tests covering all edge cases |

## Definition of Done

- [ ] Eating standard food (paddlefish) sets `attackCooldown = max(attackCooldown, 3)` — verified by unit test
- [ ] Eating combo food (corrupted paddlefish) does NOT modify `attackCooldown` — verified by unit test
- [ ] Combo eating (standard + corrupted same tick) applies 3-tick delay from standard only — verified by unit test
- [ ] Eat delay applies even when player is out of attack range — verified by unit test
- [ ] Eating with cooldown > 3 does not increase cooldown — verified by unit test
- [ ] Boss attack speed decision is made and implemented (5 or 6 ticks)
- [ ] If boss speed changed: `Boss.ts` attackSpeed, attackCooldown, reset() all updated
- [ ] If boss speed changed: `INTENT.md` attack speed table updated
- [ ] INTENT.md eat delay description updated from "occupies action slot" to "3-tick delay"
- [ ] All 178 cg-sim tests pass (`npm test`)
- [ ] All new eat delay tests pass
- [ ] `npm run build` succeeds
- [ ] cg-sim-player reports 0 `attack_cooldown` warnings across 100 seeds (if cg-sim-player is available)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Eat delay changes fight outcomes, breaking seed-dependent integration tests | Medium | Medium | Integration tests assert ranges (hp < 1000, hp >= 0), not exact values. The determinism tests use identical seeds on both sims, so they remain valid. Review each test assertion. |
| `playerAteThisTick` gate at L397 becomes partially redundant with cooldown push | Low | Low | Keep both gates — `playerAteThisTick` provides semantic clarity and handles the edge case where eat + cooldown decrement happen in the same tick processing order. |
| cg-sim-player bot win rate drops due to eat delay DPS loss | Medium | Low | The bot currently wins 100/100. A 3-tick eat delay per food is small; paddlefish are eaten ~10 times per fight, costing ~30 ticks of attacks maximum. Bot strategy may need tuning in a future sprint if win rate drops below threshold. |
| Boss attack speed change (5→6) alters fight difficulty balance | Medium | Medium | Run 100-seed validation before and after. 6-tick speed gives the player more time between boss attacks, which slightly decreases difficulty. This may offset the DPS loss from eat delay. |
| Cooldown decrement order vs. eat action order creates off-by-one | Low | High | The eat action runs at L218-221 (step 1b), before cooldown decrement at L394 (step 6). So eat sets cooldown to 3, then step 6 decrements to 2. After the eat tick, 2 more ticks until attack. Total: 3 ticks from eat to next attack, which is correct. Write explicit test for this. |

## Security Considerations

No security surface changes. All modifications are local combat simulation logic. No new dependencies, network requests, user input handling, or external data.

## Dependencies

- No new dependencies required
- Existing: Vitest (testing)

## Open Questions

1. **Boss attack speed: 5 or 6 ticks?** INTENT.md says 5, OSRS wiki says 6 for Corrupted Hunlef. This is a design decision for the project owner. The sprint is written to support either choice. If 5 is kept, only INTENT.md's eat delay description needs updating. If changed to 6, Boss.ts needs 3 updates.

2. **Should `Boss.reset()` use `this.attackSpeed` instead of a hardcoded literal?** Currently line 122 hardcodes `this.attackCooldown = 5`. Regardless of the speed decision, this should reference `this.attackSpeed` for maintainability: `this.attackCooldown = this.attackSpeed;`

3. **Tick processing order validation:** The eat action runs in step 1b (L217-221), cooldown decrement in step 6 (L394). This means on the eat tick: eat sets cooldown to 3, then cooldown decrements to 2 during attack resolution. After 2 more ticks of decrement, cooldown reaches 0 and player attacks — exactly 3 ticks after eating. This ordering needs explicit test coverage to prevent regressions if tick processing order changes.

4. **Should `playerAteThisTick` be removed?** With the cooldown push, the `!this.playerAteThisTick` check at L397 is partially redundant (the cooldown alone prevents firing). However, it's still useful: if the player eats when cooldown is already >= 3, the cooldown doesn't change, but `playerAteThisTick` still prevents the (impossible) edge case of attacking on the eat tick. Recommend keeping it for defensive correctness.
