# Sprint 014: Fix Weapon State Management

## Overview

Three weapon-related issues of varying severity, all scoped to the loadout/equip pipeline:

1. **Slot counter off-by-1 (live bug)**: `LoadoutScreen.ts` L128 counts the primary weapon as an inventory slot (`1 + ...`). Sprint 013 moved the primary out of inventory and into `Loadout.weapon`, so the counter overcounts by 1. Users see "Slots: 3/28" when the real usage is 2.
2. **Config mutation during weapon swap (dead code corruption)**: `GameSimulation.ts` L606-607 mutates `loadout.config.weaponType` and `loadout.config.weaponTier` when the player swaps weapons mid-fight. `Player.reset()` L49 rebuilds inventory from `this.loadout.config`, so if `reset()` were ever called, the rebuilt inventory would use the swapped weapon as the primary instead of the original. Currently `reset()` is never called in production (restart goes through `returnToLoadout()` which builds a fresh config from the UI), so this is not a live bug -- but it is a correctness hazard that will bite when `reset()` is eventually used.
3. **Duplicate weapon selection (UX bug)**: The secondary weapon dropdown in `LoadoutScreen.ts` L63-68 offers all three weapon types regardless of which primary is selected. A user can select "bow" as both primary and secondary, resulting in a duplicate weapon in inventory that provides no tactical value.

## Use Cases

1. **Slot counter accuracy**: User selects bow primary + staff secondary + 5 paddlefish. Counter reads "Slots: 6/28" (1 secondary weapon + 5 paddlefish = 6). Previously it would read 7.
2. **Slot counter, single weapon**: User selects bow primary, no secondary, 10 paddlefish. Counter reads "Slots: 10/28" (0 weapons + 10 paddlefish). Previously it would read 11.
3. **Config immutability through weapon swap**: Player starts with bow primary and staff secondary. Mid-fight, player equips staff from inventory. `loadout.config.weaponType` still reads `"bow"` (unchanged). If `Player.reset()` is called, inventory rebuilds correctly with bow as primary and staff as secondary.
4. **Duplicate weapon prevention**: User selects "staff" as primary. The secondary weapon dropdown shows only "None", "Bow", and "Halberd" -- "Staff" is filtered out. If the user then changes the primary to "bow", the secondary dropdown updates to show "None", "Staff", and "Halberd".
5. **Edge case -- primary changes to match secondary**: User selects bow primary + staff secondary. User then changes primary to "staff". The secondary selection resets to "None" because the previous secondary now matches the new primary.

## Architecture

### Slot counter fix

Pure arithmetic change. Line 128 currently reads:

```
const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0);
```

The `1 +` represents the primary weapon. Since Sprint 013, the primary is no longer an inventory item. The fix is:

```
const weapons = secondaryTypeSelect.value ? 1 : 0;
```

This is the simplest and most visible fix in the sprint.

### Config mutation fix

Two approaches were considered:

- **Option A: Store a separate `initialConfig` on Loadout.** The constructor copies the incoming config into `this.initialConfig` (deep enough to capture weapon fields). `Player.reset()` would call `buildFromLoadout(this.loadout.initialConfig)`. This adds a new field and requires updating `reset()`.
- **Option B: Stop mutating config entirely.** Remove L606-607 from `GameSimulation.ts`. The config is only read during `buildFromLoadout()` to populate the initial inventory. After that, the config's weapon fields are never read again -- `loadout.weapon` (mutated by `switchWeapon()`) is the source of truth for the equipped weapon during gameplay. Removing the mutation means `config` stays pristine without any new fields.

**Recommendation: Option B.** The two mutation lines are unnecessary today. `loadout.config` is not read after inventory construction, and `loadout.weapon` is the runtime authority. Removing the mutation is a 2-line deletion that makes `config` reliably represent the original loadout. If `Player.reset()` is ever called, `buildFromLoadout(this.loadout.config)` will correctly rebuild the original inventory.

There is no need to touch `Player.reset()` itself. The method is correct -- it rebuilds from `this.loadout.config`, which, after removing the mutation, will always hold the original values. No new `initialConfig` field is needed.

### Duplicate weapon guard

Two approaches:

- **Option A: Filter the secondary dropdown** to exclude the currently selected primary. When the primary changes, rebuild the secondary dropdown options dynamically. This gives the cleanest UX -- impossible states are unrepresentable.
- **Option B: Skip adding secondary in `buildFromLoadout`** if it matches the primary. This is a runtime guard but leaves the UI in a confusing state where the user thinks they selected a secondary but it silently disappears.

**Recommendation: Option A (UI filtering).** The loadout screen already has event listeners that call `updateSlotCount()` on changes. We add a similar `updateSecondaryOptions()` function that rebuilds the secondary dropdown whenever the primary weapon type changes. If the current secondary matches the new primary, the secondary resets to "None".

Additionally, as a defensive measure, add a guard in `LoadoutScreen.onStart` (around L194) so that even if the UI filtering is bypassed somehow, a matching secondary is not included in the config.

## Implementation

### Phase 1: Fix slot counter off-by-1 (~10% of effort)

**File:** `src/render/LoadoutScreen.ts`

- [ ] L128: Change `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)` to `const weapons = secondaryTypeSelect.value ? 1 : 0`

### Phase 2: Fix config mutation (~15% of effort)

