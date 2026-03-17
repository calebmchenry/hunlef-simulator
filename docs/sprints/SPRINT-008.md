# Sprint 008: Floor Tile Hazards + Tornado Special Attacks

## Overview

Implement the two remaining Corrupted Hunlef special attacks: **floor tile hazards** (persistent environmental danger where tiles cycle through safe → warning → hazard states dealing 10-20 damage/tick) and **tornadoes** (entities that spawn during the boss attack rotation, chase the player at 1 tile/tick, deal armor-scaled damage on contact, and despawn after 20 ticks).

These are the final major combat mechanics. After this sprint, the core Corrupted Gauntlet fight is mechanically complete.

**What ships:** Floor tiles cycle through 3 states with HP-phase-based timing. 5 predefined spatial patterns activate randomly (never repeating consecutively). Tornadoes spawn as part of the boss attack rotation (every other cycle), chase the player, render as 3D models from the existing GLTF. Phase 3 has permanent safe tiles.

**What's deferred:** Prayer-disable attack (deferred from sprint 2, still out of scope), exact Jagex server-side tile patterns (using community-reconstructed patterns from kareth/osrs-cg), sound effects.

---

## Use Cases

1. **UC-1: Floor tiles activate** — During the fight, groups of tiles turn crimson (warning), then orange (hazard). Standing on an orange tile deals 10-20 damage per tick.
2. **UC-2: HP-phase tile speed** — Phase 1 (1000-667 HP): 6 tick warning. Phase 2 (666-333): 4 tick warning. Phase 3 (332-1): 3 tick warning. Total cycle ~9-12 ticks.
3. **UC-3: Tile patterns** — 5 predefined patterns (center block, four corners, offset corners, border ring, corners+center). Selected randomly, never same twice in a row.
4. **UC-4: Phase 3 safe tiles** — In Phase 3 (<332 HP), certain tiles are permanently safe (never become hazards).
5. **UC-5: Tornado summon** — Every other boss attack cycle, one of the 4 attacks is replaced by a tornado summon. Spawns 2/3/4 tornadoes based on boss HP phase.
6. **UC-6: Tornado chase** — Each tornado moves 1 tile/tick toward the player using BFS pathfinding. Player (2 tiles/tick) can outrun them.
7. **UC-7: Tornado damage** — Overlapping a tornado deals damage per tick scaled by armor: None 15-30, T1 15-25, T2 10-20, T3 7-15.
8. **UC-8: Tornado despawn** — Tornadoes despawn after 20 ticks (12 seconds).
9. **UC-9: 3D tornado rendering** — Tornado GLTF model (already exported) renders in the Three.js scene, chasing the player.
10. **UC-10: Floor tile visuals** — Tiles change color in 3D: safe = dark floor, warning = crimson glow, hazard = bright orange/red.

---

## Architecture

### Floor Tile State Machine

Each tile in the 12x12 arena has a state:
```typescript
type TileState = 'safe' | 'warning' | 'hazard';

interface TileInfo {
  state: TileState;
  tickChanged: number;  // tick when state last changed
  permanent: boolean;   // Phase 3 safe tiles — never activate
}
```

The Arena gains a `tiles: TileInfo[][]` grid (12x12). A `FloorHazardManager` handles the activation cycle:

```
Every cycle (every ~9 ticks):
  1. Select a random pattern from the pool (not same as previous)
  2. Set all pattern tiles to 'warning'
  3. After warningTicks (phase-dependent): transition to 'hazard'
  4. After hazardTicks: transition back to 'safe'
```

### Tile Patterns (from kareth/osrs-cg community reconstruction)

