# Sprint 021: Corrupted Hunlef Mechanic Accuracy Pass

## Overview

The simulator is missing several core Corrupted Hunlef mechanics: tornadoes spawn adjacent to the boss instead of in arena corners, the prayer-disabling magic attack doesn't exist, style-switch animations play instantly instead of with a 2-tick delay, stomp animation never fires on tornado summons, and stomp damage ticks every frame instead of on boss attack cadence.

This sprint brings the fight loop significantly closer to OSRS accuracy by adding 5 mechanical fixes that all extend existing patterns — the `stomp` and `prayer_disable` animation states already exist in `AnimationController` but are never triggered, and the tornado/projectile infrastructure is already in place.

**RNG impact**: These changes alter the seeded RNG call sequence. All seeds will produce different fight outcomes. cg-sim-player tests must be re-baselined after merge.

## Use Cases

1. **Prayer-disable attack**: During magic phases, one of the 4 attacks is a prayer-disable — a deep purple projectile that clears all active prayers on hit.
2. **Corner tornado spawns**: Tornadoes spawn in the four corners of the 12×12 arena instead of adjacent to the boss footprint.
3. **Tornado spawn delay**: Boss plays stomp animation on summon tick; tornadoes appear 1 tick later, don't move or damage until the tick after that.
4. **Style-switch 2-tick delay**: After the 4th attack of a cycle, `currentStyle` doesn't flip for 2 ticks. Attack cooldown keeps ticking (non-blocking). The switch animation plays during this window.
5. **Stomp on attack cadence**: Player under boss takes stomp damage only on the boss's attack tick (when `attackCooldown` reaches 0), not every tick. Stomp does not count toward the 4-attack cycle.
6. No regression in idle/attack/death animations.

## Architecture

### Boss Attack Rotation

```
[Ranged Phase: 4 counted attacks] → 2-tick style-switch delay → [Magic Phase: 4 counted attacks] → 2-tick delay → ...
```

Within each magic phase:
- **Tornado**: Fires on odd cycles, attack index 0 (existing behavior, unchanged).
- **Prayer-disable**: Fires on exactly one slot per magic phase, chosen randomly via `rng.next()` when the phase begins. If tornado occupies slot 0, prayer-disable is picked from slots 1-3.
- **Stomp**: If player is under boss when `attackCooldown` reaches 0, deal stomp damage, reset cooldown, skip `fireAttack()`. Does not advance `attackCounter`.

### Style-Switch Delay (Non-Blocking)

When `attackCounter` reaches 4, instead of immediately flipping `currentStyle`:
1. Set `pendingStyleSwitch = { nextStyle, triggerTick: currentTick + 2 }`
2. Each tick in GameSimulation, call `boss.maybeApplyStyleSwitch(currentTick)` — returns the new style when `triggerTick` is reached, otherwise null
3. `attackCooldown` continues ticking normally — no DPS penalty
4. Renderer triggers `playStyleSwitch()` when `pendingStyleSwitch` is first set (not when style actually changes)

### Prayer-Disable Mechanics

- Fires only during magic phases as one of the 4 counted attacks
- Damage is rolled identically to normal magic (same max hit, same prayer reduction)
- On projectile arrival, calls `prayerManager.deactivate()` — clears protection AND offensive prayers
- Projectile: `style: 'magic'`, `color: '#6622aa'`, `shape: 'orb'`, `effect: 'disable_prayers'`
- Boss plays `prayer_disable` animation (seq 8433) instead of `attack_magic`

### Tornado Corner Spawning

```ts
const TORNADO_CORNER_TILES: Position[] = [
  { x: 0,  y: 0  },   // SW
  { x: 11, y: 0  },   // SE
  { x: 0,  y: 11 },   // NW
  { x: 11, y: 11 },   // NE
];
```

Each tornado gets `TORNADO_CORNER_TILES[rng.nextInt(0, 3)]` — one RNG call per tornado. Count is still 2/3/4 by HP phase.

### Tornado Spawn Delay

1. **Tick T** (boss `fireAttack()` returns `'tornado'`): Set `pendingTornadoSpawnTick = tick + 1`. Play stomp animation. No tornadoes exist yet.
2. **Tick T+1**: Tornadoes are created with `activeTick = spawnTick + 1`. They are visible but don't move or damage.
3. **Tick T+2**: Tornadoes begin chasing the player.

