# Sprint 005 Intent: Projectile Animations — Crystal Spikes, Magic Balls, Arrows

## Seed

Add projectile animations for both player and Hunlef attacks. Hunlef fires crystal spikes (ranged) and magic balls (magic). Player fires arrows (bow), magic projectiles (staff), and melee swings (halberd). Projectiles travel across the canvas from source to target over 1-2 ticks.

## Context

- **Sprint 4 complete**: 125 tests, offensive prayers, click-to-attack, 10-tick countdown.
- **Renderer** draws once per tick (600ms). No animation/interpolation between ticks. No projectile system.
- **Damage is instant**: Currently when boss/player attacks, damage resolves same tick. Projectiles should add visual travel time.
- **Canvas rendering**: 48px tiles, 576x576. Entities are colored rectangles. Hit splats exist as simple canvas drawings.
- **Key question**: Should projectile travel delay damage (OSRS-accurate) or be purely visual? For a practice tool, delayed damage matters for prayer switching timing.

## Projectile Types

### Hunlef Projectiles
| Style | Visual | Color |
|-------|--------|-------|
| Ranged | Crystal spike / sharp shard | Green/teal, angular shape |
| Magic | Magic orb / energy ball | Purple/dark magenta, glowing circle |

### Player Projectiles
| Weapon | Visual | Color |
|--------|--------|-------|
| Bow (ranged) | Arrow / bolt | Green, thin line with arrowhead |
| Staff (magic) | Magic blast | Blue/cyan, glowing orb |
| Halberd (melee) | Slash/swing arc | White/silver, arc near boss (no travel) |

## Relevant Codebase

- `src/render/Renderer.ts` — Add projectile drawing between entities and hit splats
- `src/engine/GameSimulation.ts` — Create projectile entities on attack, resolve damage on impact
- `src/entities/types.ts` — Define Projectile interface
- `src/entities/Boss.ts` — Attack creates projectile instead of instant damage
- Existing `hitSplats` array pattern can be extended for projectiles

## Constraints

- Zero runtime deps, canvas 2D only
- No requestAnimationFrame interpolation (renders once per tick) — projectiles update position each tick
- Projectile travel time: 1 tick for close range, 2 ticks for far range (or fixed 1 tick for simplicity)
- Melee has no projectile — show a slash effect near the target instead
- Must not break 125 existing tests

## Success Criteria

1. Hunlef ranged attack shows green crystal spike traveling from boss to player
2. Hunlef magic attack shows purple magic orb traveling from boss to player
3. Player bow attack shows arrow traveling from player to boss
4. Player staff attack shows magic blast traveling from player to boss
5. Player halberd attack shows slash arc near the boss (no travel)
6. Projectiles travel over 1 tick (600ms per frame movement)
7. Damage applies when projectile reaches target (not on fire tick)
8. Hit splats appear at impact, not at launch

## Uncertainty Assessment

- **Correctness: Low** — Visual feature, no complex game rules
- **Scope: Low** — Bounded to rendering + projectile entity management
- **Architecture: Medium** — Need a projectile array and per-tick position updates, damage delay changes combat timing slightly
