# Sprint 013: UI/UX Polish — Weapons, Floor, Camera

## Overview

Three user-reported polish issues that each have small, well-scoped fixes but subtle edge cases worth reasoning through carefully:

1. **3-weapons bug**: `buildFromLoadout()` places the primary weapon in inventory slot 0, but `Loadout.weapon` already holds the same weapon as the "equipped" item. The player sees three weapons total (equipped + slot 0 + slot 1). Fix: stop adding the primary to inventory; only the secondary belongs there.
2. **Floor too dark**: The arena floor (`0x1a0a0a`) and grid lines (`0x3a1a1a`) are nearly indistinguishable. Need brighter, thematic colors with real contrast.
3. **Camera drift during countdown**: `CameraController.update()` lerps toward the desired target at 10% per frame. When the countdown begins with the camera far from center, it drifts slowly instead of snapping. The initial camera position at construction time is also unanchored if the first draw call has the player off-center.

## Use Cases

1. **Weapon selection (bow + staff)**: User selects bow as primary and staff as secondary. Equipment panel shows the bow as equipped; inventory shows only the staff in slot 0. Total visible weapons: 2.
2. **Weapon selection (single weapon, no secondary)**: User selects only bow. Equipment panel shows bow equipped; inventory has zero weapon items.
3. **Weapon swap from initial state**: Player clicks the staff in inventory slot 0. Staff becomes the equipped weapon; the bow (previously equipped) replaces it in slot 0. This is the critical edge case -- see Architecture below.
4. **Floor visibility**: Player can clearly distinguish the tile grid from the floor surface and the floor from hazard overlays.
5. **Countdown camera**: Camera is centered on arena origin (0, 0, 0) immediately when the countdown screen appears, with no visible drift.
6. **Countdown-to-running transition**: When the fight starts, camera smoothly transitions from center to following the player. No jarring snap.

## Architecture

### Issue 1: Weapon swap edge case analysis

The equip action (GameSimulation.ts L601-617) works by mutating the inventory slot in-place: it reads the currently equipped weapon, switches `loadout.weapon` to the clicked item, then overwrites the inventory slot with the old weapon. The key code path:

```
L608: const slotItem = inv.slots[action.slotIndex];
L609: if (slotItem) {
L610:   slotItem.id = `${oldType}_${oldTier}`;
        ...
```

The `if (slotItem)` guard is the critical piece. If the fix removes the primary from inventory, then on the first swap, slot 0 contains the **secondary** weapon (not the primary). When the user clicks slot 0 (the secondary):

