# Sprint 021 Draft Critique

## Source Material

- **Intent**: `SPRINT-021-INTENT.md`
- **Codex Draft**: `SPRINT-021-CODEX-DRAFT.md`
- **Gemini Draft**: `SPRINT-021-GEMINI-DRAFT.md`
- **Codebase files reviewed**: `Boss.ts`, `GameSimulation.ts`, `AnimationController.ts`, `Tornado.ts`, `Projectile.ts`, `PrayerManager.ts`, `Arena.ts`, `FloorHazardManager.ts`

---

## Codex Draft

### Strengths

1. **Clean type separation**: Correctly widens only `BossAttackResult` to `AttackStyle | 'tornado' | 'prayer_disable'` while keeping `AttackStyle` untouched. This avoids polluting the existing type across the codebase.

2. **Simulation-level style-switch delay**: The `pendingStyleSwitch` + `maybeApplyStyleSwitch(currentTick)` approach delays the *actual* `currentStyle` flip, not just the animation. This is critical — if only the animation is delayed (as Gemini proposes), the simulation would use the new style for damage calculations 2 ticks before the player sees the switch telegraph. This would be mechanically wrong and break cg-sim-player.

3. **Event-based animation dispatch**: Replacing the projectile-scanning heuristic in `Renderer3D.updateBossAnimations()` with explicit tick fields (`lastBossAttackTick`, `lastBossSpecialTick`, etc.) is the correct architectural move. The current approach of inferring boss state from projectile arrays cannot distinguish prayer-disable from normal magic.

4. **Tornado scheduling**: The `scheduleTornadoSpawn()` / `activatePendingTornadoSpawns()` split correctly addresses both the "too soon" complaint and the tick ordering requirement (tornadoes shouldn't move or damage on spawn tick).

5. **Stomp cadence fix**: Correctly identifies that the current stomp at `GameSimulation.ts:536-548` fires every single tick the player is under the boss, which is wrong — it should fire on the boss's attack cadence. Also correctly notes stomp should not advance the 4-attack counter.

6. **Thorough risk section**: Explicitly flags the RNG ordering concern, the test breakage from delayed style-switch, and the renderer animation priority problem.

7. **Phased implementation with Phase 0 lock**: Acknowledging unknown values (prayer-disable chance, exact tornado delay) upfront rather than guessing is responsible engineering.

### Weaknesses

1. **`fireAttack()` API change is too invasive**: The proposed signature `fireAttack(currentTick: number, rngNext: () => number)` breaks the current clean separation where `Boss` owns rotation logic and `GameSimulation` owns RNG and timing. Currently `Boss.fireAttack()` takes no parameters and consumes no RNG — all randomness lives in `GameSimulation`. Passing `rngNext` into `Boss` means prayer-disable chance consumes an RNG call inside `Boss`, which changes who owns the RNG sequence. This is risky for determinism because the call site in `GameSimulation` currently controls exact RNG ordering. A better approach: `Boss.fireAttack()` returns the attack *type* (including `'prayer_disable'`), and `GameSimulation` decides whether prayer-disable triggers by consuming the RNG call itself before calling `fireAttack()`, or `Boss` returns a flag like `wantsPrayerDisable: boolean` and `GameSimulation` does the roll.

2. **Magic projectile color change is unannounced**: The draft changes normal boss magic from `#aa44cc` (current, purple) to `#cc3344` (red). This is a visual regression that contradicts the intent's constraint: "ranged is green (#44cc44), magic is purple (#aa44cc)". The intent says prayer-disable should be *more* purple or different, not that normal magic should become red. This would also break any cg-sim-player visual tests that key on projectile color.

3. **Missing concrete RNG impact analysis**: The risk section mentions RNG ordering but doesn't trace the actual call sequence. Currently:
   - `floorHazardManager.tick()` → N RNG calls
   - Boss damage roll → 1 call (0-maxHit)
   - Player attack → 0-2 calls (accuracy + damage)
   - Tornado spawn → `count` calls (random position index)
   - Tornado damage → per-tornado overlap calls
   - Stomp → 1 call

   Adding a prayer-disable *chance roll* inserts a new RNG call in the boss attack path. Changing tornado spawning from random-index-into-candidates to corner selection *removes* `count` RNG calls. Both shifts will break every seeded test and cg-sim-player. The draft needs an explicit RNG migration strategy — either (a) consume dummy RNG calls to maintain sequence compatibility, or (b) accept seed breakage and re-baseline all snapshot tests.

4. **Phase 0 creates an execution bottleneck**: "Confirm from VOD review" is research that could block all 5 implementation phases. The draft should provide reasonable defaults (e.g., 1/3 chance, 1-tick delay) with `TODO` markers, and treat Phase 0 as parallel rather than prerequisite.

5. **Stomp fix is scope creep**: The intent mentions stomp *animation* (item 5) but not fixing stomp *damage cadence*. The current every-tick stomp is a bug, but fixing it changes gameplay behavior and will alter seeded outcomes. This should be flagged as optional or deferred.

6. **Corner tile coordinates assume specific arena geometry**: `TORNADO_CORNER_TILES` hardcodes `{x:0, y:0}` through `{x:11, y:11}`. The Arena class uses `width=12, height=12` with `isInBounds` checking `x >= 0 && x < 12`, so these are correct. But they should derive from `Arena.width`/`Arena.height` rather than hardcoding, since the arena dimensions are constants on the `Arena` class.

### Missing Edge Cases

- **Tornado + prayer-disable on same cycle**: If `cycleCount % 2 === 1 && attackCounter === 0` triggers tornado, and prayer-disable is also eligible during magic phase — which takes priority? The draft doesn't specify mutual exclusion rules. (In current code, tornado fires on `attackCounter === 0` of odd cycles, so if prayer-disable fires on, say, `attackCounter === 1`, they don't conflict. But if prayer-disable is chance-based on every magic attack, it could theoretically roll on the tornado attack too.)
- **Style-switch + tornado summon overlap**: On the 4th attack of an odd cycle, `attackCounter` resets to 0 and `cycleCount` increments. The *next* `fireAttack()` sees `cycleCount` is now odd and `attackCounter === 0`, so it returns `'tornado'`. But the pending style-switch from the previous cycle hasn't fired yet (it's 2 ticks delayed). What happens? Does the stomp animation play while a style-switch is pending? The priority list in the Architecture section (death > style switch > prayer disable > tornado stomp) would have the style-switch animation override the stomp, which seems wrong — you'd want to see the stomp.
- **`deactivate()` clears offensive prayers too**: The draft correctly notes this (line 111), but doesn't address whether this matches OSRS. In OSRS, the prayer-disable attack only drops *protection* prayers, not offensive ones. `PrayerManager.deactivate()` clears both. A new method like `disableProtection()` may be needed.

