# Sprint 005 Draft: Projectile Animations — Crystal Spikes, Magic Balls, Arrows

**Author perspective:** Game systems architect

---

## Overview

This sprint introduces a projectile entity model that decouples the moment an attack is initiated from the moment its damage resolves. Today, `GameSimulation.processTick` fires an attack and applies its damage in the same tick (steps 4-5 for the boss, step 6 for the player). The projectile system inserts a new entity into the pipeline: on the fire tick, an attack creates a `Projectile` that records its source position, target position, damage payload, and remaining travel time. On each subsequent tick, the projectile advances. When its travel time reaches zero, the payload is delivered: HP is reduced, the hit splat is created, and the projectile is removed from the active array.

The core design decision is that projectiles carry deferred damage, not just deferred visuals. This matters because CG is a prayer-switching practice tool. In OSRS, the player must have the correct protection prayer active when the projectile lands, not when it is fired. A purely-visual projectile system would not train this skill. By deferring the damage resolution to the impact tick, the simulation becomes faithful to the timing window the player needs to learn.

The projectile array is a flat, simulation-owned collection following the same lifecycle pattern as the existing `hitSplats` array: created during combat resolution, iterated during tick processing, and garbage-collected by age. This pattern extends naturally to future features like tornado entities (which would be projectiles with multi-tick lifetimes and per-tick position recalculation) and floor tile effects (which are positional entities with tick-based lifetimes).

---

## Use Cases

1. **Hunlef ranged attack** -- Boss fires a ranged attack. A green crystal spike projectile appears at the boss center and travels toward the player's position. Damage resolves 1 tick later at the player's position on the impact tick. The hit splat appears at impact, not at launch.
2. **Hunlef magic attack** -- Boss fires a magic attack. A purple magic orb projectile appears at the boss center and travels toward the player. Same 1-tick travel time. Prayer protection is checked on the impact tick.
3. **Player bow attack** -- Player fires a bow. A green arrow projectile travels from the player tile to the boss center. Damage resolves on impact. Boss protection prayer is checked on fire tick (OSRS: player accuracy is rolled on fire, not on impact).
4. **Player staff attack** -- Player fires a staff attack. A blue/cyan magic orb travels from the player to the boss. Same deferred-impact behavior.
5. **Player halberd attack** -- Player uses the halberd. No projectile travels. Instead, a slash arc visual appears near the boss for 1 tick. Damage resolves immediately (melee has no travel time). This is a special-case "effect" rather than a traveling projectile.
6. **Prayer switch between fire and impact** -- Hunlef fires a ranged projectile on tick N. Player switches from Protect from Magic to Protect from Missiles on tick N+1 (the impact tick). The prayer active at impact determines damage reduction. This is the entire training purpose of deferred damage.
7. **Multiple projectiles in flight** -- Hunlef fires on tick N. Player fires on tick N. Both projectiles are in the array simultaneously. Each resolves independently on its own impact tick.
8. **Projectile cleanup** -- After a projectile delivers its payload (or after a configurable visual linger time), it is removed from the array. No stale projectiles accumulate.

---

## Architecture

### The Projectile Interface

Define a `Projectile` type in `src/entities/types.ts`:

```
Projectile {
  id: number                          // Monotonic counter for stable identity
  source: 'boss' | 'player'          // Who fired it
  style: AttackStyle | 'melee'       // Combat style (determines visual shape/color)
  origin: Position                    // Pixel-space origin (launch position)
  target: Position                    // Pixel-space destination (impact position)
  tickCreated: number                 // Tick when the projectile was spawned
  tickImpact: number                  // Tick when damage resolves
  payload: ProjectilePayload          // Deferred damage data
  state: 'traveling' | 'impacted'    // Lifecycle state
}
```

The `state` field is the key lifecycle marker. A projectile is created in `'traveling'` state. On its impact tick, the simulation resolves its payload and transitions it to `'impacted'`. The renderer can use the `'impacted'` state to show a brief flash or simply skip drawing. Cleanup removes `'impacted'` projectiles after 1 tick of linger.

### The Payload: What Deferred Damage Carries

The payload captures everything needed to resolve damage at impact time without re-rolling:

