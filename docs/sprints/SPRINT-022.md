# Sprint 022: Replace Boss Morph Targets with Skeletal Animation

## Overview

Boss morph target animations cause the model to "explode" during attack transitions because morph targets store absolute vertex positions per frame. The OSRS base mesh is in a spread-out T-pose (~674 wide), idle compresses it to ~363 wide, and any non-idle frame replaces ALL vertex positions simultaneously — making the model nearly double in size. Three prior fix attempts (delta scaling at 0.35x, rebasing to idle frame 0, raw 1.0x) all failed because the problem is fundamental to morph targets.

This sprint replaces the boss-only morph target pipeline with skeletal animation by hand-building a GLTF with bones, skin weights, and TRS animation clips. This matches how the OSRS client actually handles animation: transforms (rotate, translate, scale) applied to vertex groups via a flat bone hierarchy.

**What ships**: Custom skeletal GLTF exporter, skeletal boss model, simplified renderer loading pipeline, boss morph code removal, parity-checked export validation.

**What's deferred**: Crossfade blending between clips (keep immediate stop for now), bone hierarchy inference (stay flat), player model skeletal conversion.

## Use Cases

1. **Idle animation**: Boss renders in idle pose with stable body proportions — no size changes.
2. **Attack transitions**: Switching from idle to attack_magic/attack_ranged does not cause the model to explode or double in size. The Hunlef visibly lifts its head and tail.
3. **All 8 clips preserved**: idle, attack_magic, attack_ranged, stomp, prayer_disable, death, style_switch_mage, style_switch_range — same names, same timing, same state machine behavior.
4. **Rapid transitions**: Quickly switching between animation states produces no visual artifacts (no T-pose flash, no explosion).
5. **Transparent faces stay attached**: Alpha primitive remains bound to the same skeleton and animates in sync with the opaque body.
6. **Developer parity check**: Export script validates skeletal poses against existing morph vertex data, catching transform math bugs before they reach the browser.
7. **Validator updated**: `npm run validate-gltf` validates skeletal structure (skins, joints, weights) instead of morph targets for the boss asset.

## Architecture

### Why Skeletal Animation Fixes This

Morph targets: frame N stores absolute positions for ALL vertices → transitioning replaces every vertex position at once → proportions break.

Skeletal animation: frame N stores bone transforms (position, rotation, scale) applied to vertex groups → transitioning changes bone poses → mesh deforms around bone pivots → proportions stay stable.

### OSRS Animation Data Model

```
Model:
  vertexPositionsX/Y/Z[]     — raw vertex coordinates (base mesh)
  vertexGroups[][]           — vertexGroups[groupIdx] = [vertexIdx, ...]
                               165 groups, 154 non-empty, covering all 2180 vertices exactly once

Framemap (skeleton definition):
  types[]                    — transform type per slot (0=origin, 1=translate, 2=rotate, 3=scale)
  frameMaps[][]              — which vertex groups each slot affects

Frame (one pose):
  indexFrameIds[]            — which framemap slots to apply (sequential)
  translator_x/y/z[]        — transform values per slot

Sequence (animation clip):
  frameIDs[]                 — packed as (skeletonArchiveId << 16 | frameIndex), 1-indexed
  frameLengths[]             — duration per frame in client ticks (20ms each)
```

### Bone Hierarchy: Flat

OSRS vertex groups have no parent-child relationships. Each group is independently transformed. The skeleton is flat — one root joint plus one child joint per vertex group:

```
joint_root (identity, non-influencing)
├── joint_vg_000  (vertex group 0)
├── joint_vg_001  (vertex group 1)
├── ...
└── joint_vg_164  (vertex group 164)
```

Keep empty vertex groups as identity joints so cache group IDs and joint IDs are a direct 1:1 map. No remap table needed.

### Skinning: Rigid One-Hot Weights

Each vertex is bound to exactly one bone with weight 1.0:

```
JOINTS_0[v]  = [vertexGroup[v] + 1, 0, 0, 0]   // +1 because root is at index 0
WEIGHTS_0[v] = [1.0, 0.0, 0.0, 0.0]
```

Use identity inverse bind matrices for all joints. The exported bone tracks store model-space transforms under the flat hierarchy (local == world for each joint).

### Keyframe Extraction: Direct Transform Tracking

For each animation frame, replay the OSRS `animate()` logic at the bone level to extract per-bone TRS values:

```
Initialize per-bone state:
  groupMatrix[g] = identity (4x4)
  animOffsets = (0, 0, 0)

For each transform in frame (sequential):
  type = framemap.types[slot]
  groups = framemap.frameMaps[slot]
  dx, dy, dz = translator values

  Type 0 (set rotation/scale origin):
    Compute weighted centroid of affected groups (by vertex count)
    animOffsets = (dx, dy, dz) + weightedCentroid

  Type 1 (translate):
    For each affected group: left-multiply translation(dx, dy, dz) into groupMatrix[g]

  Type 2 (rotate around animOffsets):
    angle encoding: (value & 255) * 8 → radians: angleUnits * PI / 1024
    rotation order: Z → X → Y (matching ModelLoader.animate())
    For each affected group:
      Translate to origin (-animOffsets), apply rotation, translate back (+animOffsets)
      Left-multiply into groupMatrix[g]

  Type 3 (scale around animOffsets):
    scale encoding: value / 128 (128 = 1.0x)
    For each affected group:
      Translate to origin, apply scale, translate back
      Left-multiply into groupMatrix[g]

After frame: convert each groupMatrix to GLTF space and decompose to position/quaternion/scale
```

### Coordinate System Conversion

OSRS uses a right-handed coordinate system with inverted Y and Z relative to GLTF. Apply a fixed basis-change matrix:

```
OSRS_TO_GLTF = makeScale(1, -1, -1)
M_gltf = OSRS_TO_GLTF * M_osrs * OSRS_TO_GLTF   // conjugation preserves rotations
gltfMatrix.decompose(position, quaternion, scale)
```

### Keyframe Timing

OSRS `frameLengths` are in client ticks (20ms each). Convert to cumulative seconds:

```ts
let t = 0;
for (const length of frameLengths) {
  times.push(t);
  t += length / 50;  // 50 ticks per second
}
```

Interpolation is **STEP** (frame holds for its duration), matching OSRS which does not interpolate between frames.

### GLTF Output Structure

