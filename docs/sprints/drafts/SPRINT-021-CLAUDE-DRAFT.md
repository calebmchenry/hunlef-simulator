# Sprint 021: Corrupted Hunlef Mechanic Accuracy Pass

## Overview

The simulator's boss combat loop is missing several key Corrupted Hunlef mechanics that exist in OSRS. This sprint adds the prayer-disable special attack, moves tornado spawns to arena corners, triggers the existing stomp animation on tornado summons, and adds a 2-tick style-switch animation delay. Each change is small in isolation but together they bring the fight significantly closer to OSRS accuracy.

All changes extend existing patterns — the `stomp` and `prayer_disable` animation states already exist in `AnimationController` but are never triggered, and the tornado/projectile infrastructure is already in place.

## Use Cases

1. **Prayer-disable attack**: During magic phases, one of the 4 attacks is randomly replaced by a prayer-disable projectile (deep purple, visually distinct from normal magic). On hit, it clears the player's active protection prayer.
2. **Corner tornado spawns**: Tornadoes spawn in the four corners of the 12x12 arena instead of adjacent to the boss footprint, matching OSRS behavior.
3. **Stomp animation on tornado summon**: The boss plays the `stomp` animation (seq 8432) when summoning tornadoes, with a 1-tick visual delay before tornadoes actually appear.
4. **Style-switch animation delay**: After the 4th attack of a cycle, the style-switch animation plays 2 ticks before the first attack of the new style, serving as a visual warning cue.
5. No regression in idle/attack/death/style-switch animations.
6. `cg-sim-player` tests remain passing.

## Architecture

### Boss Attack Rotation (OSRS-accurate)

The Hunlef does 4 attacks per style, then switches. The rotation is:

```
[Ranged Phase: 4 attacks]  →  style-switch anim  →  [Magic Phase: 4 attacks]  →  style-switch anim  →  ...
```

Within each phase:
- **Tornado summon** replaces one of the 4 attacks (on odd cycles, attack index 0 — current behavior, kept as-is).
- **Prayer-disable** replaces one of the 4 attacks during magic phases only. The specific slot is chosen randomly via `rng.nextInt(0, 3)` when a new magic phase begins. If the tornado already occupies that slot (on odd cycles where attack 0 is tornado), the prayer-disable shifts to the next available slot.

### Prayer-Disable Mechanics

- Fires only during magic phases (OSRS: prayer-disable is magic-based).
- Counts as one of the 4 attacks in the rotation (does not add extra attacks).
- On hit, calls `prayerManager.deactivate()` to clear all active prayers.
- Damage is rolled the same as a normal magic attack (same max hit, same prayer reduction if protected).
- Projectile color: `#6622aa` (deep purple) vs normal magic `#aa44cc`. Shape: `orb`.
- The `prayer_disable` animation (seq 8433) plays instead of `attack_magic`.

### Tornado Corner Spawning

Current behavior spawns tornadoes within 2 tiles of the boss footprint. New behavior:

```
ARENA_CORNERS = [
  { x: 0,  y: 0  },   // SW
  { x: 11, y: 0  },   // SE
  { x: 0,  y: 11 },   // NW
  { x: 11, y: 11 },   // NE
]
```

Tornadoes are distributed across corners. With `count` tornadoes:
- Each tornado is assigned to `ARENA_CORNERS[i % 4]` as its base position.
- A random offset of 0-1 tiles in each axis (using `rng`) adds slight variation while keeping them clearly in corners.
- This replaces the current "near boss" candidate search entirely.

### Tornado Spawn Delay

Currently tornadoes appear instantly when `fireAttack()` returns `'tornado'`. New behavior:
- The boss plays the `stomp` animation on the tornado-summon tick.
- Tornadoes actually spawn 1 tick later via a `pendingTornadoSpawnTick` field on `GameSimulation`.
- This gives the player a 1-tick visual warning (stomp plays) before tornadoes appear and start chasing.

### Style-Switch Delay

Current behavior: style switch happens immediately after the 4th attack (on the same `fireAttack()` call that increments `cycleCount`). The renderer detects the style change on the next draw and plays the switch animation.