```typescript
// 5 predefined rectangular area patterns on the 12x12 grid
const FLOOR_PATTERNS = [
  // Pattern 0: Center block 6x6
  [{ x: 3, y: 3, w: 6, h: 6 }],

  // Pattern 1: Four corner blocks 4x4
  [{ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 8, w: 4, h: 4 },
   { x: 8, y: 0, w: 4, h: 4 }, { x: 8, y: 8, w: 4, h: 4 }],

  // Pattern 2: Offset corners 4x4
  [{ x: 1, y: 1, w: 4, h: 4 }, { x: 1, y: 7, w: 4, h: 4 },
   { x: 7, y: 1, w: 4, h: 4 }, { x: 7, y: 7, w: 4, h: 4 }],

  // Pattern 3: Border ring (2-tile wide border)
  [{ x: 0, y: 0, w: 12, h: 2 }, { x: 0, y: 10, w: 12, h: 2 },
   { x: 0, y: 2, w: 2, h: 8 }, { x: 10, y: 2, w: 2, h: 8 }],

  // Pattern 4: Corner 3x3 blocks + center 4x4
  [{ x: 0, y: 0, w: 3, h: 3 }, { x: 0, y: 9, w: 3, h: 3 },
   { x: 9, y: 0, w: 3, h: 3 }, { x: 9, y: 9, w: 3, h: 3 },
   { x: 4, y: 4, w: 4, h: 4 }],
];
```

### HP Phase Timing

| Phase | HP Range | Warning Ticks | Hazard Ticks | Total Cycle | Tornado Count |
|-------|----------|--------------|-------------|-------------|---------------|
| 1 | 1000-667 | 6 | 6 | 12 | 2 |
| 2 | 666-333 | 4 | 6 | 10 | 3 |
| 3 | 332-1 | 3 | 6 | 9 | 4 |

### Tornado Entity

```typescript
interface Tornado {
  pos: Position;       // current tile position
  prevPos: Position;   // for rendering interpolation
  spawnTick: number;   // tick when spawned
  lifetime: number;    // 20 ticks total
}
```

Tornadoes use the existing `findNextStep()` BFS pathfinder to chase the player. They move 1 tile/tick (player moves 2). They don't collide with each other or the boss.

### Boss Rotation Integration

Current: `fireAttack()` always returns `'ranged'` or `'magic'`.

New: Track cycle count. Every other cycle (cycle 1, 3, 5...), the first attack of the cycle is a tornado summon instead of a standard attack. `fireAttack()` returns `'tornado'` for that attack. The attack counter still advances normally.

```typescript
fireAttack(): AttackStyle | 'tornado' {
  // Check if this should be a tornado summon
  if (this.cycleCount % 2 === 1 && this.attackCounter === 0) {
    this.attackCounter++;
    // ... normal counter logic
    return 'tornado';
  }
  // ... normal attack logic
}
```

### Tick Processing Order

Add new steps between movement and boss AI:

```
1. Inputs → 2. Prayer drain → 3. Movement
4a. Floor tile tick (advance tile states, check for new cycle)
4b. Floor tile damage (player on hazard tile → 10-20 damage)
4c. Resolve arriving projectiles
5. Boss AI → 6. Player attack
7a. Tornado movement (each tornado steps 1 tile toward player)
7b. Tornado damage (player overlapping any tornado → tier-scaled damage)
7c. Tornado cleanup (remove despawned tornadoes)
8. Stomp → 9. Death
```

---

## Implementation

### Phase 1: Floor Tile State System (~20% effort)

**Files:**
- `src/world/FloorHazardManager.ts` — New
- `src/world/Arena.ts` — Modify (add tile state grid)
- `src/entities/types.ts` — Modify (add TileState, TileInfo)

**Tasks:**
- [ ] Define `TileState`, `TileInfo`, and `FloorPattern` types
- [ ] Define the 5 FLOOR_PATTERNS as static data
- [ ] Implement `FloorHazardManager`:
  - `tick(bossHp, currentTick, rng)` — advance tile states, select new patterns on cycle boundary
  - `getPhase(bossHp)` — returns 1/2/3 based on HP thresholds
  - `getWarningTicks(phase)` — 6/4/3
  - `activatePattern(patternIndex)` — set tiles to 'warning'
  - `transitionToHazard()` — set warning tiles to 'hazard'
  - `clearHazard()` — set hazard tiles back to 'safe'
  - Pattern selection: random from RNG, never same as previous
- [ ] Add `tiles: TileInfo[][]` to Arena (12x12 grid, initialized as 'safe')
- [ ] Phase 3 safe tiles: when phase is 3, mark a predefined set of tiles as `permanent: true` (never activate)
- [ ] Tests: tile state transitions, phase timing, no consecutive repeat patterns, Phase 3 safe tiles

