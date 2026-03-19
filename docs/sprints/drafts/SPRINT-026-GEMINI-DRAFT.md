# SPRINT-026: OSRS-Accurate Pathfinding and Movement Interpolation

## Objective
Implement OSRS-accurate pathfinding step order and visual interpolation through intermediate tiles when running.

## Implementation Details

### 1. Pathfinding Step Order (`src/world/Pathfinding.ts`)
The BFS algorithm must explore directions in the exact order specified by the OSRS wiki: W, E, S, N, SW, SE, NW, NE. This ensures that cardinal directions are checked before diagonal directions when pathfinding.
- Update the `DIRS` array in `findNextStep()` to:
  ```typescript
  const DIRS = [
    { dx: -1, dy: 0 },  // W
    { dx: 1, dy: 0 },   // E
    { dx: 0, dy: 1 },   // S
    { dx: 0, dy: -1 },  // N
    { dx: -1, dy: 1 },  // SW
    { dx: 1, dy: 1 },   // SE
    { dx: -1, dy: -1 }, // NW
    { dx: 1, dy: -1 },  // NE
  ];
  ```

### 2. Tracking Intermediate Steps (`src/engine/GameSimulation.ts`)
When the player runs (moves 2 tiles in a single tick), we need to track the intermediate tile to allow the renderer to follow the exact L-shaped path rather than a straight diagonal line.
- Update the `Player` entity types to include an optional `midPos: Position | null`.
- In `GameSimulation.ts` (lines 256-312), update the movement logic:
  - Initialize `this.player.midPos = null` at the start of the movement phase.
  - Execute Step 1: calculate `step1` and set `this.player.pos = step1`.
  - If Step 2 is to be executed (i.e., the player still has a target), first save the intermediate position as `midPos`: `this.player.midPos = { ...this.player.pos }`.
  - Execute Step 2: calculate `step2` and set `this.player.pos = step2`.

### 3. Visual 2-Tile Interpolation (`src/render/Renderer3D.ts`)
Update the visual interpolation logic in `updatePlayer()` to smoothly lerp through the three points (`prevPos`, `midPos`, `pos`) within a single tick.
- Retrieve the world coordinates for `prevPos`, `midPos` (if it exists), and `pos`.
- Use `tickProgress` (0.0 to 1.0) to interpolate:
  - If `midPos` is present:
    - For `tickProgress < 0.5`: lerp between `prevPos` and `midPos` using `t = tickProgress * 2`.
    - For `tickProgress >= 0.5`: lerp between `midPos` and `pos` using `t = (tickProgress - 0.5) * 2`.
  - If `midPos` is null:
    - lerp between `prevPos` and `pos` using `t = tickProgress` (existing behavior).
- Ensure player model rotation calculates `moveDx` and `moveDz` appropriately based on the current active segment being traversed (either `prev->mid` or `mid->pos`).

## Verification
- Run existing pathfinding tests to ensure they still pass, updating assertions if the RNG sequence changed due to the modified BFS direction order.
- Visually verify running 2 tiles in an L-shape accurately renders the model traversing the intermediate tile.