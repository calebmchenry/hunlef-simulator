# Sprint 015: Player Model & Animations

## Overview

Replace the cyan placeholder box with OSRS-style player models wearing perfected corrupted crystal armor, with weapon-specific variants and combat animations. Three pre-composed GLTF files are exported (one per weapon type: bow/staff/halberd), each containing the player model with morph-target animations for idle, attack, and eat. The player model swaps at runtime when the weapon changes.

**Approach:** Export 3 GLTF files via a new `export-player-gltf.mjs` script using `osrscachereader`. Load in Renderer3D with a new `PlayerAnimationController`. Fall back to cyan box if export/load fails.

## Use Cases

1. **Visual identity:** Player appears as a recognizable OSRS character in purple/magenta corrupted crystal armor
2. **Weapon swap:** Switching bow → staff mid-fight visibly changes the player model
3. **Idle animation:** Player loops idle/stance animation when standing
4. **Attack animations:** Bow pull-back, staff overhead cast, halberd sweep — each visually distinct
5. **Eat animation:** Consuming food plays a brief eating animation
6. **Facing:** Player model rotates to face the boss during combat
7. **Performance:** 30+ fps with both boss and player animated simultaneously

## Architecture

### Export Pipeline (offline)

New script `tools/cache-reader/export-player-gltf.mjs` produces:
```
public/models/player_bow.gltf
public/models/player_staff.gltf
public/models/player_halberd.gltf
```

**Model composition:** The key unknown is whether corrupted crystal armor models (helm=38025, body=38105, legs=38078) are full-body replacements or overlays requiring a base body. Phase 1 discovery determines this.

| Approach | Description | When to use |
|----------|-------------|-------------|
| **A: Armor is full-body** | Stack helm + body + legs + weapon. No base body needed. | If Phase 1 confirms armor models include body geometry |
| **B: Manual vertex merge** | Load body kit parts + armor + weapon, merge vertex buffers into single ModelDef | If armor models are overlays needing a body underneath |
| **C: Fallback** | Use armor models only (no body mesh), accept visual gaps | If composition is too difficult |

**Always use perfected (T3) armor visuals** regardless of selected tier. 3 files, not 9.

**Weapon model IDs:**
- Bow: 38302 | Staff: 38312 | Halberd: 38303

**Armor model IDs (perfected):**
- Helm: 38025 | Body: 38105 | Legs: 38078

### Animation System

**Known sequence IDs:**
- Idle/stance: 808
- Eat/consume: 829
- Bow attack: TBD (Phase 1 discovery)
- Staff attack: TBD (Phase 1 discovery)
- Halberd attack: TBD (Phase 1 discovery)

**Walk/run animation: deferred** — keep current tile interpolation.

### Runtime (browser)

- `PlayerAnimationController` (new): states = idle, attack, eat. Modeled on existing `AnimationController`.
- Model swapping: preload all 3 GLTFs at startup, swap when `loadout.weapon.type` changes.
- Material conversion: PBR → MeshBasicMaterial with vertex colors (same as boss).
- Fallback: if GLTF fails, keep cyan box.

## Implementation

### Phase 1: Discovery & Validation (~20% of effort)

**Goal:** Answer all unknowns before committing to the export approach.

- [ ] Write `tools/cache-reader/discover-player-anims.mjs` that:
  - Loads corrupted weapon item definitions from cache
  - Extracts weapon animation fields (stance, attack, block, walk anim references)
  - Prints all discovered sequence IDs per weapon type
  - Tests idle (808) and eat (829) on a player model
- [ ] Inspect armor models (38025, 38105, 38078): are they full-body or overlays? Load each and check vertex extents — if they cover the full body region, no base body is needed
- [ ] Check osrscachereader for model merging API (ModelGroup, merge utility, or NPC-style composite loading)
- [ ] If no merge API: prototype manual vertex buffer concatenation with 2 models to validate the approach
- [ ] Validate that `GLTFExporter.addSequence()` works on composite/merged models
- [ ] Document all discovered animation sequence IDs

**Gate:** Phase 1 must produce: (a) confirmed list of animation IDs, (b) validated model composition approach (A, B, or C), (c) a test GLTF that loads in Three.js

### Phase 2: Export Pipeline (~30% of effort)

**Goal:** Produce 3 GLTF files in `public/models/`.

- [ ] Create `tools/cache-reader/export-player-gltf.mjs`
- [ ] Implement model composition using the approach validated in Phase 1
- [ ] Add animation sequences: idle + weapon-specific attack + eat
- [ ] Apply `exporter.addColors()` for vertex-color texturing
- [ ] Apply animation clip naming (idle, attack, eat)
- [ ] Export `player_bow.gltf`, `player_staff.gltf`, `player_halberd.gltf`
- [ ] Verify exported files: correct size (<500KB each), loadable in Three.js
- [ ] Add `export-player` script to `package.json`

### Phase 3: Runtime Integration (~40% of effort)

#### 3a. PlayerAnimationController

- [ ] Create `src/render/PlayerAnimationController.ts`
  - States: `idle`, `attack`, `eat`
  - Constructor: `(model: THREE.Object3D, animations: THREE.AnimationClip[])`
  - Methods: `playIdle()`, `playAttack()`, `playEat()`, `update(dt)`, `dispose()`
  - Idle loops; attack and eat play once then return to idle
  - Crossfade transitions (0.1s)
  - `dispose()` calls `mixer.stopAllAction()` and `mixer.uncacheRoot()`