### Phase 2: Floor Tile Damage + Rendering (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] In `processTick()`: call `floorHazardManager.tick()` between movement and boss AI
- [ ] Floor damage: if `player.pos` is on a 'hazard' tile, deal `rng.nextInt(10, 20)` damage per tick
- [ ] Add FloorHazardManager to GameSimulation (created at fight start)
- [ ] 3D rendering of tile states:
  - Safe: normal dark floor (existing)
  - Warning: crimson/red glow on the tile (emissive material or colored overlay plane)
  - Hazard: bright orange/red (stronger glow, possibly pulsing)
  - Use Three.js PlaneGeometry overlays per tile, set color/opacity based on state
- [ ] Tests: player takes damage on hazard tiles, no damage on safe/warning tiles

### Phase 3: Tornado Entity + Chase AI (~25% effort)

**Files:**
- `src/entities/Tornado.ts` — New
- `src/engine/GameSimulation.ts` — Modify
- `src/world/Pathfinding.ts` — Reuse existing `findNextStep()`

**Tasks:**
- [ ] Define `Tornado` interface: pos, prevPos, spawnTick, lifetime (20)
- [ ] Add `tornadoes: Tornado[]` array to GameSimulation
- [ ] Tornado chase logic: each tick, each tornado calls `findNextStep(tornado.pos, player.pos, arena, boss)` — moves 1 tile toward player
  - Save `prevPos` before moving (for rendering interpolation)
  - Tornadoes don't collide with each other
  - Tornadoes CAN overlap the boss footprint
- [ ] Tornado despawn: remove when `currentTick - spawnTick >= 20`
- [ ] Spawn logic: when `fireAttack()` returns `'tornado'`:
  - Determine count from HP phase (2/3/4)
  - Spawn tornadoes at random walkable tiles adjacent to boss footprint
  - Use seeded RNG for spawn positions
- [ ] Tests: tornado movement toward player, despawn after 20 ticks, correct spawn count per phase

### Phase 4: Tornado Damage + Boss Rotation Integration (~15% effort)

**Files:**
- `src/entities/Boss.ts` — Modify
- `src/engine/GameSimulation.ts` — Modify
- `src/equipment/items.ts` — Modify (add tornado damage table)

**Tasks:**
- [ ] Add tornado damage table to items.ts:
  ```typescript
  export const TORNADO_DAMAGE: Record<Tier, { min: number; max: number }> = {
    0: { min: 15, max: 30 },
    1: { min: 15, max: 25 },
    2: { min: 10, max: 20 },
    3: { min: 7, max: 15 },
  };
  ```
- [ ] Tornado damage in processTick(): for each tornado overlapping player position, roll `rng.nextInt(min, max)` and apply damage. Multiple tornadoes roll independently.
- [ ] Modify `Boss.fireAttack()`:
  - Add `cycleCount` field (increments each time attackCounter resets to 0)
  - Every other cycle (odd cycles), first attack returns `'tornado'` instead of standard attack
  - Tornado summon counts as one of the 4 attacks (counter still advances)
- [ ] Tests: boss fires tornado on correct cycles, tornado damage scales by armor, multiple tornadoes deal independent damage

### Phase 5: 3D Tornado Rendering (~15% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Load tornado GLTF (`public/models/tornado.gltf`) at startup
- [ ] For each active tornado, clone the mesh and add to scene
- [ ] Position interpolation: `lerp(tornado.prevPos, tornado.pos, tickProgress)` (same as player)
- [ ] Tornadoes rotate continuously (visual spin effect): `mesh.rotation.y += delta * 3`
- [ ] Remove mesh from scene when tornado despawns
- [ ] Manage a pool of tornado meshes to avoid allocation per spawn
- [ ] Tests: N/A (visual only, verify via agent-browser)

### Phase 6: Integration + Polish (~10% effort)

**Files:**
- `src/__tests__/floor-tornado.test.ts` — New
- `src/__tests__/integration.test.ts` — Modify

**Tasks:**
- [ ] Integration tests:
  - Full 100-tick headless sim with floor hazards active — player takes floor damage
  - Tornado spawns on correct boss cycle, chases player, deals damage, despawns
  - Floor phase transitions at correct HP thresholds
  - Determinism: same seed produces identical floor patterns + tornado spawns
