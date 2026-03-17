# Sprint 004: Offensive Prayers, Click-to-Attack Targeting, 10-Tick Countdown

## Overview

Expand the combat system with three interconnected features: offensive prayers that apply OSRS-accurate multipliers to damage and accuracy formulas, a click-to-attack targeting system that replaces the current auto-attack behavior, and a 10-tick countdown phase before combat begins.

**PrayerManager** evolves from a single-slot protection prayer tracker into a dual-slot system supporting one protection prayer and one offensive prayer simultaneously, with summed drain rates and proper exclusivity rules. The five relevant offensive prayers (Piety, Rigour, Augury, Eagle Eye, Mystic Might) each carry exact OSRS multipliers that feed into the existing `formulas.ts` functions, which already accept `prayerMult` parameters but currently receive hardcoded `1.0`. The click-to-attack system introduces an attack target concept on the Player entity: clicking the boss's 5x5 footprint sets an attack target, clicking ground clears it, and movement interrupts combat. A new `'countdown'` GameState gives the player 10 ticks to equip gear and activate prayers before the fight begins.

**What ships:** Offensive prayers toggle on/off from the prayer panel with correct exclusivity. Combat formulas use real prayer multipliers. Multiple active prayers drain simultaneously. The player must click the boss to initiate attacks. A 10-tick countdown precedes every fight with a visible timer.

**What's deferred:** Quick-prayer presets, prayer flicking (1-tick activation for zero drain), prayer reordering UI, boss movement AI, projectile travel time.

---

## Use Cases

1. **UC-1: Activate offensive prayer** -- Player clicks Rigour in the prayer panel. Rigour activates (highlighted). The next ranged attack uses 1.20 accuracy multiplier and 1.23 damage multiplier in the combat formula. Prayer drain increases from the protection prayer's 12/tick to (12 + 24)/tick combined.

2. **UC-2: Offensive prayer exclusivity** -- Player has Rigour active and clicks Piety. Rigour deactivates and Piety activates (only one offensive prayer at a time). Clicking Piety again while it is active toggles it off entirely.

3. **UC-3: Protection + offensive stacking** -- Player has Protect from Magic active (drain rate 12) and activates Augury (drain rate 24). Both remain active simultaneously. Combined drain rate is 36 per tick, applied through the existing drain accumulator.

4. **UC-4: Countdown before combat** -- Simulation starts in `'countdown'` state. A large number counts down from 10 to 1 on the canvas (one per tick). During countdown, the player can move, equip weapons from inventory, and toggle prayers, but neither side can attack. After tick 10, state transitions to `'running'` and combat begins.

5. **UC-5: Click boss to attack** -- Player clicks a tile within the boss's 5x5 footprint. The player's attack target is set to the boss. If already in weapon range, the player attacks on the next available tick. If out of range, the player auto-walks toward the boss until in range, then attacks.

6. **UC-6: Movement cancels attack** -- Player is attacking the boss (target set). Player clicks a ground tile outside the boss footprint. Attack target clears. Player walks to the clicked tile. No further attacks occur until the player clicks the boss again.

7. **UC-7: No auto-attack on fight start** -- When the countdown ends and `'running'` begins, the player does NOT automatically attack the boss. The player must explicitly click the boss to begin attacking. This matches real CG behavior where the player must manually initiate combat.

---