#### 3b. Model Loading & Swapping in Renderer3D

- [ ] Replace `playerMesh` (BoxGeometry L183-188) with `playerGroup` (THREE.Group)
- [ ] Add `loadPlayerGLTFs()` — preload all 3 variants via GLTFLoader
  - Store in `Map<WeaponType, { scene, animations }>`
  - Convert materials to MeshBasicMaterial + vertex colors (same traversal as boss)
  - On load failure: log warning, mark unavailable
- [ ] Add `setPlayerModel(weaponType)` — swap the active player model:
  - Clear playerGroup children
  - Clone and add the preloaded model
  - Set scale (target ~1.2 world units tall, determined empirically)
  - Create new PlayerAnimationController
  - Update `currentPlayerWeapon` tracker
- [ ] Detect weapon changes in `updatePlayer()` — compare `sim.player.loadout.weapon.type` to `currentPlayerWeapon`, call `setPlayerModel()` on mismatch
- [ ] Fallback: if no GLTFs loaded, create cyan box as before

#### 3c. Animation Triggers

- [ ] Call `playerAnimController.update(dt)` in the draw loop
- [ ] Detect player attack ticks (check for player-source projectiles fired this tick)
- [ ] Detect eat events (check `sim.playerAteThisTick`)
- [ ] Trigger `playAttack()` and `playEat()` accordingly

#### 3d. Player Facing

- [ ] Rotate `playerGroup` to face boss position (Y-axis rotation, same pattern as boss facing)
- [ ] Apply yaw offset if needed (determine from model's native facing direction)
- [ ] Update overhead sprite positioning for new model height

### Phase 4: Validation (~10% of effort)

- [ ] `npm run build` — no errors
- [ ] `npm test` — all 187+ tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass
- [ ] Visual: player model visible, correct colors, correct scale
- [ ] Visual: weapon swap changes model
- [ ] Visual: idle loops, attack fires per tick, eat animation plays
- [ ] Visual: player faces boss
- [ ] Performance: 30+ fps with both animated

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `tools/cache-reader/discover-player-anims.mjs` | Create | Discovery script for animation IDs and model composition validation |
| `tools/cache-reader/export-player-gltf.mjs` | Create | Player GLTF export pipeline (3 weapon variants) |
| `public/models/player_bow.gltf` | Create (generated) | Player + armor + bow with animations |
| `public/models/player_staff.gltf` | Create (generated) | Player + armor + staff with animations |
| `public/models/player_halberd.gltf` | Create (generated) | Player + armor + halberd with animations |
| `src/render/PlayerAnimationController.ts` | Create | Player animation state machine (idle/attack/eat) |
| `src/render/Renderer3D.ts` | Modify | Replace cyan box, add GLTF loading/swapping/animation |
| `package.json` | Modify | Add `export-player` script |

## Definition of Done

- [ ] Player appears as OSRS character in corrupted crystal armor (not cyan box)
- [ ] Three GLTF files exist and load successfully
- [ ] Player model swaps visually on weapon change (bow/staff/halberd)
- [ ] Idle animation loops when standing
- [ ] Attack animation plays per weapon type on attack ticks
- [ ] Eat animation plays on food consumption
- [ ] Player model faces the boss during combat
- [ ] MeshBasicMaterial with vertex colors (matches boss render style)
- [ ] Cyan box fallback works if GLTFs not present
- [ ] `npm run build` succeeds
- [ ] `npm test` passes all tests
- [ ] `cd ../cg-sim-player && npm test` passes all tests
- [ ] No frame rate regression below 30 fps

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Model composition fails (can't merge body + armor + weapon) | Medium | High | Phase 1 gate validates before committing. Fallback: armor-only models (user approved). Worst case: cyan box remains. |
| Attack animation sequence IDs not discoverable | Medium | Medium | Use generic player attack anim for all weapons. Add correct anims in follow-up. |
| Morph-target animations incompatible with composite model | Medium | Medium | Animations must map to correct vertex ranges. If merging breaks this, use armor-only models. |
| GLTF files too large | Low | Medium | Player models smaller than boss. Target <500KB each. |
| Player scale/position wrong | Low | Low | Empirically determine from vertex extents in Phase 1. |

## Security Considerations

No security impact. Static GLTF files generated offline from OSRS cache. No new user inputs, network calls, or dependencies.

## Dependencies

- `osrscachereader` v1.1.3 (already installed)
- `three` v0.183.2 with GLTFLoader (already installed)
- No new npm packages
- Never modify cg-sim-player

## Open Questions

1. **Resolved: Armor tier visuals** — Always use perfected (T3). 3 files, not 9.
2. **Resolved: Walk/run animation** — Deferred. Keep tile interpolation.
3. **Resolved: Composition fallback** — Use armor-only models if body composition fails.
4. **Phase 1 must answer:** Are corrupted crystal armor models full-body replacements? What are the weapon-specific attack animation sequence IDs? Does osrscachereader have a model merge API?

## MVP Scope Cuts (if sprint runs long)

Priority order of what to cut:
1. Cut eat animation (keep idle + attack)
2. Cut staff and halberd variants (ship bow-only, no model swapping)
3. Cut attack animation (ship with idle-only)
4. **Absolute minimum:** One static (no-animation) player model replacing the cyan box
