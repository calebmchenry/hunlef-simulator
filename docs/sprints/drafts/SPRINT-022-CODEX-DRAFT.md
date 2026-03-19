# Sprint 022: Replace Boss Morph Targets with Skeletal Skinning

## Overview

The boss export path in `tools/cache-reader/export-gltf.mjs` currently calls `osrscachereader`'s morph-based `GLTFExporter.addSequence()`. That asset shape is the reason the boss "explodes" during attack transitions: the mixer is swapping between full-vertex absolute poses instead of blending transforms on rigid vertex groups.

This sprint replaces the boss-only export with a custom skeletal GLTF while keeping the runtime contract stable: same asset name, same eight clip names, same `AnimationController` entry points, same `GLTFLoader` path in `Renderer3D`. The key local fact that makes this practical is that `docs/assets/models/model_38595.json` exposes 165 `vertexGroups`, and all 2,180 vertices are covered exactly once. Hunllef can therefore use rigid one-hot skinning: one joint per OSRS vertex group, no blended weights, no hierarchy inference.

Static assets (`tornado`, `projectile_magic`, `projectile_ranged`) stay on the current `osrscachereader` exporter path. Player morph retargeting also stays in place. This sprint is specifically about the boss asset and the boss load/runtime path.

## Use Cases

1. As a player, I can spam idle -> magic attack -> idle and the Hunllef keeps the same body proportions instead of doubling in width.
2. As a player, attack animations visibly lift the head and tail and return cleanly to idle without a T-pose or exploded transition.
3. As a player, transparent faces remain attached to the opaque body while animating.
4. As a developer, the boss still exposes the same eight named clips to `AnimationController`.
5. As a developer, `Renderer3D` no longer contains boss-only morph rebasing logic, while the player morph path continues to work unchanged.
6. As a developer, `validate-gltf` fails if the boss asset accidentally regresses back to morph-target animation or ships invalid skin/joint data.

## Architecture

### 1. Boss Export switches from morph targets to a custom skinned GLTF

`tools/cache-reader/export-gltf.mjs` should keep its current responsibility as the orchestration script, but the boss branch should stop using `osrscachereader`'s morph-based `GLTFExporter.addSequence()`.

Recommended split:

- Keep `GLTFExporter` for static asset exports only.
- Add a local `SkeletalBossExporter` helper responsible for loading the boss `modelDef`, preserving the current opaque/alpha primitive split and palette-texture material path, and emitting glTF `skin`, `nodes`, `JOINTS_0`, `WEIGHTS_0`, and TRS animation channels instead of morph targets.

Node layout:

```text
scene
└── boss_root
    ├── joint_root
    │   ├── joint_vg_000
    │   ├── joint_vg_001
    │   └── ...
    └── boss_mesh (mesh=0, skin=0)
```

Keep the output file name and clip names unchanged:

- `public/models/corrupted_hunlef.gltf`
- `idle`
- `attack_magic`
- `attack_ranged`
- `stomp`
- `prayer_disable`
- `death`
- `style_switch_mage`
- `style_switch_range`

Because animation channels now target joint nodes instead of primitive-local `morphTargetInfluences[...]`, the multi-primitive boss mesh no longer needs boss-side track retargeting.

### 2. Skinning model: rigid one-hot weights

Hunllef does not need painterly skin blending. The local model data already matches OSRS's rigid group animation model:

- `vertexGroups.length === 165`
- `154` groups are non-empty
- all `2,180` vertices are assigned to exactly one group
- there are no duplicate or missing vertex assignments

Build a `vertexToGroup` lookup once, then assign every exported vertex to one joint with weight `1.0`.

```ts
const skinIndex = new Uint16Array(exportedVertexCount * 4);
const skinWeight = new Float32Array(exportedVertexCount * 4);

for (const [sourceVertex, remaps] of Object.entries(remappedVertices)) {
  const groupId = vertexToGroup[Number(sourceVertex)] ?? -1;
  const jointIndex = groupId >= 0 ? groupId + 1 : 0; // 0 = root fallback

  for (const { idx } of Object.values(remaps)) {
    skinIndex[idx * 4 + 0] = jointIndex;
    skinWeight[idx * 4 + 0] = 1;
  }
}
```

Implementation details:

- Keep a non-influencing root joint at index `0`.
- Create one child joint for every `vertexGroups` entry, including empty groups, so cache group IDs and joint IDs stay stable.
- Encode `JOINTS_0` as unsigned short `VEC4` and `WEIGHTS_0` as float `VEC4`.
- Use identity inverse bind matrices for all joints; the exported bone tracks will store full model-space transforms under a flat hierarchy, so local == world for each group joint.

