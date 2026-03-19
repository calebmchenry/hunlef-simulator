# Sprint 022 Draft Critique

Reviewer: Claude (Opus 4.6)
Date: 2026-03-19

---

## Codex Draft

### Strengths

1. **Data-grounded architecture.** The draft opens with concrete local facts — 165 vertex groups, 2,180 vertices, 154 non-empty groups, one-hot skinning — and builds the design on top of verified invariants rather than assumptions. This is exactly the right foundation for a rewrite of the export pipeline.

2. **Parity check phase (Phase 3).** Reconstructing posed vertices from `groupMatrices[groupOfVertex] * baseVertex` and comparing against `modelDef.loadFrame().vertices` before wiring the runtime is the single most important risk mitigation in either draft. A wrong pivot order or rotation sequence will produce poses that look "almost right" but diverge subtly — catching that at export time with a hard threshold is far better than eyeballing it in the browser.

3. **Rotation order specificity.** Explicitly calling out the `dz -> dx -> dy` application order from `ModelLoader.animate()` and mandating the exporter match it eliminates one of the most likely sources of subtle bugs. Neither the intent doc nor the Gemini draft pins this down.

4. **Correct scoping of morph removal.** Line 201: "retargetMorphAnimations() cannot be removed globally because the player body GLTFs still use morph targets." This is critical. The actual codebase calls `retargetMorphAnimations` on all three player body GLTFs (`Renderer3D.ts:808-810`). Removing it globally would silently break player animations.

5. **Five-phase progression.** Guard rails -> export helper -> frame conversion -> parity check -> runtime integration -> validation/cleanup. Each phase has a natural gate: you don't touch the runtime until the exporter math is proven. This reduces blast radius per phase.

6. **Coordinate system handling.** The fixed `OSRS_TO_GLTF = makeScale(1, -1, -1)` basis-change matrix, applied as a similarity transform `M_gltf = C * M_osrs * C`, is the correct approach for a flat hierarchy where local == world. The conjugation form preserves rotations correctly.

7. **Stable joint indexing.** Keeping empty vertex groups as identity joints means cache group IDs and joint IDs are a direct 1:1 map. This avoids a remap table and makes debugging far easier.

8. **Animation channel optimization.** Skipping redundant trailing keys for joints that stay at identity, while always keeping a first key, is a good size optimization that doesn't sacrifice correctness.

### Weaknesses

1. **Crossfade introduced in the same sprint as the migration.** Phase 4 changes `AnimationController` to use `crossFadeFrom(prevAction, 0.12, false)`. This is a behavior change layered on top of a representation change. If the crossfade looks wrong, you can't tell whether the problem is the blend math or the skeletal data. The current `AnimationController` already has a `crossFadeTo` method name (it just calls `stop()` internally) — ship the skeletal migration with the same hard-cut behavior first, prove parity, then add crossfading as a follow-up. Open Question 1 in the draft itself raises this — the answer should be "defer."

2. **Three.js in the export script is hand-waved.** Phase 0 says "Decide whether three math classes will be imported from the root package or declared explicitly in tools/cache-reader/package.json." This is not a decision to defer — it's a prerequisite. The current `export-gltf.mjs` imports nothing from Three.js; it uses osrscachereader's `GLTFExporter` exclusively. If the new `SkeletalBossExporter.mjs` imports `THREE.Matrix4`, `THREE.Quaternion`, etc., those classes need to work in Node.js without a DOM. Three.js core math works headlessly, but this should be validated in Phase 0, not left as an open item.

3. **`loadFrame()` API not verified.** Phase 3's parity check assumes `modelDef.loadFrame(...)` returns posed vertex positions. The osrscachereader API for this needs to be confirmed — `loadSkeletonAnims()` and `loadFrame()` exist in `ModelLoader.js` but the exact call signature and return shape aren't specified. If this API doesn't exist on the `modelDef` object directly, the parity check needs a different approach (e.g., running the `animate()` function yourself against raw vertex arrays).

4. **Buffer file management not addressed.** The current GLTF has 302 external `.bin` buffer files. The new skeletal GLTF will have a completely different buffer structure (joint data, skin weights, TRS keyframes instead of morph deltas). The draft doesn't mention whether the new exporter should embed buffers as data URIs, use a single external `.bin`, or continue with multiple files. This also affects git diff noise and asset size.

5. **`mixer.update(0)` placement.** Phase 4 says to apply `mixer.update(0)` after starting idle "so the first rendered frame is posed." But the current `AnimationController` constructor already calls `this.playIdle()` at line 103. The issue is that `mixer.update(0)` in the constructor won't take effect until the model is added to the scene. This needs to be called after the GLTF is loaded and the controller is wired, which happens in `Renderer3D.loadBossGLTF()` — the draft should specify exactly where.

