# Sprint 015 Merge Notes

## Drafts
- **Claude**: Strong architecture section, good fallback strategy (3 options). Proposed NPC-style composite as preferred approach.
- **Gemini-perspective**: Excellent phasing, clear MVP scope cuts, critical open question about whether armor models are full-body replacements.
- **Codex**: Timed out.

## Key Agreements
- 3-phase structure: discovery → export → runtime
- 3 pre-composed GLTF files (one per weapon type)
- PlayerAnimationController modeled on existing AnimationController
- Preload all 3 at startup
- Cyan box fallback

## Interview Decisions
- Always use perfected (T3) armor visuals — 3 files, not 9
- Defer walk/run animation to future sprint
- Fallback if composition fails: use armor models without body (they may be full-body replacements)

## Merge Decisions
- Took Gemini's 3-phase structure with clear Phase 1 discovery gates
- Took Claude's detailed runtime integration section (Phase 3)
- Took Gemini's MVP scope cuts priority ladder
- Took Gemini's critical open question: "are armor models full-body replacements?"
- Added interview-driven constraint: always T3, no walk anim