### Event-Based Animation Dispatch

Replace the current projectile-scanning heuristic with explicit event fields on GameSimulation:

```ts
lastBossEventTick: number = -1;
lastBossEventType: 'attack_magic' | 'attack_ranged' | 'prayer_disable' | 'tornado_stomp' | 'stomp' | 'style_switch' | null = null;
lastBossStyleSwitchStyle: AttackStyle | null = null;
```

Renderer reads these fields with priority: death > style_switch > prayer_disable > tornado_stomp > stomp > standard attack.

## Implementation

### Phase 1: Boss State Machine Changes (~25% effort)

**File:** `src/entities/Boss.ts`

- [ ] Widen `BossAttackResult`: `AttackStyle | 'tornado' | 'prayer_disable'`
- [ ] Add fields:
  ```ts
  prayerDisableSlot: number = -1;
  pendingStyleSwitch: { nextStyle: AttackStyle; triggerTick: number } | null = null;
  ```
- [ ] Add `initMagicPhase(rng: () => number)`: picks slot 0-3; if tornado occupies slot 0 (odd cycle), pick from `Math.floor(rng() * 3) + 1` to avoid bias
- [ ] Modify `fireAttack()`:
  - Check tornado first (existing)
  - Check `currentStyle === 'magic' && attackCounter === prayerDisableSlot` → return `'prayer_disable'`
  - When `attackCounter >= 4`: store `pendingStyleSwitch = { nextStyle, triggerTick }` instead of flipping `currentStyle` immediately. Still increment `cycleCount` and reset `attackCounter`.
- [ ] Add `maybeApplyStyleSwitch(currentTick: number): AttackStyle | null` — if `pendingStyleSwitch` and `currentTick >= triggerTick`, flip `currentStyle`, clear pending, return new style
- [ ] Update `reset()` to clear new fields

**File:** `src/entities/Boss.test.ts`

- [ ] Test: 4 attacks → style doesn't flip until 2 ticks later
- [ ] Test: prayer-disable fires exactly once per magic phase
- [ ] Test: tornado and prayer-disable don't collide on same slot

### Phase 2: Projectile Effect & Prayer-Disable Resolution (~20% effort)

**File:** `src/entities/Projectile.ts`

- [ ] Add `effect?: 'disable_prayers'` to `Projectile` interface

**File:** `src/engine/GameSimulation.ts`

- [ ] Handle `bossAttackResult === 'prayer_disable'`:
  - Treat as `style: 'magic'` for damage calc and prayer protection check
  - Create projectile with `color: '#6622aa'`, `shape: 'orb'`, `effect: 'disable_prayers'`
  - Set `lastBossAttackStyle = 'magic'`
- [ ] In `resolveProjectiles()`: when boss projectile with `effect === 'disable_prayers'` arrives, call `this.prayerManager.deactivate()`
- [ ] Call `boss.initMagicPhase(() => this.rng.next())` when style switches to magic (in `maybeApplyStyleSwitch` result handler)

**File:** `src/__tests__/projectile.test.ts`

- [ ] Test: prayer-disable projectile clears all prayers on arrival
- [ ] Test: damage is still reduced by correct protection prayer

### Phase 3: Tornado Corner Spawns + Delay (~20% effort)

**File:** `src/engine/GameSimulation.ts`

- [ ] Add `pendingTornadoSpawnTick: number = -1`
- [ ] Add constant `TORNADO_CORNER_TILES`
- [ ] When `fireAttack()` returns `'tornado'`: set `pendingTornadoSpawnTick = tick + 1`, set event for stomp animation
- [ ] At start of running-state tick: if `pendingTornadoSpawnTick === tick`, spawn tornadoes, clear pending
- [ ] Rewrite `spawnTornadoes()`:
  ```ts
  for (let i = 0; i < count; i++) {
    const cornerIdx = this.rng.nextInt(0, 3);
    const corner = TORNADO_CORNER_TILES[cornerIdx];
    const tornado = createTornado(corner, this.tick);
    tornado.activeTick = this.tick + 1;
    this.tornadoes.push(tornado);
  }
  ```

**File:** `src/entities/types.ts`

