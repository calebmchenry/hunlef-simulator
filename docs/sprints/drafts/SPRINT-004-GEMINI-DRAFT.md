# Sprint 004 Draft: Offensive Prayers, Countdown Phase, Click-to-Attack Targeting

**Author perspective:** Interaction design architect

---

## Overview

This sprint introduces three tightly coupled interaction systems: a data-driven prayer model with offensive prayers, a countdown phase that gates combat while permitting preparation, and a click-to-attack targeting model that replaces the current auto-attack-on-range behavior. Every change touches the core input-to-simulation-to-render pipeline, so the design emphasizes clean entity references, explicit game phase transitions, and visual feedback that communicates targeting state to the player.

The central design tension is that the current `InputManager` treats every canvas click as a movement command, and `GameSimulation.processTick` attacks automatically whenever the player is in weapon range. Both assumptions must be broken. The replacement model: clicks on boss tiles produce a targeting intent, clicks on ground tiles produce a movement intent that clears targeting, and attacks only fire when the player holds a valid target reference and is in range.

---

## Use Cases

1. **Offensive prayer activation** -- Player clicks Eagle Eye / Mystic Might / Rigour / Augury / Piety in the prayer panel. The prayer activates next tick, applies its multiplier to combat formulas, and drains prayer alongside any active protection prayer.
2. **Offensive prayer exclusivity** -- Activating Rigour while Eagle Eye is on deactivates Eagle Eye. Protection prayers are unaffected. Activating a protection prayer does not deactivate an offensive prayer.
3. **Countdown phase** -- On game start (or reset), the simulation enters a `'countdown'` state lasting 10 ticks. A large countdown number renders on the canvas center. The player can move, equip items, and toggle prayers. Neither side can attack. After tick 10, the state transitions to `'running'` and a brief "FIGHT!" flash appears.
4. **Click boss to attack** -- Player clicks any tile within the boss's 5x5 footprint. The cursor changes to a sword icon on hover. The boss receives a red/yellow target highlight. The player auto-paths into weapon range, then attacks on cooldown.
5. **Click ground to move (clears target)** -- Player clicks any tile outside the boss footprint. The attack target is cleared. The player walks to the clicked tile. The boss target highlight disappears. Attacks stop until the player re-clicks the boss.
6. **Already in range** -- Player clicks boss while already within weapon range. No movement occurs. Attack fires on the next available tick (respecting cooldown).
7. **Weapon switch during targeting** -- Player equips a different weapon via inventory while targeting the boss. If the new weapon has a different range, the auto-path recalculates. The target is not cleared by equip actions.
8. **Prayer drain stacking** -- Player has both Protect from Magic (drain 12) and Rigour (drain 24) active. Both drain rates contribute to the accumulated drain calculation each tick.

---

## Architecture

### Data-Driven Prayer Definitions

The current `PrayerManager` hardcodes `PrayerType = 'magic' | 'missiles' | null` and uses a fixed drain rate of 12. This does not extend to offensive prayers that have different drain rates, multipliers, and mutual exclusion rules.

Replace the string-literal model with a prayer definition table:

```
PrayerDefinition {
  id: string                       // 'protect_from_magic', 'rigour', etc.
  name: string                     // Display name
  group: 'protection' | 'offensive'  // Exclusivity group
  drainRate: number                // OSRS drain rate value
  combatStyle?: 'melee' | 'ranged' | 'magic'  // What combat style this buffs
  accuracyMult?: number            // e.g. 1.20 for Rigour
  damageMult?: number              // e.g. 1.23 for Rigour
  auguryBonus?: boolean            // Special flag: +1 magic max hit
}
```

Exclusivity rule: within the same `group`, only one prayer can be active. Activating a prayer in a group deactivates the current prayer in that group. Prayers in different groups coexist.

The prayer table (seven entries for CG-relevant prayers):

