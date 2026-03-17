# Sprint 004: Offensive Prayers, Countdown, Click-to-Attack

## Overview

Add three focused features: offensive prayers that feed into existing combat formulas, a 10-tick countdown before combat starts, and click-to-attack targeting so the player must click the boss to engage. Every change bolts onto existing structures with minimal refactoring.

**What ships:** Five offensive prayers (Piety, Rigour, Augury, Eagle Eye, Mystic Might) toggle on/off and modify player damage/accuracy. A 10-tick countdown precedes combat. Clicking the boss sets an attack target; clicking the ground clears it. Moving interrupts attacking.

**What's deferred:** Prayer panel UI for offensive prayers (render changes), prayer icon sprites for offensive prayers, countdown visual overlay, attack cursor/indicator styling.

---

## Use Cases

1. **UC-1: Toggle offensive prayer** — Player activates an offensive prayer. Only one offensive prayer can be active at a time. Activating one deactivates any other offensive prayer. Protection and offensive prayers coexist.
2. **UC-2: Prayer multiplier applies** — Active offensive prayer modifies the correct combat formula parameters (accuracy mult, damage/strength mult) when the player attacks.
3. **UC-3: Dual drain** — When both a protection prayer and an offensive prayer are active, drain rates stack each tick.
4. **UC-4: Countdown** — Game starts in `'countdown'` state. Ticks decrement from 10 to 0. During countdown the player can move, equip, and toggle prayers, but neither side attacks. After countdown, state becomes `'running'`.
5. **UC-5: Click boss to attack** — Clicking any tile inside the boss's 5x5 footprint sets the player's attack target. Player auto-walks into weapon range and attacks on cooldown.
6. **UC-6: Click ground clears target** — Clicking a ground tile (not on boss) queues movement and clears the attack target. Player must re-click the boss to resume attacking.

---

## Architecture

### Approach: Bolt-On, Don't Rewrite

Every feature adds a field or two to an existing class. No new classes, no new files (except tests). The combat formula functions already accept prayer multiplier parameters -- we just stop passing `1.0` and start reading from `PrayerManager`.

### Data Model Changes

```typescript
// PrayerManager — add one field, one type
export type OffensivePrayer = 'piety' | 'rigour' | 'augury' | 'eagle_eye' | 'mystic_might';

export class PrayerManager {
  activePrayer: PrayerType = null;                    // existing (protection)
  offensivePrayer: OffensivePrayer | null = null;     // NEW
  // ...existing fields...
}

// GameSimulation — add two fields, one state value
export type GameState = 'countdown' | 'running' | 'won' | 'lost';  // add 'countdown'

export class GameSimulation {
  attackTarget: Boss | null = null;   // NEW — set by clicking boss
  countdownTicks: number = 10;        // NEW — decrements to 0 then state = 'running'
  // ...existing fields...
}
```

### Offensive Prayer Constants

Stored as a plain lookup object in `PrayerManager.ts`:

```typescript
export const OFFENSIVE_PRAYERS = {
  eagle_eye:    { type: 'ranged',  accMult: 1.15, dmgMult: 1.15, drainRate: 12 },
  mystic_might: { type: 'magic',   accMult: 1.15, dmgMult: 1.0,  drainRate: 12 },
  rigour:       { type: 'ranged',  accMult: 1.20, dmgMult: 1.23, drainRate: 24 },
  augury:       { type: 'magic',   accMult: 1.25, dmgMult: 1.0,  drainRate: 24, auguryFlag: true },
  piety:        { type: 'melee',   accMult: 1.20, dmgMult: 1.23, drainRate: 24 },
} as const;
```

Augury's magic damage bonus is handled via the existing `augury: boolean` param on `magicMaxHit()` -- no formula changes needed. `dmgMult: 1.0` means no multiplier to the level-based calculation; the `+1 max hit` comes from the flag.

---

## Implementation

### Phase 1: Offensive Prayers in PrayerManager (~25% effort)

**Files:**
- `src/combat/PrayerManager.ts` — Modify

**Tasks:**
- [ ] Add `OffensivePrayer` type and `OFFENSIVE_PRAYERS` constant object
- [ ] Add `offensivePrayer: OffensivePrayer | null = null` field
- [ ] Add `queuedOffensivePrayer` private field (mirrors existing queued prayer pattern)
- [ ] Add `queueOffensiveSwitch(prayer: OffensivePrayer | null): void` — queues the switch
- [ ] In `applyQueued()`, also apply queued offensive prayer
- [ ] Modify `drain()` to sum drain rates: protection (12 if active) + offensive (from `OFFENSIVE_PRAYERS` lookup). The accumulated-drain / integer-drain logic stays identical, just `drainRate` becomes a sum
- [ ] In `deactivate()`, also clear `offensivePrayer`
- [ ] In `reset()`, also clear `offensivePrayer` and `queuedOffensivePrayer`
- [ ] Add `getAccuracyMult(): number` — returns `OFFENSIVE_PRAYERS[this.offensivePrayer].accMult` or `1.0`
- [ ] Add `getDamageMult(): number` — returns `OFFENSIVE_PRAYERS[this.offensivePrayer].dmgMult` or `1.0`
- [ ] Add `isAuguryActive(): boolean` — returns true if `offensivePrayer === 'augury'`

