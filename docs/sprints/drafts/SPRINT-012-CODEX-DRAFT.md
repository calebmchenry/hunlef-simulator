# Sprint 012: Fix Eat Delay and Boss Attack Speed Fidelity

## Overview

Sprint 012 should correct a real combat-timing bug in the simulator and then resolve a lingering source-of-truth mismatch around boss cadence.

The bug is in `GameSimulation.processTick()` and `processInventoryAction()`. Regular food currently marks `playerAteThisTick` in `src/engine/GameSimulation.ts:575-587`, and the player attack gate later checks `!this.playerAteThisTick` at `src/engine/GameSimulation.ts:397`, but no code actually extends `player.attackCooldown`. As implemented, eating only blocks the attack on the eat tick; it does not enforce the intended post-eat delay. Because the same method decrements cooldown at `src/engine/GameSimulation.ts:394-395` and resets it after a shot at `src/engine/GameSimulation.ts:491`, the fix must respect the current tick order, not just add a boolean check.

The boss cadence question is separate but coupled to fidelity. `Boss.attackCooldown` and `Boss.attackSpeed` are both pinned to `5` at `src/entities/Boss.ts:16-17`, `Boss.fireAttack()` resets to `this.attackSpeed` at `src/entities/Boss.ts:89-101`, and `Boss.reset()` hardcodes `5` again at `src/entities/Boss.ts:117-123`. `docs/INTENT.md:123` also declares `5 ticks (3.0 s)`. If the project stays at 5, that needs an explicit justification. If the project moves to 6 for OSRS fidelity, the simulator, docs, tests, and the sibling `cg-sim-player` oracle all need to change together.

One downstream issue is already visible: `cg-sim-player` is not just consuming simulator output, it is validating it with older assumptions. `attackCooldownValidator.validate()` currently computes `expectedInterval = reference.player.attackSpeedTicks + eatDelayTicks` at `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts:64-66`, which models “+1 tick per eat” rather than the stricter cooldown reset described in this sprint. That validator needs to be updated in the same sprint or it will keep misclassifying correct traces.

## Use Cases

1. Player attacks on tick `N`, then eats a standard paddlefish on a later tick where their weapon would otherwise be ready soon. The next player attack does not occur until the post-eat cooldown is satisfied.
2. Player eats a standard paddlefish on the exact tick their attack would have fired. The attack is skipped on that tick, and the next legal attack is at least 3 ticks later.
3. Player eats while their attack cooldown is still long enough that food should not add extra delay. The simulator preserves that longer cooldown instead of shortening it.
4. Player combo-eats a paddlefish plus corrupted paddlefish. Healing still stacks, but only the standard fish applies the action-slot delay.
5. Player eats only a corrupted paddlefish. Healing occurs with no attack-delay side effect.
6. Boss continues to fire at a single canonical cadence across startup, normal attacks, and reset logic.
7. `cg-sim-player` 100-seed validation reports zero false-positive `attack_cooldown` warnings after the simulator fix.

## Architecture

### Player attack-delay architecture

Current flow:

`queued inventory actions -> processInventoryAction() marks playerAteThisTick -> processTick() decrements player.attackCooldown -> attack gate checks !playerAteThisTick`

That flow is insufficient because the only state carried out of `processInventoryAction()` is the boolean flag. The cooldown itself remains unchanged.

Target flow:

`queued inventory actions -> processInventoryAction() applies healing/inventory mutation and records whether a regular food was eaten -> processTick() performs the normal cooldown decrement -> if playerAteThisTick, clamp the remaining cooldown to a minimum of 3 -> attack gate runs`

The important design point is ordering. Because `processTick()` already decrements `player.attackCooldown` before checking the attack gate (`src/engine/GameSimulation.ts:394-397`), the regular-food delay should be applied after that decrement, not inside `processInventoryAction()`. If the sprint writes `player.attackCooldown = Math.max(player.attackCooldown, 3)` inside `processInventoryAction()` before line 394, the same-tick decrement will immediately reduce it and the player will still attack too early. The clean fix is to keep `processInventoryAction()` as the place that identifies “standard vs combo food”, but apply the cooldown clamp inside `processTick()` just before the attack gate.

### Boss cadence architecture