New behavior:
- `Boss.fireAttack()` gains a `styleSwitchPending` flag. When the 4th attack fires, instead of immediately switching `currentStyle`, the boss sets `styleSwitchPending = true` and `styleSwitchCountdown = 2`.
- Each tick, if `styleSwitchPending`, decrement `styleSwitchCountdown`. When it hits 0, apply the actual style switch.
- During the 2-tick delay, `attackCooldown` is paused (boss does not fire). This matches OSRS where the switch animation plays between attack sets.
- The renderer triggers `playStyleSwitch()` when `styleSwitchPending` becomes true (not when the style actually changes).

## Implementation

### Phase 1: Prayer-Disable Attack (~35% effort)

#### 1a. Boss rotation state — `src/entities/Boss.ts`

- [ ] Add field `prayerDisableSlot: number = -1` — which attack index (0-3) in the current magic phase fires the prayer-disable. Set to `-1` when not in a magic phase.
- [ ] Add method `initMagicPhase(rng: () => number): void`:
  ```ts
  initMagicPhase(rng: () => number): void {
    // Pick random slot 0-3 for prayer-disable during this magic phase
    this.prayerDisableSlot = Math.floor(rng() * 4);
    // If tornado occupies slot 0 on odd cycles, shift to next slot
    if (this.cycleCount % 2 === 1 && this.prayerDisableSlot === 0) {
      this.prayerDisableSlot = 1;
    }
  }
  ```
- [ ] Modify `fireAttack()` return type to include `'prayer_disable'`:
  ```ts
  export type BossAttackResult = AttackStyle | 'tornado' | 'prayer_disable';
  ```
- [ ] In `fireAttack()`, after the tornado check, before returning `style`:
  ```ts
  if (this.currentStyle === 'magic' && this.attackCounter === this.prayerDisableSlot && !isTornado) {
    // ... advance counter as normal ...
    return 'prayer_disable';
  }
  ```
  Note: `attackCounter` is checked *before* incrementing. The counter advancement and style-switch logic remain unchanged.

#### 1b. GameSimulation prayer-disable resolution — `src/engine/GameSimulation.ts`

- [ ] Handle `bossAttackResult === 'prayer_disable'` alongside normal magic attacks in the boss attack section (~line 354):
  ```ts
  const isPrayerDisable = bossAttackResult === 'prayer_disable';
  const bossAttackStyle: AttackStyle | null =
    (bossAttackedThisTick && bossAttackResult !== null && bossAttackResult !== 'tornado')
      ? (isPrayerDisable ? 'magic' : bossAttackResult as AttackStyle)
      : null;
  ```
- [ ] When creating the boss projectile, set distinct color/shape for prayer-disable:
  ```ts
  color: isPrayerDisable ? '#6622aa' : (bossAttackStyle === 'ranged' ? '#44cc44' : '#aa44cc'),
  ```
- [ ] Add a `disablesPrayer` flag to the `Projectile` interface:
  ```ts
  disablesPrayer?: boolean;
  ```
- [ ] Set `disablesPrayer: isPrayerDisable` on the projectile.
- [ ] In `resolveProjectiles()`, when a boss projectile with `disablesPrayer` arrives:
  ```ts
  if (proj.disablesPrayer) {
    this.prayerManager.deactivate();
  }
  ```
- [ ] Track `lastBossAttackStyle` for prayer-disable as magic:
  ```ts
  if (bossAttackResult !== 'tornado') {
    this.lastBossAttackStyle = isPrayerDisable ? 'magic' : bossAttackResult as AttackStyle;
  }
  ```
- [ ] Call `boss.initMagicPhase(() => this.rng.next())` when the boss switches to magic. This can be detected in the tick where `bossAttackedThisTick` is true and the style just changed to magic (i.e., `boss.currentStyle === 'magic'` and `boss.attackCounter === 0` and `boss.cycleCount` just incremented). Alternatively, call it inside `Boss.fireAttack()` when the style switches to magic.

