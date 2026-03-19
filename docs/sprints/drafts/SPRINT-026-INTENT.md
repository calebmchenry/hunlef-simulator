# Sprint 026 Intent: OSRS-Accurate Pathfinding and Visual Movement Interpolation

## Seed Prompt

Two fixes:
1. **Correct step order**: User reports that in OSRS, cardinal movement happens before diagonal. Need to verify against OSRS wiki which says follow-mode is "diagonal first then cardinal." Implement whichever is correct.
2. **Visual 2-tile interpolation**: When running (2 tiles/tick), the visual model should path through the intermediate tile, not lerp directly from start to end. For L-shaped moves, show cardinal step first then diagonal step within one tick.

## Research Findings

From the OSRS wiki (https://oldschool.runescape.wiki/w/Pathfinding):
- **BFS direction order**: W, E, S, N, SW, SE, NW, NE (cardinal directions checked first)
- **Follow-mode movement**: "naively paths diagonally to the end tile and then straight if there's no diagonals left" — diagonal steps are taken first, then cardinal
- **Running**: Player traverses 2 checkpoint tiles per tick
- **Checkpoints**: BFS extracts corners as checkpoint tiles

## Orientation Summary

- Current pathfinding (`Pathfinding.ts`): 8-directional BFS, DIRS array has cardinal first then diagonal. Returns single next step.
- Current movement (`GameSimulation.ts:256-312`): Saves `prevPos` once, takes up to 2 steps (findNextStep twice), updates `pos` after each step. Only `prevPos` and `pos` are tracked.
- Current visual (`Renderer3D.ts updatePlayer()`): Simple lerp from `prevPos` to `pos` using tickProgress. No intermediate tile tracking.
- Player entity: Only has `pos` and `prevPos` — no `midPos` for the intermediate step.
- 7 existing pathfinding tests cover basic cases but not cardinal/diagonal ordering.

## Relevant Code

- `src/world/Pathfinding.ts` — `findNextStep()`: BFS pathfinder, `DIRS` array defines direction order
- `src/engine/GameSimulation.ts` lines 256-312 — movement processing, 2-step running
- `src/render/Renderer3D.ts` `updatePlayer()` — visual lerp between prevPos and pos
- `src/entities/Player.ts` — pos, prevPos tracking
- `src/world/__tests__/Pathfinding.test.ts` — existing tests

## Constraints

1. Don't touch cg-sim-player
2. Pathfinding changes will shift RNG sequence if they change the number of steps taken — verify tests still pass
3. Keep it simple — the arena is 12x12 with a 5x5 boss, no complex terrain

## Success Criteria

1. Movement step order matches OSRS behavior (verify against wiki/research)
2. When running 2 tiles, visual model interpolates through the intermediate tile (not straight line)
3. L-shaped 2-tile moves visually show the first step then the second step within one tick
4. All existing pathfinding tests pass (or are updated if step order changes)
5. No new jittery or teleporting visual artifacts

## Uncertainty Assessment

| Factor | Level | Rationale |
|--------|-------|-----------|
| Correctness | Medium-High | OSRS wiki says diagonal-first for follow mode, user says cardinal-first. Need to clarify. |
| Scope | Low | Two specific changes in 3-4 files |
| Architecture | Low | Extends existing pathfinding and movement, adds midPos tracking |

## Open Questions

1. The user says "cardinal first before diagonal" but the OSRS wiki says follow-mode is "diagonal first then cardinal." Which is correct for this simulator?
2. Should the BFS pathfinder itself change, or just the step-by-step movement order?
3. For visual interpolation, should `midPos` be stored on the Player entity or just computed in the renderer?
