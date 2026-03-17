# Sprint 008: Floor Tile Hazards + Tornado Special Attacks

## Overview

Add the two remaining Corrupted Hunlef special mechanics: floor tile hazards (persistent environmental damage) and tornado summons (attack-rotation special). No new entity classes or files beyond what is strictly required. Tile states live as a flat array on `Arena`. Tornadoes live as a plain-object array on `GameSimulation`. Rendering hooks are added but the 3D visuals are kept simple (color changes on floor tiles, reuse existing tornado GLTF).

**What ships:** Floor tiles that cycle safe/warning/hazard and deal damage, tornadoes that spawn from the boss attack rotation and chase the player, HP-phase scaling for both systems, 3D renderer updates, full test coverage for new mechanics.

**What's deferred:** Elaborate tile activation patterns, tornado pathfinding around boss, tornado GLTF animation, particle effects, safe-tile visual indicators.

---

## Use Cases

1. **UC-1: Floor tile cycling** -- Arena tiles transition safe -> warning -> hazard on a timer. Standing on a hazard tile deals 10-20 damage per tick.
2. **UC-2: HP-phase tile speed** -- Tile warning duration scales with boss HP: ~5 ticks (phase 1), ~3 ticks (phase 2), ~1-2 ticks (phase 3).
3. **UC-3: Phase 3 safe tiles** -- In phase 3 (HP 1-332), specific tiles never become hazards.
4. **UC-4: Tornado summon** -- Boss uses one of its 4 attack slots to summon tornadoes instead of firing a projectile.
5. **UC-5: Tornado chase** -- Tornadoes move 1 tile/tick toward the player. Player at 2 tiles/tick can outrun them.
6. **UC-6: Tornado damage** -- Overlapping a tornado deals per-tick damage scaled by armor tier (None: 15-30, T1: 15-25, T2: 10-20, T3: 7-15).
7. **UC-7: Tornado lifecycle** -- Tornadoes last 20 ticks then despawn. Count scales with HP phase (2/3/4).
8. **UC-8: 3D rendering** -- Floor tiles show warning/hazard colors. Tornado GLTF meshes appear in the scene and track position.
9. **UC-9: Existing tests pass** -- All 155 tests still pass.

---

## Architecture

### Tile States -- Array on Arena

Add a flat `TileState` array to `Arena`. Each tile is one of three states. The array is `width * height` long, indexed by `y * width + x`.

```typescript
// src/world/Arena.ts
export type TileState = 'safe' | 'warning' | 'hazard';

export class Arena {
  // ... existing fields ...
  tileStates: TileState[];          // length = width * height, default all 'safe'
  tileTimers: number[];             // ticks remaining in current state before transition
  readonly safeTiles: Set<number>;  // indices that never become hazards (phase 3)

  getTileState(x: number, y: number): TileState;
  setTileState(x: number, y: number, state: TileState, timer: number): void;
  /** Advance all tile timers by one tick. Returns list of tiles that changed state. */
  tickTiles(warningDuration: number, hazardDuration: number, rng: () => number): void;
  resetTiles(): void;
}
```

No new file. Everything on the existing `Arena` class.

### Tornadoes -- Plain Objects on GameSimulation

Tornadoes are simple position + lifetime objects stored in an array on `GameSimulation`. No `Tornado` class, no new file.

```typescript
// src/entities/types.ts  (add)
export interface Tornado {
  pos: Position;
  spawnTick: number;
  lifetime: number;  // ticks remaining
}
```

```typescript
// src/engine/GameSimulation.ts  (add field)
tornadoes: Tornado[] = [];
```

### Boss Attack Rotation -- Tornado Summon

`Boss.fireAttack()` returns `AttackStyle | 'tornado'`. Extend `AttackStyle` to include `'tornado'` or return a union. The simulation checks the return value: if `'tornado'`, spawn tornadoes instead of creating a projectile.

Simplest approach: add `'tornado'` to the `AttackStyle` type and have the boss decide based on a flag or RNG.

```typescript
// src/entities/types.ts  (modify)
export type AttackStyle = 'ranged' | 'magic' | 'tornado';
```

`Boss.fireAttack()` occasionally returns `'tornado'` -- once per full 4-attack rotation. The tornado summon replaces one of the 4 attacks. Implementation: the boss fires a tornado on the 4th attack of every other rotation (deterministic via counter), or we let the simulation inject it. Simplest: add a `shouldSummonTornado` flag that the simulation sets before calling `fireAttack()`, and the boss returns `'tornado'` for that attack.

Actually, even simpler: the simulation decides. When `boss.fireAttack()` returns the style, the simulation checks a counter and overrides with tornado summon logic. The boss class itself doesn't need to know about tornadoes. This avoids modifying `Boss.fireAttack()` at all -- the simulation intercepts the attack slot.

