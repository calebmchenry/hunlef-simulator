# Sprint 017 Draft Critique

This critique evaluates both drafts against `docs/sprints/drafts/SPRINT-017-INTENT.md`.

## Claude Draft (`docs/sprints/drafts/SPRINT-017-CLAUDE-DRAFT.md`)

### Strengths

1. Strong alignment with intent: it centers the renderer-side diagnosis (multi-primitive targeting, material setup, mixer binding) instead of reopening exporter scope.
2. Implementation detail is execution-ready: clear phases, specific file touchpoints, and concrete integration points in `Renderer3D.ts`.
3. Good scope control: preserves controller APIs, keeps dependency constraints, and keeps fallback behavior in scope.
4. DoD is specific and testable: it enumerates boss/player animation outcomes, clamp behavior, regressions, and test/build gates.

### Weaknesses

1. It assumes `morphTargets: true` is required in r183 without first proving current runtime behavior in this repo.
2. Retargeting logic is likely over-coupled to track-name parsing and object naming; the draft does not define a robust fallback when names are missing/sanitized/duplicated.
3. It mutates clip tracks in place but does not address idempotency (e.g., preventing double-retarget on reload/re-entry).
4. Diagnostic logging is useful short-term, but the draft does not define how much logging remains after validation (potential noise/perf overhead).

### Gaps in Risk Analysis

1. No explicit risk for name collisions and `PropertyBinding` name sanitization, which can silently break rewritten paths.
2. No explicit risk for partial retarget success (some tracks bind, some silently fail), which could produce hard-to-debug “half-animated” states.
3. No explicit risk for duplicated track volume after retargeting (2 primitives doubles weight tracks), especially across three player body variants.
4. No explicit risk for retarget being applied more than once to the same clip data.

### Missing Edge Cases

1. Clips with empty or missing `animations` arrays (GLTF loads, but no animation data).
2. Weight tracks with nonstandard naming formats (bare property path, node-index-like name, sanitized names).
3. Child primitives with mismatched morph-target counts or ordering.
4. Clips containing both morph and non-morph tracks; retarget must not alter unrelated tracks.
5. Repeated model load paths where retarget helper might run twice.

### Definition of Done Completeness

1. Overall strong and close to complete.
2. Missing explicit pass/fail criterion for “no mixer binding warnings / no unresolved bindings.”
3. Missing explicit criterion for idempotent retarget behavior (no duplicated tracks on repeated setup).
4. Should explicitly verify each player body variant independently (bow/staff/halberd), not just “player animations” in aggregate.

## Gemini Draft (`docs/sprints/drafts/SPRINT-017-GEMINI-DRAFT.md`)

### Strengths

1. Correct high-level direction: renderer-side fixes, not exporter changes.
2. Keeps key user-visible goals in scope: morph playback, crossfades, death clamp, fallback robustness.
3. Keeps dependencies constrained and acknowledges Three.js-version-specific behavior as a concern.

### Weaknesses

1. Too high-level to execute confidently: it does not define the retargeting algorithm (track matching, rewrite rules, removal strategy, validation).
2. Ownership is ambiguous (`Renderer3D.ts` vs both animation controllers), which increases churn risk and makes scope creep likely.
3. The diagnostic script task is underspecified and lower priority relative to direct runtime fixes already identified in intent.
4. No phased rollout or sequencing, so there is no clear critical path or fallback plan if one fix does not resolve playback.

### Gaps in Risk Analysis

1. Missing risk for name-based binding brittleness and node-name sanitization.
2. Missing risk for morph-target index/count mismatch between the two child primitives.
3. Missing risk for accidental double-retarget during repeated load/setup.
4. Missing risk for regressions from material replacement behavior on non-animated meshes.
5. Missing risk for “fix appears to work on one model but fails on other player body variants.”

### Missing Edge Cases

1. Single-primitive meshes where retarget should be a no-op.
2. GLTFs that load successfully but have empty clips.
3. Per-variant animation differences across `player_body_{bow,staff,halberd}`.
4. Clip naming mismatches versus `ANIM_NAME_MAP` expectations.
5. Fallback behavior when morph tracks exist but fail to bind at runtime.

### Definition of Done Completeness

1. DoD is directionally correct but too coarse compared with intent.
2. It should explicitly list all boss animations/events and per-weapon player expectations.
3. It should explicitly require preservation of unaffected rendering features called out in intent.
4. It should add a no-op/non-regression criterion for models that do not need retargeting.

## Overall Assessment

1. Claude draft is materially closer to implementation-ready and better aligned with the intent’s constraints and acceptance criteria.
2. Gemini draft has the right direction but needs a concrete retargeting design, clearer file ownership, stronger risk coverage, and tighter DoD granularity.