---

## Gemini Draft

### Strengths

1. **Concise and readable**: The draft is short and easy to follow. Each phase is well-scoped.

2. **Tornado `activeTick` approach is simple**: Adding an `activeTick` property to `Tornado` and skipping movement/damage when `tick < activeTick` is a clean, minimal change that's easy to understand and test.

3. **Correctly scoped to the intent**: Doesn't try to fix stomp cadence or introduce event systems beyond what's strictly needed. Stays focused on the 6 items from the seed prompt.

### Weaknesses

1. **Type error in prayer disable**: The draft says `this.prayerManager.activePrayer = 'none'`. But `PrayerType = 'magic' | 'missiles' | null` — there is no `'none'` value. This would be a compile error. Should be `this.prayerManager.deactivate()` or `this.prayerManager.activePrayer = null`.

2. **Only clears protection prayer**: Even if the type error is fixed to `= null`, this only clears the protection prayer. `PrayerManager.deactivate()` also clears `offensivePrayer` and resets `accumulatedDrain`. The Gemini approach would leave offensive prayers active, which may or may not match OSRS — but it's inconsistent with how prayer drain-to-zero already works in the codebase (which calls `deactivate()` and clears everything).

3. **Style-switch delay is renderer-only**: The draft puts the 2-tick delay in `Renderer3D` via a `pendingStyleSwitch` object, but `Boss.currentStyle` still flips immediately in `fireAttack()`. This means:
   - `GameSimulation` uses the new style for damage calculations immediately
   - The player sees the old style animation for 2 more ticks
   - cg-sim-player, which reads `boss.currentStyle` to decide prayer switches, would see the switch 2 ticks before the visual cue
   - This desync between simulation state and visual state is a significant mechanical error

4. **No RNG analysis whatsoever**: The draft doesn't mention deterministic RNG, seeded ordering, or the impact of adding/removing RNG calls. This is the single most dangerous omission for cg-sim-player compatibility. Changing tornado spawning from `rng.nextInt()` per position to corner selection removes RNG calls from the sequence. Adding prayer-disable (even deterministic, not chance-based) changes the attack cycle. Every downstream RNG call shifts.

5. **Stomp trigger is inference-based**: "Track `sim.tornadoes.length`. If it increases, trigger `playStomp()`" repeats the exact anti-pattern the intent calls out (Architecture section of intent: "existing animation states `stomp` and `prayer_disable` exist in AnimationController but are never triggered"). Inferring events from array length changes is fragile — what if two tornado batches overlap? What if tornadoes expire on the same tick new ones spawn, keeping the count the same?

6. **Prayer-disable rotation is hardcoded without justification**: Assigning it to `attackCounter === 1` during magic phase is an arbitrary choice. The intent explicitly lists this as an open question. The draft should acknowledge the uncertainty rather than committing to a specific position in the rotation.

7. **No test plan**: The Definition of Done lists 6 items but proposes no new tests. The intent requires unit tests for prayer-disable and tornado corner spawning, plus Playwright screenshots. The Gemini draft's DoD is pass/fail with no verification strategy.