## Architecture

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Prayer slot model | Two independent slots: `activeProtection` (`PrayerType`) and `activeOffensive` (`OffensivePrayerType`) | Protection and offensive prayers are orthogonal in OSRS. A single `activePrayer` field cannot represent both simultaneously. Two slots with independent exclusivity rules mirrors the real prayer book. |
| Offensive prayer data | Static `OFFENSIVE_PRAYERS` lookup table keyed by `OffensivePrayerType` | Each prayer has fixed accuracy/damage multipliers and drain rate. A const record is the simplest representation. No class hierarchy needed for 5 entries. |
| Drain calculation | Sum drain rates of all active prayers, feed single total into existing accumulator | OSRS drains each prayer independently, but mathematically summing rates and using one accumulator produces identical integer drain points per tick. Simpler than tracking N accumulators. |
| Attack target | `Player.attackTarget: 'boss' \| null` | Only one possible target in CG (the Hunlef). No need for a generic entity reference system. A tagged union keeps it simple and avoids circular dependencies. |
| Click detection | `Boss.occupies(tileX, tileY)` in InputManager | Already exists, returns true if the tile falls within the 5x5 footprint. No new hit-testing infrastructure needed. |
| Countdown state | New `GameState = 'countdown' \| 'running' \| 'won' \| 'lost'` | Extends the existing union type. `processTick()` branches on state at the top level. Countdown logic is a small preamble, not a separate tick processor. |
| Countdown rendering | Large centered text on canvas, drawn in `Renderer.draw()` | No DOM overlay needed. Canvas text is sufficient for a numeric countdown. Keeps rendering in one place. |

### Component Changes

```
src/combat/PrayerManager.ts (modify — major)
  ├── Split activePrayer into activeProtection + activeOffensive
  ├── Add OffensivePrayerType union and OFFENSIVE_PRAYERS data table
  ├── Add queueOffensiveSwitch() / applyQueued() for offensive slot
  ├── Update drain() to sum rates from both active prayers
  └── Add getAccuracyMult() / getDamageMult() / getAuguryBonus() helpers

src/engine/GameSimulation.ts (modify — major)
  ├── Add 'countdown' to GameState union
  ├── Add countdownTicks tracker (starts at 10)
  ├── processTick() branches: countdown ticks vs running ticks
  ├── Remove auto-attack: guard player attack behind attackTarget check
  ├── Add queueAttackTarget() / clearAttackTarget()
  ├── Auto-walk toward boss when attackTarget set and out of range
  ├── Clear attackTarget on ground-tile move
  └── Wire prayer multipliers into getPlayerAttackRoll() / getPlayerMaxHit()

src/input/InputManager.ts (modify — moderate)
  ├── handleClick(): check Boss.occupies() before queuing move
  ├── Boss click → sim.queueAttackTarget()
  └── Ground click → sim.queueMove() (existing, now also clears target)

src/entities/Player.ts (modify — minor)
  └── Add attackTarget: 'boss' | null field

src/render/PrayerPanel.ts (modify — moderate)
  ├── Mark Eagle Eye, Mystic Might, Piety, Rigour, Augury as interactive
  ├── Click handler: call sim.queueOffensivePrayer() with toggle logic
  └── update(): highlight active offensive prayer cells

src/render/Renderer.ts (modify — minor)
  ├── Draw countdown number during 'countdown' state
  └── Draw attack target indicator (yellow border on boss when targeted)

src/render/HUD.ts (modify — minor)
  └── Show countdown ticks remaining or "FIGHT!" text

src/combat/formulas.ts (no change)
  └── Already accepts prayerMult params — no modification needed
```

### Prayer Multiplier Data Flow

```
PrayerManager.activeOffensive (e.g. 'rigour')
        │
        ▼
OFFENSIVE_PRAYERS['rigour'] → { accuracyMult: 1.20, damageMult: 1.23, drainRate: 24 }
        │                                │
        │                                ▼
        │                  GameSimulation.getPlayerMaxHit()
        │                    rangedMaxHit(level, bonus, 1.23)
        ▼
GameSimulation.getPlayerAttackRoll()
  rangedAttackRoll(level, bonus, 1.20, 0)
```

### Tick Processing (Updated)

```
processTick():
  if state === 'countdown':
    1. Process inputs (move, prayer, inventory — NOT attack target)
    2. Apply queued prayers
    3. Drain prayer
    4. Player movement
    5. Decrement countdownTicks
    6. If countdownTicks === 0 → state = 'running'
    return (no combat)

  if state === 'running':
    1. Process inputs (move, prayer, inventory, attack target)
    2. Apply queued prayers
    3. Process inventory actions
    4. Drain prayer
    5. Player movement (toward attackTarget or targetTile)
    6. Boss AI (attack cooldown + fire)
    7. Boss damage resolution
    8. Player attack resolution (only if attackTarget set)
    9. Stomp check
    10. Death checks
```

