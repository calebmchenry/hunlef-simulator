# Sprint 023: UI Defaults, Loadout Persistence, and Countdown Idle

## Overview

This sprint is a small cleanup pass on the pre-fight flow. `LoadoutScreen` currently hardcodes outdated defaults directly in its HTML, does not persist form state, and `Renderer3D` only changes boss animation when the simulation emits boss events. Combined with `AnimationController` starting in `'idle'` before any action has actually been played, Hunlef stays static during countdown.

Ship three focused changes:

- Update loadout defaults to T1 armor, perfected staff primary, perfected bow secondary, 20 paddlefish, 0 corrupted paddlefish, and 8 egniol doses.
- Persist loadout selections in `localStorage` under a namespaced key.
- Ensure the boss is visibly idling during countdown.

No new dependencies and no fight-mechanics changes.

## Use Cases

1. Fresh page load shows the new recommended defaults.
2. A player changes armor, weapons, food, or F-keys and a browser refresh restores those choices without needing to click Start Fight.
3. Missing or malformed saved data falls back to safe defaults instead of breaking the loadout screen.
4. During the 10-tick countdown, Hunlef plays its idle loop instead of holding a static import pose.

## Architecture

### Loadout state stays local to `LoadoutScreen`

Move defaults out of scattered `selected` and `value` attributes into one typed default state inside `LoadoutScreen`. The screen should render the form, apply either persisted state or defaults, recompute dependent UI (`secondary-tier-row`, slot counter, DPS preview), and serialize the current form state back to storage. This keeps the change self-contained and avoids extra plumbing through `main.ts`.

### Persistence is a small validated JSON blob

Store a browser-only JSON blob at `cg-sim-loadout`. The stored shape should match the current loadout form: armor tier, primary/secondary weapon type and tier, food counts, egniol doses, and `fkeyConfig`.

On load, parse safely and validate each field against allowed tiers, weapon types, F-key values, and input ranges. If a field is invalid, fall back to the default for that field. If the restored secondary weapon matches the current primary weapon, clear it and hide the secondary tier row.

### Countdown idle becomes explicit

`Renderer3D.draw()` already advances the animation mixer every frame. The missing pieces are:

- `AnimationController` never actually starts idle on construction because `currentState` already begins as `'idle'`.
- `updateBossAnimations()` returns early until the first boss event, which never happens during countdown.

Fix this by making the controller start with no active animation, explicitly playing idle, and applying the first pose immediately. Then let `Renderer3D.updateBossAnimations()` treat countdown / no-event startup as idle unless death or a new boss event overrides it.

## Implementation

- Update `src/render/LoadoutScreen.ts` to replace inline HTML defaults with a shared default state and apply restored values after the DOM is built.
- Add small helpers in `src/render/LoadoutScreen.ts` for reading form state, applying form state, loading persisted state, and saving persisted state.
- Save loadout preferences on relevant `change` / `input` events so refreshes round-trip even if the user never clicks Start Fight.
- Change `src/render/AnimationController.ts` so initial idle is a real started action, then force an immediate pose application with `mixer.update(0)`.
- Adjust `src/render/Renderer3D.ts` so `updateBossAnimations()` falls back to `playIdle()` during countdown and pre-event frames while keeping existing event-driven attack, stomp, style-switch, prayer-disable, and death handling.
- Add lightweight tests around any extracted persistence validation helpers if they are kept pure. Renderer animation can be verified manually while the existing suite and build remain the main regression gate.

## Files Summary

- `src/render/LoadoutScreen.ts`: new defaults, storage load/save, restore logic, UI normalization after restore.
- `src/render/AnimationController.ts`: fix initial idle startup and first-frame pose application.
- `src/render/Renderer3D.ts`: countdown idle fallback in `updateBossAnimations()`.
- `src/__tests__/...` or a small render-adjacent test file: optional focused coverage for pure persistence helpers.

## Definition of Done

- Fresh load shows Armor `T1`, Weapon `Staff T3`, 2nd Weapon `Bow T3`, Paddlefish `20`, Corrupted Paddlefish `0`, Egniol `8`.
- Changing any loadout field, refreshing, and reopening the page restores the same values.
- Missing or malformed `cg-sim-loadout` data falls back cleanly to defaults.
- Hunlef visibly plays idle during countdown before the fight starts.
- `npm test` and `npm run build` pass.

## Risks

- Restored state can conflict with dynamic secondary-weapon filtering if normalization is not applied after primary weapon restore.
- Saving numeric fields on every input needs careful parse rules so temporary empty strings do not overwrite good state with `NaN`.
- The idle fix touches startup state in `AnimationController`; if done carelessly it could affect first attack/death transitions.

## Open Questions

- Should over-cap inventory values be clamped when restored, or restored verbatim and left for the slot counter to flag? Recommendation: clamp to each field's min/max, not to total-slot legality.
- Do we want to persist on every numeric keystroke or only on `change` / blur? Recommendation: persist on `input` / `change` so refresh behavior is predictable.
