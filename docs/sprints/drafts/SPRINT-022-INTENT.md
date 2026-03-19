# Sprint 022 Intent: Replace Morph Target Animations with Skeletal Animation

## Seed Prompt

Replace morph target animations with skeletal (bone-based) animation for the Corrupted Hunlef boss model. The current morph target approach causes the model to visually "explode" during attack transitions because morph targets store absolute vertex positions per frame — the OSRS base mesh is stored in a spread-out T-pose, and idle compresses it to ~50% width, so any non-idle animation doubles the model size. Multiple fix attempts failed (scaling by 0.35x, rebasing to idle frame 0). The OSRS client uses skeletal animation (rotations/translations/scales on vertex groups), which keeps proportions stable through transitions.

## Background / History

### What was tried and why it failed
1. **Morph delta scaling (Sprint 019-020):** Scaled attack morph deltas by 0.35x at load time. Made animations too muted — didn't look like the real attack (head/tail lift was barely visible).
2. **Rebasing to idle frame 0:** Baked idle frame 0 into base geometry, subtracted it from all morph targets. Still looked terrible — the fundamental issue is that morph targets encode absolute vertex positions, and the transition between any two frames involves replacing ALL vertex positions simultaneously.
3. **No scaling (1.0x):** Raw morph data — model explodes to nearly 2x width during attacks.

### Root cause analysis
The OSRS animation system works with skeletal transforms: each frame applies rotations, translations, and scales to vertex groups (bone equivalents). The `osrscachereader` library's GLTFExporter converts this to morph targets by computing final vertex positions for each frame. This loses the skeletal structure — instead of "rotate the head bone up 30 degrees," you get "move every head vertex to these absolute positions."

