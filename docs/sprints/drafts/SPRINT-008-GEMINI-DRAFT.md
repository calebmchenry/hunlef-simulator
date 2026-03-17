# Sprint 008 Draft: Floor Tile Hazards + Tornado Special Attacks

**Author perspective:** 3D rendering + entity architecture

---

## Overview

This sprint adds the two remaining Corrupted Hunlef special attacks -- floor tile hazards and chasing tornadoes -- with a focus on how they manifest in the Three.js scene graph, how they are loaded and managed as 3D objects, and how the renderer stays synchronized with the simulation's per-tick state changes.

The floor tile system is a visual state machine applied to the existing 12x12 grid. Each tile transitions through three visual states: safe (dark floor, the current default), warning (orange emissive glow), and active hazard (bright red with full emissive). The renderer must track per-tile materials and update them every tick based on simulation state, without creating/destroying geometry each frame.

Tornadoes are the first dynamically spawned multi-instance 3D entities in the scene. Up to 4 tornado GLTF meshes can be active simultaneously, each with independent positions that update every tick. The renderer needs a pooling strategy: load the tornado GLTF once, clone instances into the scene as the simulation spawns them, and remove them on despawn. Each tornado tracks its own position for smooth interpolation between ticks.

The core architectural constraint remains: `GameSimulation` never imports Three.js. The simulation manages tile states and tornado entity positions as plain data. The renderer reads that data and maps it to scene graph operations.

---

## Architecture

### Floor Tile Rendering Pipeline

The arena is currently a single `PlaneGeometry(12, 12)` with a `MeshLambertMaterial({ color: 0x1a0a0a })`, plus a `LineSegments` grid overlay. This single-material approach cannot represent per-tile color states. The floor must be restructured.

**Approach: 144 individual tile meshes.**

Replace the single floor plane with 144 separate `PlaneGeometry(1, 1)` meshes, one per tile, grouped under a `floorGroup: THREE.Group`. Each tile mesh gets its own `MeshStandardMaterial` instance so its color and emissive properties can be updated independently.

```
floorGroup: THREE.Group
  |-- tile_0_0: THREE.Mesh(PlaneGeometry(1,1), MeshStandardMaterial)
  |-- tile_0_1: THREE.Mesh(PlaneGeometry(1,1), MeshStandardMaterial)
  |-- ...
  |-- tile_11_11: THREE.Mesh(PlaneGeometry(1,1), MeshStandardMaterial)
  |-- gridLines: THREE.LineSegments (unchanged)
```

Each tile mesh is positioned at `tileToWorld(x, y)` on the ground plane (y = -0.01, rotated to XZ).

**Why individual meshes instead of a texture atlas or shader:** The number of tiles is small (144). Material property updates (`color.setHex()`, `emissive.setHex()`, `emissiveIntensity`) are cheap per frame. A custom shader would be more performant at scale but adds complexity for no measurable gain at 144 tiles. Individual meshes also allow future per-tile effects (e.g., dissolve, pulse animation) without shader changes.

**Tile state to material mapping:**

| Tile State | `color` | `emissive` | `emissiveIntensity` | Visual |
|---|---|---|---|---|
| `safe` | `0x1a0a0a` | `0x000000` | 0 | Dark brownish-red, matches current floor |
| `warning` | `0x2a1500` | `0xff8800` | 0.4 | Orange glow begins, tile darkens slightly toward warm tone |
| `hazard` | `0x330000` | `0xff2200` | 0.8 | Bright red emissive, clearly dangerous |

The transition between states is driven entirely by the simulation. The renderer does not interpolate between states -- it snaps to the new material values each tick, matching OSRS's discrete tile-based visual behavior. However, the `emissiveIntensity` can be smoothly pulsed within a state using a sine wave on `tickProgress` to give warning and hazard tiles a breathing effect:

```typescript
// In updateFloorTiles(), for warning/hazard tiles:
const pulse = 0.8 + 0.2 * Math.sin(tickProgress * Math.PI * 2);
material.emissiveIntensity = baseIntensity * pulse;
```

**Data flow from simulation to renderer:**

The simulation needs to expose tile states. The `Arena` class currently has no per-tile state -- it only tracks bounds and walkability. Sprint 008 adds a `tileStates: TileState[][]` grid to `Arena` (or a new `FloorHazardSystem` class). The renderer reads this 2D array each tick:

```
GameSimulation.arena.tileStates[y][x]  -->  Renderer3D.tileMatrials[y][x]
  'safe'                                       color: 0x1a0a0a, emissive: off
  'warning'                                    color: 0x2a1500, emissive: orange
  'hazard'                                     color: 0x330000, emissive: red
```

The `tileMaterials` is a flat or 2D array of `MeshStandardMaterial` references stored by the renderer at construction time, indexed by tile coordinate. The `updateFloorTiles()` method iterates all 144 entries and sets material properties based on the simulation state. This runs once per tick (not per frame), except for the pulse animation which updates per frame.

### Tornado Scene Graph Management

Tornadoes are the first entity type that can have multiple simultaneous instances. The existing scene graph has exactly one boss group and one player mesh. Tornadoes require a dynamic collection.

**GLTF loading strategy: load once, clone many.**

The tornado GLTF at `public/models/tornado.gltf` (218 verts, 338 faces) is loaded once during `Renderer3D` construction, stored as a template. When the simulation spawns tornadoes, the renderer clones the template mesh for each instance.

```typescript
// During construction, alongside loadBossGLTF():
private tornadoTemplate: THREE.Group | null = null;

private loadTornadoGLTF(): void {
  const loader = new GLTFLoader();
  loader.load('/models/tornado.gltf', (gltf) => {
    this.tornadoTemplate = gltf.scene;
    this.tornadoTemplate.scale.set(TORNADO_SCALE, TORNADO_SCALE, TORNADO_SCALE);
  });
}
```

Cloning uses `template.clone()` which deep-copies the geometry references (shared, not duplicated) and creates new material instances. This is efficient: 4 tornado clones share the same `BufferGeometry` but have independent transforms.

**Scene graph for active tornadoes:**

```
tornadoGroup: THREE.Group          <-- new, added to scene in constructor
  |-- tornado_0: THREE.Group       <-- cloned from template, added on spawn
  |     |-- mesh (from GLTF)
  |     |-- glowLight: THREE.PointLight (optional, subtle blue-white)
  |-- tornado_1: THREE.Group
  |-- tornado_2: THREE.Group
  |-- tornado_3: THREE.Group       <-- max 4 in Phase 3
```

**Lifecycle management:**

The renderer maintains a `Map<number, TornadoRenderData>` keyed by tornado entity ID. Each entry holds:

```typescript
interface TornadoRenderData {
  group: THREE.Group;          // the cloned scene graph node
  prevPos: { x: number; y: number };  // for interpolation
  currentPos: { x: number; y: number };
}
```

On each tick, the renderer compares the simulation's active tornado list against its map:

1. **New tornado in simulation, not in map** -- Clone template, add to `tornadoGroup`, create map entry.
2. **Tornado in both** -- Update `prevPos = currentPos`, set `currentPos` from simulation. Material/animation updates if needed.
3. **Tornado in map, not in simulation** -- Remove from `tornadoGroup`, dispose material instances (geometry is shared, not disposed), delete from map.

This is the same create/update/remove pattern already used for projectile meshes in `updateProjectiles()`, extended to a more complex entity type.

**Position interpolation:**

Tornadoes move 1 tile per tick. Between ticks, the renderer interpolates their position using the same `lerp(prevPos, currentPos, tickProgress)` pattern used for the player:

```typescript
private updateTornadoes(sim: GameSimulation, tickProgress: number): void {
  const activeTornadoes = sim.tornadoes; // new field on GameSimulation

  // Spawn/despawn sync
  const activeIds = new Set(activeTornadoes.map(t => t.id));

  for (const tornado of activeTornadoes) {
    let data = this.tornadoRenderMap.get(tornado.id);
    if (!data) {
      data = this.spawnTornadoMesh(tornado);
      this.tornadoRenderMap.set(tornado.id, data);
    }

    // Interpolate position
    const prev = tileToWorld(data.prevPos.x, data.prevPos.y);
    const curr = tileToWorld(tornado.pos.x, tornado.pos.y);
    data.group.position.set(
      lerp(prev.x, curr.x, tickProgress),
      0,
      lerp(prev.z, curr.z, tickProgress),
    );
  }

  // Remove despawned
  for (const [id, data] of this.tornadoRenderMap) {
    if (!activeIds.has(id)) {
      this.tornadoGroup.remove(data.group);
      this.disposeTornadoMesh(data.group);
      this.tornadoRenderMap.delete(id);
    }
  }
}
```

