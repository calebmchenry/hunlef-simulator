# Sprint 008 Intent: Floor Tile Hazards + Tornado Special Attacks

## Seed

Implement the two remaining Corrupted Hunlef special attacks — floor tile hazards ("floor is lava") and tornadoes that chase the player. These are the final major combat mechanics missing from the simulator.

## Context

- **Sprint 7 complete**: 155 tests, 3D Three.js renderer with animated Hunlef model, OSRS camera.
- **Boss rotation**: Currently fires 4 standard attacks per cycle. Per INTENT.md, tornado summons count as one of the 4 attacks. Need to integrate tornado summon into the attack rotation.
- **Assets available**: Tornado GLTF model at `public/models/tornado.gltf` (218 verts, 338 faces). Floor tile model (37410, 24 verts).
- **3D renderer**: Renderer3D.ts handles the scene. Need to add tornado meshes and floor tile visual states.

## Mechanics (from INTENT.md)

### Floor Tile Hazard (Persistent Environmental)
- Active throughout the entire fight — does NOT count toward 4-attack cycle
- Tiles cycle: **safe → warning → active hazard**
- Standing on active hazard tile: **10-20 damage per tick**
- Three HP phases control tile speed:
  | HP Range | Tile Speed |
  |----------|-----------|
  | 1000-667 | Slow (~5 tick warning) |
  | 666-333 | Medium (~3 tick warning) |
  | 332-1 | Fast (~1-2 tick warning) |
- In Phase 3: specific "safe tiles" never become hazards
- Tiles activate in patterns/groups, not all at once

### Tornado Summon
- Counts as **one attack** in the 4-attack rotation
- Tornado count scales with boss HP:
  | HP Range | Count |
  |----------|-------|
  | 667-1000 | 2 |
  | 333-666 | 3 |
  | 1-332 | 4 |
- Each tornado chases the player at **1 tile per tick** (player runs at 2 tiles/tick — can outrun)
- Tornadoes last **20 ticks (12 seconds)** then despawn
- Damage per tick while overlapping (by armor tier):
  | Armor | Damage |
  |-------|--------|
  | None | 15-30 |
  | T1 | 15-25 |
  | T2 | 10-20 |
  | T3 | 7-15 |
- Tornadoes spawn near the boss and pathfind toward player each tick

## Relevant Codebase

- `src/entities/Boss.ts` — fireAttack() needs tornado summon integration
- `src/engine/GameSimulation.ts` — processTick() needs floor tile + tornado damage steps
- `src/render/Renderer3D.ts` — 3D rendering of tornadoes + floor tile states
- `src/world/Arena.ts` — Tile state management
- `public/models/tornado.gltf` — Tornado 3D model (already exported)

## Constraints

- Tornado movement uses existing pathfinding (1 tile/tick toward player)
- Floor tiles are a per-tile state system on the Arena (safe/warning/hazard)
- Both mechanics use the seeded RNG for determinism
- All 155 existing tests must pass

## Uncertainty Assessment

- **Correctness: Medium** — Tile timing and tornado spawn patterns need tuning
- **Scope: Medium** — Two new game systems but well-defined mechanics
- **Architecture: Low** — Extends existing entity/tick patterns