```
ProjectilePayload {
  damage: number                     // Pre-rolled damage value
  targetEntity: 'boss' | 'player'   // Who takes the damage
  // For boss-to-player projectiles: prayer check is deferred
  attackStyle?: AttackStyle          // Needed to check prayer at impact time
  maxHitProtected?: number           // Max hit if prayer is correct at impact
}
```

There is a critical asymmetry between boss and player projectiles:

**Boss projectiles defer the prayer check.** The damage is NOT pre-rolled at fire time. Instead, the payload stores the attack style and the RNG state needed to roll damage at impact. The reason: the player's active prayer at impact time determines whether the hit is protected (capped at tier-based max) or unprotected (full 48 max hit). Pre-rolling would lock in the prayer check at fire time, defeating the prayer-switching training purpose.

Actually, a cleaner approach: store both the unprotected roll and the protected max hit in the payload, and resolve which to use at impact time:

```
BossProjectilePayload {
  targetEntity: 'player'
  attackStyle: AttackStyle
  unprotectedDamage: number          // Pre-rolled against full max hit
  protectedMaxHit: number            // Tier-based cap if prayer is correct
}
```

At impact, the simulation checks the player's active prayer. If correct, damage is `min(unprotectedDamage, protectedMaxHit)`. If incorrect, damage is `unprotectedDamage`. This avoids storing RNG state or re-rolling, while still making prayer timing matter.

**Player projectiles pre-roll everything.** The boss's protection style and the accuracy roll happen on the fire tick (OSRS behavior: accuracy is determined at fire time for players). The payload simply carries the final damage number. The projectile is purely a visual delay for player attacks.

```
PlayerProjectilePayload {
  targetEntity: 'boss'
  damage: number                     // Fully resolved (0 if blocked or missed)
}
```

### Projectile Array Lifecycle

`GameSimulation` gains a new public field:

```typescript
projectiles: Projectile[] = [];
```

The lifecycle within `processTick`:

```
Step 4: Boss AI fires attack
  -> Create boss projectile, push to projectiles[]
  -> Do NOT apply damage yet

Step 5: Resolve arriving projectiles (NEW STEP)
  -> For each projectile where tick === tickImpact:
    -> If boss projectile: check player prayer NOW, compute final damage, apply HP, create hit splat
    -> If player projectile: apply pre-rolled damage to boss HP, create hit splat
    -> Set projectile.state = 'impacted'

Step 6: Player attack fires
  -> Roll accuracy and damage immediately
  -> Create player projectile with pre-rolled damage, push to projectiles[]
  -> Do NOT apply damage to boss yet

Step 8 (end of tick): Cleanup
  -> Remove projectiles where state === 'impacted' and tick - tickImpact >= 1
```

The ordering matters. Boss projectile resolution (step 5) happens before player attack firing (step 6). This means a boss projectile fired on tick N-1 resolves on tick N before the player's tick-N attack creates a new projectile. This matches OSRS tick ordering where incoming damage resolves before outgoing attacks.

### Melee: The Special Case

Halberd attacks do not create a traveling projectile. They create a positional effect:

```
MeleeEffect {
  position: Position       // Near the boss
  tickCreated: number
  duration: 1              // Visible for 1 tick
}
```

This can be modeled as a projectile with `tickImpact === tickCreated` (zero travel time) and a special `style: 'melee'` that the renderer draws as an arc rather than a traveling shape. Alternatively, it can be a separate lightweight array. Using the projectile array with zero travel time is simpler and avoids a parallel system.

For a zero-travel projectile, the damage still resolves immediately (same tick). The projectile is created in `'impacted'` state (or resolves instantly in the same step). This preserves melee's instant-damage behavior while giving the renderer something to draw.

### Travel Time Calculation

The intent document specifies 1 tick for simplicity. This is correct for the current arena layout where the player is always relatively close to the boss. The `tickImpact` is simply `tickCreated + 1` for all ranged/magic projectiles.

If variable travel time is desired later (e.g., 2 ticks for cross-arena shots), the calculation would be based on Chebyshev distance between source and target at fire time:

```
travelTicks = distance <= 6 ? 1 : 2
```