| id | group | drainRate | combatStyle | accuracyMult | damageMult | notes |
|----|-------|-----------|-------------|-------------|-----------|-------|
| `protect_from_magic` | protection | 12 | - | - | - | Existing |
| `protect_from_missiles` | protection | 12 | - | - | - | Existing |
| `eagle_eye` | offensive | 12 | ranged | 1.15 | 1.15 | |
| `mystic_might` | offensive | 12 | magic | 1.15 | - | Staff has fixed max hit |
| `rigour` | offensive | 24 | ranged | 1.20 | 1.23 | |
| `augury` | offensive | 24 | magic | 1.25 | - | auguryBonus = true (+1 max hit) |
| `piety` | offensive | 24 | melee | 1.20 | 1.23 | accuracyMult applies to attack, damageMult to strength |

### PrayerManager Redesign

The `PrayerManager` stores up to two active prayers (one per group) instead of a single `activePrayer` field:

```
activeProtection: PrayerDefinition | null
activeOffensive: PrayerDefinition | null
```

The `drain()` method iterates all active prayers, sums their `drainRate / resistance` contributions, and accumulates fractional drain as before. The accumulated drain counter remains a single float -- OSRS uses a single drain accumulator across all active prayers.

Public query methods:
- `getAccuracyMult(style: 'melee' | 'ranged' | 'magic'): number` -- returns the active offensive prayer's accuracy multiplier if it matches the given style, else `1.0`.
- `getDamageMult(style: 'melee' | 'ranged' | 'magic'): number` -- same for damage.
- `hasAuguryBonus(): boolean` -- returns true if Augury is active.
- `isProtecting(against: 'magic' | 'missiles'): boolean` -- replaces the current `activePrayer === 'magic'` checks.

### Targeting System: `attackTarget` as Entity Reference

Add to `Player`:

```typescript
attackTarget: Boss | null = null;
```

This is a direct object reference to the boss entity, not a position. The reference is semantically "I intend to attack this entity." It is distinct from `targetTile`, which means "I intend to walk to this position."

State transitions:

```
Click boss tile  -->  player.attackTarget = boss
                      player.targetTile = null  (stop any queued ground move)

Click ground tile --> player.attackTarget = null
                      player.targetTile = clickedPosition

Player reaches   --> targetTile is cleared (existing behavior)
  targetTile         attackTarget is NOT cleared
```

The `attackTarget` reference is only cleared by:
1. Clicking a ground tile (explicit cancel)
2. Boss death (target becomes invalid)
3. Game reset

It is NOT cleared by:
- Reaching the boss (player stays locked on)
- Eating food (delays attack but does not cancel targeting)
- Equipping items (weapon switch preserves targeting intent)

### Auto-Path Into Range

When `attackTarget` is set and `player.attackCooldown <= 0` and the player is NOT in weapon range:

1. Compute the nearest tile adjacent to the boss footprint that is within weapon range.
2. Set `player.targetTile` to that position.
3. The existing pathfinding system (`findNextStep`) moves the player one tile per tick.
4. When the player arrives in range, the attack fires.

"Nearest tile in range" calculation: for each tile on the border of the boss's 5x5 footprint expanded by the weapon range, find the one with the smallest Chebyshev distance to the player's current position. For melee (range 1), this is any tile adjacent to the 5x5. For ranged (range 6+), many tiles qualify -- pick the closest.

Simplification: since the boss does not move in the current implementation, the auto-path destination does not need to be recalculated each tick. Compute it once when the target is set, and only recompute if the weapon range changes (weapon switch). If future sprints add boss movement, this becomes a per-tick recalculation.

### Click Detection: Boss vs Ground

`InputManager.handleClick` currently converts pixel coordinates to tile coordinates and always calls `sim.queueMove()`. The new logic:

```
handleClick(px, py):
  tileX, tileY = pixelToTile(px, py)
  if sim.boss.occupies(tileX, tileY):
    sim.queueAttackTarget(sim.boss)   // new method
  else:
    sim.queueMove({ x: tileX, y: tileY })
```

The `queueAttackTarget` method on `GameSimulation`:

```typescript
queueAttackTarget(boss: Boss): void {
  this.queuedAttackTarget = boss;
  this.queuedMove = null;  // cancel any pending ground move
}
```

In `processTick`, input processing becomes:

```
if queuedAttackTarget:
  player.attackTarget = queuedAttackTarget
  player.targetTile = computePathIntoRange(player, boss, weapon.range)
  queuedAttackTarget = null

if queuedMove:
  player.attackTarget = null   // ground click clears attack target
  player.targetTile = queuedMove
  queuedMove = null
```

### Cursor Feedback

When hovering over boss tiles, the canvas cursor changes to signal "this is an attackable entity":

```typescript
handleMouseMove(e: MouseEvent):
  tileX, tileY = pixelToTile(px, py)
  if sim.boss.occupies(tileX, tileY):
    canvas.style.cursor = 'crosshair'
  else:
    canvas.style.cursor = 'default'
```

Using `'crosshair'` (a built-in CSS cursor) avoids custom cursor image complexity. OSRS uses a red sword cursor, but `crosshair` is a reasonable approximation for a training tool and requires zero assets.

### Attack Target Highlight on Boss

When `player.attackTarget` is set, the `Renderer` draws a yellow/red pulsing border around the boss footprint to indicate targeting:

```
if sim.player.attackTarget:
  // Draw a 2px animated border (alternating yellow/red every 500ms)
  ctx.strokeStyle = (Date.now() % 1000 < 500) ? '#ffcc00' : '#ff4444'
  ctx.lineWidth = 2
  ctx.setLineDash([6, 3])
  ctx.strokeRect(boss footprint, inset 1px from the existing style border)
  ctx.setLineDash([])
```

This gives clear feedback: "you are attacking this entity." The dashed line distinguishes it from the solid style-colored border.

### Countdown Phase

Add `'countdown'` to `GameState`:

```typescript
export type GameState = 'countdown' | 'running' | 'won' | 'lost';
```

The simulation starts in `'countdown'` instead of `'running'`. The constructor sets `this.state = 'countdown'`.

`processTick` behavior by state:

| Step | `countdown` | `running` |
|------|-------------|-----------|
| Increment tick | Yes | Yes |
| Process move queue | Yes | Yes |
| Process prayer queue | Yes | Yes |
| Process inventory queue | Yes | Yes |
| Drain prayer | Yes | Yes |
| Player movement | Yes | Yes |
| Boss AI (fire attack) | **No** | Yes |
| Boss damage resolution | **No** | Yes |
| Player attack resolution | **No** | Yes |
| Stomp check | **No** | Yes |
| Death checks | **No** | Yes |
| Countdown transition | Yes (check tick >= 10) | No |

Implementation approach -- rather than scattering `if (this.state === 'countdown')` guards throughout the tick, extract combat steps into a `processCombat()` method and only call it when `state === 'running'`:

```typescript
processTick(): void {
  if (this.state === 'won' || this.state === 'lost') return;

  this.tick++;

  // Always: inputs, prayer, movement
  this.processInputs();
  this.processPrayerDrain();
  this.processMovement();

  if (this.state === 'running') {
    this.processCombat();  // boss AI, damage, player attack, stomp, death
  }

  if (this.state === 'countdown' && this.tick >= 10) {
    this.state = 'running';
  }
}
```

This is cleaner than conditional guards and makes the phase boundary explicit.

### Countdown Visual Overlay

The `Renderer` draws a large centered countdown number on the canvas during the countdown phase:

```
if sim.state === 'countdown':
  remaining = 10 - sim.tick
  text = remaining > 0 ? String(remaining) : 'FIGHT!'

  // Semi-transparent dark overlay behind the number
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  // Large white text with black outline
  ctx.font = 'bold 72px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Black outline (4 offset draws)
  ctx.fillStyle = '#000000'
  for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2]]) {
    ctx.fillText(text, CANVAS_SIZE/2 + dx, CANVAS_SIZE/2 + dy)
  }

  // White fill
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, CANVAS_SIZE/2, CANVAS_SIZE/2)
```

The "FIGHT!" text shows for 1 tick (the tick where `state` transitions from `'countdown'` to `'running'`). To display it, add a `countdownJustEnded` flag that is set to `true` on the transition tick and cleared next tick. The Renderer checks this flag to show "FIGHT!" for one render frame after the countdown ends.

Alternatively, since `Renderer.draw()` is called after `processTick()`, and the transition happens at `tick === 10`, the Renderer can simply check `sim.tick === 10 && sim.state === 'running'` to infer "FIGHT!" should display. This avoids extra state.

