# Sprint 020 Merge Notes

## Consensus
All three drafts agree on load-time geometry delta scaling for specific morph target indices. Claude and Codex prefer dynamic discovery from clips; Gemini uses hardcoded ranges. All recommend ~0.3 scale factor for attacks.

## Accepted
- Dynamic discovery from animation clip tracks (Claude) — robust to re-exports
- Attack-first scope: scale only attack_magic + attack_ranged initially (Codex critique)
- Separate tunable factors per clip category (Claude)
- Idempotency guard via geometry userData marker (Codex)
- Keep stomp/death/prayer as optional follow-up tuning, not mandatory

## Rejected
- Hardcoded ranges only (Gemini) — too brittle
- Scaling morphAttributes.normal (Claude) — boss uses unlit material, no effect
- Expanding to stomp/death in mandatory scope (Claude) — keep focused
