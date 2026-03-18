# Sprint 017 Critique: Codex Draft vs Gemini Draft

This critique evaluates both drafts against the intent document's root cause analysis, open questions, and success criteria. The intent establishes that GLTF morph target data is valid and non-zero — the bugs are renderer-side.

---

## Codex Draft

### Strengths

1. **Correctly decomposes the problem into model preparation and material pipeline as separate phases.** Phases 1 and 2 map cleanly to Bugs 1 and 2 from the intent. Separating "morph-binding prep" from "material morph support" means each fix can be validated independently, reducing debugging surface area.

2. **Trigger dispatch phase addresses real gaps.** The intent mentions 8 boss animations, but the current code only wires attack, style-switch, and death. Phase 3 explicitly adds stomp dispatch from overlap events and addresses the prayer-disable gap with a pragmatic "debug trigger or gameplay event" fallback. Neither the intent's success criteria nor the Gemini draft call out that stomp and prayer triggers are currently unwired.

3. **Style-switch/attack same-tick collision is identified.** The draft recognizes that `playAttack()` and `playStyleSwitch()` can collide on the same tick and proposes gating. This is a real edge case in the Corrupted Hunlef fight where style switches coincide with attack ticks. The Gemini draft doesn't mention this.

4. **Controller transition guards prevent popping.** The proposal to add no-op guards for redundant state transitions addresses a subtle but visible issue: if the animation controller receives the same state command twice, it can restart the crossfade and cause a visual pop. Defensive without being over-engineered.

5. **Open questions are well-formed and actionable.** Questions 2 (asset validator), 3 (attack vs style-switch priority), and 4 (debug panel) are implementation-blocking decisions that the implementer will hit. Surfacing them explicitly prevents mid-sprint scope creep.

6. **Files summary is minimal and accurate.** Only 3 files marked for modification (with `GameSimulation.ts` as optional), which matches the intent's "1-2 files" scope estimate. Resists the urge to add new files or extract utilities.

### Weaknesses

1. **The multi-primitive binding fix is underspecified.** Phase 1 says "align root/child morph influence binding so mixer-driven weight tracks affect rendered meshes" but doesn't commit to a concrete strategy. The intent's Open Question 3 asks whether to merge primitives at load time or fix targeting at runtime. The draft acknowledges this choice exists (Open Question 2) but doesn't recommend one. This is the PRIMARY bug — the draft should have a clear recommendation even if provisional. The Gemini draft at least commits to "redirect animation channels from the root Group to its child Mesh primitives."

2. **No phased validation between phases.** Phase 4 bundles all manual verification at the end. But Bug 2 (material) can be validated before Bug 1 (binding) by checking whether `morphTargetInfluences` arrays exist on meshes after material replacement. A verification step between Phases 1 and 2 would catch regressions early.

3. **"Optional diagnostics" in Phase 1 should be mandatory.** Dev-only logs for root type, child mesh count, morph targets, and clip mappings are essential for debugging animation binding issues. Making them "optional" risks an implementer skipping them and then spending hours on silent AnimationMixer failures.

4. **No mention of the diagnostic validation script.** The intent's verification strategy explicitly calls for `tools/cache-reader/validate-gltf.mjs`. The Gemini draft includes it. The Codex draft omits it entirely.

5. **Performance is not addressed.** The intent requires >30fps with all animations active. The boss has 144 morph targets with 6043 non-zero values — that's a non-trivial per-frame GPU workload. The draft has no performance risk entry and no DoD item for frame rate.

6. **Prayer-disable handling is too vague.** "Map to an existing gameplay event if semantically correct, or expose a debug trigger" leaves the implementer with an open design decision mid-sprint.

### Gaps in Risk Analysis

- **No performance risk for 144 morph targets.** The boss model has 144 morph targets across 2 primitives. If the binding fix successfully propagates weights to both child meshes, the GPU evaluates 144 blend shapes per primitive per frame. This is the most likely source of frame drops and should be a listed risk.
- **No risk for AnimationMixer silent failure modes.** Three.js AnimationMixer silently skips tracks that can't bind. If the retargeting is partially wrong, some animations will play and others won't, with no error output.
- **Risk 1 ("may differ between Three.js internals and current assets") is too generic.** Should specify what could differ — e.g., whether `PropertyBinding` resolves `.morphTargetInfluences` by name or index, and what happens if the two child meshes have different morph target counts.

### Missing Edge Cases

- **Primitives with mismatched morph target counts.** The intent says each GLTF has 2 primitives (opaque + alpha). If the alpha primitive has fewer morph targets, the binding fix must handle arrays of different lengths on the two child meshes.
- **Player weapon switching.** The player can switch between bow, staff, and halberd mid-fight. When the body GLTF swaps, the `PlayerAnimationController` must rebind to the new model's morph targets. The draft doesn't address teardown/rebind on weapon switch.
- **Animation clip name mismatches.** The draft assumes animation clips in the GLTF map cleanly to controller states. If clip names don't match `ANIM_NAME_MAP` entries, the binding will silently fail. No validation step checks this.
- **Crossfade between clips with different morph target subsets.** If two clips animate different morph targets, a crossfade could leave some targets at stale values.