#### 1c. Animation trigger — `src/render/Renderer3D.ts`

- [ ] Extend `getBossAttackStyleThisTick()` to also detect prayer-disable projectiles (they have `disablesPrayer: true`). When detected, return a special value so `updateBossAnimations()` can call `animController.playPrayerDisable()` instead of `playAttack('magic')`.
- [ ] Add `playPrayerDisable()` to `AnimationController`:
  ```ts
  playPrayerDisable(): void {
    if (this.currentState === 'death') return;
    this.crossFadeTo('prayer_disable');
  }
  ```

### Phase 2: Corner Tornado Spawns (~20% effort)

**File:** `src/engine/GameSimulation.ts`

- [ ] Define corner positions as a constant:
  ```ts
  const ARENA_CORNERS: Position[] = [
    { x: 0,  y: 0  },
    { x: 11, y: 0  },
    { x: 0,  y: 11 },
    { x: 11, y: 11 },
  ];
  ```
- [ ] Rewrite `spawnTornadoes()`:
  ```ts
  private spawnTornadoes(): void {
    const phase = this.floorHazardManager.getPhase(this.boss.hp);
    let count: number;
    switch (phase) {
      case 1: count = 2; break;
      case 2: count = 3; break;
      case 3: count = 4; break;
      default: count = 2;
    }

    for (let i = 0; i < count; i++) {
      const corner = ARENA_CORNERS[i % 4];
      // Add 0-1 tile random offset to avoid perfect stacking
      const offsetX = this.rng.nextInt(0, 1);
      const offsetY = this.rng.nextInt(0, 1);
      const x = Math.min(11, corner.x + offsetX);
      const y = Math.min(11, corner.y + offsetY);
      this.tornadoes.push(createTornado({ x, y }, this.tick));
    }
  }
  ```
- [ ] The `rng` call count changes here (was `nextInt(0, candidates.length-1)` per tornado, now `nextInt(0,1)` twice per tornado). This will shift all downstream RNG. This is acceptable — the tornado spawn mechanic was wrong, so all seeds that relied on it were producing incorrect results anyway.

### Phase 3: Stomp Animation + Tornado Spawn Delay (~20% effort)

#### 3a. Delayed tornado spawn — `src/engine/GameSimulation.ts`

- [ ] Add field `pendingTornadoSpawnTick: number = -1`.
- [ ] In the tornado spawn section (~line 345), instead of calling `spawnTornadoes()` directly:
  ```ts
  if (bossAttackedThisTick && bossAttackResult === 'tornado') {
    this.pendingTornadoSpawnTick = this.tick + 1;
  }
  ```
- [ ] At the start of the running-state section (before boss attack resolution), check for pending tornado spawn:
  ```ts
  if (this.pendingTornadoSpawnTick === this.tick) {
    this.spawnTornadoes();
    this.pendingTornadoSpawnTick = -1;
  }
  ```

#### 3b. Stomp animation trigger — `src/render/Renderer3D.ts`

- [ ] Add tracking field `private lastBossTornadoSummonTick: number = -1`.
- [ ] In `updateBossAnimations()`, detect tornado summon. Since the tornado attack doesn't create a projectile, detect it by checking if `sim.pendingTornadoSpawnTick === sim.tick + 1` (meaning the boss just initiated a tornado summon this tick) OR expose a `bossStompedThisTick` boolean on GameSimulation.
- [ ] Simpler approach: add a public `lastTornadoSummonTick: number = -1` field on `GameSimulation`, set when the tornado attack fires. The renderer checks this:
  ```ts
  if (sim.lastTornadoSummonTick === sim.tick && sim.tick !== this.lastBossTornadoSummonTick) {
    this.lastBossTornadoSummonTick = sim.tick;
    this.animController.playStomp();
  }
  ```

### Phase 4: Style-Switch 2-Tick Delay (~25% effort)

#### 4a. Boss state machine — `src/entities/Boss.ts`

- [ ] Add fields:
  ```ts
  styleSwitchPending: boolean = false;
  styleSwitchCountdown: number = 0;
  ```
