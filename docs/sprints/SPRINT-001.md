# Sprint 001: Foundation — Tick Engine, Combat Core, and Playable Arena

## Overview

Stand up the project from scratch and deliver a minimal playable loop: a player on a 12x12 tile grid fighting a Corrupted Hunlef that executes its 4-attack rotation. The player can move, switch prayers, and attack with one weapon style. The tick engine and combat formulas are the hard parts — everything else is intentionally placeholder.

**What ships:** A browser tab where you click "Start Fight", see a top-down 12x12 arena, move around, pray-switch against the boss's ranged/magic rotation, and deal damage back. Combat formulas are unit-tested against known OSRS values. All combat rolls use a seeded PRNG for reproducibility.

**What's deferred:** Tornadoes, floor tile hazards, prayer-disable attack, eating/food, potions, combo eating, weapon switching, run energy, inventory management, audio, 3D model rendering. These are sprint 2+.

---

## Use Cases

1. **UC-1: Start a fight** — Player opens the app, selects armor tier and one weapon (type + tier) on a loadout screen, clicks "Start Fight."
2. **UC-2: Tick-driven combat** — Game state advances every 600ms. Boss fires attacks on its 5-tick cadence following the 4-attack rotation. Player takes damage (reduced by correct prayer, full if unprotected).
3. **UC-3: Click-to-move** — Click a tile to move. Walking = 1 tile/tick, 8-directional. Cannot walk through the boss's 5x5 footprint.
4. **UC-4: Prayer switching** — Keyboard hotkeys toggle Protect from Missiles / Protect from Magic. Prayer takes effect next tick. Points drain over time.
5. **UC-5: Attack the boss** — Player auto-attacks when in weapon range. Damage calculated via OSRS formulas. Boss HP decreases.
6. **UC-6: Win/Loss** — Boss at 0 HP = win. Player at 0 HP = loss. Summary screen with elapsed time and damage. "Restart" returns to loadout.
7. **UC-7: Headless testing** — `runTicks(n)` advances state without rendering for automated tests.

---

## Architecture

### Tech Stack

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Language | TypeScript (strict) | Type safety for complex combat math |
| Bundler | Vite | Fast HMR, zero-config TS |
| Rendering | 2D Canvas (top-down) | Zero runtime deps. Colored rectangles for sprint 1. |
| Testing | Vitest | Co-located with Vite, fast, native TS |
| State | Plain TypeScript classes | Simple, debuggable. ~10 entities don't need ECS. |
| UI | Vanilla DOM | Loadout screen and HUD are simple HTML/CSS |
| RNG | Seeded Mulberry32 PRNG | Deterministic combat rolls for reproducibility |

**Zero runtime dependencies.** Only dev deps: vite, typescript, vitest.

### Directory Structure

```
src/
├── engine/
│   ├── TickEngine.ts          # 600ms interval loop
│   ├── GameSimulation.ts      # Owns all game state, processes one tick
│   └── Rng.ts                 # Seeded Mulberry32 PRNG
├── combat/
│   ├── formulas.ts            # Pure functions: maxHit, attackRoll, hitChance
│   └── PrayerManager.ts       # Active prayers, drain calculation
├── entities/
│   ├── Player.ts              # Player state
│   ├── Boss.ts                # Boss state, attack rotation logic
│   └── types.ts               # Position, CombatStats, etc.
├── world/
│   ├── Arena.ts               # 12x12 grid, collision
│   └── Pathfinding.ts         # 8-directional BFS
├── equipment/
│   ├── items.ts               # Static weapon/armor stat tables
│   └── Loadout.ts             # Loadout type + validation
├── input/
│   └── InputManager.ts        # Click → tile, keyboard → prayer/attack
├── render/
│   ├── Renderer.ts            # Canvas: grid, entities, hit splats
│   ├── HUD.ts                 # DOM: HP/prayer orbs, boss HP bar
│   └── LoadoutScreen.ts       # Pre-fight config UI
├── main.ts                    # Entry point
└── index.html
```

### State Flow (per tick)

```
1. Process queued inputs (move target, prayer toggle, attack)
2. Drain prayer points
3. Advance player movement (1 tile toward target)
4. Boss AI: decrement cooldown, fire attack if ready, advance rotation
5. Resolve boss attack: check prayer, roll damage via seeded RNG
6. Resolve player attack: check cooldown + range, roll hit + damage
7. Check stomp: player inside boss 5x5 → typeless damage
8. Death checks (player HP ≤ 0, boss HP ≤ 0)
9. Increment tick counter
```

---

## Implementation

### Phase 1: Project Scaffold + Tick Engine (~15% effort)

