# Sprint 016: Tornado Visibility & True Tile Indicators

## Overview

Tornadoes in the Corrupted Hunlef arena are nearly invisible during intense gameplay -- they are small (0.4 scale), grey, and get lost against floor hazard overlays. This sprint addresses that by making tornadoes dramatically more visible and by introducing "true tile" indicators: colored ground-plane highlights that show the exact game-logic tile position of the player, the boss, and each tornado.

True tile indicators are a staple of OSRS PvM plugins (notably RuneLite's "True Tile" feature). They display the server-side position of an entity, which in our simulator corresponds to the integer `pos` field on each entity -- distinct from the smoothly interpolated visual position. These indicators snap instantly each tick rather than lerping, giving the player accurate positional information for dodging tornadoes and floor hazards.

The sprint is split into two workstreams that share rendering infrastructure: (A) tornado visibility overhaul and (B) true tile indicator system. Both modify `Renderer3D.ts` exclusively on the rendering side, with no changes to game logic or entity classes.

## Use Cases

1. **Tornado contrast during floor hazards**: Four tornadoes are active while a large floor hazard pattern is in the warning/hazard state. The tornadoes must be immediately distinguishable from the red/orange floor overlays through scale, color tinting, and a ground-level swirl effect.

2. **Player true tile during movement**: The player clicks to move across the arena. Their interpolated model glides smoothly, but a yellow tile outline on the ground snaps discretely each tick to show the actual position the server considers the player to occupy. This helps the player understand when they are "safe" from a tornado on an adjacent tile.

3. **Boss true tile showing full footprint**: The Hunlef's 5x5 hitbox is rendered as a blue rectangular outline on the ground at `boss.pos` (SW corner). This makes it clear which 25 tiles the boss actually occupies -- useful for understanding melee distance and movement blocking.

4. **Tornado true tiles for dodge timing**: Each tornado has a small cyan/white tile highlight at its `pos`. Because the visual tornado model lerps between positions, the true tile shows the exact tile that will deal damage on the current tick, helping the player learn tick-precise dodging.

5. **True tiles visible over floor hazards**: A tornado true tile overlaps a hazard tile. Both remain distinguishable -- the true tile indicator renders above the hazard overlay at a slightly higher Y offset.

6. **Indicators are toggleable**: A keybind (e.g., `T`) toggles true tile indicators on/off. Some players may find them distracting during early practice but essential for advanced play.

## Architecture

### Tornado Visibility: Scale + Tint + Ground Swirl

The current tornado rendering pipeline clones a GLTF template (or cone fallback) and positions it at the lerped world coordinate. The visibility problem has three causes: (1) the 0.4 scale makes them tiny, (2) the grey color blends with the dark floor, and (3) there is no ground-level visual cue.

The fix applies three layered improvements:

- **Increased scale**: Raise from 0.4 to 0.7, making tornadoes roughly 1.75x their current size. This keeps them within a single tile footprint while being much more prominent.
- **Color tint**: Traverse the tornado mesh's materials after cloning and apply a white/cyan emissive-style brightening. For `MeshBasicMaterial` (which has no emissive channel), this means setting `color` to a bright value like `0xccffff`. For the cone fallback, change the color from `0x888888` to `0xccddff`.
- **Ground swirl ring**: Add a flat `RingGeometry` at Y=0.04 beneath each tornado, using a semi-transparent cyan material that pulses in opacity (sinusoidal oscillation based on elapsed time). This provides a ground-level footprint that is visible even when the tornado model is partially obscured by the camera angle.

### True Tile Indicator System

Rather than creating filled quads (which would obscure floor hazard colors), true tile indicators use **tile-border outlines** -- thin rectangular outlines drawn as a set of 4 narrow PlaneGeometry strips forming a square border. This approach:

- Allows the floor hazard color to show through the center of the tile
- Matches the visual language of RuneLite's true tile plugin (colored outlines, not fills)
- Avoids Z-fighting with the existing tile overlay system by rendering at a distinct Y height

Each entity type gets a dedicated color, chosen to match RuneLite conventions and maximize contrast against the dark red floor and crimson/orange hazard overlays:

| Entity | Color | Hex | Rationale |
|--------|-------|-----|-----------|
| Player | Yellow | `0xffff00` | RuneLite default true tile color; high contrast against dark/red floor |
| Boss (Hunlef) | Blue | `0x4488ff` | Distinct from all floor colors; visible against hazard overlays |
| Tornado | White | `0xffffff` | Maximum brightness; matches the "danger" association; distinct from player yellow |

### Rendering Order (Y-axis layering)

From bottom to top:

| Layer | Y offset | Content |
|-------|----------|---------|
| Floor plane | -0.01 | Dark background |
| Grid lines | 0.01 | Tile grid |
| Floor hazard overlays | 0.02 | Warning (crimson) and hazard (orange-red) tiles |
| True tile indicators | 0.035 | Colored outlines for player/boss/tornadoes |
| Tornado ground swirl | 0.04 | Cyan pulsing ring beneath tornado models |
| Target tile indicator | 0.02 -> 0.05 | Player click destination (raise from 0.02 to 0.05 to stay above true tiles) |

This ordering ensures true tiles are visible on top of hazard overlays, the tornado swirl is above true tiles, and the target tile indicator (where you clicked) is the topmost ground element.

### Toggle State

A boolean `trueTilesEnabled` field on `Renderer3D` controls visibility. It defaults to `true`. A public method `toggleTrueTiles()` flips the flag. The keybind integration is handled in the input layer (a new entry in `KeyBindManager` or equivalent), calling `renderer.toggleTrueTiles()`. When disabled, all true tile meshes have `visible = false` but remain in the scene for instant re-enable.

### Mesh Management Strategy

**Player true tile**: A single pre-allocated `THREE.Group` containing 4 narrow plane strips forming a 1x1 tile outline. Repositioned each tick to `tileToWorld(player.pos.x, player.pos.y)`. No interpolation -- it snaps.

**Boss true tile**: A single pre-allocated `THREE.Group` containing 4 narrow plane strips forming a 5x5 rectangle outline. Repositioned each tick to the SW corner world position of `boss.pos`, sized to cover the full 5-tile footprint.

**Tornado true tiles**: A pool of up to 4 tile-outline groups (matching the max tornado count). Active count follows `sim.tornadoes.length`. Each snaps to `tileToWorld(tornado.pos.x, tornado.pos.y)` without interpolation. Pooled identically to how `tornadoMeshPool` / `activeTornadoMeshes` already works.

**Tornado ground swirls**: Paired 1:1 with tornado meshes. A `RingGeometry(0.15, 0.45, 16)` mesh added as a child of each tornado's scene node but with `position.y` set to keep it at ground level regardless of the parent's Y. Actually, cleaner approach: maintain a separate pool of swirl rings (like tornado true tiles) that are positioned independently, avoiding parent-transform complications.

## Implementation

### Phase 1: Tornado Visibility Overhaul (~30% of effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Increase tornado template scale from 0.4 to 0.7 in `loadTornadoGLTF()` (both the GLTF success path at L381 and the cone fallback at L390)
- [ ] In the cone fallback, change the material color from `0x888888` to `0xccddff` (pale blue-white)
- [ ] After the GLTF template loads successfully, traverse its materials and brighten them: for each `MeshBasicMaterial`, shift the color toward white by blending with `0xccffff` (e.g., `material.color.lerp(new THREE.Color(0xccffff), 0.5)`)
- [ ] Add a tornado ground swirl system:
  - Add fields: `tornadoSwirlPool: THREE.Mesh[]`, `activeTornadoSwirls: THREE.Mesh[]`
  - Create a shared geometry: `new THREE.RingGeometry(0.15, 0.45, 16)` and material: `new THREE.MeshBasicMaterial({ color: 0x88ffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })`
  - In `updateTornadoes()`, manage the swirl pool in parallel with `activeTornadoMeshes` -- same acquire/release pattern
  - Position each swirl at the tornado's interpolated X/Z (matching the model) but at `Y = 0.04`
  - Rotate swirl flat: `rotation.x = -Math.PI / 2`
  - Pulse opacity: `material.opacity = 0.35 + 0.25 * Math.sin(now * 0.005)` where `now` is `performance.now()`, creating a gentle throb that catches the eye

### Phase 2: True Tile Outline Geometry Factory (~15% of effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Add a private helper method `createTileOutline(width: number, height: number, color: number, lineWidth: number = 0.06): THREE.Group` that:
  - Creates a `THREE.Group`
  - Builds 4 narrow `THREE.PlaneGeometry` strips (top edge, bottom edge, left edge, right edge) sized to form a rectangular outline of the given tile dimensions
    - Top strip: `PlaneGeometry(width, lineWidth)`, positioned at `z = -height/2 + lineWidth/2`
    - Bottom strip: `PlaneGeometry(width, lineWidth)`, positioned at `z = height/2 - lineWidth/2`
    - Left strip: `PlaneGeometry(lineWidth, height)`, positioned at `x = -width/2 + lineWidth/2`
    - Right strip: `PlaneGeometry(lineWidth, height)`, positioned at `x = width/2 - lineWidth/2`
  - Each strip uses `MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })`
  - Each strip is rotated `x = -Math.PI / 2` to lie flat on the ground
  - Sets `group.position.y = 0.035`
  - Returns the group
- [ ] This factory is called during construction for the player tile, boss tile, and tornado tile pool

### Phase 3: True Tile Indicator Integration (~40% of effort)

**File:** `src/render/Renderer3D.ts`

#### 3a. State and construction

- [ ] Add field `trueTilesEnabled: boolean = true`
- [ ] Add method `toggleTrueTiles(): void` that flips `trueTilesEnabled` and sets visibility on all true tile groups
- [ ] In the constructor, create:
  - `playerTrueTile`: `createTileOutline(1, 1, 0xffff00)` -- 1x1 yellow outline
  - `bossTrueTile`: `createTileOutline(5, 5, 0x4488ff)` -- 5x5 blue outline
  - `tornadoTrueTilePool: THREE.Group[]` and `activeTornadoTrueTiles: THREE.Group[]` -- pool of `createTileOutline(1, 1, 0xffffff)` white 1x1 outlines
  - Add all to scene

#### 3b. Player true tile update

- [ ] Add a private method `updatePlayerTrueTile(sim: GameSimulation): void`
  - If `!trueTilesEnabled` or state is `countdown`, set `playerTrueTile.visible = false` and return
  - Compute world position from `tileToWorld(sim.player.pos.x, sim.player.pos.y)` -- note: `pos`, not `prevPos`, and no interpolation
  - Set `playerTrueTile.position.set(wp.x, 0.035, wp.z)`
  - Set `playerTrueTile.visible = true`
- [ ] Call `updatePlayerTrueTile(sim)` from `draw()`, after `updatePlayer()` and before `updateFloorTiles()`

#### 3c. Boss true tile update

- [ ] Add a private method `updateBossTrueTile(sim: GameSimulation): void`
  - If `!trueTilesEnabled` or state is `countdown`, set `bossTrueTile.visible = false` and return
  - Boss pos is SW corner; the 5x5 outline should be centered on the footprint
  - Compute center: `entityCenterToWorld(sim.boss.pos.x, sim.boss.pos.y, sim.boss.size)`
  - Set `bossTrueTile.position.set(center.x, 0.035, center.z)`
  - Set `bossTrueTile.visible = true`
- [ ] Call `updateBossTrueTile(sim)` from `draw()`

#### 3d. Tornado true tile update

- [ ] Add a private method `updateTornadoTrueTiles(sim: GameSimulation): void`
  - If `!trueTilesEnabled`, hide all active tornado true tiles and return
  - Manage pool identically to `updateTornadoes()`: shrink active list, grow from pool or create new
  - For each active tornado, position the true tile outline at `tileToWorld(tornado.pos.x, tornado.pos.y)` -- integer pos, no lerp
  - Set `visible = true`
- [ ] Call `updateTornadoTrueTiles(sim)` from `draw()`, near `updateTornadoes()`

#### 3e. Adjust target tile indicator Y

- [ ] In the existing `targetTileIndicator` setup (constructor, ~L229), change `position.y` from `0.02` to `0.05`
- [ ] In `updateTargetTile()` (~L709), change the Y component from `0.02` to `0.05`
- [ ] This ensures the click-target ring renders above true tile outlines

### Phase 4: Toggle Keybind (~15% of effort)

**File:** `src/input/KeyBindManager.ts` (or equivalent input handler)

- [ ] Add a keybind for `KeyT` that calls `renderer.toggleTrueTiles()` when pressed
- [ ] Ensure the keybind only fires when the game is focused (not when typing in input fields, if any exist)

**File:** `src/render/Renderer3D.ts`

- [ ] Ensure `toggleTrueTiles()` is a public method callable from the input layer
- [ ] On toggle-off, immediately hide all true tile groups (player, boss, tornado pool)
- [ ] On toggle-on, the next `draw()` call will re-show and reposition them naturally

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/render/Renderer3D.ts` | Modify | Tornado scale/color changes, ground swirl system, true tile outline factory, per-entity true tile update methods, target tile Y adjustment |
| `src/input/KeyBindManager.ts` | Modify | Add `T` keybind for true tile toggle |
| No new files | -- | All changes fit within existing modules |

## Definition of Done

- [ ] Tornadoes are visually prominent: larger scale (0.7), brighter coloring, and a pulsing ground ring beneath each one
- [ ] Tornadoes are easily distinguishable from floor hazard overlays (different color palette, different Y layer)
- [ ] Player true tile appears as a yellow 1x1 outline at `player.pos`, snapping each tick
- [ ] Boss true tile appears as a blue 5x5 outline at the boss footprint, snapping each tick
- [ ] Tornado true tiles appear as white 1x1 outlines at each `tornado.pos`, snapping each tick
- [ ] True tile outlines render above floor hazard overlays but below the target tile indicator
- [ ] True tiles can be toggled on/off with the `T` key
- [ ] True tiles are not interpolated -- they snap to integer tile positions each tick
- [ ] No performance regression: 30+ fps with 4 tornadoes, all true tiles active, and floor hazards showing
- [ ] All existing tests pass (`npm test`)
- [ ] All cg-sim-player tests pass (`cd ../cg-sim-player && npm test`)
- [ ] `npm run build` succeeds with no type errors

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tornado GLTF material traversal fails to brighten because materials are not `MeshBasicMaterial` after `applyUnlitMaterials()` | Low | Low | `applyUnlitMaterials()` already converts all materials to `MeshBasicMaterial`. The color lerp should work. Fallback: set color directly to a fixed bright value instead of lerping. |
| True tile outlines are too subtle at default opacity 0.8 | Medium | Low | Easily tunable constant. If too subtle, increase to 1.0 or widen the border strips from 0.06 to 0.08. |
| Z-fighting between true tile outlines and floor hazard overlays at similar Y offsets | Medium | Medium | The 0.015 gap between hazard overlays (Y=0.02) and true tiles (Y=0.035) should prevent this on most hardware. If Z-fighting occurs, increase the gap or add `polygonOffset` to the true tile materials. |
| Ground swirl opacity pulsing uses `performance.now()` which could drift or stutter | Low | Low | The pulse is purely cosmetic. Any timing inconsistency produces a slightly irregular throb, which is acceptable. |
| Adding up to 4 swirl rings + 4 true tile groups + player/boss true tiles (10 extra meshes) impacts frame rate | Low | Low | These are simple flat geometries with basic materials. The existing scene already handles projectile meshes, hit splats, and 144 potential floor overlays. 10 more flat meshes is negligible. |
| `KeyT` conflicts with an existing keybind | Low | Medium | Check `KeyBindManager` for existing `T` binding before adding. If conflict exists, use `Shift+T` or `V` instead. |

## Security Considerations

No security impact. This sprint modifies only rendering code within the existing Three.js pipeline. No new user inputs are processed (the toggle keybind uses the existing input system). No network calls, no new dependencies, no file I/O. All changes are purely visual.

## Dependencies

- `three` v0.183.2 with `THREE.PlaneGeometry`, `THREE.RingGeometry`, `THREE.MeshBasicMaterial` (all already used in the codebase)
- No new npm packages
- No changes to game logic entities (`Player`, `Boss`, `Tornado`, `FloorHazardManager`)
- No changes to `cg-sim-player`

## Open Questions

1. **Outline vs filled tile for player true tile?** This draft proposes outlines (matching RuneLite convention). An alternative is a semi-transparent filled square, which is simpler to implement (single `PlaneGeometry` per entity) but risks obscuring floor hazard information. Recommendation: start with outlines; if they prove too subtle in testing, switch to a low-opacity fill (0.2-0.3 alpha) as a fallback.

2. **Should the ground swirl ring spin?** The current draft pulses opacity but does not rotate the ring. Adding `swirl.rotation.z += dt * 2` would create a spinning effect. However, since `RingGeometry` is rotationally symmetric, spinning is invisible unless the ring is segmented or textured. A UV-scrolling approach on a custom shader would achieve a visible spin but adds complexity. Recommendation: keep the simple opacity pulse for this sprint; a particle-based swirl could be explored in a future sprint.

3. **Should true tiles persist during countdown state?** The draft hides them during countdown (entities are static and centered). If desired, they could be shown during countdown as well, since the positions are valid. Recommendation: hide during countdown for cleanliness.

4. **Boss true tile: outline or corner markers?** A full 5x5 outline is one option. An alternative is 4 corner markers (small L-shaped brackets at each corner of the 5x5), which is more visually subtle and arguably more "RuneLite-like" for large NPCs. The full outline is simpler to implement and more informative for new players. Recommendation: full 5x5 outline.

5. **Should tornado true tiles have a different shape from player/boss?** Using the same square outline for all entities keeps the visual language consistent. An alternative is using a diamond (45-degree rotated square) or circle for tornadoes to differentiate at a glance. Recommendation: same square outline but distinct white color is sufficient differentiation. Revisit if playtesters confuse them.
