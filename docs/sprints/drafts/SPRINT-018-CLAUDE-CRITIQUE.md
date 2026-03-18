# Sprint 018 — Claude Critique of Codex and Gemini Drafts

## Codex Draft

### Strengths

1. **Strongest Bug 1 analysis.** Codex correctly identifies that the tornado scale (`0.7` applied to raw model-space geometry) could produce world-filling meshes, which is the most plausible explanation for the full-screen mint artifact. Computing a bounding-box-derived scale factor at load time is a sound approach.
2. **Texture hardening.** Enforcing `NearestFilter`, `generateMipmaps = false`, and `ClampToEdgeWrapping` on the tiny 40x4 tornado texture is smart defensive coding — mipmap generation on a texture that small can produce degenerate LOD levels.
3. **Good use-case granularity.** Use cases 1-8 enumerate distinct acceptance criteria per bug, including edge cases like near-overlap jitter (UC4) and fallback behavior preservation (UC8).
4. **Same-state guard nuance.** Codex distinguishes between "currently playing" (suppress) vs "finished" (allow replay), which is more correct than a blanket `if same return`. An attack that fires on tick N, finishes on tick N+2, and fires again on tick N+3 should replay — a simple equality guard would incorrectly suppress it once the `finished` event returns to idle.
5. **Open Question 3 (style-switch vs attack priority)** is a real interaction the intent doc didn't address. If a style switch and attack fire on the same tick, the code in `updateBossAnimations` currently lets the attack win (it's checked first), but Codex raises this as a design question.

### Weaknesses

1. **Bug 1 root cause is likely simpler than described.** The intent doc notes the screen goes "mint green/static" — but examining the code, the tornado template scale of `0.7` is applied to a GLTF scene that's already been processed by `applyUnlitMaterials`. The GLTF model itself may just have huge vertex coordinates from the OSRS export (OSRS models use pixel-scale units in the hundreds). However, Codex's bounding-box normalization approach, while correct in principle, is over-engineered for this sprint. A simpler fix is to measure the actual model bounds once, pick a correct constant scale, and hardcode it — the same pattern already used for `BOSS_MODEL_SCALE = 5/675`.
2. **No concrete value for Bug 2 fix.** Codex says "validating/removing `BOSS_MODEL_YAW_OFFSET` inversion" but doesn't commit to what the fix is. The code is `Math.atan2(dx, dz) + Math.PI`. In Three.js, `Math.atan2(dx, dz)` already gives the angle that points the object's +Z toward (dx, dz). OSRS models face -Z, so adding `Math.PI` is correct in theory. But if the model was re-exported facing +Z (Sprint 015/017 modified exports), the offset should be `0`. Codex should have checked the model's rest orientation.
3. **Phase 4 verification is vague.** "Capture Playwright screenshots around first tornado spawn" — but doesn't specify how to deterministically reach the tornado spawn tick, what the screenshot should be compared against, or pass/fail criteria.
4. **Suggests a "debug overlay" (Open Question 4).** This is scope creep for a 3-bug-fix sprint. The intent doc explicitly says no new patterns.

### Gaps in Risk Analysis

- **Missing:** Cloning a GLTF scene that has been scale-normalized doesn't propagate the world matrix to clones unless `updateMatrixWorld()` is called. The tornado pool clones the template (`this.tornadoTemplate.clone()`) — if the bounding-box scale is applied to the template's local transform, clones inherit it, but if Codex's approach involves parent-level transforms, clones may not.
- **Missing:** The `applyUnlitMaterials` call on the tornado GLTF scene happens before any scale fix. If the mint screen is caused by the material/shader (not geometry), the scale fix alone won't resolve it.

### Missing Edge Cases

- What happens to pooled tornado meshes that were cloned from the OLD template scale if the template is reloaded? (Not applicable here since GLTF loads once, but the pool/clone pattern means any scale fix must be on the template before first clone.)
- The `finished` event handler returns to idle, but if a style-switch animation is playing and an attack fires, the attack will interrupt it. When the attack finishes, it returns to idle — not back to style-switch. This isn't a regression from this sprint, but Codex's UC7 ("idle and style-switch behavior remains intact") should acknowledge it.

### Definition of Done Completeness

Good overall. Includes death animation preservation (which Gemini omits). Includes fallback behavior check. Missing: explicit frame-rate requirement (intent says >30fps). Missing: `npm run build` / `npm test` / `cd ../cg-sim-player && npm test` — only says "Build/tests pass in both repos" without specifying commands.

---

## Gemini Draft

### Strengths

1. **Concise and readable.** The implementation section is clear, direct, and easy to follow. Each bug maps to a single numbered paragraph with root cause and fix.
2. **Bug 3 fix is the simplest correct approach.** `if (this.currentState === state) return;` in `crossFadeTo` is exactly the right minimal fix given the current code structure. Looking at the code, when `crossFadeTo('attack_magic')` is called while `attack_magic` is already playing, the `finished` event will eventually return to idle, and the next tick's attack will trigger a fresh `crossFadeTo('attack_magic')` from idle — so the simple guard works.
3. **Correctly identifies that the Bug 2 fix requires testing.** "We will test and update this offset (likely to `0` or `-Math.PI/2`)" is honest about not knowing the exact value without visual verification.

