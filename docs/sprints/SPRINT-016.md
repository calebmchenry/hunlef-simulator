# Sprint 016: Tornado Visibility & True Tile Indicators

## Overview

Two related visual improvements to the 3D renderer:

1. **Tornado visibility:** Tornadoes are currently rendered at 0.4 scale and depend on scene lighting (the only GLTF loader that skips `applyUnlitMaterials()`). They blend into the floor, especially when floor hazard overlays are active. Fix by increasing scale, applying unlit materials for consistent brightness, and brightening the fallback cone.

2. **True tile indicators:** Add OSRS-style "true tile" ground outlines for the player, boss, and tornadoes. These are thin colored rectangular borders rendered at each entity's actual game-logic `pos` (integer tile coordinates), snapping each tick -- never interpolated -- so users can distinguish the server-side tile from the smoothly-interpolated visual position.

**Approach:** Extend `Renderer3D.ts` with outline-style tile indicators using `PlaneGeometry` edge strips (not `LineBasicMaterial`, which has inconsistent `lineWidth` across WebGL implementations). Reuse existing patterns: `tileToWorld()`, `entityCenterToWorld()`, floor overlay materials, and tornado mesh pooling. No new files needed.

## Use Cases

1. **Tornado tracking:** Player can immediately spot all active tornadoes during gameplay, even when they overlap floor hazard tiles -- tornadoes are larger, brighter, and lighting-independent
2. **Player true tile:** A yellow tile outline on the ground shows the player's actual game-logic tile, distinct from the interpolated visual position -- critical for prayer flicking, 1-tick movement, and tile-precise dodging
3. **Boss true tile:** A blue perimeter outline covers the boss's 5x5 footprint at `boss.pos`, helping players judge melee range and safe tiles
4. **Tornado true tiles:** White tile outlines at each `tornado.pos` show exact danger zones, complementing the improved tornado model visibility
5. **Movement clarity:** During player movement, the true tile snaps to the destination tile on the tick it changes, while the model smoothly lerps -- the gap between the two teaches the player about tick-based movement
6. **Interpolation mismatch is explicit:** When a tornado or the player is halfway between tiles visually, the true tile snaps only on tick boundaries, making the logic/render distinction intentional
7. **Overlapping entities:** Multiple tornadoes on the same tile render a single stable indicator (deduplicated), preventing z-fighting
8. **Floor hazard readability preserved:** Outline-only indicators allow floor hazard colors to show through the center of the tile
9. **Existing indicators still work:** The target tile ring and boss style ring remain functional and visually distinct

## Architecture

### True Tile Outline Primitive

Build tile indicators from flat mesh strips (`PlaneGeometry`) forming rectangular outlines:

```
createTileOutline(width, height, color, lineWidth = 0.06) -> THREE.Group
  ├── Top strip:    PlaneGeometry(width, lineWidth)
  ├── Bottom strip: PlaneGeometry(width, lineWidth)
  ├── Left strip:   PlaneGeometry(lineWidth, height)
  └── Right strip:  PlaneGeometry(lineWidth, height)
```

Each strip uses `MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false })`.

All true tile materials must have:
- `depthWrite: false` -- prevents depth-buffer conflicts with other overlays
- Explicit `renderOrder` values -- ensures deterministic layering regardless of camera angle (Three.js sorts transparent objects by distance, not Y position)

### Entity-Specific Configuration

| Entity | Color | Hex | Size | Renders at |
|--------|-------|-----|------|------------|
| Player | Yellow | `0xffff00` | 1x1 | `player.pos` |
| Boss | Blue | `0x4488ff` | 5x5 | `boss.pos` (SW corner), covers full footprint |
| Tornado | White | `0xffffff` | 1x1 | `tornado.pos` (deduplicated by tile) |

### Render Layering (Y-axis + renderOrder)

| Element | Y offset | renderOrder | Notes |
|---------|----------|-------------|-------|
| Floor plane | -0.01 | 0 | Dark background |
| Grid lines | 0.01 | 0 | Tile grid |
| Floor hazard overlays | 0.02 | 1 | Warning/hazard tiles |
| Target tile indicator | 0.025 | 2 | Player click destination |
| True tile indicators | 0.03 | 3 | Player/boss/tornado outlines |
| Boss style ring | 0.035 | 4 | Current attack style indicator |

### Boss Style Ring Adjustment

The existing `bossStyleIndicator` uses `RingGeometry(2.2, 2.5, 32)` which visually collides with a 5x5 perimeter outline (2.5 tiles from center). Shrink to `RingGeometry(1.8, 2.1, 32)` so the style ring sits clearly inside the boss true tile perimeter:

- Inner ring = current attack style (existing feature)
- Outer perimeter = actual occupied footprint (new true tile)

### Tornado Visibility Improvements

| Change | Current | New | Why |
|--------|---------|-----|-----|
| Scale | 0.4 | 0.7 | ~1.75x larger, fills more of the tile footprint |
| Materials | Scene-lighting dependent | `applyUnlitMaterials()` | Consistent brightness like boss/player models |
| Fallback cone | Gray `MeshLambertMaterial(0x888888)` | Bright `MeshBasicMaterial(0xccddff)` | Visible over dark floor, lighting-independent |
| Spin speed | `dt * 3` | `dt * 5` | Faster spin draws the eye |

### Tornado Overlap Deduplication

Multiple tornadoes can occupy the same tile. Rendering one indicator per tornado at the same position causes z-fighting. Instead:

1. Build a `Map<string, { x: number; y: number; count: number }>` from `sim.tornadoes`
2. Render one true tile indicator per unique occupied tile
3. Optionally increase opacity when `count > 1` (e.g., `0.8 + 0.15 * Math.min(count - 1, 1)`)

### Snapped vs Interpolated Positioning

This is the core correctness rule:
- **Model position**: interpolates between `prevPos` and `pos` using `tickProgress` (existing behavior)
- **True tile position**: snaps to `pos` only (new behavior) -- `tileToWorld(entity.pos.x, entity.pos.y)`, never lerped

The feature works precisely because these two representations visibly disagree during motion.

## Implementation

### Phase 1: Tornado Visibility (~20% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `loadTornadoGLTF()` success path (~L378-381): change scale from `0.4` to `0.7`, and call `applyUnlitMaterials()` on the loaded tornado scene (matching the boss/player GLTF loaders)
- [ ] In `loadTornadoGLTF()` fallback path (~L386-393): change the cone fallback to `MeshBasicMaterial({ color: 0xccddff })` (was `MeshLambertMaterial({ color: 0x888888 })`), change scale from `0.4` to `0.7`
- [ ] In `updateTornadoes()` (~L992): increase spin speed from `dt * 3` to `dt * 5`

### Phase 2: True Tile Outline Factory + Infrastructure (~25% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Add a private helper method `createTileOutline(width: number, height: number, color: number, lineWidth: number = 0.06): THREE.Group`:
  ```typescript
  private createTileOutline(w: number, h: number, color: number, lw: number = 0.06): THREE.Group {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const group = new THREE.Group();

    // Top and bottom strips
    const hGeo = new THREE.PlaneGeometry(w, lw);
    const top = new THREE.Mesh(hGeo, mat);
    top.position.set(0, 0, -h / 2 + lw / 2);
    top.rotation.x = -Math.PI / 2;
    group.add(top);
    const bottom = new THREE.Mesh(hGeo, mat);
    bottom.position.set(0, 0, h / 2 - lw / 2);
    bottom.rotation.x = -Math.PI / 2;
    group.add(bottom);

    // Left and right strips
    const vGeo = new THREE.PlaneGeometry(lw, h);
    const left = new THREE.Mesh(vGeo, mat);
    left.position.set(-w / 2 + lw / 2, 0, 0);
    left.rotation.x = -Math.PI / 2;
    group.add(left);
    const right = new THREE.Mesh(vGeo, mat);
    right.position.set(w / 2 - lw / 2, 0, 0);
    right.rotation.x = -Math.PI / 2;
    group.add(right);

    group.position.y = 0.03;
    group.renderOrder = 3;
    return group;
  }
  ```
- [ ] Add instance fields:
  ```typescript
  private playerTrueTile: THREE.Group;
  private bossTrueTile: THREE.Group;
  private tornadoTrueTilePool: THREE.Group[] = [];
  private activeTornadoTrueTiles: THREE.Group[] = [];
  ```
- [ ] In the constructor, create and add to scene:
  ```typescript
  // Player true tile - yellow 1x1 outline
  this.playerTrueTile = this.createTileOutline(1, 1, 0xffff00);
  this.playerTrueTile.visible = false;
  this.scene.add(this.playerTrueTile);

  // Boss true tile - blue 5x5 outline
  this.bossTrueTile = this.createTileOutline(5, 5, 0x4488ff);
  this.bossTrueTile.visible = false;
  this.scene.add(this.bossTrueTile);
  ```