```typescript
// In processTick(), after boss fires:
if (bossAttackedThisTick && this.shouldSummonTornado()) {
  this.spawnTornadoes();
  // skip projectile creation
} else if (bossAttackedThisTick && bossAttackStyle !== null) {
  // existing projectile logic
}
```

### HP Phase Helper

Both systems need the current HP phase. Add a small helper:

```typescript
function bossPhase(hp: number): 1 | 2 | 3 {
  if (hp >= 667) return 1;
  if (hp >= 333) return 2;
  return 3;
}
```

Inline in `GameSimulation.ts` -- no new file.

### Damage Constants

```typescript
// src/equipment/items.ts  (add)
export const TORNADO_MAX_HIT: Record<Tier, number> = {
  0: 30,
  1: 25,
  2: 20,
  3: 15,
};
export const TORNADO_MIN_HIT: Record<Tier, number> = {
  0: 15,
  1: 15,
  2: 10,
  3: 7,
};
export const FLOOR_HAZARD_MIN_HIT = 10;
export const FLOOR_HAZARD_MAX_HIT = 20;
```

### Tick Processing Order

Updated `processTick()` step order:

1. Process queued inputs
2. Drain prayer
3. Player movement
4. (countdown bail)
5. Resolve arriving projectiles
6. **Update floor tiles** (advance timers, transition states)
7. **Floor hazard damage** (if player on hazard tile)
8. Boss AI: fire attack OR summon tornadoes
9. **Move tornadoes** (1 tile/tick toward player)
10. **Tornado damage** (if player overlaps any tornado)
11. **Despawn expired tornadoes**
12. Player attack resolution
13. Stomp check
14. Death checks
15. Cleanup projectiles + hit splats

Floor tiles update before boss attack so the boss phase at the time of the tick drives tile speed. Tornadoes move after boss attack so newly spawned tornadoes don't move on their spawn tick (consistent with OSRS).

---

## Implementation

### Phase 1: Types + Constants (~10% effort)

**Files:**
- `src/entities/types.ts` -- Modify
- `src/equipment/items.ts` -- Modify

**Tasks:**
- [ ] Add `Tornado` interface to `types.ts`: `{ pos: Position; spawnTick: number; lifetime: number }`
- [ ] Add `TileState` type to `types.ts` (or `Arena.ts`): `'safe' | 'warning' | 'hazard'`
- [ ] Add tornado damage constants to `items.ts`: `TORNADO_MAX_HIT`, `TORNADO_MIN_HIT` (both `Record<Tier, number>`)
- [ ] Add floor hazard damage constants to `items.ts`: `FLOOR_HAZARD_MIN_HIT = 10`, `FLOOR_HAZARD_MAX_HIT = 20`
- [ ] Add tornado count-by-phase constant: `TORNADO_COUNT: Record<1|2|3, number> = { 1: 2, 2: 3, 3: 4 }`
- [ ] Add warning-duration-by-phase constant: `TILE_WARNING_TICKS: Record<1|2|3, number> = { 1: 5, 2: 3, 3: 2 }`

### Phase 2: Arena Tile State System (~20% effort)

**Files:**
- `src/world/Arena.ts` -- Modify
- `src/__tests__/arena-tiles.test.ts` -- Create

