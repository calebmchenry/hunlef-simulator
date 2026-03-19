# Sprint 020 Draft Critique

## Intent Summary

Both drafts address the same problem: boss attack animations look "exploded" because morph target geometry deltas for attack clips are ~3x larger than idle. Both correctly identify load-time geometry scaling as the fix and reject the failed Sprint 019 per-frame `morphTargetInfluences` approach. The intent document is well-written and provides strong grounding data (per-clip delta tables, exact morph target index ranges).

---

## Codex Draft

### Strengths

1. **Thorough phasing.** Four well-scoped phases (helpers → scaling → integration → verification) with clear checkboxes. Easy to execute sequentially.
2. **Idempotency awareness.** Explicitly calls out user-data markers to prevent double-scaling on repeated loads. Neither the intent doc nor the Gemini draft addresses this — it's a real concern since `loadBossGLTF` could theoretically be called again.
3. **Clip alias coverage.** Lists all known naming variants (`attack_magic`, `8430`, `seq_8430`, etc.). This is important because the GLTF exporter names clips by sequence ID, not by human-readable name. Missing aliases = missed morph targets.
4. **Fallback path preservation.** Explicitly includes the JSON fallback in use cases and DoD. Good defensive thinking.
5. **Robust open questions.** Raises the hardcoded-vs-runtime-derived index question, debug toggle, and per-clip tuning — all real concerns.

### Weaknesses

1. **Incorrect scaling formula.** Phase 2 says `base + (morph - base) * factor`. In Three.js, `morphAttributes.position[i]` stores **deltas from the base geometry**, not absolute positions. The correct operation is simply `array[j] *= factor`. The "base + (morph - base)" formula implies absolute morph positions, which is not what GLTF morph targets use. This is the most critical error in either draft — implementing this formula as-written would produce wrong results.
2. **Scope ambiguity on stomp/prayer_disable/death.** Phase 2 says "skip out-of-range indices" but the target design says "keep idle/style-switch/death/stomp geometry untouched in the first pass." The intent doc's open question #2 asks whether stomp/prayer_disable should be scaled too (their avg deltas of 82-88 are still ~2.5x idle). The Codex draft defers this but doesn't explain the decision boundary.
3. **Over-engineered helper decomposition.** Three separate helpers (collect morph indices, resolve attack clips, scale geometry) for what is effectively a ~30-line function. The morph index collection is just reading `NumberKeyframeTrack` names from clip tracks — not complex enough to warrant its own abstraction.
4. **No mention of `needsUpdate`.** After mutating `BufferAttribute.array` values, Three.js requires setting `bufferAttribute.needsUpdate = true` for the GPU to pick up changes. Missing this means the fix silently does nothing.

### Missing from Definition of Done

- No `cd ../cg-sim-player && npm test` — only mentions "cg-sim-player tests pass" without the exact command.
  *Edit: Actually it does include the exact command in Phase 4. The DoD section is slightly less precise but the phase covers it. Minor issue.*
- No mention of stomp/prayer_disable visual check — DoD says "death and stomp show no obvious quality regression" but the implementation explicitly skips scaling them. If they still look bad, the sprint is "done" but the user may not be satisfied.

---

## Gemini Draft

### Strengths

1. **Concise and direct.** Three implementation steps, one file to modify, minimal ceremony. Easy to hold in your head.
2. **Correct scaling formula.** Says `array[i] *= scaleFactor` — this is the right operation for GLTF morph target deltas, which are stored as offsets from the base mesh.
3. **Explicit skip list.** Clearly states idle (0-13) and style_switch (112-143) must be "explicitly skipped" — no ambiguity about which indices are touched.
4. **Honest risk framing.** The two risks (scale factor tuning and death/stomp degradation) are the actual likely failure modes. No padding.

### Weaknesses