---

## Implementation

### Phase 1: PrayerManager Expansion (~30% effort)

**Files:**
- `src/combat/PrayerManager.ts` -- Modify

**Tasks:**
- [ ] Define `OffensivePrayerType` union:
  ```typescript
  export type OffensivePrayerType =
    | 'eagle_eye'
    | 'mystic_might'
    | 'rigour'
    | 'augury'
    | 'piety';
  ```
- [ ] Define `OFFENSIVE_PRAYERS` data table:
  ```typescript
  export const OFFENSIVE_PRAYERS: Record<OffensivePrayerType, {
    accuracyMult: number;
    damageMult: number;
    drainRate: number;
    combatStyle: 'ranged' | 'magic' | 'melee';
  }> = {
    eagle_eye:   { accuracyMult: 1.15, damageMult: 1.15, drainRate: 12, combatStyle: 'ranged' },
    mystic_might:{ accuracyMult: 1.15, damageMult: 1.0,  drainRate: 12, combatStyle: 'magic' },
    rigour:      { accuracyMult: 1.20, damageMult: 1.23, drainRate: 24, combatStyle: 'ranged' },
    augury:      { accuracyMult: 1.25, damageMult: 1.0,  drainRate: 24, combatStyle: 'magic' },
    piety:       { accuracyMult: 1.20, damageMult: 1.23, drainRate: 24, combatStyle: 'melee' },
  };
  ```
- [ ] Rename `activePrayer` to `activeProtection` (type remains `PrayerType`). Add `activeOffensive: OffensivePrayerType | null = null`.
- [ ] Add `queuedOffensive: OffensivePrayerType | null | undefined = undefined` (undefined = no change queued, null = turn off).
- [ ] Add `queueOffensiveSwitch(prayer: OffensivePrayerType | null): void` -- queues an offensive prayer change.
- [ ] Update `applyQueued()` to process both protection and offensive queues.
- [ ] Update `drain()` to compute total drain rate from all active prayers:
  ```typescript
  drain(prayerBonus: number, currentPoints: number): number {
    let totalDrainRate = 0;
    if (this.activeProtection !== null) totalDrainRate += 12;
    if (this.activeOffensive !== null) {
      totalDrainRate += OFFENSIVE_PRAYERS[this.activeOffensive].drainRate;
    }
    if (totalDrainRate === 0 || currentPoints <= 0) return 0;

    const resistance = 2 * prayerBonus + 60;
    const drainPerTick = totalDrainRate / resistance;
    this.accumulatedDrain += drainPerTick;
    // ... existing epsilon-rounded floor logic ...
  }
  ```
- [ ] Update `deactivate()` to clear both `activeProtection` and `activeOffensive`.
- [ ] Update `reset()` to clear all new fields.
- [ ] Add helper methods for formula integration:
  ```typescript
  getAccuracyMult(weaponType: 'bow' | 'staff' | 'halberd'): number
  getDamageMult(weaponType: 'bow' | 'staff' | 'halberd'): number
  isAuguryActive(): boolean
  ```
  These map the weapon type to the corresponding combat style, check if the active offensive prayer matches that style, and return the multiplier (or 1.0 if no matching prayer).
- [ ] Ensure that activating an offensive prayer of one combat style deactivates any other offensive prayer (mutual exclusivity is automatic since there is only one `activeOffensive` slot).

### Phase 2: GameSimulation -- Wire Prayer Multipliers (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify

**Tasks:**
- [ ] Update `getPlayerAttackRoll()` to read multiplier from PrayerManager:
  ```typescript
  private getPlayerAttackRoll(): number {
    const weapon = this.player.loadout.weapon;
    const stats = this.player.stats;
    const accMult = this.prayerManager.getAccuracyMult(weapon.type);

    switch (weapon.type) {
      case 'bow':
        return rangedAttackRoll(stats.ranged, weapon.attackBonus, accMult, 0);
      case 'staff':
        return magicAttackRoll(stats.magic, weapon.attackBonus, accMult);
      case 'halberd':
        return meleeAttackRoll(stats.attack, weapon.attackBonus, accMult, 0);
    }
  }
  ```