**Tasks:**
- [ ] Add `tileStates: TileState[]` array (initialized to all `'safe'`, length `width * height`)
- [ ] Add `tileTimers: number[]` array (initialized to 0)
- [ ] Add `safeTileIndices: Set<number>` -- hardcoded set of tile indices that stay safe in phase 3 (pick 4-6 tiles in the arena corners/center)
- [ ] `getTileState(x, y): TileState` -- bounds-checked lookup
- [ ] `setTileState(x, y, state, timer): void` -- set state and timer for a tile
- [ ] `tickTiles(warningDuration: number, hazardDuration: number, rng: () => number, phase: number): void`:
  - Decrement all timers
  - `safe` tiles: when timer hits 0, randomly decide whether to start warning (RNG-based, ~20% chance per tick per safe tile so they activate in staggered groups). Set state to `'warning'`, timer to `warningDuration`
  - `warning` tiles: when timer hits 0, transition to `'hazard'`, timer to `hazardDuration` (e.g. 3 ticks)
  - `hazard` tiles: when timer hits 0, transition back to `'safe'`, timer to random cooldown (5-10 ticks)
  - In phase 3, skip tiles in `safeTileIndices`
  - Do not activate tiles under the boss footprint (they're unreachable anyway, keeps it clean)
- [ ] `resetTiles(): void` -- set all to safe, zero timers
- [ ] Tests: tile transitions safe->warning->hazard->safe, phase 3 safe tiles never activate, timer decrements correctly

### Phase 3: Tornado Spawning + Movement (~25% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify
- `src/__tests__/tornado.test.ts` -- Create

**Tasks:**
- [ ] Add `tornadoes: Tornado[]` field on `GameSimulation`
- [ ] Add `tornadoRotationCounter: number` field -- tracks how many attacks since last tornado summon. Tornado fires every 8th attack (once per 2 rotations) or a simpler rule: first attack of every other rotation
- [ ] Add `bossPhase(hp: number): 1|2|3` helper function (private or module-level)
- [ ] Add `shouldSummonTornado(): boolean` -- returns true when the rotation counter says it's tornado time
- [ ] Add `spawnTornadoes(): void`:
  - Get tornado count from phase
  - Spawn tornadoes at positions near boss center (offset by 1-2 tiles in random directions via seeded RNG)
  - Each tornado: `{ pos, spawnTick: this.tick, lifetime: 20 }`
  - Push to `this.tornadoes`
- [ ] Add `moveTornadoes(): void`:
  - For each tornado, move 1 tile toward `player.pos` using simple Chebyshev step (dx = sign(player.x - tornado.x), dy = sign(player.y - tornado.y)). No BFS pathfinding -- just direct step. Clamp to arena bounds.
  - Decrement lifetime
- [ ] Add `processTornadoDamage(): void`:
  - For each tornado overlapping player position, roll `rng.nextInt(minHit, maxHit)` based on armor tier
  - Apply damage to player, create hit splat
  - Only damage once per tornado per tick (not once per overlapping tornado -- actually, each tornado damages independently)
- [ ] Add `despawnTornadoes(): void`:
  - Filter out tornadoes with `lifetime <= 0`
- [ ] Modify `processTick()`:
  - After boss attack decision, check `shouldSummonTornado()` -- if yes, call `spawnTornadoes()` and skip projectile creation
  - After player movement section (but after boss attack), call `moveTornadoes()`, `processTornadoDamage()`, `despawnTornadoes()`
- [ ] Tests: tornado count by phase, tornado moves 1 tile/tick toward player, tornado despawns after 20 ticks, tornado damage by armor tier, tornado summon replaces one attack in rotation

### Phase 4: Floor Hazard Damage Integration (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify
- `src/__tests__/floor-hazard.test.ts` -- Create

**Tasks:**
- [ ] Add `processFloorTiles(): void`:
  - Compute warning duration from `bossPhase(this.boss.hp)` using `TILE_WARNING_TICKS`
  - Call `this.arena.tickTiles(warningDuration, hazardDuration, () => this.rng.next(), phase)`
- [ ] Add `processFloorHazardDamage(): void`:
  - Check `this.arena.getTileState(player.pos.x, player.pos.y)`
  - If `'hazard'`, roll `rng.nextInt(FLOOR_HAZARD_MIN_HIT, FLOOR_HAZARD_MAX_HIT)`
  - Apply damage to player, create hit splat
- [ ] Wire into `processTick()`: call `processFloorTiles()` and `processFloorHazardDamage()` at the correct step (after player movement, before boss attack)
- [ ] Floor tiles are active throughout the fight (not tied to attack rotation)
- [ ] Tests: player takes damage on hazard tile, player takes no damage on safe/warning tile, tile speed matches HP phase, damage values within expected range

### Phase 5: 3D Rendering (~20% effort)

**Files:**
- `src/render/Renderer3D.ts` -- Modify

**Tasks:**
- [ ] Floor tile visuals: change tile material color based on `arena.getTileState(x, y)`:
  - `safe` = default dark floor color
  - `warning` = orange/yellow tint
  - `hazard` = bright red/lava
- [ ] Tornado rendering:
  - Load tornado GLTF (`public/models/tornado.gltf`) at init
  - Maintain a pool of tornado meshes synced to `sim.tornadoes`
  - Position each mesh at tornado world coords
  - Add/remove meshes as tornadoes spawn/despawn
  - Simple Y-axis spin animation (programmatic rotation, no animation clip needed)
- [ ] Floor hazard damage hit splats: reuse existing hit splat sprite system

### Phase 6: Reset + Polish (~10% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify
- `src/world/Arena.ts` -- Modify

**Tasks:**
- [ ] On game reset: clear `tornadoes` array, call `arena.resetTiles()`, reset tornado rotation counter
- [ ] Verify all 155 existing tests still pass
- [ ] Verify `npm run build` passes
- [ ] Verify floor tiles don't activate during countdown
- [ ] Verify tornadoes don't spawn during countdown

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/types.ts` | Modify | Add `Tornado` interface, `TileState` type |
| `src/equipment/items.ts` | Modify | Add tornado + floor hazard damage constants |
| `src/world/Arena.ts` | Modify | Add tile state array, timers, tick logic |
| `src/engine/GameSimulation.ts` | Modify | Tornado array, spawn/move/damage/despawn, floor tile processing, tick order changes |
| `src/render/Renderer3D.ts` | Modify | Floor tile colors, tornado mesh pool |
| `src/__tests__/arena-tiles.test.ts` | Create | Tile state transition tests |
| `src/__tests__/tornado.test.ts` | Create | Tornado spawn, move, damage, despawn tests |
| `src/__tests__/floor-hazard.test.ts` | Create | Floor hazard damage integration tests |

Five files modified, three test files created. Zero new source files beyond tests. No new dependencies.

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` -- all existing 155 tests still pass
- [ ] New tests cover: tile state transitions, tile damage, tornado spawn counts, tornado movement, tornado damage by armor tier, tornado despawn, tornado replaces one attack in rotation, HP-phase scaling for both systems
- [ ] Floor tiles cycle safe -> warning -> hazard -> safe on a timer
- [ ] Tile warning duration scales with boss HP phase (5 / 3 / 2 ticks)
- [ ] Standing on a hazard tile deals 10-20 damage per tick
- [ ] Phase 3 safe tiles never become hazards
- [ ] Boss summons tornadoes as part of attack rotation (replaces one projectile attack)
- [ ] Tornado count scales with HP phase (2 / 3 / 4)
- [ ] Tornadoes move 1 tile/tick toward player
- [ ] Tornadoes despawn after 20 ticks
- [ ] Tornado damage scales with armor tier
- [ ] Floor tiles render with warning (orange) and hazard (red) colors in 3D
- [ ] Tornado GLTF meshes appear and track tornado positions
- [ ] Game reset clears all tile states and tornadoes
- [ ] Both systems use seeded RNG for determinism

---

## Cut List (if sprint runs long)

1. **Phase 3 safe tiles** -- All tiles activate uniformly. Add safe-tile exceptions later.
2. **3D tornado meshes** -- Show tornadoes as colored spheres instead of loading the GLTF.
3. **3D floor tile colors** -- Skip visual feedback; damage still applies. Add visuals next sprint.
4. **Tile activation patterns** -- Use uniform random instead of group/wave patterns. Simpler, still functional.
5. **Tornado damage by armor tier** -- Use a flat 15-25 damage for all tiers. Tier scaling is polish.
6. **Tornado rotation integration** -- Tornadoes spawn on a separate timer instead of replacing an attack slot. Easier to implement, close enough.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tile activation rate too high/low | High | Medium | Tune the per-tick activation probability (start at 15-20%). Easy to adjust post-merge. |
| Tornado movement feels wrong (too fast/slow or clipping) | Medium | Medium | Simple sign-based step is correct for 1 tile/tick. Test with manual play. |
| Floor damage makes the fight too hard | Medium | Medium | Damage range (10-20) is tunable. Can also reduce activation rate. |
| Tornado summon timing breaks attack rotation | Medium | High | Keep `Boss.fireAttack()` unchanged. The simulation intercepts the attack slot. Existing boss rotation tests still pass because the boss class itself is unmodified. |
| Adding `'tornado'` to AttackStyle breaks existing code | Medium | Medium | Alternative: don't modify `AttackStyle`. The simulation decides when to summon tornadoes based on a counter -- the boss still fires a normal attack, but the simulation replaces the projectile with a tornado spawn. Safest approach. |
| Tile state array adds memory/GC pressure | Low | Low | 144 entries (12x12). Trivial. |
| Seeded RNG determinism broken by new RNG calls | Medium | High | New RNG calls (tile activation, tornado spawn positions, damage rolls) change the RNG sequence for existing tests. Mitigate: existing tests use `skipCountdown` and specific seeds. If they break, re-record expected values or isolate new RNG calls to a separate Rng instance. |

---

## Open Questions

1. **Tornado summon frequency**: Once per 2 full rotations (every 8th attack) or once per rotation (every 4th attack)? INTENT.md says it "counts as one attack in the 4-attack rotation" but doesn't specify frequency. Suggest: every other rotation (every 8th attack) in phase 1, every rotation in phases 2-3.

2. **Tile activation patterns**: INTENT.md says "tiles activate in patterns/groups, not all at once." Simplest implementation: random per-tile per-tick chance. If that looks too chaotic, switch to wave/ring patterns in a follow-up.

3. **RNG isolation**: Should floor tiles and tornadoes use the main seeded RNG (which changes existing test sequences) or a separate Rng instance seeded from the main one? Separate instance is safer for test stability.

4. **Tornado spawn positions**: Near boss center offset by random direction. How far? Suggest 1-2 tiles from boss edge, clamped to arena bounds.

5. **AttackStyle union**: Adding `'tornado'` to `AttackStyle` may have type-level ripple effects (switch statements, renderer checks). Alternative: keep `AttackStyle` as-is and handle tornado summon purely in the simulation layer. Recommend the latter.
