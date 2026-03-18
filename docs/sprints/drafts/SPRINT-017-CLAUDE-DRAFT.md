# Sprint 017: Fix GLTF Morph Target Animation Rendering

## Overview

Three stacking bugs in the renderer prevent GLTF morph target animations from playing on both the boss (Corrupted Hunlef) and player models. The GLTF files contain valid morph target data — 144 morph targets across 8 animations for the boss, 30 morph targets across 3 animations per player body variant — but the renderer never drives the vertex shader to deform them.

**Root causes (in order of severity):**

1. **Multi-primitive weight retargeting:** Each GLTF mesh has 2 primitives (opaque + alpha faces). Three.js GLTFLoader promotes such meshes to a `Group` with child `Mesh` nodes. Animation tracks target `weights` on the Group, but `morphTargetInfluences` lives on the child Meshes. The AnimationMixer silently finds no property to animate.

2. **Missing `morphTargets` material flag:** `applyUnlitMaterials()` creates `MeshBasicMaterial` without `morphTargets: true`, so the vertex shader omits morph target deformation code even if influences were being driven.

3. **Mixer binding scope:** The AnimationMixer is created with the GLTF scene root. Once Bug 1 is fixed via retargeting, track property paths must resolve correctly against the mixer root. This may work automatically or may need adjustment depending on how Three.js r183 resolves retargeted track names.

**Approach:** Fix at load time rather than modifying GLTF files. Add a post-load retargeting pass that rewires animation tracks from Group-level weight targets to child Mesh weight targets. Patch `applyUnlitMaterials()` to enable the morph target shader flag. Both fixes are small, localized, and preserve the existing animation controller API.

## Use Cases

1. **Boss idle animation:** Hunlef visibly deforms in its idle stance — the mesh is no longer a static sculpture
2. **Boss attack animations (magic/ranged):** Distinct morph-based attack motions play when the boss fires projectiles, giving visual telegraph for prayer switches
3. **Boss stomp animation:** Melee-range stomp attack has a visible wind-up
4. **Boss prayer disable animation:** Animation plays when boss disables player prayer
5. **Boss style switch animations (mage/range):** Visual transition when boss changes combat style
6. **Boss death animation:** Plays once and clamps — does not loop, does not restart from idle
7. **Player idle animation:** Player body deforms in idle stance per weapon variant
8. **Player attack animation:** Weapon-specific attack motion plays on the tick the player fires a projectile
9. **Player eat animation:** Eat motion triggers when food is consumed
10. **Crossfade transitions:** Smooth blending between animation states (no hard popping between poses)
11. **Fallback resilience:** If GLTF loading fails, the static JSON boss model and cyan player box still render correctly — the retargeting code is only reached when GLTF loads succeed
12. **No visual regression:** Existing rendering behavior (projectiles, floor hazards, true tiles, tornadoes, overheads) is unaffected

## Architecture

### Multi-Primitive Morph Target Retargeting

The core problem is a mismatch between GLTF animation channel targets and Three.js scene graph structure:

```
GLTF declares:              Three.js loads as:
┌──────────────────┐        ┌──────────────────────────┐
│ Mesh node 0      │        │ Group (node 0)           │
│   primitive 0    │   →    │   ├── Mesh_0 (primitive 0)│  ← has morphTargetInfluences
│   primitive 1    │        │   └── Mesh_1 (primitive 1)│  ← has morphTargetInfluences
│   weights: [...]│        │   weights: undefined      │
└──────────────────┘        └──────────────────────────┘
                            Animation track targets Group.morphTargetInfluences → ✗
```

**Fix strategy — retarget tracks at load time:**

Add a utility function `retargetMorphAnimations(scene, clips)` that:

1. Walks the scene graph to find Groups whose children have `morphTargetInfluences`
2. For each animation clip, finds tracks targeting `.morphTargetInfluences[N]` on such Groups
3. Duplicates those tracks to target each child Mesh instead (same keyframe data, different binding path)
4. Removes the original Group-targeted tracks

This runs once at load time and produces standard animation clips that Three.js AnimationMixer can bind normally.

### Material Morph Target Flag

In Three.js r183, `MeshBasicMaterial` requires `morphTargets: true` for the vertex shader to include morph deformation. The fix adds this flag in `applyUnlitMaterials()` when the mesh geometry has morph attributes:

```typescript
return new THREE.MeshBasicMaterial({
  // ... existing properties ...
  morphTargets: morphCount > 0,  // NEW: enable morph deformation in shader
});
```

The `morphCount` variable already exists at line 403 — it just isn't used when constructing the replacement material.

### AnimationMixer Property Resolution

Three.js AnimationMixer resolves track names as property paths relative to the mixer root. After retargeting, tracks will have paths like `Mesh_0.morphTargetInfluences[0]`. The mixer needs to find `Mesh_0` as a descendant of the root object. Since we pass `gltf.scene` (or its clone) as the mixer root, and the retargeted Mesh nodes are direct descendants, resolution should work automatically.