### Weaknesses

1. **Bug 1 analysis is the weakest.** "If this cone or the GLTF meshes are uninitialized in their position and scale when added to the scene, they might clip the camera" is vague speculation. The actual code shows tornado meshes ARE positioned (`mesh.position.set(...)` in `updateTornadoes`), so "uninitialized position" is unlikely. The real issue is more likely the raw model scale: the GLTF model vertices may be in OSRS pixel units (hundreds), and `scale.set(0.7, 0.7, 0.7)` barely shrinks them — a tornado mesh hundreds of units wide would fill the viewport. Gemini doesn't investigate this.
2. **No implementation detail for Bug 1 fix.** "Ensure the fallback material renders correctly or that the `tornado_tex0.png` texture loads gracefully. Ensure tornadoes are positioned correctly before becoming visible." These are observations, not a plan. What specifically changes in the code?
3. **Definition of Done is incomplete.**
   - No mention of death animation preservation.
   - No mention of fallback path preservation (cyan box, JSON boss, cone fallback).
   - No mention of `cd ../cg-sim-player && npm test`.
   - "Playwright verification tests and screenshots pass" — there are no existing Playwright screenshot pass/fail assertions for these bugs; this needs to be created, not just "passed."
4. **Risk section is thin.** Only two risks, and the second one ("might affect how consecutive, visually distinct attacks blend") is speculative about future features rather than analyzing current behavior.
5. **No architecture section depth.** Says "no structural architecture changes" and lists two bullet points. Doesn't describe the actual runtime flow (draw loop → update methods → animation controller), which means the reader can't assess whether the proposed fixes interact.

### Gaps in Risk Analysis

- **Missing:** What if the tornado GLTF loads successfully but the texture (`tornado_tex0.png`) fails independently? The GLTF load callback would fire (success path), but meshes would render with a default white/magenta material. Gemini's fix of "ensure texture loads gracefully" doesn't address this split failure mode.
- **Missing:** The simple `if (this.currentState === state) return;` guard in `crossFadeTo` also affects `playIdle()`. If something calls `playIdle()` while idle is already playing, it's now a no-op — which is fine. But if `playIdle()` is called to interrupt a half-played attack (returning to idle early), `currentState` would be `attack_magic`, not `idle`, so the guard wouldn't block it. This is correct behavior, but Gemini doesn't analyze it.
- **Missing:** No mention of frame-rate impact.

### Missing Edge Cases

- Rapid style switching: if the boss switches style and attacks on the same tick, which animation wins? The current code processes attacks before style switches in `updateBossAnimations`, so the attack triggers first, then the style switch immediately overwrites it. This is pre-existing behavior but relevant since Gemini claims "idle and style-switch animations continue to function without regression."
- Tornado mesh pool reuse: cloned meshes retain the original template's scale. If the fix changes the template scale after some clones already exist in the pool, those pooled meshes would have the wrong scale. (In practice this doesn't happen since tornadoes don't spawn before the GLTF load completes, but it's worth noting.)

### Definition of Done Completeness

Insufficient. Missing items:
- Death animation unchanged
- Fallback paths still work
- Frame rate >30fps
- Specific test commands (`npm run build`, `npm test`, `cd ../cg-sim-player && npm test`)
- No mention of what "screenshots pass" means concretely

---

## Head-to-Head Comparison

| Dimension | Codex | Gemini |
|-----------|-------|--------|
| Bug 1 root cause | Better — identifies scale as primary suspect | Weaker — vague "uninitialized" speculation |
| Bug 1 fix plan | Over-engineered (dynamic bounding box) but correct | Under-specified ("ensure loads gracefully") |
| Bug 2 fix plan | Equivalent — both acknowledge testing needed | Equivalent |
| Bug 3 fix plan | Slightly over-thought (finished vs playing) | Simpler and sufficient for current code |
| Definition of Done | More complete (death, fallbacks, both repos) | Missing several items |
| Risk analysis | Better coverage, 4 concrete risks | Thin, 2 risks |
| Scope discipline | Slight creep (debug overlay question) | Tight |
| Readability | More verbose, structured phases | Concise, scannable |

## Recommendation

**Use Codex as the base**, but simplify:

1. **Bug 1:** Replace the dynamic bounding-box normalization with a measured constant scale (like `BOSS_MODEL_SCALE = 5/675`). Measure the tornado model bounds once, pick a constant that produces ~1 tile height. Also add the texture filter hardening from Codex — it's cheap insurance.
2. **Bug 2:** Keep as-is from either draft. The fix requires visual testing; start by setting `BOSS_MODEL_YAW_OFFSET = 0` and screenshot from 4 directions.
3. **Bug 3:** Use Gemini's simpler guard (`if (this.currentState === state) return;`). The `finished` event already handles the idle-return path, so the "allow replay when finished" logic from Codex is unnecessary complexity — by the time the animation finishes, `currentState` has already been set back to `idle` by the `finished` handler, so the next `playAttack` call will be a state *change*, not a same-state request.
4. **Definition of Done:** Merge both lists. Add: death animation unchanged, fallback paths work, frame rate >30fps, explicit test commands.
5. **Drop** the debug overlay open question (scope creep).
