# Sprint 014: Weapon State Integrity and Loadout Validation

## Overview

Sprint 014 should clean up three closely related weapon/loadout issues:

1. `GameSimulation` mutates `loadout.config` during weapon swaps even though that object should describe the starting setup, not live runtime state.
2. `LoadoutScreen` allows the player to choose the same weapon as both primary and secondary.
3. `LoadoutScreen` still counts the equipped primary weapon as an occupied inventory slot, which became wrong after Sprint 013 removed the primary from inventory.

Only the slot counter is a live user-facing bug today. The config mutation is currently a correctness hazard because `main.ts` restarts by returning to the loadout screen and building a fresh `LoadoutConfig`, not by calling `Player.reset()`. That does not make the mutation acceptable. It leaves a broken reset path in the codebase and keeps weapon state split across two concepts with the wrong ownership.

This sprint should ship:

- setup-time loadout config that remains stable after fight start
- runtime weapon switching that swaps against the currently equipped weapon, not the original config
- a loadout screen that cannot produce duplicate primary/secondary weapon pairs
- a slot counter that matches actual starting inventory occupancy
- regression tests for swap semantics, reset behavior, and non-DOM loadout-screen rules

This sprint should not ship:

- a new restart flow in `main.ts`
- a broader equipment-system redesign
- support for more than one alternate weapon
- a DOM testing framework addition just to cover one screen

## Use Cases

1. A player selects only a primary weapon. The slot counter counts potions and food only. No weapon slot is consumed.
2. A player selects a secondary weapon different from the primary. The slot counter adds exactly one weapon slot.
3. A player changes the primary weapon after already selecting a secondary. If the new primary would collide with the selected secondary, the secondary is cleared or blocked so the loadout remains valid.
4. A player swaps weapons during countdown or combat. The inventory slot becomes the previously equipped weapon, and the total weapon count stays constant.
5. A player swaps weapons multiple times. The simulator never duplicates or loses the configured two-weapon set.
6. `Player.reset()` is called after one or more swaps. The player returns to the originally selected primary weapon, and inventory is rebuilt with the originally selected secondary weapon.
7. A player restarts through the current UI flow. `main.ts` still returns to the loadout screen and starts the next fight from fresh UI state without any regression.

## Architecture

### 1. Treat `LoadoutConfig` as setup-only data

`LoadoutConfig` should describe the initial loadout chosen on the start screen. It should not also be the runtime source of truth for the currently equipped weapon.

Recommended shape:

```ts
class Loadout {
  readonly config: Readonly<LoadoutConfig>;
  equippedWeaponType: WeaponType;
  equippedWeaponTier: 1 | 2 | 3;
  weapon: Weapon;

  constructor(config: LoadoutConfig) { ...clone config... }
  switchWeapon(type: WeaponType, tier: 1 | 2 | 3): void { ... }
  resetWeapon(): void { ...restore from config.weaponType / config.weaponTier... }
}
```

Key rule: `config.weaponType` and `config.weaponTier` always mean "the original primary weapon from the loadout screen." Mid-fight swaps update `Loadout` runtime fields only.

### 2. Make swap logic read from `Loadout`, not from `config`

The `equip` branch in `GameSimulation` currently reads the old weapon from `player.loadout.config`, switches the `Loadout.weapon`, then mutates the config to match the newly equipped weapon. That is backwards.

The correct swap contract is:

1. Read the currently equipped weapon type/tier from `Loadout`.
2. Switch the runtime equipped weapon to the clicked inventory weapon.
3. Rewrite the clicked slot with the old equipped weapon.
4. Leave `loadout.config` untouched.

This preserves a constant two-weapon model: one equipped, zero or one alternate in inventory.

### 3. Make `Player.reset()` restore the original loadout

`Player.reset()` should become internally correct even though `main.ts` does not currently call it in production flow.

Reset contract:

- restore the equipped weapon from the original config via `loadout.resetWeapon()`
- rebuild inventory from the original setup config
- preserve the rest of the current stat/position reset behavior

That keeps reset safe for future refactors, tests, or alternate restart flows.

### 4. Keep loadout-screen validation local and testable

`LoadoutScreen` needs two simple policy rules:

- the secondary weapon must differ from the primary weapon
- slot count should include only items that actually start in inventory

Because the repo does not currently have a DOM test environment, the policy should live in pure helper logic that can be tested without rendering the whole screen. That can be done either by:

- exporting tiny helpers from `LoadoutScreen.ts`, or
- introducing a very small adjacent module such as `loadoutRules.ts`

