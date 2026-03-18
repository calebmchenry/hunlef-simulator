# Sprint 019 Draft Critique

Reviewer: Claude (Opus 4.6)
Date: 2026-03-18
Scope: Comparative review of Codex and Gemini drafts against SPRINT-019-INTENT.

---

## 1. Codex Draft

### Strengths

- **Dual-mode tile projection** is the strongest design idea across both drafts. Splitting `screenToTile` into strict and clamped helpers preserves existing in-bounds semantics while adding the new fallback path cleanly. This avoids a silent behavioral change for all callers.
- **Explicit preservation of boss-click-to-attack semantics.** Phase 3 calls out "Preserve existing in-bounds boss-click attack behavior" — this is a real edge case the Gemini draft ignores entirely.
- **Morph normalization is well-scoped.** The approach of computing per-clip max amplitude relative to idle, then scaling toward a target ratio, is principled. Clamping to safe morph ranges and no-oping on missing tracks are good defensive choices.
- **Files Summary is complete.** Includes `src/__tests__/input-manager.test.ts` as a new file, and `src/main.ts` for comment cleanup. Gemini omits both.
- **Open questions are concrete and actionable.** Question 1 (clamped click landing on boss tile) directly addresses a real ambiguity the intent doc doesn't resolve.

### Weaknesses

- **No math for camera distance.** Proposes `14` with "tune if needed" but doesn't show the calculation. For a 12-tile arena (12 units wide), FOV 45°, pitch 55°, the horizontal half-width visible at distance `d` is `d * cos(55°) * tan(22.5°)`. At `d=14` that's ~3.33 units — far short of the 6-unit half-grid. The viewport aspect ratio change to 16:9 helps horizontally but the number still needs validation. This is a risk of shipping a value that doesn't actually show the full arena.
- **Runtime morph scaling adds permanent per-load cost.** The draft acknowledges this could move to the export pipeline later (Open Question 3) but doesn't estimate the cost or set a threshold for when it becomes worth migrating. For 300+ morph targets in the Hunlef model, iterating all keyframe values on every load is non-trivial.
- **No concrete code for the morph normalization.** Phase 1 describes the algorithm in prose but doesn't sketch the implementation. Given that this is the highest-uncertainty item (rated Medium in the intent doc), a pseudocode outline would reduce ambiguity.
- **Definition of Done item for animation is subjective.** "No longer appear dramatically more exploded" is not verifiable without a threshold or screenshot comparison baseline. The verification phase mentions screenshots but doesn't define pass/fail criteria.
- **Responsive viewport is punted entirely.** Open Question 2 asks whether `1024x576` is final or should be responsive, but the implementation hardcodes `1024x576` everywhere. If the answer is "responsive," the implementation needs significant rework.

### Gaps in Risk Analysis

- **Missing risk: clamped click on boss footprint.** The draft raises this as an open question but doesn't list it as a risk. If a user clicks outside the arena and the nearest tile happens to be under the boss, the fallback path in `InputManager` would call `queueMove(tile)` — but the strict path would have called `queueAttackTarget('boss')`. The two paths diverge silently. This needs a design decision, not just an open question.
- **Missing risk: aspect ratio change breaks CSS layout.** Going from a square to 16:9 canvas will affect any parent container styling, side panel positioning, or flex layout. Neither draft addresses CSS implications.
- **Missing risk: morph scale ratio is a magic number.** The "1.0–1.2x" target ratio has no empirical basis in the draft. If the 3.4x figure from the intent doc is accurate, scaling to 1.0x would reduce attack amplitudes by ~70% — potentially making attacks visually indistinguishable from idle.

### Missing Edge Cases

- **Click exactly on arena boundary.** `Math.floor(hit.x + HALF_GRID)` where `hit.x + HALF_GRID` is exactly `12.0` yields tile 12, which is out of bounds. The clamped mode handles this, but the strict mode still returns null for this case — is that intentional?
- **Morph tracks with zero idle amplitude.** If the idle clip has zero amplitude for a morph target but the attack clip uses it, the ratio is undefined (division by zero). The draft says "no-op when expected tracks are missing" but doesn't address zero-amplitude tracks that are present.
- **Camera distance during scroll zoom.** Changing `DEFAULT_DISTANCE` to 14 only affects the initial value. If the user zooms in and then the countdown starts, the camera snaps to the zoomed-in distance at the player position, not the wider framing. Should countdown reset distance?

### Definition of Done Completeness

- Covers items 1–5 from the intent doc. ✓
- Includes fallback preservation. ✓
- Includes all three test suites. ✓
- **Missing:** Frame rate > 30fps (mentioned in intent constraints but absent from DoD).
- **Missing:** No new npm dependencies (mentioned in intent constraints).
- **Subjective animation criterion** needs tightening — "no longer appear dramatically more exploded" is not a binary pass/fail.

---

## 2. Gemini Draft

### Strengths

- **Concise and direct.** The draft is readable and easy to follow. Implementation steps are numbered and map 1:1 to intent items.
- **Includes concrete code snippets.** The `Math.max(0, Math.min(...))` clamp for click handling is immediately implementable and correct.
- **Acknowledges the export-vs-runtime tradeoff explicitly.** Recommends fixing at the source (export tool) with runtime as fallback, which is the right long-term call.
- **Camera distance recommendation of 16** is closer to correct than Codex's 14 (though still unvalidated — see weakness below).
- **Definition of Done includes frame rate > 30fps.** This is a constraint from the intent doc that Codex omits.

### Weaknesses

