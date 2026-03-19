# Sprint 020: Fix Boss Attack Animation Exploded Look

## Overview

Fix the "exploded" look of the boss's attack animations. Previous attempts to scale `morphTargetInfluences` uniformly across all animations at runtime resulted in all animations becoming invisible from the zoomed-out camera. This sprint addresses the issue at load-time by scaling only the specific morph target geometry deltas associated with the problematic animations (e.g., magic and ranged attacks), leaving the visually correct animations (idle and style-switch) untouched.

## Use Cases

- **Play Attack Animations:** When the boss performs a magic or ranged attack, the body parts should remain cohesive and not fly apart into an "exploded" state.
- **Maintain Existing Aesthetics:** The idle and style-switch animations currently look great and must remain visually unchanged.
- **Preserve System Integrity:** The change must not degrade the frame rate or modify any external dependencies or `cg-sim-player`.

## Architecture

Instead of modifying the runtime `morphTargetInfluences` values on a per-frame basis, we will modify the GLTF geometry directly upon loading in `Renderer3D.ts`.
- The GLTF model stores morph target deltas in `geometry.morphAttributes.position` as an array of `BufferAttribute`s, one for each morph target index.
- Since we know the exact index ranges for each animation clip (e.g., idle is `0-13`, attack_magic is `14-27`, attack_ranged is `28-50`), we can selectively scale the vertex deltas only for the morph targets associated with the problematic animations.
- This represents a one-time, load-time geometry patching operation, avoiding any per-frame runtime overhead and leaving the `AnimationController` strictly focused on playback.

## Implementation

1.  **Create Geometry Patching Utility:**
    In `src/render/Renderer3D.ts`, add a private method (e.g., `patchBossMorphTargets(model: THREE.Object3D)`) to traverse the loaded boss model's meshes.
2.  **Scale Specific Morph Target Arrays:**
    For each mesh that possesses `geometry.morphAttributes.position`, iterate over the morph target indices.
    - If the index corresponds to an attack or high-delta clip (e.g., `attack_magic` (14-27), `attack_ranged` (28-50), and possibly `stomp` (51-71), `prayer_disable` (72-93), and `death` (94-111)), apply a corrective scale factor (e.g., `0.3`) to every value in the underlying position delta array (`array[i] *= scaleFactor`).
    - Indices corresponding to `idle` (0-13) and `style_switch` (112-143) must be explicitly skipped so they are left unmodified.
3.  **Integrate into Load Pipeline:**
    Invoke this patching utility inside the `loadBossGLTF` success callback in `src/render/Renderer3D.ts`, immediately after the GLTF scene is parsed and before `AnimationController` is initialized.

## Files Summary

- `src/render/Renderer3D.ts`: 
  - Add logic to traverse the loaded GLTF model's geometry and scale the position arrays of targeted `morphAttributes`.
  - Update `loadBossGLTF()` to execute this new load-time adjustment.

## Definition of Done

- The boss's attack animations (magic and ranged) look cohesive and grounded, without body parts visibly flying apart.
- Idle and style-switch animations remain completely visually unaltered.
- The `AnimationController` remains clean and unpolluted by custom per-frame scaling logic.
- The `cg-sim-player` directory remains untouched.
- `npm run build` and `npm test` execute successfully.
- Playwright screenshot comparisons confirm the fix for the attack animations while verifying no visual regression on the idle/switch animations.

## Risks

- **Scale Factor Tuning:** A scale factor of `0.3` is an informed starting point based on the average delta ratio (78-109 avg vs idle's 32 avg). However, it may require minor tweaking (e.g., `0.25` to `0.4`) to nail the perfect visual weight for the attack sequences.
- **Death and Stomp Degradation:** Applying the exact same uniform scaling to `death`, `stomp`, and `prayer_disable` might dampen them excessively. We might need specific scaling multipliers per clip range if they behave differently from the primary attacks.

## Security

- No external dependencies or scripts are added.
- No network changes, environment variable alterations, or sensitive data handling.

## Dependencies

- **None:** Relies exclusively on the existing Three.js version and internal tools.

## Open Questions

- **Uniform vs Discrete Scale Factor:** Is `0.3` the optimal uniform scale for all non-idle/non-switch animations, or do `stomp` and `death` require distinct multipliers to match the intended visual fidelity?
- **Export-time vs Load-time:** Doing this at load-time in `Renderer3D` is the fastest vector for iterating on visual feedback. However, should this scaling logic eventually be moved into the `tools/cache-reader/export-gltf.mjs` pipeline for long-term data purity? (For the immediate goals of this sprint, the load-time solution is the confirmed direction).