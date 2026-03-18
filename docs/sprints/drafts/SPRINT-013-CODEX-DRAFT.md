# Sprint 013: Weapon State Semantics, Arena Visibility, and Countdown Camera Framing

## Overview

Sprint 013 should fix three user-facing issues, but the weapon bug needs to be treated as a state-model correction rather than a cosmetic inventory tweak.

Today, `src/entities/Inventory.ts` builds the starting inventory with the primary weapon in slot 0 even though `src/equipment/Loadout.ts` already equips that weapon through `loadout.weapon`. The result is not just "3 visible weapons." It also creates a deeper consistency problem:

- the inventory starts with a redundant copy of the equipped weapon
- `src/engine/GameSimulation.ts` swaps against `loadout.config.weaponType` instead of the current equipped weapon
- weapon switching mutates `loadout.config`, which is also used by `src/entities/Player.ts` during reset
- `src/render/LoadoutScreen.ts` counts the equipped primary weapon as an occupied inventory slot even though `docs/INTENT.md` says only weapons in inventory consume slots

That combination means weapon switching can duplicate items, reset/restart can rebuild the wrong loadout, and the setup screen can misstate usable inventory space.

The render issues are simpler but still need deliberate fixes. `src/render/Renderer3D.ts` currently uses nearly identical dark reds for the WebGL clear color, floor plane, and grid lines, so the arena is readable only through hazard overlays and entity silhouettes. Separately, `src/render/CameraController.ts` only exposes a lerped follow target; during countdown `Renderer3D.draw()` asks the camera to center on `(0, 0, 0)`, but the controller eases there over multiple frames instead of snapping immediately.

This sprint should ship:

- correct loadout semantics: one equipped primary weapon, one alternate weapon in inventory at most
- correct swap semantics: clicking an inventory weapon trades with the currently equipped weapon and never duplicates items
- correct reset semantics: restart returns to the original configured primary and secondary weapons
- correct slot counting on the loadout screen
- a brighter but still Corrupted Gauntlet-themed 3D floor palette
- exact countdown centering with smooth follow resuming once the fight starts

This sprint should not introduce a new equipment model, drag-and-drop UI, or broader camera behavior changes outside countdown framing.

## Use Cases

1. Player starts with a single weapon loadout. The selected weapon appears only in the equipment panel; inventory starts with potions and food, not a duplicate weapon.
2. Player starts with two weapons configured. The selected primary weapon is equipped, and exactly one alternate weapon appears in the first inventory slot.
3. Player clicks the alternate weapon during countdown or combat. The clicked slot changes to the previously equipped weapon, the equipment panel updates, and the total number of weapon items visible remains exactly two.
4. Player switches weapons multiple times. The simulator never creates duplicate staffs/bows/halberds and never loses track of which weapon belongs in inventory.
5. Player restarts after switching weapons. The fight resets to the original setup selection rather than the last runtime-equipped weapon.
6. Loadout screen slot counter reflects actual inventory occupancy: only the unequipped weapon, potions, and fish count against 28 slots.
7. Arena floor is readable at a glance in idle state, and warning/hazard overlays remain more prominent than the base floor.
8. Countdown starts with the boss arena centered immediately even if the player moved near the edge before the prior frame.
9. When countdown ends, the camera resumes smooth follow toward the player instead of popping abruptly to a new angle or target.

## Architecture

### 1. Separate setup-time loadout data from runtime weapon state

`LoadoutConfig` is currently doing two jobs:

- describing the player's initial setup choice
- acting as mutable runtime state for the currently equipped weapon

That is the root cause of the weapon duplication/reset drift. Sprint 013 should make the setup config effectively immutable after fight start and move runtime weapon state responsibility back onto `Loadout`.

Recommended shape:

```ts
class Loadout {
  readonly initialConfig: Readonly<LoadoutConfig>;
  armor: ArmorSet;
  weapon: Weapon;

  constructor(config: LoadoutConfig) { ...clone config... }
  resetToInitial(): void { ...restore initial primary weapon... }
  getSecondaryWeaponSpec(): { type: WeaponType; tier: 1 | 2 | 3 } | null { ... }
}
```

Key rule: `initialConfig.weaponType` and `initialConfig.weaponTier` describe the starting equipped weapon only. They are not updated when the player swaps mid-fight.

### 2. Inventory contract: only unequipped weapons belong in inventory

`Inventory.buildFromLoadout()` should stop treating the primary weapon as an inventory item. Its contract should become:

