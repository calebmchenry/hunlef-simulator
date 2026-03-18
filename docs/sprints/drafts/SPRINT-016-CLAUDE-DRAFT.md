# Sprint 016: Tornado Visibility & True Tile Indicators

## Overview

Two related visual improvements to the 3D renderer:

1. **Tornado visibility:** Tornadoes are currently rendered at 0.4 scale (GLTF or cone fallback) and blend into the floor, especially when floor hazard overlays are active. Increase their size, add a colored ground marker, and apply a vertical offset so they float visibly above floor overlays.

2. **True tile indicators:** Add OSRS-style "true tile" ground highlights for the player, boss, and tornadoes. These flat colored tile outlines render at the entity's actual game-logic `pos` (integer tile coordinates), snapping each tick — never interpolated — so users can distinguish the server-side tile from the smoothly-interpolated visual position.

**Approach:** Extend `Renderer3D` with new tile-overlay meshes reusing the existing `PlaneGeometry` + `MeshBasicMaterial` pattern established by floor hazard overlays and `targetTileIndicator`. No new files needed — all changes are contained in `Renderer3D.ts`.

## Use Cases

1. **Tornado tracking:** Player can immediately spot all active tornadoes during gameplay, even when they overlap floor hazard tiles
2. **Player true tile:** A yellow tile outline on the ground shows the player's actual game-logic tile, distinct from the interpolated visual position — critical for prayer flicking, 1-tick movement, and tile-precise dodging
3. **Boss true tile:** A red/orange highlight covers the boss's 5x5 footprint at `boss.pos`, helping players judge melee range and safe tiles
4. **Tornado true tiles:** Cyan/white tile markers at each `tornado.pos` show exact danger zones, complementing the improved tornado model visibility
5. **Movement clarity:** During player movement, the true tile snaps to the destination tile on the tick it changes, while the model smoothly lerps — the gap between the two teaches the player about tick-based movement
6. **Overlapping entities:** When a tornado sits on a hazard tile, both the hazard overlay and the tornado true tile are visible (different Y heights and colors)

## Architecture

### Tornado Visibility Improvements

Three changes to make tornadoes more visible:

| Change | Current | New | Why |
|--------|---------|-----|-----|
| Scale | 0.4 | 0.8 | Double the visual footprint — tornadoes currently appear smaller than a single tile |
| Y offset | 0 (ground level) | 0.3 | Float above floor overlays so tornadoes aren't hidden by hazard tiles |
| Spin speed | `dt * 3` | `dt * 5` | Faster spin draws the eye more effectively |

These are applied in `loadTornadoGLTF()` (scale) and `updateTornadoes()` (Y offset, spin). The cone fallback gets the same scale increase.

### True Tile Indicator System

True tiles follow the existing pattern of `targetTileIndicator` (ring on ground) and `tileOverlays` (floor hazard planes). Each entity type gets a distinct color and rendering approach:

| Entity | Color | Style | Size | Y-height | Renders at |
|--------|-------|-------|------|----------|------------|
| Player | `0xffff00` (yellow) | Tile border (ring/outline) | 1x1 tile | 0.025 | `player.pos` |
| Boss | `0xff4444` (red) | Semi-transparent filled rectangle | 5x5 tiles | 0.015 | `boss.pos` (SW corner) covering full footprint |
| Tornado | `0x00ffff` (cyan) | Semi-transparent filled square | 1x1 tile each | 0.03 | `tornado.pos` for each active tornado |

**Y-height layering** (bottom to top):
1. Floor mesh: `-0.01`
2. Grid lines: `0.01`
3. Boss true tile: `0.015` (below hazards so hazard visibility is preserved)
4. Floor hazard overlays: `0.02`
5. Player true tile: `0.025` (above hazards so player position is always visible)
6. Target tile indicator: `0.02` (existing)
7. Tornado true tiles: `0.03` (above everything — danger visibility is critical)

**Color rationale:** Matches RuneLite true-tile plugin conventions (yellow = player, cyan = NPC/target). Red for boss distinguishes the large footprint from tornado tiles.

### Player True Tile

A tile-sized square outline (not filled) at the player's game-logic position. Uses `RingGeometry` with inner/outer radii forming a square border (4 segments, like the existing `targetTileIndicator`).

- Created once in the constructor
- Updated every frame in a new `updateTrueTiles()` method
- Position set to `tileToWorld(player.pos.x, player.pos.y)` — **no interpolation**

### Boss True Tile

A single 5x5-tile rectangle (filled, semi-transparent red) at the boss footprint.

- Uses a `PlaneGeometry(5, 5)` — one mesh, not 25 individual tiles
- Position set to `entityCenterToWorld(boss.pos.x, boss.pos.y, boss.size)`
- The boss doesn't move, so this is static, but positioning it dynamically costs nothing and keeps the code uniform

### Tornado True Tiles

One 1x1 tile square (filled, semi-transparent cyan) per active tornado.

