# Sprint 014: Fix Weapon State Management

## Overview

Three weapon-related state management issues:

1. **Config mutation on weapon swap (correctness hazard):** `GameSimulation.ts` L606-607 mutates `loadout.config.weaponType` and `loadout.config.weaponTier` during the equip action. If `Player.reset()` is ever called, `buildFromLoadout()` would rebuild inventory using the mutated (swapped) weapon as primary — yielding a wrong loadout. Currently dead code corruption since `reset()` is never called in production (restart goes through `returnToLoadout()` → fresh `LoadoutConfig`), but a correctness hazard.

2. **Duplicate weapon selection (UI bug):** `LoadoutScreen.ts` L194-196 allows `secondaryWeaponType` to equal `weaponType`. The user can select e.g. staff/staff, creating a duplicate weapon in inventory that makes no gameplay sense.

3. **Slot counter off-by-1 (live bug):** `LoadoutScreen.ts` L128 calculates `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)`. Sprint 013 removed the primary weapon from inventory, so the `1 +` overcounts by 1. Users see "Slots: 19/28" when actual usage is 18.

## Use Cases

1. **Weapon swap mid-fight:** Player equips secondary weapon; config remains unchanged; if `reset()` is called later, original loadout is faithfully restored.
2. **Selecting loadout with secondary weapon:** User picks staff primary, bow secondary. The dropdown prevents picking staff as secondary (or vice versa). Slot counter shows correct count.
3. **Selecting loadout without secondary weapon:** Secondary set to "None". Slot counter shows 0 weapons in inventory.
4. **Changing primary weapon type:** Changing the primary dropdown updates the secondary dropdown to exclude the newly selected primary type. If the secondary was the same type, it resets to "None".
5. **Player.reset() after weapon swap:** Inventory rebuilds with the original primary weapon, not the swapped weapon.

## Architecture

### Issue 1: Config mutation fix

The `Loadout` class already tracks the current weapon in `this.weapon` via `switchWeapon()`. The config mutation on L606-607 is redundant — `switchWeapon()` already does the work. The config should remain immutable after construction to serve as the "original loadout" for any future `reset()` call.

**Fix:** Delete the two config mutation lines in `GameSimulation.ts` L606-607. `Loadout.switchWeapon()` already sets `this.weapon` to the new weapon; that's the authoritative "current weapon" state. The config retains the original loadout for `reset()`.

**Why this is safe:** Every consumer of the current weapon reads `loadout.weapon`, not `loadout.config.weaponType`. The `equip` action already calls `switchWeapon()` on L605. The config is only read by `buildFromLoadout()` in `reset()` / constructor.

### Issue 2: Duplicate weapon guard

**Fix:** In `LoadoutScreen.ts`, when the primary weapon type changes, filter the secondary dropdown to exclude the selected primary type. When the secondary changes, if it matches the primary, reset it to "None". This is a UI-level guard — no engine changes needed.

**Approach:** Add a `syncSecondaryOptions()` helper that:
1. Reads the current primary weapon type value.
2. For each `<option>` in the secondary dropdown: hide/disable options matching the primary type; if the currently selected secondary matches the primary, reset secondary to `""` (None).
3. Call `syncSecondaryOptions()` on primary type change and on initial build.

### Issue 3: Slot counter fix

**Fix:** Change L128 from `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)` to `const weapons = secondaryTypeSelect.value ? 1 : 0`. The primary weapon is equipped (not in inventory), so it should not count toward inventory slots.

## Implementation

### Phase 1: Remove config mutation (~25% of effort)

**File:** `src/engine/GameSimulation.ts`

**Tasks:**
- [ ] Delete L606-607 (`player.loadout.config.weaponType = action.weaponType;` and `player.loadout.config.weaponTier = action.weaponTier;`). The equip case becomes:

```typescript
case 'equip': {
  const oldType = player.loadout.config.weaponType;
  const oldTier = player.loadout.config.weaponTier;
  const oldWeapon = WEAPONS[oldType][oldTier];
  player.loadout.switchWeapon(action.weaponType, action.weaponTier);
  const slotItem = inv.slots[action.slotIndex];
  if (slotItem) {
    slotItem.id = `${oldType}_${oldTier}`;
    slotItem.name = oldWeapon.name;
    slotItem.category = 'weapon';
    const spriteKey = `${oldType}_${oldTier}` as keyof typeof ITEM_SPRITES;
    slotItem.spriteUrl = ITEM_SPRITES[spriteKey] ?? '';
  }
  break;
}
```

