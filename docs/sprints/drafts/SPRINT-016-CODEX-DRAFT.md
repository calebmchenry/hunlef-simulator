# Sprint 016: Tornado Visibility + True Tile Indicators

## Overview

Add a renderer-focused clarity pass for three entity types: player, Hunllef, and tornadoes. The core change is to render "true tiles" from game-logic positions (`pos`) instead of interpolated render positions (`prevPos -> pos`), while also making the tornado visual itself substantially easier to track over dark floor tiles and active floor hazards.

**What ships:** a snapped player true tile, a snapped 5x5 boss true tile, snapped tornado true tiles, a tornado readability pass in `Renderer3D`, explicit render layering above floor hazards, and pooling/reuse so the feature stays cheap with up to four tornadoes active.

**What's deferred:** settings UI to toggle true tiles, post-processing or particle-heavy tornado effects, changes to movement/combat logic, and any changes to the read-only validation project.

---

## Use Cases

1. **UC-1: Player true tile while moving** -- The player model continues to lerp smoothly between tiles, but a gold ground indicator stays snapped to `player.pos`, so the user can see the actual logic tile during running and path corrections.
2. **UC-2: Boss footprint clarity** -- Hunllef already renders at a stable position, but the player still needs to see the exact 5x5 occupied footprint. A distinct perimeter indicator shows the true occupied tiles derived from `boss.pos` and `boss.size`.
3. **UC-3: Tornado chase readability** -- Tornadoes remain visually obvious even when moving across warning/hazard tiles. The moving tornado mesh is brighter and larger, and a snapped tornado true tile shows the exact tile that deals contact damage.
4. **UC-4: Interpolation mismatch is explicit** -- When a tornado or the player is halfway between tiles visually, the true tile still snaps only on tick boundaries. This makes the logic/render distinction intentional instead of confusing.
5. **UC-5: Overlapping tornado tiles stay stable** -- If multiple tornadoes stack on one tile, the indicator should not flicker or z-fight. The tile remains visibly marked even if multiplicity is compressed into a single indicator.
6. **UC-6: Floor hazards stay readable** -- True tiles must sit above hazard overlays without covering most of the tile surface. Warning/hazard colors remain understandable underneath.
7. **UC-7: Existing indicators still work** -- The current player click target ring and boss style ring remain functional after true tiles are added.
8. **UC-8: No logic regression** -- Floor hazard timing, tornado chase behavior, and combat state are unchanged. This sprint is visual and representational, not a gameplay rewrite.

---

## Architecture

### Renderer-Only Boundary

This sprint should stay almost entirely inside `src/render/Renderer3D.ts`.

The current game state already exposes everything needed:

- `Player` has `pos` and `prevPos`
- `Tornado` has `pos` and `prevPos`
- `Boss` exposes `pos` and `size`
- `GameSimulation` already provides `sim.tornadoes`, `sim.player`, `sim.boss`, and `sim.floorHazardManager`
- `Renderer3D` already has `tileToWorld()`, `entityCenterToWorld()`, a ground-level target tile indicator, floor overlay planes, and tornado mesh pooling

No simulation-layer schema change is required to render true tiles. The only engine/render contract this sprint relies on is that `pos` remains integer tile coordinates representing logic state.

### True Tile Primitive

Do not use `THREE.LineBasicMaterial` as the primary tile outline primitive. WebGL line width support is inconsistent, and thin single-pixel lines will be hard to read on top of the existing floor.

Instead, build a reusable footprint indicator from flat meshes:

```ts
interface FootprintIndicator {
  root: THREE.Group;
  edgeMeshes: THREE.Mesh[];
  cornerMeshes: THREE.Mesh[];
  size: number;
}
```

Recommended construction:

- 4 flat edge strips made from `PlaneGeometry`
- 4 small corner caps so the outline is readable even when partially occluded by models
- `MeshBasicMaterial`
- `transparent: true`
- `depthWrite: false`
- `side: THREE.DoubleSide`
- `renderOrder` higher than floor hazards

