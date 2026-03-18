# Sprint 013: UI/UX Polish — Weapons, Floor, Camera

## Overview

Three user-reported UI/UX fixes:

1. **3 weapons instead of 2:** `buildFromLoadout()` adds the primary weapon to inventory slot 0, but it's already equipped via `loadout.weapon`. Selecting bow + staff shows 3 weapons (equipped + 2 in inventory) instead of 2.
2. **Floor too dark:** Floor color `0x1a0a0a` and grid `0x3a1a1a` are nearly identical dark values. The arena is hard to see.
3. **Camera drift during countdown:** Camera target is set to `(0,0,0)` but uses a slow 10%-per-frame lerp. Camera drifts instead of being centered.

## Use Cases

1. **Bow + staff loadout:** 2 visible weapons — bow equipped, staff in inventory slot 0
2. **Single weapon loadout:** 1 visible weapon — bow equipped, 0 weapons in inventory
3. **First weapon swap:** Clicking staff in slot 0 equips it, places bow in slot 0 — works correctly because the swap logic reads the clicked slot, not a hardcoded index
4. **Floor visibility:** Grid lines clearly distinguishable from floor surface; hazard overlays remain distinct
5. **Countdown camera:** Camera perfectly centered on arena during countdown, no drift
6. **Countdown → running:** Camera smoothly lerps to follow the player (the "FIGHT!" overlay provides visual cover)

## Architecture

### Bug 1: Weapon fix

`buildFromLoadout()` unconditionally adds the primary weapon to slot 0. But `Loadout` constructor already sets `this.weapon` to the primary. The inventory copy is redundant.

**Fix:** Remove the primary weapon block (L49-57). Only add the secondary to inventory. The secondary moves from slot 1 to slot 0.

**Weapon swap is safe:** The equip action (GameSimulation.ts L601-617) reads `oldType`/`oldTier` from the equipped weapon, switches to the clicked weapon, then overwrites the slot with the old weapon. The `if (slotItem)` guard at L609 is satisfied because the slot contains the secondary (non-null). No index assumptions.

### Bug 2: Floor colors

| Element | Current | New | Description |
|---------|---------|-----|-------------|
| Floor | `0x1a0a0a` | `0x2d1216` | Dark burgundy stone |
| Grid | `0x3a1a1a` | `0x5c2a2e` | Muted rose edges |
| Clear/BG | `0x1a0a0a` | `0x0d0507` | Near-black surround |

Floor-to-grid brightness ratio: ~1.5:1 → ~2.5:1. Hazard overlays (crimson `0xdc143c`, orange-red `0xff4500`) remain far brighter and distinct.

### Bug 3: Camera snap

Add `snapTarget(x, y, z)` to CameraController — sets both `target` and `desiredTarget` directly, bypassing lerp. Call it during countdown. When state transitions to running, `setTarget()` resumes normal lerp behavior.

## Implementation

### Phase 1: Fix inventory weapon slots (~30% of effort)

**File:** `src/entities/Inventory.ts`

**Tasks:**
- [ ] Remove lines 48-57 (the block that adds the primary weapon to inventory). The secondary weapon block (currently L60-70) becomes the first item added:

```typescript
buildFromLoadout(config: LoadoutConfig): void {
    this.slots = new Array(28).fill(null);
    let idx = 0;

    // Secondary weapon goes in inventory (primary is already equipped via Loadout.weapon)
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

- [ ] Update any existing tests that assert on inventory weapon count or slot positions
- [ ] `npm test` — verify all tests pass
- [ ] `cd ../cg-sim-player && npm test` — verify all 52 tests pass

### Phase 2: Fix floor visibility (~15% of effort)

**File:** `src/render/Renderer3D.ts`

**Tasks:**
- [ ] Change floor material color from `0x1a0a0a` to `0x2d1216` (L246)
- [ ] Change grid line color from `0x3a1a1a` to `0x5c2a2e` (L253)
- [ ] Change clear color from `0x1a0a0a` to `0x0d0507` (L127)

### Phase 3: Fix camera during countdown (~25% of effort)

**File:** `src/render/CameraController.ts`

**Tasks:**
- [ ] Add `snapTarget()` method:

```typescript
/** Instantly move the camera focus to the given point (no lerp). */
snapTarget(x: number, y: number, z: number): void {
  this.target.set(x, y, z);
  this.desiredTarget.set(x, y, z);
  this.updateCameraPosition();
}
```

**File:** `src/render/Renderer3D.ts`

- [ ] In `draw()` (L426-427), replace `setTarget` with `snapTarget` during countdown:

```typescript
if (sim.state === 'countdown') {
  this.cameraController.snapTarget(0, 0, 0);
} else {
  this.cameraController.setTarget(playerWorld.x, 0, playerWorld.z);
}
```

### Phase 4: Validation (~30% of effort)

- [ ] `npm run build` — no errors
- [ ] `npm test` — all tests pass
- [ ] `cd ../cg-sim-player && npm test` — all 52 tests pass (never modify cg-sim-player)
- [ ] Visual verification: 2 weapons, visible floor, centered camera

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/Inventory.ts` | Modify L44-70 | Remove primary weapon from buildFromLoadout |
| `src/render/Renderer3D.ts` | Modify L127, L246, L253 | Brighter floor/grid/clear colors |
| `src/render/Renderer3D.ts` | Modify L426-427 | Use snapTarget during countdown |
| `src/render/CameraController.ts` | Add method | snapTarget() for instant camera positioning |

## Definition of Done

- [ ] Selecting bow + staff = 2 visible weapons (1 equipped, 1 in inventory)
- [ ] Selecting single weapon = 0 weapons in inventory
- [ ] Weapon swap from initial state works correctly
- [ ] Arena floor and grid lines clearly visible at a glance
- [ ] Hazard overlays visually distinct from base floor
- [ ] Camera perfectly centered during countdown (no drift)
- [ ] Camera smoothly follows player after fight starts
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all existing + updated tests)
- [ ] `cd ../cg-sim-player && npm test` passes all 52 tests

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tests assert on inventory weapon count/slot position | Medium | Low | Run tests early in Phase 1; update assertions |
| cg-sim-player expects primary in slot 0 | Low | Medium | Run cg-sim-player tests in Phase 1 before other changes |
| Floor colors too bright or wrong tone | Low | Low | User approved `0x2d1216`/`0x5c2a2e`; can be tuned post-merge |
| Camera snap feels jarring on countdown→running transition | Very Low | Low | Existing lerp (10%/frame) handles transition; "FIGHT!" overlay provides visual cover |

## Security Considerations

No security impact. Changes are visual (colors, camera) and fix a display bug (inventory slots).

## Dependencies

- No new dependencies
- cg-sim-player: validation only, never modified

## Open Questions

1. **Resolved: Floor colors** — User chose dark burgundy: `0x2d1216` floor, `0x5c2a2e` grid
2. **Resolved: Camera approach** — Snap during countdown, normal lerp during running
3. **Future: Duplicate weapon guard** — Nothing prevents selecting the same weapon as primary and secondary. Consider adding a UI guard in a future sprint.