For now, hardcode `PROJECTILE_TRAVEL_TICKS = 1` as a constant.

### Renderer Integration

The `Renderer.draw()` method gains a new layer between entities and hit splats:

```
draw(sim):
  1. Background + grid
  2. Boss
  3. Player
  4. Overhead icons
  5. ** Projectiles ** (NEW)
  6. Hit splats
  7. Countdown overlay
```

Projectiles render above entities but below hit splats. This ensures the projectile is visible during travel but the hit splat takes visual priority at impact.

For each projectile in `'traveling'` state, compute its interpolated position:

```
progress = (sim.tick - projectile.tickCreated) / (projectile.tickImpact - projectile.tickCreated)
currentX = lerp(projectile.origin.x, projectile.target.x, progress)
currentY = lerp(projectile.origin.y, projectile.target.y, progress)
```

Since rendering happens once per tick and travel is 1 tick, the progress will be either 0 (just created, drawn at origin) or 1 (at target, about to resolve). With 1-tick travel, the projectile is visible for exactly one render frame at its origin position (the fire tick). On the impact tick, it resolves before drawing, so it appears as a hit splat. If this feels too fast visually, the projectile could linger in `'traveling'` state for the render that happens on the impact tick (render before cleanup), giving it two visual frames.

Drawing functions per style:

| Style | Shape | Color | Details |
|-------|-------|-------|---------|
| `ranged` (boss) | Angular shard / diamond | `#44cc88` (teal-green) | 12x6 px rotated toward target |
| `magic` (boss) | Circle with glow | `#aa44cc` (purple) | 8px radius, 12px outer glow at 0.3 alpha |
| `ranged` (player) | Thin line with arrowhead | `#44cc44` (green) | 2px line, 6px triangular head |
| `magic` (player) | Small orb | `#44ccee` (cyan) | 6px radius circle |
| `melee` (player) | Arc slash | `#cccccc` (silver) | 60-degree arc, 20px radius, drawn at boss edge |

### Impact on Existing Damage Resolution

The biggest refactor is in `processTick` steps 4-6. Currently:

**Boss attack (steps 4-5):** `fireAttack()` returns the style, then damage is immediately rolled and applied to `player.hp`. This becomes: `fireAttack()` returns the style, a projectile is created with the unprotected damage pre-rolled, and the projectile is pushed to the array. No HP change yet.

**Boss projectile impact (new step):** On the impact tick, iterate projectiles. For each boss projectile arriving this tick: check the player's current prayer, compute final damage (protected vs unprotected), apply to `player.hp`, create hit splat, mark as impacted.

**Player attack (step 6):** Currently rolls accuracy and damage, then applies to `boss.hp`. This becomes: roll accuracy and damage as before, create a player projectile with the final damage, push to array. No HP change yet.

**Player projectile impact (same new step):** On the impact tick, apply the pre-rolled damage to `boss.hp`, create hit splat, mark as impacted.

### Impact on Death Checks

Death checks (step 8) must now account for projectile-delivered damage. Since projectile resolution happens as a new step before player attacks, a boss projectile that kills the player on tick N will correctly trigger `state = 'lost'` before the player's tick-N attack fires. This matches OSRS behavior where you can die before your attack lands.

However, there is an edge case: if the player fires on tick N and the boss fires on tick N, both projectiles travel for 1 tick. On tick N+1, both resolve. If the boss projectile kills the player and the player projectile kills the boss on the same tick, who wins? In OSRS, both deaths can occur simultaneously (the player still gets the kill). Resolve both projectiles before checking death. This is already the natural behavior if projectile resolution is a single loop before death checks.

### Impact on Hit Splats

Hit splats currently carry `x, y, tickCreated`. No changes to the `HitSplat` interface are needed. The only change is when they are created: on the impact tick instead of the fire tick. The `x, y` coordinates are the target's position at impact time (for boss projectiles, `player.pos` at impact; for player projectiles, `boss.center`).

### Projectile ID Generation

Use a simple monotonic counter on `GameSimulation`:

```typescript
private nextProjectileId: number = 0;

private createProjectile(partial: Omit<Projectile, 'id'>): Projectile {
  return { ...partial, id: this.nextProjectileId++ };
}
```