### Phase 3: True Tile Update Logic + Tornado Dedup (~30% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Add `updateTrueTiles(sim: GameSimulation)` method:
  ```typescript
  private updateTrueTiles(sim: GameSimulation): void {
    const isActive = sim.state === 'running' || sim.state === 'won' || sim.state === 'lost';

    // Player true tile - snap to game-logic position
    if (isActive) {
      const pw = tileToWorld(sim.player.pos.x, sim.player.pos.y);
      this.playerTrueTile.position.set(pw.x, 0.03, pw.z);
      this.playerTrueTile.visible = true;
    } else {
      this.playerTrueTile.visible = false;
    }

    // Boss true tile - snap to 5x5 footprint center
    if (isActive && sim.state !== 'won') {
      const bc = entityCenterToWorld(sim.boss.pos.x, sim.boss.pos.y, sim.boss.size);
      this.bossTrueTile.position.set(bc.x, 0.03, bc.z);
      this.bossTrueTile.visible = true;
    } else {
      this.bossTrueTile.visible = false;
    }

    // Tornado true tiles - deduplicate by occupied tile
    const occupancy = new Map<string, { x: number; y: number; count: number }>();
    for (const t of sim.tornadoes) {
      const key = `${t.pos.x},${t.pos.y}`;
      const existing = occupancy.get(key);
      if (existing) {
        existing.count++;
      } else {
        occupancy.set(key, { x: t.pos.x, y: t.pos.y, count: 1 });
      }
    }

    const tiles = Array.from(occupancy.values());

    // Return excess to pool
    while (this.activeTornadoTrueTiles.length > tiles.length) {
      const g = this.activeTornadoTrueTiles.pop()!;
      g.visible = false;
      this.scene.remove(g);
      this.tornadoTrueTilePool.push(g);
    }

    for (let i = 0; i < tiles.length; i++) {
      let tileGroup: THREE.Group;
      if (i < this.activeTornadoTrueTiles.length) {
        tileGroup = this.activeTornadoTrueTiles[i];
      } else {
        if (this.tornadoTrueTilePool.length > 0) {
          tileGroup = this.tornadoTrueTilePool.pop()!;
        } else {
          tileGroup = this.createTileOutline(1, 1, 0xffffff);
        }
        this.scene.add(tileGroup);
        this.activeTornadoTrueTiles.push(tileGroup);
      }

      const tw = tileToWorld(tiles[i].x, tiles[i].y);
      tileGroup.position.set(tw.x, 0.03, tw.z);
      tileGroup.visible = true;
    }
  }
  ```
- [ ] Call `this.updateTrueTiles(sim)` in the `draw()` method after `updateFloorTiles()` and before `updateTornadoes()`:
  ```typescript
  this.updateFloorTiles(sim);
  this.updateTrueTiles(sim);  // new
  this.updateTornadoes(sim, tickProgress, dt);
  ```

### Phase 4: Indicator Interactions + Cleanup (~25% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Shrink the boss style ring from `RingGeometry(2.2, 2.5, 32)` to `RingGeometry(1.8, 2.1, 32)` (~L186-194) so it sits inside the boss true tile perimeter
- [ ] Set the boss style ring `renderOrder = 4` and ensure its Y offset is `0.035`
- [ ] Raise the existing `targetTileIndicator` Y from `0.02` to `0.025` and set `renderOrder = 2` (both in the constructor and in `updateTargetTile()`)
- [ ] Add `renderOrder = 1` to floor hazard overlay materials
- [ ] Extend `dispose()` to clean up true tile resources:
  ```typescript
  // In dispose():
  // Dispose true tile materials and geometries
  this.playerTrueTile.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
  this.bossTrueTile.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
  for (const g of [...this.activeTornadoTrueTiles, ...this.tornadoTrueTilePool]) {
    g.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
  ```
- [ ] Verify existing `targetTileIndicator` material has `depthWrite: false`; add if missing

### Phase 5: Validation

- [ ] `npm run build` -- no TypeScript errors
- [ ] `npm test` -- all existing tests pass
- [ ] `cd ../cg-sim-player && npm test` -- all tests pass (never modify cg-sim-player)
- [ ] Visual: tornadoes are clearly visible, larger, consistently bright over both light and dark floor areas
- [ ] Visual: fallback cone (if GLTF fails) is bright and visible
- [ ] Visual: player yellow true tile outline visible at `player.pos`, snaps each tick during movement
- [ ] Visual: boss blue true tile outline covers exact 5x5 footprint
- [ ] Visual: boss style ring is clearly inside the boss true tile perimeter
- [ ] Visual: tornado white true tiles snap to `tornado.pos` each tick
- [ ] Visual: multiple tornadoes on the same tile produce one stable indicator (no z-fighting)
- [ ] Visual: true tile outlines render above floor hazard overlays (correct layering)
- [ ] Visual: target tile indicator (click destination) still renders correctly
- [ ] Visual: true tiles not visible during countdown
- [ ] Performance: 30+ fps with 4 tornadoes + all true tile indicators + floor hazards active

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Tornado scale/material fixes, `createTileOutline()` factory, true tile indicator meshes + pooling, `updateTrueTiles()` method, boss style ring resize, target tile Y adjustment, `renderOrder` assignments, `dispose()` extension |

