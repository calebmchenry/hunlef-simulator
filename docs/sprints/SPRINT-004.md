# Sprint 004: Offensive Prayers, 10-Tick Countdown, Click-to-Attack Targeting

## Overview

Three interconnected combat system upgrades: **offensive prayers** that apply OSRS-accurate multipliers to damage and accuracy, a **10-tick countdown** phase before combat begins, and a **click-to-attack targeting** system replacing auto-attack.

PrayerManager expands from single-slot protection to a dual-slot system: one protection prayer + one offensive prayer simultaneously, with summed drain rates. The five Gauntlet-relevant offensive prayers (Piety, Rigour, Augury, Eagle Eye, Mystic Might) feed exact OSRS multipliers into the existing combat formulas. The click-to-attack system requires the player to click the Hunlef's 5x5 footprint to initiate combat — clicking ground clears the target and stops attacking, matching OSRS mechanics. A 10-tick countdown in the arena lets the player equip and pray before combat begins.

**What ships:** Offensive prayers toggle on/off with correct multipliers and drain. Protection + offensive stack. 10-tick countdown in arena with visible timer. Click boss to attack, click ground to stop. No auto-attack on fight start.

**What's deferred:** Quick-prayer presets, prayer flicking, boss movement AI, projectile travel time.

---

## Use Cases

1. **UC-1: Activate offensive prayer** — Click Rigour in prayer panel. Rigour activates. Next ranged attack uses 1.20 accuracy, 1.23 damage multiplier. Drain increases (protection 12 + offensive 24 = 36 combined).
2. **UC-2: Offensive exclusivity** — Rigour active, click Piety → Rigour deactivates, Piety activates. Click Piety again → Piety deactivates. Only one offensive prayer at a time.
3. **UC-3: Protection + offensive stacking** — Protect from Magic (drain 12) + Augury (drain 24) both active. Combined drain = 36 per tick.
4. **UC-4: 10-tick countdown** — Fight starts in `'countdown'` state. Large number counts down on canvas. Player can move, equip, toggle prayers. Neither side attacks. After 10 ticks → `'running'`.
5. **UC-5: Click boss to attack** — Click any tile in boss 5x5 → set attack target. If in range, attack next tick. If out of range, auto-walk into range, then attack.
6. **UC-6: Movement cancels attack** — Click ground tile → clears attack target, queues movement. Must re-click boss to resume attacking.
7. **UC-7: No auto-attack** — When countdown ends, player does NOT auto-attack. Must explicitly click boss to begin.

---

## Architecture

### Prayer System Expansion

```typescript
// PrayerManager gains:
type OffensivePrayer = 'piety' | 'rigour' | 'augury' | 'eagle_eye' | 'mystic_might' | null;

// Dual-slot: protection + offensive active simultaneously
activePrayer: PrayerType       // 'magic' | 'missiles' | null (existing)
offensivePrayer: OffensivePrayer // new

// Offensive prayer data
interface OffensivePrayerDef {
  id: OffensivePrayer;
  name: string;
  combatStyle: 'melee' | 'ranged' | 'magic';
  accuracyMult: number;
  damageMult: number;        // for melee str / ranged str (not magic — fixed max hit)
  magicMaxHitBonus: number;  // +1 for Augury on T3 staff
  drainRate: number;
}

// OSRS values:
const OFFENSIVE_PRAYERS: OffensivePrayerDef[] = [
  { id: 'eagle_eye',   combatStyle: 'ranged', accuracyMult: 1.15, damageMult: 1.15, magicMaxHitBonus: 0, drainRate: 12 },
  { id: 'mystic_might', combatStyle: 'magic', accuracyMult: 1.15, damageMult: 1.0,  magicMaxHitBonus: 0, drainRate: 12 },
  { id: 'rigour',       combatStyle: 'ranged', accuracyMult: 1.20, damageMult: 1.23, magicMaxHitBonus: 0, drainRate: 24 },
  { id: 'augury',       combatStyle: 'magic', accuracyMult: 1.25, damageMult: 1.0,  magicMaxHitBonus: 1, drainRate: 24 },
  { id: 'piety',        combatStyle: 'melee', accuracyMult: 1.20, damageMult: 1.23, magicMaxHitBonus: 0, drainRate: 24 },
];
```

### Drain Calculation (Multiple Prayers)

```
Total drain rate per tick = sum of drain rates of all active prayers
  - Protection prayer: drain rate 12
  - Offensive prayer: drain rate 12 or 24 depending on prayer
  - Both active: sum them

drain_resistance = 2 * prayerBonus + 60
drain_per_tick = total_drain_rate / drain_resistance
```

