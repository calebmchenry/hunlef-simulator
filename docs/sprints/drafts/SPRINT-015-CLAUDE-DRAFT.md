# Sprint 015: Player Model & Animations

## Overview

Replace the cyan placeholder box with OSRS-style player models wearing corrupted crystal armor, with weapon-specific variants and combat animations. The player model changes when the weapon is swapped (bow/staff/halberd), and animations play for idle, attack, and eat actions.

The approach exports 3 pre-composed GLTF files (one per weapon type), each containing the player body + perfected corrupted armor + weapon model with morph-target animations baked in. At runtime, Renderer3D swaps the active model when `player.loadout.config.weaponType` changes, and a new `PlayerAnimationController` drives animation state transitions.

## Use Cases

1. **Visual identity:** Player appears as a recognizable OSRS character in corrupted crystal armor instead of a cyan box
2. **Weapon swap feedback:** Switching from bow to staff mid-fight visibly changes the player model and weapon
3. **Combat animations:** Player attack tick triggers the correct weapon-specific attack animation (bow pull-back, staff overhead cast, halberd sweep)
4. **Idle animation:** Player loops idle/stance animation (seq 808) when standing still
5. **Eat animation:** Eating food plays the consuming animation (seq 829)
6. **Facing:** Player model rotates to face the boss during combat, matching the boss's existing facing behavior

## Architecture

### Export Pipeline (offline, `tools/cache-reader/`)

Extend `export-gltf.mjs` (or create a parallel `export-player-gltf.mjs`) to produce 3 composite GLTF files:

```
public/models/player_bow.gltf
public/models/player_staff.gltf
public/models/player_halberd.gltf
```

**Model composition strategy:** The `osrscachereader` `GLTFExporter` takes a single `ModelDef`. OSRS player models are composed of body kit parts + equipment overlays. Two approaches:

- **Option A (preferred): NPC-style composite.** Use `osrscachereader`'s NPC definition loading which internally composites model parts. Find or construct an NPC def that wears the corrupted armor + weapon. This is how the boss model was exported — NPCs are pre-composited.
- **Option B: Manual vertex merge.** Load each model (body parts, helm 38025, body 38105, legs 38078, weapon 38302/38312/38303) as separate `ModelDef`s, merge their vertex/face buffers into a single `ModelDef`, then feed to `GLTFExporter`. This is more work but gives full control.
- **Option C (fallback): Weapon-only models.** If body composition fails, export just the 3 weapon models and attach them to a simple geometric body (colored to approximate corrupted crystal). Visually worse but unblocks the sprint.

**Animation sequence discovery:** The item definitions don't contain animation sequence IDs — those live in the cache's weapon/equipment definitions or the player kit system. Known IDs from research:
- **Idle/stance:** 808 (generic player idle)
- **Eat/consume:** 829
- **Bow attack:** Needs discovery — likely in the 400-range or weapon category animation set. RuneLite wiki suggests bow attack = 426, but corrupted variants may differ.
- **Staff attack:** Needs discovery — generic staff attack is 419, corrupted may override.
- **Halberd attack:** Needs discovery — generic halberd attack is 440.

Discovery approach: Iterate `ConfigType.SEQUENCE` entries in the cache, try adding each candidate to a player model via `exporter.addSequence()`, and check which ones produce valid morph targets for the player mesh (non-zero frame deltas). Alternatively, search RuneLite source/wiki for "corrupted bow" animation IDs.

### Runtime Architecture (`src/render/`)

**PlayerAnimationController** (new file `src/render/PlayerAnimationController.ts`):
- Simpler than `AnimationController` — fewer states: `idle`, `attack`, `eat`
- Same pattern: wraps `THREE.AnimationMixer`, crossfades between states, returns to idle on finish
- Attack animation varies per weapon type (clip name includes weapon: `attack_bow`, `attack_staff`, `attack_halberd`)