- [ ] Update `getPlayerMaxHit()` similarly:
  ```typescript
  private getPlayerMaxHit(): number {
    const weapon = this.player.loadout.weapon;
    const stats = this.player.stats;
    const dmgMult = this.prayerManager.getDamageMult(weapon.type);

    switch (weapon.type) {
      case 'bow':
        return rangedMaxHit(stats.ranged, weapon.strengthBonus, dmgMult);
      case 'staff':
        return magicMaxHit(weapon.tier as 1 | 2 | 3, this.prayerManager.isAuguryActive());
      case 'halberd':
        return meleeMaxHit(stats.strength, weapon.strengthBonus, dmgMult, 0);
    }
  }
  ```
- [ ] Update all references from `prayerManager.activePrayer` to `prayerManager.activeProtection` throughout GameSimulation (protection prayer check in boss damage resolution at line 137-138).
- [ ] Update `queuePrayer()` signature or add `queueOffensivePrayer()` method that forwards to `prayerManager.queueOffensiveSwitch()`.

### Phase 3: Click-to-Attack Targeting (~25% effort)

**Files:**
- `src/entities/Player.ts` -- Modify
- `src/engine/GameSimulation.ts` -- Modify
- `src/input/InputManager.ts` -- Modify

**Tasks:**

**Player.ts:**
- [ ] Add `attackTarget: 'boss' | null = null` field.
- [ ] Update `reset()` to clear `attackTarget`.

**InputManager.ts:**
- [ ] Update `handleClick()` to detect boss clicks:
  ```typescript
  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tileX = Math.floor(px / TILE_SIZE);
    const tileY = Math.floor(py / TILE_SIZE);

    if (tileX < 0 || tileX >= 12 || tileY < 0 || tileY >= 12) return;

    if (this.sim.boss.occupies(tileX, tileY)) {
      this.sim.queueAttackTarget();
    } else {
      this.sim.queueMove({ x: tileX, y: tileY });
    }
  }
  ```
- [ ] The boss reference (`this.sim.boss`) is already accessible through the sim. No new constructor params needed.

**GameSimulation.ts:**
- [ ] Add `queuedAttackTarget: boolean = false` input flag.
- [ ] Add `queueAttackTarget(): void` method that sets the flag.
- [ ] In `processTick()` input processing:
  - If `queuedAttackTarget` is true: set `player.attackTarget = 'boss'`, clear `player.targetTile`, clear `queuedAttackTarget`.
  - If `queuedMove` is set: set `player.targetTile`, clear `player.attackTarget` (movement cancels attack).
- [ ] In player movement section: if `player.attackTarget === 'boss'` and player is out of weapon range, pathfind toward the nearest tile adjacent to the boss footprint:
  ```typescript
  if (this.player.attackTarget === 'boss') {
    const dist = this.boss.chebyshevDistTo(this.player.pos);
    const weapon = this.player.loadout.weapon;
    if (dist > weapon.range) {
      // Walk toward boss center (pathfinder will route around obstacles)
      const nextPos = findNextStep(
        this.player.pos,
        this.boss.center,
        this.arena,
        this.boss,
      );
      this.player.pos = nextPos;
    }
  }
  ```
- [ ] Guard player attack resolution behind `player.attackTarget === 'boss'`:
  ```typescript
  if (this.player.attackCooldown <= 0 && !this.playerAteThisTick
      && this.player.attackTarget === 'boss') {
    // ... existing attack logic ...
  }
  ```
- [ ] When attack fires successfully, do NOT clear `attackTarget` -- player continues attacking on cooldown as long as target is set (OSRS behavior: clicking once keeps attacking).

### Phase 4: 10-Tick Countdown (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify
- `src/render/Renderer.ts` -- Modify
- `src/render/HUD.ts` -- Modify

**Tasks:**