- [ ] All 155 existing tests still pass
- [ ] Visual verification with agent-browser:
  - [ ] Screenshot: floor tiles in warning state (crimson glow)
  - [ ] Screenshot: floor tiles in hazard state (orange/red)
  - [ ] Screenshot: tornadoes chasing player (tornado 3D model visible)
  - [ ] Screenshot: multiple tornadoes in Phase 3

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/world/FloorHazardManager.ts` | Create | Tile state machine, pattern selection, HP-phase timing |
| `src/entities/Tornado.ts` | Create | Tornado entity type |
| `src/__tests__/floor-tornado.test.ts` | Create | Floor + tornado tests |
| `src/world/Arena.ts` | Modify | Add tiles grid |
| `src/entities/types.ts` | Modify | Add TileState, TileInfo types |
| `src/entities/Boss.ts` | Modify | Tornado summon in attack rotation, cycleCount |
| `src/engine/GameSimulation.ts` | Modify | Floor tick, floor damage, tornado spawn/move/damage/cleanup |
| `src/equipment/items.ts` | Modify | Tornado damage table |
| `src/render/Renderer3D.ts` | Modify | 3D tile overlays + tornado mesh rendering |
| `src/__tests__/integration.test.ts` | Modify | Floor + tornado integration |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + new tests
- [ ] Floor tiles cycle: safe → warning (crimson) → hazard (orange) → safe
- [ ] Warning duration: Phase 1 = 6 ticks, Phase 2 = 4 ticks, Phase 3 = 3 ticks
- [ ] Standing on hazard tile deals 10-20 damage per tick
- [ ] 5 predefined spatial patterns activate randomly (no consecutive repeats)
- [ ] Phase 3 (<332 HP) has permanent safe tiles
- [ ] Floor tile states visible in 3D (crimson glow for warning, orange/red for hazard)
- [ ] Tornadoes spawn every other boss cycle (1st attack of odd cycles)
- [ ] Tornado count: Phase 1 = 2, Phase 2 = 3, Phase 3 = 4
- [ ] Tornadoes chase player at 1 tile/tick using BFS pathfinding
- [ ] Tornadoes despawn after 20 ticks
- [ ] Tornado damage per tick: None 15-30, T1 15-25, T2 10-20, T3 7-15
- [ ] Tornado 3D model renders in scene (from tornado.gltf)
- [ ] Tornadoes rotate visually (spinning effect)
- [ ] Multiple tornadoes can overlap and deal independent damage
- [ ] All 155 Sprint 1-7 tests still pass
- [ ] Determinism preserved with seeded RNG

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Floor patterns don't match real OSRS | Medium | Medium | Using community-reconstructed patterns from kareth/osrs-cg. Close enough for a practice tool. |
| Floor tile rendering performance (144 tile overlays) | Low | Low | Only render overlays for non-safe tiles. Most tiles are safe most of the time. |
| Tornado pathfinding conflicts with boss footprint | Low | Low | Tornadoes CAN overlap boss tiles (they do in real OSRS). Only blocked by arena walls. |
| Multiple tornadoes + floor damage = player dies instantly | Medium | Low | This is correct — the real fight is very dangerous in Phase 3. Player needs to pray, eat, and run. |
| Tornado spawn positions overlap | Low | Low | Spawn at random walkable tiles near boss. If overlap, they spread out naturally as they chase. |

---

## Dependencies

No new dependencies. Three.js (from Sprint 7) handles all 3D rendering.

---

## Open Questions

1. **Floor tile damage and prayer**: Does protection prayer reduce floor tile damage? In OSRS, floor damage is typeless (not reduced by prayer). Implement as typeless.

2. **Tornado and prayer**: Tornado damage is also typeless in OSRS. Not reduced by protection prayers.

3. **Floor hazard during countdown**: Should floor tiles activate during the 10-tick countdown? Probably not — the fight hasn't started. Floor hazards begin when state transitions to 'running'.

4. **Tornado spawn exact positions**: The kareth simulator spawns tornadoes at the boss center. In OSRS they spawn adjacent to the boss. Implementation: spawn at random walkable tiles within 2 tiles of the boss footprint edge.
