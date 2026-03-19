# Sprint 021: Corrupted Hunllef Mechanic Accuracy Pass

## Overview

This sprint aligns the simulator with live Corrupted Hunllef behavior in the places where the current engine is still visibly wrong: tornadoes spawning beside the boss instead of in room corners, missing prayer-disable magic, immediate style flips with no delayed telegraph, and missing boss animation dispatch for tornado summons and prayer disable.

Mechanics confirmed from current OSRS references:

- Hunllef always starts with ranged.
- It switches standard attack style after any four counted attacks.
- Counted attacks include standard attacks, prayer-disable magic, and tornado summons.
- Stomp does not count toward the four-attack cycle.
- Prayer-disable is a magic-phase attack and disables all prayers on hit.
- Tornadoes last 20 ticks.
- Regular Hunllef spawns 1-3 tornadoes by HP band; Corrupted Hunllef spawns one extra tornado per summon, so Corrupted should be 2/3/4.
- Jagex added a pre-switch animation/sound cue in July 2020 and earlier audio cues in May 2023.

Primary sources used for this draft:

- [Corrupted Hunllef](https://oldschool.runescape.wiki/w/Corrupted_Hunllef)
- [The Gauntlet/Strategies](https://oldschool.runescape.wiki/w/The_Gauntlet/Strategies)
- [Update: Poll 71 and Death Feedback Changes](https://secure.runescape.com/m=news/poll-71-and-death-feedback-changes?oldschool=1)
- [Update: Tithe Farm Updates & More Poll 79!](https://secure.runescape.com/m=news/tithe-farm-updates--more-poll-79-?oldschool=1)
- [Update: SOTE Changes and Small Game Updates](https://secure.runescape.com/m=news/sote-changes-and-small-game-updates?oldschool=1)

Two details still need final lock before merge: the exact prayer-disable proc chance and whether tornado-count thresholds exactly match the existing `FloorHazardManager` phase bands or a separate set of HP cutoffs.

## Use Cases

1. As a player, I see tornadoes appear in distinct arena corners instead of beside the boss, giving the fight the correct spatial rhythm.
2. As a player, I can identify the prayer-disable attack because it is a distinct magic projectile and animation, and all active prayers are dropped when it lands.
3. As a player, I get the style-switch cue after the fourth counted attack and before the next projectile, instead of the boss silently flipping styles inside the same attack method.
4. As a player, I see the boss stomp when summoning tornadoes.
5. As a player, if I stand under Hunllef on an attack tick, I get a single stomp attack rather than continuous every-tick stomp damage.
6. As a developer, boss attack timing remains deterministic under seeded RNG.
7. As a developer, renderer animation dispatch comes from explicit simulation events instead of reverse-engineering projectile state every frame.

## Architecture

### 1. Boss Attack State Becomes Tick-Aware

Do not fold specials into `AttackStyle`. Keep `AttackStyle = 'ranged' | 'magic'` and widen only the boss attack result:

```ts
export type BossAttackResult = AttackStyle | 'tornado' | 'prayer_disable';

interface PendingStyleSwitch {
  nextStyle: AttackStyle;
  triggerTick: number;
}
```

Add named constants in [Boss.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/Boss.ts):

```ts
const STYLE_SWITCH_DELAY_TICKS = 2;
const PRAYER_DISABLE_CHANCE_ON_MAGIC = /* Phase 0 lock */;
```

Proposed API:

```ts
fireAttack(currentTick: number, rngNext: () => number): BossAttackResult
maybeApplyStyleSwitch(currentTick: number): AttackStyle | null
```

Behavior:

- `fireAttack()` still owns the four-count cycle.
- On the fourth counted attack, it resets `attackCounter`, increments `cycleCount`, and stores a `pendingStyleSwitch` instead of flipping `currentStyle` immediately.
- `maybeApplyStyleSwitch()` flips `currentStyle` at `triggerTick` and returns the new style so `GameSimulation` can expose a one-shot render cue.
- Prayer-disable is only eligible during magic phase and still counts as one of the four attacks.

### 2. Stomp Stays in `GameSimulation`

Stomp depends on the player being under the boss at the moment an attack is attempted, so keep it in [GameSimulation.ts](/Users/caleb.mchenry/code/me/cg-sim/src/engine/GameSimulation.ts), not `Boss.ts`.

Attack-tick flow:

1. decrement boss cooldown
2. apply pending style switch if due
3. if cooldown reached zero and player is under boss: deal stomp, reset cooldown, emit stomp event, do not call `fireAttack()`
4. otherwise call `fireAttack()`

This fixes the current per-tick stomp bug and matches the wiki note that stomp does not count toward the four-attack cycle.

### 3. Projectiles Need an Optional Effect Channel

Prayer-disable is still a magic projectile, but it needs an on-hit effect:

```ts
export type ProjectileEffect = 'disable_prayers' | null;

export interface Projectile {
  // existing fields...
  effect?: ProjectileEffect;
}
```

Add constants in [GameSimulation.ts](/Users/caleb.mchenry/code/me/cg-sim/src/engine/GameSimulation.ts):

```ts
const BOSS_RANGED_PROJECTILE_COLOR = '#44cc44';
const BOSS_MAGIC_PROJECTILE_COLOR = '#cc3344';
const BOSS_PRAYER_DISABLE_PROJECTILE_COLOR = '#9b4dff';
```

Integration point:

- In `resolveProjectiles()`, when a boss projectile with `effect === 'disable_prayers'` arrives, call `this.prayerManager.deactivate()`.
- This intentionally disables both protection and offensive prayers, matching the live mechanic.

### 4. Tornadoes Should Be Scheduled, Not Spawned Inline

The current `spawnTornadoes()` both picks the wrong location and makes tornadoes exist too early in the tick. Replace it with a scheduled batch:

```ts
const TORNADO_SUMMON_DELAY_TICKS = 1; // verify in Phase 0
const CORRUPTED_TORNADO_COUNTS = { 1: 2, 2: 3, 3: 4 } as const;
const TORNADO_CORNER_TILES: readonly Position[] = [
  { x: 0, y: 0 },
  { x: 11, y: 0 },
  { x: 0, y: 11 },
  { x: 11, y: 11 },
];

private pendingTornadoSpawns: Array<{ spawnTick: number; positions: Position[] }> = [];
```

Helpers in [GameSimulation.ts](/Users/caleb.mchenry/code/me/cg-sim/src/engine/GameSimulation.ts):

```ts
private scheduleTornadoSpawn(): void
private activatePendingTornadoSpawns(): void
private getCorruptedTornadoCount(): 2 | 3 | 4
private selectTornadoCornerTiles(count: 2 | 3 | 4): Position[]
```

Rules:

- `selectTornadoCornerTiles()` must sample corners without replacement.
- Corrupted counts remain 2/3/4 for now, using the current phase helper unless Phase 0 proves the HP cutoffs differ.
- Newly activated tornadoes must not move or damage on their spawn tick.

Move lifetime constants into [Tornado.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/Tornado.ts):

```ts
export const TORNADO_LIFETIME_TICKS = 20;
```

and make `createTornado()` use that constant rather than an inline `20`.

### 5. Renderer Should Consume Explicit Boss Events

The current `Renderer3D.updateBossAnimations()` infers attacks by scanning projectiles and infers style switch by comparing `boss.currentStyle`. That is not enough for prayer-disable, stomp, or delayed style-switch cues.

Add explicit tick fields to [GameSimulation.ts](/Users/caleb.mchenry/code/me/cg-sim/src/engine/GameSimulation.ts):

```ts
lastBossAttackTick: number = -1;
lastBossAttackStyle: AttackStyle | null = null;
lastBossSpecialTick: number = -1;
lastBossSpecialType: 'tornado' | 'prayer_disable' | 'stomp' | null = null;
lastBossStyleSwitchTick: number = -1;
lastBossStyleSwitchStyle: AttackStyle | null = null;
```

Then update [AnimationController.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/AnimationController.ts):

```ts
playPrayerDisable(): void
```

and rewrite [Renderer3D.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/Renderer3D.ts) `updateBossAnimations(sim)` to use priority order:

1. death
2. style switch
3. prayer disable
4. tornado summon stomp
5. stomp attack
6. standard ranged/magic attack

This removes the current projectile-scan heuristic and guarantees the existing `stomp` and `prayer_disable` clips finally play on the correct ticks.

## Implementation

### Phase 0: Mechanics Lock

- [ ] Confirm `PRAYER_DISABLE_CHANCE_ON_MAGIC` from direct VOD review or a stronger primary source than the wiki text.
- [ ] Confirm whether `STYLE_SWITCH_DELAY_TICKS = 2` matches live timing from fourth counted attack to switch telegraph.
- [ ] Confirm whether `TORNADO_SUMMON_DELAY_TICKS = 1` is sufficient or whether the summon cue needs a 2-tick delay.
- [ ] Confirm whether tornado-count HP thresholds can safely reuse `FloorHazardManager.getPhase(boss.hp)` or need a dedicated threshold function.

### Phase 1: Boss Cycle Refactor

- [ ] Update [Boss.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/Boss.ts) to widen `BossAttackResult` to `AttackStyle | 'tornado' | 'prayer_disable'`.
- [ ] Add `pendingStyleSwitch` state plus `maybeApplyStyleSwitch(currentTick)`.
- [ ] Change `fireAttack()` signature to accept `currentTick` and `rngNext`.
- [ ] Remove the immediate `currentStyle = ...` flip from `fireAttack()`.
- [ ] Add unit tests in [Boss.test.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/__tests__/Boss.test.ts) for:
- counted prayer-disable attacks,
- delayed style switch,
- unchanged cycle on stomp skip,
- ranged as first style.

### Phase 2: Prayer-Disable Projectile and Prayer Drop

- [ ] Add `ProjectileEffect` in [Projectile.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/Projectile.ts).
- [ ] When `bossAttackResult === 'prayer_disable'`, create a magic projectile with:
- `style: 'magic'`
- `shape: 'orb'`
- `color: BOSS_PRAYER_DISABLE_PROJECTILE_COLOR`
- `effect: 'disable_prayers'`
- [ ] Use red for normal boss magic and reserve purple/magenta for prayer-disable.
- [ ] In `resolveProjectiles()`, call `this.prayerManager.deactivate()` when the prayer-disable projectile lands.
- [ ] Add tests in [projectile.test.ts](/Users/caleb.mchenry/code/me/cg-sim/src/__tests__/projectile.test.ts) covering projectile metadata and all-prayers-off on arrival.

### Phase 3: Tornado Corner Spawn and Delayed Activation

- [ ] Replace `spawnTornadoes()` with `scheduleTornadoSpawn()` plus `activatePendingTornadoSpawns()`.
- [ ] Select spawn corners without replacement from `TORNADO_CORNER_TILES`.
- [ ] Keep seeded determinism by using `this.rng` for all corner selection/shuffle operations.
- [ ] Activate scheduled batches before cleanup but after existing tornadoes have already moved for the tick, or explicitly skip `spawnTick === this.tick` in movement/damage loops.
- [ ] Move `20` to `TORNADO_LIFETIME_TICKS` in [Tornado.ts](/Users/caleb.mchenry/code/me/cg-sim/src/entities/Tornado.ts).
- [ ] Add tests in [floor-tornado.test.ts](/Users/caleb.mchenry/code/me/cg-sim/src/__tests__/floor-tornado.test.ts) for:
- corners only,
- no duplicate corners,
- delayed activation,
- no movement on spawn tick,
- 2/3/4 Corrupted counts.

### Phase 4: Boss Animation Dispatch

- [ ] Add `playPrayerDisable()` in [AnimationController.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/AnimationController.ts).
- [ ] Record `lastBossAttackTick`, `lastBossSpecialTick`, and `lastBossStyleSwitchTick` inside [GameSimulation.ts](/Users/caleb.mchenry/code/me/cg-sim/src/engine/GameSimulation.ts).
- [ ] Replace `Renderer3D.getBossAttackStyleThisTick()`-based dispatch with direct event-field dispatch in [Renderer3D.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/Renderer3D.ts).
- [ ] Trigger `playStomp()` on tornado summon.
- [ ] Trigger `playPrayerDisable()` on prayer-disable.
- [ ] Trigger `playStyleSwitch(style)` from `lastBossStyleSwitchStyle`, not from a same-frame `currentStyle` comparison.

### Phase 5: Stomp Accuracy Cleanup

- [ ] Move stomp resolution from the current every-tick occupancy check to the boss attack attempt branch.
- [ ] Reset `boss.attackCooldown` on stomp without incrementing `attackCounter`.
- [ ] Emit `lastBossSpecialType = 'stomp'` for render dispatch.
- [ ] Add at least one integration test showing a player under Hunllef takes a single stomp on attack cadence rather than continuous damage every tick.

### Phase 6: Verification

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `cd ../cg-sim-player && npm test`.
- [ ] Manual/visual verification in the 3D client:
- tornado summon uses stomp animation,
- prayer-disable uses purple projectile and `prayer_disable` animation,
- boss style-switch cue happens between attack sets instead of on the fourth attack tick,
- tornadoes appear in corners and stay still on the appearance tick.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/Boss.ts` | Modify | Add prayer-disable result, pending style-switch state, delayed `currentStyle` application |
| `src/engine/GameSimulation.ts` | Modify | Schedule tornado spawns, move stomp to attack cadence, create prayer-disable projectiles, expose boss animation event ticks |
| `src/entities/Projectile.ts` | Modify | Add `ProjectileEffect` so prayer-disable can disable prayers on arrival without inventing a fake attack style |
| `src/entities/Tornado.ts` | Modify | Replace inline lifetime magic number with exported constant used by creation and expiry checks |
| `src/render/AnimationController.ts` | Modify | Add `playPrayerDisable()` API and keep existing stomp/style-switch states reusable |
| `src/render/Renderer3D.ts` | Modify | Consume explicit boss event ticks and trigger stomp/prayer-disable/style-switch animations deterministically |
| `src/entities/__tests__/Boss.test.ts` | Modify | Cover delayed switch timing and prayer-disable cycle counting |
| `src/__tests__/projectile.test.ts` | Modify | Cover prayer-disable projectile metadata and all-prayer shutdown on hit |
| `src/__tests__/floor-tornado.test.ts` | Modify | Cover corner-only delayed tornado activation and Corrupted counts |
| `src/__tests__/integration.test.ts` | Modify | Cover stomp cadence and full-fight non-regression |

## Definition of Done

- [ ] Tornado summons spawn from distinct arena corners, not adjacent boss tiles.
- [ ] Corrupted Hunllef uses 2/3/4 tornadoes by phase, with deterministic corner selection.
- [ ] Tornadoes do not move or damage on their spawn tick.
- [ ] Prayer-disable exists as a magic-only counted attack.
- [ ] Prayer-disable projectile is visually distinct from normal magic.
- [ ] Prayer-disable landing disables all active prayers, not just the protection prayer.
- [ ] The boss plays stomp when summoning tornadoes.
- [ ] The boss plays the prayer-disable animation on prayer-disable attack ticks.
- [ ] The style-switch animation/telegraph happens after the fourth counted attack and before the next standard attack.
- [ ] Under-boss stomp is resolved on boss attack cadence and does not advance the four-attack cycle.
- [ ] Seeded runs remain deterministic.
- [ ] `npm run build`, `npm test`, and `../cg-sim-player` tests pass.

## Risks

- The wiki confirms that prayer-disable is chance-based, but not the exact proc rate. Hardcoding the wrong value would make the simulator feel subtly off even if the visuals are correct.
- Community sources consistently describe corner-based tornado spawns, but the exact spawn delay from stomp to visible tornado may need frame-by-frame confirmation.
- Delaying `currentStyle` instead of flipping it immediately will change several existing tests and any UI assumptions built around the old immediate-switch behavior.
- Moving stomp from every-tick occupancy to attack cadence is correct, but it is a behavioral change beyond the seed prompt and can expose hidden dependencies in tests.
- If renderer animation priority is wrong, style-switch and prayer-disable cues may still be swallowed by attack playback.

## Security

- No new dependencies.
- No new network calls at runtime.
- No deserialization or dynamic code execution changes.
- Keep boss animation dispatch strongly typed; do not introduce stringly-typed event parsing between simulation and renderer.
- Preserve seeded RNG ordering explicitly when changing tornado selection logic.

## Dependencies

- Existing `PrayerManager.deactivate()` behavior in [PrayerManager.ts](/Users/caleb.mchenry/code/me/cg-sim/src/combat/PrayerManager.ts), which already clears both protection and offensive prayers.
- Existing boss animation clips in [AnimationController.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/AnimationController.ts): `stomp`, `prayer_disable`, `style_switch_mage`, `style_switch_range`.
- Existing phase helper in `FloorHazardManager.getPhase(boss.hp)` if tornado-count thresholds continue to share those HP bands.
- Existing 3D runtime in [Renderer3D.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/Renderer3D.ts); `cg-sim-player` remains read-only.
- OSRS mechanic sources linked in Overview.

## Open Questions

1. What is the exact live proc chance for the prayer-disable magic attack? The wiki only says it has a chance.
2. Do Corrupted tornado-count thresholds exactly match the existing `1000-667 / 666-333 / 332-0` phase bands, or does Hunllef use separate 75%/50%/25%-style cutoffs for tornado scaling?
3. Is the correct summon delay one tick after the stomp animation, or two?
4. Should the legacy 2D [Renderer.ts](/Users/caleb.mchenry/code/me/cg-sim/src/render/Renderer.ts) be kept color-correct for prayer-disable as part of this sprint, or is 3D-only parity acceptable?
5. Should Sprint 021 also surface the 2023 multi-cycle audio cue, or keep this sprint strictly to mechanics plus existing animation assets?
