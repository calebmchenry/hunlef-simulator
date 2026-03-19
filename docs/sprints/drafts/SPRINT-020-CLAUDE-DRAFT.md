# Sprint 020: Fix Boss Attack Animation "Exploded" Look via Geometry Delta Scaling

## Overview

Boss attack animations (magic, ranged, stomp, prayer_disable) have morph target deltas 2–3× larger than idle, making the boss appear to fly apart during attacks. Sprint 019 attempted uniform per-frame `morphTargetInfluences` scaling but it killed ALL animations (including idle) from the zoomed-out camera.

**New approach:** Scale the morph target **geometry deltas** (`geometry.morphAttributes.position[i]`) at GLTF load time for specific morph target index ranges. This is a one-time operation that permanently reduces the vertex displacement for attack clips without affecting idle or style-switch clips.

## Use Cases

1. Boss attack_magic animation plays cohesively — body stays together
2. Boss attack_ranged animation plays cohesively — no limbs flying apart
3. Idle animation remains visually unchanged (indices 0–13 untouched)
4. Style-switch animations remain visually unchanged (indices 112–143 untouched)
5. Death and stomp animations look reasonable (scaled down but still readable)
6. No per-frame overhead — scaling is a one-time post-load operation
7. Fallback JSON boss path unaffected (no morph targets)

## Architecture

### Why Per-Frame Influence Scaling Failed