`Boss.fireAttack()` already uses `this.attackSpeed` as the reset source at `src/entities/Boss.ts:101`. The class is still brittle because startup and reset use raw literals at `src/entities/Boss.ts:16-17` and `src/entities/Boss.ts:122`. Sprint 012 should normalize boss cadence to one canonical value inside `Boss`, then mirror that same value in `docs/INTENT.md` and `cg-sim-player`’s reference model.

### Validator architecture

`cg-sim-player` already records the data needed for a correct validator:

- `observeSimulation()` captures `playerAttackCooldown` at `../cg-sim-player/src/bot/observe.ts:84`.
- `TraceRecorder.recordTick()` stores `playerAteThisTick` at `../cg-sim-player/src/report/TraceRecorder.ts:8-52`.
- `TickTraceRow` includes both fields at `../cg-sim-player/src/report/types.ts:29-40`.

That means Sprint 012 does not need a trace-schema change. The validator can compute the extra delay contributed by each regular-food tick from the observed pre-tick cooldown instead of approximating with “one eat = one extra tick.”

## Implementation

### Phase 1: Fix the simulator’s regular-food cooldown handling

Files:

- `src/engine/GameSimulation.ts`
- `src/__tests__/inventory.test.ts`

Tasks:

- [ ] Keep `processInventoryAction()` focused on healing and inventory mutation, but make its role explicit: at `src/engine/GameSimulation.ts:580-587`, regular food should continue to set `playerAteThisTick`, and combo food should continue to skip it.
- [ ] Update `GameSimulation.processTick()` at `src/engine/GameSimulation.ts:394-397` so the player cooldown sequence becomes:
  - normal decrement if `attackCooldown > 0`
  - if `playerAteThisTick`, clamp `player.attackCooldown` to at least `3`
  - only then evaluate whether the player may attack
- [ ] Add a small local constant in `GameSimulation.ts` for the food delay instead of another anonymous `3`. A name like `STANDARD_FOOD_MIN_ATTACK_COOLDOWN` is sufficient.
- [ ] Do not change `Inventory.useItem()` in `src/entities/Inventory.ts:116-135`; it already distinguishes standard and combo food correctly through `comboFood`.
- [ ] Extend `src/__tests__/inventory.test.ts`, currently light on cadence assertions at `src/__tests__/inventory.test.ts:181-226`, with deterministic attack-cooldown tests:
  - `standard food when cooldown is 0 delays next attack by 3 ticks`
  - `standard food preserves longer cooldowns instead of shortening them`
  - `corrupted paddlefish does not alter attack cooldown`
  - `combo-eat applies only one regular-food delay`
  - `standard food delay still applies when player is already in range and attacking`
- [ ] Isolate those tests from unrelated boss damage by continuing the existing pattern of forcing `sim.boss.attackCooldown = 100` and positioning the player explicitly, as seen at `src/__tests__/inventory.test.ts:204`, `:218`, `:232`, `:243`, and `:258`.

### Phase 2: Repair the downstream oracle and validator

Files:

- `../cg-sim-player/src/report/mechanics/reference.ts`
- `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts`
- `../cg-sim-player/tests/unit/validators/attackCooldown.test.ts`

Tasks:

- [ ] Add an explicit food-delay reference to `CG_MECHANICS_REFERENCE` in `../cg-sim-player/src/report/mechanics/reference.ts:25-30` or `:80-105` so the validator is not forced to hardcode `3`. This should live alongside other mechanical constants, not buried inside validator logic.
- [ ] Replace the current `eatDelayTicks` count in `attackCooldownValidator.validate()` at `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts:64-66`.
- [ ] Compute the extra delay contributed by each regular-food tick from the observed cooldown state. The validator can derive:
  - `cooldownAfterNaturalTick = max(row.pre.playerAttackCooldown - 1, 0)`
  - `extraDelay = max(0, regularFoodMinCooldown - cooldownAfterNaturalTick)`
  - `expectedInterval = baseAttackSpeed + sum(extraDelay across regular-food rows)`
- [ ] Keep the current ambiguity guard at `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts:60-62` so the validator still skips intervals polluted by movement or cleared attack targets.
- [ ] Expand `../cg-sim-player/tests/unit/validators/attackCooldown.test.ts:7-39` so it covers:
  - a no-extra-delay eat when the cooldown is already long enough
  - a +1 extra-delay eat
  - a +2 extra-delay eat
  - a +3 extra-delay eat on an otherwise-ready attack
- [ ] Preserve the existing boss-interval warnings in `attackCooldownValidator.validate()` at `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts:18-49`.

