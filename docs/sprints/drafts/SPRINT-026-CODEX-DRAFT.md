# Sprint 026: OSRS-Accurate Step Order and Run Mid-Tile Interpolation

## Overview

This sprint fixes two related movement issues.

First, `findNextStep()` currently conflates route selection with the actual one-tile movement rule. The OSRS-style route search should use BFS with direction priority `W, E, S, N, SW, SE, NW, NE`, but the tile-by-tile movement toward the next checkpoint should use follow-mode ordering: consume diagonal distance first, then finish cardinal distance. In practice, a move from `(0,0)` to `(2,1)` should step `(1,1)` first, not `(1,0)`.

Second, running currently stores only `prevPos` and `pos`, so the renderer lerps straight from the tick start tile to the tick end tile. That makes 2-tile moves cut directly across the chord instead of visibly traversing the first tile reached that tick. Add a `midPos` tile and make `Renderer3D.updatePlayer()` interpolate through `prevPos -> midPos -> pos` inside a single tick.

## Implementation

### 1. Pathfinding: split route search from the step rule

**Files:**
- `src/world/Pathfinding.ts`
- `src/world/__tests__/Pathfinding.test.ts`

Keep BFS for route discovery and obstacle avoidance, including the existing diagonal corner-cut guard. Change the neighbour order to the OSRS priority:

```ts
const DIRS = [
  { dx: -1, dy: 0 }, // W
  { dx: 1, dy: 0 },  // E
  { dx: 0, dy: 1 },  // S
  { dx: 0, dy: -1 }, // N
  { dx: -1, dy: 1 }, // SW
  { dx: 1, dy: 1 },  // SE
  { dx: -1, dy: -1 }, // NW
  { dx: 1, dy: -1 },  // NE
];
```

`findNextStep()` should stop returning the first edge of the BFS path directly. Instead:

1. Run BFS to the chosen walkable target.
2. Reconstruct the shortest path.
3. Reduce that path to checkpoint tiles.
4. Take the first checkpoint and advance one tile with a dedicated step helper.

The exact step helper should be:

```ts
function stepTowardCheckpoint(
  from: Position,
  checkpoint: Position,
  arena: Arena,
  boss: Boss,
): Position {
  const dx = Math.sign(checkpoint.x - from.x);
  const dy = Math.sign(checkpoint.y - from.y);

  // OSRS follow-mode: diagonal first, cardinal only after one axis is aligned.
  if (dx !== 0 && dy !== 0) {
    const diagX = from.x + dx;
    const diagY = from.y + dy;
    if (
      arena.isWalkable(diagX, diagY, boss) &&
      arena.isWalkable(from.x + dx, from.y, boss) &&
      arena.isWalkable(from.x, from.y + dy, boss)
    ) {
      return { x: diagX, y: diagY };
    }
  }

  if (dx !== 0 && arena.isWalkable(from.x + dx, from.y, boss)) {
    return { x: from.x + dx, y: from.y };
  }

  if (dy !== 0 && arena.isWalkable(from.x, from.y + dy, boss)) {
    return { x: from.x, y: from.y + dy };
  }

  return from;
}
```

That helper is the behavioural change this sprint needs. BFS tie-break order decides which route and which checkpoint chain is chosen around the boss; `stepTowardCheckpoint()` decides the per-tile order within the current segment. For an open-field `2x1` or `1x2` move, the first step must be diagonal. For example:

```ts
// (0,0) -> (2,1)
step 1: (1,1)
step 2: (2,1)
```

Add tests that pin this down explicitly. The existing suite covers “can move diagonally” but not the ordering difference between `E -> SE` and `SE -> E`.

### 2. Simulation state: add `midPos`

**Files:**
- `src/entities/Player.ts`
- `src/engine/GameSimulation.ts`

Add a nullable intermediate tile to the player:

```ts
midPos: Position | null;
```

Initialize and reset it to `null` in the constructor and `reset()`.

In the movement section of `GameSimulation.processTick()`:

