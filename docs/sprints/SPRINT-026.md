# Sprint 026: OSRS-Accurate Pathfinding Step Order and Visual 2-Tile Interpolation

## Overview

Two fixes to match OSRS movement behavior:
1. **Correct step order**: Implement OSRS "follow mode" naive pathfinding — diagonal first, then cardinal (confirmed from RuneLite `calculateNextTravellingPoint` source and OSRS wiki)
2. **Visual 2-tile interpolation**: When running, the visual model should path through the intermediate tile instead of lerping directly from start to end

## Research: OSRS Movement Algorithm

From RuneLite's `WorldArea.calculateNextTravellingPoint()` and the OSRS wiki:

**Single step toward target:**
1. Compute direction: `dx = signum(target.x - current.x)`, `dy = signum(target.y - current.y)`
2. **Try diagonal** first: if `dx != 0 && dy != 0`, try moving `(dx, dy)`. If passable, take that step.
3. **Try horizontal** (X): if diagonal fails or `dy == 0`, try moving `(dx, 0)`. If passable, take that step.
4. **Try vertical** (Y): if horizontal fails (and target is > 1 tile away), try `(0, dy)`. If passable, take that step.
5. If nothing works, stay put.

**BFS pathfinding** (for finding the overall route): explores W, E, S, N, SW, SE, NW, NE. This determines checkpoints. But **movement between checkpoints** uses the naive step algorithm above.

**Running**: 2 steps per tick. Each step uses the naive algorithm independently.

## Implementation

### Task 1: Replace BFS step with naive follow-mode step

**File:** `src/world/Pathfinding.ts`

Add a new function `naiveStep(from, target, arena, boss)` that implements the OSRS follow-mode step:

```ts
function naiveStep(from: Position, target: Position, arena: Arena, boss: Boss): Position {
  if (from.x === target.x && from.y === target.y) return from;

  const dx = Math.sign(target.x - from.x);
  const dy = Math.sign(target.y - from.y);

  // Try diagonal first
  if (dx !== 0 && dy !== 0) {
    const diag = { x: from.x + dx, y: from.y + dy };
    if (canMove(from, diag, arena, boss)) return diag;
  }

  // Try horizontal (X axis)
  if (dx !== 0) {
    const horiz = { x: from.x + dx, y: from.y };
    if (canMove(from, horiz, arena, boss)) return horiz;
  }

  // Try vertical (Y axis)
  if (dy !== 0) {
    const vert = { x: from.x, y: from.y + dy };
    if (canMove(from, vert, arena, boss)) return vert;
  }

  return from; // stuck
}
```

The `canMove(from, to, arena, boss)` helper checks:
- Target is within arena bounds
- Target is not occupied by boss
- For diagonal moves: neither cardinal neighbor is blocked (corner-cutting prevention)

Keep the existing BFS `findNextStep` for cases that need obstacle avoidance (pathfinding around the boss). For direct movement toward a visible target, use `naiveStep`.

**Decision**: For this simulator, the arena is simple (12x12, one 5x5 boss obstacle). The naive step is sufficient for most movement. Use BFS only when naive step gets stuck (can't make progress for 2+ ticks).

### Task 2: Add midPos tracking for 2-tile interpolation

**File:** `src/entities/Player.ts`

Add `midPos: Position | null` to the Player entity — the intermediate tile during a 2-tile running move.

**File:** `src/engine/GameSimulation.ts`

In the movement section:
1. Save `prevPos` as before
2. Take step 1, save result as `midPos`
3. Take step 2, save result as `pos`
4. If only 1 step was taken (player reached target or couldn't move further), set `midPos = null`

```ts
this.player.prevPos = { ...this.player.pos };
this.player.midPos = null;

const step1 = naiveStep(this.player.pos, targetTile, this.arena, this.boss);
this.player.pos = step1;

// Check if we should take a second step (running)
if (targetTile && step1.x !== this.player.prevPos.x || step1.y !== this.player.prevPos.y) {
  // ... range/target checks ...
  const step2 = naiveStep(this.player.pos, targetTile, this.arena, this.boss);
  if (step2.x !== step1.x || step2.y !== step1.y) {
    this.player.midPos = { ...step1 };
    this.player.pos = step2;
  }
}
```

### Task 3: Visual 3-point interpolation

**File:** `src/render/Renderer3D.ts` — `updatePlayer()`

When `midPos` is set, interpolate through 3 points instead of 2:
- `tickProgress` 0.0–0.5: lerp from `prevPos` to `midPos`
- `tickProgress` 0.5–1.0: lerp from `midPos` to `pos`

```ts
const player = sim.player;
let worldX: number, worldZ: number;

if (player.midPos) {
  // 3-point interpolation for 2-tile running
  const midWorld = tileToWorld(player.midPos.x, player.midPos.y);
  if (tickProgress < 0.5) {
    const t = tickProgress * 2; // 0 to 1 over first half
    worldX = lerp(prevWorld.x, midWorld.x, t);
    worldZ = lerp(prevWorld.z, midWorld.z, t);
  } else {
    const t = (tickProgress - 0.5) * 2; // 0 to 1 over second half
    worldX = lerp(midWorld.x, currWorld.x, t);
    worldZ = lerp(midWorld.z, currWorld.z, t);
  }
} else {
  // Standard 2-point interpolation
  worldX = lerp(prevWorld.x, currWorld.x, tickProgress);
  worldZ = lerp(prevWorld.z, currWorld.z, tickProgress);
}
```

Also update the movement direction facing to use the current interpolation segment (prevPos→midPos or midPos→pos) rather than prevPos→pos.

## Files Summary

| File | Change |
|------|--------|
| `src/world/Pathfinding.ts` | Add `naiveStep()` function implementing OSRS follow-mode (diagonal first, then X, then Y) |
| `src/entities/Player.ts` | Add `midPos: Position \| null` for intermediate tile tracking |
| `src/engine/GameSimulation.ts` | Update movement to use `naiveStep()`, populate `midPos` for 2-tile runs |
| `src/render/Renderer3D.ts` | 3-point interpolation in `updatePlayer()` when `midPos` is set |
| `src/world/__tests__/Pathfinding.test.ts` | Add tests for naive step: diagonal preference, fallback to cardinal, corner-cutting prevention |

## Definition of Done

- [ ] Naive step function implements diagonal-first, then X, then Y (matching OSRS)
- [ ] 2-tile running moves populate `midPos` with the intermediate tile
- [ ] Visual model interpolates through `midPos` (not straight line from start to end)
- [ ] L-shaped 2-tile moves visually show the diagonal step then the cardinal step (or vice versa) within one tick
- [ ] Player faces the correct direction for each segment of the interpolation
- [ ] All existing pathfinding tests pass (update if step order changed)
- [ ] New tests cover naive step direction priority
- [ ] `npm test` passes, `npm run build` succeeds

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Naive step gets stuck on boss corners | Medium | Fall back to BFS when naive step can't make progress |
| midPos changes affect game logic (RNG, combat timing) | Low | midPos is visual only; pos updates happen the same way |
| 3-point interpolation looks jerky at the midpoint | Low | Use smooth easing or ensure consistent speed |
