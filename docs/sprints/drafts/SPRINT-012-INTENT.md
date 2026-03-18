# Sprint 012 Intent: Fix Eat Delay & Boss Attack Speed Fidelity

## Seed

Fix eat delay mechanic and audit boss attack speed for OSRS fidelity. cg-sim-player report (100 seeds) shows 780 `attack_cooldown` warnings — all from player eating food but attacking at the normal 4-tick cadence instead of being delayed. Also audit whether boss attack speed should be 5 ticks (current) or 6 ticks (real OSRS wiki value).

## Context

- **Eat delay bug:** `GameSimulation.ts` line 397 checks `!this.playerAteThisTick` to prevent attacking on the same tick as eating. But it does NOT push `player.attackCooldown` forward. In real OSRS, eating non-combo food resets the attack cooldown to `max(current, 3)`, meaning the next attack is delayed by at least 3 ticks from the eat tick.
- **Current behavior:** Player eats on tick N, attack blocked on tick N, but if cooldown was already 0, the player fires on tick N+1 (only 1 tick "delay" instead of 3).
- **Expected behavior:** Player eats on tick N, `attackCooldown` set to `max(attackCooldown, 3)`, next attack fires on tick N+3 at earliest.
- **Boss attack speed:** INTENT.md specifies 5 ticks (3.0s). The OSRS wiki lists Corrupted Hunlef at 6 ticks (3.6s). The cg-sim-player reference also uses 5. This discrepancy needs a decision.
- **Combo food (corrupted paddlefish):** Already handled correctly — `comboFood` flag skips setting `playerAteThisTick`, so no delay is applied. This should remain unchanged.

## Recent Sprint Context

- **Sprint 011** (just completed): Fixed GLTF material handling and boss model facing. Rendering-only changes.
- **Sprints 001-010**: Built the full simulator — tick engine, combat, prayers, inventory, 3D rendering, floor hazards, tornadoes.
- **cg-sim-player**: Separate project that headlessly runs fights and validates 12 mechanics categories. Currently 47 tests, all passing. 100/100 wins with benchmark loadout.

## Relevant Codebase Areas

| File | Role |
|------|------|
| `src/engine/GameSimulation.ts` | Tick processing: eat action at L580-587, attack gate at L394-397, cooldown decrement at L394-396 |
| `src/entities/Player.ts` | Player state including `attackCooldown` |
| `src/entities/Boss.ts` | Boss `attackSpeed: 5` and `attackCooldown` logic |
| `docs/INTENT.md` | Project design doc — specifies 5-tick boss speed, 1-tick eat delay |
| `cg-sim-player/src/report/mechanics/reference.ts` | Independent mechanics reference (oracle) — `boss.attackSpeedTicks: 5`, `player.attackSpeedTicks: 4` |
| `cg-sim-player/src/report/mechanics/validators/attackCooldown.ts` | Validator detecting the warnings |

## Constraints

- Must keep all 178 cg-sim tests passing
- Must keep all 47 cg-sim-player tests passing (including 100-seed integration tests with 0 critical findings)
- Combo food (corrupted paddlefish) must remain instant — no eat delay
- The cg-sim-player reference.ts must stay in sync with any changes to attack speed
- The eat delay fix must not break the bot's win rate (currently 100/100)

## Success Criteria

1. **Eat delay works correctly** — eating standard food sets `attackCooldown = max(attackCooldown, 3)`, delaying the next attack
2. **Combo food unaffected** — corrupted paddlefish still has zero eat delay
3. **cg-sim-player reports 0 attack_cooldown warnings** across 100 seeds after fix
4. **Boss attack speed is correct** — either confirmed at 5 ticks with justification, or updated to 6 ticks if the decision is to match real OSRS
5. **All tests pass** — 178 cg-sim + 47 cg-sim-player

## Verification Strategy

- **Primary:** `cd ../cg-sim-player && npm run run -- --fights 100 --start-seed 1` should show 0 warnings
- **Secondary:** `npm test` in both cg-sim and cg-sim-player
- **Edge cases:**
  - Eating on the same tick attack would fire (cooldown already at 0)
  - Eating multiple ticks before attack would fire (cooldown > 3, should NOT be affected)
  - Combo eating: standard + corrupted paddlefish same tick (standard delays, corrupted doesn't)
  - Player eating while out of range (eat delay still applies to cooldown)

## Uncertainty Assessment

- **Correctness uncertainty: Medium** — The eat delay value (3 ticks) is well-documented in OSRS, but the exact implementation (does it reset cooldown or add to it?) needs verification. The boss attack speed question (5 vs 6) requires a design decision.
- **Scope uncertainty: Low** — Two clearly bounded changes: eat delay fix + boss speed audit
- **Architecture uncertainty: Low** — Extends existing patterns, no new modules

## Open Questions

1. **Boss attack speed: 5 or 6 ticks?** The INTENT.md says 5, the OSRS wiki says 6 for Corrupted Hunlef. Should we match real OSRS or keep the current design? This affects fight pacing and difficulty.
2. **Eat delay value:** In real OSRS, eating standard food imposes a 3-tick delay. Should we use exactly 3, or should it be configurable?
3. **Should the cg-sim-player bot strategy be updated?** The bot currently eats during combat; with proper eat delay, its DPS will drop slightly. Does the bot need to be smarter about when it eats (e.g., eat between attacks to minimize lost ticks)?