The ID is useful for debugging and for the renderer to track projectiles across frames if animation smoothing is added later.

### Future Extension Points

**Tornados:** A tornado is conceptually a projectile with `travelTicks = Infinity` (it persists until removed), a per-tick position update rule (chase the player), and a per-tick damage check (if it overlaps the player, deal damage). The `Projectile` interface can be extended with an optional `updatePosition(tick): Position` callback, or tornados can be a separate entity type that shares the same array and lifecycle pattern.

**Floor tile effects:** Corrupted tiles, safe tiles, etc. These are positional entities with tick-based lifetimes. They follow the same create/advance/cleanup pattern. If they share the projectile array, the `source` and `style` fields distinguish them. If they deserve their own array (likely, since they do not travel), the pattern is identical: `floorEffects: FloorEffect[]` with `tickCreated`, `tickExpires`, and per-tick checks.

The projectile system establishes the "entity array with tick-based lifecycle" pattern that both of these future features will reuse.

---

## Implementation

### Phase 1: Projectile Type Definitions

Define the data model for projectiles.

| File | Action | Description |
|------|--------|-------------|
| `src/entities/types.ts` | Modify | Add `Projectile` interface with `id`, `source`, `style`, `origin`, `target`, `tickCreated`, `tickImpact`, `payload`, `state`. Add `ProjectilePayload` as a discriminated union: `BossProjectilePayload` (carries `attackStyle`, `unprotectedDamage`, `protectedMaxHit`) and `PlayerProjectilePayload` (carries pre-rolled `damage`). Export `PROJECTILE_TRAVEL_TICKS = 1` constant. |

### Phase 2: Projectile Array and Creation

Add the projectile array to the simulation and create projectiles on attack.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | Add `projectiles: Projectile[]` field and `nextProjectileId` counter. In the boss attack block (current step 5), replace immediate damage application with projectile creation: roll `unprotectedDamage` against `UNPROTECTED_MAX_HIT`, store `protectedMaxHit` from the armor tier, set `tickImpact = tick + PROJECTILE_TRAVEL_TICKS`, push to array. In the player attack block (current step 6), replace immediate `boss.hp` reduction with projectile creation: pre-roll damage as before, store final damage in payload, set `tickImpact = tick + PROJECTILE_TRAVEL_TICKS` (or `tick` for melee), push to array. |

### Phase 3: Projectile Resolution

Add the impact resolution step to the tick loop.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | Insert a new step between boss AI and player attack: iterate `projectiles` where `tick >= tickImpact && state === 'traveling'`. For boss projectiles: check `prayerManager.activePrayer` against `payload.attackStyle`, compute final damage as `min(unprotectedDamage, protectedMaxHit)` if protected or `unprotectedDamage` if not, apply to `player.hp`, create hit splat at `player.pos`, set `state = 'impacted'`. For player projectiles: apply `payload.damage` to `boss.hp`, create hit splat at `boss.center`, set `state = 'impacted'`. |

### Phase 4: Projectile Cleanup

Remove resolved projectiles from the array.

| File | Action | Description |
|------|--------|-------------|
| `src/engine/GameSimulation.ts` | Modify | At the end of `processTick`, filter the projectile array: remove projectiles where `state === 'impacted'` and `tick - tickImpact >= 1`. This gives the renderer one tick to show impact effects before removal. Alternatively, remove immediately after resolution if no impact visual is needed (the hit splat already covers the impact frame). |

### Phase 5: Renderer — Projectile Drawing

Draw projectiles on the canvas between entities and hit splats.

| File | Action | Description |
|------|--------|-------------|
| `src/render/Renderer.ts` | Modify | After drawing entities and overhead icons, iterate `sim.projectiles`. For each projectile in `'traveling'` state: compute interpolated pixel position using `lerp` between `origin` and `target` based on `(sim.tick - tickCreated) / (tickImpact - tickCreated)`. Draw shape based on style: angular shard for boss ranged (teal-green diamond rotated toward target), glowing circle for boss magic (purple with alpha glow), arrow line for player ranged (green thin line with triangular head), small orb for player magic (cyan circle), arc slash for player melee (silver arc near boss). Use `ctx.save()`/`ctx.restore()` and `ctx.translate()`/`ctx.rotate()` for directional shapes. |