Why mesh strips instead of a filled plane:

- the intent explicitly says true tiles must not obscure floor hazards
- an outline communicates tile occupancy with far less visual clutter
- a 5x5 boss footprint remains readable as a perimeter without painting 25 tiles solid

Recommended default colors:

| Entity | Color | Reason |
|------|------|------|
| Player | `#ffd24a` | Reads like a classic player true tile and contrasts well with the dark maroon floor |
| Boss | `#ff4f88` | Distinct from hazard red/orange and from the player tile |
| Tornado | `#dffcff` | Very bright and readable over warning/hazard colors |

### Snapped Positioning vs Interpolated Positioning

The renderer currently treats moving entities as interpolated visuals:

- player mesh lerps from `player.prevPos` to `player.pos`
- tornado meshes lerp from `tornado.prevPos` to `tornado.pos`
- boss mesh snaps directly from `boss.pos`

True tiles must deliberately ignore interpolation:

```ts
private updateTrueTiles(sim: GameSimulation): void {
  this.positionFootprint(this.playerTrueTileIndicator, sim.player.pos.x, sim.player.pos.y, 1);
  this.positionFootprint(this.bossTrueTileIndicator, sim.boss.pos.x, sim.boss.pos.y, sim.boss.size);

  for (const tornado of sim.tornadoes) {
    this.positionFootprint(indicator, tornado.pos.x, tornado.pos.y, 1);
  }
}
```

This is the main correctness rule for the sprint:

- model position may interpolate
- true tile position may not interpolate

The feature only works if those two representations visibly disagree during motion.

### Boss Footprint and Existing Style Ring

`Renderer3D` already renders `bossStyleIndicator` as a ring with radius `2.2 -> 2.5`, centered on the boss footprint. A true 5x5 perimeter also sits at `2.5` tiles from center, so the current ring geometry will visually collide with the boss true tile edge.

To avoid that conflict, slightly shrink the boss style ring so it lives inside the footprint indicator:

- current: `RingGeometry(2.2, 2.5, 32)`
- recommended: something closer to `RingGeometry(1.85, 2.15, 32)`

That keeps both signals:

- inner ring = current attack style
- outer perimeter = actual occupied footprint

### Tornado Visibility Pass

The current tornado render path has three visibility problems:

1. the GLTF template is scaled to `0.4`, which is small against a 1-tile world
2. the tornado loader does not reuse `applyUnlitMaterials()`, unlike the boss and player pipelines
3. the fallback cone is a dark gray `MeshLambertMaterial`, which blends into the current arena palette

The sprint should address all three.

Recommended tornado render treatment:

- increase template scale from `0.4` to roughly `0.65` or `0.7`
- run `applyUnlitMaterials()` on the loaded tornado scene so it does not depend on subtle scene lighting
- brighten/tint the fallback material toward pale cyan-white
- attach one lightweight aura element per tornado render instance

The aura should be cheap and local:

- preferred option: a shared `CanvasTexture` radial gradient on a `THREE.Sprite`
- sprite sits above the tornado at about `y = 0.8`
- low opacity, roughly `0.2 - 0.3`
- no particle emitters, no post-processing, no shader complexity

This improves first-glance detection without covering the floor tile underneath.

### Tornado True Tile Pooling and Overlap Handling

The renderer already pools tornado meshes. True tile indicators should use the same idea.

Recommended renderer state:

```ts
private playerTrueTileIndicator: THREE.Group;
private bossTrueTileIndicator: THREE.Group;
private tornadoTrueTilePool: THREE.Group[] = [];
private activeTornadoTrueTiles: THREE.Group[] = [];
```

Important edge case: multiple tornadoes can occupy the same tile.

Do not stack multiple identical indicators at the exact same `x/z/y`; that will z-fight. Instead:

1. Build a `Map<string, { x: number; y: number; count: number }>` from `sim.tornadoes`
2. Render one true tile indicator per occupied tile
3. Optionally increase opacity slightly when `count > 1`

This preserves accuracy of occupied tiles while staying visually stable.

### Render Layering

