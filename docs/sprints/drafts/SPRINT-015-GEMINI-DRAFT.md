# Sprint 015: Player Model & Animations

## Overview

Replace the cyan placeholder box (Renderer3D.ts L183-188) with authentic OSRS-style player models wearing corrupted crystal armor and wielding corrupted weapons. The player model swaps when the equipped weapon changes (bow/staff/halberd). A `PlayerAnimationController` drives idle, attack, and eat animations using the same morph-target GLTF pipeline already proven for the Corrupted Hunlef boss.

The sprint is structured in three phases: (1) discovery and export tooling, (2) GLTF export pipeline for pre-composed player models, and (3) runtime integration in the browser renderer. This phasing lets each stage produce a verifiable artifact before the next begins.

## Use Cases

1. **Standing idle**: Player loads into the arena. Instead of a cyan box, a recognizable OSRS character in purple/magenta corrupted crystal armor stands on the tile, looping an idle stance animation.
2. **Weapon swap changes model**: Player equips staff from inventory. The renderer disposes the bow model and loads/displays the staff model. The idle animation continues seamlessly on the new model.
3. **Attack animation per weapon**: Player attacks with bow -- a rapid pull-back animation plays. Player attacks with staff -- an overhead cast animation plays. Player attacks with halberd -- a sweeping slash animation plays. Each is visually distinct.
4. **Eat animation**: Player eats a paddlefish. A brief consuming animation plays, then returns to idle.
5. **Correct facing**: During combat, the player model faces the boss. During movement, the model faces the direction of travel.
6. **Performance maintained**: Both the boss and player are animated simultaneously at 30+ fps with no frame drops.

## Architecture

### Export strategy: pre-composed models

Rather than compositing body + armor + weapon meshes at runtime (which would require a custom merge pipeline or a scene-graph hierarchy that complicates animation), we export **3 pre-composed GLTF files**:

- `player_bow.gltf` -- body + perfected corrupted armor + corrupted bow, with animations
- `player_staff.gltf` -- body + perfected corrupted armor + corrupted staff, with animations
- `player_halberd.gltf` -- body + perfected corrupted armor + corrupted halberd, with animations

Each file is self-contained with data URIs (no external references), matching the existing boss model convention.

### Model composition approach

The `osrscachereader` `GLTFExporter` constructor takes a single `ModelDef`. To create a composite model (body + armor + weapon), we need to merge multiple `ModelDef` objects into one before passing it to the exporter. Two approaches, in priority order:

1. **Preferred: Use osrscachereader's model merging if available.** The library may expose a `ModelDef.merge()` or `ModelGroup` utility. The discovery phase will investigate the library's API surface.
2. **Fallback: Manual vertex buffer concatenation.** Load each component's `ModelDef`, then create a new `ModelDef` by concatenating their vertex positions, face indices (offset by prior vertex count), and vertex colors. This is feasible because the OSRS models use simple indexed triangle geometry with vertex colors -- no UV mapping, no bone weights. The export script already has access to `modelDef.vertexCount`, `modelDef.faceCount`, and the underlying arrays.

### Animation controller

A new `PlayerAnimationController` class, modeled on the existing `AnimationController` (boss), will manage player animation states. Key differences from the boss controller:

