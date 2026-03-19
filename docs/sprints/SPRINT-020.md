# Sprint 020: Fix Boss Attack Animation "Exploded" Look

## Overview

Boss attack animations (magic, ranged) have morph target geometry deltas 2-3× larger than idle, making the boss look like it's flying apart during attacks. Sprint 019 attempted uniform per-frame `morphTargetInfluences` scaling but it killed ALL animations from the zoomed-out camera.

**New approach:** Scale the morph target **geometry deltas** at GLTF load time for attack-specific morph target indices only. This is a one-time operation that permanently reduces vertex displacement for attack clips without affecting idle or style-switch.

**Why this works:** Each morph target index has its own `BufferAttribute` in `geometry.morphAttributes.position[i]`. Animation clips reference specific morph target indices via one-hot weight encoding. We can discover which indices belong to attack clips by parsing the animation tracks, then scale only those indices' geometry data.

## Use Cases

1. Boss attack_magic animation plays cohesively — body stays together
2. Boss attack_ranged animation plays cohesively — no limbs flying apart
3. Idle animation remains visually unchanged (untouched indices)
4. Style-switch animations remain visually unchanged (untouched indices)
5. Death and stomp are NOT scaled in this sprint (optional follow-up tuning)
6. No per-frame runtime overhead — all scaling happens once at load time
7. Fallback JSON boss path unaffected (no morph targets)

## Architecture

### Dynamic Discovery from Animation Clips

Rather than hardcoding morph target index ranges (brittle if GLTF is re-exported), discover which morph targets each clip uses by parsing animation track names:

1. Each animation track is named `<meshName>.morphTargetInfluences[<index>]`
2. Parse the index from each track to build a `Map<clipName, Set<morphTargetIndex>>`
3. Look up which clips are "attack" clips using the existing name mapping
4. Scale only those indices' geometry data

The `parseMorphTrackBinding()` function already exists in `Renderer3D.ts` from the retargeting code — reuse it.

### Scale Factor

Target: bring attack avg deltas into the same range as idle (avg ~32).

- `attack_magic` avgDelta=78 → scale 0.35 → effective avg ~27
- `attack_ranged` avgDelta=109 → scale 0.35 → effective avg ~38

**Start with `ATTACK_MORPH_SCALE = 0.35`** — tune visually via screenshots.

### Integration Point

In `loadBossGLTF()`, after `retargetMorphAnimations()` and before `applyUnlitMaterials()`:

```
GLTF Load → retargetMorphAnimations → scaleBossMorphDeltas → applyUnlitMaterials → AnimationController
```

## Implementation

### Phase 1: Build Clip-to-MorphIndex Map (~20% effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Create function `getClipMorphIndices(clips: THREE.AnimationClip[]): Map<string, Set<number>>`
- [ ] For each clip, iterate tracks. Use `parseMorphTrackBinding()` to extract morph target index from track names like `mesh_0.morphTargetInfluences[14]`
- [ ] Return map of clip name → set of morph target indices
- [ ] Log the discovered mapping for diagnostics

### Phase 2: Scale Geometry Deltas at Load Time (~40% effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Add constant `ATTACK_MORPH_SCALE = 0.35`
- [ ] Create function `scaleBossAttackMorphDeltas(model: THREE.Object3D, clips: THREE.AnimationClip[]): void`
- [ ] Call `getClipMorphIndices()` to discover all morph indices
- [ ] Identify attack clips: names matching `attack_magic`, `attack_ranged` (and seq ID aliases `8430`, `8431`, etc.)
- [ ] Collect the union of morph target indices from attack clips
- [ ] Traverse all meshes in model. For each mesh with `geometry.morphAttributes.position`:
  - For each morph target index in the attack set:
    - If index < `morphAttributes.position.length`: scale every value in `morphAttributes.position[index].array` by `ATTACK_MORPH_SCALE`
    - Set `morphAttributes.position[index].needsUpdate = true`
- [ ] Add idempotency guard: mark geometry via `geometry.userData.__attackMorphsScaled = true`, skip if already set
- [ ] Log: number of meshes processed, morph targets scaled

### Phase 3: Wire Into loadBossGLTF (~10% effort)

**File:** `src/render/Renderer3D.ts`

- [ ] In `loadBossGLTF()` success callback, call `scaleBossAttackMorphDeltas(model, gltf.animations)` after `retargetMorphAnimations()` and before `applyUnlitMaterials()`
- [ ] Verify no per-frame morph scaling code remains from Sprint 019

### Phase 4: Screenshot Verification (~30% effort)

- [ ] Take "before" screenshots showing attack animation (current exploded state)
- [ ] Apply the fix
- [ ] Take "after" screenshots at same game moments
- [ ] Compare: attacks should look more cohesive, idle should be unchanged
- [ ] If 0.35 is too aggressive or too gentle, tune the constant
- [ ] Optionally: if stomp/death also look too spread, add separate constants (`STOMP_MORPH_SCALE`, `DEATH_MORPH_SCALE`) and extend the scaling
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps

## Files Summary

| File | Changes |
|------|---------|
| `src/render/Renderer3D.ts` | New `getClipMorphIndices()` + `scaleBossAttackMorphDeltas()` functions; call in `loadBossGLTF()` |

## Definition of Done

- [ ] Attack animations (magic + ranged) look cohesive — boss body stays together
- [ ] Idle animation visually unchanged
- [ ] Style-switch animations visually unchanged
- [ ] No per-frame morph scaling code present
- [ ] Verified via Playwright before/after screenshots
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps
- [ ] Fallback JSON boss path still works

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scale factor too aggressive — attacks look frozen | Medium | Low | Tunable constant, start conservative at 0.35 |
| Scale factor too gentle — attacks still explode | Low | Low | 0.35× of 109 avg = 38, close to idle's 32 |
| Dynamic discovery misses a clip due to name mismatch | Low | Medium | Include seq ID aliases; log discovered mapping |
| Multi-primitive meshes have different morph target counts | Low | Low | Check index < array.length before scaling |

## Security

No security implications. Load-time geometry manipulation only.

## Dependencies

- No new npm dependencies
- No changes to cg-sim-player
- No changes to export pipeline or model files

## Open Questions

1. **Scale factor tuning:** 0.35 is data-driven but may need visual adjustment. Start there and tune via screenshots.
2. **Stomp/death/prayer scaling:** Not in scope for this sprint, but if they also look too spread, extending the fix is straightforward — add more clip names to the attack set with per-category scale factors.
