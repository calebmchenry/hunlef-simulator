# Sprint 017 Merge Notes (Revised)

## Context

The original Sprint 017 and its first planning cycle assumed the GLTF morph target data was broken (all-zero deltas, garbage keyframe times). A pre-merge diagnostic analysis proved this wrong:

- Boss GLTF has 6043/6840 non-zero morph target floats, max magnitude 337
- Player GLTF has 262/537 non-zero morph target floats, max magnitude 8.7
- Keyframe times are proper float32 seconds (0.06–1.8s)

**The data is valid. The bugs are in the renderer.** All three agents were re-briefed with a corrected intent document.

## Draft Strengths

### Claude Draft (233 lines — Primary foundation)
- Concrete `retargetMorphAnimations()` utility with clear algorithm: walk scene graph, find Groups with morph children, rewrite clip track names, remove originals
- Precise `morphTargets: morphCount > 0` material fix with exact line references
- Excellent ASCII diagram showing GLTF→Three.js scene graph mismatch
- Strong risk table with 6 specific entries including clone behavior for weapon switching
- DoD is comprehensive (12 items) and testable

### Codex Draft (141 lines — Supplementary insights)
- Identified stomp/prayer_disable trigger wiring gap and style-switch/attack same-tick collision
- Proposed controller transition guards to prevent popping on redundant state requests
- More holistic view of the animation system beyond just rendering bugs

### Gemini Draft (55 lines — Minimal contribution)
- Included validation script (from intent)
- Included >30fps DoD item
- Otherwise paraphrased the intent document

## Valid Critiques Accepted

1. **Claude critique (of Codex):** Multi-primitive binding fix is underspecified — "align binding" without a concrete strategy. Accepted: final sprint uses Claude's specific retargeting approach.
2. **Claude critique (of Gemini):** Missing trigger dispatch, style-switch collision, copied open questions verbatim. Accepted: Gemini draft contributed little beyond the intent.
3. **Codex critique (of Claude):** Needs idempotency guard against double-retarget. Accepted: added to implementation.
4. **Codex critique (of Claude):** Should handle clips with mixed morph + non-morph tracks. Accepted: retarget must only affect weight tracks.
5. **Gemini critique:** Claude is technically superior, Codex adds gameplay integration. Accepted: using Claude as foundation.
6. **All critiques:** Need explicit "no unbound mixer tracks" verification in DoD. Accepted.

## Critiques Rejected

1. **Codex:** Logging should be "optional" — rejected, making it mandatory for debugging silent mixer failures.
2. **Codex:** Scope expansion to `GameSimulation.ts` — rejected per user preference (renderer-only sprint).

## Interview Refinements

1. **Scope:** User chose renderer-only fixes. Trigger wiring for stomp/prayer_disable deferred to a future sprint.

## Synthesis

The final sprint uses Claude's draft as the structural base with these additions:
- Codex's transition guard insight (prevent popping on redundant state requests) — minimal change
- Validation script from intent/Gemini as Phase 0
- Performance risk and >30fps DoD from Gemini
- Idempotency and mixed-track-type edge cases from Codex critique
- Explicit "no unbound mixer tracks" DoD item from all critiques