Current ground-level elements already sit close together:

- floor plane at `y = -0.01`
- grid lines at `y = 0.01`
- target tile ring at `y = 0.02`
- floor hazard overlays at `y = 0.02`
- boss style ring at `y = 0.03`

The sprint needs explicit layering rules:

- target tile ring remains lowest interactive overlay
- floor hazard overlays remain below true tiles
- true tiles sit slightly above hazard overlays
- boss style ring remains visible inside the boss footprint

Recommended Y offsets:

| Element | Y |
|------|------|
| Target tile ring | `0.02` |
| Floor hazard overlays | `0.02` |
| Player true tile | `0.028` |
| Boss true tile | `0.03` |
| Tornado true tile | `0.032` |
| Boss style ring | `0.034` or keep at `0.03` with higher `renderOrder` after shrinking radius |

`depthWrite` should be disabled on true tile materials so they layer cleanly with the floor and other transparent overlays.

### Draw Order Integration

Add a dedicated update method to `draw()`:

```ts
this.updateFloorTiles(sim);
this.updateTrueTiles(sim);
this.updateTornadoes(sim, tickProgress, dt);
```

The exact call order is less important than explicit render-order/material configuration, but grouping the ground overlays together keeps the renderer easier to reason about:

- floor overlays first
- snapped true tiles second
- moving tornado visuals third

### Cleanup and Resource Ownership

If the tornado aura uses a generated sprite texture or if true tiles introduce shared geometry/material objects, `dispose()` must be extended accordingly.

This sprint should not leak:

- shared true tile materials
- shared true tile geometries
- generated tornado aura textures
- any additional pooled objects still attached to the scene

---

## Implementation

### Phase 1: Add Reusable True Tile Indicators

**Files:**

- `src/render/Renderer3D.ts`
- optional new `src/render/trueTileHelpers.ts`

**Tasks:**

- [ ] Add true-tile constants near the existing render constants:
  - player color
  - boss color
  - tornado color
  - outline thickness
  - Y offsets
  - render orders
- [ ] Add a helper that builds a flat footprint outline from mesh strips instead of line primitives.
- [ ] Build one 1x1 indicator for the player in the constructor.
- [ ] Build one 5x5 indicator for the boss in the constructor.
- [ ] Preallocate four 1x1 tornado true tile indicators, matching the current maximum tornado count.
- [ ] Reuse shared geometry/material instances where possible so the feature adds minimal allocation overhead.
- [ ] Keep the implementation compatible with the current `tileToWorld()` and `entityCenterToWorld()` helpers.
- [ ] If `Renderer3D.ts` becomes too dense, extract pure helper functions such as:
  - `createFootprintIndicator(size, color, thickness)`
  - `positionFootprintIndicator(group, tileX, tileY, size)`
  - `collectTornadoOccupancy(tornadoes)`

### Phase 2: Wire True Tile Updates to Logic Positions

**Files:**

- `src/render/Renderer3D.ts`

**Tasks:**

- [ ] Add `updateTrueTiles(sim: GameSimulation): void`.
- [ ] Position the player true tile from `sim.player.pos`, never from interpolated player world coordinates.
- [ ] Position the boss true tile from `sim.boss.pos` and `sim.boss.size`, using `entityCenterToWorld()`.
- [ ] Aggregate tornado positions by tile key before rendering indicators.
- [ ] Hide unused tornado true tile groups when fewer than four unique occupied tiles exist.
- [ ] If multiple tornadoes stack on one tile, render one indicator for that tile and optionally increase opacity slightly for `count > 1`.
- [ ] Leave true tiles visible during countdown as long as the corresponding entity exists in the scene.
- [ ] Keep `targetTileIndicator` behavior unchanged; it represents a click destination, not the player true tile.

### Phase 3: Improve Tornado Visual Readability

**Files:**

- `src/render/Renderer3D.ts`

**Tasks:**