### Phase 6: Test Updates

Update existing tests for deferred damage and add projectile-specific tests.

| File | Action | Description |
|------|--------|-------------|
| `tests/` (existing test files) | Modify | Any test that asserts immediate damage from boss/player attacks must account for 1-tick delay. Tests that call `processTick()` once and check `player.hp` or `boss.hp` may need an additional `processTick()` for the projectile to land. Tests that use `runTicks(n)` are likely unaffected since they process many ticks. Review and update assertions for the deferred model. |
| `tests/projectile.test.ts` | Create | Test projectile creation on boss attack: verify projectile appears in array with correct fields. Test projectile impact on next tick: verify damage applied and hit splat created. Test boss projectile prayer check at impact: fire projectile on tick N with ranged style, switch prayer to missiles on tick N, verify protected damage on tick N+1. Test player projectile pre-rolled damage: verify boss HP changes on impact tick, not fire tick. Test melee zero-travel: verify damage applies same tick. Test multiple simultaneous projectiles. Test projectile cleanup: verify array is empty after impact + 1 tick. |

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `src/entities/types.ts` | Modify | 1 |
| `src/engine/GameSimulation.ts` | Modify | 2, 3, 4 |
| `src/render/Renderer.ts` | Modify | 5 |
| Existing test files | Modify | 6 |
| `tests/projectile.test.ts` | Create | 6 |

**Modified files:** 4 | **New files:** 1

---

## Definition of Done

1. **Projectile type defined** -- `Projectile` and `ProjectilePayload` interfaces exist in `src/entities/types.ts` with all fields described in the architecture section.
2. **Boss ranged projectile** -- When Hunlef fires a ranged attack, a projectile with `style: 'ranged'` and `source: 'boss'` is created. A teal-green crystal shard renders traveling from boss center to player position.
3. **Boss magic projectile** -- When Hunlef fires a magic attack, a projectile with `style: 'magic'` and `source: 'boss'` is created. A purple orb renders traveling from boss center to player position.
4. **Player bow projectile** -- When the player fires a bow, a projectile with `style: 'ranged'` and `source: 'player'` is created. A green arrow renders traveling from player to boss center.
5. **Player staff projectile** -- When the player fires a staff, a projectile with `style: 'magic'` and `source: 'player'` is created. A cyan orb renders traveling from player to boss center.
6. **Player halberd slash** -- When the player attacks with a halberd, a silver arc renders near the boss. Damage resolves immediately (zero travel time).
7. **Deferred boss damage** -- Boss attack damage is not applied on the fire tick. It is applied on `tickCreated + 1` (the impact tick). `player.hp` does not change until the projectile lands.
8. **Prayer checked at impact** -- For boss projectiles, the player's active protection prayer is evaluated on the impact tick, not the fire tick. Switching prayer between fire and impact changes the damage outcome.
9. **Pre-rolled player damage** -- Player attack accuracy and damage are rolled on the fire tick. The projectile carries the final damage number. `boss.hp` changes on the impact tick.
10. **Hit splats at impact** -- Hit splats are created when the projectile resolves, not when the attack fires. The splat position is the target's position at impact time.
11. **Projectile cleanup** -- Resolved projectiles are removed from the array within 1 tick of impact. The array does not grow unboundedly.
12. **All 125 existing tests pass** -- No regressions. Tests that previously asserted immediate damage are updated to account for the 1-tick delay.
13. **New projectile tests** -- At minimum: creation on attack, impact resolution, prayer-at-impact check, melee instant resolution, cleanup, and multi-projectile coexistence.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deferred damage breaks many of the 125 existing tests that assert immediate HP changes | High | This is the highest-risk change. Audit all tests that check `player.hp` or `boss.hp` after attacks. Most `runTicks(n)` tests process enough ticks that the 1-tick delay is absorbed. Single-tick tests need an extra `processTick()` call. Consider adding a `resolveProjectiles()` helper for test convenience. |
| Prayer-at-impact changes combat balance (player has one extra tick to react) | Medium | This is intentional and OSRS-accurate. Document the behavior change. The practice tool becomes more faithful, not less. Verify that the 10-tick boss attack cycle timing still feels correct with the 1-tick delay. |
| Melee instant-damage special case adds branching complexity | Low | Melee is modeled as a zero-travel projectile (`tickImpact === tickCreated`). It resolves in the same projectile resolution step, requiring no special case in the resolution loop. The only special case is in the renderer (arc vs traveling shape). |
| Projectile array grows if cleanup is buggy | Low | Projectiles have a maximum lifetime of `PROJECTILE_TRAVEL_TICKS + 1` ticks (2 ticks). The cleanup filter is simple: `state === 'impacted' && tick - tickImpact >= 1`. Add a defensive cap: if `projectiles.length > 20`, force-clear old entries (should never trigger in normal play with 1 boss and 1 player). |
| Interpolation looks wrong with 1-tick travel (projectile only visible for 1 frame) | Low | With a 600ms tick interval and one render per tick, the projectile is visible for one frame at its origin. This may look like a flash rather than travel. Acceptable for a practice tool. If it looks bad, increase `PROJECTILE_TRAVEL_TICKS` to 2 for visual clarity (at the cost of a longer damage delay). The constant is trivially adjustable. |

