# Sprint 021 Critique: Corrupted Hunllef Mechanic Accuracy Pass

## Overview
Both drafts provide solid architectures for implementing the missing Corrupted Hunllef mechanics, but they take different approaches to game cadence and RNG. Claude's draft is highly detailed and code-forward but makes dangerous assumptions about RNG consumption and attack cooldowns that violate the project constraints. Codex's draft focuses more heavily on the semantic mechanics, game loop cadence, and animation priorities, aligning better with the strict constraints but leaving some implementation details ambiguous.

## Draft 1: Claude's Draft

### Strengths
- **Implementation Depth:** Provides near copy-paste code snippets for the required changes.
- **Tornado Corner Offsets:** Thoughtful addition to add random offsets to tornadoes to prevent perfect stacking.
- **Prayer-Disable Slot Logic:** The `prayerDisableSlot` cleanly ensures exactly one prayer-disable per magic phase, which keeps the fight deterministic and highly testable.
- **Animation States:** Readily hooks into the existing `AnimationController` and clearly maps out state transitions.

### Weaknesses
- **Attack Cooldown Pausing:** Pausing the `attackCooldown` for 2 ticks during a style switch artificially lowers the boss's DPS by extending the 5-tick cooldown to 7 ticks. In OSRS, attack cycles are strict, and the style-switch animation simply plays within the 5-tick window (2 ticks after the last attack, 3 ticks before the next). Pausing the cooldown breaks fight pacing.
- **Stomp Mechanic Ignored:** Completely ignores the existing bug where Stomp hits every tick while under the boss, and does not address that Stomp does not count towards the 4-attack cycle.

### Gaps in Risk Analysis & Missing Edge Cases
- **Catastrophic RNG Shifting:** Claude adds two `rng.nextInt(0, 1)` calls per tornado spawn instead of the previous one `nextInt` call. This permanently shifts the sequence of `this.rng` for the rest of the fight. The risk analysis acknowledges this but incorrectly assumes it is "acceptable" and suggests coordinating with `cg-sim-player`. The prompt explicitly states `cg-sim-player` is read-only and its tests *must* pass. Changing the RNG call count will absolutely break the test suite.
- **Prayer Disable Overlap:** Claude correctly identifies that Tornado and Prayer Disable could overlap, and handles shifting the slot. However, it fails to consider how the 2-tick style switch delay visually interacts with these specials.

### Definition of Done Completeness
- Missing a check that RNG call counts are identical to the previous implementation.
- Missing tests to verify that the core attack cadence (5 ticks) remains undisturbed during a style switch.

---

## Draft 2: Codex's Draft

### Strengths
- **Deep Mechanic Accuracy:** Correctly identifies that Stomp should not count towards the 4-attack cycle and moves its resolution to the attack cadence, fixing a major existing bug.
- **Projectile Effects:** Adds `ProjectileEffect` to the `Projectile` interface. This is a much cleaner architecture than treating `prayer_disable` as a fake attack style, as it inherently preserves the magic damage calculations.
- **Animation Priorities:** Explicitly defines an animation priority order in `Renderer3D` (death > style switch > prayer disable > stomp > standard attack), solving the complex interaction between simultaneous events.
- **Non-blocking Style Switch:** Schedules the style switch (`triggerTick`) without pausing the boss's attack cooldown, correctly preserving the 5-tick boss DPS cycle.

### Weaknesses
- **Phase 0 Over-reliance:** Leaves too many exact values (like prayer-disable chance) to a "Mechanics Lock" phase instead of proposing a deterministic, testable default for the sprint (like Claude's one-per-phase logic).
- **Tornado RNG Implementation:** While it mentions keeping seeded determinism, it lacks specific instructions on *how* to sample `TORNADO_CORNER_TILES` without changing the RNG call count. A standard array shuffle or pop might consume more or fewer RNG calls than the old `nextInt(0, candidates.length - 1)` loop.

### Gaps in Risk Analysis & Missing Edge Cases
- **Tornado Spawn Edge Case:** If the player is in a corner when tornadoes spawn, do they take damage instantly? Codex mentions "do not move or damage on their spawn tick", which safely covers this, but doesn't explicitly test the interaction if the boss summons tornadoes exactly when switching styles or firing a prayer-disable.
- **Animation Interruption:** If the 4th attack is a prayer-disable, the animation for prayer-disable plays on tick 0. Does the style-switch animation (which is scheduled to play on tick 2) clip or override the prayer-disable animation? Codex's priority list applies per-tick, but a 2-tick gap means the style-switch will interrupt the ongoing prayer-disable animation. This edge case is unaddressed.

### Definition of Done Completeness
- Thorough DoD that includes verifying under-boss stomp is resolved on attack cadence.
- Lacks a DoD item explicitly verifying that the total number of RNG calls per tick remains exactly the same as `main` to guarantee `cg-sim-player` test parity.

---

## Focus Area Analysis

### 1. RNG Ordering & `cg-sim-player` Compatibility
**Claude:** Fails entirely. Modifies the number of RNG calls per tornado from 1 to 2. This desyncs the seeded RNG state for all subsequent player and boss hit chance/damage rolls, ensuring `cg-sim-player` tests will fail.
**Codex:** Identifies the requirement to maintain seeded determinism but lacks strict implementation details. To safely pass the tests, the new tornado spawn logic *must* call `this.rng.nextInt(...)` exactly `count` times, matching the old `spawnTornadoes()` behavior perfectly.

### 2. Interaction Between Tornado / Prayer-Disable / Style-Switch Timing
**Claude:** Pausing the attack cooldown during the style-switch delays the entire fight cadence, breaking standard DPS calculations.
**Codex:** Handles this beautifully through an event-based animation priority system and tick-based scheduling (`triggerTick` for style switch). 

## Recommendation for Final Sprint Plan
The final plan should merge Codex's robust architectural state machine and animation priorities with Claude's direct, deterministic logic implementations, while strictly enforcing RNG constraints.

1. **Adopt Codex's `ProjectileEffect`** and animation priority list.
2. **Adopt Codex's non-blocking style switch** (do not pause `attackCooldown`).
3. **Adopt Codex's Stomp cadence fix** to resolve the every-tick damage bug and cycle counting.
4. **Fix Tornado RNG:** The new `spawnTornadoes()` must iterate `count` times and call `rng.nextInt(...)` exactly once per iteration (e.g., `rng.nextInt(0, 3)` to select a corner). Do not add secondary offsets or shuffle methods that consume extra RNG calls.
5. **Adopt Claude's Prayer-Disable deterministic slot:** Instead of a random proc chance that breaks tests, use the predetermined slot logic to guarantee exactly one prayer disable per magic phase.