The loaded Three.js scene should behave like this, even if the glTF is written manually:

```ts
const armatureRoot = new THREE.Bone();
armatureRoot.name = 'joint_root';

const bones = [armatureRoot];
for (let i = 0; i < modelDef.vertexGroups.length; i++) {
  const bone = new THREE.Bone();
  bone.name = `joint_vg_${String(i).padStart(3, '0')}`;
  armatureRoot.add(bone);
  bones.push(bone);
}

const skeleton = new THREE.Skeleton(bones);
const mesh = new THREE.SkinnedMesh(geometry, material);
mesh.add(armatureRoot);
mesh.bind(skeleton);
```

### 3. Convert OSRS frame data into per-joint TRS

Do not infer a hierarchy from framemap slots. Do not fit morph deltas back into bones. Use the exact `ModelLoader.animate()` semantics and turn them into one matrix per vertex group.

Current source of truth from `osrscachereader`:

- type `0`: compute pivot/origin from affected groups
- type `1`: translate affected groups
- type `2`: rotate affected groups around the current pivot
- type `3`: scale affected groups around the current pivot

Recommended approach:

1. Precompute `groupVertexCounts[groupId]` and `groupCentroids[groupId]` in raw OSRS model space.
2. For each frame, initialize `groupMatrices[groupId] = identity`.
3. Replay each transform entry from `frame.indexFrameIds` in order.
4. For type `0`, compute the pivot as the weighted average of the currently transformed group centroids.
5. For type `1/2/3`, left-multiply the corresponding matrix into every targeted group matrix.
6. After the frame is finished, convert each matrix into glTF/Three space and decompose it to `position`, `quaternion`, `scale`.

Use a fixed axis-basis conversion rather than re-deriving sign flips everywhere:

```ts
const OSRS_TO_GLTF = new THREE.Matrix4().makeScale(1, -1, -1);

const rawMatrix = groupMatrices[groupId];
const gltfMatrix = new THREE.Matrix4()
  .copy(OSRS_TO_GLTF)
  .multiply(rawMatrix)
  .multiply(OSRS_TO_GLTF);

gltfMatrix.decompose(position, quaternion, scale);
```

Rotation order must match `ModelLoader.animate()` exactly. The library applies them in this sequence after subtracting the pivot:

1. `dz` -> Z rotation
2. `dx` -> X rotation
3. `dy` -> Y rotation

So the exporter should compose the rotation matrix in that same order, not in arbitrary Euler order.

Frame timing should keep the current contract:

```ts
let t = 0;
for (const length of seqDef.frameLengths) {
  times.push(t);
  t += length / 50; // same conversion used by current morph exporter
}
```

Track pattern:

```ts
new THREE.VectorKeyframeTrack(`${jointName}.position`, times, positions);
new THREE.QuaternionKeyframeTrack(`${jointName}.quaternion`, times, quaternions);
new THREE.VectorKeyframeTrack(`${jointName}.scale`, times, scales);
```

All eight current Hunllef sequences in `docs/assets/defs/sequences` are legacy frame-based (`animMayaID === -1`), so the sprint can explicitly scope to the `frameIDs` path and fail fast if that assumption changes.

### 4. Preserve current mesh/material behavior

Keep the current boss material contract:

- one opaque primitive
- one alpha primitive
- one palette texture / UV color lookup
- transparent faces remain `alphaMode: "BLEND"`

The safest path is to fork the current `GLTFExporter` geometry setup rather than rewrite it from scratch:

- reuse its `remappedVertices` mapping
- reuse its face split between `faces` and `alphaFaces`
- reuse its `addColors()` palette texture generation
- add joint/weight accessors alongside `POSITION` and `TEXCOORD_0`

That keeps the visual output close to the current boss GLTF while changing only the animation representation.

### 5. Runtime path stays small and boss-specific

`src/render/Renderer3D.ts` already has the right top-level shape. The boss loader should become simpler:

- keep `GLTFLoader.load(...)`
- keep `model.scale.set(BOSS_MODEL_SCALE, ...)`
- keep `applyUnlitMaterials(...)`
- delete boss-side `retargetMorphAnimations(...)`
- delete `rebaseMorphDeltasToIdlePose(...)`
- keep the JSON fallback path

Important nuance: `retargetMorphAnimations()` cannot be removed globally because the player body GLTFs still use morph targets. This sprint should only stop using it for the boss.

