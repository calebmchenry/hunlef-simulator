# Sprint 022: Replace Morph Target Animations with Skeletal Animation

## Overview

Boss morph target animations cause the model to "explode" during attack transitions because morph targets store absolute vertex positions per frame. The OSRS base mesh is in a spread-out T-pose, idle compresses it ~50%, and any non-idle frame replaces ALL vertex positions simultaneously — making the model double in size during transitions. Three prior fix attempts (delta scaling, rebasing to idle frame 0, raw 1.0x) all failed because the problem is fundamental to morph targets.

This sprint replaces the morph target pipeline with skeletal animation (Three.js `SkinnedMesh` + `Skeleton` + `Bone`), which is how the OSRS client actually handles animation. The export script is rewritten to read OSRS vertex group transforms directly from cache frame data and emit GLTF with bones, skin weights, and skeletal animation clips. The renderer's morph-specific code is removed. The AnimationController is unchanged — it already works with any `THREE.AnimationClip` type.

**What ships**: New skeletal GLTF export script, skeletal boss model, simplified renderer loading pipeline, morph target code removal.

**What's deferred**: Crossfade blending between clips (keep immediate stop for now), bone hierarchy inference (stay flat), player model skeletal conversion.

## Use Cases

1. **Idle animation**: Boss renders in idle pose identical to current visual appearance — body proportions are stable.
2. **Attack transitions**: Switching from idle to attack_magic/attack_ranged does not cause the model to explode or double in size. The Hunlef visibly lifts its head and tail during attacks.
3. **All 8 clips preserved**: idle, attack_magic, attack_ranged, stomp, prayer_disable, death, style_switch_mage, style_switch_range — same names, same timing, same state machine behavior.
4. **Rapid transitions**: Quickly switching between animation states produces no visual artifacts (no T-pose flash, no explosion).
5. **Death animation**: Clamps on final frame as before.
6. **Fallback path**: JSON boss fallback (static, no animation) remains functional.
7. **Export reproducibility**: Running the export script against the same cache version produces a valid skeletal GLTF that Three.js loads without errors or warnings.

## Architecture

### Why Skeletal Animation Fixes This

Morph targets: frame N stores absolute positions for ALL vertices → transitioning replaces every vertex position at once → proportions break.

Skeletal animation: frame N stores bone transforms (position, rotation, scale) applied to vertex groups → transitioning changes bone poses → mesh deforms smoothly around bone pivots → proportions stay stable.

### OSRS Animation Data Model

The OSRS cache stores animation as transforms on vertex groups (bone equivalents):

```
Model:
  vertexPositionsX/Y/Z[]     — raw vertex coordinates (base mesh)
  vertexSkins[]              — per-vertex group assignment (bone index)
  vertexGroups[][]           — inverted index: vertexGroups[groupIdx] = [vertexIdx, ...]

Framemap (skeleton definition):
  types[]                    — transform type per slot (0=origin, 1=translate, 2=rotate, 3=scale)
  frameMaps[][]              — which vertex groups each slot affects

Frame (one pose):
  indexFrameIds[]            — which framemap slots to apply
  translator_x/y/z[]        — transform values (translation deltas, rotation angles, scale factors)

Sequence (animation clip):
  frameIDs[]                 — packed as (skeletonArchiveId << 16 | frameIndex)
  frameLengths[]             — duration per frame in client ticks (20ms each)
```

### Bone Hierarchy: Flat

OSRS vertex groups have no parent-child relationships. Each group is independently transformed. The skeleton is **flat** — every bone is a root bone. Three.js handles root-only skeletons correctly.

```
Skeleton
 ├── Bone_0  (vertex group 0)
 ├── Bone_1  (vertex group 1)
 ├── ...
 └── Bone_N  (vertex group N)
```

### Bone Rest Pose and Skin Binding

Each bone's rest position is the **centroid of its vertex group** in the base mesh:

```ts
// For each vertex group g:
restCentroid[g] = mean(vertexPositions[v] for v in vertexGroups[g])
```

Skin binding is **rigid** — each vertex is bound to exactly one bone with weight 1.0:

```
JOINTS_0[v] = [vertexSkins[v], 0, 0, 0]   // vec4, only first component used
WEIGHTS_0[v] = [1.0, 0.0, 0.0, 0.0]       // full weight on one bone
```

The `inverseBindMatrix` for each bone is `translate(-restCentroid[g])`, transforming vertices from mesh space to bone-local space.

### Keyframe Extraction: Direct Transform Tracking

Rather than computing final vertex positions and solving for bone transforms (which requires SVD), we **directly track per-bone transforms** by replaying the OSRS `animate()` logic at the bone level.

For each animation frame:

```
Initialize per-bone state:
  bone_position[g] = restCentroid[g]    // current world position
  bone_quaternion[g] = identity
  bone_scale[g] = (1, 1, 1)
  animOffsets = (0, 0, 0)               // shared rotation/scale origin

For each transform in frame (sequential):
  type = framemap.types[indexFrameId]
  groups = framemap.frameMaps[indexFrameId]
  dx, dy, dz = translator values

  Type 0 (set origin):
    // Vertex-count-weighted centroid of affected groups + offset
    totalVerts = 0
    weightedSum = (0, 0, 0)
    for g in groups:
      weightedSum += bone_position[g] * vertexCount[g]
      totalVerts += vertexCount[g]
    animOffsets = (dx, dy, dz) + weightedSum / totalVerts

  Type 1 (translate):
    for g in groups:
      bone_position[g] += (dx, dy, dz)

  Type 2 (rotate around animOffsets):
    // OSRS angle encoding: angle_units = (value & 255) * 8
    // Radians: angle_units * PI / 1024
    // Rotation order: Z → X → Y (matching OSRS)
    R = eulerToQuaternion(dx, dy, dz)   // ZXY order, OSRS encoding
    for g in groups:
      offset = bone_position[g] - animOffsets
      bone_position[g] = animOffsets + R * offset
      bone_quaternion[g] = R * bone_quaternion[g]

  Type 3 (scale around animOffsets):
    // OSRS scale encoding: value / 128 (128 = 1.0x)
    sx, sy, sz = dx/128, dy/128, dz/128
    for g in groups:
      offset = bone_position[g] - animOffsets
      bone_position[g] = animOffsets + (sx*offset.x, sy*offset.y, sz*offset.z)
      bone_scale[g] *= (sx, sy, sz)
```

This is mathematically equivalent to the per-vertex `animate()` function because:
- Type 0 computes a vertex-count-weighted centroid, which equals the bone-position-weighted average (since all vertices in a group share the same bone transform)
- Types 1/2/3 are uniform within a group — the centroid transforms identically to any individual vertex

### GLTF Output Structure

```
corrupted_hunlef.gltf
├── nodes: [meshNode, bone_0, bone_1, ..., bone_N]
├── meshes: [{
│     primitives: [
│       { POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0, material: opaque },
│       { POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0, material: alpha }
│     ]
│   }]
├── skins: [{
│     joints: [bone_0_idx, bone_1_idx, ...],
│     inverseBindMatrices: accessor
│   }]
├── animations: [idle, attack_magic, attack_ranged, stomp, prayer_disable,
│                death, style_switch_mage, style_switch_range]
│   Each animation has channels for each bone's translation/rotation/scale
│   using STEP interpolation (matches OSRS frame-hold behavior)
├── materials: [opaque_material, alpha_material]  // UV palette texture
└── buffers/accessors: binary geometry + animation data
```

### Keyframe Timing

OSRS `frameLengths` are in client ticks (20ms each). GLTF keyframe times are cumulative seconds:

```ts
// For sequence with frameLengths [5, 4, 4, ...]
const TICK_MS = 20;
let cumulativeTime = 0;
for (const frameLength of frameLengths) {
  keyframeTimes.push(cumulativeTime);
  cumulativeTime += frameLength * TICK_MS / 1000;
}
```

Interpolation is **STEP** (frame holds for its duration), matching OSRS which does not interpolate between frames within a sequence.

### OSRS Rotation Encoding

The OSRS rotation uses fixed-point trigonometry with a specific angle encoding:

```ts
// Convert OSRS rotation values to radians (ZXY order)
function osrsAngleToRadians(value: number): number {
  const angleUnits = (value & 255) * 8;  // range [0, 2040]
  return angleUnits * Math.PI / 1024;     // full circle = 2048 units
}

// OSRS applies rotations in Z → X → Y order
// Convert to quaternion:
function osrsRotationToQuaternion(dx: number, dy: number, dz: number): Quaternion {
  const rx = osrsAngleToRadians(dx);
  const ry = osrsAngleToRadians(dy);
  const rz = osrsAngleToRadians(dz);
  // Compose: Ry * Rx * Rz (applied right-to-left = Z first)
  return Quaternion.fromEulerZXY(rz, rx, ry);
}
```

### Renderer Loading Pipeline

Current:
```
GLTF Load → retargetMorphAnimations → rebaseMorphDeltasToIdlePose → applyUnlitMaterials → AnimationController
```

New:
```
GLTF Load → applyUnlitMaterials → AnimationController
```

The morph retargeting and rebasing functions are deleted entirely. `applyUnlitMaterials()` already works with any mesh type — it just swaps materials to `MeshBasicMaterial`.

### AnimationController: No Changes

The `AnimationController` wraps `THREE.AnimationMixer` and maps clip names to states. It uses `action.reset()` + `action.play()` + `prevAction.stop()` for transitions. This works identically with skeletal animation clips — the mixer handles bone transforms the same way it handles morph target weights. The current comment about "one-hot morph target animations" in `crossFadeTo()` becomes outdated but the stop-then-play behavior is fine for skeletal animation too.

## Implementation

### Phase 1: Read OSRS Model + Frame Data (~15% effort)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] Create new export script (keep old `export-gltf.mjs` as reference until validated)
- [ ] Load model definition via `cache.getAllFiles(IndexType.MODELS, BOSS_MODEL_ID)`
- [ ] Extract from modelDef:
  - `vertexPositionsX/Y/Z` — base vertex coordinates
  - `vertexSkins` — per-vertex group index (bone assignment)
  - `faceIndicesA/B/C` — triangle indices
  - `faceAlphas` — per-face transparency (for primitive splitting)
  - `faceColors` / texture data (for color export)
- [ ] Build `vertexGroups[][]` from `vertexSkins` (invert the mapping)
- [ ] Compute `restCentroids[]` — mean position of each vertex group
- [ ] Compute `vertexCounts[]` — number of vertices per group (needed for origin calculation)
- [ ] For each of 8 sequences: load all frames via `cache.getAllFiles(IndexType.FRAMES, skeletonArchiveId)` (extracted from `frameIDs[i] >> 16`), load framemaps
- [ ] Invert Z coordinates to match Three.js coordinate system (OSRS uses right-handed with inverted Z)

### Phase 2: Extract Per-Bone Keyframes (~25% effort)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] Implement `osrsAngleToRadians(value)` — `((value & 255) * 8) * Math.PI / 1024`
- [ ] Implement `osrsRotationToQuaternion(dx, dy, dz)` — compose Z→X→Y rotation, output as `[x, y, z, w]` quaternion
- [ ] Implement `extractBoneKeyframes(modelDef, frameDef, restCentroids, vertexCounts)`:
  - Initialize per-bone position/quaternion/scale to rest values
  - Loop through `frameDef.indexFrameIds[]`:
    - Look up `type = framemap.types[indexFrameId]`
    - Look up `groups = framemap.frameMaps[indexFrameId]`
    - Read `dx, dy, dz = translator_x/y/z[j]`
    - Apply type 0/1/2/3 logic to per-bone state (as described in Architecture)
  - Return `{ positions: Float32Array, quaternions: Float32Array, scales: Float32Array }` for all bones
- [ ] Implement `extractAnimationClip(name, sequence, frames, framemaps, modelDef, restCentroids, vertexCounts)`:
  - For each frame in sequence: call `extractBoneKeyframes()`
  - Compute cumulative keyframe times from `frameLengths` (20ms per tick)
  - Return structured clip data: `{ name, times, boneKeyframes[] }`
- [ ] Handle coordinate system conversion: OSRS Y is up (same as Three.js), but Z is inverted. Apply `z = -z` consistently when reading positions and when computing rotations.
- [ ] Validate: for idle frame 0, bone transforms should be near-identity (small adjustments from T-pose to idle)