### Definition of Done Completeness

The DoD has 9 items and covers the core success criteria well. However:

- Missing: frame rate target (>30fps) — explicit intent constraint.
- Missing: verification that weapon switching doesn't break player animations.
- Missing: verification that AnimationMixer has no unbound tracks (no silent failures).
- "Boss stomp clip is triggerable from gameplay overlap" — should specify how to trigger it for manual verification.

---

## Gemini Draft

### Strengths

1. **Commits to a concrete retargeting strategy.** "Redirect animation channels from the root Group to its child Mesh primitives" and "implement explicit retargeting logic for `morphTargetInfluences`" is more actionable than the Codex draft's abstract "align binding" language.

2. **Includes the diagnostic validation script.** Step 1 creates `tools/cache-reader/validate-gltf.mjs` as specified in the intent. This provides an automated baseline check before and after renderer changes.

3. **DoD includes frame rate target.** "Simulation maintains framerates > 30fps with all animations playing" directly matches the intent constraint. The Codex draft omits this.

4. **DoD includes crossfade smoothness.** "Crossfade transitions are smooth (no popping)" is a success criterion from the intent that the Codex DoD doesn't explicitly list.

5. **Concise and focused.** At 53 lines, this is a tight spec that doesn't over-scope. Every section directly addresses one of the three bugs from the intent.

6. **Fallback protection is called out as a distinct implementation concern.** Step 5 ("Ensure fallback mechanisms do not crash when `morphTargetInfluences` fails to bind") correctly identifies that the binding fix could introduce new crash paths in the fallback case.

### Weaknesses

1. **No phasing or ordering.** The implementation section lists 5 numbered steps but doesn't define phases or dependencies. Step 3 (animation mixer fixes) depends on Step 2 (material fixes). Without explicit ordering, an implementer might parallelize incorrectly or skip ahead.

2. **Missing trigger dispatch entirely.** The intent identifies 8 boss animations, including stomp and prayer-disable, which are currently unwired. The Gemini draft says "verify that AnimationController and PlayerAnimationController properly configure loop conditions and trigger them at the correct simulation events" — but this assumes the triggers already exist. They don't. The Codex draft correctly identifies stomp and prayer as new wiring work. This is the biggest gap.

3. **Style-switch/attack collision not addressed.** The intent describes boss style-switch and attack happening on the same tick. The Gemini draft doesn't mention this timing conflict at all.

4. **"Retarget animation channels" is stated but not designed.** The draft says to redirect channels but doesn't explore how. Options include: (a) rewriting clip track names at load time, (b) creating a secondary mixer per child mesh, (c) merging primitives into one mesh, (d) using `PropertyBinding` path overrides. Each has different tradeoffs and the draft should recommend one.

5. **Open questions are copied verbatim from the intent.** All three open questions are identical to the intent's. A sprint draft should attempt to answer or narrow these, not repeat them. The Codex draft adds new questions while partially addressing the originals.

6. **No mention of controller API preservation.** The intent explicitly constrains "keep existing animation controller API (playIdle, playAttack, etc.)." The Gemini draft lists the controller files for modification but doesn't state the public API must remain unchanged.

7. **Performance risk is shallow.** "Continuously updating many morph targets per frame could introduce frame rate drops if not optimized" is correct but doesn't quantify. 144 morph targets is high for Three.js. What optimization would help? (Limit active influences, reduce target count.) The risk should be more specific.

8. **No transition guard / popping prevention.** The Codex draft identifies that redundant state transitions can cause visual popping and proposes no-op guards. The Gemini draft doesn't cover this.

### Gaps in Risk Analysis

- **No risk for unbound AnimationMixer tracks.** Silent failures are the primary debugging challenge for this sprint.
- **No risk for player weapon switching teardown.** Switching weapons replaces the body GLTF. If the old `PlayerAnimationController` still references disposed meshes, it will error or leak.
- **No risk for morph target count mismatch between primitives.** If the opaque and alpha primitives have different morph target counts, a shared binding approach will fail on the smaller primitive.
- **"Multi-primitive Complexity" risk is correct but needs specifics.** `PropertyBinding` resolves paths like `meshName.morphTargetInfluences[0]` — if child meshes are unnamed (common in GLTF exports), the binding fails silently.

### Missing Edge Cases

- **Stomp and prayer-disable triggers don't exist** — the draft assumes they do.
- **Player weapon switch mid-animation.** What happens if the player switches weapons during an attack animation? The old clip references morph targets on a mesh about to be removed.
- **Boss death while another animation is crossfading.** The death animation must preempt the in-progress crossfade. The draft mentions clamping but not preemption.
- **GLTF load failure after partial setup.** If the GLTF loads but animation parsing fails, the material pass may have already run. The fallback path needs to handle this partial state.
- **Tab backgrounding during animation.** If the tab is backgrounded and `dt` spikes on resume, animations can jump. Worth verifying the controller clamps `dt`.

