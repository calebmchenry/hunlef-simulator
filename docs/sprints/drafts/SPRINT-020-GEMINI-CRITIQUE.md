# Sprint 020 Critique: Claude vs. Codex Drafts

## 1. Claude Draft Critique

### Strengths
- **Thorough Root Cause Analysis:** Excellent breakdown of *why* Sprint 019 failed, complete with a detailed statistical table of average and max deltas per animation clip.
- **Robust Architecture:** Proposes a dynamic discovery mechanism (Option B) for mapping morph target indices to clips via track parsing. This is highly resilient to future GLTF re-exports compared to hardcoded indices.
- **Granular Scaling Strategy:** Recognizes that different animations (attacks vs. stomp vs. death) need different scale factors rather than a one-size-fits-all approach.
- **Cleanup Included:** Explicitly includes a phase to remove the broken Sprint 019 per-frame scaling code.

### Weaknesses
- **Complexity:** Dynamic discovery adds parsing complexity to the load phase, which could be error-prone if track naming conventions vary slightly.
- **Idempotency Ignored:** Does not consider what happens if the scaling function is accidentally run twice on the same geometry instance.

### Gaps in Risk Analysis
- **Bounding Volumes:** Fails to mention whether Three.js bounding boxes or bounding spheres need recalculation after modifying the geometry. (Since deltas are strictly reduced, the original bounds remain safe, but this should be explicitly validated for frustum culling).
- **Shared Geometry:** Mentions it briefly, but lacks a concrete mitigation strategy if multiple meshes share the same `BufferAttribute`.

### Missing Edge Cases
- **Sequence ID Aliases:** Does not explicitly address how sequence IDs (e.g., `8430`, `seq_8431`) are handled during the clip-to-index mapping process.
- **Missing Indices:** What happens if a parsed track references a morph target index that is out of bounds for the `morphAttributes.position` array?

### Definition of Done Completeness
- **Excellent.** Extremely comprehensive, covering visual cohesion (with Playwright screenshots), test suite passing across both the current project and `cg-sim-player`, performance metrics (>30fps), and removal of legacy code.

---

## 2. Codex Draft Critique

### Strengths
- **Idempotency:** Strongly advocates for marking processed geometry with a user-data marker. This is a crucial defensive programming step that prevents double-scaling if the GLTF is re-processed or cloned.
- **Simplicity:** Pragmatic, iterative approach that starts strictly with attack clips before expanding scope to stomp/death.
- **Clear Scope:** Explicitly outlines non-goals to keep the sprint tightly focused.

### Weaknesses
- **Vague Implementation Details:** Leaves the actual mechanism for extracting morph indices from clips ambiguous ("Add helper to collect morph indices...").
- **Incomplete Scope:** By ignoring stomp, prayer_disable, and death in the "first pass", the resulting boss experience may remain visually jarring.
- **No Legacy Cleanup:** Completely misses the need to locate and remove the failed per-frame scaling logic from Sprint 019.

### Gaps in Risk Analysis
- **Normals:** Completely misses the potential distortion of `morphAttributes.normal`. Even if the material is currently unlit, leaving normals unscaled makes the geometry mathematically incorrect for future material changes.
- **Track Naming:** Does not analyze the risk of track naming conventions breaking the index extraction logic.

### Missing Edge Cases
- **Overlapping Indices:** Does not account for the possibility of animations sharing morph targets, which could lead to scaling the same index multiple times if not carefully tracked.
- **Animation Fallbacks:** Doesn't handle how missing attack clips would affect the scaling logic.

### Definition of Done Completeness
- **Good, but incomplete.** Covers the main visual and testing criteria, but fails to mandate the removal of the Sprint 019 per-frame scaling code. 

---

## 3. Synthesis & Recommendation

A hybrid approach is highly recommended. 

1. **Adopt Claude's dynamic discovery and granular scaling:** Parse the animation tracks to map indices dynamically, and apply specific scale factors (0.35 for attacks, 0.4 for stomp/prayer, 0.5 for death).
2. **Adopt Codex's idempotency markers:** Add a flag to `geometry.userData` to ensure the scaling operation is strictly apply-once per geometry.
3. **Mandate Sprint 019 Cleanup:** Ensure the broken per-frame influence scaling is entirely removed from the `AnimationController` or `Renderer3D` update loop.
4. **Scale Normals:** Even if unlit, apply the same scale factor to `morphAttributes.normal` (if present) for structural correctness.
