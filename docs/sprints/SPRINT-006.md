# Sprint 006: Smooth Rendering + 2-Tile Running Movement

## Overview

Two focused fixes: decouple rendering from the tick loop so projectiles (and entity movement) animate smoothly at 60fps, and change player movement from 1 tile/tick to 2 tiles/tick (OSRS running speed).

**Problem 1**: Currently the renderer draws once per 600ms tick via `setInterval`. Projectiles that travel 1-2 ticks appear to teleport between positions. The fix: add a `requestAnimationFrame` render loop that runs at ~60fps, interpolating positions between ticks using a `tickProgress` fraction (0.0 to 1.0).

**Problem 2**: Player moves 1 tile per tick (walking speed). In the Corrupted Gauntlet, players always run (2 tiles per tick). The fix: call `findNextStep()` twice per tick in the movement step.

**What ships:** Smooth 60fps projectile animations. Smooth player movement between tiles. Player covers 2 tiles per tick.

**What's deferred:** Run energy drain, walk/run toggle, smooth boss movement interpolation (boss doesn't move currently), entity sprite animation.

---

## Use Cases

1. **UC-1: Smooth projectiles** — When boss fires a ranged attack, the green crystal spike glides smoothly from boss to player over 1-2 ticks at 60fps, not teleporting once per 600ms.
2. **UC-2: Smooth player movement** — When player clicks a tile, the cyan rectangle slides smoothly toward the destination at 60fps, covering 2 tiles per tick.
3. **UC-3: 2-tile running** — Player covers 2 tiles per game tick instead of 1. At 12x12 arena, player can cross the arena in 6 ticks (3.6s) instead of 12 ticks.
4. **UC-4: Game logic unchanged** — Tick processing still happens every 600ms. Only rendering is decoupled. All combat formulas, prayer drain, damage resolution remain tick-based.

---

## Architecture

### Render Loop Decoupling

**Current:**
```
setInterval(600ms):
  sim.processTick()
  renderer.draw(sim)      ← draws once per tick
  hud.update(sim)
```

**New:**
```
setInterval(600ms):
  sim.processTick()
  hud.update(sim)          ← DOM updates stay per-tick

requestAnimationFrame loop (~60fps):
  tickProgress = timeSinceLastTick / 600
  renderer.draw(sim, tickProgress)   ← interpolates positions
```

`tickProgress` is a float 0.0–1.0 representing how far we are between the last tick and the next. At tickProgress=0.0, entities are at their tick-start positions. At tickProgress=1.0, they're at their tick-end positions (which becomes the next tick-start).

### Interpolation Strategy

**Projectiles** (already have startX/Y, endX/Y, fireTick, arrivalTick):
```typescript
// Total progress across full travel
const totalDuration = proj.arrivalTick - proj.fireTick;
const ticksElapsed = sim.tick - proj.fireTick;
const progress = (ticksElapsed + tickProgress) / Math.max(1, totalDuration);
const x = proj.startX + (proj.endX - proj.startX) * clamp(progress, 0, 1);
const y = proj.startY + (proj.endY - proj.startY) * clamp(progress, 0, 1);
```

**Player movement** (need to track previous position):
```typescript
// Player stores prevPos (position at start of current tick)
const x = lerp(player.prevPos.x, player.pos.x, tickProgress) * TILE_SIZE;
const y = lerp(player.prevPos.y, player.pos.y, tickProgress) * TILE_SIZE;
```

### 2-Tile Movement

In `GameSimulation.processTick()` movement step, call `findNextStep()` **twice**:
```typescript
// Step 1
const step1 = findNextStep(player.pos, player.targetTile, arena, boss);
player.pos = step1;
// Check if arrived
if (arrived) { player.targetTile = null; return; }
// Step 2
const step2 = findNextStep(player.pos, player.targetTile, arena, boss);
player.pos = step2;
if (arrived) { player.targetTile = null; }
```

---

## Implementation

### Phase 1: Track Previous Positions (~10% effort)

**Files:**
- `src/entities/Player.ts` — Modify
- `src/engine/GameSimulation.ts` — Modify

**Tasks:**
- [ ] Add `prevPos: Position` to Player (position at start of tick, before movement)
- [ ] At the start of movement processing in `processTick()`, save `player.prevPos = { ...player.pos }`
- [ ] This gives the renderer two positions to interpolate between

### Phase 2: requestAnimationFrame Render Loop (~30% effort)

**Files:**
- `src/main.ts` — Modify
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] In `main.ts`, add a `requestAnimationFrame` loop separate from the tick interval:
  ```typescript
  let lastTickTime = performance.now();

  engine = new TickEngine((_tick: number) => {
    lastTickTime = performance.now();
    sim.processTick();
    hud.update(sim);
    sidePanel.update(sim);
    // Check game over
  });

  function renderLoop() {
    if (!sim || !renderer) return;
    const elapsed = performance.now() - lastTickTime;
    const tickProgress = Math.min(elapsed / 600, 1.0);
    renderer.draw(sim, tickProgress);
    if (engine?.running || sim.state === 'countdown') {
      requestAnimationFrame(renderLoop);
    }
  }
  requestAnimationFrame(renderLoop);
  ```
