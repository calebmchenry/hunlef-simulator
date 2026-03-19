# Sprint 021 Draft: Corrupted Hunlef Mechanic Accuracy Pass

## Overview
This sprint addresses critical mechanical and visual inaccuracies in the Corrupted Hunlef boss fight compared to the actual Old School RuneScape (OSRS) encounter. Specifically, it corrects tornado spawn locations, adds the missing prayer-disabling magic attack, implements proper style-switch animation delays, and integrates the unused "stomp" and "prayer_disable" animations.

## Use Cases
1. **Tornado Positioning**: As a player, I expect tornadoes to spawn in the corners of the arena so I have time to react, rather than immediately adjacent to the boss.
2. **Prayer Disabling**: As a player, I expect the Hunlef to occasionally fire a distinct purple magic attack that forces my protection prayer to drop.
3. **Animation Accuracy**: As a player, I expect to see the Hunlef rear up and stomp when summoning tornadoes, and its style-switch animation to play slightly after its final attack in a cycle rather than instantly.

## Architecture
- **Entities (`Boss.ts`, `Tornado.ts`)**: `BossAttackResult` will be expanded to include `'prayer_disable'`. The `Boss` state machine will track when to fire the prayer-disable attack (e.g., the 2nd attack of a magic cycle). `Tornado` will track an `activeTick` so they wait before moving.
- **Engine (`GameSimulation.ts`)**: `spawnTornadoes` will target fixed arena corners instead of a radius around the boss. The projectile resolution step will clear the player's prayer if hit by a `'prayer_disable'` projectile.
- **Rendering (`Renderer3D.ts`, `AnimationController.ts`)**: `AnimationController` will expose `playPrayerDisable()`. `Renderer3D` will queue style switches with a 2-tick delay instead of playing them immediately on state change, and will detect tornado/prayer-disable events to trigger `stomp` and `prayer_disable` animations.

## Implementation Phases

### Phase 1: Entity & Attack Cycle Updates
- **`Boss.ts`**:
  - Update `BossAttackResult` type to `AttackStyle | 'tornado' | 'prayer_disable'`.
  - In `fireAttack()`, add deterministic logic to fire a `'prayer_disable'` attack. For example, during a `'magic'` cycle, if `attackCounter === 1` (the 2nd attack), return `'prayer_disable'` instead of `'magic'`.
- **`Tornado.ts`**:
  - Add an `activeTick` property (set to `spawnTick + 2`) to delay movement, simulating the "too soon" fix.

### Phase 2: Game Simulation Engine
- **`GameSimulation.ts`**:
  - **Tornado Spawn Locations**: Modify `spawnTornadoes()` to select from the 4 corners of the arena (e.g., `[minX, minY]`, `[maxX, minY]`, `[minX, maxY]`, `[maxX, maxY]`) instead of finding adjacent walkable tiles around the boss.
  - **Tornado Movement**: Update the tornado loop to `continue` if `this.tick < tornado.activeTick`.
  - **Prayer Disable Projectile**: In the boss attack resolution (lines ~332-391), if `bossAttackResult === 'prayer_disable'`, create a projectile with `color: '#6600cc'` (deep purple) and `shape: 'orb'`.
  - **Prayer Disable Hit**: In `resolveProjectiles()`, if the arriving projectile is `'prayer_disable'`, force `this.prayerManager.activePrayer = 'none'`. Add a console log or event for debugging.

### Phase 3: Animation & Render Triggers
- **`AnimationController.ts`**:
  - Add `playPrayerDisable(): void { this.crossFadeTo('prayer_disable'); }`.
- **`Renderer3D.ts`**:
  - **Style Switch Delay**: Instead of triggering `playStyleSwitch` immediately when `currentStyle !== lastBossStyle`, store `{ style: currentStyle, playTick: sim.tick + 2 }` in a new `pendingStyleSwitch` variable. In `updateBossAnimations()`, check if `sim.tick >= pendingStyleSwitch.playTick` to trigger it.
  - **Stomp Trigger**: Since `GameSimulation` creates tornadoes instantly, track `sim.tornadoes.length`. If it increases, trigger `this.animController.playStomp()`.
  - **Prayer Disable Trigger**: In `getBossAttackStyleThisTick()`, if a newly fired projectile is of type `'prayer_disable'`, trigger `this.animController.playPrayerDisable()`.

## Files Summary
- `src/entities/Boss.ts`: Modify `BossAttackResult` and `fireAttack()` logic.
- `src/entities/Tornado.ts`: Add `activeTick` delay property.
- `src/engine/GameSimulation.ts`: Rewrite `spawnTornadoes()` for corner logic, handle `'prayer_disable'` projectile creation and impact, enforce tornado movement delay.
- `src/render/AnimationController.ts`: Add `playPrayerDisable()` method.
- `src/render/Renderer3D.ts`: Implement 2-tick delay for style switch, add triggers for `stomp` and `prayer_disable` animations.

## Definition of Done
1. Tornadoes visually spawn in the 4 corners of the arena and delay movement by 2 ticks.
2. The boss plays a `stomp` animation when tornadoes are summoned.
3. The boss fires a distinct purple projectile during a magic cycle that forcibly deactivates the player's protection prayer upon hit.
4. The boss plays a `prayer_disable` animation when firing the aforementioned projectile.
5. The style-switch (magic/ranged) animation is delayed by exactly 2 ticks after the final attack of the previous phase.
6. All existing `cg-sim` tests and `cg-sim-player` tests pass.

## Risks
- **Test Breakage in `cg-sim-player`**: The player simulation might fail if its prayer is disabled and it doesn't know how to reactivate it. We must ensure the `prayer_disable` mechanic either doesn't break the existing deterministic test cases or that the player bot has a fallback (the prompt says `cg-sim-player` is read-only, so the attack pattern change must be strictly isolated or only affect later ticks beyond the tests' scope).
- **Animation Glitches**: Interrupting states (like a stomp immediately followed by a style switch) might cause animation jumping if crossfades aren't smooth.

## Security
- No security implications. Purely client-side logic and rendering.

## Dependencies
- No new libraries or dependencies required.

## Open Questions
- **Exact Prayer-Disable Rotation**: The draft assigns it to the 2nd attack of a magic cycle for determinism, but if OSRS has a strictly different pattern (e.g., only in Phase 3 or after a specific time), it may need adjustment.
- **Arena Bounds**: The exact coordinate bounds of the arena need to be identified in `GameSimulation.ts` to correctly map the 4 corners.
- **cg-sim-player Tests**: If `cg-sim-player` relies on perfect prediction of incoming damage, will the new prayer-disable mechanic cause the tests to fail? We may need to ensure the prayer-disable projectile is recognized by the player bot's prediction logic if possible.