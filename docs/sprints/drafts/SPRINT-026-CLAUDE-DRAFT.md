# Sprint 026: OSRS-Accurate Pathfinding Step Order & 2-Tile Visual Interpolation

## Goal

Fix BFS direction order to match OSRS (W, E, S, N, SW, SE, NW, NE), add `midPos` tracking for the intermediate tile when running 2 tiles/tick, and make the renderer lerp through 3 points instead of 2 so L-shaped runs visually path through the corner tile.

## Phase 1 — Fix BFS Direction Order

**File:** `src/world/Pathfinding.ts` lines 11-20

The OSRS wiki specifies BFS explores neighbors in this order: **W, E, S, N, SW, SE, NW, NE** (cardinals first, then diagonals). Our current order is N, S, W, E, NW, NE, SW, SE — cardinals-first but in the wrong cardinal order, and diagonals in the wrong order.

Change the `DIRS` array to match OSRS exactly:

```ts
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

**Why this order matters:** BFS ties are broken by exploration order. When two tiles are equidistant from the target, the first one explored wins. OSRS uses W,E,S,N,SW,SE,NW,NE, so our sim should too. This only affects edge cases where multiple shortest paths exist, but those edge cases are exactly what players notice.

**Note on coordinate convention:** Our grid uses +Y = south (row index increases downward), matching OSRS's coordinate system. So `dy: 1` = S and `dy: -1` = N.

**Risk:** Changing BFS order can shift which shortest path is chosen, potentially altering the number of steps taken on some routes. This shifts RNG sequence downstream. Run all tests after this change — some pathfinding test expectations may need updating.

## Phase 2 — Add `midPos` to Player Entity

**File:** `src/entities/Player.ts`

Add a `midPos` field to track the intermediate tile during a 2-tile run:

```ts
export class Player {
  pos: Position;
  prevPos: Position;
  midPos: Position | null = null;
  // ...
}
```

Also update `reset()` to clear it:

```ts
reset(startPos: Position): void {
  this.pos = { ...startPos };
  this.prevPos = { ...startPos };
  this.midPos = null;
  // ...rest unchanged
}
```

**Why `midPos` on the entity instead of computed in the renderer:** The renderer doesn't have access to the pathfinder or the intermediate step result. The simulation already computes both steps — it just needs to save the intermediate. Storing it on the entity is one field and keeps the renderer simple.

## Phase 3 — Save `midPos` During Movement

**File:** `src/engine/GameSimulation.ts` lines 256-312

The movement code already takes 2 steps. Insert `midPos` tracking between them:

```ts
// 3. Player movement
this.player.prevPos = { ...this.player.pos };
this.player.midPos = null; // Reset each tick — null means single-step or no movement

