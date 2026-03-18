# Sprint 017: Fix GLTF Morph Target Animation Rendering

## Overview

Three stacking renderer bugs prevent GLTF morph target animations from playing on both the boss (Corrupted Hunlef) and player models. The GLTF files already contain valid morph target data — diagnostic analysis confirms non-zero deltas (boss: 6043/6840 non-zero floats, max magnitude 337; player: 262/537 non-zero, max 8.7) and proper float32 keyframe times (0.06–1.8s). The animation controllers, mixer integration, and clip mappings are all correct. The bugs are entirely in how the renderer loads and configures GLTF models for morph target playback.

**Root causes (in order of severity):**

1. **Multi-primitive weight retargeting:** Each GLTF mesh has 2 primitives (opaque + alpha faces). Three.js GLTFLoader promotes such meshes to a `Group` with child `Mesh` nodes. Animation tracks target `weights` on the Group, but `morphTargetInfluences` lives on the child Meshes. The AnimationMixer silently finds no property to animate.

2. **Missing `morphTargets` material flag:** `applyUnlitMaterials()` creates `MeshBasicMaterial` without `morphTargets: true`, so the vertex shader omits morph target deformation even if influences were being driven.

3. **Mixer binding scope (possible):** After retargeting tracks from Group to child Meshes, the AnimationMixer must resolve the new property paths. This may work automatically or need adjustment depending on Three.js r183 property binding behavior.

**Approach:** Fix at load time. Add a post-load retargeting pass that rewires animation tracks from Group-level weight targets to child Mesh weight targets. Patch `applyUnlitMaterials()` to enable the morph target shader flag. Both fixes are small, localized, and preserve the existing animation controller API.

## Use Cases

1. **Boss idle animation:** Hunlef visibly deforms in its idle stance — the mesh is no longer a static sculpture
2. **Boss attack animations (magic/ranged):** Distinct morph-based attack motions play when the boss fires projectiles
3. **Boss stomp animation:** Melee-range stomp attack has a visible wind-up
4. **Boss prayer disable animation:** Animation plays when boss disables player prayer
5. **Boss style switch animations (mage/range):** Visual transition when boss changes combat style
6. **Boss death animation:** Plays once and clamps — does not loop or restart from idle
7. **Player idle animation:** Player body deforms in idle stance per weapon variant
8. **Player attack animation:** Weapon-specific attack motion plays on attack tick
9. **Player eat animation:** Eat motion triggers when food is consumed
10. **Crossfade transitions:** Smooth blending between animation states (no hard popping)
11. **Fallback resilience:** If GLTF loading fails, static JSON boss + cyan player box still render correctly
12. **No visual regression:** Existing projectiles, floor hazards, true tiles, tornadoes, overheads unaffected

## Architecture

### Multi-Primitive Morph Target Retargeting

The core problem is a mismatch between GLTF animation channel targets and Three.js scene graph structure:

```
GLTF declares:              Three.js loads as:
┌──────────────────┐        ┌──────────────────────────┐
│ Mesh node 0      │        │ Group (node 0)           │
│   primitive 0    │   →    │   ├── Mesh_0 (prim 0)    │  ← has morphTargetInfluences
│   primitive 1    │        │   └── Mesh_1 (prim 1)    │  ← has morphTargetInfluences
│   weights: [...]│        │   weights: undefined      │
└──────────────────┘        └──────────────────────────┘
                            Animation track targets Group.morphTargetInfluences → ✗
```

**Fix strategy — retarget tracks at load time:**

Add a utility function `retargetMorphAnimations(root, clips)` that:

1. Walks the scene graph to find Groups whose children have `morphTargetInfluences`
2. For each animation clip, finds tracks targeting `.morphTargetInfluences[N]` on such Groups
3. Duplicates those tracks to target each child Mesh instead (same keyframe data, different binding path)
4. Removes the original Group-targeted tracks
5. Only affects `weights`/`morphTargetInfluences` tracks — leaves transform tracks untouched
6. Is idempotent — skips clips already retargeted (guard against double-retarget on reload)

### Material Morph Target Flag

In `applyUnlitMaterials()`, add `morphTargets: morphCount > 0` to the `MeshBasicMaterial` constructor. The `morphCount` variable already exists at line 403 — it just isn't used when constructing the replacement material.

### Data Flow

```
GLTF Load → retargetMorphAnimations(scene, clips) → applyUnlitMaterials(scene)
         → AnimationController(model, retargetedClips) → AnimationMixer binds correctly
         → update(dt) → morphTargetInfluences driven → vertex shader deforms mesh
```

## Implementation

### Phase 1: GLTF Validation Script (~10% of effort)

**File:** `tools/cache-reader/validate-gltf.mjs`