```
corrupted_hunlef.gltf
├── nodes: [bossRoot, joint_root, joint_vg_000, ..., joint_vg_164]
├── meshes: [{
│     primitives: [
│       { POSITION, TEXCOORD_0, JOINTS_0, WEIGHTS_0, material: opaque },
│       { POSITION, TEXCOORD_0, JOINTS_0, WEIGHTS_0, material: alpha }
│     ]
│   }]
├── skins: [{
│     skeleton: joint_root_idx,
│     joints: [joint_root_idx, joint_vg_000_idx, ...],
│     inverseBindMatrices: accessor (all identity)
│   }]
├── animations: [idle, attack_magic, attack_ranged, stomp, prayer_disable,
│                death, style_switch_mage, style_switch_range]
│   Each animation has TRS channels per bone, STEP interpolation
├── materials: [opaque_material, alpha_material]  // UV palette texture
└── buffers: geometry + skin + animation data
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

`applyUnlitMaterials()` already works with any mesh type (SkinnedMesh inherits from Mesh). `AnimationController` is animation-type-agnostic — it wraps `THREE.AnimationMixer` and maps clip names to states. No changes needed to either.

## Implementation

### Phase 1: Guard Rails and Data Extraction (~10%)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] Create new export script alongside existing `export-gltf.mjs`
- [ ] Load model definition: `cache.getAllFiles(IndexType.MODELS, BOSS_MODEL_ID)`
- [ ] Assert all 8 sequences exist and have `animMayaID === -1` (legacy frame-based)
- [ ] Assert `vertexGroups` cover every vertex exactly once
- [ ] Log: group count, non-empty group count, vertex count, face count
- [ ] Build `vertexToGroup` lookup from `vertexGroups[][]`
- [ ] Compute `groupVertexCounts[g]` and `groupCentroids[g]` in OSRS model space
- [ ] Split faces into opaque/alpha based on `faceAlphas`, reuse deduplication logic from current exporter
- [ ] Build `remappedVertices` mapping (vertex + color pair deduplication)

### Phase 2: Per-Bone Keyframe Extraction (~25%)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] For each of 8 sequences, load frame archives via `cache.getAllFiles(IndexType.FRAMES, skeletonArchiveId)`. Cache by archive ID to avoid redundant loads.
- [ ] Implement `buildFrameGroupMatrices(frame, framemap, groupCentroids, groupVertexCounts)`:
  - Initialize `groupMatrices[g] = identity` for all groups
  - Replay `type 0/1/2/3` transforms sequentially per the Architecture section
  - Return array of 4x4 matrices, one per vertex group
- [ ] Implement OSRS rotation encoding: `((value & 255) * 8) * PI / 1024`, compose Z→X→Y
- [ ] Apply coordinate conversion: `M_gltf = C * M_osrs * C` where `C = scale(1, -1, -1)`
- [ ] Decompose each matrix to position/quaternion/scale
- [ ] Compute cumulative keyframe times from `frameLengths / 50`
- [ ] Skip bones that stay at identity across all frames of a clip (optimization), but always keep at least one key per channel

### Phase 3: Parity Check (~10%)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] For every frame of all 8 sequences, reconstruct posed vertices: `posedVertex = groupMatrices[groupOf(v)] * baseVertex`
- [ ] Compare against the existing morph target vertex data (from `modelDef.loadFrame()` or equivalent)
- [ ] Apply same coordinate conversion to both sides
- [ ] Fail the export if max vertex error exceeds 1 OSRS unit (catches wrong pivot order, rotation encoding, etc.)
- [ ] Log per-frame max error and mean error for debugging

### Phase 4: Build GLTF with Skeletal Data (~25%)

**File:** `tools/cache-reader/export-skeletal-gltf.mjs`

- [ ] Build base geometry buffers: `POSITION` (Float32, Z inverted), face indices
- [ ] Build skin buffers: `JOINTS_0` (Uint16 VEC4), `WEIGHTS_0` (Float32 VEC4)
- [ ] Build UV/texture data: reuse palette texture generation from `addColors()` logic
- [ ] Build joint nodes: one root + one per vertex group
- [ ] Build `inverseBindMatrices` accessor: all identity 4x4 matrices
- [ ] Build skin: `{ skeleton, joints, inverseBindMatrices }`
- [ ] Build animations: for each clip, for each bone:
  - Translation channel: `VectorKeyframeTrack` equivalent → GLTF sampler + channel targeting `translation`
  - Rotation channel: quaternion values → GLTF sampler + channel targeting `rotation`
  - Scale channel: `VectorKeyframeTrack` equivalent → GLTF sampler + channel targeting `scale`
  - All samplers use STEP interpolation
- [ ] Build materials: opaque + alpha (BLEND mode), palette texture
- [ ] Pack buffers, write accessors/bufferViews
- [ ] Apply clip names
- [ ] Write `public/models/corrupted_hunlef.gltf`
- [ ] Delete old morph-target `.bin` buffer files from `public/models/`

### Phase 5: Update Renderer (~15%)

**File:** `src/render/Renderer3D.ts`

- [ ] In `loadBossGLTF()`: remove calls to `retargetMorphAnimations()` and `rebaseMorphDeltasToIdlePose()`
- [ ] Simplified boss loading:
  ```ts
  const model = gltf.scene;
  model.scale.set(BOSS_MODEL_SCALE, BOSS_MODEL_SCALE, BOSS_MODEL_SCALE);
  this.applyUnlitMaterials(model, true);
  this.bossGroup.add(model);
  if (gltf.animations.length > 0) {
    this.animController = new AnimationController(model, gltf.animations);
  }
  ```
- [ ] Keep morph retargeting functions — still used by player body GLTFs
- [ ] Delete `rebaseMorphDeltasToIdlePose()` and `MORPH_REBASE_MARKER` (boss-only, no longer needed)
- [ ] Verify `applyUnlitMaterials()` works with SkinnedMesh (MeshBasicMaterial supports skinning natively in r183)
- [ ] Verify `BOSS_MODEL_SCALE` still produces correct visual size (idle animation should compress to same proportions)
- [ ] JSON fallback path remains unchanged

**File:** `src/render/AnimationController.ts`

- [ ] No structural changes — keep immediate stop transitions
- [ ] Update comment in `crossFadeTo()` to note that immediate stop works for both morph and skeletal (remove morph-specific language)

### Phase 6: Update Validator and Verify (~15%)

**File:** `tools/cache-reader/validate-gltf.mjs`

- [ ] Update boss contract: require `skins.length >= 1`, require `JOINTS_0` and `WEIGHTS_0` on boss primitives, require animation channels targeting `translation`/`rotation`/`scale` (not `weights`), validate joint count matches inverse bind matrix count, validate weight sums ~= 1.0
- [ ] Keep player/static model validation unchanged

**Verification checklist:**

- [ ] `npm run build` passes
- [ ] `npm test` — all 193 tests pass
- [ ] `npm run validate-gltf` passes with updated skeletal validation
- [ ] Run dev server, trigger each animation state:
  - Idle loops smoothly, body proportions stable
  - attack_magic / attack_ranged: head/tail lift, no explosion
  - stomp, prayer_disable, style_switch: play once, return to idle
  - death: plays once, clamps on final frame
- [ ] Rapid idle↔attack transitions: no explosion, no T-pose flash
- [ ] Console: no Three.js warnings about skinning, bones, or NaN
- [ ] Frame rate > 30fps
- [ ] Old `.bin` buffer files cleaned up from `public/models/`

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/cache-reader/export-skeletal-gltf.mjs` | **Create** | Reads OSRS model + frame data, extracts per-bone keyframes, builds skeletal GLTF with parity check |
| `public/models/corrupted_hunlef.gltf` | **Replace** | Skeletal GLTF with bones, skin weights, TRS animation clips. Old `.bin` morph files deleted. |
| `src/render/Renderer3D.ts` | **Modify** | Remove boss morph calls, delete `rebaseMorphDeltasToIdlePose()`, simplify `loadBossGLTF()`. Keep morph functions for player. |
| `src/render/AnimationController.ts` | **Minor** | Update comment only. No structural changes. |
| `tools/cache-reader/validate-gltf.mjs` | **Modify** | Boss contract switches from morph validation to skeletal validation |
| `tools/cache-reader/export-gltf.mjs` | **Unchanged** | Kept for static model exports and as reference. Boss export moves to new script. |