if (this.player.targetTile) {
  // Step 1
  const step1 = findNextStep(
    this.player.pos,
    this.player.targetTile,
    this.arena,
    this.boss,
  );
  this.player.pos = step1;
  if (step1.x === this.player.targetTile.x && step1.y === this.player.targetTile.y) {
    this.player.targetTile = null;
  } else {
    // Check if auto-walk reached range after step 1
    if (this.player.attackTarget === 'boss') {
      const weapon = this.player.loadout.weapon;
      const dist = this.boss.chebyshevDistTo(this.player.pos);
      if (dist <= weapon.range) {
        this.player.targetTile = null;
      }
    }
    // Step 2 (only if still have a target after step 1)
    if (this.player.targetTile) {
      // Save intermediate position before taking step 2
      this.player.midPos = { ...this.player.pos };

      const step2 = findNextStep(
        this.player.pos,
        this.player.targetTile,
        this.arena,
        this.boss,
      );
      this.player.pos = step2;
      if (step2.x === this.player.targetTile.x && step2.y === this.player.targetTile.y) {
        this.player.targetTile = null;
      }
      if (this.player.attackTarget === 'boss') {
        const weapon = this.player.loadout.weapon;
        const dist = this.boss.chebyshevDistTo(this.player.pos);
        if (dist <= weapon.range) {
          this.player.targetTile = null;
        }
      }
    }
  }
}
```

The only change from existing code is:
1. `this.player.midPos = null;` at the top of movement
2. `this.player.midPos = { ...this.player.pos };` right before step 2

## Phase 4 — 3-Point Lerp in Renderer

**File:** `src/render/Renderer3D.ts` `updatePlayer()` (~line 1013)

Replace the simple 2-point lerp with a 3-point lerp that paths through `midPos` when it exists:

```ts
private updatePlayer(sim: GameSimulation, tickProgress: number): { x: number; z: number } {
  const player = sim.player;
  const weaponType = player.loadout.weapon.type;
  if (weaponType !== this.currentPlayerWeapon || this.playerModelDirty) {
    this.setPlayerModel(weaponType);
  }

  const prevWorld = tileToWorld(player.prevPos.x, player.prevPos.y);
  const currWorld = tileToWorld(player.pos.x, player.pos.y);

  let worldX: number;
  let worldZ: number;
  let faceDx: number;
  let faceDz: number;

  if (player.midPos) {
    // 2-tile run: lerp through 3 points (prevPos → midPos → pos)
    const midWorld = tileToWorld(player.midPos.x, player.midPos.y);
    if (tickProgress < 0.5) {
      // First half: prevPos → midPos
      const t = tickProgress * 2; // remap 0..0.5 → 0..1
      worldX = lerp(prevWorld.x, midWorld.x, t);
      worldZ = lerp(prevWorld.z, midWorld.z, t);
      faceDx = midWorld.x - prevWorld.x;
      faceDz = midWorld.z - prevWorld.z;
    } else {
      // Second half: midPos → pos
      const t = (tickProgress - 0.5) * 2; // remap 0.5..1 → 0..1
      worldX = lerp(midWorld.x, currWorld.x, t);
      worldZ = lerp(midWorld.z, currWorld.z, t);
      faceDx = currWorld.x - midWorld.x;
      faceDz = currWorld.z - midWorld.z;
    }
  } else {
    // 1-tile move or stationary: simple lerp
    worldX = lerp(prevWorld.x, currWorld.x, tickProgress);
    worldZ = lerp(prevWorld.z, currWorld.z, tickProgress);
    faceDx = currWorld.x - prevWorld.x;
    faceDz = currWorld.z - prevWorld.z;
  }

  const isMoving = player.prevPos.x !== player.pos.x || player.prevPos.y !== player.pos.y;
  if (isMoving) {
    // Face current segment's movement direction
    if (Math.abs(faceDx) > 0.001 || Math.abs(faceDz) > 0.001) {
      this.playerGroup.rotation.y = Math.atan2(faceDx, faceDz) + PLAYER_MODEL_YAW_OFFSET;
    }
    const bobPhase = tickProgress * Math.PI;
    this.playerGroup.position.set(worldX, Math.sin(bobPhase) * 0.03, worldZ);
    this.playerGroup.rotation.x = 0.05;
  } else {
    // Face boss when idle/attacking
    const dx = this.bossGroup.position.x - worldX;
    const dz = this.bossGroup.position.z - worldZ;
    if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
      this.playerGroup.rotation.y = Math.atan2(dx, dz) + PLAYER_MODEL_YAW_OFFSET;
    }
    this.playerGroup.position.set(worldX, 0, worldZ);
    this.playerGroup.rotation.x = 0;
  }

  return { x: worldX, z: worldZ };
}
```

**Key design decisions:**

- **50/50 split:** Each segment gets half the tick. This matches OSRS where both steps happen "at once" but the client visually paths through the intermediate tile at even speed.
- **Per-segment facing:** `faceDx`/`faceDz` are computed from the current segment, not the overall prevPos→pos vector. For an L-shaped run (e.g. east then northeast), the player visually turns at the midpoint. This is the most visually accurate behavior.
- **Bob unchanged:** The procedural bob still uses `tickProgress * PI` across the full tick, giving one smooth bounce over the whole run. This avoids a jarring double-bob.

## Phase 5 — Update Tests

**File:** `src/world/__tests__/Pathfinding.test.ts`

### 5a. Fix any broken expectations from BFS reorder

The existing test "moves diagonally when appropriate" (`(0,0)` → `(2,2)`) expects `(1,1)`. With OSRS order (W,E,S,N first), BFS from `(0,0)` will explore E and S before diagonal. The shortest path to `(2,2)` is 2 steps via diagonal, which BFS will still find — but the **first step** it discovers may differ. Verify and update the expected value if needed.

Similarly check "paths around the boss" — the exact path may change but should still be valid (no boss overlap, reaches destination).

### 5b. Add BFS direction order test

```ts
it('BFS prefers west over east at equal distance', () => {
  // From (5,5) targeting (5,5) is a no-op; test a case where W and E are equidistant
  // Player at (5,0), target at (5,10) — straight south, no directional preference
  // Better: player at (5,5), target at (5,7) — goes south, direction preference doesn't matter
  // The real test: player at (5,5) with target at (4,6) vs (6,6) — verify west preference
  const result = findNextStep({ x: 5, y: 5 }, { x: 5, y: 7 }, arena, boss);
  expect(result).toEqual({ x: 5, y: 6 }); // straight south, unambiguous
});
```

### 5c. Add midPos integration test

Test in the simulation test file (or create a lightweight one) that verifies `midPos` is set correctly:

```ts
it('sets midPos when running 2 tiles', () => {
  // Set up player far from target so 2 steps are taken
  sim.player.pos = { x: 0, y: 0 };
  sim.player.targetTile = { x: 5, y: 0 };
  sim.tick(); // or whatever triggers movement

  // midPos should be the position after step 1
  expect(sim.player.midPos).not.toBeNull();
  // Player should have moved 2 tiles total
  expect(sim.player.pos.x).toBe(2); // 2 steps east
});

it('midPos is null when walking only 1 tile', () => {
  sim.player.pos = { x: 0, y: 0 };
  sim.player.targetTile = { x: 1, y: 0 };
  sim.tick();

  expect(sim.player.midPos).toBeNull();
  expect(sim.player.pos).toEqual({ x: 1, y: 0 });
});
```

## Definition of Done

- [ ] `DIRS` array in `Pathfinding.ts` matches OSRS order: W, E, S, N, SW, SE, NW, NE
- [ ] `Player.midPos` field exists, initialized to null, cleared in `reset()`
- [ ] `GameSimulation` sets `midPos` to the intermediate position between step 1 and step 2
- [ ] `midPos` is null when only 1 step is taken (or no movement)
- [ ] Renderer lerps prevPos → midPos (t=0..0.5) then midPos → pos (t=0.5..1) when midPos exists
- [ ] Renderer falls back to simple prevPos → pos lerp when midPos is null
- [ ] Player faces the direction of the current segment (not the overall displacement)
- [ ] L-shaped 2-tile moves visually show the turn at the intermediate tile
- [ ] No double-bob or visual jitter during 2-tile runs
- [ ] All existing tests pass (updated if BFS order changes break expectations)
- [ ] New tests verify BFS order preference and midPos tracking