**Model swapping in Renderer3D:**
- Replace the `playerMesh` (BoxGeometry) with a `playerGroup` (THREE.Group) that holds the active GLTF model
- Track `currentWeaponType: WeaponType` — on each frame, compare against `sim.player.loadout.config.weaponType`
- When weapon changes: remove old model from group, add new one, create new `PlayerAnimationController`
- Pre-load all 3 GLTF models at startup (they're small) to avoid swap latency

**Fallback strategy:**
- If GLTF load fails for a variant → fall back to the cyan box for that variant (same pattern as boss JSON fallback)
- If all 3 fail → keep current cyan box behavior entirely (no regression)

### Scaling & Positioning

The player occupies 1 tile (vs boss's 5). OSRS player models are ~200-250 units tall. Target scale: `1.0 / playerModelHeight` so the model fits within ~1.2 world units tall (matching the current box). Y-offset: model origin at feet (y=0), no offset needed unlike the box's y=0.6.

## Implementation

### Phase 0: Animation Sequence Discovery (~15% of effort)

Research and validate the animation sequence IDs for player combat actions.

- [ ] Write a discovery script `tools/cache-reader/discover-player-anims.mjs` that:
  - Loads the player body model (or a known equipment model like helm 38025)
  - Iterates candidate sequence IDs (400-900 range, known player animation range)
  - Attempts `exporter.addSequence()` for each, logs which succeed with frame counts
  - Cross-reference results with known IDs: idle=808, eat=829
- [ ] Identify and record the attack animation sequence IDs for bow, staff, and halberd
- [ ] Verify the idle (808) and eat (829) sequences apply correctly to the player model
- [ ] Document all discovered sequence IDs in this sprint doc or a `PLAYER_ANIMS.md`

### Phase 1: Export Pipeline (~25% of effort)

Create the GLTF export script for player models.

- [ ] Create `tools/cache-reader/export-player-gltf.mjs` modeled on `export-gltf.mjs`
- [ ] Implement model composition: load body kit + armor models (helm 38025, body 38105, legs 38078) + weapon model
  - Try NPC-style loading first; fall back to manual vertex buffer merge
- [ ] Add animation sequences: idle, eat, and the weapon-specific attack animation
- [ ] Apply `exporter.addColors()` for vertex-color texturing
- [ ] Apply animation clip naming (same pattern as `applyAnimationNames` in boss exporter)
- [ ] Export 3 files: `player_bow.gltf`, `player_staff.gltf`, `player_halberd.gltf` to `public/models/`
- [ ] Verify exported files load in a GLTF viewer (or via quick Three.js test)

### Phase 2: PlayerAnimationController (~20% of effort)

Build the animation state machine for the player.

- [ ] Create `src/render/PlayerAnimationController.ts`
  - States: `idle`, `attack_bow`, `attack_staff`, `attack_halberd`, `eat`
  - Constructor takes `THREE.Object3D` + `THREE.AnimationClip[]` + `weaponType: WeaponType`
  - `playIdle()`, `playAttack()`, `playEat()` methods
  - `update(dt)` to advance the mixer
  - Returns to idle on animation finish (same `finished` event pattern as boss controller)
- [ ] Map GLTF clip names to states (support numeric, `seq_*`, and friendly name formats)
- [ ] Add crossfade transitions (0.1s, matching boss controller)

### Phase 3: Renderer Integration (~30% of effort)

Replace the cyan box with the real player model.

- [ ] Add player GLTF loading in `Renderer3D` constructor — load all 3 weapon variants
  - Store in `Map<WeaponType, { model: THREE.Object3D, animations: THREE.AnimationClip[] }>`
  - On load failure per variant, log warning and mark as unavailable
- [ ] Replace `playerMesh` (BoxGeometry) with `playerGroup` (THREE.Group)
  - Remove lines L184-188 (box creation)
  - Create group, add to scene at same position
- [ ] Implement model swapping logic in `updatePlayer()`:
  - Track `private currentPlayerWeapon: WeaponType | null`
  - Compare against `sim.player.loadout.config.weaponType` each frame
  - On change: clear group children, add new model, create new `PlayerAnimationController`
- [ ] Replace PBR materials with `MeshBasicMaterial` + vertex colors (same traversal as boss GLTF)
- [ ] Set model scale based on exported model dimensions (target ~1.2 world units tall)
- [ ] Implement player facing: rotate `playerGroup` toward boss position (mirror boss facing logic)
- [ ] Wire up player attack animation trigger:
  - Detect player attack ticks (similar to `getBossAttackStyleThisTick` but for player projectiles)
  - Call `playerAnimController.playAttack()`
- [ ] Wire up eat animation trigger:
  - Detect when player eats (check `sim.player.eatDelay > 0` transition or equivalent)
  - Call `playerAnimController.playEat()`
- [ ] Update overhead sprite positioning to account for new model height (currently hardcoded y offset)
- [ ] Fallback: if no GLTF models loaded, create the cyan box as before

### Phase 4: Polish & Verification (~10% of effort)

- [ ] Run `npm run build` — no errors
- [ ] Run `npm test` — all 187+ tests pass
- [ ] Run `cd ../cg-sim-player && npm test` — all tests pass
- [ ] Visual check: player model visible, textured with vertex colors, correct scale
- [ ] Visual check: weapon swap changes the visible model
- [ ] Visual check: idle animation loops, attack animation fires on attack tick
- [ ] Performance check: 30+ fps with both boss and player animated simultaneously
- [ ] Verify eat animation plays when consuming food

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `tools/cache-reader/discover-player-anims.mjs` | **Create** | Discovery script for animation sequence IDs |
| `tools/cache-reader/export-player-gltf.mjs` | **Create** | Player model GLTF export pipeline |
| `src/render/PlayerAnimationController.ts` | **Create** | Player animation state machine |
| `src/render/Renderer3D.ts` | **Modify** | Replace cyan box with GLTF player models, add swap logic |
| `public/models/player_bow.gltf` | **Create** | Exported player model (bow variant) |
| `public/models/player_staff.gltf` | **Create** | Exported player model (staff variant) |
| `public/models/player_halberd.gltf` | **Create** | Exported player model (halberd variant) |

## Definition of Done

1. Player appears as an OSRS-style character in corrupted crystal armor (not a cyan box)
2. Three weapon-variant GLTF files exist in `public/models/` and load successfully
3. Player model swaps visually when weapon type changes (bow/staff/halberd)
4. Idle animation loops when player is standing
5. Attack animation plays on player attack ticks (correct animation per weapon type)
6. Eat animation plays when player consumes food
7. Player model faces the boss during combat
8. `MeshBasicMaterial` with vertex colors (matches boss render style)
9. `npm run build` succeeds, `npm test` passes (187+ tests)
10. `cd ../cg-sim-player && npm test` passes (cg-sim-player never modified)
11. No frame rate regression below 30 fps

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Model composition fails (can't merge body + armor + weapon into single GLTF) | Medium | High | Fall back to Option C: weapon-only model on geometric body. Worst case: keep cyan box |
| Animation sequence IDs can't be discovered for all weapon types | Medium | Medium | Use generic player attack animation (e.g. seq 422) for all weapons. Visual fidelity lower but functional |
| osrscachereader can't composite multiple models in one export | Medium | High | Manual vertex buffer merge, or export separate models and merge in Three.js at load time |
| GLTF files too large (3 animated models) | Low | Medium | Player models are much smaller than boss. Estimate ~1-3 MB each. Lazy-load non-active variants |
| Morph target animations don't apply to composite model | Medium | Medium | If body+armor morphs conflict, export animations only on the body mesh and keep armor/weapon static |
| Player model scale/origin doesn't match arena tile grid | Low | Low | Adjust scale constant and Y-offset empirically after first export |

## Security

- No user input processed in the export pipeline (offline tool)
- GLTF files are static assets served from `public/` — no injection surface
- No new network requests; models loaded from same origin
- No changes to game logic or simulation state

## Dependencies

- `osrscachereader` v1.1.3 (already installed) — `GLTFExporter`, `RSCache`, `IndexType`, `ConfigType`
- `three` v0.183.2 (already installed) — `GLTFLoader`, `AnimationMixer`, `MeshBasicMaterial`
- OSRS cache v232 (already configured in `export-gltf.mjs`)
- Sprint 014 merged (weapon state management fixes — `loadout.config.weaponType` reads correctly)

## Open Questions

1. **Can `osrscachereader`'s `GLTFExporter` accept a composite model from multiple `ModelDef` sources?** If not, what's the merge strategy — concatenate vertex buffers with index offsets? The boss export uses a single NPC model ID which is pre-composited in the cache.

2. **What is the base player body model ID?** OSRS uses a "kit" system for body parts (head, torso, arms, legs). In the Gauntlet, the player's base appearance is their configured kit. We may need a specific NPC ID that represents "player in corrupted armor" or compose from kit IDs + equipment overlays.

3. **Are corrupted weapon attack animations distinct from generic weapon type animations?** Item definitions (e.g. item 23855) don't store animation IDs. The animations may be inherited from the weapon category (bow=426, staff=419, halberd=440) or overridden by the corrupted set. The discovery script in Phase 0 should resolve this.

4. **Should we always show perfected (T3) armor visuals?** The intent doc suggests yes for simplicity. The model IDs (38025/38105/38078) are the perfected variants. Lower tiers may use different model IDs, but visual distinction between tiers is minimal and not worth the export complexity.

5. **How should the player model handle the run animation?** OSRS moves entities by interpolating position between tiles (which the sim already does via `tickProgress`). A run animation (leg movement) would add realism but isn't strictly necessary — the interpolated sliding may look acceptable with the idle animation playing. If a run sequence is discoverable, it can be added as a stretch goal.

6. **Should model loading be blocking or async?** The boss uses async loading with a fallback. The player should follow the same pattern — start with cyan box, swap to GLTF when loaded. This avoids a loading screen but means the first few frames show the placeholder.
