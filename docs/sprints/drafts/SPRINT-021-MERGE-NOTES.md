# Sprint 021 Merge Notes

## Draft Strengths Adopted

### From Claude Draft
- **Deterministic prayer-disable slot**: One prayer-disable per magic phase, slot chosen via RNG at phase start. Avoids per-attack probability rolls that are harder to test.
- **Concrete implementation detail**: Near-copy-paste code snippets, specific line numbers, explicit function signatures.
- **`disablesPrayer` flag on Projectile**: Clean side-channel that preserves `style: 'magic'` for damage calc.
- **Tornado spawn delay via `pendingTornadoSpawnTick`**: Simple 1-tick delay with stomp animation on summon tick.

### From Codex Draft
- **Non-blocking style switch**: `pendingStyleSwitch` with `triggerTick` — style doesn't flip for 2 ticks but `attackCooldown` keeps ticking. Preserves 5-tick DPS cadence.
- **`ProjectileEffect` type**: Cleaner than a boolean flag — extensible if more effects are added later.
- **Event-based animation dispatch**: Replace projectile-scanning heuristic with explicit tick fields on GameSimulation.
- **Stomp cadence fix**: Move stomp from every-tick occupancy to boss attack cadence. Stomp doesn't count toward 4-attack cycle.
- **Animation priority order**: death > style switch > prayer disable > tornado stomp > stomp attack > standard attack.

### From Gemini Draft
- **`activeTick` on Tornado**: Simple approach to delay tornado movement — add field, skip movement/damage when `tick < activeTick`. Simpler than Codex's scheduler.

## Critiques Accepted

1. **Claude critique of Gemini**: Renderer-only style delay is a desync between sim and visual — rejected in favor of simulation-level delay.
2. **Claude critique of Gemini**: `prayerManager.activePrayer = 'none'` is a type error — use `deactivate()` instead.
3. **Claude critique of Gemini**: Stomp trigger via `tornadoes.length` is fragile — use explicit event field instead.
4. **Codex critique of Claude**: Attack cooldown pausing changes DPS — adopted non-blocking approach instead.
5. **Codex critique of Claude**: Corner offsets consume extra RNG calls — dropped offsets entirely, one `rng.nextInt(0, 3)` per tornado to select corner.
6. **Gemini critique of Claude**: `initMagicPhase()` slot distribution is biased (slot 1 twice as likely when tornado occupies slot 0) — fix by picking from `[1,2,3]` when slot 0 is taken.
7. **All critiques**: RNG call count changes will break cg-sim-player — user decided to accept seed breakage and re-baseline.

## Critiques Rejected

1. **Codex Phase 0 "mechanics lock"**: User wants to proceed with reasonable defaults, not block on VOD research. Using deterministic slot for prayer-disable, 1-tick tornado delay, 2-tick style switch.
2. **Claude critique suggesting `disableProtection()` method**: User chose to use existing `deactivate()` (clears all prayers) for simplicity.
3. **Gemini critique suggesting renderer-only style delay**: User explicitly chose simulation-level non-blocking delay.

## Interview Refinements Applied

1. **Style-switch**: Simulation-level, non-blocking. `currentStyle` deferred for 2 ticks, `attackCooldown` keeps ticking.
2. **RNG strategy**: Accept seed breakage, re-baseline cg-sim-player after merge.
3. **Stomp fix**: In scope — move to attack cadence, don't count toward 4-attack cycle.
4. **Prayer-disable scope**: All prayers via `deactivate()`.

## Key Design Decisions

- **Prayer-disable slot**: One per magic phase, random slot 0-3, shifted if tornado occupies same slot. Uses one `rng.next()` call at magic phase start.
- **Tornado corners**: Exactly `ARENA_CORNERS[rng.nextInt(0, 3)]` per tornado — one RNG call per tornado, no offsets.
- **Normal magic color stays `#aa44cc`**: Prayer-disable gets `#6622aa` (deeper purple). No change to existing projectile colors.
- **`fireAttack()` signature stays clean**: No `rngNext` or `currentTick` params. GameSimulation owns RNG and timing. Boss returns attack type, GameSimulation does the prayer-disable roll.