### HUD Countdown Display

The `HUD` shows a countdown indicator during the countdown phase:

```
if sim.state === 'countdown':
  tickInfo.textContent = `Countdown: ${10 - sim.tick}`
else:
  tickInfo.textContent = `Tick: ${sim.tick}`
```

Optionally, the HUD could also show a text banner, but the canvas overlay is the primary visual. The HUD tick display is sufficient secondary information.

### Interaction Between Targeting and Countdown

During countdown, the player can click the boss to set the attack target. The target highlight renders, and the player auto-paths into range. But no attack fires until the state transitions to `'running'`. This lets skilled players pre-position during countdown, which is authentic to OSRS CG where players run toward the boss and click it before the fight starts.

### Combat Formula Integration

`GameSimulation.getPlayerAttackRoll()` and `getPlayerMaxHit()` currently pass `1.0` as the prayer multiplier. Replace with lookups from the prayer manager:

```typescript
private getPlayerAttackRoll(): number {
  const weapon = this.player.loadout.weapon;
  const stats = this.player.stats;
  const style = this.weaponToCombatStyle(weapon.type);  // 'melee' | 'ranged' | 'magic'
  const prayerMult = this.prayerManager.getAccuracyMult(style);

  switch (weapon.type) {
    case 'bow':
      return rangedAttackRoll(stats.ranged, weapon.attackBonus, prayerMult, 0);
    case 'staff':
      return magicAttackRoll(stats.magic, weapon.attackBonus, prayerMult);
    case 'halberd':
      return meleeAttackRoll(stats.attack, weapon.attackBonus, prayerMult, 0);
  }
}

private getPlayerMaxHit(): number {
  const weapon = this.player.loadout.weapon;
  const stats = this.player.stats;
  const style = this.weaponToCombatStyle(weapon.type);
  const prayerMult = this.prayerManager.getDamageMult(style);

  switch (weapon.type) {
    case 'bow':
      return rangedMaxHit(stats.ranged, weapon.strengthBonus, prayerMult);
    case 'staff':
      return magicMaxHit(weapon.tier as 1 | 2 | 3, this.prayerManager.hasAuguryBonus());
    case 'halberd':
      return meleeMaxHit(stats.strength, weapon.strengthBonus, prayerMult, 0);
  }
}
```

Note: `magicMaxHit` already accepts an `augury` boolean. The `prayerMult` for magic accuracy is passed to `magicAttackRoll`. Magic max hit is not multiplied by prayer (staff has a fixed base) -- only Augury adds +1. This is already correctly modeled in the existing `magicMaxHit` function.

### queuePrayer Redesign

The current `queuePrayer(prayer: PrayerType)` accepts `'magic' | 'missiles' | null`. The new version must accept any prayer definition ID:

```typescript
queuePrayer(prayerId: string | null): void {
  this.queuedPrayer = prayerId;
}
```

The `PrayerManager.queueSwitch` method looks up the prayer definition, determines which group it belongs to, and applies exclusivity:

```
queueSwitch(prayerId: string | null):
  if prayerId is null:
    deactivate all prayers
    return

  def = PRAYER_DEFS[prayerId]

  if def.group === 'protection':
    if activeProtection?.id === prayerId:
      activeProtection = null  // toggle off
    else:
      activeProtection = def   // activate (replaces any existing protection)

  if def.group === 'offensive':
    if activeOffensive?.id === prayerId:
      activeOffensive = null   // toggle off
    else:
      activeOffensive = def    // activate (replaces any existing offensive)
```

### PrayerPanel Updates

The `PrayerPanel` must make five additional prayers interactive: `eagle_eye`, `mystic_might`, `rigour`, `augury`, `piety`. Their `interactive` field in `PRAYERS` becomes `true`.

The click handler generalizes:

```typescript
cell.addEventListener('click', () => {
  if (!this.sim) return;
  this.sim.queuePrayer(prayer.id);
});
```

The `update()` method must check both `activeProtection` and `activeOffensive` to highlight active prayers:

```typescript
update(sim: GameSimulation): void {
  this.sim = sim;
  const pm = sim.prayerManager;

  for (const [id, cell] of this.cellElements) {
    const prayer = PRAYERS.find(p => p.id === id);
    if (!prayer || !prayer.interactive) continue;

    const isActive =
      pm.activeProtection?.id === id ||
      pm.activeOffensive?.id === id;

    if (isActive) {
      cell.classList.add('active');
      cell.style.opacity = '1';
    } else {
      cell.classList.remove('active');
      cell.style.opacity = '0.6';
    }
  }
}
```

### Player Overhead Icon Update

The `Renderer` currently checks `sim.prayerManager.activePrayer` (a string) to decide which overhead to draw. With the new model, it checks `sim.prayerManager.activeProtection`:

```
const protection = sim.prayerManager.activeProtection;
if (protection) {
  const img = protection.id === 'protect_from_magic' ? this.overheadMagic : this.overheadMissiles;
  // draw as before
}
```

Offensive prayers do not produce overhead icons (OSRS does not show overhead icons for offensive prayers).

---

## Implementation

### Phase 1: Data-Driven Prayer Definitions

Refactor `PrayerManager` to use a definition table and support two active prayer slots.

| File | Action | Description |
|------|--------|-------------|
| `src/combat/PrayerManager.ts` | Rewrite | Replace `PrayerType` with `PrayerDefinition` interface. Add `PRAYER_DEFS` lookup table with all 7 CG-relevant prayers. Store `activeProtection` and `activeOffensive` instead of single `activePrayer`. Implement `queueSwitch(id)` with group-based exclusivity. Implement `drain()` summing drain rates of all active prayers. Add `getAccuracyMult()`, `getDamageMult()`, `hasAuguryBonus()`, `isProtecting()` query methods. |

### Phase 2: Combat Formula Integration

Wire prayer multipliers into the existing formula calls.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | Update `getPlayerAttackRoll()` and `getPlayerMaxHit()` to read multipliers from `prayerManager.getAccuracyMult()` / `getDamageMult()` / `hasAuguryBonus()`. Add `weaponToCombatStyle()` helper. Update `queuePrayer()` signature to accept `string \| null`. Update protection prayer check in boss damage resolution to use `prayerManager.isProtecting()`. |

### Phase 3: Countdown Phase

Add the countdown game state with proper tick gating.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | Add `'countdown'` to `GameState`. Change initial state to `'countdown'`. Refactor `processTick()` to extract `processInputs()`, `processPrayerDrain()`, `processMovement()`, `processCombat()`. Only call `processCombat()` when `state === 'running'`. Transition to `'running'` when `tick >= 10`. |
| `src/render/Renderer.ts` | Modify | Add countdown overlay rendering: semi-transparent backdrop, large centered countdown number (72px bold monospace), "FIGHT!" on transition tick. |
| `src/render/HUD.ts` | Modify | Show "Countdown: N" in tick display during countdown phase. |

### Phase 4: Click-to-Attack Targeting

Replace auto-attack with explicit targeting via boss click detection.

| File | Action | Description |
|------|--------|-------------|
| `src/entities/Player.ts` | Modify | Add `attackTarget: Boss \| null = null`. Clear in `reset()`. |
| `src/input/InputManager.ts` | Modify | In `handleClick()`, check `sim.boss.occupies(tileX, tileY)`. If true, call `sim.queueAttackTarget(sim.boss)`. If false, call `sim.queueMove()` as before. Add `mousemove` listener for cursor feedback: `crosshair` over boss, `default` elsewhere. |
| `src/engine/GameSimulation.ts` | Modify | Add `queuedAttackTarget` field and `queueAttackTarget()` method. In input processing, set `player.attackTarget` from queue and compute path-into-range tile. When `queuedMove` is processed, clear `player.attackTarget`. Gate player attack resolution on `player.attackTarget !== null`. Add `computePathIntoRange()` helper that finds the nearest tile within weapon range of the boss footprint. |

### Phase 5: Visual Feedback

Add target highlight, cursor changes, and attack target indicator to the renderer.