### Phase 2: Wire Prayer Multipliers into GameSimulation (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify

**Tasks:**
- [ ] Add `queueOffensivePrayer(prayer: OffensivePrayer | null): void` method (delegates to `prayerManager.queueOffensiveSwitch`)
- [ ] In `getPlayerAttackRoll()`, replace all `1.0` prayer mult args:
  - `case 'bow':  rangedAttackRoll(stats.ranged, weapon.attackBonus, this.prayerManager.getAccuracyMult(), 0)`
  - `case 'staff': magicAttackRoll(stats.magic, weapon.attackBonus, this.prayerManager.getAccuracyMult())`
  - `case 'halberd': meleeAttackRoll(stats.attack, weapon.attackBonus, this.prayerManager.getAccuracyMult(), 0)`
- [ ] In `getPlayerMaxHit()`, replace all `1.0` prayer mult args:
  - `case 'bow':  rangedMaxHit(stats.ranged, weapon.strengthBonus, this.prayerManager.getDamageMult())`
  - `case 'staff': magicMaxHit(weapon.tier as 1 | 2 | 3, this.prayerManager.isAuguryActive())`
  - `case 'halberd': meleeMaxHit(stats.strength, weapon.strengthBonus, this.prayerManager.getDamageMult(), 0)`

No changes to `formulas.ts` -- every function already accepts the parameters we need.

### Phase 3: Countdown State (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify

**Tasks:**
- [ ] Change `GameState` type to `'countdown' | 'running' | 'won' | 'lost'`
- [ ] Add `countdownTicks: number = 10` field
- [ ] Change initial `state` from `'running'` to `'countdown'`
- [ ] In `processTick()`, add countdown handling at the top (before the existing `if (state !== 'running') return`):
  ```typescript
  if (this.state === 'countdown') {
    this.tick++;
    // Process inputs (move, prayer, inventory) -- player can prep
    // ...same input processing as running...
    // Process prayer drain
    // Process player movement
    // Skip boss AI (steps 4-5), player attack (step 6), stomp (step 7)
    this.countdownTicks--;
    if (this.countdownTicks <= 0) {
      this.state = 'running';
    }
    return;
  }
  ```
- [ ] Extract the input-processing and movement blocks into the countdown path (duplicate the ~20 lines rather than refactoring into helper methods -- keeps the diff minimal and avoids changing the running path)
- [ ] Update `runTicks()` to also run during countdown: `if (this.state !== 'running' && this.state !== 'countdown') break;`

### Phase 4: Click-to-Attack Targeting (~30% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/input/InputManager.ts` — Modify

**Tasks:**

**InputManager changes:**
- [ ] In `handleClick()`, after computing `tileX`/`tileY`, check if the click is on the boss:
  ```typescript
  if (this.sim.boss.occupies(tileX, tileY)) {
    this.sim.queueAttackTarget();
  } else if (tileX >= 0 && tileX < 12 && tileY >= 0 && tileY < 12) {
    this.sim.queueMove({ x: tileX, y: tileY });
  }
  ```
  That's it for InputManager. The boss-tile check goes first; ground-tile is the else branch.

**GameSimulation changes:**
- [ ] Add `attackTarget: Boss | null = null` field
- [ ] Add `private queuedAttackTarget: boolean = false` field
- [ ] Add `queueAttackTarget(): void` — sets `queuedAttackTarget = true`
- [ ] In input processing (step 1 of `processTick`), handle attack target:
  ```typescript
  if (this.queuedAttackTarget) {
    this.attackTarget = this.boss;
    this.player.targetTile = null;  // clear any pending move
    this.queuedAttackTarget = false;
  }
  ```
- [ ] When `queuedMove` is processed, also clear `attackTarget`:
  ```typescript
  if (this.queuedMove !== null) {
    this.player.targetTile = this.queuedMove;
    this.attackTarget = null;  // moving cancels attack
    this.queuedMove = null;
  }
  ```
- [ ] In step 3 (player movement), if `attackTarget` is set and player is out of weapon range, auto-walk toward the boss. Use existing `findNextStep` with target = nearest tile adjacent to boss footprint
- [ ] In step 6 (player attack), gate attacks on `attackTarget !== null`:
  ```typescript
  if (this.attackTarget !== null && this.player.attackCooldown <= 0 && !this.playerAteThisTick) {
    // ...existing attack logic unchanged...
  }
  ```
  This is the key behavioral change: attacks only fire when the player has explicitly targeted the boss.

