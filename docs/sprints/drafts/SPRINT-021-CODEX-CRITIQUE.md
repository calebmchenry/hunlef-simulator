# Sprint 021 Draft Critique

This critique evaluates both drafts against `docs/sprints/drafts/SPRINT-021-INTENT.md` and the current simulator code.

## Current Code Constraints

1. `Boss.fireAttack()` currently switches `currentStyle` immediately after the 4th attack, even though that tick's returned attack style is still the old one. `cg-sim-player` relies on that post-tick state to pray for the next attack.
2. `GameSimulation.processTick()` applies queued prayers before projectile resolution, resolves arriving projectiles before new boss attacks, then handles boss fire, player fire, tornado movement, tornado damage, and stomp. Any prayer-disable effect lands before the boss's new attack on that tick.
3. `PrayerManager.deactivate()` clears `activePrayer`, `offensivePrayer`, and the hidden drain accumulator. There is no protection-only API today.
4. `Renderer3D` currently triggers boss attack animations from boss projectiles fired that tick and triggers style-switch animations from `boss.currentStyle` changing.
5. `cg-sim-player` reads `boss.currentStyle`, `boss.attackCooldown`, `prayerManager.activePrayer`, `prayerManager.offensivePrayer`, `projectiles`, and `tornadoes` directly. Its tests also enforce `>= 95/100` wins without hazards, offensive-prayer alignment on player attack ticks, and a stable 5-tick boss attack cadence in mechanics reporting.

## Claude Draft (`docs/sprints/drafts/SPRINT-021-CLAUDE-DRAFT.md`)

### Strengths

1. This is the more implementation-ready draft. The phases, touched files, and concrete method-level changes are specific enough to execute.
2. It correctly notices that `AnimationController` already has `stomp` and `prayer_disable` states, so this sprint is mostly about triggering existing assets rather than inventing a new animation system.
3. The prayer-disable projectile design is API-friendly: keep projectile `style` as magic and add a side-channel flag. That fits the current `Projectile` type better than inventing a brand-new combat style.
4. It explicitly handles the tornado/prayer-disable slot collision, which matters because current magic cycles always open with the tornado replacement attack.
5. It includes the strongest verification envelope of the two drafts: build, tests, visual checks, and `cg-sim-player` validation.
6. It at least recognizes RNG drift as a real risk instead of treating these mechanics as free visual changes.
7. It explicitly scopes the uncertain "base attack animation might be wrong" question out of this sprint instead of silently ignoring it.

### Weaknesses

1. The style-switch design changes gameplay, not just visuals. The intent note says the style-switch animation should happen 2 ticks after the previous attack; this draft instead plays the animation immediately and delays the actual style switch plus attack cadence.
2. Delaying `currentStyle` and pausing `attackCooldown` breaks the current combat contract that `cg-sim-player` reads every tick. The bot is reactive enough that it may survive, but this is still a much bigger compatibility change than the draft acknowledges.
3. The RNG story is incomplete. The draft calls out tornado-spawn RNG churn, but the more dangerous issue is `initMagicPhase()` placement: calling it inside `fireAttack()`, after damage rolling, or at a later tick all produce different downstream seeds.
4. `initMagicPhase()` is also distributionally wrong as written. Picking `0-3` and then shifting `0 -> 1` makes slot `1` twice as likely as slots `2` and `3`.
5. The prayer-disable implementation says "clear the player's active protection prayer" but proposes `prayerManager.deactivate()`, which clears offensive prayer too. That is inconsistent with its own use case and is likely to break `cg-sim-player`'s offensive-prayer alignment invariant on player attack ticks.
6. The corner-offset example is asymmetric. `Math.min(11, corner.x + offsetX)` gives real variation only on the west/south edges; north/east corners clamp immediately and do not vary.
7. The delayed-tornado-spawn plan still needs first-move handling. If tornadoes are spawned before step `7a`, they can still move on the same tick they appear, which weakens the intended stomp -> warning -> spawn cadence.
8. The renderer plan adds new simulation-facing flags (`styleSwitchPending`, `pendingTornadoSpawnTick`, `lastTornadoSummonTick`) but does not fully describe reset/death cleanup or how stale pending events are prevented.