| File | Action | Description |
|------|--------|-------------|
| `src/render/Renderer.ts` | Modify | When `sim.player.attackTarget` is set, draw a dashed yellow/red animated border around the boss footprint. |
| `src/render/PrayerPanel.ts` | Modify | Set `interactive: true` for eagle_eye, mystic_might, rigour, augury, piety. Generalize click handler to call `sim.queuePrayer(prayer.id)`. Update `update()` to check both `activeProtection` and `activeOffensive` for highlight state. |

### Phase 6: runTicks Compatibility

Ensure headless test running still works with the new countdown state.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | Update `runTicks()` to also process during `'countdown'` state (it currently breaks on `state !== 'running'`). The method should continue ticking through countdown into running. |

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `src/combat/PrayerManager.ts` | Rewrite | 1 |
| `src/engine/GameSimulation.ts` | Modify | 2, 3, 4, 6 |
| `src/render/Renderer.ts` | Modify | 3, 5 |
| `src/render/HUD.ts` | Modify | 3 |
| `src/entities/Player.ts` | Modify | 4 |
| `src/input/InputManager.ts` | Modify | 4 |
| `src/render/PrayerPanel.ts` | Modify | 5 |

**Modified files:** 7 | **New files:** 0

---

## Definition of Done

1. **Prayer definition table** -- All 7 CG-relevant prayers defined with correct OSRS drain rates and multipliers: Eagle Eye (acc 1.15, dmg 1.15, drain 12), Mystic Might (acc 1.15, drain 12), Rigour (acc 1.20, dmg 1.23, drain 24), Augury (acc 1.25, +1 magic max hit, drain 24), Piety (atk 1.20, str 1.23, drain 24), Protect from Magic (drain 12), Protect from Missiles (drain 12).
2. **Group exclusivity** -- Activating Rigour deactivates Eagle Eye (same offensive group). Activating Protect from Magic deactivates Protect from Missiles (same protection group). Rigour + Protect from Magic coexist.
3. **Stacked drain** -- With Protect from Magic (drain 12) + Rigour (drain 24) active, total drain rate is 36 per tick cycle. Fractional accumulator correctly handles the combined rate.
4. **Combat formulas use prayer multipliers** -- With Rigour active and a bow equipped, `rangedAttackRoll` receives 1.20 and `rangedMaxHit` receives 1.23. With Augury active and a staff equipped, `magicMaxHit` returns base + 1. With no offensive prayer, multipliers are 1.0.
5. **Countdown phase (10 ticks)** -- Game starts in `'countdown'`. Player can move, equip, toggle prayers. No attacks fire from either side. State transitions to `'running'` at tick 10.
6. **Countdown visual** -- Large number ("10" ... "1") renders centered on canvas with dark backdrop. "FIGHT!" appears on the transition tick.
7. **Click boss to target** -- Clicking any tile in the boss 5x5 footprint sets `player.attackTarget = boss` and clears any pending ground move.
8. **Click ground clears target** -- Clicking a tile outside the boss footprint sets `player.targetTile` and clears `player.attackTarget`. Attacks stop.
9. **Auto-path into range** -- When `attackTarget` is set and player is out of weapon range, `targetTile` is set to the nearest in-range tile. Player walks there via existing pathfinding.
10. **Attack fires on cooldown with target** -- When `attackTarget` is set, player is in range, and cooldown is 0, the attack fires. No attack fires without a target, even if in range.
11. **Cursor feedback** -- Canvas cursor changes to `crosshair` when hovering over boss tiles, `default` elsewhere.
12. **Target highlight** -- Dashed animated border renders around boss footprint when `attackTarget` is set.
13. **Offensive prayers in panel** -- Eagle Eye, Mystic Might, Rigour, Augury, and Piety are interactive (clickable, highlight when active, dim when inactive).
14. **All 90 existing tests pass** -- No regressions. `runTicks()` correctly processes countdown-to-running transitions.
15. **New tests:**
    - PrayerManager: group exclusivity (activate Rigour then Eagle Eye, only Eagle Eye active)
    - PrayerManager: stacked drain calculation (protection + offensive)
    - PrayerManager: `getAccuracyMult` / `getDamageMult` return correct values per weapon style
    - GameSimulation: countdown phase blocks attacks for 10 ticks
    - GameSimulation: countdown allows prayer toggle and movement
    - GameSimulation: click-to-attack sets target, attack fires in range
    - GameSimulation: ground click clears target, stops attacks
    - GameSimulation: player auto-paths into range when targeting boss

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| PrayerManager rewrite breaks all 90 existing tests that touch prayers | High | Phase 1 maintains the same external behavior for protection prayers. `isProtecting('magic')` replaces `activePrayer === 'magic'`. Run test suite after Phase 1 before proceeding. |
| `queuePrayer` signature change (`PrayerType` to `string \| null`) ripples through many call sites | Medium | The old `PrayerType` is removed. All call sites (PrayerPanel, InputManager Escape handler, tests) must be updated to use prayer definition IDs. Grep for `queuePrayer` to find all call sites. |
| Countdown phase breaks `runTicks()` in tests | High | Current `runTicks` exits when `state !== 'running'`. Must update to also process during `'countdown'`. Alternatively, add a `skipCountdown()` method for test convenience. |
| Auto-path-into-range calculation may produce incorrect tiles near arena walls | Low | Use the existing `findNextStep` pathfinding. The range tile calculation only needs to find a reachable tile at the correct Chebyshev distance from the boss. Arena is open (no internal walls), so any tile within bounds and in range is reachable. |
| `attackTarget` as a direct Boss reference creates a coupling between Player and Boss types | Low | Acceptable for a simulator with exactly one boss entity. If multiple targetable entities are added later, generalize to a `Targetable` interface. Not needed now. |

