# Sprint 013: UI/UX Polish — Weapons, Floor, Camera

## Overview

Three user-facing UI/UX bugs need fixing:

1. **Duplicate weapon in inventory:** `Inventory.buildFromLoadout()` places the primary weapon in inventory slot 0, but the primary is already equipped via `Loadout.weapon`. This means selecting bow + staff shows 3 weapons (1 equipped + 2 in inventory) instead of 2 (1 equipped + 1 in inventory).

2. **Invisible arena floor:** The floor material (`0x1a0a0a`) and grid lines (`0x3a1a1a`) are nearly indistinguishable dark colors. Players cannot see the arena boundaries or tile grid.

3. **Camera drift during countdown:** `Renderer3D.draw()` sets the camera target to `(0,0,0)` during countdown, but `CameraController.update()` uses `target.lerp(desiredTarget, 0.1)` — a 10%-per-frame interpolation. If the player spawns away from center, the camera slowly drifts instead of being centered.

All three are isolated, low-risk fixes in well-understood code paths.

## Use Cases

### UC-1: Two-weapon loadout displays correctly
- Player selects bow (primary) + staff (secondary) in setup screen
- Fight starts: bow is equipped (shown in equipment panel), staff is in inventory slot 0
- Player sees exactly 2 weapons total, not 3
- Clicking staff in inventory swaps it with the equipped bow (existing weapon swap logic at `GameSimulation.ts` L601-617 is unaffected)

### UC-2: Single-weapon loadout
- Player selects only a bow (no secondary)
- Fight starts: bow is equipped, inventory has zero weapon slots
- No regression from the fix

### UC-3: Arena floor is clearly visible
- Player can see the floor surface and grid lines with good contrast
- Floor color evokes the Corrupted Gauntlet's reddish/dark theme
- Grid lines are distinct from the floor surface
- Hazard tiles remain visually distinguishable from the floor

### UC-4: Camera centered during countdown
- Fight starts with countdown timer
- Camera is immediately centered on the arena (0,0,0), not slowly drifting
- When countdown ends and fight begins, camera transitions smoothly to follow the player (not a jarring snap)

## Architecture

### Bug 1: Inventory weapon slot fix

**Root cause:** `Inventory.buildFromLoadout()` (Inventory.ts L44-70) unconditionally adds the primary weapon to slot 0. But `Loadout` constructor (Loadout.ts L23-27) already sets `this.weapon = WEAPONS[config.weaponType][config.weaponTier]`, making the primary weapon the equipped weapon. The inventory slot is redundant.

**Fix:** Skip adding the primary weapon to inventory. Only add the secondary weapon (if configured). This changes inventory slot assignment — the secondary weapon moves from slot 1 to slot 0, and all subsequent items shift up by one slot.

**Impact on weapon swap logic:** The swap logic in `GameSimulation.ts` L601-617 operates on the clicked slot index and reads the weapon type/tier from the slot's `id` field. It doesn't hardcode slot indices, so shifting items up by one slot is safe.

**Impact on inventory count:** One fewer slot used. A loadout that previously used N slots now uses N-1, freeing one slot. This is correct — the equipped weapon shouldn't consume an inventory slot (per INTENT.md: "Weapons occupy slots when in inventory (not on action bar)").

### Bug 2: Floor color

**Current values:**
- Floor material: `0x1a0a0a` (R:26, G:10, B:10) — near-black
- Grid lines: `0x3a1a1a` (R:58, G:26, B:26) — barely visible dark brown

**New values (Corrupted Gauntlet theme — deep red/purple with visible contrast):**
- Floor material: `0x2a1520` (R:42, G:21, B:32) — dark corrupted purple-red
- Grid lines: `0x5a3040` (R:90, G:48, B:64) — visible reddish-purple grid

This provides ~2x brightness increase on the grid lines relative to the floor, maintaining the Corrupted Gauntlet's dark reddish aesthetic while ensuring visibility. The grid lines will be clearly distinguishable from the floor surface.

### Bug 3: Camera snap during countdown