### Phase 3: Build GLTF with Skeletal Data (~30% effort)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] Split mesh into two primitives (opaque + alpha) based on `faceAlphas`, matching current exporter behavior:
  - Primitive 0: faces where `faceAlphas[i] === 0 || faceAlphas[i] === 255` (fully opaque)
  - Primitive 1: faces where `faceAlphas[i]` is other values (semi-transparent)
  - Remap vertex indices per primitive (deduplicate shared vertices)
- [ ] For each primitive, generate attribute buffers:
  - `POSITION`: Float32Array of vertex positions (mesh space, Z inverted)
  - `JOINTS_0`: Uint8Array (or Uint16Array if >256 groups) of `[vertexSkins[v], 0, 0, 0]`
  - `WEIGHTS_0`: Float32Array of `[1.0, 0.0, 0.0, 0.0]`
  - `TEXCOORD_0`: UV coordinates for palette texture (reuse logic from `addColors()`)
- [ ] Generate bone nodes: one per vertex group, `translation = restCentroid[g]` (Z inverted)
- [ ] Generate `inverseBindMatrices` accessor: one 4x4 matrix per bone = `translate(-restCentroid[g])`
- [ ] Generate skin: `{ joints: [boneNodeIndices], inverseBindMatrices: accessorIdx }`
- [ ] Generate mesh node: `{ mesh: 0, skin: 0 }`
- [ ] Generate animations: for each of 8 clips:
  - For each bone, create 3 channels: translation, rotation, scale
  - Sampler: input = keyframe times accessor, output = keyframe values accessor, interpolation = "STEP"
  - Skip bones that don't move (identity transform across all frames) to reduce file size
- [ ] Generate materials and palette texture (reuse color data from `modelDef` / `addColors()` logic)
- [ ] Pack all binary data into buffer(s) — either one large `.bin` file or inline base64
- [ ] Write accessors, bufferViews, and buffer references
- [ ] Apply clip names: `["idle", "attack_magic", "attack_ranged", "stomp", "prayer_disable", "death", "style_switch_mage", "style_switch_range"]`
- [ ] Write `corrupted_hunlef.gltf` to `public/models/`

