# Sprint 023: UI Defaults and Polish Fixes

## Overview

Small cleanup sprint with five targeted changes: fix loadout screen defaults to match typical beginner setups, persist loadout preferences across page refreshes via localStorage, and make the Hunlef play its idle animation during the pre-fight countdown instead of standing in a static T-pose.

**What ships**: Corrected default values, localStorage save/restore for loadout config, idle animation visible during countdown.

**What's deferred**: Nothing — this is a self-contained polish sprint.

## Use Cases

1. **Fresh page load**: A new user sees Armor=T1, Weapon=Staff T3, 2nd Weapon=Bow T3, Paddlefish=20, C. Paddlefish=0, Egniol=8 — a realistic beginner loadout without manual adjustment.
2. **Preference persistence**: User tweaks loadout, refreshes the page, and sees their previous selections restored.
3. **Corrupted/missing localStorage**: If localStorage data is missing, malformed, or from a stale schema, the app silently falls back to hardcoded defaults with no console errors.
4. **Idle animation during countdown**: The Hunlef visibly breathes/sways during the countdown timer instead of frozen in its bind pose.

## Architecture

### Default Value Changes (LoadoutScreen.ts)

Pure HTML template changes — move `selected` attributes and `value` attributes to match the target defaults:

| Field | Old Default | New Default |
|-------|-------------|-------------|
| Armor Tier | T3 (Perfected) | T1 (Basic) |
| 2nd Weapon | None | Bow |
| 2nd Weapon Tier | (hidden) | T3 (Perfected, visible) |
| Paddlefish | 12 | 20 |
| C. Paddlefish | 4 | 0 |

Weapon Type (Staff), Weapon Tier (T3), and Egniol (8) stay the same.

### localStorage Persistence (LoadoutScreen.ts)

**Key**: `cg-sim-loadout`

**Shape**: JSON object matching the form field IDs and their values. Store only primitive values (strings and numbers) to avoid coupling to internal types:

```ts
interface StoredLoadout {
  armorTier: string;
  weaponType: string;
  weaponTier: string;
  secondaryWeaponType: string;
  secondaryWeaponTier: string;
  paddlefishCount: string;
  corruptedPaddlefishCount: string;
  egniolDoses: string;
  fkeyInventory: string;
  fkeyPrayer: string;
  fkeyEquipment: string;
}
```

**Save**: On every `change`/`input` event (already wired up for DPS preview and slot counter), serialize current form state to localStorage.

**Restore**: After `build()` renders the HTML with hardcoded defaults, attempt to read and parse `cg-sim-loadout`. For each field present in the stored object, set the corresponding element's `.value`. Wrap the entire restore in a try/catch — any failure (parse error, missing keys, DOM mismatch) silently falls back to the defaults already in the HTML. After restoring, update derived UI state (secondary tier row visibility, slot count, DPS preview).

### Idle Animation During Countdown (Renderer3D.ts)

The problem: `updateBossAnimations()` only triggers on game events (`sim.lastBossEventTick`/`sim.lastBossEventType`). During countdown, no events fire, so the early-return at line 929-931 prevents any animation from playing. Meanwhile, `AnimationController.playIdle()` is called in the constructor, but the mixer needs at least one `update(0)` call to apply the first frame — and `draw()` is already calling `this.animController.update(dt)` on every frame.

The fix: the real issue is that `crossFadeTo` short-circuits when `state === this.currentState`. The constructor sets `currentState = 'idle'` and calls `playIdle()` which calls `crossFadeTo('idle')` — but since currentState is already `'idle'`, it returns without actually starting the action. The idle action never gets `.play()` called.

**Solution**: In `AnimationController.playIdle()`, directly play the idle action if no action is currently playing (i.e., at construction time). Alternatively, in the constructor, bypass `crossFadeTo` and directly `.play()` the idle action after setting it up, then call `this.mixer.update(0)` to apply frame 0.

## Implementation

### Phase 1: Fix Defaults

In `LoadoutScreen.ts` `build()`:

1. Move `selected` on `#armor-tier` from `value="3"` to `value="1"`.
2. Set `#secondary-weapon-type` default to `value="bow"` with `selected`.
3. Set `#secondary-tier-row` initial display to `flex` (since 2nd weapon is now defaulted).
4. Change `#paddlefish-count` `value` from `"12"` to `"20"`.
5. Change `#corrupted-paddlefish-count` `value` from `"4"` to `"0"`.

### Phase 2: localStorage Persistence

In `LoadoutScreen.ts`:

1. Add a private `saveToStorage()` method that reads all form element values and writes them as JSON to `localStorage.setItem('cg-sim-loadout', ...)`.
2. Add a private `restoreFromStorage()` method that reads `localStorage.getItem('cg-sim-loadout')`, parses it, and sets `.value` on each form element. Wrapped entirely in try/catch.
3. Call `restoreFromStorage()` at the end of `build()`, after the HTML is in the DOM but before event listeners fire derived updates.
4. Hook `saveToStorage()` into existing change/input event listeners.
5. After restore, re-trigger `updateSecondaryOptions()`, `updatePreview()`, and `updateSlotCount()` to sync derived UI.

### Phase 3: Idle Animation During Countdown

In `AnimationController.ts` constructor:

1. After registering all actions and the `finished` listener, directly get the idle action, call `.reset().play()` on it, then `this.mixer.update(0)` to bake frame 0 into the mesh. This replaces the current `this.playIdle()` call which no-ops due to the `crossFadeTo` same-state guard.

## Files Summary

| File | Change |
|------|--------|
| `src/render/LoadoutScreen.ts` | Fix 5 default values in HTML template; add `saveToStorage()`/`restoreFromStorage()` methods; wire save into event listeners |
| `src/render/AnimationController.ts` | Fix constructor to directly play idle action and call `mixer.update(0)` |

## Definition of Done

1. Fresh page load (no localStorage) shows: Armor=T1, Staff T3, 2nd Weapon=Bow T3, Paddlefish=20, C. Paddlefish=0, Egniol=8.
2. Changing any loadout field and refreshing preserves the selection.
3. Clearing localStorage (`localStorage.removeItem('cg-sim-loadout')`) and refreshing falls back to defaults with no errors.
4. Putting invalid JSON in the localStorage key and refreshing falls back to defaults with no errors.
5. Boss plays idle animation (visible breathing/swaying) during countdown — not static.
6. All existing tests pass (`npm test`).
7. Build succeeds (`npm run build`).
8. DPS preview and slot counter update correctly after localStorage restore.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| localStorage schema changes in future sprints break restore | Low | Wrap restore in try/catch; any parse failure silently falls back to defaults |
| Secondary weapon default ("bow") gets filtered out by `updateSecondaryOptions()` when primary is also "bow" | Low | Primary default is "staff", so "bow" is always in the secondary list. Restore logic re-runs `updateSecondaryOptions()` after setting values |
| `mixer.update(0)` in constructor causes a visible frame glitch | Very Low | Frame 0 of idle is the natural rest pose; applying it immediately is the desired behavior |

## Open Questions

None — all five tasks are well-specified with clear acceptance criteria.
