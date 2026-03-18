# Sprint 014 Intent: Fix Weapon State Management

## Seed

Fix weapon state management — two issues: (1) Weapon swap mutates loadout.config, which could cause bugs if Player.reset() is ever called. (2) Nothing prevents selecting the same weapon as both primary and secondary. Additionally, the slot counter in LoadoutScreen overcounts by 1 since Sprint 013 removed the primary weapon from inventory.

## Context

### Issue 1: Config mutation during weapon swap
`GameSimulation.ts` L606-607 mutates `loadout.config.weaponType` and `loadout.config.weaponTier` when the player swaps weapons. `Player.reset()` L49 calls `this.inventory.buildFromLoadout(this.loadout.config)`, which would rebuild inventory with the wrong primary weapon.

**However:** `Player.reset()` is never called in production. The restart button (`main.ts` L129) calls `returnToLoadout()` which goes back to the loadout screen. A fresh `LoadoutConfig` is built from the UI on each `startFight()`. The config mutation is dead code corruption — not a live bug, but a correctness hazard.

### Issue 2: Duplicate weapon selection
`LoadoutScreen.ts` L194-196 allows setting `secondaryWeaponType` to the same value as `weaponType`. This creates a confusing situation where the inventory shows a duplicate of the equipped weapon.

### Issue 3: Slot counter off-by-1 (discovered)
`LoadoutScreen.ts` L128: `const weapons = 1 + (secondaryTypeSelect.value ? 1 : 0)` counts the primary weapon as an inventory slot. Sprint 013 removed the primary from inventory, so this overcounts by 1. This IS a live bug visible to users.

## Relevant Codebase Areas

| File | Role | Lines |
|------|------|-------|
| `src/engine/GameSimulation.ts` | Weapon swap mutates loadout.config | L601-617 |
| `src/equipment/Loadout.ts` | Loadout class — config, weapon, switchWeapon | L1-36 |
| `src/entities/Player.ts` | Player.reset() rebuilds inventory from config | L39-49 |
| `src/render/LoadoutScreen.ts` | Setup UI — secondary weapon select, slot counter | L127-136, L194-196 |
| `src/main.ts` | Restart flow — returnToLoadout, startFight | L30-42, L119-126 |

## Constraints

- Must keep all 185 cg-sim tests passing
- Must keep all cg-sim-player tests passing
- Never modify cg-sim-player
- The fix should make config immutable after fight start (or at least restore-safe)

## Success Criteria

1. Slot counter correctly reflects actual inventory usage (off by 0, not 1)
2. Cannot select the same weapon type as both primary and secondary
3. Weapon swap does not corrupt loadout.config (or config is restored on reset)
4. Player.reset() produces correct inventory if ever called

## Verification Strategy

- `npm run build` + `npm test` (185 tests)
- `cd ../cg-sim-player && npm test` (all tests)
- Visual verification: slot counter shows correct number
- Visual verification: cannot pick same weapon type twice

## Uncertainty Assessment

- **Correctness: Low** — clear bugs with obvious fixes
- **Scope: Low** — 3 bounded issues in 3 files
- **Architecture: Low** — extends existing patterns