6. **No fallback strategy.** If the skeletal GLTF fails to load at runtime, `Renderer3D` currently falls back to loading from JSON (`loadModelFromJSON`). The JSON fallback produces a static model with no animations. The draft should note that this fallback path is unaffected (it doesn't use morph targets either) and confirm the behavior is acceptable.

### Gaps in Risk Analysis

- **Joint count limits.** 165 joints is high for a single mesh. While WebGL2 (which Three.js r183 uses) supports larger uniform blocks, some mobile/integrated GPUs may hit the `MAX_UNIFORM_VECTORS` limit. Three.js batches bone matrices into texture if the count exceeds the hardware limit, but this should be verified in the target environments. If 165 exceeds the limit, the texture fallback incurs a performance cost.
- **Inverse bind matrix correctness.** The draft says "use identity inverse bind matrices." This is correct *only* if joints start at the origin in their rest pose. Since the flat hierarchy has `local == world` for each joint, and each joint starts at identity, this holds — but the draft should explicitly state *why* identity IBMs are correct, not just assert it.
- **Git diff / PR reviewability.** Regenerating `corrupted_hunlef.gltf` will produce a massive diff (the current file references 302 buffers). The PR should either exclude the binary asset from the diff or note that the GLTF validation script is the contract gate, not human review of the asset.

### Missing Edge Cases

- What happens if a vertex group is referenced by a frame's `frameMaps` but is empty (no vertices)? The joint still gets a transform — this is harmless for skinning but the parity check should skip empty groups to avoid divide-by-zero on centroid computation.
- The `type 0` (set origin) operation computes pivot from "affected vertex groups." If multiple groups are affected, the pivot is the weighted average of their centroids. What weighting — vertex count or uniform? `ModelLoader.animate()` uses vertex count; the draft should match.

---

## Gemini Draft

### Strengths

1. **Correct high-level architecture.** The three-phase plan (exporter -> animation translation -> runtime cleanup) is sound and captures the essential work items.

2. **Identifies Node.js compatibility risk.** Calling out that Three.js `GLTFExporter` might need JSDOM or mocked browser globals is a real risk that the Codex draft glosses over. This is a practical blocker that could waste significant time if not investigated upfront.

3. **Concise and readable.** The draft is easy to scan and understand. For a sprint kickoff, the brevity makes it easier to align a team quickly.

### Weaknesses

1. **Proposes removing functions that the player path still needs.** Phase 3 says: "Remove `retargetMorphAnimations`, `rebaseMorphDeltasToIdlePose`, `collectMorphRetargetCandidates`, and related morph constants." But `retargetMorphAnimations` is called on all three player body GLTFs at `Renderer3D.ts:808-810`. Removing it globally would break player animations. This is a critical scoping error. The Codex draft correctly identifies that only the boss-path calls should be removed.

2. **No coordinate system conversion specified.** The OSRS cache uses a different coordinate system than glTF/Three.js (Y-inverted, Z-inverted). Open Question 2 asks about this but provides no answer or strategy. The Codex draft provides the exact basis-change matrix. Without this, the implementation will spend significant time debugging mirrored or inverted poses.

3. **No rotation order specified.** OSRS applies rotations in a specific order (`dz -> dx -> dy`). Applying them in an arbitrary Euler order will produce visually wrong poses that look subtly off. The draft doesn't mention rotation order at all.

4. **No verification phase before runtime integration.** There is no equivalent of Codex's Phase 3 parity check. The draft goes straight from "build the exporter" to "wire it into the renderer." If the export math is wrong, you won't know until you see broken animations in the browser — and at that point, the bug could be in the exporter, the coordinate conversion, the rotation order, or the runtime loading. A pre-runtime verification step is essential for this kind of math-heavy pipeline.

5. **Using Three.js `GLTFExporter` in Node.js is high-risk.** The draft proposes building a Three.js scene graph in Node.js and exporting with `three/addons/exporters/GLTFExporter.js`. This has real dependency issues: `GLTFExporter` in Three.js r183 expects a browser environment (canvas for texture encoding, DOM for some operations). The draft flags this in the risk section but proposes no mitigation. The Codex approach of writing raw glTF JSON avoids this entirely — more code, but zero environment risk.

6. **Incorrect Three.js API reference.** Phase 3 mentions verifying that `applyUnlitMaterials` works with `SkinnedMesh` "if required (Three.js materials handle this automatically if `skinned: true`)." There is no `skinned` property on Three.js materials in r183. The `MeshBasicMaterial` works with `SkinnedMesh` automatically via the renderer's program selection — no flag needed. This suggests the draft was written without verifying the Three.js r183 API.

7. **Crossfade blend time of 0.2s specified without justification.** The draft sets `crossFadeTo(nextAction, 0.2)` without explaining why 0.2 seconds is the right value. OSRS animations have frame lengths of 20ms per client tick — a 200ms blend window covers 10 client ticks, which may smooth over the start of an attack animation. Same concern as with the Codex draft: crossfading should be deferred until skeletal parity is proven.

8. **Missing DoD items compared to intent document.** The intent document specifies 8 success criteria. The Gemini DoD covers 7 items but omits:
   - Export script produces valid skeletal GLTF (mentioned loosely but not as a gated check)
   - `npm run validate-gltf` passes (the validator isn't mentioned for update at all)
   - Player morph path still works (not mentioned)
   - Animation timing matches OSRS frame lengths

9. **Files summary is incomplete.** Only 3 files listed. Missing:
   - `validate-gltf.mjs` (needs to check skeletal structure instead of morph targets)
   - `public/models/corrupted_hunlef.gltf` (the asset itself changes)
   - Any new exporter helper file
   - `tools/cache-reader/package.json` (if Three.js is added as a dependency)

10. **No data assertions about the model.** The draft doesn't verify that all vertices belong to exactly one group, that group coverage is complete, or what the vertex/group counts are. Without these preconditions, the one-bone-per-group skinning strategy has no stated validation.

### Gaps in Risk Analysis

- **No risk identified for breaking player animations.** This is the highest-probability regression in the sprint, and the draft doesn't mention it.
- **No risk identified for rotation order bugs.** This is the highest-probability correctness bug.
- **No mention of `BOSS_MODEL_SCALE` potentially needing adjustment.** The current scale is tuned for the morph-target idle pose, which applies deformations to the base mesh. The skeletal idle pose may produce a different visual footprint.
- **No risk identified for the validate-gltf script.** The current validator (`validate-gltf.mjs:238-239`) explicitly *requires* morph targets for the boss model and will fail if it doesn't find them. This must be updated before or alongside the export change.

### Missing Edge Cases

- What happens to vertices that aren't in any vertex group? (Assigned to root bone? Frozen? The Codex draft handles this with a root fallback.)
- How are the two primitives (opaque + alpha) handled under a single `SkinnedMesh`? Do they share a skeleton, or does each get its own? Three.js supports multi-material on a single `SkinnedMesh` but the draft doesn't discuss this.
- The existing GLTF has 302 external `.bin` files. The new export needs a buffer strategy.

---

## Comparative Assessment

### Which draft has the better implementation strategy?

**The Codex draft is substantially stronger** and should be the basis for the final sprint plan. Here's why:

| Dimension | Codex | Gemini |
|-----------|-------|--------|
| **Correctness safeguards** | Parity check phase, rotation order pinned, coordinate conversion specified | No verification phase, rotation order unspecified, coordinate system deferred to open questions |
| **Scoping accuracy** | Correctly preserves player morph path | Would break player animations by removing shared functions |
| **Specificity** | Code-level detail for skinning, coordinate conversion, frame timing, joint naming | High-level descriptions without implementation specifics |
| **Risk awareness** | 5 specific risks, all actionable | 3 risks, one unmitigated (Node.js GLTFExporter) |
| **DoD completeness** | 8 items covering export, runtime, testing, and validation | 7 items, missing validation and player-path preservation |
| **Export approach** | Writes raw glTF JSON — no environment risk | Uses Three.js GLTFExporter in Node.js — significant environment risk with no mitigation |

### Key recommendation for the final sprint plan

Take the Codex draft as the base and incorporate these adjustments:

1. **Defer crossfading.** Ship with the same hard-cut transition behavior. Add crossfading in a follow-up once skeletal parity is visually confirmed.
2. **Resolve Three.js math dependency in Phase 0.** Either confirm Three.js core math works in Node.js (it does — no DOM needed for `Matrix4`/`Quaternion`/`Vector3`) or inline the math. Don't leave this as an open question.
3. **Specify buffer strategy.** Decide upfront: single embedded data URI, single external `.bin`, or multiple files. A single external `.bin` is the cleanest for git and loading.
4. **Add the Node.js GLTFExporter risk from the Gemini draft** as a "why we chose raw glTF JSON instead" note — it's useful context for anyone who asks "why not just use Three.js's exporter?"
5. **Verify the `loadFrame()` API** before Phase 3. If it doesn't exist on `modelDef`, the parity check needs to replicate `animate()` against raw vertex arrays (which is essentially what the exporter already does, so the check becomes: do the group matrices, when applied to base vertices, produce the same output as osrscachereader's own `animate()` path?).
6. **Add a DoD item for the validate-gltf script** — it currently hard-fails on missing morph targets for the boss model. This must be updated.
