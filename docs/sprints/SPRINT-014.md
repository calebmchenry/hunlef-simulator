# Sprint 014: Fix Weapon State Management

## Overview

Three weapon-related issues:

1. **Slot counter off-by-1 (live bug):** `LoadoutScreen.ts` L128 counts the primary weapon as an inventory slot (`1 + ...`). Sprint 013 removed the primary from inventory, so this overcounts by 1.

2. **Config mutation during weapon swap (correctness hazard):** `GameSimulation.ts` L606-607 mutates `loadout.config.weaponType/Tier` on swap. If `Player.reset()` is ever called, it rebuilds inventory from the mutated config. Currently dead code, but a hazard.

3. **Duplicate weapon selection (UX bug):** The secondary weapon dropdown allows selecting the same type as the primary, creating a useless duplicate in inventory.

## Use Cases

1. **Slot counter accuracy:** Bow primary + staff secondary + 5 paddlefish = "Slots: 6/28" (not 7)
2. **Single weapon:** Bow primary, no secondary, 10 paddlefish = "Slots: 10/28" (not 11)
3. **Config immutability:** Swap weapons mid-fight → `loadout.config.weaponType` still reads original primary
4. **Duplicate prevention:** Select staff as primary → secondary dropdown shows only None/Bow/Halberd
5. **Primary change matches secondary:** Bow primary + staff secondary → change primary to staff → secondary resets to None

## Architecture

### Slot counter fix
Change L128 from `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)` to `const weapons = secondaryTypeSelect.value ? 1 : 0`.

### Config mutation fix
Delete L606-607. But **critically**, also update L602-603 to read `oldType`/`oldTier` from `loadout.weapon` instead of `loadout.config`. Without this, the second weapon swap would read the *original* primary from config instead of the *currently equipped* weapon.

The `Weapon` type already has `type: WeaponType` and `tier: Tier` fields, so `loadout.weapon.type` and `loadout.weapon.tier` work directly.

### Duplicate weapon guard
Filter the secondary dropdown to exclude the selected primary type. Reset secondary to "None" if primary changes to match it. Add a defensive guard at config construction.

## Implementation

### Phase 1: Fix slot counter (~10% of effort)

**File:** `src/render/LoadoutScreen.ts`

- [ ] L128: Change `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)` to `const weapons = secondaryTypeSelect.value ? 1 : 0`

### Phase 2: Fix config mutation and equip handler (~30% of effort)

**File:** `src/engine/GameSimulation.ts`

- [ ] Rewrite the equip case (L601-617) to read old weapon from `loadout.weapon` and remove config mutations:

```typescript
case 'equip': {
  const oldWeapon = player.loadout.weapon;
  player.loadout.switchWeapon(action.weaponType, action.weaponTier);
  const slotItem = inv.slots[action.slotIndex];
  if (slotItem) {
    slotItem.id = `${oldWeapon.type}_${oldWeapon.tier}`;
    slotItem.name = oldWeapon.name;
    slotItem.category = 'weapon';
    const spriteKey = `${oldWeapon.type}_${oldWeapon.tier}` as keyof typeof ITEM_SPRITES;
    slotItem.spriteUrl = ITEM_SPRITES[spriteKey] ?? '';
  }
  break;
}
```

- [ ] Add test: after weapon swap, `loadout.config.weaponType` still equals original
- [ ] Add test: after TWO swaps (equip secondary, then equip primary back), both swaps produce correct inventory state

### Phase 3: Prevent duplicate weapon selection (~35% of effort)

**File:** `src/render/LoadoutScreen.ts`

- [ ] Add `updateSecondaryOptions()` function that rebuilds `#secondary-weapon-type` options, excluding the value selected in `#weapon-type`. Always include "None".
- [ ] Call `updateSecondaryOptions()` on primary weapon type `change` event
- [ ] Call `updateSecondaryOptions()` once during initial setup
- [ ] If the current secondary matches the new primary, reset secondary to "" (None) and hide the tier row
- [ ] Call `updateSlotCount()` after any secondary reset to keep counter in sync
- [ ] Add defensive guard at L194: skip setting `secondaryWeaponType/Tier` in config if secondary value matches primary

### Phase 4: Validation (~25% of effort)

- [ ] `npm run build` — no errors
- [ ] `npm test` — all 185+ tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass (never modify cg-sim-player)
- [ ] Visual: slot counter shows correct count
- [ ] Visual: secondary dropdown excludes primary weapon type
- [ ] Visual: changing primary to match secondary resets secondary to None

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/LoadoutScreen.ts` | Modify L128 | Fix slot counter: remove `1 +` |
| `src/render/LoadoutScreen.ts` | Add function | `updateSecondaryOptions()` to filter dropdown |
| `src/render/LoadoutScreen.ts` | Modify ~L194 | Defensive guard against duplicate weapon |
| `src/engine/GameSimulation.ts` | Rewrite L601-617 | Read old weapon from `loadout.weapon`, remove config mutation |
| Test files | Add tests | Config immutability, double-swap correctness |

## Definition of Done

- [ ] Slot counter reads 0 when no secondary selected (not 1)
- [ ] Slot counter reads 1 when secondary selected (not 2)
- [ ] `loadout.config.weaponType` unchanged after mid-fight weapon swap
- [ ] Second weapon swap reads currently equipped weapon, not original config
- [ ] Secondary dropdown excludes the primary weapon type
- [ ] Changing primary to match secondary resets secondary to None
- [ ] `npm run build` succeeds
- [ ] `npm test` passes all tests
- [ ] `cd ../cg-sim-player && npm test` passes all tests

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Reading `oldWeapon` from `loadout.weapon` instead of config breaks something | Low | High | `loadout.weapon` is already the runtime authority — all combat code reads it. Verify with double-swap test. |
| Code elsewhere reads `loadout.config.weaponType` mid-fight | Low | High | Grep for all reads of `loadout.config.weaponType` and `loadout.config.weaponTier`. If found outside `buildFromLoadout`, update to read from `loadout.weapon`. |
| Dynamic dropdown rebuild loses secondary tier selection | Medium | Low | Preserve tier value when rebuilding type options. Only reset tier if type is reset to None. |
| Existing tests assert config is mutated after swap | Low | Medium | Update such tests to assert immutability instead. |

## Security Considerations

No security impact. UI cosmetics and removal of unnecessary mutation.

## Dependencies

- No new dependencies
- Never modify cg-sim-player

## Open Questions

1. **Resolved: Approach for config mutation** — Delete mutation lines AND update equip handler to read from `loadout.weapon` (not config). No `initialConfig` needed.
2. **Resolved: Duplicate weapon approach** — UI-level dropdown filtering plus defensive guard at config construction.