### Combat Formula Integration

The existing formulas already accept `prayerMult` params. Currently hardcoded to `1.0`. Sprint 4 reads from the active offensive prayer:

```typescript
// In GameSimulation.getPlayerAttackRoll():
const prayerDef = this.prayerManager.getActiveOffensiveDef();
const accuracyMult = prayerDef?.accuracyMult ?? 1.0;
// Pass accuracyMult instead of 1.0

// In GameSimulation.getPlayerMaxHit():
const damageMult = prayerDef?.damageMult ?? 1.0;
// For magic: magicMaxHit(tier, prayerDef?.magicMaxHitBonus > 0)
```

### Click-to-Attack Targeting

```
Player gains:
  attackTarget: 'boss' | null = null  // currently targeting the boss?

InputManager.handleClick(tileX, tileY):
  if boss.occupies(tileX, tileY):
    sim.queueAttackTarget('boss')     // set target, clear move
  else:
    sim.queueMove({x: tileX, y: tileY})  // set move, clear target

GameSimulation.processTick():
  // Movement clears attack target
  if player moved this tick AND has a queued move (not auto-walk):
    player.attackTarget = null

  // Attack only if target is set
  if player.attackTarget === 'boss':
    if in range:
      → attack on cooldown (existing logic)
    else:
      → auto-walk toward boss (pathfind to nearest tile in weapon range)
```

### Countdown Phase

```
GameState = 'countdown' | 'running' | 'won' | 'lost'

countdown starts at 10, decrements each tick
During 'countdown':
  - Process inputs (move, equip, pray) ✓
  - Drain prayer ✓
  - Player movement ✓
  - Boss AI: SKIP (no attacks)
  - Player attack: SKIP
  - Stomp check: SKIP
  - Death check: SKIP
  When countdown reaches 0 → state = 'running'

Renderer draws countdown number (large, centered on canvas)
```

---

## Implementation

### Phase 1: Expand PrayerManager for Offensive Prayers (~25% effort)

**Files:**
- `src/combat/PrayerManager.ts` — Modify
- `src/combat/__tests__/PrayerManager.test.ts` — Modify

**Tasks:**
- [ ] Add `OffensivePrayer` type and `OFFENSIVE_PRAYERS` data array with OSRS values
- [ ] Add `offensivePrayer: OffensivePrayer` field to PrayerManager
- [ ] Add `queueOffensiveSwitch(prayer: OffensivePrayer)` — queued for next tick
- [ ] Add `applyQueuedOffensive()` — called alongside `applyQueued()`
- [ ] Implement exclusivity: activating one offensive prayer deactivates any other
- [ ] Toggle behavior: clicking active offensive prayer deactivates it
- [ ] Update `drain()` to sum drain rates of all active prayers:
  - Protection: drain rate 12
  - Offensive: drain rate from `OFFENSIVE_PRAYERS` def
  - Both active: sum
- [ ] Add `getActiveOffensiveDef(): OffensivePrayerDef | null` helper
- [ ] Update `deactivate()` to clear both protection and offensive
- [ ] Update `reset()` to clear offensive prayer
- [ ] Tests:
  - Activate Rigour → offensivePrayer is 'rigour'
  - Activate Rigour then Piety → Rigour off, Piety on
  - Toggle: activate Piety, click Piety → off
  - Protection + offensive coexist
  - Drain rate sums correctly (e.g. protect 12 + rigour 24 = 36)
  - Deactivate clears both

### Phase 2: Wire Offensive Prayers into Combat Formulas (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/combat/__tests__/formulas.test.ts` — Modify

**Tasks:**
- [ ] Update `getPlayerAttackRoll()`:
  - Get active offensive prayer def
  - Use `accuracyMult` if prayer style matches weapon style, else 1.0
  - Piety: melee accuracy 1.20. Rigour: ranged accuracy 1.20. Augury: magic accuracy 1.25.
  - Eagle Eye: ranged accuracy 1.15. Mystic Might: magic accuracy 1.15.
- [ ] Update `getPlayerMaxHit()`:
  - Piety: melee strength mult 1.23. Rigour: ranged strength mult 1.23.
  - Eagle Eye: ranged strength mult 1.15.
  - Magic: `magicMaxHit(tier, prayerDef?.magicMaxHitBonus > 0)` — Augury gives +1 to T3 staff (39→40)
  - Mystic Might: no damage bonus (magic is fixed max hit)