Sprint 019 scaled `morphTargetInfluences[i] *= 0.5` every frame after the mixer update. Since morph target animations use one-hot encoding (only one clip's morph targets are active at a time), this uniformly reduced ALL animations including idle. At the zoomed-out camera distance of 18, idle's already-small deltas (avg 32) became invisible.

### Geometry Delta Scaling (Load-Time)

Three.js stores morph target vertex displacements in `geometry.morphAttributes.position`, an array of `BufferAttribute` — one per morph target index. Animation clips reference these indices via `morphTargetInfluences`.

The boss has 144 morph targets with known index ranges per clip:

| Clip | Indices | Avg Delta | Action |
|------|---------|-----------|--------|
| idle | 0–13 | 32 | **No scaling** |
| attack_magic | 14–27 | 78 | Scale down |
| attack_ranged | 28–50 | 109 | Scale down |
| stomp | 51–71 | 88 | Scale down |
| prayer_disable | 72–93 | 82 | Scale down |
| death | 94–111 | 90 | Scale down (gentle) |
| style_switch_mage | 112–127 | 40 | **No scaling** |
| style_switch_range | 128–143 | 40 | **No scaling** |

**Approach:** After GLTF load in `loadBossGLTF()`, traverse all meshes, find `geometry.morphAttributes.position`, and multiply the vertex data in each `BufferAttribute` for the target index range by a scale factor. This permanently reduces the displacement magnitude for those morph targets.

### Scale Factor Strategy

Target: bring attack avg deltas into the same ballpark as idle (avg 32).

- **Attack clips (indices 14–50):** Scale factor ~0.35 (78×0.35 ≈ 27, 109×0.35 ≈ 38)
- **Stomp + prayer_disable (indices 51–93):** Scale factor ~0.4 (88×0.4 ≈ 35)
- **Death (indices 94–111):** Scale factor ~0.5 (90×0.5 ≈ 45, slightly larger than idle for dramatic effect)
- **Idle (0–13) and style-switch (112–143):** No scaling

These factors are tunable constants. The priority is attacks looking cohesive; stomp/death/prayer can be adjusted independently.

### Dynamic Discovery vs Hardcoded Ranges

Two options for identifying which morph target indices belong to which clip:

**Option A — Hardcoded ranges:** Use the known index mapping from the intent doc. Simple, fast, zero overhead. Risk: breaks if the GLTF is re-exported with different morph target ordering.

**Option B — Dynamic discovery from animation clips:** Parse each clip's `NumberKeyframeTrack` entries. Tracks named `*.morphTargetInfluences[i]` reveal which morph target indices each clip uses. Build a `Map<AnimState, number[]>` of indices per clip, then scale those indices' geometry data. More robust to re-exports.

**Recommendation:** Option B. The animation clips already have this data, the parsing infrastructure exists in `parseMorphTrackBinding()`, and it's only ~20 lines of additional code. It guards against future GLTF re-exports changing morph target ordering.

## Implementation

### Phase 1: Build Morph Index Map from Animation Clips

**File:** `src/render/Renderer3D.ts`

- [ ] Create function `buildClipMorphIndexMap(clips: AnimationClip[]): Map<string, Set<number>>` that parses clip tracks to find which morph target indices each clip references
- [ ] Use existing `parseMorphTrackBinding()` to extract index from `morphTargetInfluences[i]` track names
- [ ] Map clip names to `AnimState` using `ANIM_NAME_MAP` (import or duplicate the mapping)
- [ ] Return a map from clip name to set of morph target indices

### Phase 2: Scale Geometry Deltas at Load Time

**File:** `src/render/Renderer3D.ts`

- [ ] Create function `scaleBossMorphDeltas(model: Object3D, clips: AnimationClip[]): void`
- [ ] Define scale factor constants per animation category:
  ```typescript
  const MORPH_SCALE_ATTACK = 0.35;
  const MORPH_SCALE_STOMP_PRAYER = 0.4;
  const MORPH_SCALE_DEATH = 0.5;
  ```
- [ ] Call `buildClipMorphIndexMap()` to get index → clip mapping
- [ ] Determine scale factor per morph target index based on which clip it belongs to (idle and style-switch get 1.0, attacks get their respective factors)
- [ ] Traverse model, find all meshes with `geometry.morphAttributes.position`
- [ ] For each targeted morph target index, multiply every value in the `BufferAttribute.array` by the scale factor
- [ ] Set `BufferAttribute.needsUpdate = true` after modification

### Phase 3: Integrate into loadBossGLTF

**File:** `src/render/Renderer3D.ts`

- [ ] Call `scaleBossMorphDeltas(model, gltf.animations)` in `loadBossGLTF()` after `retargetMorphAnimations()` but before `applyUnlitMaterials()` and `AnimationController` creation
- [ ] Remove any leftover per-frame morph scaling from Sprint 019 if present
- [ ] `npm run build` passes

### Phase 4: Remove Sprint 019 Per-Frame Scaling (if present)

**File:** `src/render/Renderer3D.ts`

- [ ] Search for any post-mixer-update morph influence scaling (e.g. `BOSS_MORPH_INFLUENCE_SCALE`) and remove it
- [ ] Verify no `morphTargetInfluences` manipulation outside of AnimationController

### Phase 5: Tuning and Verification

- [ ] Take "before" Playwright screenshots of attack animations (current exploded state)
- [ ] Apply the fix
- [ ] Take "after" screenshots of same animation moments
- [ ] Compare: attacks should look cohesive, idle should be pixel-identical
- [ ] Tune scale factors if needed based on screenshots
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps

## Files Summary

| File | Changes |
|------|---------|
| `src/render/Renderer3D.ts` | New `scaleBossMorphDeltas()` + `buildClipMorphIndexMap()` functions; call in `loadBossGLTF()` after retargeting; remove any per-frame influence scaling |
| `src/render/AnimationController.ts` | No changes — receives clips as-is |

## Definition of Done

- [ ] Attack animations (magic + ranged) look cohesive — boss body stays together
- [ ] Idle animation visually unchanged
- [ ] Style-switch animations visually unchanged
- [ ] Death and stomp animations not degraded (still readable, not exploded)
- [ ] No per-frame morph scaling code remains (all scaling is load-time geometry)
- [ ] Verified via Playwright before/after screenshots
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Frame rate > 30fps (no per-frame overhead added)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scale factors too aggressive — attacks look frozen/stiff | Medium | Low | Factors are tunable constants; start conservative (0.35), increase if needed |
| Scale factors too gentle — attacks still explode | Low | Low | Deltas are well-characterized; 0.35× of 109 avg is ~38, comparable to idle's 32 |
| Re-exported GLTF changes morph target order | Low | Medium | Dynamic discovery from clips (Option B) makes this robust |
| Multi-primitive meshes have separate `morphAttributes` per child | Low | Medium | Traverse all meshes, not just root — `retargetMorphAnimations` already handles this |
| Geometry data is shared between meshes (BufferAttribute reuse) | Low | High | Check for shared geometry before scaling; clone if necessary. Unlikely in this model since each mesh primitive has its own geometry |
| Scaling distorts normals (`morphAttributes.normal`) | Low | Low | Boss uses `MeshBasicMaterial` (no lighting), so normal distortion won't be visible. Scale normals by same factor as a precaution |

## Security

No security implications. Client-side geometry manipulation at load time only.

## Dependencies

- No new npm dependencies
- No changes to cg-sim-player
- No changes to export pipeline or model files
- Three.js `BufferAttribute.array` is a typed array (Float32Array), directly writable

## Open Questions

1. **Exact scale factors:** 0.35 / 0.4 / 0.5 are educated guesses from the delta analysis. May need 1–2 rounds of visual tuning via Playwright screenshots. Should death be scaled at all, or left as-is for dramatic effect?
2. **Should `morphAttributes.normal` also be scaled?** Boss uses unlit `MeshBasicMaterial` so normal morphs don't affect rendering, but scaling them keeps geometry internally consistent. Slight extra work for correctness.
3. **Should stomp and prayer_disable be scaled differently from attacks?** They have different visual character — stomp is a ground pound, prayer_disable is a targeted effect. They might look better with a different factor than attack clips.
4. **Fallback for unknown clips:** If a future GLTF has morph targets not belonging to any recognized clip, should they be left unscaled (safe default) or scaled by a moderate factor?