**Current behavior:** `CameraController.update()` always lerps `target` toward `desiredTarget` at 10% per frame (L69). During countdown, `desiredTarget` is set to `(0,0,0)` but the lerp means `target` approaches it slowly.

**Fix:** Add a `snapTarget()` method to `CameraController` that sets `target` directly to `desiredTarget` (bypassing lerp). Call `snapTarget()` during countdown in `Renderer3D.draw()`.

**Countdown → running transition:** When the countdown ends, `desiredTarget` switches to the player position and the existing lerp handles smooth follow. No snap needed here — the 10% lerp provides a natural transition from center to player.

## Implementation

### Phase 1: Fix inventory weapon slots

- [ ] **1.1** In `src/entities/Inventory.ts`, modify `buildFromLoadout()` to skip the primary weapon. Remove lines 49-57 (the block that adds the primary weapon to slot 0). The secondary weapon block (L60-70) becomes the first item added to inventory.

**Before (L44-70):**
```typescript
buildFromLoadout(config: LoadoutConfig): void {
    this.slots = new Array(28).fill(null);
    let idx = 0;

    // Weapons first - always include the primary weapon
    const primaryWeapon = WEAPONS[config.weaponType][config.weaponTier];
    this.slots[idx++] = {
      id: `${config.weaponType}_${config.weaponTier}`,
      name: primaryWeapon.name,
      category: 'weapon',
      quantity: 1,
      color: '#8888cc',
      spriteUrl: weaponSprite(config.weaponType, config.weaponTier),
    };

    // Second weapon if configured
    if (config.secondaryWeaponType && config.secondaryWeaponTier) {
      ...
    }
```

**After:**
```typescript
buildFromLoadout(config: LoadoutConfig): void {
    this.slots = new Array(28).fill(null);
    let idx = 0;

    // Only the secondary weapon goes in inventory — primary is already equipped via Loadout.weapon
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
```

- [ ] **1.2** Update any existing tests that assert on inventory slot positions or item counts to reflect the primary weapon no longer being in inventory. Search for test files referencing `buildFromLoadout` or inventory weapon slots.

- [ ] **1.3** Verify `npm test` passes all 185 tests.

- [ ] **1.4** Verify `cd ../cg-sim-player && npm test` passes all 52 tests (read-only — do NOT modify cg-sim-player).

### Phase 2: Fix floor visibility

- [ ] **2.1** In `src/render/Renderer3D.ts`, update `createFloor()` method (L244-268):
  - Change floor material color from `0x1a0a0a` to `0x2a1520`
  - Change grid line color from `0x3a1a1a` to `0x5a3040`

**Before:**
```typescript
const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a0a0a });
...
const gridMat = new THREE.LineBasicMaterial({ color: 0x3a1a1a });
```

**After:**
```typescript
const floorMat = new THREE.MeshLambertMaterial({ color: 0x2a1520 });
...
const gridMat = new THREE.LineBasicMaterial({ color: 0x5a3040 });
```

- [ ] **2.2** Visual verification in browser — floor and grid lines should be clearly visible while maintaining dark Corrupted Gauntlet aesthetic.

### Phase 3: Fix camera during countdown

- [ ] **3.1** In `src/render/CameraController.ts`, add a `snapTarget()` method:

```typescript
/** Instantly move the camera target (bypasses lerp interpolation) */
snapTarget(): void {
  this.target.copy(this.desiredTarget);
  this.updateCameraPosition();
}
```

- [ ] **3.2** In `src/render/Renderer3D.ts`, update the countdown branch in `draw()` (L426-427) to call `snapTarget()` after `setTarget()`:

**Before:**
```typescript
if (sim.state === 'countdown') {
  this.cameraController.setTarget(0, 0, 0);
} else {
  this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
}
this.cameraController.update(dt);
```

**After:**
```typescript
if (sim.state === 'countdown') {
  this.cameraController.setTarget(0, 0, 0);
  this.cameraController.snapTarget();
} else {
  this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
}
this.cameraController.update(dt);
```

- [ ] **3.3** Visual verification — camera should be centered during countdown with no drift, then smoothly follow player when fight starts.

