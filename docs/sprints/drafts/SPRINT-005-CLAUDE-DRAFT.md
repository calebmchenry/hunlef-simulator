# Sprint 005: Projectile Animations — Crystal Spikes, Magic Orbs, Arrows, Slash Arcs

## Overview

Add a projectile rendering system that gives every attack a visible trajectory on the canvas. Hunlef fires green crystal spikes (ranged) and purple magic orbs (magic) that travel from the boss center to the player tile. The player fires green arrows (bow), cyan magic blasts (staff), and white slash arcs (halberd, no travel). Projectiles advance position each tick and damage resolves on arrival rather than on the fire tick, so hit splats appear at the target when the projectile lands.

The renderer currently draws once per 600ms tick with no interpolation between frames. Projectiles must look good within this constraint: each tick, a projectile occupies a new position along its path and is drawn with a style-specific shape (angular polygon, glowing circle, line-with-arrowhead, or arc). A projectile that travels 1 tick simply appears at the midpoint on its fire tick and at the target on the next tick. A 2-tick projectile shows three frames (origin, midpoint, destination). To sell the sense of motion within a single frame, each projectile carries a rotation angle matching its heading and a short trail rendered behind it.

**What ships:** Five distinct projectile visuals. Damage delays by projectile travel time (1 tick for all ranged/magic, 0 for melee). Hit splats appear on impact tick. Melee slash arc renders as a one-tick effect near the target with no travel.

**What's deferred:** Sub-tick interpolation via requestAnimationFrame, particle effects on impact, projectile sound, projectile-prayer interaction visuals (e.g., prayer blocking animation).

---

## Use Cases

1. **UC-1: Hunlef ranged attack** -- Boss fires a ranged attack. A green angular crystal spike shape appears at the boss center. Next tick, the spike has arrived at the player tile and damage resolves. A red hit splat appears at the player position on the impact tick, not the fire tick.

2. **UC-2: Hunlef magic attack** -- Boss fires a magic attack. A purple glowing circle with a faint radial gradient appears at the boss center. Next tick, it arrives at the player and damage resolves with a hit splat.

3. **UC-3: Player bow attack** -- Player fires with the bow. A green line with an arrowhead appears, oriented along the heading from the player to the boss center. Next tick, it arrives at the boss and damage resolves.