If property binding fails (detected by mixer warnings in console), the fallback is to create the mixer with the parent of the morph-target meshes as root, or use `THREE.PropertyBinding.sanitizeNodeName()` to normalize names.

### Data Flow

```
GLTF Load → retargetMorphAnimations(scene, clips) → applyUnlitMaterials(scene)
         → AnimationController(model, retargetedClips) → AnimationMixer binds correctly
         → update(dt) → morphTargetInfluences driven → vertex shader deforms mesh
```

## Implementation

### Phase 1: Retargeting Utility (~40% of effort)

**File:** `src/render/Renderer3D.ts`

Add a module-level helper function alongside the existing `tileToWorld`/`entityCenterToWorld` helpers:

**Tasks:**
- [ ] Add `retargetMorphAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): void` function:
  - Walk `root` with `traverse()`, collecting a map of object UUID → { object, childMeshesWithMorphs }
  - For each Group that has no `morphTargetInfluences` but whose children do, identify it as a retarget candidate
  - For each clip, iterate tracks. If a track's `.name` matches the pattern `<groupName>.morphTargetInfluences[N]` and the group is a retarget candidate:
    - For each child mesh of that group that has `morphTargetInfluences`, create a duplicate track with the binding path rewritten to `<childMeshName>.morphTargetInfluences[N]`
    - Mark the original track for removal
  - Replace clip.tracks with the retargeted set
  - Log the number of retargeted tracks for diagnostics
- [ ] Handle the edge case where GLTF animation tracks use the node index as the target name (e.g., track name is just `morphTargetInfluences[0]` without a node prefix). In this case, the Three.js GLTFLoader should have already bound the track to the correct node via the `.node` property on the GLTF animation channel, but the mixer resolves by name. Check whether Three.js r183's GLTFLoader embeds the node name in the track name — if so, match against it; if not, identify the target node from clip metadata or scene graph position.

### Phase 2: Material Flag Fix (~10% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `applyUnlitMaterials()` (line ~414), add `morphTargets: morphCount > 0` to the `MeshBasicMaterial` constructor options
- [ ] The `morphCount` variable is already computed at line 403 — this change passes it through to the material

The fix is a single property addition:
```typescript
return new THREE.MeshBasicMaterial({
  vertexColors: hasColors,
  map: hasMap ? oldMat.map : null,
  transparent: oldMat.transparent || false,
  opacity: oldMat.opacity ?? 1,
  side: THREE.DoubleSide,
  morphTargets: morphCount > 0,  // ADD THIS LINE
});
```

Note: The `morphCount` variable is scoped to the outer `traverse()` callback. To make it accessible inside the `oldMaterials.map()` closure, it needs to be captured — which it already is, since `morphCount` is a `const` in the enclosing scope of the `map()` call.

### Phase 3: Wire Retargeting Into Load Paths (~20% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] In `loadBossGLTF()` success callback (~line 432), call `retargetMorphAnimations(gltf.scene, gltf.animations)` before `applyUnlitMaterials()` and before creating `AnimationController`:
  ```typescript
  (gltf) => {
    const model = gltf.scene;
    model.scale.set(BOSS_MODEL_SCALE, BOSS_MODEL_SCALE, BOSS_MODEL_SCALE);
    retargetMorphAnimations(model, gltf.animations);  // NEW
    this.applyUnlitMaterials(gltf.scene, true);
    // ... rest unchanged
  }
  ```
- [ ] In `loadPlayerGLTFs()` (~line 520-528), call `retargetMorphAnimations()` on each body variant before `applyUnlitMaterials()`:
  ```typescript
  retargetMorphAnimations(bodyBow.scene, bodyBow.animations);
  retargetMorphAnimations(bodyStaff.scene, bodyStaff.animations);
  retargetMorphAnimations(bodyHalberd.scene, bodyHalberd.animations);
  this.applyUnlitMaterials(bodyBow.scene);
  // ... etc
  ```
- [ ] Player weapon, helm, and legs models have no animations — no retargeting needed for those

### Phase 4: Diagnostic Logging & Verification (~15% of effort)