1. **Hardcoded index ranges with no fallback.** The entire approach assumes morph target indices 14-27 = attack_magic, 28-50 = attack_ranged, etc. If the GLTF export pipeline changes (reorders clips, adds a clip, removes a clip), these hardcoded ranges silently break. The Codex draft's approach of deriving indices from clip track data is more robust, even if over-engineered.
2. **No idempotency guard.** If `loadBossGLTF` were called twice (e.g., hot-reload during dev, or a future retry-on-failure path), the deltas get double-scaled to 0.09x. The Codex draft addresses this; Gemini doesn't.
3. **Incomplete Definition of Done.** Missing:
   - `cd ../cg-sim-player && npm test` (the intent doc's constraints require it)
   - Frame rate > 30 FPS check (intent doc constraint)
   - GLTF fallback to JSON still working
   - Death/stomp visual regression check
4. **No phasing or checkboxes.** A single implementation block with three numbered paragraphs. No intermediate verification points. If the scale factor needs tuning, there's no structure to iterate — you just "go back and change the number."
5. **Vague on which clips to scale.** Says "e.g., attack_magic (14-27), attack_ranged (28-50), and **possibly** stomp (51-71), prayer_disable (72-93), and death (94-111)." This "possibly" is unresolved scope in the implementation itself, not just an open question. An executor would have to make a judgment call mid-sprint.
6. **No mention of `needsUpdate`.** Same issue as the Codex draft — mutating a BufferAttribute's backing array without setting `needsUpdate = true` means the GPU never sees the change.

### Missing from Definition of Done

- cg-sim-player test pass
- Frame rate check
- GLTF fallback path verification
- Stomp/death regression check (mentioned in risks but not in DoD)

---

## Gaps Common to Both Drafts

### 1. `BufferAttribute.needsUpdate`
Neither draft mentions that after mutating `geometry.morphAttributes.position[i].array`, you must set `.needsUpdate = true` on the attribute. Without this, Three.js will not upload the modified data to the GPU and the scaling will have no visible effect. This is the single most likely cause of a "fix does nothing" debugging session.

### 2. Multi-primitive mesh traversal
The boss model uses multi-primitive groups (that's why `retargetMorphAnimations` and `collectMorphRetargetCandidates` exist). Each child mesh in a group has its own `geometry.morphAttributes.position` array. Both drafts say "traverse boss meshes" but neither acknowledges the existing multi-primitive structure or explains how the traversal interacts with `retargetMorphAnimations` output. The scaling must visit every child mesh's geometry, not just top-level meshes.

### 3. `morphAttributes.normal` scaling
If the GLTF also contains `morphAttributes.normal` (morph target normal deltas), those would also need proportional scaling to avoid lighting artifacts on attack frames. Neither draft checks for or mentions normal deltas.

### 4. Scale factor derivation
Both drafts start with 0.3 and acknowledge it may need tuning, but neither proposes a principled derivation. The intent doc gives avg deltas: idle=32, attack_magic=78, attack_ranged=109. To normalize attack_magic to idle-like magnitude: 32/78 ≈ 0.41. For attack_ranged: 32/109 ≈ 0.29. A per-clip factor (0.4 for magic, 0.3 for ranged) would be more accurate than a uniform 0.3, which will over-dampen magic attacks.

### 5. Interaction with `retargetMorphAnimations`
The existing `retargetMorphAnimations` function rewrites clip tracks to target child meshes in multi-primitive groups. The morph scaling must happen **after** retargeting (both drafts get the ordering right in `loadBossGLTF`), but neither explains *why* — if you scale before retargeting and retargeting clones or regenerates tracks, the scaling could be lost. Worth a one-line comment in the implementation.

---

## Comparative Summary

| Criterion | Codex | Gemini |
|-----------|-------|--------|
| Correct scaling math | Wrong formula (base-relative) | Correct (`*= factor`) |
| Index discovery | Runtime from clip tracks (robust) | Hardcoded ranges (fragile) |
| Idempotency | Addressed | Missing |
| `needsUpdate` | Missing | Missing |
| Multi-primitive awareness | Implicit ("traverse meshes") | Implicit ("traverse meshes") |
| DoD completeness | Good (8 items, covers constraints) | Incomplete (missing 4 constraint items) |
| Phasing / executability | Strong (4 phases, checkboxes) | Weak (flat list, no checkpoints) |
| Conciseness | Somewhat over-engineered | Appropriately lean |
| Scope clarity | Defers stomp/death explicitly | Leaves scope ambiguous ("possibly") |

## Recommendation

Neither draft is ready to execute as-is. A merged approach would:
1. Use Gemini's correct `*= scaleFactor` formula
2. Use Codex's runtime index discovery from clip tracks (not hardcoded ranges)
3. Add `needsUpdate = true` after mutating each BufferAttribute
4. Add Codex's idempotency guard
5. Use Codex's phased structure and complete DoD
6. Check for and scale `morphAttributes.normal` if present
7. Consider per-clip scale factors (0.4 for magic, 0.3 for ranged) rather than uniform 0.3
8. Keep Gemini's conciseness — avoid unnecessary helper abstractions
