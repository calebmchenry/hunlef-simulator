# Sprint 005: Projectile Animations

## Overview

Add a projectile array to the simulation. When boss or player attacks, a projectile entry is created instead of resolving damage immediately. Each tick, projectiles advance their progress. When progress reaches 1, damage resolves and a hit splat appears. Melee shows a one-tick slash arc at the target. No particles, no interpolation, no new dependencies.

**What ships:** Hunlef ranged/magic projectiles (green spike, purple orb), player bow/staff projectiles (green arrow, blue orb), player halberd slash arc, 1-tick damage delay for all ranged/magic attacks, hit splats on impact instead of on fire.

**What's deferred:** Sub-tick animation (requestAnimationFrame interpolation), particle trails, projectile shadows, sound effects.

---

## Use Cases

1. **UC-1: Boss ranged attack** — Hunlef fires a ranged attack. A green angular shape appears at boss center and moves toward the player. Damage resolves next tick when progress = 1.
2. **UC-2: Boss magic attack** — Hunlef fires a magic attack. A purple circle appears at boss center and moves toward the player. Damage resolves next tick.
3. **UC-3: Player bow attack** — Player fires bow. A green arrow shape travels from player to boss center. Damage resolves next tick.
4. **UC-4: Player staff attack** — Player fires staff. A blue orb travels from player to boss center. Damage resolves next tick.
5. **UC-5: Player halberd attack** — Player attacks with halberd. A white arc appears near the boss for 1 tick. Damage resolves same tick (melee = no travel delay).
6. **UC-6: Damage delay** — All ranged/magic projectiles delay damage by exactly 1 tick. The hit splat appears on the impact tick, not the fire tick.

---

## Architecture

### Approach: Array of Plain Objects

Projectiles are plain objects in a `projectiles: Projectile[]` array on `GameSimulation`. No new classes. Each tick, `processTick` advances existing projectiles and creates new ones from attacks. The Renderer reads the array and draws shapes at interpolated positions.

### Data Model

```typescript
// src/entities/types.ts — add Projectile interface

export type ProjectileStyle = 'ranged' | 'magic' | 'melee';

export interface Projectile {
  source: Position;        // pixel-center of source entity at fire time
  target: Position;        // pixel-center of target entity at fire time
  style: ProjectileStyle;  // determines color and shape
  owner: 'boss' | 'player';
  tickCreated: number;
  tickLands: number;       // tick when damage resolves (tickCreated + 1 for ranged/magic, tickCreated for melee)
  damage: number;          // pre-rolled damage to apply on landing
  targetEntity: 'boss' | 'player'; // who takes the damage
}
```

Key decision: damage is pre-rolled at fire time and stored on the projectile. This avoids needing to re-derive combat state on impact. The number is just held for 1 tick.

Melee projectiles have `tickLands = tickCreated` (same tick, no delay). They exist in the array for exactly 1 render frame to show the slash arc, then resolve and get cleaned up.

### Tick Order Change

Current order:
1. Process inputs
2. Drain prayer
3. Movement
4. Boss AI + damage
5. Player attack + damage
6. Stomp
7. Death checks
8. Cleanup

New order:
1. Process inputs
2. Drain prayer
3. Movement
4. **Resolve landed projectiles** (apply damage, create hit splats)
5. Boss AI — creates projectile instead of applying damage
6. Player attack — creates projectile instead of applying damage
7. Stomp (unchanged, still instant)
8. Death checks
9. Cleanup projectiles + hit splats

Landed projectiles resolve **before** new attacks fire. This means a projectile created on tick N lands on tick N+1, which runs its resolution in step 4 of tick N+1 before any new attacks. Clean and predictable.

---

## Implementation

### Phase 1: Projectile Type (~5% effort)

**Files:**
- `src/entities/types.ts` — Modify

**Tasks:**
- [ ] Add `ProjectileStyle` type alias
- [ ] Add `Projectile` interface (fields listed above)

### Phase 2: Simulation — Create and Resolve Projectiles (~45% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify

**Tasks:**
- [ ] Add `projectiles: Projectile[] = []` field
- [ ] Add step 4: `resolveProjectiles()` private method
  - Iterate `this.projectiles`, find entries where `tickLands <= this.tick`
  - For each landed projectile, apply `damage` to `targetEntity` (player or boss), push a `HitSplat`
  - Remove landed projectiles from the array
- [ ] Modify boss attack (current step 4-5): instead of computing damage inline and pushing a hit splat, create a `Projectile` with `tickLands = this.tick + 1` and push it to `this.projectiles`. Pre-roll the damage (same RNG logic, just store the result). Remove the inline `this.player.hp -= damage` and hit splat push from this block.
- [ ] Modify player attack (current step 6): same pattern. For bow/staff, create projectile with `tickLands = this.tick + 1`. For halberd, create projectile with `tickLands = this.tick` (resolves immediately in the same tick's step 4 — wait, step 4 already ran. So for melee: keep damage inline as-is, just add a melee projectile for the visual with `tickLands = this.tick` that carries `damage: 0` and gets cleaned up). Simpler approach: **melee stays instant** (no projectile for damage), just push a visual-only entry.
- [ ] Add cleanup: `this.projectiles = this.projectiles.filter(p => this.tick - p.tickCreated < 2)` at end of tick

**Detail on melee handling:** Melee attacks keep their current inline damage resolution. A visual-only projectile (damage = 0, targetEntity = 'boss') is pushed with `tickLands = this.tick` so the renderer can draw the slash arc for 1 frame. `resolveProjectiles` skips entries with damage = 0. This avoids changing melee timing at all.

**Detail on boss projectile creation:** Extract the current damage-rolling code into a helper or just inline it at projectile creation:

```typescript
// Instead of:
this.player.hp = Math.max(0, this.player.hp - damage);
this.hitSplats.push({ damage, x: ..., y: ..., tickCreated: this.tick });

// Do:
this.projectiles.push({
  source: { x: this.boss.center.x, y: this.boss.center.y },
  target: { x: this.player.pos.x, y: this.player.pos.y },
  style: bossAttackStyle,
  owner: 'boss',
  tickCreated: this.tick,
  tickLands: this.tick + 1,
  damage,
  targetEntity: 'player',
});
```

### Phase 3: Renderer — Draw Projectiles (~30% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Add a projectile drawing pass between entity drawing and hit splat drawing
- [ ] For each projectile in `sim.projectiles`:
  - Compute `progress`: `(sim.tick - p.tickCreated) / (p.tickLands - p.tickCreated)` clamped to [0, 1]. For 1-tick projectiles, progress is 0 on fire tick and 1 on land tick. On fire tick, draw at source; renderer runs after processTick so projectile exists for 1 frame at source position.
  - Lerp position: `x = source.x + (target.x - source.x) * progress`, same for y. Convert to pixel coords (tile * TILE_SIZE + TILE_SIZE/2).
- [ ] Draw by style and owner:
  - **Boss ranged (green spike):** Draw a small diamond/rhombus shape. `ctx.fillStyle = '#44cc44'`. Four-point path, ~8px wide.
  - **Boss magic (purple orb):** Draw a filled circle. `ctx.fillStyle = '#aa44cc'`. `ctx.arc(cx, cy, 6, 0, Math.PI * 2)`.
  - **Player ranged (green arrow):** Draw a thin line with a triangular head. `ctx.strokeStyle = '#44cc44'`, `ctx.lineWidth = 2`. Compute angle from source to target for rotation.
  - **Player magic (blue orb):** Draw a filled circle. `ctx.fillStyle = '#44ccff'`. `ctx.arc(cx, cy, 5, 0, Math.PI * 2)`.
  - **Melee (white arc):** Draw an arc near the target position. `ctx.strokeStyle = '#cccccc'`, `ctx.lineWidth = 3`. `ctx.arc(tx, ty, 16, 0, Math.PI)`. Show for 1 tick only.

### Phase 4: Tests (~20% effort)

**Files:**
- `src/__tests__/projectiles.test.ts` — Create

**Tasks:**
- [ ] **Projectile creation tests:**
  - Boss ranged attack creates a projectile with style = 'ranged', tickLands = tick + 1
  - Boss magic attack creates a projectile with style = 'magic', tickLands = tick + 1
  - Player bow attack creates a projectile with style = 'ranged', tickLands = tick + 1
  - Player staff attack creates a projectile with style = 'magic', tickLands = tick + 1
  - Player halberd attack creates a melee visual projectile with tickLands = tick
- [ ] **Damage delay tests:**
  - Boss fires on tick N; player HP is unchanged on tick N; player HP decreases on tick N+1
  - Player fires on tick N; boss HP is unchanged on tick N; boss HP decreases on tick N+1
  - Melee damage still applies on the same tick (no delay)
- [ ] **Projectile cleanup tests:**
  - Projectiles older than 2 ticks are removed from the array
  - Hit splats appear on the impact tick, not the fire tick
- [ ] **Prayer interaction tests:**
  - Prayer active at fire time determines damage (not prayer at impact time) — since damage is pre-rolled
  - Verify correct prayer still reduces boss projectile damage
- [ ] **Regression tests:**
  - All 125 existing tests still pass (damage timing change is the main risk — see Risks)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/types.ts` | Modify | Add `Projectile` interface and `ProjectileStyle` type |
| `src/engine/GameSimulation.ts` | Modify | Add `projectiles` array, create projectiles on attack, resolve on landing, 1-tick delay |
| `src/render/Renderer.ts` | Modify | Draw projectiles as colored shapes between entities and hit splats |
| `src/__tests__/projectiles.test.ts` | Create | Tests for projectile creation, damage delay, cleanup, prayer interaction |

Three files modified, one test file created. No new classes. No new runtime dependencies.

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` — all 125 existing tests still pass
- [ ] New projectile tests pass
- [ ] Boss ranged attack shows a green diamond traveling from boss to player
- [ ] Boss magic attack shows a purple circle traveling from boss to player
- [ ] Player bow shows a green arrow traveling from player to boss
- [ ] Player staff shows a blue circle traveling from player to boss
- [ ] Player halberd shows a white arc near the boss (no travel)
- [ ] Ranged/magic damage is delayed by exactly 1 tick
- [ ] Melee damage is still instant (same tick)
- [ ] Hit splats appear on impact tick, not fire tick
- [ ] `sim.projectiles` array is cleaned up each tick (no unbounded growth)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing tests break from 1-tick damage delay | High | Medium | Tests that assert HP changes on the same tick as an attack will fail. Fix by advancing 1 extra tick in those tests, or by checking HP after the resolution tick. Run full suite early and fix incrementally. |
| Prayer evaluated at wrong time | Low | Medium | Damage is pre-rolled at fire time using current prayer state. This is correct for OSRS (prayer matters at fire, not impact). Document this clearly. |
| Projectile position looks wrong at source/target | Low | Low | Source/target positions are captured at fire time. If the player moves between fire and impact, the projectile still travels to the old position. This is fine — projectiles don't home. |
| Melee visual-only projectile adds complexity | Low | Low | Keep it dead simple: damage = 0, exists for 1 frame, renderer checks `style === 'melee'` and draws an arc. No special damage logic. |

---

## Open Questions

1. **Should prayer be evaluated at fire or impact?** Recommendation: fire time. This matches OSRS behavior and is simpler (pre-roll damage, store on projectile). No need to snapshot prayer state.

2. **Should projectiles track moving targets?** Recommendation: no. Capture target position at fire time. Projectile travels to that fixed point. Simpler, and OSRS projectiles don't re-target.

3. **How many ticks of travel?** Recommendation: 1 tick for everything. The arena is small (12x12 tiles). Two-tick travel adds complexity for minimal visual payoff. Can always increase later.