4. **UC-4: Player staff attack** -- Player fires with the staff. A cyan glowing orb (smaller than Hunlef's magic orb) appears, traveling from the player to the boss center. Damage resolves on arrival.

5. **UC-5: Player halberd attack** -- Player attacks with the halberd. No projectile travels. Instead, a white/silver arc shape renders near the boss for one tick, representing the slash. Damage resolves immediately (same tick, no delay).

6. **UC-6: Multiple projectiles in flight** -- The boss fires on tick N while a player arrow from tick N-1 is still in flight. Both projectiles render simultaneously. The renderer iterates the full projectile array each frame.

7. **UC-7: Projectile over dead entity** -- A projectile is in flight when the target dies from another source. The projectile still renders its final frame and the damage is discarded (target already at 0 HP). No orphaned projectiles persist beyond their travel duration.

---

## Architecture

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Projectile storage | `GameSimulation.projectiles: Projectile[]` alongside existing `hitSplats[]` | Follows the established pattern. Both are ephemeral arrays cleaned up by tick age. No new subsystem needed. |
| Position model | Each projectile stores `origin: Position`, `target: Position`, `tickFired: number`, `travelTicks: number` | The renderer computes the current position as a linear interpolation: `t = (currentTick - tickFired) / travelTicks`, clamped to [0, 1]. This keeps position computation in the renderer where it belongs and avoids per-tick mutation of x/y floats in the simulation. |
| Damage delay | Damage resolves when `sim.tick - proj.tickFired >= proj.travelTicks` | The simulation creates the projectile with pending damage data. On the arrival tick, it applies damage and spawns the hit splat. This shifts damage from fire-tick to impact-tick without changing combat formulas. |
| Melee special case | `travelTicks = 0`, rendered as a slash arc at the target | Zero travel means damage resolves same tick (no delay). The renderer checks `travelTicks === 0` and draws a slash arc instead of interpolating a position. |
| Drawing within single-tick render | Trail line from previous position to current position, plus the projectile shape at current position | Since we only render once per tick, a static shape alone looks frozen. Drawing a faint trail line from the previous interpolated position to the current one implies motion. For tick-0 (just fired), the trail extends from the origin. |
| Heading/rotation | `Math.atan2(target.y - origin.y, target.x - origin.x)` computed once at creation | All directional shapes (crystal spike, arrow) rotate to face the direction of travel. Stored on the projectile to avoid recomputing every frame. |
| Projectile cleanup | Remove when `sim.tick - tickFired > travelTicks` (one tick after arrival for visual linger) | Keeps the impact frame visible for one extra tick so the player sees the projectile reach its target before it disappears. |
| Canvas layering | Projectiles draw after entities, before hit splats | Projectiles should appear on top of the boss/player rectangles but beneath hit splat numbers so damage is always readable. |

### Component Changes

```
src/entities/types.ts (modify — minor)
  └── Add Projectile interface

src/engine/GameSimulation.ts (modify — major)
  ├── Add projectiles: Projectile[] array
  ├── Boss attack: create projectile with pending damage instead of instant damage
  ├── Player attack: create projectile with pending damage (ranged/magic) or instant slash (melee)
  ├── New step in processTick(): resolve arrived projectiles (apply damage + spawn hit splat)
  └── Clean up expired projectiles each tick

src/render/Renderer.ts (modify — major)
  ├── Add drawProjectiles() method called between entities and hit splats
  ├── drawCrystalSpike(ctx, x, y, angle, alpha) — angular polygon, green/teal
  ├── drawMagicOrb(ctx, x, y, radius, color, alpha) — radial gradient circle
  ├── drawArrow(ctx, x, y, angle, alpha) — line with triangular arrowhead
  ├── drawMagicBlast(ctx, x, y, alpha) — smaller cyan orb
  ├── drawSlashArc(ctx, x, y, alpha) — white arc near target
  └── Trail rendering: semi-transparent line from previous to current position

src/entities/Boss.ts (no change)
  └── fireAttack() return value unchanged; GameSimulation handles projectile creation
```

### Projectile Interface

```typescript
export interface Projectile {
  /** Unique identifier for cleanup */
  id: number;
  /** 'boss_ranged' | 'boss_magic' | 'player_bow' | 'player_staff' | 'player_halberd' */
  kind: ProjectileKind;
  /** Tile position where the projectile originated (center of source entity) */
  origin: Position;
  /** Tile position the projectile is traveling toward */
  target: Position;
  /** Tick when the projectile was created */
  tickFired: number;
  /** Number of ticks to reach the target (0 = instant/melee) */
  travelTicks: number;
  /** Pre-rolled damage to apply on arrival */
  damage: number;
  /** Who takes the damage: 'player' or 'boss' */
  damageTarget: 'player' | 'boss';
  /** Heading angle in radians, computed at creation */
  angle: number;
  /** Whether damage was blocked by protection prayer */
  blocked: boolean;
}

export type ProjectileKind =
  | 'boss_ranged'
  | 'boss_magic'
  | 'player_bow'
  | 'player_staff'
  | 'player_halberd';
```

### Tick Processing (Updated)

```
processTick() — running state:
  1. Process queued inputs (move, prayer, attack target, inventory)
  2. Apply queued prayers
  3. Process inventory actions
  4. Drain prayer
  5. Player movement
  6. Boss AI (fire attack → create projectile with pending damage)
  7. Player attack (if target set and in range → create projectile or instant melee)
  8. ** NEW: Resolve arrived projectiles **
     for each projectile where (tick - tickFired) >= travelTicks:
       if damageTarget === 'player':
         apply damage to player, spawn hit splat at player.pos
       if damageTarget === 'boss':
         apply damage to boss, spawn hit splat at boss.center
       mark projectile as resolved
  9. Stomp check
  10. Death checks
  11. Clean up expired projectiles (resolved + age > travelTicks)
  12. Clean up old hit splats
```

### Rendering Pipeline (Updated)

```
draw(sim):
  1. Background + grid
  2. Boss rectangle + border + label
  3. Player rectangle
  4. Target tile indicator
  5. Overhead prayer icons
  6. ** NEW: Projectiles **
     for each projectile in sim.projectiles:
       t = clamp((sim.tick - proj.tickFired) / max(proj.travelTicks, 1), 0, 1)
       currentX = lerp(proj.origin.x, proj.target.x, t) * TILE_SIZE + TILE_SIZE/2
       currentY = lerp(proj.origin.y, proj.target.y, t) * TILE_SIZE + TILE_SIZE/2
       prevT = clamp((sim.tick - proj.tickFired - 1) / max(proj.travelTicks, 1), 0, 1)
       prevX = lerp(proj.origin.x, proj.target.x, prevT) * TILE_SIZE + TILE_SIZE/2
       prevY = lerp(proj.origin.y, proj.target.y, prevT) * TILE_SIZE + TILE_SIZE/2

       // Draw trail (faint line from prev to current)
       ctx.globalAlpha = 0.3
       ctx.strokeStyle = projectileColor(proj.kind)
       drawLine(prevX, prevY, currentX, currentY)

       // Draw projectile shape at current position
       ctx.globalAlpha = 1.0
       switch (proj.kind):
         'boss_ranged':  drawCrystalSpike(ctx, currentX, currentY, proj.angle)
         'boss_magic':   drawMagicOrb(ctx, currentX, currentY, 10, '#aa44cc')
         'player_bow':   drawArrow(ctx, currentX, currentY, proj.angle)
         'player_staff': drawMagicOrb(ctx, currentX, currentY, 7, '#44ccdd')
         'player_halberd': drawSlashArc(ctx, currentX, currentY)

       ctx.globalAlpha = 1.0
  7. Hit splats
  8. Countdown / FIGHT overlay
```

### Projectile Shape Specifications

**Crystal Spike (boss_ranged):**
An angular polygon resembling a shard of crystal. Five vertices forming an elongated diamond/kite shape, rotated to face the direction of travel. Fill: `#44cc88` (teal-green). Stroke: `#22aa66`. Size: roughly 20px long, 8px wide at the widest point.

```
Vertices (before rotation, relative to center):
  tip:        (10, 0)
  upper-left: (-4, -4)
  inner-left: (-2, -1)
  inner-right:(-2,  1)
  lower-left: (-4,  4)
```

**Magic Orb (boss_magic / player_staff):**
A filled circle with a radial gradient to simulate glow. Boss orb: outer color `#aa44cc` (purple), inner color `#dd88ff` (light purple), radius 10px. Player orb: outer `#2288bb` (dark cyan), inner `#44ddff` (bright cyan), radius 7px. A second, larger circle at 0.15 alpha behind the main circle provides the glow halo.

```
// Glow halo
ctx.globalAlpha = 0.15
ctx.fillStyle = color
ctx.arc(x, y, radius * 2, 0, 2*PI)
ctx.fill()

// Core orb with gradient
const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
grad.addColorStop(0, innerColor)
grad.addColorStop(1, outerColor)
ctx.globalAlpha = 1.0
ctx.fillStyle = grad
ctx.arc(x, y, radius, 0, 2*PI)
ctx.fill()
```

**Arrow (player_bow):**
A line segment (12px long) with a triangular arrowhead (6px), rotated to face direction of travel. Stroke: `#44cc44` (green), line width 2px. The arrowhead is a filled triangle at the leading end.

```
// Shaft (line from tail to head)
ctx.strokeStyle = '#44cc44'
ctx.lineWidth = 2
moveTo(x - cos(angle)*6, y - sin(angle)*6)  // tail
lineTo(x + cos(angle)*6, y + sin(angle)*6)  // head

// Arrowhead (filled triangle)
ctx.fillStyle = '#44cc44'
headX = x + cos(angle)*6
headY = y + sin(angle)*6
triangle from headX,headY extending 5px back at +/- 30 degrees
```

**Slash Arc (player_halberd):**
A white/silver arc drawn near the target position for one tick. No travel — this is a one-frame effect. The arc sweeps roughly 120 degrees (2*PI/3) centered on the angle from player to boss. Stroke: `#cccccc` (light gray), line width 3px, radius 18px. Alpha fades based on age.

```
ctx.strokeStyle = '#cccccc'
ctx.lineWidth = 3
ctx.arc(x, y, 18, angle - PI/3, angle + PI/3)
ctx.stroke()
// Optional: second inner arc at smaller radius for depth
ctx.globalAlpha = 0.4
ctx.arc(x, y, 12, angle - PI/4, angle + PI/4)
ctx.stroke()
```

---

## Implementation

### Phase 1: Projectile Type Definitions (~10% effort)

**Files:**
- `src/entities/types.ts` -- Modify

**Tasks:**
- [ ] Add `ProjectileKind` type: `'boss_ranged' | 'boss_magic' | 'player_bow' | 'player_staff' | 'player_halberd'`
- [ ] Add `Projectile` interface with fields: `id`, `kind`, `origin`, `target`, `tickFired`, `travelTicks`, `damage`, `damageTarget`, `angle`, `blocked`
- [ ] Export both from `types.ts`

### Phase 2: GameSimulation Projectile Lifecycle (~35% effort)

**Files:**
- `src/engine/GameSimulation.ts` -- Modify

**Tasks:**
- [ ] Add `projectiles: Projectile[]` array field, initialized to `[]`
- [ ] Add `private nextProjectileId: number = 0` counter
- [ ] Add `private createProjectile(kind, origin, target, travelTicks, damage, damageTarget, blocked): Projectile` helper that computes `angle` via `Math.atan2` and pushes to the array
- [ ] Refactor boss damage resolution (current lines 204-228): instead of applying damage immediately, call `createProjectile('boss_ranged' | 'boss_magic', bossCenter, playerPos, 1, damage, 'player', ...)`. The damage value and prayer-block check remain identical — only the timing changes.
- [ ] Refactor player attack resolution (current lines 230-278):
  - For `bow` and `staff` weapons: create a projectile with `travelTicks = 1` carrying the rolled damage
  - For `halberd`: create a projectile with `travelTicks = 0` (instant) — damage still resolves same tick
  - Protection-blocked hits (boss `processPlayerHit` returns true): create projectile with `damage = 0` and `blocked = true`
- [ ] Add new step after player attack resolution — `resolveArrivedProjectiles()`:
  ```typescript
  private resolveArrivedProjectiles(): void {
    for (const proj of this.projectiles) {
      if (proj.resolved) continue;
      if (this.tick - proj.tickFired < proj.travelTicks) continue;

      proj.resolved = true;

      if (proj.damageTarget === 'player') {
        this.player.hp = Math.max(0, this.player.hp - proj.damage);
        this.player.totalDamageTaken += proj.damage;
        this.boss.totalDamageDealt += proj.damage;
        if (proj.damage > 0) {
          this.hitSplats.push({
            damage: proj.damage,
            x: this.player.pos.x,
            y: this.player.pos.y,
            tickCreated: this.tick,
          });
        }
      } else if (proj.damageTarget === 'boss') {
        this.boss.hp = Math.max(0, this.boss.hp - proj.damage);
        this.player.totalDamageDealt += proj.damage;
        this.hitSplats.push({
          damage: proj.damage,
          x: this.boss.center.x,
          y: this.boss.center.y,
          tickCreated: this.tick,
        });
      }
    }
  }
  ```
- [ ] Add `resolved: boolean` field to the `Projectile` interface (or track separately)
- [ ] Clean up projectiles: remove when `this.tick - proj.tickFired > proj.travelTicks + 1` (linger one tick after arrival for rendering)
- [ ] Move death checks AFTER `resolveArrivedProjectiles()` so delayed damage can cause death
- [ ] Ensure `projectiles` array is cleared on `reset()` or new game

**Key concern — test compatibility:** The damage delay for boss attacks shifts when the player takes damage by 1 tick. Existing tests that check `player.hp` immediately after a boss attack tick will fail. Tests must be updated to account for the 1-tick travel delay. Boss melee (stomp) is unaffected since it has no projectile. Player halberd attacks remain instant.

### Phase 3: Renderer Projectile Drawing (~40% effort)

**Files:**
- `src/render/Renderer.ts` -- Modify

**Tasks:**
- [ ] Add `private drawProjectiles(sim: GameSimulation): void` method
- [ ] Call `drawProjectiles(sim)` in `draw()` after overhead icons, before hit splats
- [ ] Implement `lerp(a, b, t)` utility: `a + (b - a) * t`
- [ ] For each projectile, compute interpolated canvas position:
  ```typescript
  const t = Math.min(1, (sim.tick - proj.tickFired) / Math.max(proj.travelTicks, 1));
  const cx = (proj.origin.x + (proj.target.x - proj.origin.x) * t) * TILE_SIZE + TILE_SIZE / 2;
  const cy = (proj.origin.y + (proj.target.y - proj.origin.y) * t) * TILE_SIZE + TILE_SIZE / 2;
  ```
- [ ] Compute previous-tick position for trail rendering:
  ```typescript
  const prevT = Math.max(0, Math.min(1, (sim.tick - proj.tickFired - 1) / Math.max(proj.travelTicks, 1)));
  const prevCx = (proj.origin.x + (proj.target.x - proj.origin.x) * prevT) * TILE_SIZE + TILE_SIZE / 2;
  const prevCy = (proj.origin.y + (proj.target.y - proj.origin.y) * prevT) * TILE_SIZE + TILE_SIZE / 2;
  ```
- [ ] Implement `drawTrail(ctx, prevX, prevY, curX, curY, color)`: a line at 0.3 alpha with line width 2, providing motion implication within the single-render constraint
- [ ] Implement `drawCrystalSpike(ctx, x, y, angle)`:
  - Save context, translate to (x, y), rotate by angle
  - Define 5-vertex kite polygon: elongated along the x-axis (tip at +10, rear points at -4), narrow vertically
  - Fill with `#44cc88`, stroke with `#22aa66` at line width 1
  - Restore context
- [ ] Implement `drawMagicOrb(ctx, x, y, radius, outerColor, innerColor)`:
  - Draw glow halo: filled circle at 2x radius, 0.15 alpha, using outerColor
  - Create radial gradient from center (innerColor) to edge (outerColor)
  - Fill circle at given radius with gradient
- [ ] Implement `drawArrow(ctx, x, y, angle)`:
  - Save context, translate to (x, y), rotate by angle
  - Draw shaft: line from (-6, 0) to (+6, 0), stroke `#44cc44`, width 2
  - Draw arrowhead: filled triangle at (+6, 0) pointing right, 5px long, 4px wide
  - Restore context
- [ ] Implement `drawSlashArc(ctx, x, y, angle)`:
  - Compute angle from player to boss (passed as `proj.angle`)
  - Draw primary arc: `ctx.arc(x, y, 18, angle - PI/3, angle + PI/3)`, stroke `#cccccc`, width 3
  - Draw inner arc at 0.4 alpha: `ctx.arc(x, y, 12, angle - PI/4, angle + PI/4)`, stroke `#cccccc`, width 2
  - Fade alpha based on age: `alpha = 1.0 - (sim.tick - proj.tickFired) * 0.5` for a one-tick fade-out
- [ ] For instant projectiles (melee, `travelTicks === 0`): draw at the target position on the fire tick only. Use `t = 1` always and skip trail.
- [ ] Handle edge case: projectile lingers one tick after arrival. On the linger tick, draw at full `t = 1` (at target) with reduced alpha (0.5) to show impact moment.
- [ ] Restore `ctx.globalAlpha = 1.0` after each projectile to avoid bleeding into hit splats.

### Phase 4: Test Updates (~15% effort)

**Files:**
- Existing test files that verify boss damage on player

**Tasks:**
- [ ] Identify all tests that assert `player.hp` after a boss attack tick. These need an extra `processTick()` call (or `runTicks` adjustment) to account for the 1-tick projectile travel delay.
- [ ] Add new tests:
  - [ ] `projectile is created when boss attacks` — verify `sim.projectiles.length === 1` after boss fires
  - [ ] `projectile damage resolves after travelTicks` — fire boss attack on tick N, verify player HP unchanged on tick N, decreased on tick N+1
  - [ ] `player bow creates projectile with travelTicks=1` — verify projectile exists after player bow attack
  - [ ] `player halberd damage is instant (travelTicks=0)` — verify boss HP decreases same tick
  - [ ] `multiple projectiles can exist simultaneously` — boss fires tick N, player fires tick N, verify 2 projectiles in array
  - [ ] `projectiles are cleaned up after arrival + 1 tick` — verify array length returns to 0
  - [ ] `projectile damage on dead target is discarded` — boss at 0 HP, arriving player projectile does not go negative
- [ ] Ensure all 125 existing tests still pass (with timing adjustments)
- [ ] Run `npm run build` to verify zero TypeScript errors

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/entities/types.ts` | Modify (minor) | Add `Projectile` interface and `ProjectileKind` type |
| `src/engine/GameSimulation.ts` | Modify (major) | Projectile array, creation on attack, arrival resolution, damage delay, cleanup |
| `src/render/Renderer.ts` | Modify (major) | Five projectile drawing functions, trail rendering, interpolation, layering |
| `src/entities/Boss.ts` | No change | `fireAttack()` unchanged; simulation handles projectile creation |
| `src/entities/Player.ts` | No change | No new fields needed |
| `src/combat/PrayerManager.ts` | No change | Prayer logic unaffected |
| `src/combat/formulas.ts` | No change | Damage formulas unaffected |

---

## Definition of Done

- [ ] `Projectile` interface and `ProjectileKind` type are defined in `types.ts`
- [ ] `GameSimulation.projectiles` array exists and is publicly readable (for renderer)
- [ ] Boss ranged attack creates a `boss_ranged` projectile with `travelTicks = 1`
- [ ] Boss magic attack creates a `boss_magic` projectile with `travelTicks = 1`
- [ ] Player bow attack creates a `player_bow` projectile with `travelTicks = 1`
- [ ] Player staff attack creates a `player_staff` projectile with `travelTicks = 1`
- [ ] Player halberd attack creates a `player_halberd` projectile with `travelTicks = 0`
- [ ] Damage from ranged/magic projectiles resolves on the arrival tick, not the fire tick
- [ ] Melee damage resolves on the fire tick (travelTicks = 0, no delay)
- [ ] Hit splats appear at impact, not at launch
- [ ] Crystal spike renders as a green angular polygon rotated to face direction of travel
- [ ] Boss magic orb renders as a purple circle with radial gradient glow
- [ ] Player arrow renders as a green line with triangular arrowhead, rotated to heading
- [ ] Player staff blast renders as a cyan glowing circle (smaller than boss orb)
- [ ] Halberd slash renders as a white/silver arc near the boss, one-tick duration
- [ ] Each projectile has a semi-transparent trail line from previous to current position
- [ ] Projectiles render after entities, before hit splats (correct z-ordering)
- [ ] Projectiles are cleaned up within 1 tick after arrival
- [ ] Multiple simultaneous projectiles render correctly
- [ ] All 125 existing tests pass (with timing adjustments for 1-tick damage delay)
- [ ] New projectile-specific tests pass (creation, timing, cleanup, dead-target edge case)
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] Zero new runtime dependencies

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 1-tick damage delay breaks many existing tests | High | Medium | Tests that assert `player.hp` right after a boss attack tick will need an extra `processTick()`. Create a helper or document the pattern. Identify all affected tests before starting Phase 2. Consider adding a `GameSimulationOptions.instantDamage` flag that bypasses projectile delay for legacy tests, though this adds complexity. |
| Projectile interpolation looks jerky at 1-tick travel | Medium | Low | With only two frames (origin and destination), the projectile essentially teleports. The trail line mitigates this by drawing a line from the origin to the current position on the arrival tick, implying the path traveled. For longer distances, consider `travelTicks = 2` when the Chebyshev distance exceeds a threshold (e.g., 6 tiles). |
| Canvas state leaks (globalAlpha, transforms) between projectile draws | Medium | Medium | Every `drawCrystalSpike` / `drawArrow` call must use `ctx.save()` / `ctx.restore()`. Reset `globalAlpha = 1.0` after each projectile. Add a defensive `ctx.restore()` in the outer loop's finally block. |
| Projectile position uses tile coordinates but player may have moved since fire tick | Low | Low | Projectile `target` captures the player's position at fire time. If the player moves before the projectile arrives, the projectile visually travels to the old position, but damage applies at the player's current position. This is acceptable — OSRS projectiles behave similarly (visual target is locked, mechanical target follows). |
| Melee slash arc looks out of place without animation | Low | Low | A single-frame arc is admittedly static. The dual-arc design (outer + inner at different opacities) gives some visual depth. Future sprints could add a 2-frame slash that widens, but for now a clean arc is sufficient. |
| `resolveArrivedProjectiles` order matters for death checks | Low | High | If a boss projectile and player projectile both arrive on the same tick, the resolution order determines who "dies first." Process player-targeting projectiles before boss-targeting ones (boss attacks resolve first, matching OSRS where the NPC acts before the player in the same tick). |

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged).

### Dev
No new dev dependencies. Existing Vite + TypeScript + Vitest toolchain is sufficient.

### Internal (from prior sprints)
- Sprint 001: `formulas.ts` damage calculations (unchanged, projectiles carry pre-rolled damage)
- Sprint 002: `Boss.center` getter for projectile origin, `Boss.chebyshevDistTo()` for range checks
- Sprint 003: Hit splat rendering pattern (extended for projectile-delayed splats)
- Sprint 004: Click-to-attack targeting, `attackTarget` field, boss `fireAttack()` return value, `GameSimulation.processTick()` structure

---

## Open Questions

1. **Should projectile travel time scale with distance?** The intent doc suggests 1 tick for close range, 2 for far. In CG the arena is small (12x12) and the boss is 5x5, so max Chebyshev distance is about 7 tiles. Recommendation: use a fixed 1 tick for all projectiles. This keeps the damage timing predictable for prayer switching practice, which is the tool's primary purpose. A 2-tick delay would shift prayer-switch timing windows and may confuse players training muscle memory.

2. **Should the projectile visual target track the player's current position or lock to the fire-tick position?** OSRS projectiles visually track the target's current tile each frame. Since we only render once per tick, tracking vs locking produces the same result for 1-tick projectiles (the projectile arrives next frame regardless). Recommendation: lock to fire-tick position for simplicity. Revisit if `travelTicks > 1` is introduced later.

3. **Should the `resolved` flag live on the Projectile interface or in a separate Set?** A boolean on the interface is simpler and avoids a parallel data structure. The downside is mutating a "data" interface. Recommendation: add `resolved: boolean` to the interface. The projectile is already an ephemeral mutable object (it has a position that changes semantically each tick via interpolation), so mutation is appropriate.

4. **Should boss damage still roll on the fire tick or on the arrival tick?** Rolling on fire tick (current approach in this draft) means the damage is predetermined when the projectile is created. Rolling on arrival tick would let the player's prayer state at arrival time matter. In OSRS, the prayer check happens on the fire tick for determining if the hit is protected, but this is a practice tool. Recommendation: roll damage and check prayer on fire tick (as described in this draft). This matches OSRS behavior and keeps the implementation straightforward.

5. **How should the "FIGHT!" overlay interact with projectiles?** If a projectile is somehow in flight during the FIGHT text (unlikely given countdown prevents attacks), it should render beneath the overlay. The current draw order (projectiles before overlay) handles this naturally. No special case needed.
