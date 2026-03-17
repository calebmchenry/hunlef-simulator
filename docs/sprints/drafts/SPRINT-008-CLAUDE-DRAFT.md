# Sprint 008: Floor Tile Hazards + Tornado Special Attacks

## Overview

Add the two remaining Corrupted Hunlef combat mechanics: a persistent floor tile hazard system that cycles tiles through safe/warning/hazard states on HP-phase-driven timers, and a tornado entity with chase AI that pathfinds 1 tile/tick toward the player. The tornado summon integrates into the boss's existing 4-attack rotation as a replacement for one standard attack.

**What ships:** Tile state machine on the Arena (safe -> warning -> hazard with HP-phase timing), Tornado entity with per-tick pathfinding chase AI, tornado summon wired into the boss attack rotation, damage calculations for both systems scaled by armor tier, 3D rendering for tile visual states and tornado meshes, deterministic behavior via seeded RNG.

**What's deferred:** Safe tile patterns for Phase 3 (partially implemented as a hook but visual "safe tile" indicators are cosmetic polish). Tornado collision with other tornadoes (they overlap freely per OSRS behavior). Tornado stacking damage cap (OSRS does not cap stacked tornado damage).

---

## Use Cases

1. **UC-1: Tile hazard cycle** -- Arena tiles continuously cycle through safe -> warning -> hazard states. Standing on a hazard tile deals 10-20 damage per tick. The cycle speed accelerates through three HP phases.
2. **UC-2: HP-phase tile timing** -- At boss HP 1000-667 tiles warn for ~5 ticks before becoming hazards. At 666-333 the warning shrinks to ~3 ticks. At 332-1 the warning is ~1-2 ticks.
3. **UC-3: Tile group activation** -- Tiles activate in patterns/groups (not all at once), giving the player safe zones to navigate toward.
4. **UC-4: Tornado summon** -- When the boss's attack rotation fires a tornado summon, 2-4 tornadoes spawn near the boss (count scales with HP phase) and chase the player for 20 ticks.
5. **UC-5: Tornado chase AI** -- Each tornado pathfinds 1 tile/tick toward the player using the existing BFS pathfinder. The player moves 2 tiles/tick and can outrun them.
6. **UC-6: Tornado damage by armor** -- Overlapping a tornado deals per-tick damage scaled by armor tier: None 15-30, T1 15-25, T2 10-20, T3 7-15.
7. **UC-7: Tornado in attack rotation** -- Tornado summon replaces one of the 4 attacks in the boss rotation periodically. The boss still alternates ranged/magic styles for the other 3 attacks in that cycle.
8. **UC-8: Visual feedback** -- Floor tiles show distinct colors for safe/warning/hazard. Tornado meshes render from the existing GLTF model and spin in place.
9. **UC-9: Existing tests pass** -- All 155 tests remain green. Game logic changes are additive.

---

## Architecture

### Tile State Machine

Each tile in the 12x12 arena has a `TileState`:

```typescript
type TileState = 'safe' | 'warning' | 'hazard';

interface TileData {
  state: TileState;
  /** Tick when the tile entered its current state */
  stateEnteredTick: number;
  /** Whether this tile is a permanent safe tile (Phase 3) */
  permanentSafe: boolean;
}
```

The Arena manages a `TileData[][]` grid. Each tick, a `tickTiles()` method advances the state machine:

```
safe ──(group selected)──> warning ──(warningDuration ticks)──> hazard ──(hazardDuration ticks)──> safe
```

The warning duration is HP-phase-dependent:

| Boss HP Range | Phase | Warning Duration | Hazard Duration |
|---------------|-------|-----------------|-----------------|
| 1000-667      | 1     | 5 ticks         | 3 ticks         |
| 666-333       | 2     | 3 ticks         | 3 ticks         |
| 332-1         | 3     | 1-2 ticks       | 2 ticks         |

**Group activation pattern:** Each cycle, the system selects a group of ~6-10 tiles to begin the warning->hazard cycle. Groups are chosen via seeded RNG from a set of predefined tile regions (quadrants, strips, or random clusters). Not all tiles cycle simultaneously -- at most ~25% of tiles are in warning/hazard at any moment. This gives the player navigable safe zones.