- [ ] Tests:
  - T3 staff + Augury → max hit 40 (was 39 without)
  - T3 bow + Rigour → verify accuracy and max hit use 1.20/1.23 multipliers
  - T3 halberd + Piety → verify accuracy and max hit use 1.20/1.23 multipliers
  - Mismatched prayer (Piety active but using bow) → no bonus (1.0)

### Phase 3: Prayer Panel — Make Offensive Prayers Interactive (~10% effort)

**Files:**
- `src/render/PrayerPanel.ts` — Modify

**Tasks:**
- [ ] Make these prayers interactive (clickable): Piety, Rigour, Augury, Eagle Eye, Mystic Might
- [ ] Click handler: call `sim.queueOffensivePrayer(prayerId)` or toggle off if already active
- [ ] Active offensive prayer shows bright icon + glow (same styling as protection prayers)
- [ ] Update the `PRAYERS` data array: set `interactive: true` for these 5 prayers
- [ ] Visual: active offensive prayer gets the same beige/gold glow as active protection prayers

### Phase 4: Click-to-Attack Targeting (~25% effort)

**Files:**
- `src/entities/Player.ts` — Modify
- `src/engine/GameSimulation.ts` — Modify
- `src/input/InputManager.ts` — Modify
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Add `attackTarget: 'boss' | null = null` to Player
- [ ] Add `queueAttackTarget(target: 'boss' | null)` to GameSimulation
- [ ] Modify `InputManager.handleClick()`:
  - Check if clicked tile is within `sim.boss.occupies(tileX, tileY)`
  - If yes: `sim.queueAttackTarget('boss')` — do NOT queue a move
  - If no: `sim.queueMove({x, y})` — this will clear attack target
- [ ] Modify `GameSimulation.processTick()`:
  - When a move is queued (ground click): clear `player.attackTarget`
  - When attack target is set and player is out of range: auto-walk toward nearest tile in weapon range of boss
  - Attack logic only fires when `player.attackTarget === 'boss'` AND in range AND cooldown ready
  - Remove the old auto-attack-when-in-range behavior
- [ ] Renderer: draw a subtle highlight/outline on boss when player has it targeted (e.g. yellow border)
- [ ] Tests:
  - Click boss tile → attack target set
  - Click ground tile → attack target cleared
  - Attack only fires when target is set and in range
  - Moving clears target
  - Out-of-range with target → auto-walk toward boss

### Phase 5: 10-Tick Countdown Phase (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/render/Renderer.ts` — Modify
- `src/render/HUD.ts` — Modify

**Tasks:**
- [ ] Add `'countdown'` to `GameState` type
- [ ] Add `countdownTicks: number = 10` to GameSimulation
- [ ] Initialize state as `'countdown'` in constructor
- [ ] Modify `processTick()`:
  - During `'countdown'`:
    - Process inputs (move, equip, pray) — YES
    - Drain prayer — YES
    - Player movement — YES
    - Boss attacks — NO (skip boss AI)
    - Player attacks — NO (skip even if target set)
    - Stomp check — NO
    - Death check — NO
    - Decrement `countdownTicks`
    - When `countdownTicks` reaches 0 → `state = 'running'`
  - During `'running'`: existing behavior (unchanged)
- [ ] Renderer: draw large countdown number centered on canvas during countdown state
  - Numbers "10", "9", ..., "1" in large OSRS-style font
  - "FIGHT!" text briefly on transition to running (visible for 1-2 ticks)
- [ ] HUD: show "Countdown: 7" or similar during countdown
- [ ] Tests:
  - Simulation starts in 'countdown' state
  - After 10 ticks, state becomes 'running'
  - Boss does not attack during countdown
  - Player can move during countdown
  - Player can toggle prayers during countdown
  - Player cannot attack during countdown (even with target set)

### Phase 6: Integration + Polish (~10% effort)

**Files:**
- `src/__tests__/integration.test.ts` — Modify
- `src/main.ts` — Modify (if needed)

**Tasks:**
- [ ] Integration tests:
  - Full fight with Rigour active → player deals more damage than without
  - Full fight with Piety + Protect from Magic → both drain, both apply effects
  - Countdown → running transition works in headless simulation
  - Click-to-attack in headless: set target, run ticks, verify attacks happen
  - Clear target, run ticks, verify no attacks
  - Determinism preserved with seeded RNG
