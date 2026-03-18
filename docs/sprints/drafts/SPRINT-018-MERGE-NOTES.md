# Sprint 018 Merge Notes

## Draft Strengths

### Claude Draft (223 lines — primary foundation)
- Investigation-first approach for Bug 1 with multiple hypotheses
- Concrete code-level fix for Bug 3 with analysis of edge cases
- Symmetric analysis of player yaw offset
- Complete DoD with build/test/perf gates

### Codex Draft (132 lines)
- Best Bug 1 root cause hypothesis (tornado model scale too large)
- Texture filter hardening for small textures
- Same-state guard with nuance (playing vs finished)

### Gemini Draft (47 lines)
- Simplest correct Bug 3 fix (`if same state return`)
- Tight scope discipline

## Valid Critiques Accepted

1. **Bug 1 root cause is model scale** (Claude critique of Codex): The tornado GLTF vertices are in OSRS units (hundreds), and `scale.set(0.7, 0.7, 0.7)` barely shrinks them. A 700-unit-wide tornado at 0.7 scale = 490 Three.js units — filling the viewport. Fix with a measured constant scale like BOSS_MODEL_SCALE.
2. **Dynamic bounding box is over-engineered** (Claude critique of Codex): Use a constant scale factor, not runtime calculation.
3. **Simple same-state guard is sufficient** (Claude critique defending Gemini's approach): The `finished` event returns to idle, so next attack triggers from idle (state change), not same-state. No need for progress-based logic.
4. **Apply to both controllers** (Claude draft): PlayerAnimationController has same crossFadeTo pattern.
5. **Texture filter hardening** (Codex): Cheap insurance for tiny textures.
6. **Drop debug overlay** (Claude critique): Scope creep.

## Critiques Rejected

1. **Gemini critique arguing progress-based guard**: Over-engineered. The finished→idle→attack flow means the simple guard works correctly. A re-triggered attack while playing will naturally complete, return to idle, and the next attack fires cleanly.

## Synthesis

Final sprint uses Claude's structure with:
- Codex's Bug 1 root cause (model scale) + texture hardening
- Claude's investigation-first approach for Bug 1 (screenshot to confirm before fixing)
- Both drafts' Bug 2 approach (test with BOSS_MODEL_YAW_OFFSET = 0, screenshot verify)
- Gemini's simple Bug 3 guard applied to both controllers
- Claude's complete DoD merged with Codex's items