### Definition of Done Completeness

The DoD has 7 items and covers the essential criteria. Strengths: includes frame rate (>30fps), crossfade smoothness, fallback robustness with "no console errors," and all three test suites.

However:

- Missing: stomp and prayer-disable trigger verification (because the draft assumes they exist).
- Missing: player weapon switch doesn't break animations.
- Missing: AnimationMixer has no unbound/silent-fail tracks.
- Missing: death animation preempts in-progress animations.
- Missing: controller public API hasn't changed.
- "All correct events" is vague — should enumerate which events.

---

## Head-to-Head Comparison

| Dimension | Codex | Gemini | Edge |
|-----------|-------|--------|------|
| Root cause understanding | Correctly decomposes all 3 bugs; adds trigger dispatch gap | Covers bugs 1-2 well; misses trigger wiring gap | Codex |
| Binding fix specificity | Underspecified — "align binding" without a strategy | More specific — "redirect channels to child meshes" — but no design options | Gemini (slight) |
| Trigger completeness | Identifies stomp/prayer as unwired, proposes dispatch additions | Assumes triggers exist, just needs verification | Codex |
| Phase structure | 4 clear phases with logical ordering | 5 numbered steps without dependencies or ordering | Codex |
| Diagnostic tooling | Omits the validation script entirely | Includes `validate-gltf.mjs` as specified in intent | Gemini |
| Controller safety | Transition guards, API preservation, same-tick collision handling | Not addressed | Codex |
| Performance awareness | No risk entry, no DoD item | Risk entry (shallow) + DoD item (>30fps) | Gemini |
| Risk analysis depth | 4 risks, well-targeted but misses performance | 3 risks, correct but generic and shallow | Codex |
| DoD completeness | 9 items, missing fps and crossfade | 7 items, missing triggers and API preservation | Tie — each covers what the other misses |
| Scope discipline | Tight, renderer-only with optional simulation change | Tight, but misses scope that IS needed (trigger wiring) | Codex |
| Open questions | Adds new actionable questions beyond intent | Repeats intent questions verbatim | Codex |

---

## Recommendations for the Final Sprint Document

1. **Use the Codex draft as the structural base.** Its 4-phase structure, trigger dispatch coverage, controller transition guards, and same-tick collision handling are all load-bearing contributions that the Gemini draft misses.

2. **Commit to a concrete multi-primitive binding strategy.** Neither draft fully resolves Intent Open Question 3. Recommend: **rewrite clip track names at load time** to target child mesh `morphTargetInfluences` directly. This is the simplest approach that doesn't require merging geometry or creating secondary mixers. If child meshes are unnamed, assign names during the morph-binding prep phase. Add a fallback that attempts primitive merging if track rewriting fails.

3. **Include the diagnostic validation script** from the Gemini draft. `tools/cache-reader/validate-gltf.mjs` should be Phase 0, run before any renderer changes, to establish a baseline. It should verify: (a) morph target data is non-zero, (b) keyframe times are valid float32 seconds, (c) animation clip names match expected `ANIM_NAME_MAP` keys.

4. **Add performance to the risk table and DoD.** 144 morph targets on the boss is high. Add a risk entry noting that if frame rate drops below 30fps, the mitigation is to limit active morph influence count. Add ">30fps with all animations active" to the DoD.

5. **Make Phase 1 diagnostics mandatory, not optional.** Dev-only console logs for mesh hierarchy, morph target counts per primitive, clip names, and track binding results are essential for a sprint where the primary failure mode is "AnimationMixer silently does nothing."

6. **Add player weapon-switch teardown/rebind to Phase 3.** When the player switches weapons, the body GLTF changes. The `PlayerAnimationController` must be torn down and rebound to the new model. Verify this works without leaking the old mixer or leaving dangling references.

7. **Resolve the prayer-disable question now, not during implementation.** Check whether `GameSimulation` emits any prayer-related events. If yes, wire the trigger. If no, add a `debug_trigger` mechanism with a console command or keyboard shortcut. Don't leave this as an open question.

8. **Merge DoD items from both drafts.** The final DoD should include:
   - All 8 boss animations trigger and visibly deform (enumerate them)
   - All 3 player animation types play on all 3 body variants
   - Crossfade transitions are smooth
   - Death animation clamps and preempts in-progress animations
   - Stomp and prayer-disable are triggerable (specify how)
   - Weapon switch doesn't break player animations
   - Fallbacks work without console errors
   - >30fps with all animations active
   - Controller public APIs unchanged
   - `npm run build`, `npm test`, `cd ../cg-sim-player && npm test` pass
   - No unbound AnimationMixer tracks (verify via diagnostic logs)