### Gaps In Risk Analysis

1. No explicit risk that `cg-sim-player`'s non-hazard benchmark still exercises prayer-disable and style-switch behavior. `disableUnsupportedMechanics()` only disables floor hazards and tornado spawning, not the new prayer-disable mechanic.
2. No explicit risk that `cg-sim-player`'s mechanics validators assume a 5-tick boss cadence. A 2-tick style-switch pause will create systematic attack-cooldown warnings even if tests stay technically green.
3. No explicit risk that clearing offensive prayer on prayer-disable will trip the bot's `offensivePrayerAligned()` invariant.
4. No explicit risk around the exact placement of new RNG calls relative to `floorHazardManager.tick()`, boss damage rolls, and player attack rolls.
5. No explicit risk that the stomp-warning change is visually undermined if tornadoes still move on their first visible tick.
6. No explicit risk for unresolved semantics: protection-only disable vs all-prayers disable.

### Missing Edge Cases

1. Prayer-disable landing on a tick where the player also attacks. If offensive prayer is cleared, the player attack still happens later in the same tick and the post-state no longer matches current bot invariants.
2. The final magic attack of a cycle being the prayer-disable. The draft does not call for an integration test that proves delayed style-switch visuals still work when the purple projectile is the last attack before the switch cue.
3. Tornado summon followed by boss death on the same tick. A pending spawn must not appear after the fight is already won.
4. Player standing on a corner spawn tile. The draft does not define whether a newly appeared tornado can move or deal damage immediately.
5. The first render after delayed spawn. If a tornado spawns and moves in the same simulation tick, the player may never see the intended stationary corner spawn.
6. The combined real sequence that matters most here: 4th ranged attack -> delayed style-switch cue -> first magic-cycle action is tornado -> later magic-cycle action is prayer-disable.

### Definition Of Done Completeness

1. This is the strongest DoD of the two drafts, but it still misses one crucial acceptance criterion: lock down RNG ordering, not just determinism. "Same seed stays deterministic" is weaker than "new RNG calls happen at an intentional point in the tick."
2. It should explicitly choose and test prayer-disable semantics: protection-only clear or full-prayer clear.
3. It should require an integration test for the combined timing path: style switch, tornado summon, and prayer-disable in the same magic cycle.
4. It should assert that tornadoes do not move or damage before the intended first active tick if the sprint claim is "1-tick warning before tornadoes appear."
5. It should make `cg-sim-player` compatibility behavioral, not just procedural: the external test gate is good, but the DoD should explicitly preserve the current benchmark expectations rather than only say "tests pass."

## Gemini Draft (`docs/sprints/drafts/SPRINT-021-GEMINI-DRAFT.md`)

### Strengths

1. The safest instinct in this draft is the style-switch approach: delay the animation in `Renderer3D` instead of rewriting the boss state machine. That preserves the current `boss.currentStyle` contract that the bot already consumes.
2. The `activeTick` idea correctly notices that tornado timing is not only about spawn location; same-tick chase behavior is part of why tornadoes currently feel too early.
3. A deterministic prayer-disable slot avoids introducing extra RNG draws, which is better for seed stability and `cg-sim-player` compatibility than an unpinned random design.
4. The scope stays small and avoids the large engine-state rewrite that Claude proposes.
5. It includes the external `cg-sim-player` test gate.

### Weaknesses