**Tornado rotation animation:**

The tornado mesh should spin continuously. This is a pure visual effect, independent of the simulation. Each cloned tornado group gets a per-frame Y-axis rotation in the render loop:

```typescript
data.group.rotation.y += dt * 3.0; // ~3 radians/second
```

If the GLTF contains morph-target animations (spinning frames), an `AnimationMixer` per tornado instance can play them instead. Given the small vertex count (218), per-instance mixers are cheap.

### Simulation Data Contract

The renderer needs two new data sources from `GameSimulation`:

1. **Tile states** -- A way to read the hazard state of each tile. Proposed: `sim.arena.getTileState(x, y): 'safe' | 'warning' | 'hazard'` or a flat array `sim.arena.tileStates`.

2. **Active tornadoes** -- A list of tornado entities with position and ID. Proposed: `sim.tornadoes: Tornado[]` where each `Tornado` has `{ id: number, pos: Position, prevPos: Position }`.

Neither of these requires Three.js in the simulation. The `Tornado` entity is a plain data class like `Boss` or `Player`, holding only tile coordinates, an ID, a lifespan counter, and movement logic. The renderer transforms these into 3D scene operations.

**The `processTick()` integration points:**

The simulation's `processTick()` in `GameSimulation.ts` currently has 9 steps. Two new steps are needed:

- **Step 3.5: Tornado movement** -- After player movement (step 3) and before projectile resolution (step 4). Each tornado moves 1 tile toward the player using `findNextStep()`. Tornado-player overlap is checked for damage.
- **Step 3.25: Floor tile state update** -- After player movement. The tile system advances its state machine (safe -> warning -> hazard cycle). Damage is applied to the player if standing on an active hazard tile.

The renderer does not care about the ordering of these simulation steps. It only reads the final state after `processTick()` completes.

---

## Use Cases

1. **Tile transitions to warning** -- Simulation sets `tileStates[y][x] = 'warning'`. On the next `draw()` call, `updateFloorTiles()` reads the state, sets the tile's material `emissive` to `0xff8800` and `emissiveIntensity` to `0.4`. The orange glow appears immediately at the start of the next tick. The per-frame pulse sine wave makes the glow breathe subtly.

2. **Tile transitions to hazard** -- Simulation sets `tileStates[y][x] = 'hazard'`. Material updates to bright red emissive (`0xff2200`, intensity `0.8`). Player standing on this tile takes 10-20 damage per tick (handled by simulation, damage visualized as hit splats by existing system).

3. **Tile returns to safe** -- Simulation sets `tileStates[y][x] = 'safe'`. Material resets to `0x1a0a0a` with no emissive. The tile looks identical to the original dark floor.

4. **Boss summons 2 tornadoes (Phase 1 HP)** -- `Boss.fireAttack()` returns a tornado summon instead of a ranged/magic attack. Simulation creates 2 `Tornado` entities near the boss position, adds them to `sim.tornadoes[]`. Renderer's `updateTornadoes()` detects 2 new IDs, clones the GLTF template twice, adds both to `tornadoGroup`. They appear at the boss's feet.

5. **Tornadoes chase player** -- Each tick, the simulation moves each tornado 1 tile toward the player via pathfinding. The renderer reads updated positions and interpolates movement. The tornadoes visually glide across the floor at half the player's run speed. Their continuous Y-axis rotation gives the spinning visual.

6. **Multiple tornadoes on screen** -- Phase 3 (boss HP 1-332) spawns 4 tornadoes. The scene graph has 4 cloned groups under `tornadoGroup`. All 4 interpolate independently. The shared geometry means GPU memory is ~218 verts total (not 218 x 4). Material instances are separate but lightweight.

7. **Tornadoes despawn after 20 ticks** -- Simulation removes the tornado from `sim.tornadoes[]` after its lifespan expires. Renderer detects the missing ID, removes the group from the scene, disposes materials.

8. **Player walks through warning tiles to avoid tornadoes** -- The visual feedback is critical here: warning tiles glow orange, so the player can see which tiles will become dangerous. Tornadoes are visible 3D meshes approaching. The player must navigate between orange warning tiles and incoming tornadoes -- the rendering must make both hazards clearly distinguishable.

9. **Phase 3 safe tiles** -- Certain tiles are marked as permanently safe by the simulation. The renderer never changes their material from the default dark state. The player can identify these as refuge zones.

