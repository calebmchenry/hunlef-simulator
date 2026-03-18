# Sprint 013 Intent: UI/UX Polish — Weapons, Floor, Camera

## Seed

Three user-reported UI/UX issues: (1) Selecting bow+staff in setup gives 3 weapons instead of 2. (2) Arena floor is too dark to see. (3) Camera isn't centered correctly during countdown.

## Context

### Bug 1: 3 weapons instead of 2
`Inventory.buildFromLoadout()` (Inventory.ts L44-70) adds BOTH the primary and secondary weapons to inventory slots 0 and 1. But the primary weapon is ALSO set as `loadout.weapon` (Loadout.ts L26) and displayed in the equipment panel. So the user sees: equipped weapon + primary in inventory + secondary in inventory = 3 visible weapons.

The weapon swap logic (GameSimulation.ts L601-617) swaps the equipped weapon into the clicked inventory slot. This means the primary weapon in slot 0 is redundant — it's already equipped. Only the secondary should be in inventory.

### Bug 2: Floor too dark
`Renderer3D.createFloor()` (L244-268) uses:
- Floor material: `0x1a0a0a` (near-black)
- Grid lines: `0x3a1a1a` (barely visible dark brown)
These are almost indistinguishable. Need brighter colors with more contrast.

### Bug 3: Camera not centered during countdown
`Renderer3D.draw()` (L426-427) sets camera target to `(0,0,0)` during countdown. But CameraController uses `target.lerp(desiredTarget, 0.1)` — smooth interpolation at 10% per frame. If player starts away from center, camera slowly drifts. Should snap to center during countdown, not lerp.

## Relevant Codebase Areas

| File | Role | Lines |
|------|------|-------|
| `src/entities/Inventory.ts` | buildFromLoadout — adds weapons to inventory | L44-70 |
| `src/equipment/Loadout.ts` | Loadout class — stores equipped weapon | L18-36 |
| `src/render/Renderer3D.ts` | Floor creation, camera target setting | L244-268, L426-431 |
| `src/render/CameraController.ts` | Camera orbit, lerp interpolation | L1-87 |

## Constraints

- Must keep all 185 cg-sim tests passing
- Must keep all 52 cg-sim-player tests passing
- Never modify cg-sim-player
- Floor color should evoke the Corrupted Gauntlet's reddish/dark theme while being visible
- Camera snap should not feel jarring when transitioning from countdown to running

## Success Criteria

1. Selecting bow+staff in setup results in exactly 2 weapons visible — one equipped, one in inventory
2. Arena floor and grid lines are clearly visible with good contrast
3. Camera is centered on the arena during countdown, not slowly drifting

## Verification Strategy

- `npm run build` passes
- `npm test` passes all 185 tests
- `cd ../cg-sim-player && npm test` — all 52 tests pass
- Visual verification in browser for all 3 issues

## Uncertainty Assessment

- **Correctness: Low** — three well-understood bugs with obvious fixes
- **Scope: Low** — bounded to specific files and functions
- **Architecture: Low** — extends existing patterns, no new modules

## Open Questions

1. What floor color should we use? Should it reference the actual Corrupted Gauntlet floor texture/color scheme?
2. Should the camera snap instantly to center during countdown, or use a faster lerp?
3. When transitioning from countdown to running, should the camera snap to the player or smooth-lerp?