**Phase 3 safe tiles:** In Phase 3 (HP 332-1), a small set of tiles (~4-6) are marked `permanentSafe = true` and never enter the warning/hazard cycle. These act as reliable safe spots amid the fast-cycling floor.

### HP Phase Helper

A shared utility used by both tile timing and tornado count:

```typescript
function getHpPhase(bossHp: number): 1 | 2 | 3 {
  if (bossHp >= 667) return 1;
  if (bossHp >= 333) return 2;
  return 3;
}
```

### Tornado Entity

```typescript
interface Tornado {
  pos: Position;
  spawnTick: number;
  lifetime: number; // 20 ticks
}
```

Tornadoes are stored as an array on `GameSimulation`. Each tick:
1. Each tornado calls `findNextStep(tornado.pos, player.pos, arena, boss)` to move 1 tile toward the player.
2. If `tornado.pos` equals `player.pos`, apply damage based on armor tier.
3. If `sim.tick - tornado.spawnTick >= tornado.lifetime`, despawn.

Tornadoes use the same BFS pathfinder the player uses. They treat the boss footprint as impassable (same as the player). They do NOT block each other -- multiple tornadoes can occupy the same tile.

The player moves 2 tiles/tick (two calls to `findNextStep` per tick). Tornadoes move 1 tile/tick. The player can always outrun tornadoes in open space, but tight corners near the boss footprint create danger.

### Boss Attack Rotation Integration

Currently `Boss.fireAttack()` increments `attackCounter` 0-3, switching style after 4. The tornado summon must slot into this rotation.

**Approach:** Add a `tornadoInterval` counter on the Boss. Every N-th attack cycle (e.g., every 2nd full cycle of 4 attacks), the first attack of the cycle is replaced with a tornado summon instead of a ranged/magic projectile. The tornado summon still advances `attackCounter` by 1, maintaining rotation integrity.

```typescript
// In Boss class:
tornadoCycleCounter: number = 0;
readonly tornadoEveryNCycles: number = 2; // tornado replaces attack every 2nd cycle

fireAttack(): AttackStyle | 'tornado' {
  // Check if this is the first attack of a tornado cycle
  if (this.attackCounter === 0) {
    this.tornadoCycleCounter++;
    if (this.tornadoCycleCounter >= this.tornadoEveryNCycles) {
      this.tornadoCycleCounter = 0;
      this.attackCounter++;
      this.attackCooldown = this.attackSpeed;
      return 'tornado';
    }
  }

  // Normal attack logic (existing)
  const style = this.currentStyle;
  this.attackCounter++;
  if (this.attackCounter >= 4) {
    this.attackCounter = 0;
    this.currentStyle = this.currentStyle === 'ranged' ? 'magic' : 'ranged';
  }
  this.attackCooldown = this.attackSpeed;
  return style;
}
```

When `fireAttack()` returns `'tornado'`, `GameSimulation.processTick()` spawns tornadoes instead of creating a projectile. The `AttackStyle` type union is extended:

```typescript
export type AttackStyle = 'ranged' | 'magic' | 'tornado';
```

### Tornado Spawn Positions

Tornadoes spawn on walkable tiles adjacent to the boss's 5x5 footprint (within 1-2 tiles of the boss edge). Exact positions are chosen via seeded RNG from the set of walkable tiles in that ring. If no valid tile is found (very unlikely given the 12x12 arena), the tornado spawns at the boss center.

Tornado count by HP phase:

| Boss HP Range | Phase | Tornado Count |
|---------------|-------|---------------|
| 1000-667      | 1     | 2             |
| 666-333       | 2     | 3             |
| 332-1         | 3     | 4             |

### Damage Calculation

**Floor tile hazard damage** -- flat 10-20 per tick via `rng.nextInt(10, 20)`. Applied identically regardless of armor tier (environmental damage, not combat damage). This matches OSRS CG behavior where floor damage ignores armor.

**Tornado damage** -- per-tick while the player occupies the same tile as any tornado. Scaled by armor tier:

| Armor Tier | Min | Max | Roll Expression |
|------------|-----|-----|----------------|
| 0 (None)   | 15  | 30  | `rng.nextInt(15, 30)` |
| 1 (Basic)  | 15  | 25  | `rng.nextInt(15, 25)` |
| 2 (Attuned)| 10  | 20  | `rng.nextInt(10, 20)` |
| 3 (Perfected)| 7 | 15  | `rng.nextInt(7, 15)` |