- [ ] Modify `fireAttack()`: when `attackCounter >= 4`, instead of immediately switching style:
  ```ts
  if (this.attackCounter >= 4) {
    this.attackCounter = 0;
    this.cycleCount++;
    this.styleSwitchPending = true;
    this.styleSwitchCountdown = 2;
    // Don't switch currentStyle yet
  }
  ```
- [ ] Add method `tickStyleSwitch(): boolean` called each tick from `GameSimulation`:
  ```ts
  tickStyleSwitch(): boolean {
    if (!this.styleSwitchPending) return false;
    this.styleSwitchCountdown--;
    if (this.styleSwitchCountdown <= 0) {
      this.styleSwitchPending = false;
      this.currentStyle = this.currentStyle === 'ranged' ? 'magic' : 'ranged';
      return true; // style just switched
    }
    return false;
  }
  ```
- [ ] While `styleSwitchPending`, `attackCooldown` should not tick down. This is handled in `GameSimulation`.
- [ ] Update `reset()` to clear `styleSwitchPending = false; styleSwitchCountdown = 0;`.

#### 4b. GameSimulation integration — `src/engine/GameSimulation.ts`

- [ ] Before `boss.attackCooldown--`, check for pending style switch:
  ```ts
  const justSwitched = this.boss.tickStyleSwitch();
  if (justSwitched && this.boss.currentStyle === 'magic') {
    this.boss.initMagicPhase(() => this.rng.next());
  }
  ```
- [ ] Guard `attackCooldown--` with `!boss.styleSwitchPending`:
  ```ts
  if (!this.boss.styleSwitchPending) {
    this.boss.attackCooldown--;
  }
  ```

#### 4c. Renderer style-switch trigger — `src/render/Renderer3D.ts`

- [ ] Change style-switch detection in `updateBossAnimations()` to trigger from `boss.styleSwitchPending` instead of detecting the actual style change:
  ```ts
  if (sim.boss.styleSwitchPending && sim.boss.styleSwitchCountdown === 2) {
    // Just started pending — play the animation
    const nextStyle = sim.boss.currentStyle === 'ranged' ? 'magic' : 'ranged';
    this.animController.playStyleSwitch(nextStyle);
  }
  ```
- [ ] Remove the old `lastBossStyle`-based detection since it would now fire 2 ticks too late.

## Files Summary

| File | Changes |
|------|---------|
| `src/entities/Boss.ts` | Add `prayerDisableSlot`, `styleSwitchPending`, `styleSwitchCountdown` fields. Add `initMagicPhase()`, `tickStyleSwitch()` methods. Modify `fireAttack()` to return `'prayer_disable'` and defer style switch. Update `reset()`. |
| `src/engine/GameSimulation.ts` | Handle `'prayer_disable'` attack result. Rewrite `spawnTornadoes()` for corner spawns. Add `pendingTornadoSpawnTick` and `lastTornadoSummonTick` fields. Add 1-tick tornado spawn delay. Guard attack cooldown during style-switch pending. Call `tickStyleSwitch()` and `initMagicPhase()`. |
| `src/entities/Projectile.ts` | Add optional `disablesPrayer?: boolean` field to `Projectile` interface. |
| `src/render/AnimationController.ts` | Add `playPrayerDisable()` method. |
| `src/render/Renderer3D.ts` | Trigger stomp animation on tornado summon. Trigger prayer-disable animation. Change style-switch detection to use `styleSwitchPending`. Add `lastBossTornadoSummonTick` tracking field. |
| `src/entities/types.ts` | No changes needed (types already sufficient). |

## Definition of Done