10. **GLTF load failure fallback** -- If `tornado.gltf` fails to load (missing file, network error), the renderer falls back to a procedural tornado mesh: a `ConeGeometry` (inverted, wide at top) with semi-transparent swirling material. This matches the GLTF fallback pattern established for the boss model.

---

## Implementation

### Phase 1: Floor Tile Mesh Restructure

Replace the single floor plane with 144 individual tile meshes.

| File | Action | Description |
|---|---|---|
| `src/render/Renderer3D.ts` | Modify | Replace `createFloor()` to generate 144 `PlaneGeometry(1, 1)` meshes, each with its own `MeshStandardMaterial`. Store materials in a `tileMaterials: MeshStandardMaterial[][]` 2D array (indexed `[y][x]`). Position each mesh at `tileToWorld(x, y)` with `rotation.x = -Math.PI/2` and `y = -0.01`. Keep the grid `LineSegments` overlay unchanged. Add all tile meshes to a new `floorGroup: THREE.Group`. |

### Phase 2: Tile State Data in Simulation

Add per-tile state tracking to the arena/simulation.

| File | Action | Description |
|---|---|---|
| `src/world/Arena.ts` | Modify | Add `tileStates: TileState[][]` property (initialized to all `'safe'`). Add `TileState = 'safe' \| 'warning' \| 'hazard'` type. Add `getTileState(x, y): TileState` accessor. Add `setTileState(x, y, state: TileState)` mutator. |
| `src/world/FloorHazardSystem.ts` | Create | Manages the tile cycling logic. Constructor takes the arena dimensions. `tick(bossHp: number, rng: Rng): void` advances the state machine -- selects tile groups based on HP phase, transitions them through safe -> warning -> hazard -> safe. Tracks per-tile countdown timers. Exposes no Three.js types. |
| `src/engine/GameSimulation.ts` | Modify | Create a `FloorHazardSystem` instance. Call `floorHazardSystem.tick()` during `processTick()` after player movement (new step 3.25). Apply hazard damage to the player if `arena.getTileState(player.pos.x, player.pos.y) === 'hazard'`: `rng.nextInt(10, 20)` damage, create hit splat. |

### Phase 3: Floor Tile Rendering

Wire the simulation tile states to the 3D tile materials.

| File | Action | Description |
|---|---|---|
| `src/render/Renderer3D.ts` | Modify | Add `updateFloorTiles(sim: GameSimulation, tickProgress: number)` method. Iterates `tileMaterials[y][x]`, reads `sim.arena.getTileState(x, y)`, applies the color/emissive/intensity mapping from the table above. Applies the pulse sine wave for warning and hazard tiles using `tickProgress`. Call this from `draw()` after `updateBoss()`. |

### Phase 4: Tornado Entity in Simulation

Add the Tornado entity and spawn/movement logic.

| File | Action | Description |
|---|---|---|
| `src/entities/Tornado.ts` | Create | Plain data class: `id: number`, `pos: Position`, `prevPos: Position`, `ticksRemaining: number` (starts at 20), `move(playerPos: Position, arena: Arena, boss: Boss): void` which calls `findNextStep()` to step 1 tile toward the player. |
| `src/engine/GameSimulation.ts` | Modify | Add `tornadoes: Tornado[]` array. In `processTick()` step 3.5 (after player movement): iterate `tornadoes`, call `tornado.move()`, decrement `ticksRemaining`, remove expired (ticksRemaining <= 0). Check tornado-player overlap and apply damage by armor tier. In step 5 (boss AI): when `fireAttack()` yields a tornado summon, create N tornado entities near the boss position (N based on HP range table from INTENT). |
| `src/entities/Boss.ts` | Modify | `fireAttack()` must sometimes return a tornado summon instead of ranged/magic. Add `'tornado'` to the `AttackStyle` type or introduce a separate mechanism. The tornado summon counts as one of the 4 attacks in the rotation. The boss still cycles ranged/magic on the 4-attack boundary -- the tornado replaces one attack slot, not the entire cycle. |

### Phase 5: Tornado GLTF Loading and Rendering

Load the tornado model and manage instances in the scene graph.