- [ ] Add `activeTick?: number` to `Tornado` interface

**File:** `src/engine/GameSimulation.ts` (tornado movement/damage)

- [ ] Guard tornado movement: `if (tornado.activeTick !== undefined && this.tick < tornado.activeTick) continue`
- [ ] Guard tornado damage: same check

**File:** `src/__tests__/floor-tornado.test.ts`

- [ ] Test: tornadoes spawn in corner tiles only
- [ ] Test: tornadoes don't move or damage before `activeTick`
- [ ] Test: count is 2/3/4 by HP phase

### Phase 4: Stomp Cadence Fix (~15% effort)

**File:** `src/engine/GameSimulation.ts`

- [ ] Move stomp resolution from the current every-tick check (~line 536) to the boss attack section:
  ```
  if (boss.attackCooldown <= 0 && playerUnderBoss) {
    // Stomp — deal damage, reset cooldown, do NOT call fireAttack()
    damage = rng.nextInt(0, STOMP_MAX_HIT);
    boss.attackCooldown = boss.attackSpeed;
    // Set event for stomp animation
  }
  ```
- [ ] Remove the old every-tick stomp block
- [ ] Stomp does NOT advance `attackCounter` or `cycleCount`

**File:** `src/__tests__/integration.test.ts`

- [ ] Test: player under boss takes stomp only on attack cadence (every 5 ticks), not every tick

### Phase 5: Animation Dispatch (~10% effort)

**File:** `src/render/AnimationController.ts`

- [ ] Add `playPrayerDisable()`:
  ```ts
  playPrayerDisable(): void {
    if (this.currentState === 'death') return;
    this.crossFadeTo('prayer_disable');
  }
  ```

**File:** `src/render/Renderer3D.ts`

- [ ] Add event fields on tracking: `lastBossEventTick`, `lastBossEventType`, `lastBossStyleSwitchStyle`
- [ ] Rewrite `updateBossAnimations()` to read explicit event fields from GameSimulation:
  - Priority: death > style_switch > prayer_disable > tornado_stomp > stomp > standard attack
  - `style_switch`: call `playStyleSwitch(style)` when `pendingStyleSwitch` is first set
  - `prayer_disable`: call `playPrayerDisable()`
  - `tornado_stomp`: call `playStomp()`
  - `stomp`: call `playStomp()`
- [ ] Remove old projectile-scanning logic in `getBossAttackStyleThisTick()`
- [ ] Remove old `lastBossStyle`-based style-switch detection

**File:** `src/engine/GameSimulation.ts`

- [ ] Set `lastBossEventTick` and `lastBossEventType` at each boss action:
  - Normal attack → `'attack_magic'` / `'attack_ranged'`
  - Prayer-disable → `'prayer_disable'`
  - Tornado summon → `'tornado_stomp'`
  - Stomp → `'stomp'`
  - Style switch pending → `'style_switch'` + `lastBossStyleSwitchStyle`

### Phase 6: Verification & Re-baseline (~10% effort)

- [ ] `npm run build` passes
- [ ] `npm test` passes (fix any tests broken by new mechanics)
- [ ] `cd ../cg-sim-player && npm test` — if failures, re-baseline expected values (seeds changed)
- [ ] Playwright screenshots showing:
  - Stomp animation during tornado summon
  - Purple prayer-disable projectile
  - Tornadoes spawning in arena corners
  - Style-switch animation playing between attack sets
- [ ] Frame rate > 30fps

## Files Summary

| File | Changes |
|------|---------|
| `src/entities/Boss.ts` | Widen `BossAttackResult`, add `prayerDisableSlot`, `pendingStyleSwitch`, `initMagicPhase()`, `maybeApplyStyleSwitch()`. Modify `fireAttack()` to defer style switch and return `'prayer_disable'`. |
| `src/entities/types.ts` | Add `activeTick?: number` to `Tornado` interface |
| `src/entities/Projectile.ts` | Add `effect?: 'disable_prayers'` to `Projectile` interface |
| `src/engine/GameSimulation.ts` | Handle `'prayer_disable'` result, rewrite `spawnTornadoes()` for corners, add tornado delay, move stomp to attack cadence, add explicit event fields for renderer, call `maybeApplyStyleSwitch()` each tick |
| `src/render/AnimationController.ts` | Add `playPrayerDisable()` method |
| `src/render/Renderer3D.ts` | Rewrite `updateBossAnimations()` to use event-based dispatch with priority ordering. Remove projectile-scanning heuristic. |
| `src/entities/__tests__/Boss.test.ts` | Tests for style-switch delay, prayer-disable slot, tornado/prayer-disable collision |
| `src/__tests__/projectile.test.ts` | Tests for prayer-disable projectile effect |
| `src/__tests__/floor-tornado.test.ts` | Tests for corner spawns, activation delay, HP-phase counts |
| `src/__tests__/integration.test.ts` | Test for stomp cadence (attack-tick only) |

