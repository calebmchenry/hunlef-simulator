# Sprint 017 Intent: Fix GLTF Morph Target Animation Rendering

## Seed

Replan Sprint 017 to fix GLTF animation data by fixing the export pipeline instead of using RuneLite. After investigation, the export pipeline is NOT broken — the GLTF files contain valid morph target data. The bugs are in the renderer.

## Critical Discovery (invalidates original sprint)

The original Sprint 017 assumed "no actual animation data exists" in the GLTF files. **This is wrong.** Diagnostic analysis shows:

- **Boss (corrupted_hunlef.gltf, 8.3MB):** 144 morph targets, 8 animations, first morph target has 6043/6840 non-zero float values, max magnitude 337. Keyframe times are proper float32 seconds (0.06–1.8s).
- **Player (player_body_bow.gltf, 197KB):** 30 morph targets, 3 animations, first morph target has 262/537 non-zero values, max magnitude 8.7. Keyframe times are valid float32 seconds.

The GLTF data is structurally AND numerically correct. The animations don't play because of **renderer-side bugs**, not export bugs.

## Orientation Summary

- **Project:** CG (Corrupted Gauntlet) fight simulator with Three.js 3D rendering
- **Recent work:** Sprint 015 added player models, Sprint 016 added tornado visibility
- **Key files:** `src/render/Renderer3D.ts` (1181 lines), `src/render/AnimationController.ts`, `src/render/PlayerAnimationController.ts`
- **Constraint:** Never modify `cg-sim-player` (read-only validation tooling)
- **Three.js version:** r183 (v0.183.2)

## Root Cause Analysis

Three bugs stack and prevent morph target animations from rendering:

### Bug 1: Multi-primitive GLTF animation targeting (PRIMARY)

The GLTF files have 2 primitives per mesh (opaque faces + alpha faces). When Three.js GLTFLoader loads this:
- Node 0 becomes a `THREE.Group`
- Each primitive becomes a child `THREE.Mesh` under the Group
- `morphTargetInfluences` arrays exist on the child Meshes, NOT the Group
- Animation channels target `node: 0, path: "weights"` — Three.js tries to animate the Group's weights, which don't exist
- Result: AnimationMixer silently does nothing

### Bug 2: MeshBasicMaterial missing `morphTargets: true` (SECONDARY)

`applyUnlitMaterials()` at line 414 creates `MeshBasicMaterial` without the `morphTargets` property. In Three.js r183, `MeshBasicMaterial` needs `morphTargets: true` for the vertex shader to include morph target deformation code.

### Bug 3: AnimationMixer binding path (POSSIBLE)

The `AnimationController` creates the mixer with the GLTF scene Group as the root. The mixer needs the correct property binding path to reach `mesh.morphTargetInfluences` on child objects. Depending on how Three.js resolves the GLTF animation channel, this may already work once Bugs 1-2 are fixed, or it may need explicit retargeting.

## Relevant Codebase Areas

| Area | Files | Relevance |
|------|-------|-----------|
| Renderer3D | `src/render/Renderer3D.ts:396-425` | `applyUnlitMaterials()` — Bug 2 |
| Renderer3D | `src/render/Renderer3D.ts:428-454` | `loadBossGLTF()` — model + animation setup |
| Renderer3D | `src/render/Renderer3D.ts:497-559` | `loadPlayerGLTF()` — player model loading |
| AnimationController | `src/render/AnimationController.ts` | Boss animation state machine |
| PlayerAnimationController | `src/render/PlayerAnimationController.ts` | Player animation state machine |
| Boss GLTF | `public/models/corrupted_hunlef.gltf` | 8.3MB, valid morph data, 2 primitives, 8 anims |
| Player body GLTFs | `public/models/player_body_{bow,staff,halberd}.gltf` | ~200KB each, valid data, 2 prims, 3 anims |
| GLTF Exporter (lib) | `tools/cache-reader/node_modules/osrscachereader/.../GLTFExporter.js` | Confirmed working correctly |

## Constraints

- No new npm dependencies
- Never modify cg-sim-player
- Keep existing animation controller API (playIdle, playAttack, etc.)
- Maintain fallback to cyan box / static JSON when GLTFs absent
- Frame rate > 30fps with all animations active

## Success Criteria

1. Boss morph target animations visibly play (mesh deforms, not static)
2. All 8 boss animations trigger on correct events (idle, attacks, stomp, prayer, death, style switch)
3. Player morph target animations play (idle, attack per weapon, eat)
4. Crossfade transitions smooth (no popping)
5. Death animation clamps (doesn't loop)
6. Fallbacks still work
7. `npm run build` passes, `npm test` passes, `cd ../cg-sim-player && npm test` passes

## Verification Strategy

1. Write a diagnostic script (`tools/cache-reader/validate-gltf.mjs`) to validate morph target data is non-zero and keyframe times are valid
2. Fix renderer bugs and visually verify each animation plays
3. Run build + test suites

## Uncertainty Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| Correctness | **Low** | Root causes identified with high confidence from code + data analysis |
| Scope | **Low** | 1-2 files to modify, well-bounded |
| Architecture | **Low** | Extends existing patterns, no new systems |

## Open Questions

1. Does Three.js r183 auto-propagate morph target weights from a Group to child Meshes, or do we need to explicitly retarget the animation channels?
2. Is `morphTargets: true` on MeshBasicMaterial still required in r183, or does Three.js auto-detect from geometry morphAttributes?
3. Should we merge the 2 primitives into 1 at load time (simplifies animation targeting) or fix the multi-primitive targeting at runtime?