**Files:**
- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- `src/engine/TickEngine.ts`
- `src/engine/GameSimulation.ts`
- `src/engine/Rng.ts`

**Tasks:**
- [ ] `npm create vite@latest . -- --template vanilla-ts`, add Vitest
- [ ] `tsconfig.json`: `strict: true`, `target: "ES2022"`
- [ ] Implement `TickEngine` — `setInterval(600)` loop, exposes `start()`, `stop()`, `currentTick`
- [ ] Implement `GameSimulation` — owns Player, Boss, Arena. `processTick()` mutates state. `runTicks(n)` for headless testing.
- [ ] Implement `Rng` — Mulberry32 seeded PRNG. `next(): number` returns 0-1. `nextInt(min, max)` for damage rolls.
- [ ] Tests: tick counter increments correctly, `runTicks(10)` produces tick 10, RNG determinism (same seed → same sequence)

### Phase 2: Arena, Entities, Movement (~15% effort)

**Files:**
- `src/entities/types.ts`
- `src/entities/Player.ts`
- `src/entities/Boss.ts`
- `src/world/Arena.ts`
- `src/world/Pathfinding.ts`
- `src/input/InputManager.ts`

**Tasks:**
- [ ] Define `Position`, `CombatStats`, `Tile` types
- [ ] Implement `Player` — position, hp, prayerPoints, equipment, attackCooldown, targetTile
- [ ] Implement `Boss` — position (SW corner of 5x5), hp=1000, currentStyle='ranged', attackCounter, attackCooldown. Stats: all 240, defBonus=20
- [ ] Implement `Arena` — 12x12 grid, `isWalkable(x, y)` checks boss 5x5 collision
- [ ] Implement `Pathfinding` — 8-directional BFS on 12x12 grid avoiding boss footprint
- [ ] Implement `InputManager` — canvas click → tile coords → `player.targetTile`. Keyboard: F1=Protect from Magic, F2=Protect from Missiles, Esc=prayers off
- [ ] Tests: pathfinding around boss, diagonal movement, boss collision, player within boss 5x5 detected

### Phase 3: Combat Formulas (~20% effort)

**Files:**
- `src/combat/formulas.ts`
- `src/equipment/items.ts`
- `src/equipment/Loadout.ts`

**Tasks:**
- [ ] Implement all combat formulas as pure functions:

```typescript
// Melee
meleeMaxHit(strLevel, strBonus, prayerMult, stanceBonus): number
meleeAttackRoll(atkLevel, atkBonus, prayerMult, stanceBonus): number

// Ranged
rangedMaxHit(rngLevel, rngStrBonus, prayerMult): number
rangedAttackRoll(rngLevel, rngAtkBonus, prayerMult, stanceBonus): number

// Magic (fixed max hit for powered staves)
magicMaxHit(tier: 1|2|3, augury: boolean): number
magicAttackRoll(magLevel, magAtkBonus, prayerMult): number

// General
hitChance(attackRoll, defenceRoll): number
npcDefenceRoll(defLevel, defBonus): number  // Hunlef: 20,916
```

- [ ] Implement static equipment data tables (all tiers for bow, staff, halberd, armor) from INTENT.md
- [ ] Implement `Loadout` type with validation (28-slot max)
- [ ] Tests — every formula against hand-calculated OSRS values:
  - `magicMaxHit(3, true)` → 40
  - `magicMaxHit(3, false)` → 39
  - `npcDefenceRoll(240, 20)` → 20,916
  - T3 halberd + 99 str + Piety max hit
  - T3 bow + 99 ranged + Rigour max hit
  - Hit chance formula for both branches (attRoll > defRoll, attRoll ≤ defRoll)

### Phase 4: Boss AI + Prayer System (~25% effort)

**Files:**
- `src/combat/PrayerManager.ts`
- Boss AI logic in `src/entities/Boss.ts`
- Damage resolution in `src/engine/GameSimulation.ts`

**Tasks:**
- [ ] Implement `PrayerManager`:
  - Active prayer: `'magic' | 'missiles' | null`
  - Drain: `resistance = 2 * prayerBonus + 60`, `secondsPerPoint = 0.6 * (resistance / 12)`
  - Track accumulated drain as float, subtract integer points when ≥ 1.0
  - Deactivate when points reach 0
  - Prayer switch queues for next tick (not immediate)
- [ ] Implement boss attack rotation:
  - Start ranged, attack every 5 ticks
  - After 4 attacks, switch to magic. After 4 magic, switch to ranged.
  - Sprint 1: all 4 magic attacks are standard (prayer-disable deferred to sprint 2)
  - Style switch plays distinct visual indicator
