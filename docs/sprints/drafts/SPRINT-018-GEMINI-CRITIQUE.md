# Sprint 018 Draft Critique: Gemini

This document provides a critique of the two proposed draft plans for Sprint 018 (Claude and Codex) based on the objectives and constraints outlined in the `SPRINT-018-INTENT.md` document.

## Claude Draft (`SPRINT-018-CLAUDE-DRAFT.md`)

### Strengths
*   **Methodical Root Cause Analysis:** Excellent breakdown of the provided intent. The logic for why `Math.PI` causes a 180-degree error given `atan2(dx, dz)` is mathematically sound.
*   **Investigative Approach for Bug 1:** Correctly identifies that the "mint green static" issue is ambiguous and proposes a solid investigation strategy using Playwright screenshots before blindly attempting a fix.
*   **Symmetric Problem Identification:** Smartly identifies that if the boss has a `Math.PI` yaw offset, the player might as well, and proposes checking both. Furthermore, applies the Bug 3 fix to `PlayerAnimationController.ts` for consistency.

### Weaknesses
*   **Oversimplified Animation Fix (Bug 3):** The proposed fix `if (state === this.currentState) return;` is too simplistic. If an attack animation is 90% complete (in its recovery frames) and a new attack of the same type is triggered, ignoring the trigger entirely means the new attack will have no visual telegraph. The boss will just return to idle, while a projectile spawns.
*   **Assumption on Facing Offset (Bug 2):** Assumes `BOSS_MODEL_YAW_OFFSET = 0` is the definitive fix without verifying the GLTF model's local coordinate system. If the model was authored facing +X or -X, an offset of `Math.PI / 2` or `-Math.PI / 2` might be required.

### Gaps in Risk Analysis
*   The risk of the "no-op" same-state guard causing a visual desync (where the game logic fires an attack but the renderer ignores the trigger because the previous animation hasn't formally ended) is brushed off as "Low". In a fast-paced game, missing an attack animation telegraph is a critical gameplay readability issue.

### Missing Edge Cases
*   **Animation Recovery Frames:** As mentioned, triggering an attack while the previous attack's animation is in its ending/recovery phase. 
*   **Tick Timing:** What if an attack is triggered on the exact tick the previous animation finishes?

### Definition of Done Completeness
*   **Highly Complete.** Directly maps to the success criteria in the intent document, including the >30fps frame rate constraint and all required test commands across both repositories.

---

## Codex Draft (`SPRINT-018-CODEX-DRAFT.md`)

### Strengths
*   **Insightful Hypothesis for Bug 1:** Proposes a very plausible and practical root cause for the tornado screen corruption: the tornado GLTF might have enormous world-space dimensions, and a static `0.7` scale is rendering it so large that the camera is inside it (clipping the near plane), resulting in a screen-filling artifact.
*   **Texture Parameter Stabilization:** Suggests enforcing standard Three.js WebGL texture sampling parameters (`magFilter`, `wrapS`, `generateMipmaps`), which is a robust way to prevent pixelated 40x4 textures from causing WebGL sampling issues.

### Weaknesses
*   **Over-engineered Bug 1 Fix:** Dynamically computing a bounding box to derive scale at runtime is risky and complex. If the GLTF contains an errant vertex far from the origin, the dynamic scale will shrink the tornado to microscopic size. 
*   **Vague Implementation Steps:** Steps like "validating/removing BOSS_MODEL_YAW_OFFSET inversion" lack the concrete code-level detail present in the Claude draft.
*   **Incomplete Scope for Bug 3:** Fixates on the Boss animation controller but misses the opportunity to proactively fix the Player animation controller, which likely shares the exact same `crossFadeTo` logic.

### Gaps in Risk Analysis
*   Misses the risk associated with dynamic bounding box calculation (malformed bounds leading to invisible models).
*   Does not mention the risk of player facing being broken by the boss facing fix, or vice versa.

### Missing Edge Cases
*   Does not consider the player facing direction (Bug 2 symmetry).
*   Does not address how the fallback JSON boss or cyan player box might respond to the yaw offset changes.

### Definition of Done Completeness
*   **Adequate, but missing constraints.** Covers the main features and fallback behaviors, but misses the explicit >30fps performance constraint mentioned in the intent document.

---

## Synthesis & Recommendations for Final Plan

1.  **Bug 1 (Tornado Screen):** Combine Claude's investigation-first approach with Codex's hypothesis. Take a screenshot to confirm the issue. If the screen is filled, investigate the scale. Instead of dynamic bounding box scaling (Codex), simply find the correct static scale factor (e.g., `0.007` instead of `0.7`) by inspecting the GLTF in a viewer, or enforce Codex's texture filters if scale is not the issue.
2.  **Bug 2 (Boss Facing):** Adopt Claude's approach of verifying and fixing both Boss and Player yaw offsets symmetrically, but be prepared to test `Math.PI / 2` or `-Math.PI / 2` if `0` does not align the model correctly.
3.  **Bug 3 (Animation Jitter):** Do not use Claude's strict `return` guard. Instead, implement logic that checks the *progress* of the current animation. If `nextAction.time` is near 0 (e.g., < 0.2 seconds), ignore the trigger (prevents same-tick or consecutive-tick spazzing). If the animation is substantially complete (e.g., > 50% finished), allow it to `reset().play()` to telegraph the new attack. Apply this to both Boss and Player controllers.