- Uses a pool pattern matching the existing `tornadoMeshPool` / `activeTornadoMeshes`
- Separate pool: `tornadoTileMeshPool` / `activeTornadoTileMeshes`
- Position set to `tileToWorld(tornado.pos.x, tornado.pos.y)` — **no interpolation**, snaps each tick
- Geometry shared: single `PlaneGeometry(1, 1)` instance, same as `tileOverlayGeometry`

## Implementation

### Phase 1: Tornado Visibility (~20% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `loadTornadoGLTF()` (L374-396): change tornado scale from `0.4` to `0.8` in both the GLTF success path (L380) and the cone fallback path (L390)
- [ ] In `updateTornadoes()` (L954-995): change the Y position from `0` to `0.3` so tornadoes float above floor overlays:
  ```typescript
  mesh.position.set(
    lerp(prevWorld.x, currWorld.x, tickProgress),
    0.3,  // was 0
    lerp(prevWorld.z, currWorld.z, tickProgress),
  );
  ```
- [ ] In `updateTornadoes()`: increase spin speed from `dt * 3` to `dt * 5`

### Phase 2: True Tile Infrastructure (~25% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Add new instance fields for true tile meshes:
  ```typescript
  // True tile indicators
  private playerTrueTile: THREE.Mesh;
  private bossTrueTile: THREE.Mesh;
  private tornadoTileMeshPool: THREE.Mesh[] = [];
  private activeTornadoTileMeshes: THREE.Mesh[] = [];
  private trueTileMaterials = {
    player: new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    boss: new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    tornado: new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  ```
- [ ] In constructor, create player true tile mesh (tile-sized outline using `RingGeometry`):
  ```typescript
  // Player true tile — yellow square outline
  const playerTileGeo = new THREE.RingGeometry(0.42, 0.5, 4);
  this.playerTrueTile = new THREE.Mesh(playerTileGeo, this.trueTileMaterials.player);
  this.playerTrueTile.rotation.x = -Math.PI / 2;
  this.playerTrueTile.rotation.z = Math.PI / 4; // rotate 45° so ring corners align with tile corners
  this.playerTrueTile.position.y = 0.025;
  this.playerTrueTile.visible = false;
  this.scene.add(this.playerTrueTile);
  ```
- [ ] In constructor, create boss true tile mesh (filled 5x5 rectangle):
  ```typescript
  // Boss true tile — red filled rectangle
  const bossTileGeo = new THREE.PlaneGeometry(5, 5);
  this.bossTrueTile = new THREE.Mesh(bossTileGeo, this.trueTileMaterials.boss);
  this.bossTrueTile.rotation.x = -Math.PI / 2;
  this.bossTrueTile.position.y = 0.015;
  this.bossTrueTile.visible = false;
  this.scene.add(this.bossTrueTile);
  ```

### Phase 3: True Tile Update Logic (~30% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Add `updateTrueTiles(sim: GameSimulation)` method:
  ```typescript
  private updateTrueTiles(sim: GameSimulation): void {
    // Player true tile — snap to game-logic tile, no interpolation
    if (sim.state === 'running' || sim.state === 'won' || sim.state === 'lost') {
      const playerWorld = tileToWorld(sim.player.pos.x, sim.player.pos.y);
      this.playerTrueTile.position.set(playerWorld.x, 0.025, playerWorld.z);
      this.playerTrueTile.visible = true;
    } else {
      this.playerTrueTile.visible = false;
    }

    // Boss true tile — snap to boss footprint center
    if (sim.state === 'running' || sim.state === 'countdown') {
      const bossCenter = entityCenterToWorld(sim.boss.pos.x, sim.boss.pos.y, sim.boss.size);
      this.bossTrueTile.position.set(bossCenter.x, 0.015, bossCenter.z);
      this.bossTrueTile.visible = true;
    } else {
      this.bossTrueTile.visible = sim.state !== 'won'; // hide when boss dies
    }

    // Tornado true tiles — one per active tornado, pooled
    const tornadoes = sim.tornadoes;

    // Return excess tile meshes to pool
    while (this.activeTornadoTileMeshes.length > tornadoes.length) {
      const mesh = this.activeTornadoTileMeshes.pop()!;
      mesh.visible = false;
      this.scene.remove(mesh);
      this.tornadoTileMeshPool.push(mesh);
    }

    for (let i = 0; i < tornadoes.length; i++) {
      let tileMesh: THREE.Mesh;
      if (i < this.activeTornadoTileMeshes.length) {
        tileMesh = this.activeTornadoTileMeshes[i];
      } else {
        // Get from pool or create new
        if (this.tornadoTileMeshPool.length > 0) {
          tileMesh = this.tornadoTileMeshPool.pop()!;
        } else {
          tileMesh = new THREE.Mesh(this.tileOverlayGeometry, this.trueTileMaterials.tornado);
          tileMesh.rotation.x = -Math.PI / 2;
        }
        this.scene.add(tileMesh);
        this.activeTornadoTileMeshes.push(tileMesh);
      }

      // Snap to game-logic tile — no interpolation
      const world = tileToWorld(tornadoes[i].pos.x, tornadoes[i].pos.y);
      tileMesh.position.set(world.x, 0.03, world.z);
      tileMesh.visible = true;
    }
  }
  ```
