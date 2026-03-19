# Sprint 023: UI Defaults and Polish Fixes

## Overview
This sprint focuses on small cleanup tasks related to the loadout screen and boss animation. It updates the default loadout values, implements `localStorage` persistence for user preferences, and ensures the Corrupted Hunlef plays its idle animation immediately during the pre-fight countdown.

## Use Cases
- As a player, when I load the simulator, my default loadout should be more representative of a typical run (Tier 1 Armor, T3 Staff, T3 Bow, 20 Paddlefish, 0 Corrupted Paddlefish).
- As a player, my loadout preferences (including F-Keys) should be saved across page reloads so I don't have to reconfigure them every time.
- As a player, the Hunlef should appear alive (playing its idle animation) during the pre-fight countdown rather than standing static.

## Architecture
- **LocalStorage Persistence**: Added directly in `LoadoutScreen.ts`. A unique namespace key (`cg-sim-loadout`) will be used. Form values will be saved to `localStorage` when starting a fight or changing inputs, and read during initialization to hydrate the UI. Invalid or corrupted data will be caught and ignored, falling back to defaults.
- **Animation Mixer Initialization**: The `AnimationController` needs an initial tick (`update(0)`) after `playIdle()` is called to apply the first frame of the animation to the mesh before the game loop starts animating it with a non-zero delta time.

## Implementation
1. **Loadout Defaults (`src/render/LoadoutScreen.ts`)**:
   - Change `#armor-tier` selected value to `1`.
   - Change `#secondary-weapon-type` selected value to `bow`.
   - Change `#secondary-weapon-tier` selected value to `3`.
   - Change `#paddlefish-count` value to `20`.
   - Change `#corrupted-paddlefish-count` value to `0`.
2. **Persistence (`src/render/LoadoutScreen.ts`)**:
   - Add a `saveConfig` method that serializes the current form state to `localStorage.setItem('cg-sim-loadout', JSON.stringify(...))`.
   - Add a `loadConfig` method that parses `localStorage.getItem('cg-sim-loadout')` wrapped in a `try/catch` block.
   - Call `loadConfig` during `build()` to override the hardcoded HTML defaults if a saved state exists.
   - Call `saveConfig` in the `start-btn` click listener.
3. **Boss Idle Animation (`src/render/AnimationController.ts`)**:
   - In the `constructor`, after calling `this.playIdle()`, immediately call `this.mixer.update(0)` to ensure the first frame of the idle animation is applied before the render loop starts.

## Files Summary
- `src/render/LoadoutScreen.ts`: Update HTML template defaults, integrate `localStorage` saving and loading for form fields.
- `src/render/AnimationController.ts`: Add `this.mixer.update(0)` to the end of the constructor.

## Definition of Done
1. Fresh page load shows: Armor=T1, Weapon=Staff T3, 2nd Weapon=Bow T3, Paddlefish=20, C.Paddlefish=0, Egniol=8.
2. Changing any loadout option and refreshing the page preserves the selection.
3. The boss plays the idle animation (breathing/swaying) during the countdown instead of remaining static.
4. All tests pass (`npm run test`).
5. Build succeeds.

## Risks
- **Corrupt LocalStorage**: Users might have old or malformed data in `localStorage`. The deserialization logic must gracefully catch JSON parse errors and type mismatches, falling back to the default UI.

## Open Questions
- Should changes to inputs auto-save to `localStorage` immediately, or only when clicking "Start Fight"? (Implementation will save on "Start Fight" to ensure only valid, intended loadouts are stored).
