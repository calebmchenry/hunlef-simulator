# Sprint 005: Projectile Animations — Crystal Spikes, Magic Orbs, Arrows

## Overview

Add visible projectile entities that travel from attacker to target on the game canvas. When the Hunlef or player attacks, damage is pre-rolled on the fire tick, a projectile spawns at the source, travels across the arena based on the OSRS distance-based travel time formula, and damage + hit splat appear when the projectile arrives. The Hunlef fires green crystal spikes (ranged) and purple magic orbs (magic). The player fires green arrows (bow), blue magic blasts (staff), and white slash arcs (halberd, instant/melee).

**Key mechanic**: Damage is calculated at fire time but **applied on arrival**. Projectile travel time follows the OSRS formula based on Chebyshev distance. This means prayer switching has a window after seeing the projectile — faithful to real OSRS timing.

**What ships:** Visible projectiles for all attack types. Distance-based travel time matching OSRS formulas. Damage deferred to arrival tick. Canvas rendering of projectile shapes (crystal shards, orbs, arrows, slash arcs).

**What's deferred:** Sprite-based projectile images (using simple canvas shapes for now), projectile particle trails, sound effects on impact, prayer-disable visual distinction.

---

## Use Cases

1. **UC-1: Hunlef ranged attack** — Boss fires. A green crystal spike projectile appears at boss center and travels toward the player. Travel time = `1 + floor((3 + distance) / 6)` ticks. On arrival, damage applies and hit splat appears on player.
2. **UC-2: Hunlef magic attack** — Boss fires. A purple magic orb appears at boss center and travels toward player. Travel time = `1 + floor((1 + distance) / 3)` ticks. Damage on arrival.
3. **UC-3: Player bow attack** — Player fires arrow. Green arrow projectile travels from player to boss center. Same ranged formula. Damage on arrival.
4. **UC-4: Player staff attack** — Player fires magic blast. Blue/cyan orb travels from player to boss. Magic formula. Damage on arrival.
5. **UC-5: Player halberd attack** — Melee. White slash arc appears near the boss. **0 tick travel time** — damage applies immediately (same tick). Visual arc displays for 1 tick.
6. **UC-6: Prayer switching window** — Player sees a ranged projectile from boss. Has travel-time ticks to switch prayer before damage arrives.

---

## Architecture

### OSRS Projectile Travel Time Formulas

```typescript
/** Ranged (bows/crossbows/crystal spikes): hit delay in ticks */
function rangedHitDelay(distance: number): number {
  return 1 + Math.floor((3 + distance) / 6);
}

/** Magic (spells/orbs): hit delay in ticks */
function magicHitDelay(distance: number): number {
  return 1 + Math.floor((1 + distance) / 3);
}

/** Melee: always 0 ticks (instant) */
function meleeHitDelay(): number {
  return 0;
}
```

**Distance lookup table (typical arena distances 1-10):**

| Distance | Ranged delay | Magic delay |
|----------|-------------|-------------|
| 1 | 1 tick | 1 tick |
| 2 | 1 tick | 2 ticks |
| 3 | 2 ticks | 2 ticks |
| 4 | 2 ticks | 2 ticks |
| 5 | 2 ticks | 3 ticks |
| 6 | 2 ticks | 3 ticks |
| 7 | 2 ticks | 3 ticks |
| 8 | 2 ticks | 4 ticks |
| 9 | 3 ticks | 4 ticks |
| 10 | 3 ticks | 4 ticks |

### Projectile Entity

```typescript
interface Projectile {
  // Identity
  source: 'boss' | 'player';
  style: 'ranged' | 'magic' | 'melee';

  // Positions (pixel coordinates for smooth rendering)
  startX: number;  startY: number;   // source pixel position
  endX: number;    endY: number;     // target pixel position

  // Timing
  fireTick: number;       // tick when projectile was created
  arrivalTick: number;    // tick when projectile arrives (fireTick + hitDelay)

  // Pre-rolled damage
  damage: number;         // calculated at fire time, applied at arrival
  blocked: boolean;       // true if boss protection blocked it (0 damage)

  // Visual
  color: string;          // projectile color
  shape: 'spike' | 'orb' | 'arrow' | 'slash';
}
```

### Tick Processing Changes

Current order:
```
1. Inputs → 2. Prayer drain → 3. Movement → 4. Boss AI → 5. Boss damage → 6. Player attack → 7. Stomp → 8. Death
```

New order:
```
1. Inputs → 2. Prayer drain → 3. Movement
4. Resolve arriving projectiles (apply damage, create hit splats)
5. Boss AI: fire attack → create projectile (damage pre-rolled, stored on projectile)
6. Player attack: fire attack → create projectile (damage pre-rolled)
7. Stomp → 8. Death → 9. Clean up expired projectiles
```