**GameSimulation.ts:**
- [ ] Expand `GameState` type: `'countdown' | 'running' | 'won' | 'lost'`.
- [ ] Add `countdownTicks: number = 10` field.
- [ ] Change initial state from `'running'` to `'countdown'`.
- [ ] Add countdown branch at top of `processTick()`:
  ```typescript
  processTick(): void {
    if (this.state === 'won' || this.state === 'lost') return;

    this.tick++;

    if (this.state === 'countdown') {
      // Process non-combat inputs: move, prayer, inventory (equip/eat)
      this.processNonCombatInputs();
      this.prayerManager.applyQueued();
      this.processInventoryActions();
      this.drainPrayer();
      this.movePlayer();

      this.countdownTicks--;
      if (this.countdownTicks <= 0) {
        this.state = 'running';
      }
      return;
    }

    // ... existing running-state logic ...
  }
  ```
- [ ] Extract shared logic (input processing, prayer drain, movement) into private helpers to avoid duplication between countdown and running branches. Candidates: `processNonCombatInputs()`, `drainPrayer()`, `movePlayer()`, `processInventoryActions()`.
- [ ] Ignore attack target queueing during countdown (player cannot initiate attacks).
- [ ] Boss does not fire attacks during countdown (its `attackCooldown` should not decrement).
- [ ] Update `runTicks()` to also break on states other than `'running'` -- it should process both countdown and running ticks:
  ```typescript
  runTicks(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.state === 'won' || this.state === 'lost') break;
      this.processTick();
    }
  }
  ```

**Renderer.ts:**
- [ ] In `draw()`, when `sim.state === 'countdown'`:
  ```typescript
  if (sim.state === 'countdown') {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = sim.countdownTicks > 0 ? String(sim.countdownTicks) : 'FIGHT!';
    ctx.fillText(text, CANVAS_SIZE / 2, CANVAS_SIZE / 2);
  }
  ```
- [ ] Draw the countdown text on top of everything else (last draw call) so it is always visible.
- [ ] When `player.attackTarget === 'boss'`, draw a yellow/orange highlight border around the boss footprint to indicate targeting:
  ```typescript
  if (sim.player.attackTarget === 'boss') {
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(
      boss.pos.x * TILE_SIZE, boss.pos.y * TILE_SIZE,
      boss.size * TILE_SIZE, boss.size * TILE_SIZE,
    );
    ctx.setLineDash([]);
  }
  ```

**HUD.ts:**
- [ ] During countdown, show remaining ticks in tick info: `Countdown: 7` instead of `Tick: 7`.
- [ ] After countdown ends, resume showing `Tick: N` as before (tick counter continues from where countdown left off).

### Phase 5: PrayerPanel -- Offensive Prayer Interactivity (~15% effort)

**Files:**
- `src/render/PrayerPanel.ts` -- Modify

**Tasks:**
- [ ] Mark five prayers as interactive in the `PRAYERS` array:
  ```typescript
  { id: 'eagle_eye',   ..., interactive: true },
  { id: 'mystic_might',..., interactive: true },
  { id: 'piety',       ..., interactive: true },
  { id: 'rigour',      ..., interactive: true },
  { id: 'augury',      ..., interactive: true },
  ```
- [ ] Map prayer panel IDs to `OffensivePrayerType` values. The IDs already match: `'eagle_eye'`, `'mystic_might'`, `'piety'`, `'rigour'`, `'augury'`.
- [ ] Add click handlers for offensive prayers in `build()`:
  ```typescript
  const OFFENSIVE_IDS = ['eagle_eye', 'mystic_might', 'piety', 'rigour', 'augury'];
  if (OFFENSIVE_IDS.includes(prayer.id)) {
    cell.addEventListener('click', () => {
      if (!this.sim) return;
      const current = this.sim.prayerManager.activeOffensive;
      this.sim.queueOffensivePrayer(
        current === prayer.id ? null : prayer.id as OffensivePrayerType,
      );
    });
  }
  ```
- [ ] Update `update()` to highlight active offensive prayer:
  ```typescript
  const activeOffensive = sim.prayerManager.activeOffensive;
  for (const id of OFFENSIVE_IDS) {
    const cell = this.cellElements.get(id);
    if (!cell) continue;
    if (id === activeOffensive) {
      cell.classList.add('active');
      cell.style.opacity = '1';
    } else {
      cell.classList.remove('active');
      cell.style.opacity = '0.6';
    }
  }
  ```
