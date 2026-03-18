# Sprint 017: Fix GLTF Morph Target Animation Rendering

## Overview
This sprint focuses on resolving renderer-side bugs that prevent GLTF morph target animations from playing for the Boss and Player models. Diagnostic analysis has confirmed that the GLTF exporter correctly encodes morph target data and keyframes. The bugs reside in `src/render/Renderer3D.ts`, `src/render/AnimationController.ts`, and `src/render/PlayerAnimationController.ts`. Resolving these issues will bring visual fidelity to the game simulation by restoring model animations across various game states.

## Use Cases
- Boss morph target animations visibly play (mesh deforms) on correct events (idle, attacks, stomp, prayer, death, style switch).
- Player morph target animations visibly play (idle, attack per weapon, eat).
- Crossfade transitions between animations are smooth without popping.
- The death animation clamps at the final frame instead of looping.
- Fallback models (cyan box, static JSON) remain fully functional when GLTFs fail to load or are absent.

## Architecture
The architectural intent is to maintain the existing AnimationController and PlayerAnimationController APIs while fixing underlying Three.js bindings. The changes will focus on:
1. **Material Configuration**: Ensuring `MeshBasicMaterial` instances created during GLTF model loading correctly enable morph targets if required by Three.js r183, allowing vertex shaders to deform.
2. **Animation Binding**: Correcting AnimationMixer binding paths. Current animation channels target the root Group (`node: 0, path: "weights"`), but the `morphTargetInfluences` exist on the child `THREE.Mesh` primitives. The animation channels must be retargeted to apply to the child meshes properly.
3. **Crossfade Logic**: Ensuring AnimationMixer setups (like `crossFadeTo`) correctly handle looping vs. one-shot clamps as defined in `ANIM_NAME_MAP`.

## Implementation
1. **Diagnostic Tooling**: Create `tools/cache-reader/validate-gltf.mjs` to validate morph target data to ensure it's not zero and keyframe times are valid.
2. **Renderer Materials**: Update `applyUnlitMaterials` in `src/render/Renderer3D.ts` to support morph targets (e.g., transferring `morphTargets: true` or utilizing auto-detection logic in Three.js).
3. **Animation Mixer Fixes**: Update `src/render/AnimationController.ts` and `src/render/PlayerAnimationController.ts` (or the GLTF loading logic in `src/render/Renderer3D.ts`) to redirect animation channels from the root `Group` to its child `THREE.Mesh` primitives. Implement explicit retargeting logic for `morphTargetInfluences`.
4. **Animation Triggers & Clamping**: Verify that `AnimationController` and `PlayerAnimationController` properly configure loop conditions (e.g., death animation clamping) and trigger them at the correct simulation events.
5. **Fallback Protection**: Ensure fallback mechanisms do not crash when animations are entirely absent or `morphTargetInfluences` fails to bind.

## Files Summary
- `src/render/Renderer3D.ts`: Update `applyUnlitMaterials()` to configure morph targets. Adjust loading logic to prepare meshes for animation.
- `src/render/AnimationController.ts`: Retarget animation channels or fix binding paths for the boss model.
- `src/render/PlayerAnimationController.ts`: Retarget animation channels or fix binding paths for the player model.
- `tools/cache-reader/validate-gltf.mjs`: Create diagnostic validation script.

## Definition of Done
- Boss morph target animations play visibly on all correct events without static mesh issues.
- Player morph target animations play visibly on all correct events.
- Crossfade transitions are smooth (no popping).
- The death animation correctly clamps at its final frame.
- Fallback scenarios (cyan box, static JSON) remain robust and do not throw console errors.
- Simulation maintains framerates > 30fps with all animations playing.
- `npm run build`, `npm test`, and `cd ../cg-sim-player && npm test` pass.

## Risks
- **Three.js Version API Changes**: Three.js `r183` has specific behaviors for `AnimationMixer` property binding and material morph targets. (We need to confirm whether `morphTargets: true` is still a valid material property or if it auto-detects from geometry).
- **Multi-primitive Complexity**: Modifying animation channels at runtime to target multiple child meshes requires accurate `name` binding or path generation.
- **Performance**: Continuously updating many morph targets per frame could introduce frame rate drops if not optimized.

## Security
- No new npm dependencies introduced.
- Strict read-only policy for `cg-sim-player` tooling maintained.

## Dependencies
- None. (Constraints specify no new dependencies).

## Open Questions
1. Does Three.js r183 auto-propagate morph target weights from a Group to child Meshes, or do we need to explicitly retarget the animation channels?
2. Is `morphTargets: true` on MeshBasicMaterial still required in r183, or does Three.js auto-detect from geometry morphAttributes?
3. Should we merge the 2 primitives into 1 at load time (simplifies animation targeting) or fix the multi-primitive targeting at runtime?