Stored as a lookup table:

```typescript
export const TORNADO_DAMAGE: Record<Tier, { min: number; max: number }> = {
  0: { min: 15, max: 30 },
  1: { min: 15, max: 25 },
  2: { min: 10, max: 20 },
  3: { min: 7, max: 15 },
};
```

If multiple tornadoes overlap the player on the same tick, each one rolls damage independently. This is intentional and punishing.

### Tick Processing Order

The existing `processTick()` steps are numbered 1-9. New steps are inserted:

```
1.  Process queued inputs
2.  Drain prayer
3.  Player movement
    --- countdown gate ---
4.  Resolve arriving projectiles
4a. ** Tick tile state machine (advance warning/hazard timers, select new groups) **
4b. ** Apply floor tile damage (if player on hazard tile) **
5.  Boss AI: fire attack (now returns 'tornado' | 'ranged' | 'magic')
5a. ** If tornado: spawn tornado entities instead of projectile **
5b. ** Move all active tornadoes 1 tile toward player **
5c. ** Apply tornado overlap damage **
5d. ** Despawn expired tornadoes **
6.  Player attack resolution
7.  Stomp check
8.  Death checks
9.  Clean up projectiles + hit splats
9a. ** Clean up despawned tornadoes from array **
```

Tile damage (4b) is applied after movement (3) but before boss attacks (5), so the player's new position determines whether they are on a hazard tile. Tornado movement (5b) happens after the boss potentially spawns new tornadoes (5a), so newly spawned tornadoes do NOT move on their first tick -- they move starting the following tick.

### Rendering Integration