- [ ] Implement boss damage resolution:
  - Correct prayer: `rng.nextInt(0, reducedMaxHit)` per armor tier table
  - Wrong/no prayer: `rng.nextInt(0, 68)` typeless
  - Stomp: player inside boss 5x5 → `rng.nextInt(0, 68)` typeless, does not advance counter
- [ ] Implement player attack resolution:
  - Check cooldown (4 ticks for all gauntlet weapons)
  - Check range: Chebyshev distance to nearest boss tile ≤ weapon range
  - Roll: `rng.next() < hitChance(playerAttackRoll, bossDefenceRoll)` → if hit, `rng.nextInt(0, maxHit)`
- [ ] Implement boss movement: 1 tile/tick toward player when out of attack range
- [ ] Tests:
  - Boss fires exactly 4 ranged then switches to magic, then 4 magic back to ranged
  - Stomp does not advance attack counter
  - Prayer drain with T3 armor (+12 bonus) vs no armor (+0)
  - Prayer deactivates at 0 points
  - Same seed produces identical fight outcomes (determinism test)

### Phase 5: Rendering + HUD (~20% effort)

**Files:**
- `src/render/Renderer.ts`
- `src/render/HUD.ts`
- `src/render/LoadoutScreen.ts`
- `src/main.ts`

**Tasks:**
- [ ] Implement `Renderer` — Canvas 2D:
  - Tile size: 48px. Canvas: 576x576.
  - Dark background with grid lines (corrupted gauntlet aesthetic — dark red/purple tones)
  - Boss: 5x5 red-orange rectangle. Border color indicates style (green=ranged, red/purple=magic)
  - Player: 1x1 cyan rectangle
  - Hit splats: damage numbers that display for ~2 ticks then fade
- [ ] Implement `HUD` — DOM elements beside canvas:
  - Player HP (green bar + text), prayer points (cyan bar + text)
  - Active prayer indicator using extracted sprite PNGs (sprite_127, sprite_128)
  - Boss HP bar (red bar + text: "Hunlef: 847/1000")
  - Attack counter: "Attacks: 2/4 (Ranged)"
  - Tick counter
- [ ] Implement `LoadoutScreen`:
  - Dropdowns: armor tier (0-3), weapon type (staff/bow/halberd), weapon tier (1-3)
  - One weapon only for sprint 1
  - DPS preview: computed max hit + hit chance for selected weapon
  - "Start Fight" button
- [ ] Wire `main.ts`:
  - Loadout screen → GameSimulation → TickEngine + Renderer + HUD + InputManager
  - On tick: `sim.processTick()` → `renderer.draw(sim)` → `hud.update(sim)`
  - On game over: stop engine, show end screen with elapsed time + damage stats
  - "Restart" → back to loadout

### Phase 6: Integration Testing + Polish (~5% effort)

**Files:**
- `src/__tests__/integration.test.ts`

**Tasks:**
- [ ] Headless simulation test: T3 staff + T3 armor, run 500 ticks, verify no crashes, boss takes damage, style switches occur
- [ ] Prayer correctness test: always correct prayer → damage ≤ reduced max hit per attack
- [ ] Determinism test: same seed + same loadout → identical tick-by-tick HP values
- [ ] Manual playtesting checklist:
  - [ ] `npm run dev` opens loadout screen
  - [ ] Selecting gear + "Start" shows arena
  - [ ] Click-to-move works (player walks toward tile)
  - [ ] Boss attacks every 5 ticks with style indicator
  - [ ] F1/F2 toggles prayers, drain is visible
  - [ ] Player attacks when in range, boss HP decreases
  - [ ] Boss switches style after 4 attacks
  - [ ] Walking under boss triggers stomp
  - [ ] Win/loss screens appear correctly
  - [ ] "Restart" returns to loadout

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Create | Vite + Vitest + TypeScript (zero runtime deps) |
| `tsconfig.json` | Create | Strict TypeScript config |
| `vite.config.ts` | Create | Vite + Vitest integration |
| `index.html` | Create | Single-page entry point |
| `src/main.ts` | Create | App entry, wires everything |
| `src/engine/TickEngine.ts` | Create | 600ms interval game loop |
| `src/engine/GameSimulation.ts` | Create | Core game state + per-tick processing |
| `src/engine/Rng.ts` | Create | Seeded Mulberry32 PRNG |
| `src/combat/formulas.ts` | Create | All combat math (max hit, accuracy, hit chance) |
| `src/combat/PrayerManager.ts` | Create | Prayer state, drain, protection checks |
| `src/entities/Player.ts` | Create | Player entity state |
| `src/entities/Boss.ts` | Create | Boss entity + attack rotation logic |
| `src/entities/types.ts` | Create | Shared types (Position, CombatStats) |
| `src/world/Arena.ts` | Create | 12x12 grid, walkability, collision |
| `src/world/Pathfinding.ts` | Create | 8-directional BFS |
| `src/equipment/items.ts` | Create | Static weapon/armor stat tables |
| `src/equipment/Loadout.ts` | Create | Loadout config type + validation |
| `src/input/InputManager.ts` | Create | Mouse + keyboard → game actions |
| `src/render/Renderer.ts` | Create | Canvas drawing (grid, entities, splats) |
| `src/render/HUD.ts` | Create | DOM HP/prayer/boss bars |
| `src/render/LoadoutScreen.ts` | Create | Pre-fight gear selection UI |
| `src/combat/__tests__/formulas.test.ts` | Create | Combat formula verification |
| `src/engine/__tests__/TickEngine.test.ts` | Create | Tick engine + RNG tests |
| `src/entities/__tests__/Boss.test.ts` | Create | Boss rotation tests |
| `src/combat/__tests__/PrayerManager.test.ts` | Create | Prayer drain/switching tests |
| `src/world/__tests__/Pathfinding.test.ts` | Create | Movement + collision tests |
| `src/__tests__/integration.test.ts` | Create | Headless simulation tests |

