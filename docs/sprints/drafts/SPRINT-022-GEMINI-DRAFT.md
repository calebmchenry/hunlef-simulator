# Sprint 022: Replace Morph Target Animations with Skeletal Animation

## Overview
The Corrupted Hunlef boss model currently uses morph target animations exported from the OSRS cache. This approach stores absolute vertex positions per frame, which causes the model to visually "explode" during transitions (e.g., from an idle compressed pose to a wider attack pose). This sprint aims to migrate the boss model to skeletal (bone-based) animation, matching how the OSRS client natively processes these animations. We will construct a skeletal GLTF using Three.js `SkinnedMesh`, `Skeleton`, and `Bone` APIs, preserving the native vertex group transforms (rotation, translation, scale) directly as bone animations.

## Use Cases
- **Boss Animation Playback:** The Hunlef transitions smoothly between idle, attack, stomp, prayer disable, style switch, and death animations without visual artifacts or size explosions.
- **Export Pipeline:** Developers can rebuild the skeletal GLTF using the `tools/cache-reader/` pipeline without needing manual interventions.

## Architecture
- **Export Strategy:** The existing `export-gltf.mjs` relies on `osrscachereader`'s `GLTFExporter`, which converts vertex groups to morph targets. We will rewrite the export logic to:
  1. Extract raw mesh data and vertex groups from the model definition.
  2. Map each flat OSRS vertex group to a unique Three.js `Bone`.
  3. Create a Three.js `SkinnedMesh` and define `skinIndex` and `skinWeight` attributes (mapping each vertex to its bone with 1.0 weight).
  4. Build a `Skeleton` from the bones.
  5. Translate OSRS sequence frames into Three.js `AnimationClip`s (with `VectorKeyframeTrack` and `QuaternionKeyframeTrack` for bone transforms).
  6. Export the scene to GLTF using Three.js's `GLTFExporter` in the Node build environment.
- **Render Engine:** 
  - `Renderer3D.ts` will load the new skeletal GLTF. We will remove the legacy morph target pipelines (`retargetMorphAnimations` and `rebaseMorphDeltasToIdlePose`).
  - Multi-primitive alpha meshes will be natively supported via `SkinnedMesh`.
- **Animation Controller:** 
  - `AnimationController.ts` will continue to handle states via `AnimationMixer`.
  - We will enable actual crossfading in `AnimationController.ts` (e.g., `prevAction.crossFadeTo(nextAction, 0.2)`) to provide smoother transitions, as skeletal blending interpolates transforms safely.

## Implementation Phases

### Phase 1: Custom Skeletal GLTF Exporter
- Investigate loading `three` and `three/addons/exporters/GLTFExporter.js` within the Node script `tools/cache-reader/export-gltf.mjs`.
- Extract vertex positions, face indices, and vertex groups (`modelDef.vertexGroups`) from the cache.
- **Bone/Skin Weight Strategy:** 
  - Create a flat bone hierarchy: one `Bone` per vertex group, attached to a single root bone.
  - For each vertex, determine its vertex group. Add to `skinIndex` and set `skinWeight` to 1.0. If a vertex is not in a group, assign to a default static root bone.
- Construct `BufferGeometry` for the boss (handling regular and alpha primitives as needed).
- Bind the geometry to a `SkinnedMesh` using the constructed `Skeleton`.

### Phase 2: Translate Animation Sequences to Clips
- Load sequence definitions for the 8 expected animations.
- For each frame, use `osrscachereader`'s frame parsing (`framemap` types 0, 1, 2, 3) to extract the origin, translation, rotation, and scale for each affected vertex group.
- Map these to Three.js tracks (`VectorKeyframeTrack` for position/scale, `QuaternionKeyframeTrack` for rotation) targeting each `Bone`.
- Compile tracks into `THREE.AnimationClip` objects.
- Export the complete `Scene` (with the `SkinnedMesh`, `Skeleton`, and `AnimationClip`s) to `public/models/corrupted_hunlef.gltf`.

### Phase 3: Update Renderer3D and AnimationController
- **`src/render/Renderer3D.ts`:** 
  - Remove `retargetMorphAnimations`, `rebaseMorphDeltasToIdlePose`, `collectMorphRetargetCandidates`, and related morph constants.
  - Load the `corrupted_hunlef.gltf` as normal. Since we use `MeshBasicMaterial`, modify `applyUnlitMaterials` to ensure it works correctly with `SkinnedMesh` without breaking `skinning` features if required (Three.js materials handle this automatically if `skinned: true` or natively in WebGL2, but verify compatibility).
- **`src/render/AnimationController.ts`:**
  - Re-enable crossfading. Remove the immediate `prevAction.stop()` and replace it with `prevAction.crossFadeTo(nextAction, 0.2)` or `nextAction.crossFadeFrom(prevAction, 0.2, true)`.

## Files Summary
- **`tools/cache-reader/export-gltf.mjs`:** Rewritten to construct a Three.js `SkinnedMesh` and use Three's `GLTFExporter` instead of `osrscachereader`'s morph exporter.
- **`src/render/Renderer3D.ts`:** Removed morph target rebasing and retargeting functions.
- **`src/render/AnimationController.ts`:** Updated transition logic to use skeletal crossfading.

## Definition of Done
- Boss model renders correctly in idle pose.
- All 8 animations play correctly, returning to idle.
- Attack animations correctly show the head/tail lift without expanding or exploding vertex sizes.
- Rapid transitions between idle and attack produce smooth blends via crossfading without artifacts.
- Legacy morph pipeline code is completely removed from `Renderer3D.ts`.
- `npm run test` passes all 193 existing tests.
- Export script builds a standard skeletal GLTF successfully.

## Risks
- **Node.js Three.js Compatibility:** Running Three.js and `GLTFExporter` in Node.js might require mocked browser globals or a specific JSDOM setup.
- **Alpha Primitives:** The boss model has both regular and transparent faces. Managing two `SkinnedMesh` primitives or assigning materials per face group correctly in the exporter is required.
- **Transform Math Mapping:** Translating OSRS client-specific frame transforms (Types 0, 1, 2, 3 with custom coordinate spaces) to Three.js local bone quaternions and vectors can be tricky and requires careful mathematical translation.

## Security
- No new runtime dependencies. Ensure `three` and JSDOM (if needed) are only `devDependencies` for the exporter.
- No sensitive keys or external network requests introduced.

## Dependencies
- OSRS Cache Reader (existing build tool).
- Three.js (`three` and `three/addons/exporters/GLTFExporter.js`).

## Open Questions
1. Do we need to include JSDOM to use Three.js `GLTFExporter` in Node, or does it work in headless environments directly?
2. OSRS uses a different coordinate system (Y-up vs Z-up, left vs right-handed). Will bone rotations need a global coordinate system conversion matrix, or can we apply it at the root bone?
3. Should we attempt to calculate a hierarchical skeleton structure, or is the flat array of bones (each representing a vertex group) sufficient for blending and performance?