---

## Dependencies

- **Sprint 4 complete** -- 125 tests passing, click-to-attack targeting, offensive prayers, countdown phase.
- **`hitSplats` array pattern** -- The projectile array follows the same lifecycle: push on creation, filter on age, public for the renderer. No new patterns introduced.
- **`Boss.fireAttack()`** -- Returns the `AttackStyle` used. No modification needed; the caller (GameSimulation) changes what it does with the return value.
- **`Boss.center` and `Player.pos`** -- Used as origin/target positions for projectiles. Already exist.
- **Combat formulas** -- `hitChance`, `npcDefenceRoll`, max hit functions are already used in step 6. They continue to be called at fire time; their results are stored in the projectile payload.

---

## Open Questions

1. **Should boss projectile damage be pre-rolled or rolled at impact?** The architecture section proposes pre-rolling the unprotected damage and storing the protected max hit, then choosing at impact based on prayer. An alternative is to store the RNG call index and replay it at impact. The pre-roll approach is simpler and avoids coupling to RNG state. Recommendation: pre-roll with the dual-value approach described above.

2. **Should `PROJECTILE_TRAVEL_TICKS` be 1 or 2?** 1 tick is simpler and means the combat timing shifts by exactly one tick. 2 ticks gives more visual travel time (two render frames) and a wider prayer-switch window, but shifts timing further from instant. OSRS projectile travel varies (1-3 ticks depending on distance). Recommendation: start with 1 tick. If the visual is too brief, increase to 2 as a constant change.

3. **Should the Renderer interpolate within a tick using requestAnimationFrame?** The intent document says no: renders happen once per tick, no interpolation. This means projectiles "jump" between positions. With 1-tick travel, there is only one position (origin), then impact. Recommendation: honor the constraint. Sub-tick interpolation is a future enhancement if the visual feels too static.

4. **Should the projectile carry a reference to the target entity or a snapshot position?** If the target moves between fire and impact (player walks), should the projectile track them or hit where they were? In OSRS, projectiles track the target. With 1-tick travel and 1-tile-per-tick movement, the difference is at most 1 tile. Recommendation: resolve at the target's current position at impact time (not the position at fire time). Store `targetEntity: 'boss' | 'player'` and look up the position at resolution time.

5. **How does this interact with the stomp check?** Stomp is a position-based check that happens after player attack resolution (step 7). It applies damage instantly (no projectile). This is correct: stomping is not a ranged attack, it is a proximity effect. No change needed.

6. **Should player projectiles also defer the boss protection prayer check?** In OSRS, the player's accuracy roll happens at fire time, not impact. The boss protection prayer is checked at fire time as part of `processPlayerHit()`. This means the player cannot "trick" the boss by firing and then the boss switching prayer. Recommendation: keep player accuracy and protection checks at fire time. The projectile only defers the visual and HP application, not the combat roll.