### Phase 3: Audit and normalize boss attack speed

Files:

- `src/entities/Boss.ts`
- `src/entities/__tests__/Boss.test.ts`
- `docs/INTENT.md`
- `../cg-sim-player/src/report/mechanics/reference.ts`
- `../cg-sim-player/tests/helpers/traceBuilder.ts`

Tasks:

- [ ] Remove internal literal drift first, regardless of the final speed decision:
  - normalize `src/entities/Boss.ts:16-17`
  - keep `Boss.fireAttack()` using `this.attackSpeed` at `src/entities/Boss.ts:89-101`
  - replace the hardcoded reset value at `src/entities/Boss.ts:122` with the same canonical source
- [ ] Update `src/entities/__tests__/Boss.test.ts:77-81` so it asserts against the canonical speed rather than a raw `5`.
- [ ] Make one explicit product decision:
  - If the simulator keeps `5`, add a short rationale to `docs/INTENT.md:123` and keep `../cg-sim-player/src/report/mechanics/reference.ts:67` aligned at `5`.
  - If the simulator moves to `6`, update `src/entities/Boss.ts:16-17`, `src/entities/Boss.ts:122`, `docs/INTENT.md:123`, `../cg-sim-player/src/report/mechanics/reference.ts:67`, and the baseline snapshot in `../cg-sim-player/tests/helpers/traceBuilder.ts:63`.
- [ ] Re-run any boss-rotation and cadence tests that assume the current interval. `Boss.fireAttack()` behavior itself should remain unchanged except for the cadence value.

Recommendation: do not change from 5 to 6 in the same commit as the eat-delay bugfix unless the audit evidence is captured and the downstream oracle updates are already ready. The simulator bug is surgical; the boss-speed decision changes global pacing.

### Phase 4: Re-tune the bot only if verification shows real fallout

Files:

- `../cg-sim-player/src/bot/TickPlanner.ts`
- `../cg-sim-player/tests/unit/planner.test.ts`
- `../cg-sim-player/tests/integration/fight.test.ts`

Tasks:

- [ ] Measure whether the corrected eat delay materially reduces bot win rate or increases food waste in the 100-seed benchmark.
- [ ] If it does, tighten the standard-food planning window in `TickPlanner.plan()` at `../cg-sim-player/src/bot/TickPlanner.ts:98-121`. The current condition `snapshot.playerAttackCooldown > 1` was written against the weaker old behavior; after this sprint, “free” standard-food windows begin closer to `> 3`.
- [ ] Do not change `queueEmergencyFood()` at `../cg-sim-player/src/bot/TickPlanner.ts:139-153`; emergency combo-eating should remain available when survival is at risk.
- [ ] Update `../cg-sim-player/tests/unit/planner.test.ts:98-124` if the planner threshold changes.
- [ ] Keep the integration benchmark in `../cg-sim-player/tests/integration/fight.test.ts:60-100` as the final regression check.

### Phase 5: Document the new source of truth and verify end to end

Files:

- `docs/INTENT.md`
- `package.json`
- `../cg-sim-player/package.json`

Tasks:

- [ ] Update `docs/INTENT.md:15` so the tick-system section describes the real standard-food behavior, not just “occupies the action slot.”
- [ ] Update the fish table at `docs/INTENT.md:92-97`. If the simulator adopts the OSRS-style cooldown reset, `Paddlefish` should no longer be documented as `1 tick`; it should describe the 3-tick minimum attack-delay behavior precisely.
- [ ] Keep `Corrupted paddlefish` documented as zero-delay combo food at `docs/INTENT.md:95-97`.
- [ ] Run local simulator tests with `npm test`, which is wired to `vitest run` in `package.json:6-10`.
- [ ] Run downstream oracle tests with `npm test` in `../cg-sim-player`, which is wired in `../cg-sim-player/package.json:6-10`.
- [ ] Run the 100-seed benchmark from the sprint intent using `npm run run -- --fights 100 --start-seed 1` in `../cg-sim-player`.

## Files Summary