The DOM wiring then becomes thin:

- sync secondary options when the primary changes
- clear or block invalid secondary selection
- compute slot count from the pure helper
- perform one final validation check in the start-button handler before building `LoadoutConfig`

### 5. Leave `main.ts` restart flow alone

`main.ts` already does the correct thing for the current product flow:

- `returnToLoadout()` hides the fight UI
- `LoadoutScreen` builds a fresh `LoadoutConfig`
- `startFight()` creates a new `Loadout` and `GameSimulation`

Sprint 014 should not replace that flow with `Player.reset()`. The goal is to make `Player.reset()` correct, not to make it the active restart path.

## Implementation

### Phase 1: Separate setup config from runtime equipped state

**Files:**

- `src/equipment/Loadout.ts`
- `src/entities/Player.ts`

**Tasks:**

- [ ] Clone the incoming `LoadoutConfig` in `Loadout` so the stored setup data is not an external mutable reference.
- [ ] Change `Loadout.config` to setup-only semantics, ideally `Readonly<LoadoutConfig>`.
- [ ] Add explicit runtime equipped-weapon fields on `Loadout` such as `equippedWeaponType` and `equippedWeaponTier`.
- [ ] Update `Loadout.switchWeapon()` to change runtime equipped state only.
- [ ] Add `Loadout.resetWeapon()` to restore the original primary weapon from `config`.
- [ ] Update `Player.reset()` to call `loadout.resetWeapon()` before rebuilding inventory from `loadout.config`.
- [ ] Add a regression test that swaps weapons, calls `Player.reset()`, and verifies the original primary/secondary arrangement is restored.

### Phase 2: Fix in-fight weapon swap semantics

**Files:**

- `src/engine/GameSimulation.ts`
- `src/__tests__/inventory.test.ts`
- `src/__tests__/integration.test.ts`

**Tasks:**

- [ ] Rewrite the `equip` branch in `GameSimulation` to read the old equipped weapon from `Loadout` runtime state instead of `loadout.config`.
- [ ] Remove mutation of `loadout.config.weaponType` and `loadout.config.weaponTier`.
- [ ] Keep the clicked inventory slot populated with the previously equipped weapon's id, name, category, and sprite.
- [ ] Add a regression test proving a single swap leaves `loadout.config` unchanged while `loadout.weapon` changes.
- [ ] Add a regression test proving repeated swaps do not duplicate or lose weapons.
- [ ] Keep existing "weapon switching during countdown" behavior working.

### Phase 3: Prevent duplicate primary/secondary selection

**Files:**

- `src/render/LoadoutScreen.ts`
- `src/__tests__/loadout-screen.test.ts` or equivalent helper-logic test file

**Tasks:**

- [ ] Add pure helper logic for duplicate-secondary validation and slot counting so it can be tested without a DOM environment.
- [ ] Disable or exclude the current primary weapon from the secondary-weapon choices.
- [ ] If the player changes primary weapon to match the selected secondary, clear the secondary selection and hide the secondary-tier row.
- [ ] Add a final validation guard in the start-button handler so an invalid duplicate pair cannot be written into `LoadoutConfig` even if the DOM gets into a bad state.
- [ ] Add a test for no-secondary slot count.
- [ ] Add a test for one-secondary slot count.
- [ ] Add a test for duplicate primary/secondary normalization or rejection.
- [ ] Add a test for primary-weapon changes invalidating an existing secondary selection.

### Phase 4: Fix the slot counter to match real inventory usage

**Files:**

- `src/render/LoadoutScreen.ts`

**Tasks:**

- [ ] Change the weapon-slot contribution in `updateSlotCount()` from `1 + secondary` to `secondary only`.
- [ ] Keep the existing `ceil(egniolDoses / 4) + paddlefish + corrupted paddlefish` formula unchanged.
- [ ] Make sure the slot counter updates when either primary or secondary weapon fields change, not only when consumable counts change.
- [ ] Manually verify the visible total for a primary-only loadout.
- [ ] Manually verify the visible total for a primary-plus-secondary loadout.
- [ ] Manually verify the visible total for several potion-dose combinations.

### Phase 5: Verification

**Files:**

- `src/__tests__/inventory.test.ts`
- `src/__tests__/integration.test.ts`
- `src/__tests__/loadout-screen.test.ts` or equivalent