**Important subtlety:** After this change, `oldType`/`oldTier` must come from `loadout.weapon` (the live equipped weapon) rather than `loadout.config` (the original loadout). Otherwise the second swap would read the *original* primary from config instead of the *currently equipped* weapon.

Corrected equip case:

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

- [ ] Verify `Weapon` type in `src/equipment/items.ts` has `type` and `tier` fields. If not, read them from the weapon key or add them. **This must be confirmed before implementation.**
- [ ] `npm test` — verify all existing tests pass with this change
- [ ] `cd ../cg-sim-player && npm test` — verify all tests pass

### Phase 2: Prevent duplicate weapon selection (~30% of effort)

**File:** `src/render/LoadoutScreen.ts`

**Tasks:**
- [ ] Add a `syncSecondaryOptions()` function inside `build()`, after element references are obtained:

```typescript
const syncSecondaryOptions = () => {
  const primaryType = weaponTypeSelect.value;
  const options = secondaryTypeSelect.querySelectorAll('option');
  options.forEach(opt => {
    if (opt.value && opt.value === primaryType) {
      opt.disabled = true;
      opt.style.display = 'none';
    } else {
      opt.disabled = false;
      opt.style.display = '';
    }
  });
  // If current secondary matches primary, reset to None
  if (secondaryTypeSelect.value === primaryType) {
    secondaryTypeSelect.value = '';
    secondaryTierRow.style.display = 'none';
    updateSlotCount();
  }
};
```

- [ ] Call `syncSecondaryOptions()` inside the `weaponTypeSelect` change handler (within `updatePreview` or as a separate listener)
- [ ] Call `syncSecondaryOptions()` once during initial build (after `updatePreview()` / `updateSlotCount()`)
- [ ] Visual verification: changing primary to "Bow" disables "Bow" in secondary dropdown; if secondary was "Bow", it resets to "None"

### Phase 3: Fix slot counter (~10% of effort)

**File:** `src/render/LoadoutScreen.ts`

**Tasks:**
- [ ] Change L128 from:
  ```typescript
  const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0);
  ```
  to:
  ```typescript
  const weapons = secondaryTypeSelect.value ? 1 : 0;
  ```
- [ ] Visual verification: default loadout (12 paddlefish, 4 corrupted, 8 egniol doses, no secondary) shows "Slots: 18/28" not "Slots: 19/28"
- [ ] With secondary weapon selected, shows "Slots: 19/28"

### Phase 4: Add tests (~20% of effort)

**File:** `src/__tests__/inventory.test.ts`

**Tasks:**
- [ ] Add test: "weapon swap does not mutate loadout.config":
  ```typescript
  it('weapon swap does not mutate loadout.config', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 3,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;
    const originalType = sim.player.loadout.config.weaponType;
    const originalTier = sim.player.loadout.config.weaponTier;

    // Swap to bow
    const bowIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    sim.useInventoryItem(bowIdx);
    sim.processTick();

    // Config should be unchanged
    expect(sim.player.loadout.config.weaponType).toBe(originalType);
    expect(sim.player.loadout.config.weaponTier).toBe(originalTier);
  });
  ```

- [ ] Add test: "double weapon swap restores original weapon to inventory":
  ```typescript
  it('double weapon swap restores original weapon to inventory', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 3,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;

    // First swap: staff → bow
    const bowIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    sim.useInventoryItem(bowIdx);
    sim.processTick();
    expect(sim.player.loadout.weapon.type).toBe('bow');
    expect(sim.player.inventory.slots[bowIdx]!.id).toContain('staff');

    // Second swap: bow → staff
    sim.useInventoryItem(bowIdx);
    sim.processTick();
    expect(sim.player.loadout.weapon.type).toBe('staff');
    expect(sim.player.inventory.slots[bowIdx]!.id).toContain('bow');
  });
  ```

- [ ] Add test: "Player.reset() restores original inventory after weapon swap":
  ```typescript
  it('Player.reset() restores original inventory after weapon swap', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 3,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;

    // Swap weapon
    const bowIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    sim.useInventoryItem(bowIdx);
    sim.processTick();

    // Reset player
    sim.player.reset({ x: 0, y: 0 });

    // Inventory should have bow in slot 0 (the original secondary)
    expect(sim.player.inventory.slots[0]!.id).toBe('bow_3');
    // Equipped weapon should be restored to staff (from config)
    expect(sim.player.loadout.config.weaponType).toBe('staff');
  });
  ```