- **Click clamping modifies `screenToTile` in place.** The draft removes the null return and always returns a clamped tile. This is a breaking semantic change — every caller of `screenToTile` now gets clamped behavior, not just the click handler. If any other code path relies on null to mean "not on arena" (e.g., hover effects, debug overlays), it will silently break. The Codex dual-mode approach is significantly safer.
- **No consideration of boss-click interaction.** The click-clamp implementation in `screenToTile` means the `InputManager.handleClick` code at line 42 (`if (this.sim.boss.occupies(tile.x, tile.y))`) will now fire for out-of-bounds clicks that clamp onto the boss footprint. A player clicking in empty space outside the arena could accidentally attack the boss. This is a real bug that the draft introduces.
- **Animation investigation is deferred to implementation.** "Investigate where the 3.4x scaling originates" is step 1 of implementation, meaning the approach (export fix vs. runtime fix) isn't decided at design time. This makes the sprint plan non-committal on its highest-risk item.
- **No new tests proposed.** Unlike Codex, there's no mention of adding tests for the click-clamp behavior or any other change. The DoD says "all tests pass" but doesn't include writing new ones.
- **Files Summary includes the sprint doc itself** (`SPRINT-019-GEMINI-DRAFT.md`) which is noise — sprint docs aren't deliverables.
- **Missing `src/main.ts` and `src/input/InputManager.ts` from files list.** The click-clamp change propagates to InputManager semantics even though the file isn't directly edited, and main.ts has viewport references.

### Gaps in Risk Analysis

- **Only two risks listed.** Both are real but the analysis is shallow. Missing:
  - Boss-click false positives from clamped tiles (described above).
  - Morph scaling to zero for targets only used in attack clips.
  - CSS/layout breakage from aspect ratio change.
  - Camera distance not being validated mathematically.
- **No mention of fallback preservation.** The intent doc lists "maintain fallback paths" as a constraint. Gemini's DoD doesn't reference it.

### Missing Edge Cases

- **All edge cases listed for Codex also apply here**, plus:
- **Click on canvas but outside the floor plane.** If the raycast doesn't hit the y=0 plane (e.g., clicking near the top of a tall viewport), `hit` is null and the function returns null. With a 16:9 viewport the sky region is larger — more clicks will miss the floor entirely. The clamp logic only helps when the ray hits the plane but outside the grid, not when it misses the plane.
- **Export tool changes require re-exporting all models.** If the Gemini approach goes with the export fix, every `.gltf` and `.bin` file in `public/models/` needs regeneration. The draft doesn't account for this in the implementation plan or risk analysis.
- **Dynamic aspect ratio calculation.** The draft says "the camera's aspect ratio will be dynamically calculated" in Architecture but the implementation hardcodes `1024/576`. These contradict each other.

### Definition of Done Completeness

- Covers items 1–5. ✓
- Includes build + test suites. ✓
- Includes frame rate constraint. ✓
- **Missing:** Fallback behavior preservation.
- **Missing:** In-bounds click behavior unchanged (critical given the `screenToTile` modification).
- **Missing:** No new test artifacts despite being a sprint with behavioral changes.
- **Missing:** No new npm dependencies constraint.

---

## 3. Head-to-Head Summary

| Criterion | Codex | Gemini |
|-----------|-------|--------|
| **Intent coverage** | 5/5 items + fallback | 5/5 items, fallback omitted |
| **Architecture safety** | Dual-mode tile projection preserves callers | In-place modification risks boss-click bug |
| **Animation approach** | Runtime normalization, well-specified algorithm | Deferred investigation, no committed approach |
| **Camera math** | Missing (proposes 14, likely too low) | Missing (proposes 16, closer but unvalidated) |
| **Click edge cases** | Boss-footprint conflict raised as open question | Not addressed — introduces silent bug |
| **Viewport** | Hardcoded 1024×576, responsive punted | Architecture says dynamic, implementation says hardcoded |
| **Testing** | Adds input-manager test file | No new tests |
| **Risk depth** | 4 risks, reasonable coverage | 2 risks, too shallow |
| **DoD completeness** | Missing frame rate, has subjective animation criterion | Has frame rate, missing fallback + in-bounds preservation |
| **Readability** | Thorough but verbose | Concise and actionable |

## 4. Recommendations for Final Sprint Doc

1. **Use Codex's dual-mode tile projection design.** The Gemini in-place clamp is a footgun. Add explicit handling for when the clamped tile lands on the boss footprint (recommend: always queue movement for out-of-bounds clicks, never attack).
2. **Validate camera distance mathematically.** For a 16:9 viewport at FOV 45° and pitch 55°, compute the exact distance needed to frame the 12×12 arena. Show the math in the doc.
3. **Commit to a morph scaling approach at design time.** Runtime is acceptable for this sprint, but specify the algorithm with pseudocode and define an explicit target ratio (suggest starting at 1.5x idle as a compromise, with a tuning constant).
4. **Add frame rate to DoD** (from Gemini) and **add fallback preservation** (from Codex).
5. **Address CSS/layout implications** of the 16:9 viewport change. At minimum, list the HTML/CSS elements that need updating.
6. **Add tests for click-clamp behavior** (from Codex's plan) and consider a morph-scaling unit test that asserts output amplitudes are within range.
7. **Handle the zero-amplitude-idle edge case** in morph normalization (use absolute amplitude rather than idle-relative ratio when idle amplitude is zero).
8. **Make the animation DoD criterion verifiable** — e.g., "max morph displacement in attack clips is ≤ 2x idle max displacement" rather than "doesn't look exploded."