**Floor tiles in Renderer3D:** The arena floor plane is subdivided into 12x12 tiles. Each tile's material color is updated per-frame based on `TileState`:
- `safe`: base floor color (#1a0a0a dark maroon)
- `warning`: amber/orange (#cc8800) with a pulsing opacity
- `hazard`: bright red (#cc2200) with full opacity

Implementation: use an array of 144 `MeshBasicMaterial` instances (one per tile), updating `material.color` in `draw()`. Alternatively, a single plane with a `DataTexture` (12x12 pixels) that gets updated each frame -- simpler draw calls.

**Tornado meshes:** Load `public/models/tornado.gltf` via GLTFLoader. Clone the mesh for each active tornado. Position at `tileToWorld(tornado.pos.x, tornado.pos.y)`. Rotate `mesh.rotation.y += deltaTime * 4` for a spinning effect. Add/remove meshes from the scene as tornadoes spawn/despawn.

---

## Implementation

### Phase 1: Tile State Machine on Arena (~25% effort)

**Files:**
- `src/world/Arena.ts` -- Modify (add tile state grid, tick method, HP-phase timing)
- `src/entities/types.ts` -- Modify (add TileState type, extend AttackStyle)
- `src/equipment/items.ts` -- Modify (add TORNADO_DAMAGE table)

**Tasks:**
- [ ] Add `TileState` type and `TileData` interface to `types.ts`
- [ ] Extend `AttackStyle` union to include `'tornado'`
- [ ] Add `TORNADO_DAMAGE` lookup table to `items.ts`
- [ ] Add `tiles: TileData[][]` grid to Arena, initialized to all `safe`
- [ ] Add `getHpPhase(bossHp: number): 1 | 2 | 3` utility function to Arena or a shared module
- [ ] Implement `Arena.tickTiles(currentTick: number, bossHp: number, rng: Rng)`:
  - Advance each tile's state machine based on elapsed ticks since `stateEnteredTick`
  - Use HP-phase-derived warning/hazard durations
  - When a group of tiles finishes the hazard phase and returns to safe, select a new group to begin warning
  - Group selection: pick ~6-10 tiles via seeded RNG. Avoid tiles currently in warning/hazard. Avoid `permanentSafe` tiles.
- [ ] Implement tile group selection strategy: divide arena into 4 quadrants, pick 1-2 quadrants per cycle, then randomly select tiles within them. This produces spatial clustering that feels intentional rather than random scatter.
- [ ] Add `Arena.initPhase3SafeTiles(rng: Rng)` -- mark 4-6 tiles as `permanentSafe` when boss enters Phase 3. Called once from GameSimulation when HP crosses 333.
- [ ] Add `Arena.getTileState(x: number, y: number): TileState` accessor
- [ ] Add `Arena.isHazard(x: number, y: number): boolean` convenience method

### Phase 2: Tornado Entity + Chase AI (~20% effort)

**Files:**
- `src/entities/Tornado.ts` -- New file
- `src/world/Pathfinding.ts` -- No changes needed (reuse `findNextStep`)

**Tasks:**
- [ ] Create `Tornado` class/interface:
  ```typescript
  export interface Tornado {
    pos: Position;
    prevPos: Position; // for rendering interpolation
    spawnTick: number;
    lifetime: number;  // 20
  }
  ```
- [ ] Implement `moveTornado(tornado: Tornado, playerPos: Position, arena: Arena, boss: Boss)`:
  - Calls `findNextStep(tornado.pos, playerPos, arena, boss)` -- moves 1 tile toward player
  - Saves `prevPos` before moving (for render interpolation)
- [ ] Implement `spawnTornadoes(bossHp: number, bossPos: Position, bossSize: number, currentTick: number, arena: Arena, boss: Boss, rng: Rng): Tornado[]`:
  - Determine count from HP phase (2/3/4)
  - Find walkable tiles within 1-2 Chebyshev distance of boss edge
  - Pick `count` positions from that ring via seeded RNG
  - Return array of new Tornado objects

### Phase 3: Boss Rotation Integration (~15% effort)

**Files:**
- `src/entities/Boss.ts` -- Modify (tornado cycle counter, fireAttack returns tornado)

**Tasks:**
- [ ] Add `tornadoCycleCounter: number = 0` and `tornadoEveryNCycles: number = 2` to Boss
- [ ] Modify `fireAttack()` return type to `AttackStyle` (which now includes `'tornado'`)
- [ ] Implement tornado insertion logic: on the first attack of every Nth cycle, return `'tornado'` instead of the normal style. The `attackCounter` still increments. Style switching still occurs normally at attackCounter === 4.
- [ ] Add tornado fields to `Boss.reset()`: reset `tornadoCycleCounter`
- [ ] Verify that tornado summon does NOT disrupt the ranged/magic style alternation. If the boss was going to switch styles at attackCounter 4, the switch still happens after the 4th attack regardless of whether one was a tornado.

### Phase 4: GameSimulation Integration (~25% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify (add tile ticking, tornado management, damage steps)

**Tasks:**
- [ ] Add `tornadoes: Tornado[] = []` field to GameSimulation
- [ ] Add `phase3Initialized: boolean = false` flag
- [ ] In `processTick()`, after step 3 (player movement) and before step 5 (boss AI):
  - Call `this.arena.tickTiles(this.tick, this.boss.hp, this.rng)`
  - Check if player is on a hazard tile: `if (this.arena.isHazard(player.pos.x, player.pos.y))`
  - If so, roll `rng.nextInt(10, 20)` damage, apply to player HP, create hit splat
- [ ] In step 5 (boss AI), when `fireAttack()` returns `'tornado'`:
  - Call `spawnTornadoes(...)` and append results to `this.tornadoes`
  - Do NOT create a projectile for this attack
  - Still set `lastBossAttackStyle = 'tornado'` for UI indication
- [ ] After boss AI and tornado spawn, process all existing tornadoes:
  - For each tornado where `this.tick > tornado.spawnTick` (skip first tick):
    - Call `moveTornado(tornado, player.pos, arena, boss)`
  - For each tornado where `tornado.pos.x === player.pos.x && tornado.pos.y === player.pos.y`:
    - Look up damage range from `TORNADO_DAMAGE[player.loadout.armor.tier]`
    - Roll `rng.nextInt(min, max)`, apply to player HP, create hit splat
  - Filter out tornadoes where `this.tick - tornado.spawnTick >= tornado.lifetime`
- [ ] Phase 3 safe tile initialization: after projectile resolution, check if `boss.hp <= 332 && !this.phase3Initialized`, then call `arena.initPhase3SafeTiles(rng)` and set flag
- [ ] Ensure all RNG calls use `this.rng` for determinism

### Phase 5: 3D Rendering (~10% effort)

**Files:**
- `src/render/Renderer3D.ts` -- Modify (tile coloring, tornado mesh management)

**Tasks:**
- [ ] **Floor tile visuals:** Replace the single arena floor plane with a grid of 144 individual tile meshes (or a single plane with per-vertex colors updated each frame). In `draw()`, read `arena.getTileState(x, y)` for each tile and set color:
  - `safe` -> #1a0a0a (existing dark maroon)
  - `warning` -> #cc8800 (amber), optionally pulse alpha using `sin(time * 4) * 0.3 + 0.7`
  - `hazard` -> #cc2200 (red), full opacity
- [ ] **Tornado meshes:** Load tornado GLTF once (`public/models/tornado.gltf`). For each active tornado in `sim.tornadoes`, clone the mesh and add to scene. Position via `tileToWorld()` with render interpolation using `lerp(tornado.prevPos, tornado.pos, tickProgress)`. Spin with `rotation.y += deltaTime * 4`.
- [ ] **Tornado mesh pooling:** Pre-allocate a pool of 4 tornado meshes (max concurrent). Show/hide and reposition as needed. Avoids per-frame allocation.
- [ ] **Boss attack style indicator:** When `lastBossAttackStyle === 'tornado'`, flash a distinct visual (white/gray pulse on the boss style indicator) for 1-2 ticks so the player knows a tornado summon occurred.

### Phase 6: Tests (~5% effort)

**Files:**
- `src/__tests__/FloorTiles.test.ts` -- New file
- `src/__tests__/Tornado.test.ts` -- New file

**Tasks:**
- [ ] **Floor tile tests:**
  - Tile starts safe, transitions to warning, then hazard, then back to safe
  - Warning duration matches HP phase (5/3/1-2 ticks)
  - Hazard tile deals 10-20 damage when player stands on it
  - PermanentSafe tiles never become hazards in Phase 3
  - Not all tiles activate simultaneously (group activation check)
- [ ] **Tornado tests:**
  - Tornado moves 1 tile/tick toward player via pathfinding
  - Tornado despawns after 20 ticks
  - Tornado count matches HP phase (2/3/4)
  - Tornado damage scales by armor tier (spot-check each tier)
  - Multiple overlapping tornadoes each deal independent damage
  - Tornado spawns near boss footprint edge
  - Tornado does not move on its spawn tick
- [ ] **Integration tests:**
  - Tornado summon replaces one attack in the rotation
  - Boss style switching is not disrupted by tornado summon
  - Floor tile + tornado damage can stack in the same tick
  - All 155 existing tests still pass
- [ ] Run `npm test` -- target ~175+ tests total (155 existing + ~20 new)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/types.ts` | Modify | Add `TileState` type, extend `AttackStyle` to include `'tornado'` |
| `src/equipment/items.ts` | Modify | Add `TORNADO_DAMAGE` lookup table by armor tier |
| `src/world/Arena.ts` | Modify | Add tile state grid, `tickTiles()`, HP-phase timing, group activation, Phase 3 safe tiles |
| `src/entities/Boss.ts` | Modify | Add tornado cycle counter, modify `fireAttack()` to return `'tornado'` periodically |
| `src/entities/Tornado.ts` | New | Tornado interface + `moveTornado()` + `spawnTornadoes()` functions |
| `src/engine/GameSimulation.ts` | Modify | Wire tile ticking, tornado lifecycle, floor/tornado damage steps into `processTick()` |
| `src/render/Renderer3D.ts` | Modify | Tile state coloring, tornado mesh loading/pooling/rendering |
| `src/__tests__/FloorTiles.test.ts` | New | Tests for tile state machine, HP-phase timing, damage |
| `src/__tests__/Tornado.test.ts` | New | Tests for tornado AI, damage, spawning, rotation integration |

---

## Key Technical Details

### Tornado Pathfinding Reuse

The existing `findNextStep()` in `src/world/Pathfinding.ts` is a BFS that returns the next tile toward a target, respecting arena bounds and boss collision. Tornadoes call the same function with `(tornado.pos, player.pos, arena, boss)`. No pathfinding changes are needed. The BFS runs on a 12x12 grid (144 tiles) so each call is sub-millisecond even with 4 tornadoes.

### Tile Group Selection Determinism

Tile group activation must be deterministic for replay consistency. All randomness flows through the seeded `Rng`. The group selection algorithm:

1. Count how many tiles are currently safe (not warning/hazard/permanentSafe)
2. Pick a target count: `min(rng.nextInt(6, 10), availableSafeCount)`
3. Shuffle the safe tile list (Fisher-Yates with seeded RNG) and take the first N
4. Alternatively, pick 1-2 quadrants and sample within them for spatial clustering

Both approaches are deterministic. The quadrant approach produces more realistic-feeling patterns.

### Damage Stacking

In a single tick, the player can take damage from:
- Floor tile hazard (10-20)
- One or more tornadoes (7-30 each, armor-dependent)
- Boss projectile arrival
- Boss stomp

All sources are independent and additive. A worst-case tick with hazard floor + 4 tornadoes + unprotected boss hit could deal 10 + 4*30 + 68 = 198 damage. This is intentionally lethal -- the player must manage positioning to avoid overlap.

### AttackStyle Type Change

Extending `AttackStyle` from `'ranged' | 'magic'` to `'ranged' | 'magic' | 'tornado'` has a small blast radius. Callers that switch on `AttackStyle` (damage calculation in `processTick`, prayer checking, projectile creation) need a `'tornado'` case. The tornado case skips projectile creation and prayer checking, so most existing branches are untouched. TypeScript exhaustiveness checking will catch any missed cases at compile time.

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all 155 existing tests + new floor tile and tornado tests (~175+ total)
- [ ] Floor tiles cycle safe -> warning -> hazard with correct HP-phase timing
- [ ] Standing on hazard tile deals 10-20 damage per tick
- [ ] Tile groups activate in clusters, not all at once
- [ ] Phase 3 permanent safe tiles never become hazards
- [ ] Tornado summon replaces one attack in the boss rotation every 2nd cycle
- [ ] Tornado count scales by HP phase: 2 / 3 / 4
- [ ] Tornadoes pathfind 1 tile/tick toward player
- [ ] Tornadoes despawn after 20 ticks (12 seconds)
- [ ] Tornado damage scales by armor tier (None: 15-30, T1: 15-25, T2: 10-20, T3: 7-15)
- [ ] Multiple tornadoes deal independent damage per tick
- [ ] Boss style rotation is not disrupted by tornado insertion
- [ ] Floor tiles render as safe (dark) / warning (amber) / hazard (red) in the 3D scene
- [ ] Tornado GLTF model renders at correct tile position with spin animation
- [ ] All RNG calls use the seeded Rng for deterministic replays
- [ ] Consistent 60fps with 4 active tornadoes + floor tile updates

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tornado pathfinding creates frame spikes with 4 tornadoes | Low | Low | BFS on 12x12 grid is <0.1ms per call. 4 calls per tick is negligible. |
| Tile group selection produces unfair patterns (no safe zone) | Medium | Medium | Cap hazard tile percentage at ~25%. Ensure at least one quadrant has majority safe tiles. Add a minimum safe-tile floor check in `tickTiles()`. |
| AttackStyle union change breaks existing type checks | Low | Medium | TypeScript exhaustiveness will flag all unhandled cases at compile time. Add `'tornado'` case to every switch before running tests. |
| Tornado rotation integration desynchronizes boss style switching | Medium | High | Unit test that after a full 4-attack cycle including a tornado, the boss correctly alternates ranged/magic. Test 3+ cycles to verify steady state. |
| Floor tile damage feels too punishing stacked with tornadoes | Medium | Low | Tune-able via constants. Can adjust hazard damage range, tornado damage table, or tile cycle speed post-implementation. |
| Phase 3 safe tile placement creates degenerate safe spots | Low | Low | Place safe tiles spread across the arena (one per quadrant minimum) rather than clustered. Player still needs to dodge tornadoes even on safe tiles. |
| Tornado GLTF model fails to load | Low | Medium | Fall back to a simple `ConeGeometry` spinning mesh, same as Sprint 007's fallback approach for model loading. |

---

## Dependencies

- **Runtime**: None new (Three.js already added in Sprint 007)
- **Assets**: `public/models/tornado.gltf` (218 verts, 338 faces) -- already exported
- **Codebase**: `src/world/Pathfinding.ts` (`findNextStep`) -- reused as-is for tornado AI
