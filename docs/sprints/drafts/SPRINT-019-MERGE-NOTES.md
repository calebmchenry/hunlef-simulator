# Sprint 019 Merge Notes

## Key Technical Insight

Codex critique identified that morph target deltas are **geometry data shared across all clips** — you can't scale attack clip deltas independently because all clips reference the same `geometry.morphAttributes.position` arrays. The per-clip scaling approach from Claude's draft won't work.

**Options for morph scaling:**
- Scale ALL morph target deltas uniformly (affects idle too — would need to increase idle to compensate)
- Scale morphTargetInfluences at runtime instead of geometry (cap influences at <1.0 for attack clips)
- Accept the authentic OSRS animation data as-is

## Draft Strengths

### Claude (224 lines)
- Mathematical camera distance calculation
- Correct phasing (viewport first, then camera)
- 920×576 canvas preserves more side-panel space
- Detailed implementation with code snippets

### Codex (145 lines)
- Identified morph data sharing issue (critical technical insight)
- Dual-mode tile projection (strict + clamped)
- Clamped-click-on-boss edge case identified
- Explicit unit test suggestion

### Gemini (64 lines)
- Concise, correctly scoped
- Concrete code snippets for click clamping

## Valid Critiques Accepted

1. **Per-clip morph scaling won't work** (Codex): Geometry is shared. Must scale uniformly or use influence-based approach.
2. **Clamped click landing on boss** (Codex/Gemini critique): If out-of-bounds click clamps to a tile the boss occupies, it would trigger attack instead of move. Need to handle this — clamped clicks should always be movement.
3. **Camera MAX_DISTANCE should increase** (Claude): Raising default to 18 without raising max from 20 leaves only 2 units of zoom-out headroom.
4. **Ray miss should stay null** (all critiques): Keep `!hit` guard for sky clicks.

## Critiques Rejected

1. **Export tool fix for morph scaling** (Gemini): Too heavy for this sprint. Runtime approach is faster to iterate.
2. **Input manager test file** (Codex): Nice-to-have but not essential for these UX tweaks.
3. **Dynamic morph normalization** (Codex): Over-engineered. Simple uniform scaling or influence cap is sufficient.

## Synthesis

- **Viewport**: 1024×576 (16:9, standard) — Claude's 920 is unusual
- **Camera**: DEFAULT_DISTANCE=18, MAX_DISTANCE=30, per Claude's math
- **Countdown**: Snap to player world position, not (0,0,0)
- **Click clamping**: Clamp in screenToTile, but clamped-outside clicks always queue movement (never attack)
- **Morph scaling**: Scale all morphTargetInfluences by a damping factor (e.g., 0.5) for ALL animations uniformly, since geometry is shared. This reduces attack explosiveness while keeping idle visible. Tune visually.