## Definition of Done

- [ ] Prayer-disable fires exactly once per magic phase on a random slot
- [ ] Prayer-disable projectile is visually distinct (deep purple `#6622aa`, orb)
- [ ] Prayer-disable arrival calls `prayerManager.deactivate()` (clears all prayers)
- [ ] Prayer-disable uses `prayer_disable` animation (seq 8433)
- [ ] Tornadoes spawn in arena corners (`{0,0}`, `{11,0}`, `{0,11}`, `{11,11}`)
- [ ] Tornado count scales with HP phase (2/3/4)
- [ ] Tornadoes appear 1 tick after stomp, don't move/damage until 1 tick after appearance
- [ ] Boss plays stomp animation on tornado summon tick
- [ ] Style-switch has 2-tick non-blocking delay (attackCooldown keeps ticking)
- [ ] Style-switch animation fires when delay starts, not when style flips
- [ ] Stomp damage fires only on boss attack cadence, not every tick
- [ ] Stomp does not advance the 4-attack counter
- [ ] Unit tests for: prayer-disable slot, corner tornado spawns, style-switch delay, stomp cadence
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes (re-baseline if needed due to RNG shift)
- [ ] Playwright screenshots verify animations and projectile visuals
- [ ] No regression in idle/attack/death animations
- [ ] Frame rate > 30fps

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RNG sequence shift breaks cg-sim-player tests | **Certain** | Medium | Accepted — re-baseline after merge. Old seeds were mechanically wrong. |
| Style-switch delay changes cg-sim-player bot timing | Medium | Medium | Non-blocking delay preserves 5-tick cadence. Bot reads `boss.currentStyle` which now flips 2 ticks later — may need bot adjustment. |
| Prayer-disable clears offensive prayers unexpectedly | Low | Low | Using existing `deactivate()` per user decision. Bot can re-enable prayers. |
| Stomp cadence fix changes fight outcomes | Medium | Low | Correct behavior — old every-tick stomp was a bug. Seeds are already shifting. |
| `stomp`/`prayer_disable` GLTF clips missing | Low | Medium | Already mapped in AnimationController; crossFadeTo falls back to no-op if clip missing. Verify via Playwright. |
| Tornado corner stacking (multiple tornadoes same corner) | Medium | Low | Acceptable — RNG may select same corner twice. Tornadoes will stack but still chase independently. |

## Security

No security implications. All changes are local game logic and rendering. No new dependencies, no network calls, no user input changes. All randomness through existing seeded RNG.

## Dependencies

- No new npm packages
- Existing GLTF assets contain `stomp` (seq 8432) and `prayer_disable` (seq 8433) clips
- `cg-sim-player` is read-only — tests will be re-baselined post-merge, not by modifying cg-sim-player code
- Existing `PrayerManager.deactivate()` clears both protection and offensive prayers

## Open Questions

1. **Prayer-disable rotation accuracy**: Using deterministic "one random slot per magic phase." If OSRS uses a per-attack probability instead, this can be adjusted later without architectural changes.
2. **Tornado spawn delay timing**: Using 1-tick delay (stomp → appear → chase). If OSRS uses 2-tick delay, change `activeTick = spawnTick + 2` and `pendingTornadoSpawnTick = tick + 2`.
3. **Attack animation accuracy**: The seed prompt mentions the attack animation might be wrong. Deferred to a separate visual sprint — requires frame-by-frame OSRS footage comparison.
4. **Stomp + style-switch overlap**: If player is under boss when style-switch is pending, stomp fires but style-switch animation has priority in renderer. Stomp damage still applies; animation may be visually lost. Acceptable for now.