**File:** `src/engine/GameSimulation.ts`

- [ ] Remove L606: `player.loadout.config.weaponType = action.weaponType;`
- [ ] Remove L607: `player.loadout.config.weaponTier = action.weaponTier;`

**File:** `src/__tests__/` (relevant weapon swap test file)

- [ ] Add test: after a weapon swap, `player.loadout.config.weaponType` still equals the original primary weapon type
- [ ] Add test: after a weapon swap, `player.loadout.config.weaponTier` still equals the original primary weapon tier

### Phase 3: Duplicate weapon prevention (~50% of effort)

**File:** `src/render/LoadoutScreen.ts`

- [ ] Add an `updateSecondaryOptions()` function that rebuilds the `#secondary-weapon-type` `<option>` elements, excluding the value currently selected in `#weapon-type`. Always include the "None" option.
- [ ] Call `updateSecondaryOptions()` on the primary weapon type `<select>` `change` event
- [ ] Call `updateSecondaryOptions()` once during initial setup so the dropdown is correct on page load
- [ ] If the previously selected secondary matches the new primary, reset secondary to "None" and hide the secondary tier row
- [ ] Call `updateSlotCount()` after resetting the secondary to keep the counter in sync
- [ ] Add a defensive guard at L194: skip setting `config.secondaryWeaponType` and `config.secondaryWeaponTier` if `secondaryTypeSelect.value === weaponTypeSelect.value`

### Phase 4: Testing and verification (~25% of effort)

- [ ] Run `npm run build` -- no type errors
- [ ] Run `npm test` -- all 185 tests pass
- [ ] Run `cd ../cg-sim-player && npm test` -- all tests pass
- [ ] Visual verification: slot counter shows correct count for 0, 1 secondary weapon configurations
- [ ] Visual verification: secondary dropdown does not offer the currently selected primary weapon type
- [ ] Visual verification: changing primary while secondary matches resets secondary to "None"

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/render/LoadoutScreen.ts` | Modify L128 | Fix slot counter: remove `1 +` to stop counting primary as inventory |
| `src/render/LoadoutScreen.ts` | Add function | Add `updateSecondaryOptions()` to filter secondary dropdown by primary |
| `src/render/LoadoutScreen.ts` | Modify ~L194 | Add defensive guard against duplicate weapon in config |
| `src/engine/GameSimulation.ts` | Delete L606-607 | Remove config mutation during weapon swap |
| Test files | Add tests | Verify config immutability after weapon swap |

## Definition of Done

- [ ] Slot counter reads 0 when no secondary is selected (not 1)
- [ ] Slot counter reads 1 when a secondary is selected (not 2)
- [ ] `loadout.config.weaponType` is unchanged after a mid-fight weapon swap
- [ ] `Player.reset()` rebuilds the correct original inventory (if called)
- [ ] Secondary weapon dropdown does not include the currently selected primary weapon type
- [ ] Changing the primary weapon to match the current secondary resets secondary to "None"
- [ ] All 185 cg-sim tests pass (`npm test`)
- [ ] All cg-sim-player tests pass (`cd ../cg-sim-player && npm test`)
- [ ] `npm run build` succeeds with no errors

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Removing config mutation breaks code that reads `loadout.config` mid-fight | Low | High | Grep the codebase for all reads of `loadout.config.weaponType` and `loadout.config.weaponTier` outside of `buildFromLoadout`. If any exist, they need to read from `loadout.weapon` instead. |
| Dynamic dropdown rebuild loses the user's secondary tier selection | Medium | Low | When rebuilding secondary type options, preserve the secondary tier selection. Only reset the tier if the secondary type itself is reset to "None". |
| `updateSecondaryOptions()` fires before other UI elements are initialized | Low | Low | Call it at the end of the setup block, after all elements are queried from the DOM. |
| Existing tests assert on `loadout.config.weaponType` after a swap | Low | Medium | If any tests explicitly check that config is mutated, update them to assert immutability instead. |

## Security Considerations

No security impact. All changes are UI cosmetics (slot counter, dropdown filtering) and removal of an unnecessary mutation. No new inputs, network calls, or dependencies are introduced.

## Dependencies

- No new npm packages
- No changes to cg-sim-player (constraint: never modify cg-sim-player)
- No new files created; all changes are modifications to existing files

## Open Questions

1. **Should the secondary dropdown filter also apply to weapon tier?** Currently the intent document only mentions filtering by weapon type. Two weapons of the same type but different tiers (e.g., T1 bow and T3 bow) would be mechanically pointless but not technically a "duplicate." For now, filtering by type alone seems sufficient -- same-type-different-tier is an edge case that adds complexity without clear user value.

2. **Should we add a unit test for the slot counter?** The slot counter is pure DOM logic inside `LoadoutScreen`, which is hard to unit test without a DOM environment. The visual verification step covers this. If a DOM testing setup (jsdom, happy-dom) is already in place, a test would be worthwhile.

3. **Is there any code path that reads `loadout.config.weaponType` mid-fight besides `Player.reset()`?** The intent document says no, but a codebase grep should confirm before removing the mutation. If something does read it (e.g., a HUD display, a logging function), it would need to be updated to read from `loadout.weapon.type` instead.

4. **Should the "None" option in the secondary dropdown be visually distinct (e.g., italicized or grayed)?** Minor UX polish that could be addressed later but worth noting.