| File | Action | Description |
|---|---|---|
| `src/render/Renderer3D.ts` | Modify | Add `tornadoTemplate: THREE.Group \| null`, `tornadoGroup: THREE.Group`, `tornadoRenderMap: Map<number, TornadoRenderData>`. Add `loadTornadoGLTF()` called during construction (parallel with boss GLTF load). Add `createFallbackTornadoMesh(): THREE.Group` that builds an inverted cone with semi-transparent cyan material as fallback. Add `updateTornadoes(sim, tickProgress)` method implementing the spawn/update/remove lifecycle described above. Add per-frame Y-axis rotation for spinning. Call `updateTornadoes()` from `draw()`. |

### Phase 6: Tornado Spawn Integration with Boss Rotation

Wire the tornado summon into the boss attack cycle.

| File | Action | Description |
|---|---|---|
| `src/entities/types.ts` | Modify | Extend `AttackStyle` to include `'tornado'` if using the type union approach, or add a separate `SpecialAttack` type. |
| `src/engine/GameSimulation.ts` | Modify | In the boss attack handling (step 5), when `bossAttackStyle === 'tornado'`, skip projectile creation. Instead, spawn tornado entities. The number of tornadoes is determined by the boss HP range table. Tornadoes spawn at tiles adjacent to the boss (random offsets from boss center using seeded RNG). |

### Phase 7: Visual Polish

Refine the visual quality of both systems.

| File | Action | Description |
|---|---|---|
| `src/render/Renderer3D.ts` | Modify | Add subtle `PointLight` to each tornado clone (low intensity, cool blue-white tint, short range) so tornadoes cast localized light on the floor tiles around them. Add a thin semi-transparent `RingGeometry` shadow under each tornado for ground contact. For hazard tiles, consider adding a faint red `PointLight` at ground level for tiles in the hazard state (optional, test performance with 20+ hazard tiles). Ensure warning orange and hazard red are clearly distinguishable from the boss style indicator ring colors (green for ranged, purple for magic). |

---

## Files Summary

| File | Action | Phase |
|---|---|---|
| `src/render/Renderer3D.ts` | Modify | 1, 3, 5, 7 |
| `src/world/Arena.ts` | Modify | 2 |
| `src/world/FloorHazardSystem.ts` | Create | 2 |
| `src/engine/GameSimulation.ts` | Modify | 2, 4, 6 |
| `src/entities/Tornado.ts` | Create | 4 |
| `src/entities/Boss.ts` | Modify | 4 |
| `src/entities/types.ts` | Modify | 6 |

**Modified files:** 4 | **New files:** 2

---

## Definition of Done