8. **Arena corner positions left as open question**: The draft says "the exact coordinate bounds of the arena need to be identified" — but `Arena.ts` is right there: `width = 12, height = 12`, bounds are `[0, 12)`. The corners are trivially `(0,0), (11,0), (0,11), (11,11)`. This should be resolved in the draft, not left open.

9. **No `Projectile` type changes**: The draft creates a prayer-disable projectile with `color: '#6600cc'` and `shape: 'orb'` but doesn't add an `effect` field to the `Projectile` interface. The `resolveProjectiles()` code would have no way to know which projectile is prayer-disable vs normal magic when it arrives — they'd both be `style: 'magic'`. The Codex draft's `ProjectileEffect` approach solves this correctly.

10. **cg-sim-player risk is hand-waved**: The risk section says prayer-disable "must be strictly isolated or only affect later ticks beyond the tests' scope" — but this isn't a real mitigation strategy. Any change to the boss attack cycle changes when attacks fire, what damage is rolled, and how RNG sequences progress, which *will* affect cg-sim-player unless the test seeds are re-baselined.

### Missing Edge Cases

- **Prayer-disable when player has no prayer active**: What happens? Still fires the projectile but with no effect? Or skips to a normal attack? The draft doesn't address this.
- **Tornado activation timing relative to movement loop**: If `activeTick = spawnTick + 2`, and the movement loop in `GameSimulation.ts:501-509` runs before tornado damage at `:511-529`, tornadoes that just became active would move and damage in the same tick. The ordering matters.
- **Multiple prayer-disable projectiles in flight**: If the boss fires prayer-disable, the projectile has a travel delay. If the player re-enables prayer before it lands, it should still disable on arrival. The Gemini draft's approach of checking `prayerManager.activePrayer` at fire time (not arrival time) doesn't handle this — though it implicitly works if you set the flag on arrival, not fire.

---

## Comparative Assessment

| Criterion | Codex | Gemini |
|-----------|-------|--------|
| **Mechanical correctness** | Strong — simulation-level style delay, event-based animation | Weak — renderer-only style delay, inference-based triggers |
| **RNG ordering** | Acknowledged in risks, no concrete mitigation | Not mentioned at all |
| **cg-sim-player safety** | Flags risk, acknowledges test breakage | Hand-waves with "isolate or scope" |
| **Type safety** | Clean `ProjectileEffect` addition | Has a type error (`'none'` not in `PrayerType`) |
| **Scope discipline** | Overscoped — stomp cadence fix, event system refactor | Well-scoped to intent items |
| **Implementability** | Phase 0 bottleneck, invasive API changes | Simpler but several approaches are incorrect |
| **Test coverage plan** | Detailed per-phase test items | No test plan |
| **DoD completeness** | 12 items covering all mechanics + determinism + builds | 6 items, missing determinism and stomp cadence |
| **Animation dispatch** | Correct priority-based event system | Fragile inference from state changes |

## Recommendations for Final Sprint

1. **Use Codex's architecture** for style-switch delay (simulation-level `pendingStyleSwitch`), `ProjectileEffect`, and event-based animation dispatch. These are structurally correct where Gemini's alternatives are not.

2. **Use Gemini's `activeTick` approach** for tornado spawn delay — it's simpler than Codex's `pendingTornadoSpawns` scheduler and achieves the same result with less code.

3. **Keep `fireAttack()` signature unchanged**: Don't pass `rngNext` into `Boss`. Instead, have `GameSimulation` do the prayer-disable roll *before* calling `fireAttack()`, and pass a flag or use a separate method like `Boss.shouldFirePrayerDisable(attackCounter, currentStyle): boolean` that is pure logic with no RNG.

4. **Don't change normal magic projectile color**: Keep `#aa44cc` for magic. Use a distinct color for prayer-disable (e.g., `#6600ff` or `#9b4dff` — Codex's suggestion) that's clearly different but still in the purple family.

5. **Add a `disableProtection()` method** to `PrayerManager` that only clears `activePrayer` (protection), not `offensivePrayer`. Verify against OSRS whether the prayer-disable attack also drops offensive prayers. If it does, use `deactivate()`. If not, use `disableProtection()`.

6. **Explicitly document RNG migration strategy**: Either (a) accept seed breakage and re-baseline, or (b) insert compensating RNG calls to maintain sequence alignment. Option (a) is more honest — the attack cycle is fundamentally changing. Document which tests will need new expected values and flag the cg-sim-player rebaseline as a required post-merge step.

7. **Defer stomp cadence fix** to a separate sprint unless it's trivial. It's out of scope per the intent and changes gameplay behavior.

8. **Derive corner coordinates from Arena**: Use `arena.width - 1` and `arena.height - 1` rather than hardcoding `11`.

9. **Resolve the prayer-disable rotation question** before implementation. If OSRS data is unavailable, pick a reasonable default (e.g., 1-in-3 chance per magic attack, or fixed at position 2 of magic cycle) and document it as approximate, rather than leaving it as "Phase 0 blocker".
