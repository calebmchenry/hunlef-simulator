# Sprint 018 Draft Critique

This critique evaluates both drafts against `docs/sprints/drafts/SPRINT-018-INTENT.md`.

## Claude Draft (`docs/sprints/drafts/SPRINT-018-CLAUDE-DRAFT.md`)

### Strengths

1. Strong alignment to the intent's three-bug scope, with clear mapping from each bug to concrete code touchpoints in `Renderer3D.ts` and `AnimationController.ts`.
2. Investigation-first handling of Bug 1 is appropriate given the intent's uncertainty; it does not pretend the tornado root cause is already proven.
3. Implementation detail is execution-ready: phased plan, specific file ownership, and concrete code-level fix for the animation restart issue.
4. Regression awareness is good. It explicitly calls out idle/style-switch/death behavior and includes verification expectations beyond just the three primary symptoms.
5. Definition of Done is mostly measurable and includes build/tests/perf gates, which matches the intent's quality bar.

### Weaknesses

1. Scope creep risk: it proposes changes to `PlayerAnimationController.ts` and possibly `PLAYER_MODEL_YAW_OFFSET`, even though the intent only identifies boss-facing and boss attack-animation defects.
2. Bug 2 diagnosis is somewhat overconfident. The draft argues strongly for `BOSS_MODEL_YAW_OFFSET = 0`, but the intent explicitly leaves offset/sign as an open question requiring visual verification.
3. Bug 1 still lacks a decision framework for when to stop investigating and ship a minimal safe fix; it lists hypotheses and steps, but not a clear prioritization fallback.
4. The draft introduces extra work (player animation guard, optional player yaw change) without corresponding expansion of acceptance criteria, increasing regression surface.
5. It assumes screenshot validation will resolve Bug 1 root cause, but does not define any supplemental instrumentation or deterministic repro notes if screenshots are inconclusive.

### Gaps in Risk Analysis

1. Missing explicit risk for expanded scope: touching player animation and player yaw can introduce non-goal regressions and consume sprint capacity.
2. Missing explicit schedule risk for Bug 1 investigation depth (high uncertainty task in an otherwise surgical sprint).
3. Missing explicit risk that a same-state no-op guard could hide legitimate re-trigger semantics if design later expects restart/extend behavior for repeated attacks.
4. Missing explicit risk around asynchronous load timing (tornado spawn/update before GLTF template/texture readiness) causing intermittent behavior that screenshot spot checks may miss.

### Missing Edge Cases

1. Boss/player overlap (`dx = 0`, `dz = 0`) where facing math becomes ambiguous; behavior should be defined and validated.
2. Consecutive attacks with state transitions in between (e.g., magic -> style switch -> magic) to ensure the new guard does not create stalled or skipped transitions.
3. Tornado path before/after GLTF load completion, including fallback activation timing, to catch race-like rendering artifacts.
4. Failure-path validation for fallback render modes called out in intent constraints (maintain fallback behavior, not only primary GLTF path).

### Definition of Done Completeness

1. DoD is stronger than average and mostly complete for user-visible outcomes.
2. It should explicitly include constraint compliance from intent: no API changes, no new dependencies, and fallback-path preservation checks.
3. It should explicitly separate mandatory items from optional scope (player yaw/player animation parity) to avoid ambiguous completion status.
4. It should include a clear pass condition for Bug 1 uncertainty handling (for example: proven root cause plus verified fix in both normal and fallback tornado render paths).

## Gemini Draft (`docs/sprints/drafts/SPRINT-018-GEMINI-DRAFT.md`)

### Strengths

1. Concise and correctly focused on the same three bugs identified in the intent.
2. Correctly identifies the likely animation-fix pattern (`currentState` guard in `crossFadeTo`) and keeps it localized to `AnimationController`.
3. Keeps architecture changes minimal and avoids unnecessary refactor proposals.
4. Calls out that Bug 1 may be deeper than a simple fallback-cone issue, which is directionally aligned with intent uncertainty.

### Weaknesses

1. Too high-level to execute reliably. It lacks enough implementation detail for Bug 1 and Bug 2 to minimize trial-and-error.
2. Bug 1 technical hypothesis is speculative (uninitialized position/scale clipping) and not grounded in the intent's stronger root-cause options (texture failure, GLTF/fallback path, WebGL state).
3. Verification plan is underspecified: it references Playwright/screenshots but does not define concrete scenarios, ticks, or multi-angle checks from the intent strategy.
4. It omits several intent constraints in both plan and DoD (fallback-path preservation, frame-rate target, external test command expectations).
5. Regression coverage is thin compared to intent context; death/player animation impacts are not explicitly addressed.

### Gaps in Risk Analysis

1. Risk analysis is too shallow for this sprint's uncertainty profile, especially around Bug 1 investigation depth.
2. No explicit risk for choosing the wrong yaw correction approach (offset vs axis/sign changes) and shipping an incomplete facing fix.
3. No explicit risk for animation-state semantics regressions after adding same-state guard.
4. No explicit risk for asynchronous tornado asset loading/fallback timing issues.
5. No explicit risk for validation blind spots if screenshot checks are not scenario-complete.

### Missing Edge Cases

1. Repeated same-style attacks across adjacent ticks while the first clip is still in progress.
2. Rapid style alternation (magic/ranged) to ensure no crossfade or state-machine regressions.
3. Tornado spawn while GLTF has not finished loading, including fallback behavior.
4. Boss-facing validation near axis boundaries and overlap cases where `atan2` inputs are near zero.
5. Fallback rendering behavior when tornado texture load fails in CI/runtime variance scenarios.

### Definition of Done Completeness

1. DoD is directionally correct but incomplete relative to intent.
2. Missing explicit build/test gates from intent (`npm run build`, `npm test`, `cd ../cg-sim-player && npm test`).
3. Missing explicit frame-rate acceptance threshold (>30 fps).
4. Missing explicit fallback-path verification requirement.
5. Missing explicit non-regression criteria breadth (death behavior and broader animation interactions).

## Overall Assessment

1. Claude draft is substantially more implementation-ready and closer to intent depth, but it should tighten scope and make Bug 1 exit criteria explicit.
2. Gemini draft has the right direction but needs materially more detail in implementation, risk handling, edge-case coverage, and DoD specificity before execution.
3. The strongest combined approach would use Claude's structure and verification rigor while preserving Gemini's tighter scope discipline.