## Definition of Done

- [ ] Tornadoes are visually prominent: scale 0.7, unlit materials, bright fallback cone
- [ ] Player true tile: yellow 1x1 outline at `player.pos`, snaps each tick (no lerp)
- [ ] Boss true tile: blue 5x5 perimeter outline at `boss.pos`, covers full footprint
- [ ] Tornado true tiles: white 1x1 outlines at each unique `tornado.pos`, snaps each tick
- [ ] True tile colors are distinct: yellow (player), blue (boss), white (tornado)
- [ ] True tile outlines render above floor hazard overlays (correct Y + renderOrder layering)
- [ ] Floor hazard overlays remain readable through outline-only indicators
- [ ] Tornado overlap: multiple tornadoes on same tile produce one stable indicator (deduplicated)
- [ ] Boss style ring is visually distinct from and interior to the boss true tile perimeter
- [ ] Target tile indicator (click destination) still renders correctly after Y adjustment
- [ ] True tiles hidden during countdown, visible during running/won/lost (boss hidden on won)
- [ ] No per-frame geometry or material allocation (pooling for tornado true tiles)
- [ ] `dispose()` cleans up all new meshes, materials, and geometries
- [ ] `npm run build` succeeds
- [ ] `npm test` passes all existing tests
- [ ] `cd ../cg-sim-player && npm test` passes all tests
- [ ] No frame rate regression below 30 fps with 4 tornadoes + all indicators active

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| True tile outline strips alias or become invisible at far camera zoom | Low | Medium | Strip lineWidth 0.06 is ~6% of a tile. Test at both min and max camera distances. If aliasing occurs, increase to 0.08. |
| Z-fighting between true tiles and floor hazard overlays | Low | Medium | 0.01 Y gap + `depthWrite: false` + explicit `renderOrder` values make layering deterministic. |
| Boss style ring resize (2.2->1.8 inner, 2.5->2.1 outer) looks wrong | Low | Low | The ring is still clearly visible inside the 5x5 perimeter. Can be tuned post-merge. |
| Transparent sort order instability at certain camera angles | Medium | Low | Explicit `renderOrder` on all transparent ground overlays prevents Three.js distance-based sorting surprises. |
| Tornado scale 0.7 looks too large at close camera angles | Low | Low | 0.7 fits within a tile. Conservative vs the 0.8 alternative. Tunable constant. |
| Performance with 4 tornado true tiles + 4 tornado models + floor overlays | Very Low | Low | Each true tile is 4 narrow PlaneGeometry meshes with shared material. Negligible GPU cost. Pool prevents allocation churn. |

## Security Considerations

No security impact. All changes are visual rendering -- new Three.js meshes and materials in the existing renderer. No new user inputs, network calls, or dependencies.

## Dependencies

- `three` v0.183.2 (already installed) -- `PlaneGeometry`, `MeshBasicMaterial`, `Group`
- No new npm packages
- Existing `applyUnlitMaterials()` helper in Renderer3D.ts
- Existing `tileToWorld()` and `entityCenterToWorld()` coordinate helpers
- Never modify cg-sim-player

## Open Questions

1. **Strip lineWidth tuning:** The default `0.06` (6% of tile width) may need adjustment after visual testing. If outlines are too subtle, increase to 0.08-0.10. If too thick, reduce to 0.04.

2. **Boss true tile during lost state:** Currently shown (player died but boss is alive). Could be hidden since the fight is over. Current implementation: visible during `lost`, hidden during `won`.

3. **Tornado opacity boost for overlapping tiles:** The dedup approach optionally increases opacity when `count > 1`. Whether to implement this or keep a flat opacity is a minor tuning decision during implementation.

## MVP Scope Cuts (if sprint runs long)

Priority order of what to cut:

1. Cut boss true tile (least gameplay value -- boss position is obvious from its 3D model)
2. Cut tornado true tiles (tornado visibility improvements still help without true tiles)
3. Simplify player true tile to `RingGeometry` instead of edge strips (matching existing `targetTileIndicator` pattern)
4. Skip boss style ring resize (visual collision is noticeable but not blocking)
5. Skip `renderOrder` assignments (Y-offset layering usually works, just not guaranteed)
6. **Absolute minimum:** Tornado scale + material improvements only (no true tiles)