- [ ] Call `this.updateTrueTiles(sim)` in the `draw()` method, after `updateFloorTiles()` and before `updateTornadoes()`:
  ```typescript
  this.updateFloorTiles(sim);
  this.updateTrueTiles(sim);  // new
  this.updateTornadoes(sim, tickProgress, dt);
  ```

### Phase 4: Validation (~25% of effort)

- [ ] `npm run build` — no TypeScript errors
- [ ] `npm test` — all existing tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass (never modify cg-sim-player)
- [ ] Visual: tornadoes are clearly visible, noticeably larger, floating above floor
- [ ] Visual: player yellow true tile outline visible at player.pos, snaps each tick
- [ ] Visual: boss red true tile covers full 5x5 footprint
- [ ] Visual: tornado cyan true tiles snap to tornado.pos each tick (distinct from interpolated model position)
- [ ] Visual: true tiles visible over floor hazard overlays (correct Y layering)
- [ ] Visual: multiple tornadoes each have their own true tile
- [ ] Performance: 30+ fps with 4 tornadoes + 3 true tile indicator types active

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/render/Renderer3D.ts` | Modify | Tornado scale/offset changes, true tile indicator meshes, materials, pooling, `updateTrueTiles()` method, draw loop integration |

## Definition of Done

- [ ] Tornadoes are clearly visible during gameplay (scale 0.8, floated Y=0.3)
- [ ] Player true tile: yellow outline at `player.pos`, snaps each tick (no lerp)
- [ ] Boss true tile: red semi-transparent 5x5 rectangle at `boss.pos`, covers full footprint
- [ ] Tornado true tiles: cyan semi-transparent squares at each `tornado.pos`, snaps each tick
- [ ] True tiles use distinct colors (yellow / red / cyan)
- [ ] True tiles render at correct Y-heights (not obscured by floor hazards)
- [ ] Tornado true tiles pool correctly (grow/shrink as tornadoes spawn/despawn)
- [ ] True tiles not visible during countdown (except boss)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes all existing tests
- [ ] `cd ../cg-sim-player && npm test` passes all tests
- [ ] No frame rate regression below 30 fps

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| True tile Y-heights cause Z-fighting with floor hazard overlays | Medium | Low | Use `depthWrite: false` on all true tile materials; stagger Y-heights by 0.005-0.01 to avoid exact coplanar surfaces. Tune if artifacts appear. |
| RingGeometry with 4 segments doesn't look square enough | Low | Low | The existing `targetTileIndicator` uses RingGeometry(0.3, 0.48, 4) successfully. Apply 45° Z-rotation to align corners. If visual is poor, switch to EdgesGeometry on a PlaneGeometry. |
| Tornado scale 0.8 is too large / clips through walls | Low | Low | Tornadoes are 1-tile entities. Scale 0.8 fits within a tile. Can be tuned post-merge. |
| Performance with 4 tornado true tiles + 4 tornado models + hazard overlays | Very Low | Low | Each true tile is one PlaneGeometry mesh with shared material — negligible GPU cost. Pool pattern prevents allocation churn. |
| Boss true tile overlaps with style indicator ring | Low | Low | Boss true tile at Y=0.015, style ring at Y=0.03. Visually complementary (ring shows style, tile shows footprint). |

## Security Considerations

No security impact. All changes are visual rendering — new Three.js meshes and materials in the existing renderer. No new user inputs, network calls, or dependencies.

## Dependencies

- `three` v0.183.2 (already installed) — `PlaneGeometry`, `RingGeometry`, `MeshBasicMaterial`
- No new npm packages
- Never modify cg-sim-player

## Open Questions

1. **Player true tile style: outline vs filled?** This draft uses an outline ring (matching the existing `targetTileIndicator` pattern and RuneLite convention). A filled semi-transparent square is an alternative — simpler to implement but may obscure floor hazard overlays beneath it. Recommend outline.

2. **Should true tiles be toggleable?** This draft makes them always visible during gameplay. A UI toggle could be added in a future sprint if users find them distracting. Recommend always-on for MVP — they are essential for learning tick-based movement.

3. **Boss true tile during death animation?** This draft hides it when `sim.state === 'won'`. Could keep it visible. Recommend hiding since the fight is over.

4. **Tornado Y offset value (0.3)?** Chosen to clear the floor overlay Y-height (0.02) with headroom. If it looks too floaty, can reduce to 0.15. The key constraint is that the tornado model must not be hidden by floor overlays.

## MVP Scope Cuts (if sprint runs long)

Priority order of what to cut:
1. Cut boss true tile (least gameplay value — boss position is obvious from its model)
2. Cut tornado true tiles (tornado visibility improvements still help without true tiles)
3. Cut player true tile outline style — use simple filled square instead of ring geometry
4. **Absolute minimum:** Tornado scale + Y offset improvements only (no true tiles)