- States: `idle`, `attack_bow`, `attack_staff`, `attack_halberd`, `eat` (vs the boss's magic/ranged/stomp/etc.)
- Each GLTF file only contains the animations relevant to that weapon (idle + that weapon's attack + eat), so the controller only needs to map 3 clips per model
- The controller must be **replaceable** -- when the player swaps weapons, the old controller is disposed and a new one is created from the new model's animation clips

### Model swapping strategy

When the player equips a different weapon:

1. Remove the current player model from the scene
2. Dispose the old model's geometry, materials, and textures (prevent memory leaks)
3. Add the new pre-loaded model to the scene
4. Create a fresh `PlayerAnimationController` from the new model's clips
5. Start the new controller in idle state

All 3 models are **preloaded at startup** (not lazy-loaded). Rationale: the models are small (expect <200KB each given the boss is ~150KB), and lazy loading during a fight would cause a visible pop-in. Preloading 3 small GLTFs adds negligible startup time.

### Player scaling and positioning

The player model needs to fit within a single tile (1 world unit) and appear proportionally small relative to the boss (which spans 5 tiles). Based on OSRS proportions, the player should be roughly 1/5 the boss height. The exact scale factor will be determined during the discovery phase by inspecting model vertex extents, but an initial estimate is `1 / 675` (one tile width / model span).

## Implementation

### Phase 1: Discovery & Animation ID Research (~20% of effort)

**Goal:** Determine all IDs needed for export and validate that model composition is feasible.

- [ ] Write a discovery script `tools/cache-reader/discover-player-anims.mjs` that:
  - Loads all item definitions from the cache (`IndexType.CONFIGS`, `ConfigType.ITEM`)
  - Finds corrupted bow/staff/halberd item definitions by ID (IDs from intent: bow model 38302, staff 38312, halberd 38303)
  - Extracts weapon animation fields from item defs: `attackAnim`, `blockAnim`, `standAnim`, `walkAnim`, `runAnim` (or equivalents -- OSRS item defs reference these via `weaponData` or stance-related fields)
  - Prints all discovered sequence IDs for each weapon type
- [ ] Investigate osrscachereader's `ModelDef` API for model merging: check if there is a `merge()`, `combine()`, `ModelGroup`, or similar method by inspecting the library source or attempting to concatenate two ModelDefs
- [ ] Determine the base player body model ID: inspect kit definitions in the cache (`ConfigType.IDENTKIT` or similar) to find the default male body parts (head, torso, arms, legs, hands, feet) used when no equipment overrides them, OR determine that the armor models are full-body replacements that don't need a separate body mesh
- [ ] Validate known animation IDs: load sequence 808 (idle) and 829 (eat) from the cache and confirm they have frame data compatible with the player body/armor model IDs
- [ ] Document all discovered IDs in a comment block at the top of the export script

### Phase 2: Export Pipeline (~35% of effort)

**Goal:** Produce 3 GLTF files in `public/models/` with embedded animations.

**File:** `tools/cache-reader/export-player-gltf.mjs` (new)

- [ ] Create the export script, following the pattern in `export-gltf.mjs`
- [ ] Implement model composition: load body part ModelDefs + armor ModelDefs + weapon ModelDef, merge them into a single ModelDef (using whichever approach Phase 1 validated)
- [ ] If manual merging: write a `mergeModelDefs(...defs)` utility function that concatenates vertex positions, vertex colors, and face indices (with index offsetting) into a new ModelDef-compatible object
- [ ] Add animation sequences to each composite model via `exporter.addSequence()`:
  - Idle sequence (808 or as discovered in Phase 1)
  - Weapon-specific attack sequence (discovered in Phase 1)
  - Eat sequence (829 or as discovered in Phase 1)
- [ ] Apply animation clip names via `applyAnimationNames()` (reuse pattern from boss export)
- [ ] Call `exporter.addColors()` to generate the vertex-color palette texture
- [ ] Export 3 files: `player_bow.gltf`, `player_staff.gltf`, `player_halberd.gltf` to `public/models/`
- [ ] Log file sizes and verify they are reasonable (<500KB each)
- [ ] Add an `export-player` script entry to `package.json` for convenience

### Phase 3: Runtime Integration (~45% of effort)

**Goal:** Load the player GLTFs, display them in place of the cyan box, animate them, and swap on weapon change.

#### 3a. PlayerAnimationController

**File:** `src/render/PlayerAnimationController.ts` (new)

- [ ] Define `PlayerAnimState = 'idle' | 'attack' | 'eat'`
- [ ] Implement constructor that takes `(model: THREE.Object3D, animations: THREE.AnimationClip[])`, mirrors the boss `AnimationController` pattern
- [ ] Map GLTF clip names to states (idle, attack, eat) with fallback by clip index order
- [ ] Idle loops infinitely; attack and eat play once then return to idle
- [ ] Expose `playIdle()`, `playAttack()`, `playEat()`, `update(delta)`, `dispose()`
- [ ] `dispose()` must call `mixer.stopAllAction()` and `mixer.uncacheRoot()` to cleanly tear down

#### 3b. Player Model Loading & Swapping

**File:** `src/render/Renderer3D.ts` (modify)

- [ ] Add private fields: `playerModels: Map<string, { scene: THREE.Object3D, animations: THREE.AnimationClip[] }>`, `playerGroup: THREE.Group`, `playerAnimController: PlayerAnimationController | null`, `currentPlayerWeapon: string`
- [ ] Add a `loadPlayerGLTFs()` method that preloads all 3 player GLTFs via `GLTFLoader`, stores each in the `playerModels` map, and replaces materials with `MeshBasicMaterial` (same traversal as boss)
- [ ] Replace the cyan box creation (L183-188) with `this.playerGroup = new THREE.Group()` and call `loadPlayerGLTFs()`
- [ ] Add a `setPlayerModel(weaponType: string)` method that:
  - Disposes the current player model (geometry, materials, textures) if any
  - Clones the preloaded model for the given weapon type
  - Adds it to `playerGroup`
  - Sets the correct scale and Y offset
  - Creates a new `PlayerAnimationController`
  - Updates `currentPlayerWeapon`
- [ ] Call `setPlayerModel()` on initial load with the starting weapon type
- [ ] Detect weapon changes in `updatePlayer()` by comparing `sim.player.loadout.weapon.type` to `currentPlayerWeapon`; call `setPlayerModel()` on mismatch

#### 3c. Animation Triggers

**File:** `src/render/Renderer3D.ts` (modify)

- [ ] In the draw loop, call `playerAnimController.update(delta)` alongside the existing boss `animController.update(delta)`
- [ ] Detect player attack ticks: when `sim.player` fires an attack, call `playerAnimController.playAttack()`
- [ ] Detect eat events: when player consumes food, call `playerAnimController.playEat()`
- [ ] Keep idle as the default/fallback state

#### 3d. Player Facing Direction

**File:** `src/render/Renderer3D.ts` (modify)

- [ ] When the player is in combat (has a target), rotate `playerGroup` to face the boss position using `lookAt()` or manual Y-axis rotation
- [ ] When the player is moving, rotate `playerGroup` to face the movement direction (derive from `prevPos` vs `pos`)
- [ ] Apply a yaw offset if the OSRS model's default facing does not match Three.js conventions (same pattern as `BOSS_MODEL_YAW_OFFSET`)

#### 3e. Fallback

- [ ] If all 3 GLTF loads fail (e.g., files not yet exported), fall back to the current cyan box so the sim remains usable during development
- [ ] Log a console warning on fallback

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `tools/cache-reader/discover-player-anims.mjs` | New | Discovery script to find animation sequence IDs and validate model composition |
| `tools/cache-reader/export-player-gltf.mjs` | New | Export pipeline producing 3 pre-composed player GLTF files |
| `public/models/player_bow.gltf` | New (generated) | Player + armor + bow model with idle, attack, eat animations |
| `public/models/player_staff.gltf` | New (generated) | Player + armor + staff model with idle, attack, eat animations |
| `public/models/player_halberd.gltf` | New (generated) | Player + armor + halberd model with idle, attack, eat animations |
| `src/render/PlayerAnimationController.ts` | New | Animation state machine for player (idle/attack/eat) |
| `src/render/Renderer3D.ts` | Modify L183-188+  | Replace cyan box with GLTF player model, add loading/swapping/animation logic |
| `package.json` | Modify | Add `export-player` script entry |

## Definition of Done

- [ ] Player appears as a recognizable OSRS character in corrupted crystal armor (not a cyan box)
- [ ] Player model visually changes when weapon is swapped (bow/staff/halberd each look distinct)
- [ ] Idle animation loops when the player is standing still
- [ ] Attack animation plays on the player's attack tick, visually distinct per weapon type
- [ ] Eat animation plays when the player consumes food
- [ ] Player model faces the boss during combat and faces movement direction while walking
- [ ] No performance regression: 30+ fps with both boss and player animated simultaneously
- [ ] All 187+ cg-sim tests pass (`npm test`)
- [ ] All cg-sim-player tests pass (`cd ../cg-sim-player && npm test`)
- [ ] `npm run build` succeeds with no type errors
- [ ] Cyan box fallback works if GLTF files are not present

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| osrscachereader has no model merging API and manual vertex concatenation produces visual artifacts (misaligned parts, broken colors) | Medium | High | Phase 1 discovery validates this before committing to the approach. Fallback: export weapon-only models (no body/armor) as a visible but imperfect first pass. Second fallback: use Blender as an intermediate step to manually compose and re-export. |
| Weapon-specific attack animation sequence IDs cannot be found in the cache | Medium | Medium | The discovery script searches item definitions systematically. Fallback: use the generic idle animation (808) for all attacks initially, and add correct attack anims in a follow-up sprint. RuneLite wiki and community animation databases can also be consulted. |
| Morph-target animations from player sequences are incompatible with composite models (frames reference vertices that don't exist in the merged model) | Medium | High | Animations must be applied to the correct sub-range of vertices. If merging breaks this, export weapon+armor only (skip body) since armor models may be self-contained full-body replacements in the Gauntlet context. |
| Preloading 3 GLTF models increases initial load time noticeably | Low | Low | Expected total ~500KB. Monitor load time; if excessive, switch to lazy loading with a loading indicator. |
| Model scale/position is wrong, player appears too large/small or floating | Low | Low | Determined empirically in Phase 1 by inspecting vertex extents. Easy to adjust the scale constant. |
| Player animation triggers fire at wrong times (double-fire, missed events) | Medium | Medium | Use the same tick-driven event detection pattern as the boss animations. Add console logging during development. |

## Security Considerations

No security impact. This sprint adds static GLTF model files (generated offline from the OSRS cache, which is already used for the boss model) and new rendering code. No new user inputs, network calls, or third-party dependencies are introduced. The GLTF files use embedded data URIs, so no external resource fetching occurs at runtime.

## Dependencies

- `osrscachereader` v1.1.3 (already installed, used by `export-gltf.mjs`)
- `three` v0.183.2 with `GLTFLoader` addon (already installed, used by `Renderer3D.ts`)
- No new npm packages required
- No changes to cg-sim-player

## Open Questions

1. **Are corrupted crystal armor models full-body replacements or overlays?** If the helm/body/legs models (38025, 38105, 38078) already include the underlying body geometry, we don't need separate body part models at all. This is the most critical unknown and must be answered in Phase 1 discovery.

2. **What are the exact animation sequence IDs for bow/staff/halberd attacks?** The intent lists idle=808 and eat=829. The discovery script in Phase 1 will extract weapon-specific attack anims from item definitions. If the item defs don't directly reference them, we may need to search sequence definitions for those that reference the weapon model IDs, or consult the RuneLite wiki.

3. **Does `GLTFExporter.addSequence()` work correctly on a merged ModelDef?** The sequence frame data references vertex indices. If we concatenate multiple models, the vertex indices for animations must still map to the correct sub-model. This needs empirical validation in Phase 1.

4. **Should run/walk animations be included?** The current sim interpolates player position between tiles without a walk cycle. Adding a walk animation would look better but increases scope. Recommendation: defer to a follow-up sprint and keep the current tile-interpolation approach for MVP.

5. **MVP scope cuts if the sprint runs long.** In priority order of what to cut:
   - Cut eat animation (keep just idle + attack)
   - Cut halberd and staff models (ship with bow-only, no model swapping)
   - Cut attack animation (ship with idle-only on the correct model)
   - The absolute minimum shippable artifact is: one static (no animation) player model replacing the cyan box

6. **Should we always use perfected (T3) armor visuals regardless of actual tier?** Recommendation: yes, for simplicity. The visual difference between armor tiers is subtle, and exporting 3 tiers x 3 weapons = 9 GLTF files is excessive for this sprint. Use perfected visuals universally and note the simplification in the UI.