- if no secondary weapon is configured, inventory starts with zero weapons
- if a secondary weapon is configured, inventory starts with exactly one weapon item
- ordering remains "weapons first, then potions, then food," but in practice "weapons first" means secondary weapon only

This matches `docs/INTENT.md`:

- weapons occupy slots when in inventory
- loadout validation counts weapons that are not equipped

### 3. Swap contract: trade against the equipped weapon, not against config

`GameSimulation.processInventoryAction()` should stop reading and mutating `player.loadout.config.weaponType`. The correct swap is:

1. read the currently equipped `player.loadout.weapon`
2. switch the loadout to the clicked inventory weapon
3. replace the clicked inventory slot with the previous equipped weapon

That preserves a constant weapon count and avoids runtime corruption of the starting config.

### 4. Reset contract: rebuild from the original setup, not mutated runtime state

`Player.reset()` currently rebuilds inventory from `this.loadout.config`, which is unsafe because weapon-switch logic mutates that config today. After the architecture change:

- `Loadout.resetToInitial()` restores the original primary weapon
- `Player.reset()` rebuilds inventory from `loadout.initialConfig`

This makes restart deterministic and restores the exact setup the player selected on the loadout screen.

### 5. Arena floor palette should be a named render palette, not scattered literals

`Renderer3D` currently hardcodes:

- clear color: `0x1a0a0a`
- floor plane: `0x1a0a0a`
- grid lines: `0x3a1a1a`

Those values are too close together. Sprint 013 should extract a small arena palette at the top of `Renderer3D.ts`, for example:

- background / void color
- floor base color
- grid line color

The exact numbers can be tuned visually, but the palette needs:

- stronger luminance separation between floor and grid
- enough red/brown character to keep the Corrupted theme
- enough distance from warning/hazard overlay colors so active tiles still read as special states

### 6. Camera controller needs an explicit snap path

`CameraController.setTarget()` currently updates only `desiredTarget`, and `update()` always lerps:

```ts
this.target.lerp(this.desiredTarget, TARGET_LERP_ALPHA);
```

That means countdown framing can never be exact.

Sprint 013 should add one of these APIs:

- `setTarget(x, y, z, { immediate?: boolean })`
- or `snapToTarget(x, y, z)` alongside the current smooth `setTarget(...)`

Implementation rule:

- smooth follow remains the default runtime behavior
- countdown uses the immediate/snap path
- the snap API updates both `target` and `desiredTarget` before `updateCameraPosition()`

That keeps the countdown centered without changing the follow feel during active play.

## Implementation

### Phase 1: Normalize weapon-state ownership

**Files:**

- `src/equipment/Loadout.ts`
- `src/entities/Player.ts`

**Tasks:**

- [ ] Update `Loadout` so it stores an immutable copy of the starting `LoadoutConfig` as `initialConfig` (or equivalent readonly field).
- [ ] Add a `resetToInitial()` method on `Loadout` that restores `this.weapon` from the original primary weapon selection.
- [ ] Keep `armor` derived from the configured armor tier as it is today; no armor-state redesign is needed for this sprint.
- [ ] Do not continue using `config.weaponType` / `config.weaponTier` as runtime state after fight start.
- [ ] Update `Player.reset()` to:
  - call `loadout.resetToInitial()`
  - rebuild inventory from `loadout.initialConfig`
  - preserve the rest of the current reset behavior
- [ ] Add or update tests proving that a player who swapped weapons mid-fight resets back to the original configured primary weapon.

### Phase 2: Correct starting inventory population

**Files:**

- `src/entities/Inventory.ts`
- `src/__tests__/inventory.test.ts`

**Tasks:**

- [ ] Change `Inventory.buildFromLoadout()` so it no longer inserts the primary weapon into slot 0.
- [ ] If `secondaryWeaponType` and `secondaryWeaponTier` are set, insert exactly that one alternate weapon at the next free slot before potions.
- [ ] Preserve existing potion and food ordering logic after the weapon change.
- [ ] Update inventory tests to reflect the corrected item counts:
  - default one-weapon loadout should lose one starting inventory item relative to current behavior
  - two-weapon loadout should contain exactly one weapon item in inventory, not two
- [ ] Replace the current "returns equip action for weapon" test with a two-weapon case, because a single-weapon loadout should have no starting weapon item to click.
- [ ] Add a regression test asserting that a one-weapon loadout starts with slot 0 occupied by a potion or food item, not a weapon.