**Key change**: Damage resolution moves from the fire step to a separate resolve step that checks `projectile.arrivalTick === currentTick`.

### Canvas Rendering

Projectiles are drawn after entities, before hit splats. Each projectile interpolates its position based on progress:

```typescript
const progress = (currentTick - proj.fireTick) / (proj.arrivalTick - proj.fireTick);
const x = proj.startX + (proj.endX - proj.startX) * progress;
const y = proj.startY + (proj.endY - proj.startY) * progress;
```

For melee (0 travel time), the slash arc is drawn at the target position for 1 tick.

**Visual shapes:**
- **Crystal spike** (boss ranged): Green (#44cc44) diamond/angular polygon, ~12px, rotated toward target
- **Magic orb** (boss magic): Purple (#aa44cc) filled circle with slight glow, ~10px radius
- **Arrow** (player ranged): Green (#44cc44) line with triangular arrowhead, ~20px long, oriented toward target
- **Magic blast** (player magic): Cyan (#44ccff) filled circle, ~8px radius
- **Slash arc** (player melee): White (#ffffff) arc/crescent near boss, ~20px, displayed 1 tick

---

## Implementation

### Phase 1: Projectile Data Model + Travel Time (~20% effort)

**Files:**
- `src/entities/Projectile.ts` — New
- `src/entities/types.ts` — Modify (add ProjectileShape type)

**Tasks:**
- [ ] Define `Projectile` interface with all fields (source, style, positions, timing, damage, visual)
- [ ] Define `ProjectileShape` type: `'spike' | 'orb' | 'arrow' | 'slash'`
- [ ] Implement travel time functions:
  - `rangedHitDelay(distance: number): number` — `1 + floor((3 + distance) / 6)`
  - `magicHitDelay(distance: number): number` — `1 + floor((1 + distance) / 3)`
  - `meleeHitDelay(): number` — always 0
- [ ] Tests: verify travel time at distances 1-10 against the lookup table above

### Phase 2: Refactor GameSimulation — Deferred Damage (~30% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify

**Tasks:**
- [ ] Add `projectiles: Projectile[]` array to GameSimulation
- [ ] Add `resolveProjectiles()` method: iterate projectiles, if `arrivalTick === tick`, apply damage + create hit splat + remove projectile
- [ ] Refactor boss attack (step 5):
  - Pre-roll damage (same logic as before: check prayer, roll from RNG)
  - Create `Projectile` with source='boss', style=boss.currentStyle, positions, timing
  - Do NOT apply damage here — projectile carries it
  - Calculate distance (Chebyshev, boss center to player pos)
  - arrivalTick = tick + rangedHitDelay(dist) or magicHitDelay(dist)
- [ ] Refactor player attack (step 6):
  - Pre-roll damage (same logic: check boss protection, roll accuracy + damage)
  - Create `Projectile` with source='player', style based on weapon type
  - For melee (halberd): arrivalTick = fireTick (0 delay, instant)
  - For ranged/magic: use formula
  - Do NOT apply damage here
- [ ] Insert `resolveProjectiles()` as step 4 (before new attacks fire)
- [ ] Clean up projectiles past arrivalTick + 1 (buffer for rendering the arrival frame)
- [ ] **Critical**: Update existing tests. Many tests check HP after N ticks assuming instant damage. With 1-2 tick delay, they need adjustment. Add helper or run extra ticks.

### Phase 3: Canvas Projectile Rendering (~25% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Add `drawProjectiles(sim: GameSimulation)` method, called after entities, before hit splats
- [ ] For each active projectile, calculate interpolated position:
  ```
  progress = (sim.tick - proj.fireTick) / max(1, proj.arrivalTick - proj.fireTick)
  x = startX + (endX - startX) * clamp(progress, 0, 1)
  y = startY + (endY - startY) * clamp(progress, 0, 1)
  ```
- [ ] Draw based on shape:
  - **spike** (boss ranged): green diamond polygon, rotated to face travel direction
    ```
    ctx.fillStyle = '#44cc44';
    // Draw rotated diamond shape pointing toward target
    ```
  - **orb** (boss magic): purple filled circle with outer glow
    ```
    ctx.fillStyle = '#aa44cc';
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2); ctx.fill();
    // Subtle glow: larger semi-transparent circle behind
    ```
  - **arrow** (player ranged): green line with arrowhead pointing toward target
    ```
    // Line from (x - dx*10, y - dy*10) to (x, y) with triangular head
    ```
  - **blast** (player magic): cyan circle
    ```
    ctx.fillStyle = '#44ccff';
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
    ```
  - **slash** (player melee): white arc drawn at target position for 1 tick
    ```
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(targetX, targetY, 20, -Math.PI/4, Math.PI/4); ctx.stroke();
    ```

### Phase 4: Update Tests for Deferred Damage (~15% effort)

**Files:**
- `src/__tests__/integration.test.ts` — Modify
- `src/entities/__tests__/Boss.test.ts` — Modify
- `src/__tests__/projectile.test.ts` — New

**Tasks:**
- [ ] New projectile tests:
  - Projectile created on boss attack with correct arrivalTick
  - Projectile created on player attack with correct timing
  - Damage applies on arrivalTick, not fireTick
  - Hit splat appears on arrivalTick
  - Melee projectile (halberd) has 0 delay — damage same tick
  - Projectiles cleaned up after arrival
  - Distance-based timing: ranged at dist 5 = 2 ticks, magic at dist 5 = 3 ticks
- [ ] Update existing integration tests:
  - Tests that check damage after N ticks need to account for 1-2 tick delay
  - Use `runTicks(n + maxDelay)` or check HP after projectiles resolve
  - Determinism test: same seed still produces identical results (just delayed)
- [ ] Verify all 125 existing tests still pass (some may need tick count adjustments)

### Phase 5: Polish + Visual Verification (~10% effort)

**Files:**
- `src/render/Renderer.ts` — Polish
- `src/engine/GameSimulation.ts` — Edge cases

**Tasks:**
- [ ] Handle edge case: target moves after projectile fires — projectile still goes to original target position (OSRS behavior: projectiles track the target in real game, but for simplicity, use the position at fire time)
- [ ] Handle edge case: target dies before projectile arrives — projectile still renders but damage is a no-op
- [ ] Multiple projectiles in flight simultaneously render correctly (boss and player can both have projectiles traveling)
- [ ] Visual verification with agent-browser:
  - [ ] Screenshot showing boss projectile mid-flight
  - [ ] Screenshot showing player projectile mid-flight
  - [ ] Screenshot showing melee slash arc
  - [ ] Verify hit splats appear at arrival, not at fire

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/Projectile.ts` | Create | Projectile interface + travel time functions |
| `src/entities/types.ts` | Modify | Add ProjectileShape type |
| `src/engine/GameSimulation.ts` | Modify | Deferred damage via projectiles, resolveProjectiles() |
| `src/render/Renderer.ts` | Modify | Draw projectile shapes on canvas |
| `src/__tests__/projectile.test.ts` | Create | Projectile timing + damage tests |
| `src/__tests__/integration.test.ts` | Modify | Adjust for deferred damage timing |
| `src/entities/__tests__/Boss.test.ts` | Modify | Adjust for deferred damage |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + new tests
- [ ] Hunlef ranged attack: green crystal spike travels from boss to player
- [ ] Hunlef magic attack: purple magic orb travels from boss to player
- [ ] Player bow attack: green arrow travels from player to boss
- [ ] Player staff attack: cyan magic blast travels from player to boss
- [ ] Player halberd attack: white slash arc appears near boss (instant, 0 delay)
- [ ] Ranged travel time follows `1 + floor((3 + distance) / 6)` ticks
- [ ] Magic travel time follows `1 + floor((1 + distance) / 3)` ticks
- [ ] Melee has 0 tick travel time (instant damage)
- [ ] Damage is pre-rolled at fire time, applied on projectile arrival
- [ ] Hit splats appear on arrival tick, not fire tick
- [ ] Multiple projectiles can be in flight simultaneously
- [ ] Projectiles cleaned up after arrival
- [ ] All 125 Sprint 1-4 tests still pass (adjusted for timing)
- [ ] Determinism preserved with seeded RNG
- [ ] agent-browser screenshots confirm projectiles visible during flight

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Deferred damage breaks many existing tests | High | Medium | Systematic: search for HP assertions, add extra ticks. Use helper for common patterns. |
| Projectile timing feels wrong | Medium | Low | Use exact OSRS formulas. Can adjust later. |
| Multiple projectiles clutter the canvas | Low | Low | Projectiles are small (~10-12px) and live 1-3 ticks max. |
| Prayer switching timing changes | Medium | Medium | This is intentional — deferred damage gives a prayer switch window, matching real OSRS. Document the change. |

---

## Dependencies

None (unchanged). Zero runtime dependencies.

---

## Open Questions

1. **Projectile tracking**: Should projectiles track the target (update endX/endY each tick if target moves)? OSRS projectiles do track. For simplicity, sprint 5 uses fire-time position. Can add tracking in a future sprint.

2. **Stomp vs projectile timing**: Stomp damage is instant (player is under boss). Should stomp remain instant even with the projectile system? Yes — stomp is not a projectile.

3. **Boss attack cooldown interaction**: The boss fires every 5 ticks. With magic projectile travel time of 2-3 ticks, the player could have 2 boss projectiles in flight simultaneously (one arriving, one just fired). This is correct OSRS behavior.

4. **Visual size scaling**: Should projectile size scale with distance? Probably not for sprint 5 — fixed sizes are simpler and clearer.