1. Save `prevPos` exactly once at tick start.
2. Clear `midPos` to `null` before any movement.
3. Run step 1 exactly as today.
4. If a distinct second step is actually taken, set `midPos` to the tile reached after step 1.

The important rule is that `midPos` is not “halfway between tiles”; it is the real first tile traversed during the current tick. If the player moved only 0 or 1 tile this tick, `midPos` stays `null`.

Concrete shape:

```ts
this.player.prevPos = { ...this.player.pos };
this.player.midPos = null;

// step 1
const step1 = findNextStep(this.player.pos, this.player.targetTile, this.arena, this.boss);
this.player.pos = step1;

// range / arrival checks stay in the same places as today

// step 2
if (this.player.targetTile) {
  const step2 = findNextStep(this.player.pos, this.player.targetTile, this.arena, this.boss);
  if (step2.x !== step1.x || step2.y !== step1.y) {
    this.player.midPos = { ...step1 };
  }
  this.player.pos = step2;
}
```

This preserves the current movement logic and auto-walk/range clearing, while giving the renderer enough information to show the real 2-tile route.

### 3. Renderer: lerp through 3 points in one tick

**File:**
- `src/render/Renderer3D.ts`

`updatePlayer()` should treat the player path for the current tick as:

- `prevPos` = tick start
- `midPos` = first tile reached this tick, or `null`
- `pos` = tick end

If `midPos` is `null`, keep the current 2-point lerp. If `midPos` is present, do a piecewise interpolation with two equal subsegments inside the same tick:

```ts
const prevWorld = tileToWorld(player.prevPos.x, player.prevPos.y);
const midWorld = player.midPos ? tileToWorld(player.midPos.x, player.midPos.y) : null;
const currWorld = tileToWorld(player.pos.x, player.pos.y);

let worldX: number;
let worldZ: number;
let segStart: THREE.Vector3;
let segEnd: THREE.Vector3;

if (!midWorld) {
  worldX = lerp(prevWorld.x, currWorld.x, tickProgress);
  worldZ = lerp(prevWorld.z, currWorld.z, tickProgress);
  segStart = prevWorld;
  segEnd = currWorld;
} else if (tickProgress < 0.5) {
  const localT = tickProgress * 2;
  worldX = lerp(prevWorld.x, midWorld.x, localT);
  worldZ = lerp(prevWorld.z, midWorld.z, localT);
  segStart = prevWorld;
  segEnd = midWorld;
} else {
  const localT = (tickProgress - 0.5) * 2;
  worldX = lerp(midWorld.x, currWorld.x, localT);
  worldZ = lerp(midWorld.z, currWorld.z, localT);
  segStart = midWorld;
  segEnd = currWorld;
}
```

Use `segStart -> segEnd` for movement-facing and bobbing, not `prevWorld -> currWorld`. That way an L-shaped run visually turns at the intermediate tile instead of facing the overall chord for the whole tick.

Example:

```ts
prevPos = (0,0)
midPos  = (1,1)
pos     = (2,1)
```

- `tickProgress 0.00 -> 0.50`: lerp from `(0,0)` to `(1,1)`
- `tickProgress 0.50 -> 1.00`: lerp from `(1,1)` to `(2,1)`

This is the key visual fix. A 2-tile run should look like two consecutive tile traversals compressed into one game tick, not one straight-line teleport.

## Definition of Done

- `findNextStep()` uses BFS only for route selection and uses a diagonal-first step helper for the actual one-tile move.
- BFS neighbour order is `W, E, S, N, SW, SE, NW, NE`.
- Open-field `2x1` and `1x2` moves step diagonally first.
- `Player` stores `midPos: Position | null`, initialized and reset to `null`.
- Running 2 tiles in one tick records the real intermediate tile in `midPos`.
- `Renderer3D.updatePlayer()` interpolates `prevPos -> midPos -> pos` when `midPos` exists, and falls back to the existing 2-point lerp otherwise.
- L-shaped 2-tile runs visibly traverse segment 1 and then segment 2 within the same tick, with facing based on the active segment.
- Pathfinding tests cover the new step-order cases and existing boss-avoidance cases still pass.