- [ ] `npm test` — all tests pass
- [ ] `cd ../cg-sim-player && npm test` — all tests pass

### Phase 5: Final validation (~15% of effort)

- [ ] `npm run build` — no errors
- [ ] `npm test` — all tests pass (existing + new)
- [ ] `cd ../cg-sim-player && npm test` — all tests pass (never modify cg-sim-player)
- [ ] Visual verification: slot counter is correct for all loadout configurations
- [ ] Visual verification: cannot select same weapon type as both primary and secondary
- [ ] Visual verification: weapon swap mid-fight works correctly (equip → inventory slot updates)

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/engine/GameSimulation.ts` | Modify L601-617 | Remove config mutation; read old weapon from `loadout.weapon` instead of `loadout.config` |
| `src/render/LoadoutScreen.ts` | Modify L127-128 | Fix slot counter: `0 +` instead of `1 +` |
| `src/render/LoadoutScreen.ts` | Add ~15 lines | `syncSecondaryOptions()` to disable duplicate weapon selection |
| `src/equipment/items.ts` | Possibly modify | Ensure `Weapon` type has `type` and `tier` fields (verify before implementation) |
| `src/__tests__/inventory.test.ts` | Add 3 tests | Config immutability, double swap correctness, reset after swap |

## Definition of Done

- [ ] Weapon swap does not mutate `loadout.config` — verified by new test
- [ ] Double weapon swap correctly round-trips (staff→bow→staff) — verified by new test
- [ ] `Player.reset()` restores correct inventory after weapon swap — verified by new test
- [ ] Cannot select same weapon type as both primary and secondary in LoadoutScreen
- [ ] Slot counter shows correct inventory usage (no off-by-1)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all existing + 3 new tests)
- [ ] `cd ../cg-sim-player && npm test` passes all tests
- [ ] No regressions in weapon swap gameplay

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `Weapon` type lacks `type`/`tier` fields — reading old weapon from `loadout.weapon` instead of config requires these fields | Medium | Medium | Verify in Phase 1; if missing, extract from weapon key or add fields to `Weapon` interface |
| Existing tests assert on `loadout.config.weaponType` changing after swap | Low | Low | The existing "weapon switch changes equipped weapon" test checks `loadout.weapon.type`, not `config.weaponType`; should pass unchanged |
| `syncSecondaryOptions()` breaks if DOM structure changes | Low | Low | Scoped to `build()` where DOM is fully controlled; no external dependencies |
| `Player.reset()` also needs to restore `loadout.weapon` to the original | Medium | Medium | `reset()` calls `buildFromLoadout(this.loadout.config)` which rebuilds inventory but doesn't reset `loadout.weapon`. May need to add `this.loadout.weapon = WEAPONS[this.loadout.config.weaponType][this.loadout.config.weaponTier]` inside `reset()` — verify and address in Phase 1 |

## Security Considerations

No security impact. Changes are to weapon state management (removing a mutation), a UI dropdown guard, and a slot counter arithmetic fix. No user input reaches the engine without existing validation.

## Dependencies

- No new dependencies
- cg-sim-player: validation only, never modified

## Open Questions

1. **Does `Weapon` have `type` and `tier` fields?** The current code reads these from `loadout.config`. After removing config mutation, we need to read them from `loadout.weapon`. If `Weapon` doesn't expose `type`/`tier`, we either add them or use a different approach (e.g., store `currentWeaponType`/`currentWeaponTier` on `Loadout` separately from config).

2. **Should `Player.reset()` also restore `loadout.weapon`?** Currently `reset()` rebuilds inventory from config but doesn't reset the equipped weapon. After a swap, `loadout.weapon` would still be the swapped weapon. This should probably be addressed: either `reset()` also calls `loadout.switchWeapon(config.weaponType, config.weaponTier)`, or `Loadout` gets its own `reset()` method.

3. **Should `LoadoutConfig` be frozen (`Object.freeze`) after construction?** This would make the immutability guarantee explicit and catch any future accidental mutations at runtime. Low priority but worth considering.

4. **Halberd as third weapon type:** The duplicate guard needs to handle the case where only 2 of 3 weapon types exist in dropdowns. Current implementation (hide/disable matching option) handles this naturally since "None" is always available.
