# Sprint 023: UI Defaults and Polish Fixes

## Overview

Small cleanup sprint with five targeted changes: fix loadout screen defaults to match a typical beginner setup, persist loadout preferences across page refreshes via localStorage, and make the Hunlef play its idle animation during the pre-fight countdown.

**What ships**: Corrected default values, localStorage save/restore, idle animation during countdown.

## Use Cases

1. **Fresh page load**: New user sees Armor=T1, Weapon=Staff T3, 2nd Weapon=Bow T3, Paddlefish=24, C. Paddlefish=0, Egniol=8.
2. **Preference persistence**: User tweaks loadout, refreshes page, sees previous selections restored.
3. **Corrupted/missing localStorage**: Silently falls back to hardcoded defaults with no console errors.
4. **Idle animation during countdown**: Hunlef visibly breathes/sways during the countdown timer instead of being static.

## Implementation

### Task 1: Fix Default Values

**File:** `src/render/LoadoutScreen.ts`

In the `build()` method's HTML template:

| Field | Old Default | New Default |
|-------|-------------|-------------|
| Armor Tier | T3 (Perfected) | T1 (Basic) |
| 2nd Weapon | None | Bow |
| 2nd Weapon Tier | (hidden) | T3 (Perfected, visible) |
| Paddlefish | 12 | 24 (fills remaining slots) |
| C. Paddlefish | 4 | 0 |

Weapon Type (Staff), Weapon Tier (T3), and Egniol (8) stay the same.

Also set `#secondary-tier-row` initial display to `flex` since 2nd weapon now defaults to Bow.

### Task 2: localStorage Persistence

**File:** `src/render/LoadoutScreen.ts`

- **Key**: `cg-sim-loadout`
- **Save**: On every `change`/`input` event (already wired for DPS preview), serialize all form field values as JSON to localStorage.
- **Restore**: After `build()` renders the HTML, attempt to read and parse `cg-sim-loadout`. For each field, set the element's `.value`. Wrap entirely in try/catch — any failure falls back to the defaults already in the HTML.
- After restore, re-trigger `updateSecondaryOptions()`, `updatePreview()`, and `updateSlotCount()` to sync derived UI.

### Task 3: Idle Animation During Countdown

**File:** `src/render/AnimationController.ts`

The problem: `AnimationController` constructor sets `currentState = 'idle'` then calls `playIdle()` → `crossFadeTo('idle')` — but since `currentState` is already `'idle'`, the guard `if (state === this.currentState) return` short-circuits, and the idle action never gets `.play()` called. The mixer has nothing to update.

Fix: In the constructor, after registering all actions, directly get the idle action and call `.reset().play()` on it, then `this.mixer.update(0)` to apply frame 0. This replaces the `this.playIdle()` call that no-ops.

### Task 4: Paddlefish Count Auto-Fill (Nice-to-have)

If time permits, make the default paddlefish count dynamically calculate remaining inventory slots (28 - weapons - egniol vials) rather than hardcoding 24. This ensures the default is always correct regardless of weapon/egniol changes. If not, hardcoded 24 is fine for the default loadout.

## Files Summary

| File | Change |
|------|--------|
| `src/render/LoadoutScreen.ts` | Fix 5 default values in HTML template; add `saveToStorage()`/`restoreFromStorage()` methods; wire save into event listeners |
| `src/render/AnimationController.ts` | Fix constructor to directly play idle action and call `mixer.update(0)` |

## Definition of Done

- [ ] Fresh page load (no localStorage) shows: Armor=T1, Staff T3, 2nd Weapon=Bow T3, Paddlefish=24, C. Paddlefish=0, Egniol=8
- [ ] Changing any loadout field and refreshing preserves the selection
- [ ] Clearing localStorage and refreshing falls back to defaults with no errors
- [ ] Putting invalid JSON in localStorage key and refreshing falls back to defaults with no errors
- [ ] Boss plays idle animation (visible breathing/swaying) during countdown — not static
- [ ] DPS preview and slot counter update correctly after localStorage restore
- [ ] All existing tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| localStorage schema changes in future break restore | Low | try/catch wrapper; any failure silently falls back to defaults |
| Secondary weapon "bow" filtered by updateSecondaryOptions when primary is also "bow" | Low | Primary defaults to "staff", so "bow" always available in secondary list |
| `mixer.update(0)` in constructor causes visible glitch | Very Low | Frame 0 of idle IS the natural rest pose |