**Tasks:**
- [ ] Create validation script that reads each GLTF file and checks:
  - Morph target position deltas have non-zero max magnitude (decoded from actual buffer data, not JSON metadata)
  - Keyframe times are finite, monotonically increasing float32 seconds in range 0–60s
  - Animation weight outputs are in [0, 1] range
  - Animation count matches expected per model (8 for boss, 3 for player bodies, 0 for static)
  - Animation clip names match expected names (idle, attack_magic, attack_ranged, stomp, prayer_disable, death, style_switch_mage, style_switch_range for boss; idle, attack, eat for player)
- [ ] Run against current GLTF files to establish baseline (should pass)
- [ ] Add `validate-gltf` script to root `package.json`

### Phase 2: Retargeting Utility (~35% of effort)

**File:** `src/render/Renderer3D.ts`

Add a module-level helper function:

**Tasks:**
- [ ] Implement `retargetMorphAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): void`:
  - Walk `root` with `traverse()`, find Groups whose children have `morphTargetInfluences`
  - Ensure child meshes have `.name` set (assign names like `Mesh_0`, `Mesh_1` if unnamed, since `PropertyBinding` resolves by name)
  - For each clip, iterate tracks. If a track's `.name` contains `morphTargetInfluences`:
    - Identify the target node (parse the node name prefix from the track name, or match against scene graph)
    - If target is a retarget candidate Group: duplicate track for each morph-capable child Mesh with rewritten binding path
    - Mark original Group-targeted track for removal
    - Only retarget `morphTargetInfluences` tracks — leave position/rotation/scale tracks untouched
  - Replace `clip.tracks` with the retargeted set
  - Add idempotency guard: skip clips that have already been retargeted (check if tracks already target child mesh names)
  - **Mandatory diagnostic logging:** Log retarget candidates found, tracks retargeted per clip, child mesh names
- [ ] Handle edge case: empty animations array (GLTF loads but no animation data → function is a no-op)
- [ ] Handle edge case: single-primitive meshes (no Group wrapping → function is a no-op)
- [ ] Handle edge case: child primitives with mismatched morph target counts (log warning, retarget only to children that have sufficient morph targets)

### Phase 3: Material Flag Fix (~5% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `applyUnlitMaterials()` (~line 414), add `morphTargets: morphCount > 0` to the `MeshBasicMaterial` constructor options
- [ ] The `morphCount` variable is already computed at line 403 and is in scope for the `map()` closure — no restructuring needed

### Phase 4: Wire Retargeting Into Load Paths (~15% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `loadBossGLTF()` success callback (~line 432), call `retargetMorphAnimations(model, gltf.animations)` before `applyUnlitMaterials()` and before creating `AnimationController`
- [ ] In `loadPlayerGLTFs()` (~line 520-528), call `retargetMorphAnimations()` on each body variant before `applyUnlitMaterials()`:
  - `retargetMorphAnimations(bodyBow.scene, bodyBow.animations)`
  - `retargetMorphAnimations(bodyStaff.scene, bodyStaff.animations)`
  - `retargetMorphAnimations(bodyHalberd.scene, bodyHalberd.animations)`
- [ ] Player weapon, helm, and legs models have no animations — no retargeting needed
- [ ] Verify weapon switching still works: when player switches weapons, the body GLTF swaps and `PlayerAnimationController` is recreated — retargeting should apply cleanly to the new model

### Phase 5: Verification & Regression (~35% of effort)

