# Sprint 019 Draft Critique

This critique evaluates both drafts against `docs/sprints/drafts/SPRINT-019-INTENT.md`.

## Claude Draft (`docs/sprints/drafts/SPRINT-019-CLAUDE-DRAFT.md`)

### Strengths

1. Strong intent coverage: all five seed items are mapped to concrete code areas and implementation steps.
2. Execution readiness is high: phased plan, file list, and concrete code-shape proposals make it straightforward to implement.
3. Sequencing is sensible: doing viewport/aspect changes before camera tuning matches the dependency in the intent.
4. Validation breadth is good: it includes build/test gates, FPS, and regression checks beyond the primary UX changes.
5. It handles Item 1 uncertainty explicitly with multiple options instead of assuming the root-cause layer.

### Weaknesses

1. Item 1 recommendation is technically shaky: “scale morph target deltas only for attack clips” is not trivial in glTF, since morph deltas are geometry data shared across clips while clips usually animate influences.
2. Item 1 guidance is internally inconsistent: it recommends attack-only scaling, then also suggests uniform global scaling that it acknowledges may harm idle quality.
3. Camera framing logic and chosen constants are not fully reconciled: it computes full-arena distance around 25+, but recommends default 18 without a clear acceptance threshold for “near-full.”
4. Viewport proposal is hard-coded to one size (920x576) with limited justification for smaller screens or side-panel constraints.
5. Verification steps remain mostly qualitative; there are no objective pass criteria (for example, measurable framing tolerance or deterministic before/after frame checkpoints).

### Gaps in Risk Analysis

1. No explicit risk for late pivot cost if Item 1 moves from runtime to exporter fix (asset regeneration, binary diff churn, review overhead).
2. No explicit risk that post-load geometry mutation could affect shared geometry instances unexpectedly.
3. No explicit risk for camera interaction side effects after raising `MAX_DISTANCE` to 30 (zoom feel, clipping/framing behavior).
4. No explicit risk for countdown snap behavior if target updates every frame and causes visible jitter.
5. No explicit risk for fixed-width canvas + side panel overflow on narrower displays.

### Missing Edge Cases

1. Raycast miss behavior (`!hit`) should remain `null` and non-moving; this is mentioned but not explicitly tested in DoD.
2. Extreme out-of-bounds clicks (far corners/negative coordinates) should clamp predictably to boundary corners.
3. Clicking outside while already on the clamped boundary tile should not create unintended queue churn.
4. Countdown camera behavior should be validated for non-default spawn positions (future-proofing against spawn changes).
5. Morph-scaling interactions should be checked during attack->death and attack->style-switch transitions, not only isolated attack loops.

### Definition of Done Completeness

1. DoD is stronger than average and mostly aligned with intent.
2. It should explicitly require fallback-path verification for each affected area (animation/camera/viewport), not just a single aggregate line.
3. It should include deterministic artifact criteria for Item 1 (same animation timestamp/angle before vs after).
4. It should explicitly include edge-click corner/miss behavior, not only generic “clicking outside.”
5. It should distinguish required completion from tuning work (for example, exact morph damping refinement) to avoid ambiguous “done.”

## Gemini Draft (`docs/sprints/drafts/SPRINT-019-GEMINI-DRAFT.md`)

### Strengths

1. Scope alignment is clean: it tracks the exact five intent items without unnecessary expansion.
2. File touchpoints are directionally correct and minimal.
3. It calls out the core Item 1 decision (export-layer vs runtime-layer), which is the key uncertainty.
4. It includes build/test/performance gates in DoD, matching core intent constraints.
5. Click clamping direction is straightforward and likely low-risk when implemented carefully.

### Weaknesses

1. The draft is not implementation-ready; Item 1 remains too abstract to execute with confidence.
2. Item 1 technical proposal mixes morph-delta and animation-track scaling approaches without clarifying which data actually carries the 3.4x issue.
3. Camera tuning is incomplete: it changes `DEFAULT_DISTANCE` but does not address related bounds/controls behavior (for example `MAX_DISTANCE`).
4. Viewport change plan omits layout/CSS integration details despite known canvas-wrapper and side-panel coupling.
5. Click handling wording implies “always resolve to a tile,” which risks removing valid `null` behavior for ray misses.
6. Verification detail is thin and mostly descriptive; it lacks concrete scenarios/timestamps/assertions.

### Gaps in Risk Analysis

1. Risk section is too shallow for the highest-uncertainty item (animation scaling layer correctness).
2. No explicit delivery risk if exporter-based fix is chosen and requires re-export/validation of generated assets.
3. No explicit regression risk for fallback rendering paths called out in the intent constraints.
4. No explicit risk around coordinate mapping regressions after aspect/canvas changes.
5. No explicit UX risk for clamping intentional off-arena clicks to boundary tiles.

### Missing Edge Cases

1. Raycast misses (sky/overlay clicks) should be explicitly validated as non-movement paths.
2. Far-offscreen and corner clicks should clamp to correct boundary corners.
3. Rapid animation transitions (magic/ranged alternation, attack->death) may expose scaling regressions.
4. Countdown centering should be validated for spawn variability, not only current spawn.
5. Smaller window widths should be tested for layout overflow with 1024x576 + side panel.
6. Fallback boss/player render modes should be verified after viewport and camera changes.

### Definition of Done Completeness

1. DoD is directionally correct but not complete enough for reliable sign-off.
2. It should explicitly include fallback-path validation, which is a stated intent constraint.
3. It should include layout integrity checks (HUD/side panel/canvas wrapper) as first-class acceptance criteria.
4. It should explicitly preserve ray-miss semantics while adding out-of-bounds clamping.
5. It should include deterministic visual verification requirements for Item 1 and countdown no-pan behavior.

## Overall Assessment

1. Claude is materially more execution-ready and closer to the intent’s depth, but Item 1 strategy needs tighter technical grounding and clearer acceptance criteria.
2. Gemini is cleaner on scope discipline but too high-level in implementation and risk handling for immediate execution.
3. Best composite path: use Claude’s structure/verification rigor, incorporate Gemini’s tighter scope, and harden Item 1 with a concrete data-path decision before implementation.