### Phase 3: Fix weapon swap semantics and runtime duplication

**Files:**

- `src/engine/GameSimulation.ts`
- `src/__tests__/inventory.test.ts`
- `src/__tests__/integration.test.ts`

**Tasks:**

- [ ] Rewrite the `equip` branch in `GameSimulation.processInventoryAction()` to swap against `player.loadout.weapon`, not `player.loadout.config`.
- [ ] Remove runtime mutation of `weaponType` / `weaponTier` on the config object.
- [ ] When a weapon is equipped from inventory, replace the clicked slot with the previously equipped weapon's id, name, and sprite.
- [ ] Preserve "equip has no action cost" behavior unless the product decision changes separately.
- [ ] Add regression tests for:
  - switching to the alternate weapon leaves exactly one weapon in inventory
  - switching twice returns the original alternate weapon to inventory without duplication
  - restarting after a weapon switch restores the original primary/secondary arrangement
- [ ] Update the integration test that currently assumes the secondary weapon is at index `1`; after this sprint it should be at index `0` when a secondary is present.
- [ ] Verify that weapon switching during countdown still works, since countdown explicitly allows equipping.

### Phase 4: Align loadout-screen slot counting with actual inventory rules

**Files:**

- `src/render/LoadoutScreen.ts`
- `docs/INTENT.md`

**Tasks:**

- [ ] Change the slot counter in `LoadoutScreen.updateSlotCount()` so it counts only unequipped weapons:
  - `0` weapon slots when no secondary weapon is selected
  - `1` weapon slot when a secondary weapon is selected
- [ ] Keep the rest of the formula unchanged: `secondary weapon + ceil(egniolDoses / 4) + paddlefish + corrupted paddlefish`.
- [ ] Update `docs/INTENT.md` inventory/start-menu wording so it explicitly says the primary selected weapon starts equipped and only additional weapons consume inventory slots.
- [ ] Do not expand this sprint into hard loadout blocking unless the team decides to move from "warning" to "validation error." The visible counter just needs to be correct.

### Phase 5: Improve base arena readability in the 3D renderer

**Files:**

- `src/render/Renderer3D.ts`

**Tasks:**

- [ ] Extract named constants for arena background, floor, and grid colors near the top of `Renderer3D.ts`.
- [ ] Update `this.webglRenderer.setClearColor(...)` to use a darker backdrop than the walkable floor so the arena footprint reads clearly.
- [ ] Update `createFloor()` to use a visibly brighter floor base color than the current near-black.
- [ ] Update grid lines to a lighter, higher-contrast color that is still within the red/brown corrupted palette.
- [ ] Visually confirm that warning (`crimson`) and hazard (`orange-red`) overlays in `updateFloorTiles()` remain more attention-grabbing than the new base floor.
- [ ] Keep the fix scoped to the active 3D renderer; the legacy 2D renderer is not on the runtime path in `src/main.ts`.

### Phase 6: Add a snap-capable camera target path for countdown

**Files:**

- `src/render/CameraController.ts`
- `src/render/Renderer3D.ts`

**Tasks:**

- [ ] Extend `CameraController` with an explicit immediate-target API:
  - either overload `setTarget(...)`
  - or add a separate `snapToTarget(...)` helper
- [ ] Implement the immediate path by setting both `target` and `desiredTarget` before camera position recalculation.
- [ ] Keep `TARGET_LERP_ALPHA` behavior unchanged for normal follow mode.
- [ ] Update `Renderer3D.draw()` so countdown uses the snap path to center on `(0, 0, 0)`.
- [ ] Keep running-state follow behavior smooth by continuing to use the normal lerped path toward the player position.
- [ ] Verify the countdown-to-running transition feels stable:
  - countdown frames should be exactly centered
  - first running frames should resume smooth follow rather than re-snapping every frame

### Phase 7: Verification and polish

**Files:**

- `src/__tests__/inventory.test.ts`
- `src/__tests__/integration.test.ts`
- `docs/sprints/drafts/SPRINT-013-CODEX-DRAFT.md`

**Tasks:**

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Manual verification in the browser:
  - [ ] single-weapon loadout shows no weapon in inventory
  - [ ] two-weapon loadout shows exactly one weapon in inventory
  - [ ] repeated weapon swaps never create duplicates
  - [ ] restart returns to original loadout
  - [ ] floor grid is visible without active hazards
  - [ ] countdown camera is centered immediately
  - [ ] post-countdown camera follow still feels smooth

## Files Summary