- [ ] Update `loadTornadoGLTF()` to reuse `applyUnlitMaterials()` on the tornado model.
- [ ] Raise tornado template scale from `0.4` to a more legible value, expected around `0.65 - 0.7`.
- [ ] Wrap the tornado template in a root group so every cloned instance can include:
  - the tornado model
  - one shared-material aura sprite
- [ ] Brighten the fallback cone path so it no longer uses a dark gray visual.
- [ ] In `updateTornadoes()` keep interpolation between `prevPos` and `pos`, but add slightly stronger motion cues:
  - faster spin than the current `dt * 3`
  - optional subtle vertical bob
- [ ] Keep the aura visually soft so it helps acquisition without becoming a fake tile marker.
- [ ] Preserve the existing mesh-pool approach and avoid per-frame creation of new sprites or groups.

### Phase 4: Resolve Indicator Interactions

**Files:**

- `src/render/Renderer3D.ts`

**Tasks:**

- [ ] Shrink the boss style ring radius so it no longer sits on the exact 5x5 perimeter.
- [ ] Set true tile materials to `depthWrite: false`.
- [ ] Assign explicit `renderOrder` values so transparent overlays remain deterministic.
- [ ] Validate that player true tile, target tile ring, floor hazard overlays, and tornado indicators can all occupy nearby tiles without unreadable overlap.
- [ ] Keep the boss style ring visually inside the boss footprint rather than competing with its boundary.

### Phase 5: Verification and Optional Render Tests

**Files:**

- `src/render/Renderer3D.ts`
- optional new `src/render/trueTileHelpers.ts`
- optional new `src/__tests__/trueTileHelpers.test.ts`

**Tasks:**

- [ ] If helper extraction was used, add pure tests for:
  - footprint center calculation for size `1` and size `5`
  - tornado occupancy dedupe
  - stable ordering/count behavior for tornado true tile pooling
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Manually verify:
  - player model can be between tiles while player true tile is snapped to the new tile
  - boss perimeter matches the exact 5x5 footprint
  - tornado true tiles snap on tick boundaries rather than lerping
  - tornado mesh remains obvious over warning and hazard tiles
  - overlapping tornadoes do not produce indicator flicker
  - target tile indicator still displays correctly
  - countdown, running, won, and lost states do not leave orphaned indicators
- [ ] Confirm no visible frame hitch when four tornadoes, floor hazards, true tiles, and projectiles are all active simultaneously.

---

## Files Summary

| File | Change | Why |
|---|---|---|
| `src/render/Renderer3D.ts` | Required | This sprint is primarily a renderer change: new true tile primitives, snapped update path, tornado visual pass, layering, and cleanup |
| `src/render/trueTileHelpers.ts` | Optional new file | Useful if the footprint builder and tornado occupancy logic need to be kept out of the already-large renderer |
| `src/__tests__/trueTileHelpers.test.ts` | Optional new file | Enables pure unit coverage for occupancy dedupe and footprint placement if helpers are extracted |
| `src/entities/Player.ts` | No change expected | Already exposes `pos` and `prevPos`, which are sufficient for a snapped player true tile |
| `src/entities/Boss.ts` | No change expected | Already exposes `pos` and `size`; the boss true tile is a render interpretation of existing logic state |
| `src/entities/Tornado.ts` | No change expected | Already exposes `pos` and `prevPos`, which are sufficient for distinct interpolated visuals and snapped true tiles |
| `src/world/FloorHazardManager.ts` | No change expected | Existing floor hazard tile state is only relevant as a layering/readability constraint |
| `src/engine/GameSimulation.ts` | No change expected | Current simulation data already provides the snapped positions the renderer needs |

This sprint should remain a low-blast-radius rendering feature. If engine changes start appearing, that is a sign the scope has drifted.

---

## Definition of Done

- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] Player true tile renders at `player.pos` and visibly snaps on tick boundaries.
- [ ] Boss true tile renders as a clear 5x5 footprint derived from `boss.pos` and `boss.size`.
- [ ] Tornado true tiles render at snapped tornado logic positions, not interpolated positions.
- [ ] Tornadoes are easier to spot than the current `0.4`-scale implementation even when floor hazards are active.
- [ ] Floor hazard overlays remain readable under true tile indicators.
- [ ] Boss style ring remains visible and no longer collides visually with the boss true tile perimeter.
- [ ] Multiple tornadoes on one tile do not cause indicator flicker or z-fighting.
- [ ] Existing target tile indicator behavior is unchanged.
- [ ] No per-frame geometry or material allocation is introduced for active tornadoes or true tile indicators.
- [ ] Four active tornadoes plus true tiles maintain acceptable performance in normal gameplay.
- [ ] No gameplay logic changes are required to support the feature.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The true tile outline is too subtle against hazard overlays | The feature exists but fails its core readability goal | Use mesh-strip outlines, not thin line primitives; tune color and opacity manually in live gameplay |
| The boss true tile visually collides with the existing boss style ring | The boss footprint becomes noisy and harder to parse | Shrink the style ring radius so it clearly lives inside the 5x5 perimeter |
| A tornado halo becomes another form of floor clutter | Tornadoes become brighter but the floor becomes harder to read | Keep the aura elevated on a sprite above the tornado rather than as a large ground fill |
| Overlapping tornado indicators z-fight | Stacked tornado situations flicker | Deduplicate indicators by occupied tile before rendering |
| `Renderer3D.ts` grows harder to maintain | Future render changes become brittle | Extract a tiny helper module if the footprint builder or occupancy code becomes noisy |
| Shared transparent materials sort poorly | Some overlays appear in the wrong order | Use explicit `renderOrder`, small Y separation, and `depthWrite: false` on true tiles |
| Tornado scale increase looks exaggerated at close camera angles | Improved visibility trades away visual proportion | Tune scale conservatively and validate with actual gameplay, not a static screenshot |

---

## Security

This sprint does not add auth, persistence, or new external network surfaces. The main security/integrity concern is keeping rendering inputs deterministic and local.

Security rules for this sprint:

- keep all model loading on fixed local paths under `/models`
- do not introduce user-controlled asset URLs
- if an aura sprite uses a generated `CanvasTexture`, generate it locally at runtime and reuse one shared texture
- avoid custom shaders or dynamic material code driven by user input
- keep the change renderer-only so gameplay state remains authoritative in simulation code

---

## Dependencies

- Existing Three.js primitives already used in `Renderer3D.ts`
- Existing `GLTFLoader` support for `/models/tornado.gltf`
- Existing `applyUnlitMaterials()` helper in `Renderer3D.ts`
- Existing `tileToWorld()` and `entityCenterToWorld()` coordinate helpers
- Existing `player.pos`, `player.prevPos`, `boss.pos`, `boss.size`, `tornado.pos`, and `tornado.prevPos`
- Existing floor hazard overlay implementation, which acts as the primary layering/readability constraint
- No new runtime packages are required
- No `cg-sim-player` changes are allowed or needed

---

## Open Questions

1. **Boss true tile color:** Should this prioritize RuneLite-style NPC red, or should it prioritize contrast against the existing hazard palette? Recommendation: prioritize contrast and use a saturated pink/magenta rather than hazard-adjacent red.
2. **Overlapping tornadoes:** Should multiple tornadoes on the same tile be shown as one stable indicator or should multiplicity be signaled visually? Recommendation: render one stable indicator per occupied tile and optionally boost opacity when `count > 1`.
3. **Toggle behavior:** Should true tiles always be on, or should a settings toggle be added? Recommendation: always on for Sprint 016; defer UI settings.
4. **Tornado readability scope:** Is scale/material/aura enough, or should the sprint include particle effects? Recommendation: stop at scale plus unlit materials plus a lightweight aura; do not add particles in this sprint.
5. **Indicator style:** Should the player and tornado true tiles be perimeter-only, or should they include a faint fill? Recommendation: perimeter-only by default, because floor hazard readability is a harder constraint than maximizing fill visibility.
6. **Countdown visibility:** Should true tiles render during countdown? Recommendation: yes, because they represent real entity positions and help establish the mechanic before combat starts.