## Definition of Done

- [ ] Boss model renders correctly in idle pose (matches current visual proportions)
- [ ] All 8 animations play correctly — idle loops, one-shots play and return to idle, death clamps
- [ ] Attack animations show the Hunlef lifting head/tail WITHOUT exploding or doubling in size
- [ ] Transitions between any two animation states produce no visual artifacts
- [ ] Animation timing matches OSRS frameLengths (each frame holds for `frameLengths[i] * 20ms`)
- [ ] Export-time parity check passes for all frames of all 8 sequences (max error < 1 OSRS unit)
- [ ] Boss morph pipeline removed from `loadBossGLTF()` (`retargetMorphAnimations` and `rebaseMorphDeltasToIdlePose` no longer called for boss)
- [ ] Player morph target loading still works unchanged
- [ ] `npm run validate-gltf` passes with skeletal validation for boss
- [ ] Three.js loads GLTF without console warnings about skinning, bones, or NaN
- [ ] `npm run build` passes
- [ ] `npm test` — all 193 tests pass
- [ ] Fallback JSON boss (static, no animation) still works when GLTF fails to load
- [ ] Old morph-target `.bin` buffer files cleaned up from `public/models/`
- [ ] No new runtime npm dependencies

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bone transform extraction produces incorrect poses (wrong rotation order, angle encoding, pivot math) | Medium | High | Parity check at export time compares skeletal poses against morph vertex data. Fail export if error exceeds threshold. |
| 165 joints exceeds WebGL uniform limits on some GPUs | Low | Medium | Three.js r183 falls back to bone texture if uniform count is exceeded. Test on target hardware. Most modern GPUs support 256+ bones. |
| Multi-primitive SkinnedMesh (opaque + alpha) doesn't render correctly | Low | Medium | Both primitives share the same skin. Three.js supports this. Test with actual model. |
| `BOSS_MODEL_SCALE` needs adjustment due to different rest pose | Medium | Low | Idle animation immediately compresses to correct proportions. Scale was tuned to idle visual. Verify and adjust if needed. |
| Coordinate system mismatch (OSRS ↔ GLTF) | Medium | Medium | Use fixed `OSRS_TO_GLTF = scale(1, -1, -1)` conjugation matrix. Parity check catches coordinate bugs. |
| `loadFrame()` API not available as expected on modelDef | Low | Medium | Fall back to running `animate()` manually against raw vertex arrays for parity comparison. |
| Removing boss morph code accidentally breaks player morph path | Low | Low | Player loading calls morph functions independently. Only remove boss-specific calls. Run player animations to verify. |
| GLTF hand-assembly bugs (buffer packing, accessor layout, skin wiring) | Medium | Medium | Use `npx gltf-validator` + `validate-gltf.mjs` + visual inspection. The GLTF spec is well-documented. |

## Security

No security implications. All changes are build-time export tooling and client-side rendering. No new runtime dependencies, no network calls, no user input changes.

## Dependencies

- `osrscachereader` (existing build-time tool) — `RSCache`, `IndexType.MODELS`, `IndexType.FRAMES`, `IndexType.CONFIGS`, `ConfigType.SEQUENCE`, frame/framemap loading APIs
- Three.js r183 runtime — `SkinnedMesh`, `Skeleton`, `Bone`, `AnimationMixer` (all stable APIs)
- OSRS cache version 232
- `cg-sim-player` is read-only — no changes needed (animation type doesn't affect game logic)

## Open Questions

1. **Buffer format**: Should the new GLTF use a single external `.bin` file, multiple files, or inline base64? Single file is simplest for git management. Decide during Phase 4.
2. **STEP vs LINEAR interpolation**: STEP matches OSRS exactly (no inter-frame smoothing). LINEAR would be smoother. Start with STEP; switching is a one-line change per sampler later.
3. **Crossfade between clips**: Deferred to follow-up sprint. Keep immediate stop for now to isolate skeletal migration from transition behavior changes.
4. **Empty vertex groups**: Keep as identity joints for stable indexing (group ID == joint ID + 1). Simplifies debugging. If file size is a concern, optimize later.
5. **Color/UV export**: Reuse palette texture generation logic from current exporter's `addColors()`. Port the color computation code directly into the new script.