| File | Change | Why |
|---|---|---|
| `src/equipment/Loadout.ts` | Required | Split immutable setup data from mutable equipped weapon state and add reset support |
| `src/entities/Player.ts` | Required | Reset must restore from original loadout, not from mutated runtime config |
| `src/entities/Inventory.ts` | Required | Starting inventory should only contain unequipped weapons |
| `src/engine/GameSimulation.ts` | Required | Weapon swap logic currently swaps against config and mutates the wrong source of truth |
| `src/render/LoadoutScreen.ts` | Required | Slot counter currently charges inventory space for the equipped primary weapon |
| `src/render/Renderer3D.ts` | Required | Contains both the floor palette and countdown camera-target call sites |
| `src/render/CameraController.ts` | Required | Needs an immediate target/snap API in addition to lerped follow |
| `src/__tests__/inventory.test.ts` | Required | Current counts and equip tests are written against the buggy weapon model |
| `src/__tests__/integration.test.ts` | Required | Existing two-weapon test assumes the alternate weapon lives in slot 1 |
| `docs/INTENT.md` | Recommended | Inventory slot semantics should explicitly match the shipped behavior |

## Definition of Done

1. A one-weapon loadout starts with zero weapons in inventory.
2. A two-weapon loadout starts with exactly one weapon in inventory and one equipped weapon in the equipment panel.
3. Clicking the alternate weapon swaps it with the equipped weapon and never increases the total number of visible weapons.
4. Repeated weapon swaps do not duplicate or lose staffs, bows, or halberds.
5. Restart/reset restores the original configured primary and secondary weapons.
6. Loadout screen slot counting matches actual inventory occupancy rules for equipped vs unequipped weapons.
7. The 3D floor and grid are clearly visible at idle while still reading as Corrupted Gauntlet art direction.
8. Hazard and warning tile overlays remain visually stronger than the base floor after palette changes.
9. Countdown camera framing is centered immediately from the first rendered countdown frame.
10. Camera follow after countdown remains smooth and does not feel like a hard snap to the player.
11. `npm run build` passes.
12. `npm test` passes.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Only removing the primary weapon from `Inventory.buildFromLoadout()` without fixing swap/reset logic | UI looks better initially, but weapon duplication and reset drift remain | Treat loadout immutability, swap logic, and reset logic as one change set |
| Leaving `loadout.config` mutable | Hidden state corruption continues, especially after multiple swaps and restarts | Introduce `initialConfig` and stop mutating setup-time weapon fields at runtime |
| Updating the slot counter but not docs | Future contributors reintroduce the same bug because the rules stay ambiguous | Update `docs/INTENT.md` in the same sprint |
| Brightening the floor too aggressively | Hazard overlays lose contrast or the scene no longer feels corrupted/dark | Tune clear color, floor color, and grid color together and verify against warning/hazard overlays |
| Adding snap behavior globally in `CameraController` | Normal follow feels abrupt or jittery | Keep snap as an explicit opt-in path used only for countdown centering |
| Countdown snap implemented only by increasing lerp alpha | Camera still drifts for some frames and the bug remains | Add a true immediate target path that sets both current and desired target |

## Security Considerations

This sprint is local simulation and rendering work only. It does not add network access, persistence, authentication, or new untrusted-input parsing surfaces.

The main correctness concern is state integrity: the simulator should not allow internally inconsistent equipment/inventory state after weapon swaps. Fixing the mutable-config design reduces that risk.

## Dependencies

- `docs/INTENT.md` remains the product source of truth for inventory slot semantics and loadout behavior.
- Existing inventory, equipment-panel, and countdown behavior from Sprint 002 and later must continue to work after the state-model correction.
- The sprint depends on the active runtime using `Renderer3D` from `src/main.ts`; the legacy `Renderer` can remain untouched unless it becomes active again later.
- Verification depends on the current local toolchain: `npm run build` and `npm test`.

## Open Questions

1. Should Sprint 013 stop at correcting the slot counter, or should the loadout screen also block starting a fight when the displayed total exceeds 28?
2. Should the camera snap to arena center on every countdown frame, or only once when entering countdown state? Re-snapping every countdown frame is simple and safe; a state-transition hook is cleaner if more camera modes are coming.
3. Do we want exact floor palette values chosen by visual tuning only, or should they be copied more directly from Corrupted Gauntlet reference art/screenshots?
4. Should `Loadout.initialConfig` be deeply frozen for safety, or is a defensive clone plus team convention enough for this codebase?
