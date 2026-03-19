# Sprint 023 Intent: UI Defaults and Polish Fixes

## Seed Prompt

Cleanup sprint with 5 targeted fixes:
1. Default armor tier on loadout screen → Tier 1 (currently T3)
2. Default 2nd weapon → T3 Bow (currently None)
3. Persist loadout preferences across refreshes via localStorage
4. Hunlef plays idle animation during countdown (currently static)
5. Default food → all normal paddlefish, no corrupted paddlefish (currently 12 paddle + 4 corrupted)

## Orientation Summary

- Defaults are hardcoded in `LoadoutScreen.ts` build() method as HTML `selected` attributes and input `value` attributes
- No localStorage exists anywhere in the project — needs to be added fresh
- `updateBossAnimations()` in Renderer3D only triggers on game events; during countdown there are no events so the boss just sits in whatever initial pose the GLTF loaded with
- `AnimationController` constructor calls `playIdle()` at construction time, but the mixer needs `update(0)` to apply the first frame

## Relevant Codebase Areas

- `src/render/LoadoutScreen.ts` — HTML template with default values (lines 38-114), `getConfig()` reads form values
- `src/render/Renderer3D.ts` — `updateBossAnimations()` (line ~918), countdown handling
- `src/render/AnimationController.ts` — constructor calls `playIdle()`, `update()` method
- `src/equipment/Loadout.ts` — `LoadoutConfig` interface
- `src/equipment/items.ts` — armor/weapon definitions

## Constraints

1. No new npm dependencies
2. Don't touch cg-sim-player
3. localStorage key should be namespaced (e.g., `cg-sim-loadout`)
4. Gracefully handle corrupted/missing localStorage data (fall back to defaults)

## Success Criteria

1. Fresh page load shows: Armor=T1, Weapon=Staff T3, 2nd Weapon=Bow T3, Paddlefish=20, C.Paddlefish=0, Egniol=8
2. Changing any loadout option and refreshing preserves the selection
3. Boss plays idle animation during countdown (visible breathing/swaying)
4. All 193 tests pass
5. Build succeeds

## Uncertainty Assessment

| Factor | Level | Rationale |
|--------|-------|-----------|
| Correctness | Low | Simple default changes and localStorage get/set |
| Scope | Low | 5 well-defined tasks, all in 2-3 files |
| Architecture | Low | Extends existing patterns, no new abstractions |