### Phase 4: Final verification

- [ ] **4.1** `npm run build` passes with no errors
- [ ] **4.2** `npm test` — all 185 tests pass
- [ ] **4.3** `cd ../cg-sim-player && npm test` — all 52 tests pass
- [ ] **4.4** Visual verification of all three fixes in browser

## Files Summary

| File | Change | Lines |
|------|--------|-------|
| `src/entities/Inventory.ts` | Remove primary weapon from `buildFromLoadout()` — only add secondary | L44-70 |
| `src/render/Renderer3D.ts` | Update floor/grid colors in `createFloor()` | L246, L253 |
| `src/render/Renderer3D.ts` | Add `snapTarget()` call during countdown in `draw()` | L426-428 |
| `src/render/CameraController.ts` | Add `snapTarget()` method | New method (~4 lines) |
| Test files (TBD) | Update inventory slot assertions if any hardcode primary weapon in slot 0 | TBD |

**No new files created. No new dependencies.**

## Definition of Done

1. Selecting bow + staff in setup results in exactly 2 weapons visible — one equipped, one in inventory slot 0
2. Single-weapon loadout shows 1 equipped weapon, zero weapons in inventory
3. Arena floor and grid lines are clearly visible with good contrast, maintaining Corrupted Gauntlet reddish-dark aesthetic
4. Camera is centered on the arena during countdown with no drift
5. Camera smoothly transitions to follow the player when countdown ends (no jarring snap)
6. `npm run build` succeeds
7. `npm test` — all 185 tests pass
8. `cd ../cg-sim-player && npm test` — all 52 tests pass (cg-sim-player is NEVER modified)

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Removing primary weapon from inventory breaks slot index assumptions in test suite | Test failures | Medium | Search all test files for `buildFromLoadout` / inventory slot assertions and update |
| Removing primary weapon from inventory breaks weapon swap in `GameSimulation.ts` | Equipped weapon can't swap back to inventory | Low | Swap logic uses the clicked slot's index, not hardcoded slot 0. Swapping already works by replacing the slot content — no index assumption. Verify manually. |
| Floor colors don't look right on different monitors/brightness | Visual quality issue | Low | Colors are 2x brighter than current — even on dark monitors they'll be more visible. Can be tuned post-merge. |
| `snapTarget()` causes a visual jump when fight starts | Camera jank | Very Low | `snapTarget()` only runs during countdown. When state transitions to running, `setTarget(playerPos)` is called and the existing lerp handles smooth follow. |
| cg-sim-player tests fail due to inventory change | Blocked sprint | Medium | The primary weapon removal changes `itemCount` and slot positions. If cg-sim-player reads inventory state, tests may fail. Run tests early (Phase 1.4) to catch this before other changes. If tests fail, investigate what cg-sim-player expects — the fix may need to preserve a dummy slot or adjust the loadout config. |

## Security Considerations

No security impact. All changes are visual (floor colors, camera behavior) or fix a display-only bug (inventory slots). No user input handling, network calls, or data persistence affected.

## Dependencies

- Three.js (already in use) — no new dependencies
- cg-sim-player (read-only, never modified) — must pass its 52 tests

## Open Questions

1. **Floor colors:** The proposed `0x2a1520` / `0x5a3040` values are an estimate. Should we pull actual Corrupted Gauntlet floor colors from the OSRS cache, or are these "close enough" values acceptable?
2. **Camera snap vs. fast lerp:** The draft uses an instant snap during countdown. An alternative is a fast lerp (e.g., `alpha = 0.5` instead of `0.1`) for a softer feel. Which approach is preferred?
3. **Countdown → running transition:** Currently the lerp at `alpha = 0.1` handles this. If the player spawns far from center, this could feel sluggish for the first ~1 second. Should we use a faster lerp (e.g., `0.3`) for the first few frames after countdown ends?
4. **Inventory slot count in cg-sim-player:** Does cg-sim-player's test suite assert on specific inventory item counts or slot positions? If so, the primary weapon removal could break tests. Need to investigate before implementing.