- [ ] All 90 existing tests still pass
- [ ] Visual verification with agent-browser:
  - [ ] Countdown visible on fight start
  - [ ] Offensive prayer activates (glow visible in prayer panel)
  - [ ] Click boss → attacks begin
  - [ ] Click ground → attacks stop

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/combat/PrayerManager.ts` | Modify | Add offensive prayer slot, dual drain, exclusivity |
| `src/combat/__tests__/PrayerManager.test.ts` | Modify | Offensive prayer tests |
| `src/engine/GameSimulation.ts` | Modify | Countdown state, click-to-attack, prayer multipliers |
| `src/entities/Player.ts` | Modify | Add attackTarget field |
| `src/input/InputManager.ts` | Modify | Detect boss clicks vs ground clicks |
| `src/render/PrayerPanel.ts` | Modify | Make 5 offensive prayers interactive |
| `src/render/Renderer.ts` | Modify | Countdown overlay, attack target highlight |
| `src/render/HUD.ts` | Modify | Countdown display |
| `src/combat/__tests__/formulas.test.ts` | Modify | Prayer multiplier tests |
| `src/__tests__/integration.test.ts` | Modify | Countdown + targeting + offensive prayer integration |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + new tests
- [ ] Piety, Rigour, Augury, Eagle Eye, Mystic Might toggle on/off in prayer panel
- [ ] Only one offensive prayer active at a time (clicking another switches)
- [ ] Protection + offensive prayers coexist (both active, both drain)
- [ ] Offensive prayer multipliers apply correctly to combat formulas:
  - Rigour: 1.20 ranged accuracy, 1.23 ranged damage
  - Augury: 1.25 magic accuracy, +1 max hit on T3 staff (39→40)
  - Piety: 1.20 melee accuracy, 1.23 melee strength
  - Eagle Eye: 1.15 ranged accuracy, 1.15 ranged damage
  - Mystic Might: 1.15 magic accuracy
- [ ] Prayer drain sums all active prayer drain rates
- [ ] Fight starts with 10-tick countdown (state = 'countdown')
- [ ] Countdown number visible on canvas ("10", "9", ... "1", "FIGHT!")
- [ ] Player can move, equip, pray during countdown
- [ ] Neither side attacks during countdown
- [ ] After countdown, state transitions to 'running'
- [ ] Clicking boss 5x5 footprint sets attack target (no movement queued)
- [ ] Clicking ground tile clears attack target and queues movement
- [ ] Player auto-walks into weapon range when target is set
- [ ] Player attacks boss on cooldown only while target is set and in range
- [ ] No auto-attack on fight start — player must click boss
- [ ] Boss always starts in ranged offensive phase (already correct)
- [ ] All 90 Sprint 1-3 tests still pass
- [ ] Determinism preserved with seeded RNG

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Offensive prayer multipliers wrong | Medium | High | Unit test every multiplier against OSRS wiki values. Cross-reference DPS calculator. |
| Click-to-attack breaks existing tests | Medium | Medium | Existing tests use `runTicks(n)` which doesn't click. Add `queueAttackTarget('boss')` before `runTicks` in integration tests. |
| Prayer drain too fast with stacking | Low | Medium | Test: Rigour (24) + Protect from Magic (12) = 36 total. With T3 armor (+12 bonus): resistance = 84, drain = 36/84 = 0.43 per tick. At 77 prayer points, lasts ~180 ticks (108 seconds). Seems reasonable. |
| Countdown delays headless tests | Low | Low | `runTicks` needs to handle countdown. Tests can either start with countdown or set state directly. |
| Auto-walk pathing conflicts | Medium | Medium | When target set and out of range, pathfind to nearest tile adjacent to boss footprint (not into it). Reuse existing BFS pathfinding. |

---

## Security Considerations

No new attack surface. All changes are client-side game logic.

---

## Dependencies

### Runtime
None (unchanged).

### Dev
Unchanged: vite, typescript, vitest.

---

## Open Questions

1. **Offensive prayer + wrong weapon**: If Piety is active but player uses a bow, does Piety provide any bonus? In OSRS, no — Piety only boosts melee. Implementation: check if offensive prayer's `combatStyle` matches weapon type; if not, no bonus.

2. **Auto-walk target tile**: When player clicks boss and needs to walk into range, what tile do they walk to? Implementation: pathfind to the nearest tile that is within weapon range of the boss and is walkable (not inside boss footprint).

3. **Attack cooldown during countdown**: Should the player's attack cooldown tick during countdown? Implementation: no — cooldown only decrements during 'running' state. Player starts 'running' with full cooldown available.

4. **Countdown skip**: Should there be an option to skip the countdown (for experienced players)? Deferred — can add a checkbox on loadout screen in a future sprint.