**Tasks:**
- [ ] Add console logging in `retargetMorphAnimations()` to report: number of retarget candidates found, number of tracks retargeted per clip, child mesh names targeted
- [ ] After AnimationController construction, verify that `mixer.clipAction(clip)` produces actions where the mixer successfully bound the tracks (no "binding not found" warnings in console)
- [ ] Verify boss animations by running the sim and checking:
  - Console shows retargeted track counts > 0
  - Idle animation loops (mesh visibly deforms)
  - Attack triggers on boss projectile fire
  - Death clamps (doesn't loop or snap back to idle)
- [ ] Verify player animations:
  - Idle deforms per weapon variant
  - Attack plays on projectile fire
  - Eat plays on food consumption
  - Weapon switch crossfades smoothly

### Phase 5: Edge Cases & Cleanup (~15% of effort)

**Tasks:**
- [ ] Ensure retargeting is a no-op for single-primitive meshes (no Group wrapping → no retargeting needed → function returns clips unmodified)
- [ ] Ensure retargeting handles the case where a mesh has morph targets but no animations (e.g., helm, legs, weapons — these should pass through without error)
- [ ] Verify fallback paths: boss JSON fallback and player cyan box fallback still work when GLTF load fails (retargeting code is never reached)
- [ ] `npm run build` — no TypeScript errors
- [ ] `npm test` — all existing tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass (never modify cg-sim-player)
- [ ] Performance: confirm >30 fps with all animations active (boss + player + tornadoes)

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Add `retargetMorphAnimations()` helper, call it in `loadBossGLTF()` and `loadPlayerGLTFs()`, add `morphTargets` flag to `applyUnlitMaterials()` |
| `src/render/AnimationController.ts` | No change | Existing API preserved; receives correctly-retargeted clips |
| `src/render/PlayerAnimationController.ts` | No change | Existing API preserved; receives correctly-retargeted clips |

## Definition of Done

- [ ] Boss morph target animations visibly play (mesh deforms, not static)
- [ ] All 8 boss animations trigger on correct game events (idle, attack_magic, attack_ranged, stomp, prayer_disable, style_switch_mage, style_switch_range, death)
- [ ] Player morph target animations play (idle, attack, eat) for each weapon variant (bow, staff, halberd)
- [ ] Crossfade transitions are smooth between animation states (no popping)
- [ ] Death animation plays once and clamps (does not loop or restart)
- [ ] `retargetMorphAnimations()` is a no-op for single-primitive meshes (no regression for models that don't need retargeting)
- [ ] Fallback paths still work: static JSON boss + cyan box player render when GLTFs are absent
- [ ] Existing visual features unaffected: projectiles, floor hazards, true tiles, tornadoes, overheads, target tile indicator
- [ ] No new npm dependencies
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes (cg-sim-player never modified)
- [ ] Frame rate >30 fps with all animations active

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Three.js r183 GLTFLoader does not embed node names in animation track names, making retargeting pattern matching unreliable | Medium | High | Inspect loaded clip track names in console before writing the retargeting regex. Fall back to positional matching (first Group child with morph targets gets all weight tracks) if name-based matching fails. |
| `morphTargets: true` on MeshBasicMaterial is deprecated or auto-detected in r183 | Low | Low | If auto-detected, the explicit flag is harmless. If deprecated, the property is silently ignored — check Three.js r183 changelog. |
| Retargeted tracks produce incorrect deformation (e.g., morph target index mismatch between primitives) | Low | High | Both primitives come from the same GLTF mesh node and share the same morph target set. Validate that child Mesh morph target counts match before duplicating tracks. |
| AnimationMixer property binding fails after retargeting (wrong path format) | Medium | High | Log mixer warnings. If binding fails, try alternative path formats: bare property path, UUID-based path, or creating the mixer with a different root. Three.js source for PropertyBinding documents the expected format. |
| Retargeting adds overhead at load time | Very Low | Very Low | Runs once per GLTF load. Even 1000 tracks would retarget in <1ms. |
| Cloning retargeted animations for player weapon switch breaks bindings | Low | Medium | `cloneSkinnedObject()` (SkeletonUtils) clones the scene graph but animation clips are shared. The retargeted track names reference child mesh names which should be identical in clones. Test weapon switching after implementation. |

## Security Considerations

No security impact. All changes are internal to the Three.js rendering pipeline — modifying how animation data is bound to scene graph nodes at load time. No new user inputs, network requests, file system access, or dependencies.

## Dependencies

- `three` v0.183.2 (already installed) — `AnimationClip`, `AnimationMixer`, `PropertyBinding`, `MeshBasicMaterial.morphTargets`
- `three/addons/loaders/GLTFLoader.js` (already imported)
- No new npm packages
- Existing `AnimationController` and `PlayerAnimationController` APIs (unchanged)
- Never modify cg-sim-player

## Open Questions

1. **Track name format in Three.js r183 GLTFLoader:** What exact format does the loader produce for morph target animation tracks on multi-primitive meshes? Is it `<nodeName>.morphTargetInfluences[N]`, `<nodeIndex>.morphTargetInfluences[N]`, or bare `morphTargetInfluences[N]`? This determines the retargeting regex pattern. Can be answered by logging `gltf.animations[0].tracks.map(t => t.name)` before any processing.

2. **Merge primitives vs retarget tracks:** An alternative to retargeting is calling `BufferGeometryUtils.mergeGeometries()` on the child primitives at load time, producing a single Mesh that the animation tracks target directly. This is simpler but loses the opaque/alpha material separation. Is the alpha-face material distinction visually important for these models?

3. **Does `morphTargets: true` still exist on MeshBasicMaterial in r183?** Some Three.js versions auto-detect morph support from geometry `morphAttributes`. If r183 auto-detects, the flag is harmless but unnecessary. If it doesn't, the flag is critical.