`applyUnlitMaterials()` already traverses `Mesh`; `SkinnedMesh` inherits from `Mesh`, so the material swap to `MeshBasicMaterial` remains valid. No special skinning flag should be needed in Three r183.

`AnimationController.ts` should keep its external API and clip-name map, but the morph-specific transition rule becomes obsolete. Recommended change:

```ts
const BLEND_SECONDS = 0.12;

nextAction.reset();
nextAction.play();

if (prevAction && prevAction !== nextAction) {
  nextAction.crossFadeFrom(prevAction, BLEND_SECONDS, false);
}
```

Also force the initial idle pose immediately after construction so the model does not render a raw bind-pose frame on first load:

```ts
this.playIdle();
this.mixer.update(0);
```

## Implementation

### Phase 0: Guard rails and data assertions

- [ ] In `tools/cache-reader/export-gltf.mjs`, assert that all eight boss sequences exist and have `animMayaID === -1`.
- [ ] Add a small preflight check that the boss `modelDef.vertexGroups` cover every vertex exactly once.
- [ ] Log the boss group count, non-empty group count, vertex count, and face count before export.
- [ ] Decide whether `three` math classes will be imported from the root package or declared explicitly in `tools/cache-reader/package.json`. Preferred: declare it explicitly in the tool package.

### Phase 1: Build the boss skinned-export helper

- [ ] Add `tools/cache-reader/SkeletalBossExporter.mjs`.
- [ ] Port the current boss geometry setup from `osrscachereader`'s `GLTFExporter`, including `faces` / `alphaFaces`, `verticies` / `alphaVertices`, `indices` / `alphaIndices`, `remappedVertices`, and palette texture generation.
- [ ] Add `buildVertexToGroupMap(modelDef)` and store `groupVertexCounts` / `groupCentroids`.
- [ ] Add accessors/bufferViews for `JOINTS_0`, `WEIGHTS_0`, and identity `inverseBindMatrices`.
- [ ] Emit a glTF `skin` and joint-node array with stable names like `joint_vg_000`.

### Phase 2: Convert cache frames into joint animations

- [ ] Cache frame archives by `frameID >> 16` so multiple sequences do not reload the same frame data.
- [ ] Implement `buildFrameGroupMatrices(frame)` by replaying the `type 0/1/2/3` logic from `ModelLoader.animate()` against per-group matrices and centroids.
- [ ] Convert each raw matrix into glTF/Three space with the fixed basis-change matrix.
- [ ] Decompose to translation/quaternion/scale and append key values for every joint.
- [ ] Generate one `AnimationClip`-equivalent glTF animation per sequence with the current clip names and cumulative times from `frameLengths / 50`.
- [ ] Skip redundant trailing keys when a joint stays at identity for an entire clip, but always keep a first key per channel so glTF loaders have a stable rest sample.

### Phase 3: Verify exporter math before wiring runtime

- [ ] Add an exporter-side parity check that reconstructs posed vertices from `groupMatrices[groupOfVertex] * baseVertex` and compares them against `modelDef.loadFrame(...).vertices`.
- [ ] Run that parity check for every frame of all eight boss sequences.
- [ ] Fail the export if max vertex error exceeds a small threshold (for example `<= 1 OSRS unit`), because a wrong pivot order is worse than a loud export failure.
- [ ] Regenerate `public/models/corrupted_hunlef.gltf` and inspect the raw JSON for one `skin`, joint nodes, `JOINTS_0` / `WEIGHTS_0`, no boss morph targets, and eight animations with the expected names.

### Phase 4: Runtime integration

- [ ] Update `src/render/Renderer3D.ts` `loadBossGLTF()` to remove boss-only `retargetMorphAnimations(...)` and `rebaseMorphDeltasToIdlePose(...)`.
- [ ] Keep player-body morph retargeting unchanged.
- [ ] Add boss-load logging for `SkinnedMesh` count, joint count, and clip names.
- [ ] Update `src/render/AnimationController.ts` to use a short real crossfade for non-death transitions.
- [ ] Apply `mixer.update(0)` after starting idle so the first rendered frame is posed.
- [ ] Re-check `BOSS_MODEL_SCALE` against the new idle pose and adjust only if the visual footprint changed.

### Phase 5: Validation and cleanup