| File | Change | Why |
|---|---|---|
| `src/engine/GameSimulation.ts` | Required | `GameSimulation.processTick()` at `:394-397` is where the regular-food cooldown clamp must happen; `processInventoryAction()` at `:575-587` already identifies standard vs combo food |
| `src/__tests__/inventory.test.ts` | Required | Existing tests at `:181-226` check healing and `playerAteThisTick`, but not actual post-eat attack cadence |
| `src/entities/Boss.ts` | Required | `Boss.fireAttack()` is already canonical, but literals at `:16-17` and `:122` must be normalized before any 5-vs-6 decision |
| `src/entities/__tests__/Boss.test.ts` | Required | Cooldown expectation at `:77-81` is hardcoded to `5` |
| `docs/INTENT.md` | Required | Current wording at `:15`, `:94-97`, and `:123` must match shipped mechanics |
| `../cg-sim-player/src/report/mechanics/reference.ts` | Required | Oracle still pins boss cadence at `:67` and does not yet expose the food-delay constant |
| `../cg-sim-player/src/report/mechanics/validators/attackCooldown.ts` | Required | Current logic at `:64-66` models eat delay as `+1 tick per eat`, which is too weak |
| `../cg-sim-player/tests/unit/validators/attackCooldown.test.ts` | Required | Current tests only cover the older interval model |
| `../cg-sim-player/tests/helpers/traceBuilder.ts` | Conditional | Baseline boss cooldown at `:63` must change if the cadence decision changes to `6` |
| `../cg-sim-player/src/bot/TickPlanner.ts` | Conditional | Planner threshold at `:107` may need retuning after the simulator becomes stricter |
| `../cg-sim-player/tests/unit/planner.test.ts` | Conditional | Planner behavior at `:98-124` is currently written against the existing threshold |

## Definition of Done

1. Eating standard paddlefish while ready to attack suppresses the current shot and delays the next legal attack by 3 ticks.
2. Eating standard paddlefish while a longer cooldown is already active does not shorten that longer cooldown.
3. Corrupted paddlefish remains instant combo food and does not affect attack cooldown.
4. `GameSimulation` tests explicitly cover the cooldown edge cases, not just healing and inventory removal.
5. `cg-sim-player`’s cooldown validator models the real post-eat cooldown rule and reports zero false-positive `attack_cooldown` warnings on the 100-seed benchmark.
6. Boss cadence is driven from one canonical source inside `Boss`, with no stray hardcoded literal in `reset()`.
7. `docs/INTENT.md` matches the shipped mechanics for both food delay and boss attack speed.
8. `npm test` passes in both `cg-sim` and `cg-sim-player`.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Applying the cooldown clamp inside `processInventoryAction()` before `processTick()` line `394` | Off-by-one bug; player still attacks too early | Apply the clamp after the natural decrement and before the attack gate, and add a “cooldown = 0 on eat tick” test |
| Updating the simulator but not the validator | Benchmark still reports warnings even when the sim is correct | Land `cg-sim-player` validator updates in the same sprint |
| Changing boss speed and eat delay together | Hard to tell which change caused win-rate or pacing regressions | Normalize boss cadence plumbing first; only change 5->6 after audit evidence is captured |
| Bot still eats on expensive windows | Lower DPS, lower win rate, confusing benchmark movement | Keep planner retune as an explicit conditional phase driven by the 100-seed run |
| Docs and tests drift from the real mechanic | Future regressions and contradictory guidance | Update `docs/INTENT.md`, `Boss.test.ts`, and oracle constants in the same change set |

## Security Considerations

This sprint does not add any new network access, persistence surface, auth flow, or user-input parsing path. The main risk is correctness drift between the simulator and its external validator, not a security exposure.

## Dependencies

- `docs/INTENT.md` remains the project source of truth unless the team explicitly decides that OSRS wiki fidelity should override the current `5`-tick boss entry.
- `cg-sim-player` must be updated in lockstep because it encodes mechanical expectations, not just smoke tests.
- Verification depends on the existing package scripts in `package.json:6-10` and `../cg-sim-player/package.json:6-10`.

## Open Questions

1. Is the project source of truth still `docs/INTENT.md`, or should Sprint 012 revise it to match external OSRS evidence on boss cadence if that evidence is stronger?
2. Should the boss-speed audit be shipped in the same PR as the eat-delay fix, or staged immediately after the simulator/validator bugfix to reduce regression noise?
3. Where should the regular-food cooldown constant live in `cg-sim-player`’s mechanics reference: under `player`, under `items`, or in a dedicated timing section?
4. If the benchmark still wins 100/100 after the simulator fix, do we leave `TickPlanner.plan()` unchanged for now, or still tighten the standard-food window to avoid hidden DPS loss?