### Phase 5: Tests (~15% effort)

**Files:**
- `src/__tests__/offensivePrayers.test.ts` — Create
- `src/__tests__/countdown.test.ts` — Create
- `src/__tests__/clickToAttack.test.ts` — Create

**Tasks:**
- [ ] **Offensive prayer tests:**
  - Activating an offensive prayer returns correct accuracy/damage multipliers
  - Activating a second offensive prayer deactivates the first
  - Protection + offensive drain rates stack correctly
  - Prayer deactivates both prayers when points hit 0
  - Each of the 5 prayers produces the expected multiplier values
  - Augury flag passes through to `magicMaxHit` correctly
- [ ] **Countdown tests:**
  - Game starts in `'countdown'` state
  - After 10 ticks, state becomes `'running'`
  - During countdown, player can move (targetTile is processed)
  - During countdown, prayer switches are processed
  - During countdown, boss does not attack (no damage to player)
  - During countdown, player does not attack (no damage to boss)
- [ ] **Click-to-attack tests:**
  - `queueAttackTarget()` sets attackTarget to boss
  - `queueMove()` clears attackTarget
  - Player does not attack when attackTarget is null (even if in range)
  - Player auto-walks toward boss when attackTarget is set and out of range
  - Player attacks on cooldown when attackTarget is set and in range
  - Eating does not clear attackTarget (only movement does)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/combat/PrayerManager.ts` | Modify | Add `offensivePrayer` field, `OFFENSIVE_PRAYERS` constants, multiplier getters, stacked drain |
| `src/engine/GameSimulation.ts` | Modify | Add countdown state, `attackTarget` field, wire prayer multipliers, gate attacks on target |
| `src/input/InputManager.ts` | Modify | Boss-tile click detection (3-line if/else change) |
| `src/__tests__/offensivePrayers.test.ts` | Create | Tests for prayer multipliers and drain stacking |
| `src/__tests__/countdown.test.ts` | Create | Tests for countdown state transitions |
| `src/__tests__/clickToAttack.test.ts` | Create | Tests for attack targeting and movement cancellation |

Three files modified, three test files created. No new classes. No new runtime modules.

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` — all 90 existing tests still pass
- [ ] New tests pass for offensive prayers, countdown, and click-to-attack
- [ ] Activating Piety/Rigour/Augury/Eagle Eye/Mystic Might changes `getAccuracyMult()` and `getDamageMult()` to correct OSRS values
- [ ] Only one offensive prayer active at a time
- [ ] Protection + offensive prayers drain simultaneously at correct combined rate
- [ ] Game starts in `'countdown'` state; transitions to `'running'` after 10 ticks
- [ ] Player can move, equip, and pray during countdown; no attacks from either side
- [ ] Clicking boss tiles sets attack target; clicking ground tiles clears it
- [ ] Player auto-walks into weapon range when targeting boss
- [ ] Player does not attack without an explicit click on the boss
- [ ] Moving (ground click) interrupts attacking -- must re-click boss

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing tests break from countdown default state | High | Low | Tests that call `runTicks()` or `processTick()` expect `'running'`. Either start those tests by advancing past countdown, or add a test-only constructor option to skip countdown. Simplest: set `countdownTicks = 0` and `state = 'running'` in test setup. |
| Auto-walk toward boss pathfinding edge cases | Medium | Medium | Reuse existing `findNextStep` with a computed target tile (nearest tile adjacent to boss). No new pathfinding code. |
| Offensive prayer + weapon type mismatch (e.g. Piety active with bow) | Low | Low | Multiplier getters return the raw value regardless of weapon. This matches OSRS: wrong prayer just wastes drain. No validation needed. |
| Stacked drain precision drift | Low | Low | Same accumulated-drain logic already handles fractional drain. Adding two drain rates before dividing by resistance is arithmetically clean. |

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged).

### Dev
Unchanged: vite, typescript, vitest.

### External
None.

---

## Open Questions

1. **Should countdown be skippable in tests?** Recommendation: yes. Add an optional `skipCountdown: boolean` param to the `GameSimulation` constructor that sets `state = 'running'` and `countdownTicks = 0`. This avoids adding 10 extra ticks to every existing test. Alternatively, existing tests can just call `sim.state = 'running'` directly since the field is public.

2. **Auto-walk target tile for boss:** When attack target is set and player is out of range, what tile does the player walk toward? Recommendation: compute the nearest tile that is within weapon range of the boss footprint (Chebyshev distance <= weapon.range). Use the boss center as the pathfinding target and let `findNextStep` handle it -- player will naturally stop when in range since the attack fires and we don't clear targetTile.

3. **Should wrong-style offensive prayers be prevented?** E.g. activating Piety while wielding a bow. Recommendation: no. OSRS allows it (just wastes prayer points). Keep it simple.