1. The draft is too high-level to be implementation-safe. Several critical details are left at the "for example" level even though this sprint is dominated by ordering details.
2. Hardcoding prayer-disable to `attackCounter === 1` is arbitrary. In the current boss rotation, every magic phase already starts with a tornado slot, so this choice silently defines the special as "first actual magic projectile after tornado" without any evidence that this is the right mechanic.
3. `this.prayerManager.activePrayer = 'none'` is not a valid current type or API. It bypasses `PrayerManager` semantics and does not address queued state, offensive prayers, or drain behavior.
4. The draft says `Tornado.ts` should track `activeTick`, but the actual `Tornado` interface lives in `src/entities/types.ts`. That file and the existing test fixtures would also need updating.
5. Stomp detection via `sim.tornadoes.length` increasing is late. It fires when tornadoes are already visible, not when the boss decides to summon them, so it cannot provide the intended pre-spawn stomp cue.
6. Because tornadoes still spawn immediately, this draft really fixes "tornadoes move too soon," not "tornadoes spawn too soon." That only covers half of the intent.
7. The prayer-disable projectile schema is underspecified. The draft talks about a projectile "of type `prayer_disable`," but current downstream consumers expect boss projectile styles to remain `magic` or `ranged`.
8. It does not explicitly address or defer the intent's open question about base attack-animation accuracy.

### Gaps In Risk Analysis

1. No explicit risk for mutating the wrong API surfaces (`PrayerManager.activePrayer` directly, `Tornado` shape split across files).
2. No explicit risk that immediate spawn plus delayed movement still changes hazard difficulty and benchmark win rates in `cg-sim-player`.
3. No explicit risk that `tornadoes.length` is a lossy stomp signal. A despawn and spawn in the same tick can keep the count flat and miss the animation entirely.
4. No explicit risk around prayer-disable semantics versus `cg-sim-player`'s offensive-prayer assumptions.
5. No explicit RNG plan for tornado corner placement. The draft is shorter partly because it avoids the issue rather than resolving it.
6. No explicit risk for pending renderer state surviving death/reset before a delayed style-switch animation fires.

### Missing Edge Cases

1. Player standing on a corner tile when an inactive tornado appears there.
2. `activeTick` versus lifetime semantics: does delaying activation also reduce the chase window, or is lifetime extended to compensate?
3. Prayer-disable landing after the player queued the correct protection prayer earlier in the same tick. Current tick order means the queued prayer is applied and then can be canceled before boss fire.
4. Simultaneous tornado despawn and spawn leaving `tornadoes.length` unchanged, which would miss the stomp trigger entirely.
5. Boss death or fight reset before a delayed style-switch animation is played.
6. The combined sequence of delayed style-switch animation, tornado summon, and prayer-disable within the same magic cycle.

### Definition Of Done Completeness

1. The DoD is directionally correct but too thin for a sprint where most failures will be timing bugs.
2. It needs explicit unit coverage for the new tornado activation timing, not just a visual outcome statement.
3. It needs an explicit decision on prayer-disable scope: protection-only or all-prayers.
4. It should include a seed-stability requirement, because one of this draft's main advantages is that it can avoid new RNG churn if implemented carefully.
5. It should include non-regression coverage for the existing idle/attack/death animation flow, which the intent calls out and Claude includes.
6. It should require at least one integration test for the combined style-switch/tornado/prayer-disable timeline, not only isolated bullet-point features.

## Overall Assessment

1. Claude is the better execution document, but it is too willing to rewrite simulation timing and too loose about new RNG placement. As written, it is more likely to introduce subtle compatibility drift with `cg-sim-player`.
2. Gemini has the better instinct on style-switch handling and potentially on RNG stability, but it is not code-accurate enough yet. The direct `PrayerManager` mutation and late stomp trigger are the biggest signs that it has not followed the current engine contract closely enough.
3. The best merged direction is: keep Claude's structure and verification rigor, keep Gemini's renderer-only style-switch delay, define a protection-only prayer-disable API explicitly, and make tornado timing a fully specified three-step sequence: summon event, visible spawn, first active chase tick.
