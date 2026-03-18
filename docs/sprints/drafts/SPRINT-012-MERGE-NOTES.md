# Sprint 012 Merge Notes

## Draft Sources

- **Claude Draft** (`SPRINT-012-CLAUDE-DRAFT.md`): Thorough, well-structured, good test coverage. Proposed fix in `processInventoryAction()` (step 1b).
- **Gemini-Perspective Draft** (`SPRINT-012-GEMINI-DRAFT.md`): Identified critical off-by-one bug with Claude's fix placement. More thorough edge case analysis. Proposed broader scope including cg-sim-player changes.
- **Codex Draft**: Timed out, not available.

## Claude Draft Strengths
- Clean, focused structure
- Good use case coverage
- Correct `max(attackCooldown, 3)` mechanic identification
- Practical test examples with expected values
- Good risk table

## Claude Draft Weaknesses
- **Critical: Fix placement causes off-by-one.** Placing the cooldown push in `processInventoryAction()` (step 1b, L587) means the decrement at L394 (step 6) consumes one tick on the eat tick itself, producing a 2-tick delay instead of 3.
- Does not mention INTENT.md fish table "1 tick" → "3 ticks" correction
- Does not address full HP edge case
- Test expected values are wrong due to the off-by-one (e.g., expects `attackCooldown == 2` after eat tick, should be `3`)

## Gemini Draft Strengths
- **Correctly identified the off-by-one** and proposed the right fix: place cooldown push AFTER the decrement in step 6
- Thorough tick-by-tick walkthrough proving the correct placement
- Full HP edge case test
- INTENT.md fish table correction
- `Boss.reset()` → `this.attackSpeed` improvement
- Detailed bot strategy analysis

## Gemini Draft Weaknesses
- Proposed modifying cg-sim-player (validator, reference, bot) — user explicitly forbids this
- Overly verbose architecture section with self-correcting analysis
- Some proposed test patterns depend on cg-sim-player changes

## Valid Critiques Accepted
1. **Off-by-one (Gemini → Claude):** ACCEPTED. The fix must go in step 6 after the decrement, not in step 1b.
2. **INTENT.md fish table (Gemini):** ACCEPTED. "1 tick" is wrong, should be "3 ticks."
3. **Full HP edge case (Gemini):** ACCEPTED. Added to tests.
4. **Boss.reset() hardcode (Gemini):** ACCEPTED. Should use `this.attackSpeed`.

## Valid Critiques Rejected
1. **cg-sim-player modifications (Gemini):** REJECTED per user directive. cg-sim-player is never modified.
2. **Bot strategy update (Gemini):** REJECTED per user directive.

## Interview Refinements
1. **Boss speed confirmed at 5 ticks** — user says the wiki entry for Corrupted Hunlef shows 5 ticks. No change needed.
2. **Never modify cg-sim-player** — all proposed validator/reference/bot changes removed from scope.
3. Boss attack speed audit phase removed entirely — speed is correct.
