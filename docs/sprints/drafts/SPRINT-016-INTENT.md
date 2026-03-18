# Sprint 016 Intent: Tornado Visibility & True Tile Indicators

## Seed

The tornadoes are difficult to see. Also, the tornadoes, Hunlef, and the player should have "true tiles" — tile-boundary indicators showing the actual game-logic tile each entity occupies.

## Context

- **cg-sim** is a browser-based OSRS Corrupted Hunlef fight simulator using Three.js, 15 sprints complete
- Tornadoes are currently rendered as small GLTF models (0.4 scale) or cone fallbacks — they blend into the floor and are hard to spot, especially with floor hazard overlays active
- Entities (player, boss, tornadoes) are rendered with smooth interpolation between ticks, so their visual position often doesn't match their actual game-logic tile
- The concept of "true tile" is well-known in OSRS: a highlighted tile on the ground showing the server-side (game-logic) position of an entity, distinct from its interpolated visual position
- The project already has a `targetTileIndicator` (flat ring on ground for player click target) which establishes a pattern for tile-boundary rendering

## Recent Sprint Context

- **Sprint 015:** Added GLTF player models with weapon-specific variants and animations
- **Sprint 013:** Brightened floor tiles, snapped camera during countdown
- **Sprint 011:** Hunlef GLTF model animations and facing direction

## Relevant Codebase Areas

| File | Relevance |
|------|-----------|
| `src/render/Renderer3D.ts` | Main 3D renderer — tornado rendering (lines 954-995), player positioning (lines 620-720), boss positioning, target tile indicator (lines 705-713), floor tile overlays (lines 900-952) |
| `src/entities/Tornado.ts` | Tornado entity — `pos`, `prevPos` fields |
| `src/entities/Player.ts` | Player entity — `pos` field (integer tile coords) |
| `src/entities/Boss.ts` | Boss entity — `pos` field (SW corner of 5x5) |
| `src/entities/types.ts` | `Position` type, `Tornado` interface |
| `src/world/FloorHazardManager.ts` | Floor tile overlays — visual pattern for ground-level colored planes |

## Constraints

- **Never modify `cg-sim-player`** — it is read-only validation tooling
- Must integrate with existing Three.js rendering pipeline
- True tile indicators must not obscure floor hazard warnings/hazards
- Tornado visibility improvements must not conflict with existing GLTF model rendering
- Performance: maintain 30+ fps with up to 4 tornadoes + 3 true tile indicators active
- Follow existing rendering patterns (tile overlay geometry, `tileToWorld()` coordinate conversion)

## Success Criteria

1. Tornadoes are clearly visible during gameplay, even over active floor hazard tiles
2. Player true tile is shown as a colored tile outline/highlight on the ground at `player.pos`
3. Hunlef true tile is shown as a colored tile highlight covering the boss's 5x5 footprint at `boss.pos`
4. Tornado true tiles are shown as colored tile highlights at each `tornado.pos`
5. True tiles update each tick (not interpolated — they snap to the game-logic position)
6. True tile colors are distinct: different colors for player, boss, and tornadoes
7. Existing tests pass, no regressions

## Verification Strategy

- **Visual verification:** Tornadoes should be immediately noticeable during gameplay
- **True tile accuracy:** Tile indicators must match the integer `pos` values from game logic, snapping each tick (not lerping)
- **Spec/documentation:** OSRS true tile behavior — the indicator sits at the entity's actual tile, not the interpolated visual position
- **Edge cases:**
  - Multiple tornadoes overlapping the same tile
  - Tornado true tile overlapping floor hazard tile
  - Boss true tile at arena edges
  - Player true tile during movement (should snap, not lerp)
- **Testing approach:** Existing unit tests must pass; visual QA for rendering

## Uncertainty Assessment

- Correctness uncertainty: **Low** — True tile concept is straightforward (render at `entity.pos`)
- Scope uncertainty: **Medium** — "Difficult to see" tornadoes could mean multiple things (size, color, contrast, particle effects). Also need to decide on true tile visual style (outline vs filled, opacity, colors).
- Architecture uncertainty: **Low** — Extends existing renderer patterns (target tile indicator, floor tile overlays)

## Open Questions

1. What visual style should tornado true tiles use? (solid fill, outline ring, or both?)
2. What colors for each entity's true tile? (e.g., yellow for player, red for boss, white/cyan for tornadoes — matching OSRS RuneLite conventions?)
3. Should true tiles be toggleable via a UI setting, or always visible?
4. For tornado visibility: should we increase model scale, add a glow/particle effect, change color, or add a ground shadow?
5. Should the boss true tile show the full 5x5 footprint or just the SW corner tile?
6. Should true tiles render above or below floor hazard overlays?
