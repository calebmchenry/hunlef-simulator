# Sprint 014 Merge Notes

## Draft Sources
- **Claude Draft**: Caught the critical `oldType`/`oldTier` bug — after removing config mutation, the equip handler must read from `loadout.weapon` not `loadout.config`.
- **Gemini Draft**: Cleanest structure, correct on slot counter and dropdown filtering, but missed the `oldType`/`oldTier` issue.
- **Codex Draft**: Timed out.

## Critical Finding (Claude → Gemini critique)
Gemini proposes deleting L606-607 (config mutation) but doesn't update L602-603 which reads `oldType`/`oldTier` from `loadout.config`. After the deletion, on the SECOND weapon swap, this reads the original primary (from config) instead of the currently equipped weapon. Fix: read `oldWeapon` from `loadout.weapon` which has `type` and `tier` fields.

## Merge Decisions
- Slot counter: Gemini's approach (simplest)
- Config mutation: Claude's approach (also update L602-603 to read from loadout.weapon)
- Dropdown filtering: Both aligned on UI filtering approach
- Defensive guard: Gemini's belt-and-suspenders guard at config construction