### Phase 4: Update Renderer (~15% effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Delete `parseMorphTrackBinding()`
- [ ] Delete `reserveUniqueName()`
- [ ] Delete `collectMorphRetargetCandidates()`
- [ ] Delete `retargetMorphAnimations()`
- [ ] Delete `rebaseMorphDeltasToIdlePose()`
- [ ] Delete `MorphTrackBinding` and `MorphRetargetCandidate` interfaces
- [ ] Delete `MORPH_RETARGET_MARKER` and `MORPH_REBASE_MARKER` constants
- [ ] Simplify `loadBossGLTF()`:
  ```ts
  private loadBossGLTF(): void {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}models/corrupted_hunlef.gltf`,
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(BOSS_MODEL_SCALE, BOSS_MODEL_SCALE, BOSS_MODEL_SCALE);
        this.applyUnlitMaterials(model, true);
        this.bossGroup.add(model);

        if (gltf.animations.length > 0) {
          this.animController = new AnimationController(model, gltf.animations);
        }

        console.log(`[Renderer3D] GLTF boss loaded with ${gltf.animations.length} animations`);
      },
      undefined,
      (_error) => {
        console.warn('[Renderer3D] GLTF load failed, using static JSON model');
        this.loadBossJSON();
      },
    );
  }
  ```
- [ ] Remove morph-related calls from `loadPlayerGLTFs()` for boss only (player morph retargeting stays — player models are out of scope)
  - Note: `retargetMorphAnimations()` is also called for player body variants. Extract only the boss-related removal; player morph code must remain until player models are converted in a separate sprint.
- [ ] Verify `BOSS_MODEL_SCALE` still produces correct visual size. The skeletal mesh may have different bounding dimensions than the morph-based mesh since the rest pose is the base T-pose (with bones at rest centroids). If the idle animation compresses the mesh to the correct proportions, the scale should be the same. If not, adjust the constant.
- [ ] Verify `applyUnlitMaterials()` works with `SkinnedMesh` — `MeshBasicMaterial` supports skinning in Three.js r183; no special handling needed.

### Phase 5: Handle Player Morph Code Separation (~5% effort)

**File:** `src/render/Renderer3D.ts`

- [ ] The morph retargeting functions are currently used by both boss and player loading paths. Since player models still use morph targets, we need to either:
  - **Option A**: Keep the morph functions but only call them for player models (remove calls in `loadBossGLTF()`, keep calls in `loadPlayerGLTFs()`)
  - **Option B**: Move the morph functions to a separate utility file (e.g., `src/render/morphUtils.ts`) and import only where needed
- [ ] Choose Option A (simpler, less churn) — the morph functions stay in Renderer3D.ts, just unused by boss loading
- [ ] If Option A leaves dead code that's only used by player paths, add a comment noting it's for player morph targets and will be removed when player models are converted

### Phase 6: Verification (~10% effort)

- [ ] `npm run build` passes
- [ ] `npm test` — all 193 tests pass
- [ ] `cd ../cg-sim-player && npm test` passes (no RNG change — animation type doesn't affect game logic)
- [ ] Run dev server, trigger each animation state:
  - Idle loops smoothly
  - attack_magic: Hunlef lifts head/tail, body stays proportional
  - attack_ranged: same — no explosion
  - stomp, prayer_disable, style_switch: play once, return to idle
  - death: plays once, clamps on final frame
- [ ] Rapid idle↔attack transitions: no explosion, no T-pose flash
- [ ] Console: no Three.js warnings about missing bones, invalid skinning, NaN transforms
- [ ] GLTF validation: run `npx gltf-validator public/models/corrupted_hunlef.gltf` — no errors
- [ ] Frame rate > 30fps (skeletal animation is typically faster than morph targets for many targets)
- [ ] File size comparison: new GLTF should be significantly smaller (bone keyframes vs. per-vertex morph targets for 302 .bin files)

## Files Summary

| File | Changes |
|------|---------|
| `tools/cache-reader/export-skeletal-gltf.mjs` | **New.** Reads OSRS model + frame data from cache, extracts per-bone keyframes via direct transform tracking, builds GLTF with SkinnedMesh + Skeleton + skeletal animation clips. Replaces `export-gltf.mjs` for boss model export. |
| `public/models/corrupted_hunlef.gltf` | **Replaced.** Skeletal GLTF with bones, skin weights, and bone-keyframed animation clips. Replaces morph-target GLTF. Old `.bin` buffer files removed. |
| `src/render/Renderer3D.ts` | Remove morph-specific functions and interfaces from boss loading path. Simplify `loadBossGLTF()` to just load, scale, apply unlit materials, create AnimationController. Keep morph functions for player loading. |
| `tools/cache-reader/export-gltf.mjs` | **Unchanged.** Kept as reference. Can be removed in a follow-up cleanup. |
| `src/render/AnimationController.ts` | **Unchanged.** Already animation-type-agnostic. |

## Definition of Done

- [ ] Boss model renders correctly in idle pose (matches current visual proportions)
- [ ] All 8 animations play correctly — idle loops, one-shots play and return to idle, death clamps
- [ ] Attack animations show the Hunlef lifting head/tail WITHOUT exploding or doubling in size
- [ ] Transitions between any two animation states produce no visual artifacts
- [ ] Animation timing matches OSRS frameLengths (each frame holds for `frameLengths[i] * 20ms`)
- [ ] Morph target pipeline removed from boss loading path (`retargetMorphAnimations` and `rebaseMorphDeltasToIdlePose` no longer called for boss)
- [ ] Player morph target loading still works (morph functions retained for player path)
- [ ] Export script produces valid GLTF: `npx gltf-validator` reports no errors
- [ ] Three.js loads GLTF without console warnings about skinning, bones, or NaN
- [ ] `npm run build` passes
- [ ] `npm test` — all 193 tests pass
- [ ] `cd ../cg-sim-player && npm test` passes
- [ ] Fallback JSON boss (static, no animation) still works when GLTF fails to load
- [ ] Frame rate > 30fps
- [ ] No new runtime npm dependencies (export script may use osrscachereader APIs)
- [ ] Old morph-target `.bin` buffer files cleaned up from `public/models/`

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bone transform extraction produces incorrect poses (wrong rotation order, angle encoding) | Medium | High | Validate against per-vertex `loadFrame()` output — compute final vertex positions both ways and compare. The OSRS `animate()` function is the ground truth. |
| Non-uniform scale + rotation composition yields slightly wrong vertex positions for some frames | Low | Medium | Per-bone tracking is exact for uniform-within-group transforms. If discrepancies appear, fall back to SVD-based decomposition from vertex positions for affected frames. |
| Too many bones or keyframes produces a large GLTF | Low | Low | Skip bones with identity transforms across all frames. Hunlef likely has 20-50 vertex groups; 8 clips × ~14 frames × 50 bones = ~5600 keyframes — trivial. |
| Multi-primitive (opaque + alpha) SkinnedMesh not handled correctly by Three.js | Low | Medium | Three.js supports multi-primitive skinned meshes. Both primitives reference the same skin. Test with the actual model. |
| `BOSS_MODEL_SCALE` needs adjustment due to different rest pose bounding box | Medium | Low | The rest pose is the raw T-pose (wider than idle morph). The idle animation immediately compresses to correct proportions. Scale should be the same since it was tuned to the idle visual, but verify and adjust if needed. |
| Coordinate system mismatch (OSRS Z inversion, Y-up) | Medium | Medium | The existing `loadFrame()` applies `-z` and `-y` conversions. Replicate exactly in bone keyframe extraction. Verify first frame visually matches. |
| Player morph retargeting still works after deleting boss morph calls | Low | Low | Player loading path calls `retargetMorphAnimations()` independently. No shared state between boss and player loading. Run player animations to verify. |

## Security

No security implications. All changes are build-time export tooling and client-side rendering. No new dependencies in the runtime bundle, no network calls, no user input changes.

## Dependencies

- No new runtime npm packages
- `osrscachereader` (existing build-time dependency in `tools/cache-reader/`) — uses `RSCache`, `IndexType.MODELS`, `IndexType.FRAMES`, `IndexType.CONFIGS`, `ConfigType.SEQUENCE`, and frame/framemap loading APIs
- `FramesLoader` and `FramemapLoader` from osrscachereader — may need direct access via `cache.getAllFiles(IndexType.FRAMES, archiveId)` to load frame definitions with framemap data
- Three.js r183 `SkinnedMesh`, `Skeleton`, `Bone` — all stable, well-documented APIs
- `cg-sim-player` is read-only — no changes needed (animation type doesn't affect game logic or RNG)

## Open Questions

1. **Bone hierarchy vs flat**: Using flat (all roots) since OSRS vertex groups have no parent-child data. If animations look wrong due to coupled transforms (multiple groups rotating around a shared origin), we could infer a hierarchy from the framemap — groups that always appear together in type 0 origins might share a parent. Start flat, add hierarchy only if needed.
2. **STEP vs LINEAR interpolation**: STEP matches OSRS exactly (frame holds, no inter-frame smoothing). LINEAR would make animations smoother at the cost of accuracy. Start with STEP; switching to LINEAR later is a one-line change per animation sampler.
3. **Crossfade between clips**: Skeletal animation supports real crossfading (blending bone transforms), unlike morph targets which explode when blended. The AnimationController currently uses immediate stop. Enabling crossfade (`action.crossFadeTo(next, duration)`) would make transitions smoother. Deferred — keep immediate stop for now, test crossfade as a follow-up.
4. **Old .bin file cleanup**: The current morph-target GLTF references 302 external `.bin` files in `public/models/`. These should be deleted when the new skeletal GLTF is validated. Include in Phase 6 verification.
5. **Color/UV export**: The current `addColors()` in osrscachereader generates a UV palette texture. The new exporter needs to replicate this — either by calling `addColors()` on a temporary `GLTFExporter` instance and extracting the texture data, or by reimplementing the palette generation from `modelDef` face colors.
6. **Vertex group count**: The exact number of vertex groups in the Corrupted Hunlef model is unknown until we inspect `vertexSkins`. If it's very large (>100), consider collapsing groups that are always transformed identically into a single bone.