The OSRS `animate()` function (in osrscachereader's `ModelLoader.js`) implements the exact transform logic:
- Type 0: Set rotation origin (compute center of affected vertex group)
- Type 1: Translate vertex group by (dx, dy, dz)
- Type 2: Rotate vertex group around origin by (dx, dy, dz) angles
- Type 3: Scale vertex group relative to origin

### Why skeletal animation fixes this
Skeletal animation applies transforms incrementally to vertex groups via bones. The model mesh stays in its natural idle pose, and bones rotate/translate/scale parts of it. Transitions between animations blend bone transforms (not vertex positions), keeping proportions stable.

## Orientation Summary

- **Current state:** Boss animations use morph targets exported via osrscachereader's GLTFExporter. The morph pipeline includes retargeting (multi-primitive meshes) and rebasing (idle frame 0) — both become obsolete with skeletal animation.
- **Recent work:** Sprints 019-021 focused on animation fixes and mechanic accuracy. The animation controller and event dispatch system are animator-agnostic (mixer + clip actions).
- **Key modules:** `AnimationController.ts` (state machine using THREE.AnimationMixer), `Renderer3D.ts` (GLTF loading pipeline), `export-gltf.mjs` (cache export script).
- **Constraints:** Three.js r183, unlit materials (MeshBasicMaterial), don't touch cg-sim-player.
- **Architecture advantage:** The AnimationController, event dispatch, and game simulation don't care about animation type — only the export pipeline and GLTF loading need to change.

## Relevant Codebase Areas

### Export Pipeline (tools/cache-reader/)
- `export-gltf.mjs` — Current export script. Uses osrscachereader's `GLTFExporter` which converts to morph targets. Needs to be replaced/augmented to produce skeletal GLTF.
- osrscachereader APIs used: `RSCache`, `cache.getAllFiles(IndexType.MODELS, id)`, `cache.getAllDefs(IndexType.CONFIGS, ConfigType.SEQUENCE)`, `GLTFExporter(modelDef)`, `exporter.addSequence(cache, seqDef)`, `exporter.addColors()`, `exporter.export()`
- `ModelLoader.js` in osrscachereader: Contains `loadSkeletonAnims()`, `loadFrame()`, and `animate()` — the reference implementation for how OSRS applies skeletal transforms to vertex groups.

### OSRS Animation Data Model
- **Model definition:** `modelDef.vertexGroups` — arrays of vertex indices grouped by label (bone assignment). `modelDef.vertexPositionsX/Y/Z` — raw vertex coordinates.
- **Frame definition:** Each frame has `indexFrameIds[]` (which transforms to apply), `translator_x/y/z[]` (transform values), and a `framemap` containing `types[]` (transform type: 0=origin, 1=translate, 2=rotate, 3=scale) and `frameMaps[]` (which vertex groups to affect).
- **Sequence definition:** `frameIDs[]` (packed as `skeletonArchiveId << 16 | frameIndex`), `frameLengths[]` (duration per frame in client ticks, 20ms each).

### Renderer (src/render/)
- `Renderer3D.ts` — `loadBossGLTF()`: loads GLTF, runs retargetMorphAnimations + rebaseMorphDeltasToIdlePose + applyUnlitMaterials, creates AnimationController. The morph-specific functions will be removed.
- `AnimationController.ts` — State machine wrapping THREE.AnimationMixer. Maps clip names to animation states. Uses immediate stop (no crossfade) for transitions. **This file should need minimal or no changes** — it works with any THREE.AnimationClip regardless of animation type.
- `PlayerAnimationController.ts` — Player uses same pattern. Not in scope for this sprint.

### Sequence Definitions (docs/assets/defs/sequences/)
- JSON files for each animation: `seq_8417.json` (idle), `seq_8430.json` (attack_magic), `seq_8431.json` (attack_ranged), `seq_8432.json` (stomp), `seq_8433.json` (prayer_disable), `seq_8436.json` (death), `seq_8754.json` (style_switch_mage), `seq_8755.json` (style_switch_range).
- Each contains `frameIDs[]`, `frameLengths[]`, `frameSounds[]`, etc.

### Current GLTF Model
- `public/models/corrupted_hunlef.gltf` — 144 morph targets across 2 primitives (regular + alpha), 8 animation clips, 302 external .bin buffer files. Will be replaced with a skeletal GLTF.

## Constraints

1. **osrscachereader is a build-time dependency only** — not in package.json, used only by export scripts. The GLTF is pre-built.
2. **Three.js r183** — must use SkinnedMesh + Skeleton + Bone for skeletal animation.
3. **cg-sim-player is read-only** — do not modify.
4. **Unlit materials** — MeshBasicMaterial, no lighting. Skeletal animation must work with this.
5. **8 animation clips must be preserved** — same names, same timing, same state machine.
6. **Vertex colors via UV palette texture** — the color export (`addColors()`) is independent of animation type and should be preserved.
7. **Model scale** — `BOSS_MODEL_SCALE` in Renderer3D currently tuned for morphed idle pose. May need adjustment.
8. **No new runtime dependencies** — export script may use osrscachereader APIs not currently used, but the runtime stays three.js only.

## Success Criteria

1. Boss model renders correctly in idle pose (matches current visual appearance)
2. All 8 animations play correctly — idle loops, attacks/stomp/prayer_disable/style_switch play once and return to idle, death clamps
3. Attack animation visually shows the Hunlef lifting its head and tail (not exploding/doubling in size)
4. Transitions between animations look natural (no explosion, no T-pose flash)
5. Animation timing matches OSRS frame lengths (preserved from sequence definitions)
6. Morph target pipeline code removed (retargetMorphAnimations, rebaseMorphDeltasToIdlePose, related constants)
7. All 193 existing tests pass
8. Export script produces valid skeletal GLTF that Three.js loads without errors

## Verification Strategy

1. **Visual inspection:** Run dev server, trigger each animation state, verify it looks correct
2. **Reference comparison:** Compare attack animation to OSRS wiki idle image (head down) vs attack (head up, tail up)
3. **Transition test:** Rapidly switch between idle and attack — no visual artifacts
4. **Console check:** No Three.js warnings about missing bones, invalid skinning, etc.
5. **Test suite:** `npm run test` — all 193 tests pass
6. **GLTF validation:** `npm run validate-gltf` — updated to validate skeletal structure instead of morph targets
7. **Build check:** `npm run build` succeeds

## Uncertainty Assessment

| Factor | Level | Rationale |
|--------|-------|-----------|
| **Correctness** | High | Need to correctly translate OSRS vertex group transforms to Three.js bone hierarchy. The `animate()` function in osrscachereader shows the math, but building a correct bone hierarchy from flat vertex groups is non-trivial. |
| **Scope** | Medium | Clear boundary (export script + renderer loading), but the export script is essentially a rewrite. |
| **Architecture** | Medium | Three.js SkinnedMesh/Skeleton is well-documented, but mapping OSRS's flat vertex groups to a bone hierarchy may require design decisions about bone parenting. |

## Open Questions

1. **Bone hierarchy:** OSRS vertex groups are flat (no parent-child relationships defined in the model). Should we create a flat bone array (each bone is a root), or attempt to infer a hierarchy? Flat is simpler and sufficient for the transform types used.
2. **Runtime vs build-time animation:** Should the export script bake skeletal animations into GLTF clips (build-time), or should the renderer apply frame transforms at runtime using raw frame data? GLTF clips are cleaner and let Three.js handle playback natively.
3. **Custom GLTF exporter:** The osrscachereader's GLTFExporter only supports morph targets. We'll likely need to write our own GLTF construction that adds bones, skin weights, and skeletal animation clips. Can we extend the existing exporter or must we build from scratch?
4. **Alpha primitives:** The model has 2 primitives (regular + transparent). Both need proper bone/skin weight assignment. Does Three.js handle multi-primitive SkinnedMesh correctly?
5. **Transition behavior:** With skeletal animation, should we enable actual crossfading between clips (instead of immediate stop)? This could make transitions smoother.