**Tasks:**
- [ ] Run `validate-gltf` script — all models pass
- [ ] Run the simulator and verify boss animations:
  - [ ] Console shows retargeted track counts > 0 (diagnostic logs)
  - [ ] Console shows no AnimationMixer binding warnings (no unbound tracks)
  - [ ] Idle: mesh visibly deforms (not static)
  - [ ] Magic attack vs ranged attack: visually distinct animations
  - [ ] Stomp and prayer-disable: animations play (via existing triggers or manual testing)
  - [ ] Style switch: plays on style change
  - [ ] Death: plays once and clamps (doesn't loop)
- [ ] Verify player animations:
  - [ ] Idle: visible body motion per weapon variant (bow, staff, halberd — test each)
  - [ ] Attack: fires per weapon type on attack tick
  - [ ] Eat: animation plays on food consumption
  - [ ] Weapon switch: crossfade is smooth, no errors on model swap
- [ ] Verify crossfade transitions (no popping between states)
- [ ] Verify fallbacks: delete/rename a GLTF file temporarily → boss falls back to JSON, player to cyan box
- [ ] Performance: >30 fps with both boss and player animated
- [ ] `npm run build` — no errors
- [ ] `npm test` — all tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Add `retargetMorphAnimations()`, call it in load paths, add `morphTargets` flag to `applyUnlitMaterials()` |
| `src/render/AnimationController.ts` | No change | Existing API preserved; receives correctly-retargeted clips |
| `src/render/PlayerAnimationController.ts` | No change | Existing API preserved; receives correctly-retargeted clips |
| `tools/cache-reader/validate-gltf.mjs` | Create | Offline GLTF validation script for morph target data integrity |
| `package.json` | Modify | Add `validate-gltf` script |

## Definition of Done

- [ ] Boss morph target animations visibly play — mesh deforms, not static
- [ ] All 8 boss animations trigger on correct game events: idle, attack_magic, attack_ranged, stomp, prayer_disable, style_switch_mage, style_switch_range, death
- [ ] Player morph target animations play: idle, attack, eat — on each body variant (bow, staff, halberd)
- [ ] Crossfade transitions smooth between animation states (no popping)
- [ ] Death animation plays once and clamps (does not loop or restart)
- [ ] `retargetMorphAnimations()` is a no-op for single-primitive meshes (no regression)
- [ ] Retargeting is idempotent (no duplicated tracks on repeated setup)
- [ ] No AnimationMixer binding warnings in console (no unbound/silent-fail tracks)
- [ ] Fallback paths still work: static JSON boss + cyan box player render when GLTFs absent
- [ ] Existing visual features unaffected: projectiles, floor hazards, true tiles, tornadoes, overheads
- [ ] Weapon switching doesn't break player animations
- [ ] Frame rate >30 fps with all animations active
- [ ] No new npm dependencies
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes (cg-sim-player never modified)
- [ ] `validate-gltf.mjs` passes on all exported GLTF files

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Three.js r183 GLTFLoader doesn't embed node names in track names, breaking retargeting pattern matching | Medium | High | Log loaded track names before retargeting. Fall back to positional matching (first Group child with morph targets gets all weight tracks) if name-based fails |
| `morphTargets: true` is auto-detected in r183 (flag unnecessary) | Low | None | If auto-detected, the explicit flag is harmless. Verify by checking Three.js r183 source |
| Retargeted tracks produce incorrect deformation (morph target index mismatch between primitives) | Low | High | Both primitives share the same morph target set from the same GLTF node. Validate morph target counts match before duplicating tracks. Log warning on mismatch |
| AnimationMixer property binding fails after retargeting (wrong path format) | Medium | High | Log mixer warnings. Try alternative formats: bare path, UUID-based, different mixer root. PropertyBinding docs specify expected format |
| PropertyBinding name sanitization silently breaks rewritten paths | Medium | Medium | After assigning child mesh names, verify they survive PropertyBinding sanitization. Use simple names (letters + underscores only) |
| Boss 144 morph targets causes frame rate drop below 30fps | Low | Medium | Accept for now. If fps drops, limit active morph influence count or reduce morph targets in future sprint |
| Cloning retargeted animations for player weapon switch breaks bindings | Low | Medium | Retargeted track names reference child mesh names which should be identical in clones. Test weapon switching explicitly |
| Double-retarget on model reload produces duplicated tracks | Low | Medium | Idempotency guard in retarget function (check if tracks already target child meshes) |

## Security Considerations

No security impact. All changes are internal to the Three.js rendering pipeline — modifying how animation data is bound to scene graph nodes at load time. No new user inputs, network requests, file system access, or dependencies.

## Dependencies

- `three` v0.183.2 (already installed) — `AnimationClip`, `AnimationMixer`, `PropertyBinding`, `MeshBasicMaterial`
- `three/addons/loaders/GLTFLoader.js` (already imported)
- No new npm packages
- Existing `AnimationController` and `PlayerAnimationController` APIs (unchanged)
- Never modify cg-sim-player

## Open Questions

1. **Track name format in Three.js r183 GLTFLoader:** What exact format does the loader produce for morph target animation tracks on multi-primitive meshes? Is it `<nodeName>.morphTargetInfluences[N]`, `<nodeIndex>.morphTargetInfluences[N]`, or bare `morphTargetInfluences[N]`? Determines the retargeting strategy. Answer by logging `gltf.animations[0].tracks.map(t => t.name)` early in Phase 2.

2. **Merge primitives vs retarget tracks:** An alternative to retargeting is calling `BufferGeometryUtils.mergeGeometries()` on child primitives, producing a single Mesh. Simpler but loses opaque/alpha material separation. If retargeting proves too complex, this is the fallback.

3. **`morphTargets` property status in r183:** Some Three.js versions auto-detect morph support from geometry `morphAttributes`. If r183 auto-detects, the flag is harmless. If not, it's critical. Verify early in Phase 3.

## MVP Scope Cuts (if sprint runs long)

Priority order of what to cut:
1. Cut validation script (Phase 1) — nice-to-have, data already verified
2. Cut player animations (keep boss only)
3. Cut boss stomp / prayer-disable verification (keep idle + attacks + death)
4. **Absolute minimum:** Boss idle + one attack animation visibly playing with morph target deformation