1. **Floor tiles render individually** -- The 12x12 floor is composed of 144 separate tile meshes, each independently colorable. Visual appearance is identical to the current single-plane floor when all tiles are in the safe state.
2. **Warning tiles glow orange** -- When the simulation sets a tile to `'warning'`, the tile emits an orange glow (`emissiveIntensity ~0.4`). The glow pulses subtly with a sine wave.
3. **Hazard tiles glow bright red** -- When the simulation sets a tile to `'hazard'`, the tile emits a bright red glow (`emissiveIntensity ~0.8`). Clearly more intense than warning.
4. **Tile states reset cleanly** -- A tile returning to `'safe'` reverts to the dark default with no residual glow.
5. **Tornado GLTF loads successfully** -- The tornado model at `public/models/tornado.gltf` loads and renders at correct scale relative to the arena tiles (roughly 1 tile footprint).
6. **Tornado fallback works** -- If the GLTF fails to load, a procedural cone mesh is used instead.
7. **Multiple tornadoes render simultaneously** -- 2, 3, or 4 tornadoes appear in the scene at once depending on boss HP phase. Each has its own interpolated position and spinning rotation.
8. **Tornadoes spawn near the boss** -- Newly created tornadoes appear at tile positions adjacent to the boss center.
9. **Tornadoes interpolate smoothly** -- Tornado movement between tiles is visually smooth via `lerp(prevPos, pos, tickProgress)`, matching player movement interpolation.
10. **Tornadoes despawn cleanly** -- After 20 ticks, tornado meshes are removed from the scene graph and their materials are disposed. No memory leaks from repeated spawn/despawn cycles.
11. **Tornado-player overlap is visually unambiguous** -- A tornado occupying the same tile as the player is clearly visible (tornado mesh renders around/above the player mesh).
12. **Floor tile colors are distinct from other indicators** -- Warning orange and hazard red do not visually conflict with the boss style indicator ring (green/purple) or projectile colors.
13. **All existing tests pass** -- No regressions to the 155 existing tests.
14. **Scene graph cleanup on fight end** -- `dispose()` removes all tornado meshes and resets all tile materials.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| 144 individual tile meshes cause draw call overhead | Medium | Three.js batches same-material meshes, but each tile has a unique material instance. If draw calls exceed ~200 (tiles + entities + projectiles), use `THREE.InstancedMesh` with per-instance color attributes instead. Benchmark with 144 tiles + 4 tornadoes + projectiles first -- modern GPUs handle 300+ draw calls at 60fps easily for this scene complexity. |
| Tornado GLTF model scale/orientation mismatch | Medium | The tornado model (218 verts) may use different coordinate conventions than the Hunlef model. Calibrate `TORNADO_SCALE` by visual comparison: the tornado should be roughly 1 tile wide and 2-3 tiles tall. The boss model used `5 / 675` as its scale factor; the tornado will need its own constant tuned from the model's vertex bounds. |
| `clone()` on the GLTF scene does not deep-copy morph targets correctly | Low | `Object3D.clone()` shares geometry by reference and creates new materials. If the tornado GLTF has morph-target animations, cloned meshes sharing geometry may interfere with each other's morph weights. Mitigation: clone the geometry too (`mesh.geometry = mesh.geometry.clone()`) if morph targets are present, or use separate `AnimationMixer` instances per clone. |
| Tile pulse animation causes visual noise | Low | The sine wave pulse is subtle (0.8-1.0 range). If it is distracting, remove it and use static emissive values. The visual difference between warning and hazard is already clear from the color difference (orange vs red). |
| Tornado movement interpolation shows popping at spawn | Low | On the first tick after spawn, `prevPos === pos` (no previous position), so interpolation is a no-op and the tornado appears stationary. On tick 2 it begins moving. This is correct behavior -- tornadoes materialize in place before chasing. |
| Floor hazard system interaction with boss stomp | Low | The stomp check (step 7 in `processTick()`) runs after floor damage (step 3.25). A player standing on the boss AND on a hazard tile takes both stomp and floor damage. This is correct per OSRS mechanics but should be verified. |
| Scope creep from tornado animation complexity | Medium | The tornado mesh is simple (218 verts). If the GLTF contains complex multi-clip animations, keep it to a single looping spin. The Y-axis rotation fallback is visually sufficient and avoids per-instance `AnimationMixer` overhead. Only add per-instance mixers if the GLTF spin animation looks significantly better than procedural rotation. |

---

## Open Questions

1. **Should tornado spawn positions be deterministic or random?** The INTENT says "spawn near the boss." If positions are seeded-random offsets from the boss center, the renderer just reads the final positions. If they always spawn at fixed positions (e.g., the 4 corners of the boss footprint), the pattern is predictable. Recommendation: seeded-random offsets within 2 tiles of the boss center, consistent with the deterministic RNG pattern used throughout.

2. **Should floor tile group patterns be hardcoded or procedural?** The INTENT says "tiles activate in patterns/groups, not all at once." Options: (a) predefined patterns (checkerboard, rows, quadrants) cycled through, (b) seeded-random clusters of N tiles. Recommendation: start with seeded-random clusters for variety, but the renderer does not care -- it reads whatever states the simulation sets.

3. **Should tornado meshes cast shadows?** Three.js shadow maps add rendering cost. The current scene has no shadow-casting objects. Adding shadows for tornadoes only (not the boss or player) would look inconsistent. Recommendation: no shadows for now. The `PointLight` and ground ring provide sufficient grounding. Shadows are a future visual polish item.

4. **How should the "safe tile" concept in Phase 3 be visualized?** Phase 3 HP range introduces permanently safe tiles. Options: (a) they look identical to normal safe tiles (implicit -- the player learns which tiles never light up), (b) a subtle green or blue tint to mark them as safe zones. Recommendation: subtle visual distinction. A faint `emissive: 0x003300` (dark green) with `emissiveIntensity: 0.15` on safe tiles during Phase 3 provides a gentle hint without being garish.

5. **Should the tornado summon replace a specific attack in the 4-attack rotation, or can it occur at any slot?** The INTENT says it "counts as one attack." If the boss is on attack 2 of 4 (ranged) and summons tornadoes, does attack 3 continue as ranged, or does the counter advance as if a normal attack fired? Recommendation: the tornado summon advances `attackCounter` by 1, same as `fireAttack()`. The boss's ranged/magic cycle is unaffected.