- [ ] Update existing protection prayer highlight logic to use `activeProtection` instead of `activePrayer`.

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/combat/PrayerManager.ts` | Modify (major) | Dual-slot prayer system, offensive prayer data table, summed drain rates, multiplier helpers |
| `src/engine/GameSimulation.ts` | Modify (major) | Countdown state, click-to-attack targeting, prayer multiplier wiring, refactored tick processing |
| `src/input/InputManager.ts` | Modify (moderate) | Boss footprint click detection, route to attack target vs ground move |
| `src/entities/Player.ts` | Modify (minor) | Add `attackTarget` field |
| `src/render/PrayerPanel.ts` | Modify (moderate) | Five offensive prayers become interactive with toggle/highlight |
| `src/render/Renderer.ts` | Modify (minor) | Countdown overlay text, attack target indicator on boss |
| `src/render/HUD.ts` | Modify (minor) | Countdown display in tick info |
| `src/combat/formulas.ts` | No change | Already parameterized with `prayerMult` -- receives real values now |
| `src/entities/Boss.ts` | No change | `occupies()` and `chebyshevDistTo()` already exist |
| `src/entities/types.ts` | No change | Existing types sufficient |

---

## Definition of Done

- [ ] `PrayerManager` supports two independent slots: `activeProtection` and `activeOffensive`
- [ ] Only one offensive prayer can be active at a time; activating one deactivates any other
- [ ] Protection and offensive prayers can be active simultaneously
- [ ] `drain()` sums drain rates from all active prayers and produces correct integer drain per tick
- [ ] Drain rate values match OSRS: protection = 12, Eagle Eye = 12, Mystic Might = 12, Rigour = 24, Augury = 24, Piety = 24
- [ ] `getPlayerAttackRoll()` passes real prayer accuracy multipliers to formulas (not `1.0`)
- [ ] `getPlayerMaxHit()` passes real prayer damage multipliers to formulas (not `1.0`)
- [ ] Augury adds +1 to staff max hit via `magicMaxHit(tier, true)` when active
- [ ] Mystic Might applies 1.15 accuracy but no damage bonus (staff base damage is fixed)
- [ ] Eagle Eye applies 1.15 to both accuracy and damage for ranged
- [ ] Piety applies 1.20 attack accuracy and 1.23 strength multiplier for melee
- [ ] Rigour applies 1.20 ranged accuracy and 1.23 ranged damage multiplier
- [ ] Offensive prayer multiplier only applies when the active prayer's combat style matches the equipped weapon type
- [ ] Game starts in `'countdown'` state with 10 ticks before `'running'`
- [ ] During countdown: player can move, equip, toggle prayers; neither side attacks
- [ ] Countdown renders as large centered text on the canvas (10, 9, ... 1)
- [ ] After countdown, state is `'running'` and normal combat rules apply
- [ ] Player does not auto-attack; must click boss to set attack target
- [ ] Clicking boss 5x5 footprint sets `attackTarget = 'boss'`
- [ ] Clicking a ground tile sets `targetTile` and clears `attackTarget`
- [ ] With attack target set and in range, player attacks on cooldown
- [ ] With attack target set and out of range, player auto-walks toward boss
- [ ] Attack target indicator (yellow dashed border) renders on boss when targeted
- [ ] Five offensive prayers are interactive in the prayer panel with correct highlight behavior
- [ ] All 90 existing tests pass (some may need minor updates for `activeProtection` rename and `'countdown'` state)
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] Zero new runtime dependencies

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rename `activePrayer` to `activeProtection` breaks existing tests | High | Low | Straightforward find-and-replace. All 90 tests are in-repo and can be batch-updated. Run the full suite after rename. |
| Countdown state breaks `runTicks()` in test harnesses | Medium | Medium | Tests that call `runTicks(N)` expecting immediate combat will need to account for 10 countdown ticks first. Either pass `countdownTicks = 0` in test setup, or add a `skipCountdown()` helper that sets state to `'running'` directly. |
| Click-to-attack changes break headless test simulations | Medium | Medium | Headless tests that verify player damage output will need to call `sim.queueAttackTarget()` before running ticks. Add a convenience method or set `attackTarget` directly in tests. |
| Prayer multiplier precision differs from OSRS wiki DPS calc | Low | High | All multipliers are exact values from the OSRS wiki. The existing `Math.floor` chain in formulas.ts matches the wiki DPS calculator. Add unit tests comparing computed max hits against known OSRS values (e.g., 99 ranged + Rigour + perfected bow). |
| Auto-walk toward boss gets stuck on boss footprint edge | Low | Medium | `findNextStep()` already handles boss collision avoidance. The target for pathfinding should be `boss.center` and the walker stops when `chebyshevDistTo() <= weapon.range`. Test with player at various positions around the arena. |
| Summed drain accumulator produces different drain timing than independent accumulators | Low | Low | Mathematically equivalent: `(a + b) / resistance` accumulated over ticks produces the same floor points as `a/resistance + b/resistance` accumulated independently (both are linear). Verify with a dedicated drain test: protection (12) + Rigour (24) at prayer bonus 12 → resistance 84 → drain per tick = 36/84 = 3/7 per tick → 1 point every ~2.33 ticks. |

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged).

### Dev
No new dev dependencies. Existing Vite + TypeScript + Vitest toolchain is sufficient.

### Internal (from prior sprints)
- Sprint 001: `formulas.ts` with parameterized `prayerMult` arguments
- Sprint 002: `Inventory` equip actions, `findNextStep()` pathfinding, `Boss.occupies()`, `Boss.chebyshevDistTo()`
- Sprint 003: `PrayerPanel` with prayer grid layout and interactive cells, `PRAYER_ICONS` asset manifest, overhead icon rendering

---

## Open Questions

1. **Should `runTicks()` auto-skip countdown for test ergonomics?** Many existing tests likely call `sim.runTicks(N)` expecting immediate combat. Options: (a) add `sim.skipCountdown()` that sets `state = 'running'` and `countdownTicks = 0`, (b) have the constructor accept an option to start in `'running'` state directly, (c) update all tests. Recommendation: option (a) -- add a `skipCountdown()` convenience method and call it in tests that do not specifically test countdown behavior. Keeps tests clean without a constructor parameter that could leak into production.

2. **Should offensive prayer deactivate when switching to a weapon of a different combat style?** In OSRS, switching from a bow to a staff while Rigour is active keeps Rigour on (it just provides no benefit for magic attacks). The drain continues. Options: (a) match OSRS -- keep prayer active but ineffective, (b) auto-deactivate on weapon switch as a quality-of-life feature. Recommendation: option (a) -- match OSRS. Players need to learn to manage their prayers when weapon switching. Auto-deactivation would mask a real CG skill check.

3. **Should the attack target persist across weapon switches?** In OSRS, switching weapons does not reset your attack target. The player continues attacking with the new weapon on its cooldown. Recommendation: yes, keep `attackTarget` set through weapon switches. This matches OSRS and avoids frustrating re-clicks during the 5:1 or T2 weapon rotation.

4. **How should the countdown interact with the boss's attack cooldown?** The boss starts with `attackCooldown = 5`. If the boss cooldown decrements during countdown, the boss would attack on tick 6 after countdown ends (tick 16 total). If the boss cooldown is frozen during countdown, the boss attacks 5 ticks after `'running'` begins (tick 15 total). In real CG, the Hunlef's first attack comes a fixed number of ticks after the fight starts. Recommendation: freeze the boss cooldown during countdown. Reset it to `attackSpeed` (5) when transitioning to `'running'`, so the first boss attack fires 5 ticks into combat.

5. **Should clicking the boss during countdown queue an attack target for when combat starts?** Options: (a) ignore boss clicks during countdown entirely, (b) allow setting `attackTarget` during countdown so the player attacks immediately when `'running'` begins. Recommendation: option (b) -- allow it. This matches the real CG muscle memory where players click the boss just before the fight starts. It is a small quality-of-life that does not affect game balance.