---

## Dependencies

- **Sprint 3 complete** -- 90 tests passing, OSRS images in all panels, overhead icons on canvas, prayer panel with interactive Protect from Magic / Protect from Missiles.
- **Combat formulas already parameterized** -- `meleeMaxHit`, `rangedMaxHit`, `magicMaxHit`, `meleeAttackRoll`, `rangedAttackRoll`, `magicAttackRoll` all accept prayer multiplier arguments. No formula changes needed, only passing correct values.
- **Boss.occupies() exists** -- Used for stomp detection, now reused for click-target detection.
- **Boss.chebyshevDistTo() exists** -- Used for range checking, now reused for auto-path range calculation.

---

## Open Questions

1. **Should `attackTarget` be a generic entity reference or specifically `Boss | null`?** The simulator has exactly one targetable entity. A generic `Targetable` interface adds abstraction with no current consumers. Recommendation: use `Boss | null` for simplicity. Generalize in a future sprint if NPCs or multi-target scenarios are added.

2. **Should the countdown be configurable (e.g., 5 ticks for quick practice)?** OSRS CG uses a 10-tick countdown. A `COUNTDOWN_TICKS` constant makes this trivially adjustable, but exposing it in the UI is a future consideration. Recommendation: define `const COUNTDOWN_TICKS = 10` and use it everywhere. Do not add a UI control this sprint.

3. **Should Escape deactivate offensive prayers too?** Currently Escape calls `sim.queuePrayer(null)`, which deactivates the protection prayer. With two prayer groups, `null` should deactivate ALL prayers (both groups). This is the expected "panic deactivate" behavior. Recommendation: `queuePrayer(null)` deactivates both groups.

4. **Should the auto-path recalculate every tick or only on target acquisition?** If the boss is stationary (current behavior), once is sufficient. If the boss moves in future sprints, per-tick recalculation is needed. Recommendation: recalculate when (a) target is first set, (b) weapon is switched (range may change). Add a TODO comment for per-tick recalculation when boss movement is implemented.

5. **Should the "FIGHT!" text persist for more than one render frame?** One tick at 600ms game time is visually brief but perceptible if the render loop runs at 60fps (the text shows for ~600ms real time between tick processing). Recommendation: show "FIGHT!" for the duration of tick 10 (one full game tick). This is long enough to read.

6. **Should eating food clear the attack target?** In OSRS, eating delays but does not cancel combat. The player remains in combat stance. Recommendation: eating does NOT clear `attackTarget`. The existing `playerAteThisTick` flag already prevents the attack from firing on the eat tick. Next tick, the attack resumes normally.