- [ ] Update `Renderer.draw()` signature to accept `tickProgress: number` parameter (default 0 for backward compatibility with tests)
- [ ] Remove `renderer.draw(sim)` from the tick callback — rendering is now in the rAF loop

### Phase 3: Smooth Projectile Rendering (~25% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Update `drawProjectiles()` to use sub-tick interpolation:
  ```typescript
  drawProjectiles(sim: GameSimulation, tickProgress: number) {
    for (const proj of sim.projectiles) {
      const totalDuration = proj.arrivalTick - proj.fireTick;
      const ticksElapsed = sim.tick - proj.fireTick;
      const progress = clamp((ticksElapsed + tickProgress) / Math.max(1, totalDuration), 0, 1);
      const x = proj.startX + (proj.endX - proj.startX) * progress;
      const y = proj.startY + (proj.endY - proj.startY) * progress;
      // Draw shape at (x, y) — same shape code as before
    }
  }
  ```
- [ ] Projectiles now glide smoothly at 60fps instead of jumping once per tick

### Phase 4: Smooth Player Movement Rendering (~15% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Update player drawing to interpolate between `prevPos` and `pos`:
  ```typescript
  const px = lerp(player.prevPos.x, player.pos.x, tickProgress) * TILE_SIZE;
  const py = lerp(player.prevPos.y, player.pos.y, tickProgress) * TILE_SIZE;
  ```
- [ ] Also interpolate the player overhead prayer icon position
- [ ] Target tile indicator stays at the target (no interpolation needed)
- [ ] Add `lerp` helper: `function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }`

### Phase 5: 2-Tile Running Movement (~10% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/world/__tests__/Pathfinding.test.ts` — Modify

**Tasks:**
- [ ] In the movement step of `processTick()`, call `findNextStep()` twice per tick:
  ```typescript
  // Save prev position for interpolation
  this.player.prevPos = { ...this.player.pos };

  if (this.player.targetTile) {
    // Step 1
    const step1 = findNextStep(this.player.pos, this.player.targetTile, this.arena, this.boss);
    this.player.pos = step1;
    if (step1.x === this.player.targetTile.x && step1.y === this.player.targetTile.y) {
      this.player.targetTile = null;
    } else {
      // Step 2
      const step2 = findNextStep(this.player.pos, this.player.targetTile, this.arena, this.boss);
      this.player.pos = step2;
      if (step2.x === this.player.targetTile.x && step2.y === this.player.targetTile.y) {
        this.player.targetTile = null;
      }
    }
  }
  ```
- [ ] Same for auto-walk toward boss (when attackTarget set and out of range)
- [ ] Update pathfinding tests: player at (0,0) targeting (4,0) now arrives in 2 ticks (2 tiles/tick) not 4
- [ ] Update any integration tests that depend on movement timing

### Phase 6: Polish + Visual Verification (~10% effort)

**Tasks:**
- [ ] Hit splats: keep at entity's current position (no interpolation — they stick to the tile)
- [ ] Countdown overlay: no interpolation needed (static)
- [ ] Overhead icons: interpolate with player position
- [ ] Boss rendering: no interpolation needed (boss doesn't move currently)
- [ ] Handle edge case: when game is paused/ended, stop the rAF loop
- [ ] All 155 existing tests still pass
- [ ] agent-browser verification:
  - [ ] Projectiles glide smoothly (visible between screenshots taken rapidly)
  - [ ] Player movement is visibly faster (2 tiles/tick)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/Player.ts` | Modify | Add prevPos for interpolation |
| `src/main.ts` | Modify | Add requestAnimationFrame render loop, decouple from tick |
| `src/render/Renderer.ts` | Modify | Accept tickProgress, interpolate projectiles + player |
| `src/engine/GameSimulation.ts` | Modify | 2-tile movement, save prevPos |
| `src/world/__tests__/Pathfinding.test.ts` | Modify | Update for 2-tile movement |
| `src/__tests__/integration.test.ts` | Modify | Update movement timing expectations |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + updated tests
- [ ] Renderer runs at ~60fps via requestAnimationFrame (not once per 600ms tick)
- [ ] Projectiles glide smoothly from source to target (visible smooth motion, not teleporting)
- [ ] Player movement interpolates smoothly between tiles
- [ ] Player moves 2 tiles per tick (running speed)
- [ ] Game logic still advances every 600ms (tick rate unchanged)
- [ ] DOM updates (HUD, side panel) still happen per-tick (not per-frame)
- [ ] Countdown, hit splats, overhead icons render correctly
- [ ] All 155 Sprint 1-5 tests still pass
- [ ] No runtime dependencies added

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| rAF loop causes performance issues | Low | Low | We're drawing simple shapes on a 576x576 canvas. 60fps is trivial. |
| Interpolation looks jerky at tick boundaries | Medium | Low | Clamp tickProgress to 0-1. Entity snaps to exact tick position at progress=0. |
| 2-tile movement breaks pathfinding tests | High | Low | Systematic: update all distance/timing assertions. |
| Render loop continues after game ends | Medium | Medium | Check `engine.running` in rAF loop. Cancel on game over. |
| Player "overshoots" target with 2-step movement | Low | Low | Check arrival after each step. Stop if reached target on step 1. |

---

## Dependencies

None (unchanged). Zero runtime dependencies.
