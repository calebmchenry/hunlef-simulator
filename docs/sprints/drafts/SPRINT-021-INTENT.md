# Sprint 021 Intent: Corrupted Hunlef Mechanic Accuracy Pass

## Seed Prompt

From `missing-mechanics.md` (user's raw notes):

1. Tornadoes should start in different corners of the arena (not near boss)
2. Prayer-disabling magic attack should exist (purple colored, vs red for normal magic)
3. Style-switch animation should happen 2 ticks after the previous attack
4. Tornadoes' initial spawn happens too soon
5. Missing tornado summoning stomp animation
6. Attack animation might be wrong — needs research against real OSRS fights

## Orientation Summary

- **Project**: CG-sim — OSRS Corrupted Gauntlet boss fight simulator with 3D rendering, tick-based combat (600ms ticks), and morph-target GLTF animations
- **Recent sprints** (015-020): Visual polish — player models, animation fixes, morph target scaling. The engine mechanics haven't been touched since Sprint 012.
- **Key files**: `Boss.ts` (attack cycle, `fireAttack()` returns style or `'tornado'`), `GameSimulation.ts` (tick processing, `spawnTornadoes()` spawns near boss, projectile creation), `AnimationController.ts` (has stomp/prayer_disable states already mapped but unused), `Renderer3D.ts` (animation triggering in `updateBossAnimations()`)
- **Constraints**: Deterministic seeded RNG; cg-sim-player is read-only (must not break its tests); existing animation states `stomp` and `prayer_disable` exist in AnimationController but are never triggered

## Relevant Codebase Areas

### Tornado Spawning
- `GameSimulation.ts:669-698` — `spawnTornadoes()`: finds walkable tiles within 2 tiles of boss footprint edge, randomly picks positions
- `Boss.ts:88-107` — `fireAttack()`: tornado fires on odd cycles (`cycleCount % 2 === 1`), first attack (`attackCounter === 0`)
- `Tornado.ts` — simple entity with 20-tick lifetime

### Boss Attack Cycle
- `Boss.ts:14-18` — State: `currentStyle` (ranged/magic), `attackCounter` (0-3), `cycleCount`, `attackCooldown` (5 ticks)
- `Boss.ts:88-107` — `fireAttack()`: 4 attacks per style, alternates ranged↔magic, tornado on odd cycle first attack
- `GameSimulation.ts:332-391` — Boss attack resolution: creates projectile with travel delay, colors: ranged=#44cc44, magic=#aa44cc

### Animation System
- `AnimationController.ts:7` — `AnimState` includes `'stomp'` and `'prayer_disable'` (both mapped to OSRS seq IDs 8432, 8433)
- `AnimationController.ts:117-120` — `playStomp()` exists but is never called
- `Renderer3D.ts:1068-1095` — `updateBossAnimations()`: triggers attack animation on projectile fire, style-switch on style change. No stomp trigger, no prayer-disable trigger, no delay for style-switch.

### OSRS Mechanics (from wiki/videos)
- **Tornado spawning**: In OSRS, tornadoes spawn in the four corners of the arena, not near the boss
- **Prayer-disable attack**: The Corrupted Hunlef has a special attack that disables the player's protection prayers. It's a magic-based attack colored differently (purple/dark). It fires on specific rotation points.
- **Style-switch timing**: The Hunlef's style-switch animation plays with a delay after the last attack of the previous set
- **Stomp/tornado summon**: The boss plays a stomp animation when summoning tornadoes

## Constraints

1. **Deterministic RNG** — any new random elements must use the existing `this.rng` in order
2. **cg-sim-player readonly** — cannot modify, but `cd ../cg-sim-player && npm test` must pass
3. **Existing animation states** — `stomp` and `prayer_disable` are already in the GLTF and AnimationController; just need to be triggered
4. **No new dependencies** — pure logic/rendering changes
5. **Projectile color convention** — ranged is green (#44cc44), magic is purple (#aa44cc). Prayer-disable should be visually distinct (deeper purple or different shape)

## Success Criteria

1. Tornadoes spawn in arena corners (not adjacent to boss)
2. Prayer-disable attack exists and visually fires a distinct purple projectile
3. Prayer-disable attack actually disables the player's active protection prayer on hit
4. Stomp animation plays when boss summons tornadoes
5. Style-switch animation has a 2-tick delay after the last attack of a cycle
6. All existing tests pass
7. cg-sim-player tests pass
8. No regression in idle/attack/death animations

## Verification Strategy

- Unit tests for prayer-disable mechanic (prayer gets cleared on hit)
- Unit tests for tornado corner spawning
- Playwright screenshots showing: stomp animation during tornado summon, purple prayer-disable projectile, corner tornado spawns
- `npm run build && npm test`
- `cd ../cg-sim-player && npm test`

## Uncertainty Assessment

| Factor | Level | Reasoning |
|--------|-------|-----------|
| **Correctness** | Medium | OSRS mechanics are documented on wiki but nuances (exact prayer-disable rotation, exact corner positions) need verification |
| **Scope** | Medium | 6 distinct mechanic changes — individually small but touching multiple systems |
| **Architecture** | Low | All changes extend existing patterns (Boss.ts attack cycle, AnimationController states, GameSimulation tick processing) |

## Open Questions

1. **Prayer-disable rotation**: In OSRS, when exactly does the prayer-disable attack fire? Is it every N attacks? On specific cycle points? The user's notes say it should "match the OSRS mechanic" — need to determine the exact pattern.
2. **Tornado corner positions**: Exact corner tiles? One per corner, or clustered near corners?
3. **Tornado spawn delay**: User says they spawn "too soon" — should there be a tick delay between the stomp animation and actual tornado appearance?
4. **Attack animation accuracy**: User suspects the attack animation might be wrong. This may require visual research that's hard to validate programmatically. Should we defer this to a separate sprint or attempt it here?
5. **Style-switch delay implementation**: Does the 2-tick delay mean the animation plays 2 ticks later, or the actual style change is delayed 2 ticks? (Animation-only vs gameplay impact)