- [ ] Update `tools/cache-reader/validate-gltf.mjs` so the boss contract becomes skeletal instead of morph-based: require `skins.length >= 1`, require boss primitives to have `JOINTS_0` and `WEIGHTS_0`, require boss animation channels to target `translation`, `rotation`, or `scale`, reject boss `weights` channels / morph targets, validate joint count against inverse bind matrix count, and validate weight sums ~= `1.0`.
- [ ] Remove `rebaseMorphDeltasToIdlePose()` if it is no longer used anywhere.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `npm run validate-gltf`.
- [ ] Manual verification in the 3D client: idle loops without pose popping, magic/ranged attacks keep body proportions, style switches/stomp/prayer disable/death still play, rapid idle <-> attack transitions no longer explode, and there are no Three.js skinning warnings in the console.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/cache-reader/export-gltf.mjs` | Modify | Keep orchestration, but route boss export through the skeletal exporter while leaving static model exports on the current path |
| `tools/cache-reader/SkeletalBossExporter.mjs` | Create | Build boss mesh primitives, joint data, inverse bind matrices, and TRS animation channels |
| `tools/cache-reader/validate-gltf.mjs` | Modify | Replace boss morph validation with skin/joint/animation validation |
| `tools/cache-reader/package.json` | Modify | Add explicit `three` dependency if the exporter imports Three math classes directly |
| `src/render/Renderer3D.ts` | Modify | Remove boss morph preprocessing, keep boss GLTF loading/fallback, and log skinned asset info |
| `src/render/AnimationController.ts` | Modify | Replace morph-era hard cuts with short skeletal crossfades and apply idle pose immediately |
| `public/models/corrupted_hunlef.gltf` | Regenerate | Boss asset becomes skinned instead of morph-target animated |

## Definition of Done

- [ ] The boss GLTF loads as a skinned asset, not a morph-target asset.
- [ ] The boss retains the same eight public clip names.
- [ ] Idle, attack, stomp, prayer-disable, style-switch, and death animations all play with stable body proportions.
- [ ] Rapid boss animation transitions no longer produce the current exploded look.
- [ ] Boss loading in `Renderer3D` no longer depends on `rebaseMorphDeltasToIdlePose()`.
- [ ] Player-body morph retargeting still works after the boss-path cleanup.
- [ ] Exporter-side pose parity against `loadFrame()` passes for all boss frames.
- [ ] `npm run build`, `npm test`, and `npm run validate-gltf` all pass.

## Risks

- Replaying `type 0/1/2/3` into matrices with the wrong pivot math or rotation order will create subtly wrong poses that may look almost right but diverge from OSRS.
- A bad joint-node or inverse-bind mapping will load successfully but leave the mesh frozen or badly deformed at runtime.
- Switching `AnimationController` back to real crossfades can slightly soften attack starts if the blend window is too long.
- `BOSS_MODEL_SCALE` may need minor retuning once the first frame is posed through skinning instead of morph deltas.
- Removing boss morph preprocessing in the wrong place could accidentally break the player morph path, since both live in `Renderer3D.ts`.

## Security

- No new runtime network access, dynamic code execution, or user-input surface is introduced.
- The new export path remains a local build-time tool that reads the local OSRS cache and writes a deterministic asset under `public/models/`.
- Validation should continue to reject malformed asset structure before the browser ever loads it.
- If the palette-texture path is preserved, keep it embedded/local; do not introduce remote texture URIs.

## Dependencies

- `tools/cache-reader` package: `osrscachereader` and its existing `canvas`-based palette export support.
- `three@0.183.x` for runtime `GLTFLoader`, `AnimationMixer`, `SkinnedMesh`, `Skeleton`, `Bone`, and exporter math utilities (`Matrix4`, `Vector3`, `Quaternion`).
- OSRS cache version `232`.
- Existing boss sequence IDs and clip contract in `tools/cache-reader/export-gltf.mjs`.
- Current boss runtime hooks in `src/render/Renderer3D.ts` and `src/render/AnimationController.ts`.

## Open Questions

1. Should `AnimationController` ship the skeletal crossfade in this sprint, or should the first landing keep hard cuts and add blending only after pose parity is proven?
2. Do we want to keep empty `vertexGroups` as identity joints for stable indexing, or drop them from the glTF skin and keep a remap table?
3. Is the exporter-side pose-diff threshold effectively zero, or do we allow a small tolerance because `ModelLoader.animate()` uses fixed-point integer steps?
4. If the custom glTF writer becomes too large, is boss-only `COLOR_0` vertex color export an acceptable fallback, or do we require the current palette-texture path to remain unchanged?
5. Does the current `BOSS_MODEL_SCALE = 5 / 675` still match the visible idle footprint once the first pose is applied via skinning?