---

## Definition of Done

- [ ] `npm run dev` launches the app in browser with no errors
- [ ] `npm test` passes all unit and integration tests
- [ ] Loadout screen allows selecting armor tier (0-3) and one weapon (type + tier)
- [ ] 12x12 tile grid renders top-down with player (1x1) and boss (5x5) rectangles
- [ ] Tick engine advances every 600ms; tick counter visible in HUD
- [ ] Player moves toward clicked tile via 8-directional pathfinding, 1 tile/tick
- [ ] Boss 5x5 footprint blocks player movement
- [ ] Boss attacks every 5 ticks, cycling ranged→magic every 4 attacks
- [ ] Boss visual indicator changes with attack style
- [ ] Walking under boss triggers stomp (typeless, doesn't advance counter)
- [ ] F1/F2 toggles protection prayers; correct prayer reduces damage per armor tier table
- [ ] Prayer drains points; deactivates at 0
- [ ] Player attacks boss when in range with correct cooldown
- [ ] Combat formulas match OSRS values (verified by unit tests)
- [ ] All combat rolls use seeded PRNG — same seed produces identical fight
- [ ] Boss HP bar and player HP/prayer orbs update each tick
- [ ] Boss at 0 HP → win screen; player at 0 HP → loss screen
- [ ] "Restart" returns to loadout selection
- [ ] `GameSimulation.runTicks(n)` works headlessly for testing
- [ ] No runtime dependencies; strict TypeScript compiles cleanly

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Combat formula inaccuracy | Medium | High | Unit test every formula against hand-calculated values from INTENT.md + wiki DPS calculators |
| Tick timing drift in browser | Low | Medium | `setInterval(600)` is sufficient for sprint 1. Can add self-correcting timer if drift is noticeable. |
| Scope creep | High | Medium | Explicit defer list above. Sprint 1 = tick engine + combat + movement + prayer + basic rendering. Nothing else. |
| Prayer tick alignment wrong | Medium | Medium | OSRS rule: switch takes effect next tick. Queue input → apply at start of next `processTick()`. Write specific test. |
| Boss movement edge cases | Low | Low | Simple 1-tile-per-tick toward player. No complex AI needed for sprint 1. |

---

## Security Considerations

- Client-side only — no server, no user data, no authentication
- No external network requests at runtime; all assets bundled
- No `eval` or dynamic code execution
- Set strict CSP meta tag: `default-src 'self'; style-src 'self' 'unsafe-inline'`

---

## Dependencies

### Runtime
None. Zero runtime dependencies.

### Dev
| Package | Purpose |
|---------|---------|
| `vite` | Dev server + bundler |
| `typescript` | Compiler |
| `vitest` | Test runner |

---

## Open Questions

1. **Boss movement**: The Hunlef walks toward the player when they're out of range. Implement as simple 1-tile-per-tick movement. Verify in-game whether the boss moves diagonally or only cardinally.

2. **Rendering frame rate**: Sprint 1 renders once per tick (every 600ms). This will look choppy. Acceptable for sprint 1; add `requestAnimationFrame` interpolation in sprint 2.

3. **Hit splat duration**: Damage numbers display for ~2 ticks (1.2s) matching approximate OSRS feel. May need tuning.

4. **Prayer drain granularity**: Track accumulated drain as a float, subtract integer points when ≥ 1.0. Verify this matches OSRS behavior.

5. **Diagonal movement through corners**: Can the player move diagonally through the corner where two blocked tiles meet? OSRS blocks this. Need to implement corner-cutting prevention in pathfinding.
