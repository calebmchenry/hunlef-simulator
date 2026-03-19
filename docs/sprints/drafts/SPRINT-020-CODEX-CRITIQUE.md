# Sprint 020 Draft Critique

This critique evaluates both drafts against `docs/sprints/drafts/SPRINT-020-INTENT.md`.

## Claude Draft (`docs/sprints/drafts/SPRINT-020-CLAUDE-DRAFT.md`)

### Strengths

1. It directly addresses the Sprint 019 failure mode and correctly pivots from per-frame influence scaling to load-time geometry delta scaling.
2. The plan is implementation-ready: phased tasks, concrete function boundaries, and explicit integration point in `loadBossGLTF()`.
3. Scale-factor reasoning is data-driven (using the delta table) rather than arbitrary, which should reduce tuning churn.
4. It includes a robust validation envelope: before/after screenshots, build/tests, external player tests, and frame-rate guard.
5. It explicitly considers long-term robustness (dynamic clip-to-index discovery) instead of assuming index ranges are immutable.

### Weaknesses

1. Scope expands beyond the intent’s primary target (attack clips 14-50) by defaulting to scale stomp/prayer/death too, which increases regression surface.
2. The dynamic-discovery design depends on animation-name mapping details (`ANIM_NAME_MAP`) that are not currently exported from `AnimationController.ts`, so the draft understates coupling/refactor cost.
3. Phase 3 and Phase 4 overlap on “remove Sprint 019 per-frame scaling,” creating redundant execution steps.
4. It proposes scaling `morphAttributes.normal` as a precaution even though boss rendering is unlit in current code, adding complexity without clear sprint value.
5. It does not define a guard against accidental double-application if scaling runs more than once in a renderer lifecycle.

### Gaps in Risk Analysis

1. No explicit risk for clip-name or mapping mismatches in the dynamic path, which could silently leave some target indices unscaled.
2. No explicit risk around assumptions about morph data semantics (`morphTargetsRelative` / attribute interpretation) before scaling.
3. No explicit risk for uneven morph target counts across primitives causing partial scaling and inconsistent deformation.
4. No explicit risk for subjective screenshot-based acceptance without deterministic capture checkpoints.
5. No explicit rollback strategy if attack improvements degrade death/stomp readability after tuning.

### Missing Edge Cases

1. Transition edge cases: `attack_magic -> death`, `attack_ranged -> style_switch`, and rapid alternation between scaled and unscaled clip families.
2. Behavior when a clip references morph indices not mapped to known states (future export variants).
3. Multi-mesh cases where some children have fewer morph targets than expected for a referenced index.
4. Full fallback-path validation when GLTF load fails and JSON boss path is used.
5. Recreate/reload lifecycle scenarios to confirm scaling is not applied cumulatively.

### Definition of Done Completeness

1. DoD is strong and mostly aligned with intent constraints.
2. It should require deterministic screenshot protocol (same tick/time, camera pose, and frame) rather than only generic before/after capture.
3. It should explicitly include acceptance criteria for `prayer_disable` if that clip is intentionally being scaled.
4. It should explicitly include fallback JSON-path non-regression verification.
5. It should separate mandatory ship criteria from optional tuning refinements to avoid ambiguous “done” state.

## Gemini Draft (`docs/sprints/drafts/SPRINT-020-GEMINI-DRAFT.md`)

### Strengths

1. It captures the core correction from intent: avoid global runtime influence scaling and patch geometry deltas at load time.
2. Scope is intentionally tight and localized to `Renderer3D.ts`, which limits blast radius.
3. It clearly protects idle/style-switch ranges from modification.
4. It keeps dependencies and external project boundaries (`cg-sim-player`) intact.
5. It acknowledges that scale-factor tuning may require iteration.

### Weaknesses

1. The implementation plan is too high-level for direct execution (no concrete helper structure, traversal safeguards, or scaling policy details).
2. It relies on hardcoded index ranges only, with no robustness plan if GLTF morph ordering changes on re-export.
3. It is ambiguous about whether stomp/prayer/death are in or out of scope (“possibly”), which weakens execution clarity.
4. It does not address existing retargeted multi-primitive morphology behavior that can affect where morph attributes live.
5. It omits explicit cleanup/verification for residual per-frame influence scaling paths.
6. It omits one intent-required external gate in DoD (`cd ../cg-sim-player && npm test`).

### Gaps in Risk Analysis

1. No explicit risk for hardcoded index drift after exporter/model updates.
2. No explicit risk for out-of-range index access or partial application across meshes with different morph counts.
3. No explicit risk for shared geometry/BufferAttribute mutation side effects across mesh instances.
4. No explicit risk for over-damping death/stomp if a uniform factor is applied broadly.
5. No explicit risk for relying on qualitative screenshot review without deterministic checkpoints.
6. No explicit risk for fallback-path regressions when GLTF loading fails.

### Missing Edge Cases

1. Attack transition boundaries (attack->idle, attack->death, attack->style-switch) under one-shot animation flow.
2. Separate visual validation for stomp/prayer/death if those ranges are also scaled.
3. Mixed primitive morphology where child meshes expose different morph-target counts.
4. GLTF failure path to ensure JSON fallback remains unaffected.
5. Repeated model load/re-init scenarios that could cause cumulative scaling.
6. Future clip/index reshuffles from asset re-export.

### Definition of Done Completeness

1. DoD is directionally correct but incomplete against the intent bar.
2. Missing required external test gate: `cd ../cg-sim-player && npm test`.
3. Missing required performance gate: frame rate > 30 fps.
4. Missing explicit non-regression criterion that death and stomp remain acceptable (called out in intent success criteria).
5. Screenshot verification is not specific enough for reliable sign-off (no fixed moments/viewpoints).
6. Missing explicit fallback-path validation criteria.

## Overall Assessment

1. Claude is significantly more execution-ready and closer to intent depth, but it should tighten scope boundaries and harden risk/acceptance criteria around mapping and deterministic validation.
2. Gemini has a correct high-level direction but needs materially more implementation detail, stronger risk coverage, and fuller DoD gates before execution.
3. Best combined path: keep Claude’s structure and verification rigor, then adopt a stricter scope policy (attack-first) with explicit fallback and deterministic visual acceptance criteria.