**Tasks:**

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `cd ../cg-sim-player && npm test`.
- [ ] Manually verify in the browser that the slot counter is accurate with and without a secondary weapon.
- [ ] Manually verify in the browser that the same weapon cannot be selected twice.
- [ ] Manually verify in the browser that one swap and repeated swaps keep inventory/equipment state consistent.
- [ ] Verify from code or test coverage that the reset path restores the original setup.

## Files Summary

| File | Change | Why |
|---|---|---|
| `src/equipment/Loadout.ts` | Required | Move current equipped-weapon identity onto `Loadout` and keep setup config stable |
| `src/entities/Player.ts` | Required | Reset must restore original equipped weapon before rebuilding inventory |
| `src/engine/GameSimulation.ts` | Required | Equip action currently swaps against and mutates the wrong source of truth |
| `src/render/LoadoutScreen.ts` | Required | Prevent duplicate weapon pairs and fix off-by-one slot counting |
| `src/__tests__/inventory.test.ts` | Required | Add reset/swap regression coverage close to existing inventory behavior tests |
| `src/__tests__/integration.test.ts` | Required | Verify multi-tick weapon-switch behavior still works in the full simulation |
| `src/__tests__/loadout-screen.test.ts` | Recommended | Cover pure loadout-screen rules without introducing DOM test infrastructure |
| `src/main.ts` | No change expected | Current restart flow already rebuilds from fresh UI config; included here to keep scope explicit |

## Definition of Done

- [ ] `Loadout.config` remains the original setup selection after zero, one, or multiple weapon swaps.
- [ ] The currently equipped weapon is tracked through `Loadout` runtime state, not by mutating setup config.
- [ ] `GameSimulation` weapon swaps replace the clicked inventory slot with the previously equipped weapon.
- [ ] Repeated weapon swaps never duplicate or drop configured weapons.
- [ ] `Player.reset()` restores the original primary weapon and rebuilds inventory from the original secondary weapon.
- [ ] The loadout screen cannot produce a config where primary and secondary weapon types are the same.
- [ ] The slot counter shows `0` weapon slots for primary-only setups and `1` weapon slot when a secondary is selected.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] `cd ../cg-sim-player && npm test` passes.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `Loadout` ends up with split runtime state (`weapon` updated but type/tier fields stale, or vice versa) | Incorrect swap or reset behavior | Update `switchWeapon()` to be the single mutation path and test both the spec fields and `weapon` object |
| The team removes config mutation in `GameSimulation` but misses another code path that still reads current weapon from `config` | Hidden correctness bug remains | Search for every read/write of `loadout.config.weaponType` and `weaponTier` and treat them as setup-only after this sprint |
| UI duplicate prevention is implemented only by disabling options, without a final start-time guard | Invalid config could still be produced by stale DOM state or future refactors | Validate again in the start-button handler before writing `secondaryWeaponType` |
| Loadout-screen logic is left entirely inside DOM handlers | Off-by-one and validation regressions are hard to test | Keep the rules in pure helpers and add focused unit tests |
| Because `Player.reset()` is not used in the current product flow, its regression could go unnoticed later | Future restart/refactor work inherits broken state semantics | Add a direct test that exercises reset after swaps |

## Security

No network, persistence, or authentication surface changes are involved.

The relevant security concern here is state integrity. The UI should not be able to construct an impossible loadout, and runtime code should not silently corrupt the original setup object. A final validation check before building `LoadoutConfig`, plus setup/runtime state separation inside `Loadout`, is enough for this sprint.

## Dependencies

- No new runtime dependencies.
- No `cg-sim-player` code changes. It is validation-only.
- Existing inventory and integration tests should be updated rather than replaced.
- If a pure helper test file is added for loadout-screen rules, it should use the existing Vitest Node environment rather than introducing `jsdom`.
- `main.ts` restart flow remains unchanged and is only a verification dependency, not an implementation target.

## Open Questions

1. Should the duplicate-secondary UX silently clear the invalid secondary when the primary changes, or should it also show an inline validation message? Recommendation: clear the invalid selection immediately and keep a start-time guard as backup.
2. Should `Loadout.config` be compile-time readonly only, or also frozen at runtime with `Object.freeze()`? Recommendation: a defensive clone plus `Readonly<LoadoutConfig>` is probably enough for this codebase, but freezing is a reasonable extra guard if the team wants stricter failure behavior.
3. Should the pure loadout-screen rules live as named exports in `LoadoutScreen.ts` or in a tiny adjacent helper module? Recommendation: keep them adjacent to `LoadoutScreen` unless the helper surface grows beyond slot counting and weapon-pair validation.