1. `action.weaponType` / `action.weaponTier` = the secondary weapon (from `useItem` parsing the slot's id)
2. `oldType` / `oldTier` = the currently equipped primary weapon
3. `loadout.switchWeapon(secondary)` -- loadout now holds the secondary
4. `slotItem` is the secondary's inventory entry (non-null) -- it gets overwritten with the primary's data

Result: equipped weapon is now the secondary, inventory slot 0 is now the primary. This is exactly correct. The swap works because `slotItem` is always non-null (it is the secondary weapon the user clicked). **No edge case problem.**

The only scenario that would break is if the user somehow clicks an empty slot, which `useItem()` already guards against by returning `null`.

### Issue 2: Floor color rationale

The Corrupted Gauntlet in OSRS has a dark reddish-purple stone floor with visible tile edges. The current colors are too close to pure black. The goal is: dark enough to feel like a dungeon, bright enough that the grid reads clearly, and warm/red enough to evoke corruption. Hazard overlays (crimson warning, orange-red hazard) must remain visually distinct from the base floor.

### Issue 3: Camera snap vs fast lerp

Two options for the countdown camera:

- **Option A: Instant snap.** Set `target` directly to `desiredTarget` (bypass lerp). Pro: camera is always perfectly centered. Con: if the transition from countdown to running happens while the player is far from center, the camera snaps to the player position, which can feel jarring.
- **Option B: Fast lerp (e.g., 0.5 instead of 0.1).** Pro: smooth but fast. Con: still technically drifts for 3-4 frames on scene load.

**Recommendation: Snap during countdown, normal lerp during running.** The countdown is a static overlay with a big number on screen -- any camera motion during it is distracting, not cinematic. The transition to running already has a "FIGHT!" overlay that lasts 2 ticks, providing visual cover for the camera moving to track the player.

Additionally, the `CameraController` constructor calls `updateCameraPosition()` which positions the camera based on `target = (0,0,0)`. This is correct for the countdown. But if `draw()` is never called before the countdown ends (unlikely but possible), the camera would be at origin anyway. No constructor change needed -- the initial state is already correct.

However, there is a subtlety: `setTarget` only updates `desiredTarget`, and `update()` lerps `target` toward it. Even with a snap during countdown, we need to ensure `target` itself is set to (0,0,0), not just `desiredTarget`. The cleanest approach is to add a `snapTarget()` method to CameraController that sets both `target` and `desiredTarget` simultaneously, then call it during countdown.

## Implementation

### Phase 1: Fix 3-weapons bug (~25% of effort)

**File:** `src/entities/Inventory.ts`

- [ ] Remove lines 49-57 (the block that adds the primary weapon to inventory slot 0)
- [ ] Verify that `idx` still starts at 0, so the secondary weapon (if present) goes into slot 0

The resulting `buildFromLoadout()` should look like:

```typescript
buildFromLoadout(config: LoadoutConfig): void {
    this.slots = new Array(28).fill(null);
    let idx = 0;

    // Secondary weapon goes into inventory (primary is already equipped via loadout.weapon)
    if (config.secondaryWeaponType && config.secondaryWeaponTier) {
      const secondaryWeapon = WEAPONS[config.secondaryWeaponType][config.secondaryWeaponTier];
      this.slots[idx++] = {
        id: `${config.secondaryWeaponType}_${config.secondaryWeaponTier}`,
        name: secondaryWeapon.name,
        category: 'weapon',
        quantity: 1,
        color: '#8888cc',
        spriteUrl: weaponSprite(config.secondaryWeaponType, config.secondaryWeaponTier),
      };
    }

    // Egniol vials...
```

**File:** `src/__tests__/inventory.test.ts` (or relevant test file)

- [ ] Add test: `buildFromLoadout` with primary + secondary produces exactly 1 weapon in inventory (the secondary)
- [ ] Add test: `buildFromLoadout` with primary only produces 0 weapons in inventory
- [ ] Verify existing weapon swap tests still pass (the swap logic in GameSimulation is unchanged)

### Phase 2: Fix floor colors (~15% of effort)

**File:** `src/render/Renderer3D.ts`

- [ ] Change floor material color from `0x1a0a0a` to `0x2d1216` (dark burgundy -- visible but moody)
- [ ] Change grid line color from `0x3a1a1a` to `0x5c2a2e` (muted rose -- clear contrast against floor)
- [ ] Optionally change the clear color (L127) from `0x1a0a0a` to `0x0d0507` (near-black with slight red) so the area outside the arena reads as darker than the floor

Color rationale:
| Element | Current Hex | Proposed Hex | RGB | Description |
|---------|-------------|-------------|-----|-------------|
| Floor | `0x1a0a0a` | `0x2d1216` | (45, 18, 22) | Dark burgundy stone |
| Grid | `0x3a1a1a` | `0x5c2a2e` | (92, 42, 46) | Muted rose edges |
| Clear/BG | `0x1a0a0a` | `0x0d0507` | (13, 5, 7) | Near-black surround |

The floor-to-grid brightness ratio goes from ~1.5:1 (barely perceptible) to ~2.5:1 (clearly visible). Both colors stay within the red/dark-stone palette of the Corrupted Gauntlet. The hazard overlay colors (crimson `0xdc143c` at 0.3 opacity, orange-red `0xff4500` at 0.6 opacity) will remain distinct because they are far brighter and more saturated.

### Phase 3: Fix camera during countdown (~30% of effort)

**File:** `src/render/CameraController.ts`

- [ ] Add a `snapTarget(x: number, y: number, z: number)` method that sets BOTH `this.target` and `this.desiredTarget` to the given position, then calls `updateCameraPosition()` immediately

```typescript
/** Instantly move the camera focus to the given point (no lerp). */
snapTarget(x: number, y: number, z: number): void {
  this.target.set(x, y, z);
  this.desiredTarget.set(x, y, z);
  this.updateCameraPosition();
}
```

**File:** `src/render/Renderer3D.ts`

- [ ] In `draw()` (L426-431), replace `this.cameraController.setTarget(0, 0, 0)` with `this.cameraController.snapTarget(0, 0, 0)` during countdown

Updated block:
```typescript
if (sim.state === 'countdown') {
  this.cameraController.snapTarget(0, 0, 0);
} else {
  this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
}
```

This means:
- During countdown: camera is always exactly at origin. No drift, no matter where the player mesh is.
- Transition to running: `setTarget` sets `desiredTarget` to the player position. `update()` lerps `target` from (0,0,0) toward the player at 10% per frame. This is the smooth transition we want -- the "FIGHT!" text provides visual cover.
- During running: standard smooth follow behavior, unchanged.

### Phase 4: Update existing tests (~30% of effort)

- [ ] Run `npm test` and identify any tests that assert the number of weapons in inventory (these will need updating from 2 to 1 for dual-weapon loadouts, or from 1 to 0 for single-weapon loadouts)
- [ ] Run `npm run build` to verify no type errors
- [ ] Visual verification in browser: confirm 2 weapons total (1 equipped + 1 in inventory), visible floor grid, centered camera during countdown

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/entities/Inventory.ts` | Modify L44-57 | Remove primary weapon from inventory slots; only add secondary |
| `src/render/Renderer3D.ts` | Modify L127, L246, L253 | Update floor, grid, and clear colors to brighter themed values |
| `src/render/Renderer3D.ts` | Modify L426-427 | Use `snapTarget` instead of `setTarget` during countdown |
| `src/render/CameraController.ts` | Add method | Add `snapTarget()` for instant camera positioning |
| `src/__tests__/inventory.test.ts` | Add tests | Verify buildFromLoadout weapon count, verify swap still works |

## Definition of Done

- [ ] Selecting bow + staff results in exactly 2 visible weapons: 1 equipped, 1 in inventory
- [ ] Selecting a single weapon results in 0 weapons in inventory (only the equipped one)
- [ ] Weapon swap from initial state works correctly: clicking secondary in slot 0 equips it and places primary in slot 0
- [ ] Arena floor and grid lines are clearly distinguishable at a glance
- [ ] Hazard overlays (warning/crimson, active/orange-red) remain visually distinct from the base floor
- [ ] Camera is perfectly centered on origin during the entire countdown -- no drift
- [ ] Camera smoothly follows the player after the fight starts
- [ ] All existing cg-sim tests pass (`npm test`)
- [ ] All cg-sim-player tests pass (`cd ../cg-sim-player && npm test`)
- [ ] `npm run build` succeeds with no errors

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Removing primary from inventory breaks tests that count weapon slots | Medium | Low | Run tests early in Phase 1; update assertions from 2 weapons to 1 |
| Floor colors look wrong on different monitors/gamma settings | Low | Low | Chosen colors have 2.5:1 contrast ratio; test on at least one low-brightness display |
| `snapTarget` during countdown causes a visible "jump" when transitioning to running | Low | Medium | The lerp from (0,0,0) to the player position is gradual; the "FIGHT!" overlay provides 2 ticks (~1.2s) of visual cover |
| Weapon swap breaks if secondary weapon slot index changes | None | N/A | Secondary moves from slot 1 to slot 0, but `useItem()` reads from the actual slot index clicked. The equip action includes `slotIndex` in the action payload. No hardcoded slot indices in the swap path. |
| cg-sim-player tests fail due to inventory layout change | Low | Medium | cg-sim-player reads inventory state from the sim's public API. If it relies on the primary being in slot 0, it would need updating. Check by running its tests. Constraint says never modify cg-sim-player, so the sim's public contract must remain compatible. |

## Security Considerations

No security impact. Changes are limited to inventory population logic, material color constants, and camera interpolation behavior. No new inputs, network calls, or dependencies.

## Dependencies

- No new npm packages
- No changes to cg-sim-player (constraint: never modify cg-sim-player)
- Three.js API usage is unchanged; only constant values are modified

## Open Questions

1. **Are the proposed floor colors (`0x2d1216` / `0x5c2a2e`) the right shade of Corrupted Gauntlet?** The actual CG floor in OSRS has more purple undertones in some areas. An alternative palette could lean more purple: floor `0x261420`, grid `0x4c2840`. Needs visual sign-off.

2. **Should the camera lerp speed (`TARGET_LERP_ALPHA = 0.1`) be increased for the running state too?** The current 10% per frame can feel sluggish when the player moves quickly across the arena. A value of 0.15-0.2 might feel tighter without being jarring. This is out of scope for this sprint but worth noting.

3. **Should `buildFromLoadout` be defensive about a missing secondary (config where `secondaryWeaponType` equals `weaponType`)?** Currently nothing prevents the user from selecting the same weapon as both primary and secondary. The fix still works (inventory would have a duplicate of the equipped weapon), but the UX is odd. Consider adding a UI-level guard in a future sprint.

4. **Does the cg-sim-player bot ever reference inventory slot indices for weapons by position?** If it assumes the primary is in slot 0, removing it would shift the secondary to slot 0 and potentially confuse the bot's swap logic. Need to verify by running `cd ../cg-sim-player && npm test`.
