# Sprint 017 Draft Critique: Fix GLTF Morph Target Animation Rendering

This document provides a critique of the two sprint drafts (Claude and Codex) based on the Sprint 017 Intent.

## Claude Draft Analysis

### Strengths
*   **Deep Technical Accuracy:** Claude correctly identifies the exact Three.js mechanics causing the bugs. It explicitly understands that `GLTFLoader` promotes multi-primitive meshes to `Group`s, breaking animation track bindings to `weights`.
*   **Concrete Implementation Plan:** The proposal for a load-time `retargetMorphAnimations` utility that duplicates and rewrites track paths is specific, actionable, and correct for Three.js.
*   **Precise Fixes:** Accurately identifies the need for `morphTargets: morphCount > 0` in the `MeshBasicMaterial` constructor.
*   **Strong Constraint Adherence:** Strictly follows the constraints to not modify `cg-sim-player`, keep existing APIs, and maintain fallbacks.

### Weaknesses
*   **Track Name Fragility:** Relies on string manipulation and regex matching for animation track names (e.g., `<groupName>.morphTargetInfluences[N]`), which can be brittle depending on how Three.js `PropertyBinding` resolves paths across different r183 minor updates.
*   **Gameplay Integration:** Focuses almost entirely on the GLTF loading pipeline and assumes the existing trigger logic in `AnimationController` is sufficient, largely ignoring the fact that some animations (stomp, prayer disable) may lack proper event wiring.

### Gaps in Risk Analysis & Missing Edge Cases
*   **Mixed Track Types:** Fails to explicitly mention that the retargeting utility must *only* affect `weights` (morph target) tracks. If a clip also contains transform tracks (position/rotation/scale) targeting the root Group, those must be left intact and not duplicated to child meshes.
*   **Morph Target Index Mismatch:** Misses the edge case where the two primitives of a mesh might have a different number of active morph targets (e.g., if an exporter optimizes away unused targets per-primitive). This would cause index mismatches when duplicating the `weights` track.

### Definition of Done Completeness
*   **Excellent:** The DoD is highly comprehensive, covering all visual requirements, technical constraints (no new deps, fallback paths, test passes), and even includes the specific >30fps performance constraint.

---

## Codex Draft Analysis

### Strengths
*   **Gameplay and Trigger Focus:** Correctly identifies that getting the animations to play isn't just a rendering binding issue, but also a game-logic dispatch issue. It notes that `stomp` and `prayer_disable` lack active triggers.
*   **Animation State Guards:** Smartly proposes adding transition guards in the controllers to prevent unnecessary action resets and animation "popping" (e.g., when the same state is requested repeatedly).
*   **Event Collision Handling:** Identifies the edge case where an attack and a style-switch happen on the same tick, proposing logic to gate them so they don't fight over the AnimationMixer.

### Weaknesses
*   **Vague Technical Details:** The core solution for the binding bug is hand-wavy ("morph-binding prep for multi-primitive roots"). It lacks the concrete understanding of duplicating animation tracks or rewriting property binding paths that Claude provides.
*   **Missing Material specifics:** Mentions a "morph-capable material pass" but completely misses the critical `morphTargets: true` flag required for `MeshBasicMaterial` in Three.js.
*   **Scope Creep:** Proposes modifying `src/engine/GameSimulation.ts` to add explicit events. The Intent specifically frames this as a renderer-side bug fix, so altering core engine simulation logic may be out of scope for this specific sprint.

### Gaps in Risk Analysis & Missing Edge Cases
*   **AnimationMixer Risks:** Completely misses the core risks associated with Three.js `AnimationMixer` property path resolution.
*   **Single vs. Multi Primitive:** Doesn't address the edge case of models that don't need retargeting (single-primitive meshes) or models that have morph targets but no animations.

### Definition of Done Completeness
*   **Adequate but Incomplete:** Covers the visual and gameplay requirements well, but misses explicit DoD items for keeping fallback resilience specifically out of the retargeting path, and misses the >30 FPS performance requirement mentioned in the Intent.

---

## Conclusion & Recommendation

**Claude's draft is technically superior** for solving the core engine bugs identified in the Intent. Its understanding of Three.js internals regarding multi-primitive GLTF loading and material flags is exactly what is needed to get the animations playing. 

However, **Codex's draft provides crucial gameplay integration insights**. If Claude's draft is implemented as-is, the meshes will deform, but animations like `stomp` or `style_switch` might pop, collide, or never trigger because the renderer's `AnimationController` isn't wired to handle same-tick event collisions gracefully.

**Recommendation for Final Sprint Plan:**
Use **Claude's draft** as the primary foundation for Phase 1 (Retargeting Utility) and Phase 2 (Material Flag Fix). Integrate **Codex's insights** into Phase 3 (Trigger Correctness) by adding explicit tasks to implement state-transition guards in the animation controllers and handle same-tick event collisions (like attack vs. style switch), without modifying the core `GameSimulation.ts` engine.