- [ ] **Prayer-disable fires during magic phase**: Boss returns `'prayer_disable'` for exactly one attack per magic phase, chosen randomly.
- [ ] **Prayer-disable clears prayers on hit**: When the prayer-disable projectile arrives, `prayerManager.activePrayer` and `offensivePrayer` are set to null.
- [ ] **Prayer-disable projectile is visually distinct**: Color `#6622aa` (deep purple), orb shape, uses `prayer_disable` animation (seq 8433).
- [ ] **Tornadoes spawn in arena corners**: No tornado spawns within 3 tiles of boss center. Each tornado is within 1 tile of an arena corner.
- [ ] **Tornado count scales with HP phase**: 2/3/4 tornadoes for phases 1/2/3.
- [ ] **Stomp animation plays on tornado summon**: `animController.playStomp()` is called on the tick `fireAttack()` returns `'tornado'`.
- [ ] **Tornadoes appear 1 tick after stomp**: `pendingTornadoSpawnTick` delays actual creation by 1 tick.
- [ ] **Style-switch has 2-tick delay**: After 4th attack, 2 ticks pass before style changes and boss can attack again.
- [ ] **Style-switch animation fires on delay start**: `playStyleSwitch()` is called when `styleSwitchPending` becomes true, 2 ticks before the new style.
- [ ] **Unit test: prayer-disable mechanic**: Test that prayer-disable fires once per magic phase, and that prayers are cleared on projectile arrival.
- [ ] **Unit test: corner tornado spawns**: Test that all spawned tornadoes have positions in arena corners (within 1 tile of `{0,0}`, `{11,0}`, `{0,11}`, `{11,11}`).
- [ ] **Unit test: style-switch delay**: Test that boss does not attack for 2 ticks after the 4th attack, and that style changes after the delay.
- [ ] **`npm run build` passes** with no type errors.
- [ ] **`npm test` passes** (all existing + new tests).
- [ ] **`cd ../cg-sim-player && npm test` passes** (read-only validation).
- [ ] **No regression in idle/attack/death animations** (visual spot-check via Playwright screenshots).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RNG sequence shift breaks cg-sim-player | Medium | High | Run `cd ../cg-sim-player && npm test` early in Phase 2. The tornado spawn rewrite changes RNG call order — if cg-sim-player seeds are sensitive to this, we may need to coordinate. |
| Style-switch delay changes fight pacing | Low | Medium | The 2-tick delay effectively slows boss DPS by ~5%. This matches OSRS behavior, so it's correct. Verify cg-sim-player doesn't assert exact tick-of-death. |
| Prayer-disable slot colliding with tornado slot | Low | Low | Explicit handling in `initMagicPhase()` shifts the slot when conflict detected. |
| `stomp` / `prayer_disable` GLTF animations missing or broken | Low | Medium | These animations are already mapped in `AnimationController` with fallback to idle if the clip is missing. Verify via Playwright screenshot. |

## Security

No user input changes. All new randomness goes through the existing deterministic `Rng`. No network calls, no new dependencies, no DOM injection.

## Dependencies

- No new npm packages.
- Existing GLTF assets already contain `stomp` (seq 8432) and `prayer_disable` (seq 8433) animation clips.
- `cg-sim-player` is read-only — must not be modified.

## Open Questions

1. **Prayer-disable rotation position**: This draft uses "one random slot per magic phase." An alternative is the OSRS wiki's description of "chance on any magic attack." The random-slot approach is more deterministic and easier to test. If playtesting reveals it feels wrong, we can switch to a per-attack probability check.
2. **Tornado offset range**: Using 0-1 tile offset from corners. If this makes tornadoes feel too clustered, we could expand to 0-2. The tight range better matches OSRS where tornadoes clearly start in corners.
3. **Style-switch attack cooldown**: This draft pauses `attackCooldown` during the 2-tick delay (boss cannot attack). An alternative is to let the cooldown continue ticking but enforce a minimum 2-tick gap. The paused approach is simpler and matches the OSRS visual cadence.
4. **Prayer-disable during protected phase**: In OSRS, even if you're praying magic, the prayer-disable still removes your prayer. This draft treats it as a normal magic attack for damage reduction (correct prayer = reduced damage) but still clears prayers on hit regardless. Need to verify this matches OSRS — it's possible the disable applies even on a 0-damage hit.
5. **Attack animation research**: The intent doc notes the attack animation might be wrong. This sprint does not change the base attack animations (seq 8430/8431) — that would require comparing frame-by-frame with OSRS footage and is better suited for a dedicated visual sprint.
