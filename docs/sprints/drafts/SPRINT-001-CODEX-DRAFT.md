# Sprint 001 — Codex Draft: Tick Engine, Combat Core, Playable Arena

## Overview

Ship a runnable browser app in a few days. The player fights the Corrupted Hunlef on a 12x12 tile grid rendered as colored rectangles on an HTML5 Canvas. The tick engine and combat formulas are the hard parts; everything else is intentionally ugly placeholder UI.

**Perspective:** Minimal viable architecture. Vanilla TypeScript + Canvas. Class-based state. Top-down 2D colored rectangles. No frameworks, no ECS, no 3D. Sprint 1 proves the tick engine and combat math are correct; visual polish is future work.

---

## Use Cases

1. **UC-1: Start a fight** — Player opens the app, selects armor tier (none/T1/T2/T3), weapon tiers (bow/staff/halberd), fish count, and potion doses on a loadout screen. Clicks "Start Fight."
2. **UC-2: Tick-driven combat loop** — Game advances state every 600ms. Boss fires attacks on its 5-tick cadence following the 4-attack rotation. Player takes damage (reduced by prayer or full if unprotected).
3. **UC-3: Player movement** — Click a tile to move. Walking = 1 tile/tick, running = 2 tiles/tick. Cannot walk through the boss's 5x5 footprint.
4. **UC-4: Prayer switching** — Press keyboard hotkeys (1 = Protect from Missiles, 2 = Protect from Magic, 3 = off). Prayer takes effect next tick. Prayer drains points per tick based on armor prayer bonus.
5. **UC-5: Attack the boss** — Player attacks with equipped weapon. Damage calculated via OSRS formulas. Boss HP decreases.
6. **UC-6: Eat food** — Press hotkey to eat paddlefish (20 HP, costs action) or corrupted paddlefish (16 HP, combo, no action cost).
7. **UC-7: Win/Loss** — Boss reaches 0 HP = win. Player reaches 0 HP = loss. Show summary screen with elapsed ticks, damage dealt, damage taken.

---

## Architecture

### Tech Stack
- **Language:** TypeScript (strict mode)
- **Bundler:** Vite (zero-config, fast HMR)
- **Rendering:** HTML5 Canvas 2D context — no frameworks
- **Testing:** Vitest (ships with Vite, same config)
- **Package manager:** npm

### State Model (Class-Based)

No ECS. Simple mutable classes. The `GameState` object owns everything; the tick engine mutates it.

```
GameState
├── player: Player
│   ├── pos: Tile {x, y}
│   ├── hp: number
│   ├── maxHp: 99
│   ├── prayer: PrayerState
│   ├── equipment: Equipment
│   ├── inventory: Inventory
│   ├── attackCooldown: number (ticks remaining)
│   └── moveQueue: Tile[]
├── boss: Boss
│   ├── pos: Tile {x, y}  (SW corner of 5x5)
│   ├── hp: number
│   ├── maxHp: 1000
│   ├── attackStyle: 'ranged' | 'magic'
│   ├── attackCounter: number (0-3, resets on style switch)
│   ├── attackCooldown: number (ticks remaining)
│   └── stompCooldown: number
├── tickCount: number
├── status: 'loadout' | 'running' | 'won' | 'lost'
└── inputQueue: InputAction[]
```

### Tick Engine

The tick engine is a pure function: `advanceTick(state: GameState): void`. It mutates state in a deterministic order:

1. Process queued player inputs (movement, prayer switch, eat, attack)
2. Advance player movement (consume moveQueue)
3. Check stomp condition (player inside boss 5x5)
4. Boss AI: decrement cooldown, fire attack if ready, advance rotation
5. Resolve boss attack damage (check prayer, roll damage)
6. Resolve player attack damage (if cooldown hit zero, roll hit)
7. Drain prayer points
8. Check win/loss conditions
9. Increment tickCount

A `setInterval(advanceTick, 600)` drives the loop. For testing, call `advanceTick` directly in a loop.

### Rendering

Canvas redraws every frame via `requestAnimationFrame`. Reads from `GameState` (no render-specific state). Everything is colored rectangles:

- Gray grid lines on dark background = arena
- Green rectangle = player (1x1 tile)
- Red rectangle = boss (5x5 tiles)
- Blue/yellow text overlays = HP, prayer, attack counter
- Sidebar = text-based HUD (HP, prayer points, boss HP, inventory counts)

---

## Implementation

### Phase 1: Project Scaffold + Tick Engine (Day 1)

**Goal:** `npm run dev` opens a page. Tick engine advances a counter. Unit tests pass.

| Task | File(s) | Details |
|------|---------|---------|
| Init Vite + TypeScript project | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | `npm create vite@latest . -- --template vanilla-ts`. Add Vitest to devDeps. |
| Define core types | `src/types.ts` | `Tile`, `AttackStyle`, `PrayerType`, `ArmorTier`, `WeaponTier`, `WeaponType`, `InputAction`, `GameStatus` |
| Implement GameState class | `src/state/GameState.ts` | Owns `Player`, `Boss`, `tickCount`, `status`, `inputQueue`. Factory function `createGameState(loadout: Loadout): GameState`. |
| Implement Player class | `src/state/Player.ts` | Fields: `pos`, `hp`, `maxHp`, `prayer`, `equipment`, `inventory`, `attackCooldown`, `moveQueue`. |
| Implement Boss class | `src/state/Boss.ts` | Fields: `pos`, `hp`, `maxHp`, `attackStyle`, `attackCounter`, `attackCooldown`. Method: `nextAttack()` advances counter + switches style at 4. |
| Implement tick engine | `src/engine/tick.ts` | `advanceTick(state: GameState): void`. Steps 1-9 from architecture. |
| Tick engine tests | `src/engine/__tests__/tick.test.ts` | Test: tick increments counter. Test: boss fires attack every 5 ticks. Test: boss switches style after 4 attacks. Test: stomp triggers when player inside boss. |
| Wire up interval | `src/main.ts` | `setInterval(() => advanceTick(state), 600)`. |

**Key types in `src/types.ts`:**

```typescript
export interface Tile { x: number; y: number; }

export type AttackStyle = 'ranged' | 'magic';
export type PrayerType = 'protect_missiles' | 'protect_magic' | 'none';
export type ArmorTier = 0 | 1 | 2 | 3;
export type WeaponTier = 0 | 1 | 2 | 3;
export type WeaponType = 'bow' | 'staff' | 'halberd';
export type GameStatus = 'loadout' | 'running' | 'won' | 'lost';

export interface Loadout {
  armorTier: ArmorTier;
  bowTier: WeaponTier;
  staffTier: WeaponTier;
  halberdTier: WeaponTier;
  paddlefish: number;
  corruptedPaddlefish: number;
  egniolDoses: number;
}

export type InputAction =
  | { type: 'move'; target: Tile }
  | { type: 'pray'; prayer: PrayerType }
  | { type: 'eat'; food: 'paddlefish' | 'corrupted_paddlefish' }
  | { type: 'drink_potion' }
  | { type: 'attack' }
  | { type: 'switch_weapon'; weapon: WeaponType };
```

### Phase 2: Combat Formulas (Day 1-2)

**Goal:** All OSRS combat math is implemented and unit-tested against known values.

| Task | File(s) | Details |
|------|---------|---------|
| Implement equipment stats lookup | `src/combat/equipment.ts` | Lookup tables for all weapon tiers (atk bonus, str bonus, speed) and armor tiers (def bonus, prayer bonus). Typed as `Record<WeaponTier, WeaponStats>` etc. |
| Melee max hit + accuracy | `src/combat/melee.ts` | `meleeMaxHit(strLevel, strBonus, prayerMult, stanceBonus): number`, `meleeAttackRoll(atkLevel, atkBonus, prayerMult, stanceBonus): number` |
| Ranged max hit + accuracy | `src/combat/ranged.ts` | `rangedMaxHit(rngLevel, rngStrBonus, prayerMult): number`, `rangedAttackRoll(rngLevel, rngAtkBonus, prayerMult, stanceBonus): number` |
| Magic accuracy + fixed max hit | `src/combat/magic.ts` | `magicAttackRoll(magLevel, magAtkBonus, prayerMult): number`, `staffMaxHit(tier: WeaponTier, augury: boolean): number` |
| Hit chance | `src/combat/hitChance.ts` | `hitChance(attackRoll: number, defenceRoll: number): number` |
| Boss defence roll | `src/combat/boss.ts` | Constant: `BOSS_DEFENCE_ROLL = 20916`. Boss damage tables: `bossMaxHit(prayerCorrect: boolean, armorTier: ArmorTier): number`. |
| Prayer drain | `src/combat/prayer.ts` | `prayerDrainPerTick(prayerBonus: number, drainRate: number): number` |
| Combat formula tests | `src/combat/__tests__/combat.test.ts` | T3 staff + 99 magic + Augury = max hit 40. T3 bow + 99 ranged + Rigour = verify max hit. Hit chance vs boss defence roll. Prayer drain rate with T3 armor. |

### Phase 3: Rendering + Input (Day 2)

**Goal:** See the arena. Click to move. Press keys to pray and attack.

| Task | File(s) | Details |
|------|---------|---------|
| Canvas setup | `src/render/canvas.ts` | Create canvas element, size it to fit 12x12 grid + HUD sidebar. Export `getCanvas()` and `getCtx()`. Tile size = 48px. Canvas = 576 + 240 sidebar = 816 x 576. |
| Arena renderer | `src/render/arena.ts` | `renderArena(ctx, state)`: Draw 12x12 grid. Player = green rect. Boss = red 5x5 rect. Highlight player destination tile. |
| HUD renderer | `src/render/hud.ts` | `renderHUD(ctx, state)`: Text-based sidebar. Player HP, prayer points, boss HP, active prayer, equipped weapon, attack counter, tick count. |
| Main render loop | `src/render/loop.ts` | `requestAnimationFrame` loop calling `renderArena` + `renderHUD`. |
| Input handler | `src/input/input.ts` | Canvas click → convert pixel to tile → push `{type:'move', target}` to `state.inputQueue`. Keydown handlers: 1/2/3 = prayer, Q/W/E = switch weapon, F = eat fish, G = eat combo, R = drink potion, Space = attack. |
| Pathfinding (simple) | `src/engine/pathfinding.ts` | `computePath(from: Tile, to: Tile, blocked: Set<string>): Tile[]`. Simple BFS on 12x12 grid. Boss tiles are blocked. Returns tile sequence for moveQueue. |
| Pathfinding tests | `src/engine/__tests__/pathfinding.test.ts` | Path around boss. Path to adjacent tile. No path if blocked. |

### Phase 4: Boss AI + Integration (Day 2-3)

**Goal:** Boss attacks the player on rotation. Damage applies. Fight can be won or lost.

| Task | File(s) | Details |
|------|---------|---------|
| Boss attack resolution | `src/engine/bossAI.ts` | `processBossAttack(state: GameState): void`. Checks cooldown, fires ranged/magic attack, rolls damage against player prayer and armor, applies damage. Advances attack counter. Switches style at 4. |
| Player attack resolution | `src/engine/playerAttack.ts` | `processPlayerAttack(state: GameState): void`. Checks cooldown and range. Rolls hit chance vs boss defence roll. Rolls damage 0..maxHit. Applies to boss HP. |
| Eating logic | `src/engine/eating.ts` | `processEating(state: GameState, action: InputAction): void`. Paddlefish: heals 20, consumes action tick. Corrupted paddlefish: heals 16, combo (no action cost). Potion: restores prayer. |
| Stomp check | `src/engine/stomp.ts` | `checkStomp(state: GameState): void`. If player pos is within boss 5x5, deal 0-68 typeless. |
| Win/Loss screen | `src/render/endScreen.ts` | `renderEndScreen(ctx, state)`: Overlay with result, elapsed time, damage dealt/taken. "Restart" button. |
| Integration test | `src/engine/__tests__/integration.test.ts` | Run 100 ticks headlessly. Verify boss attacked ~20 times (100/5). Verify style switched. Verify tick count = 100. |

### Phase 5: Loadout Screen (Day 3)

**Goal:** HTML form to configure loadout before fight starts.

| Task | File(s) | Details |
|------|---------|---------|
| Loadout UI | `src/ui/loadout.ts` | HTML overlay with dropdowns for armor tier, weapon tiers, number inputs for fish/potions. Shows inventory slot count. "Start Fight" button creates `GameState` from `Loadout` and begins tick loop. |
| Inventory validation | `src/state/inventory.ts` | `validateLoadout(loadout: Loadout): { valid: boolean; slotsUsed: number; errors: string[] }`. Weapons in inventory cost 1 slot each. Potions = `ceil(doses/4)` slots. Fish = 1 slot each. Max 28. |
| DPS preview | `src/ui/dpsPreview.ts` | Show computed max hit, hit chance, and DPS for each configured weapon. Uses combat formula functions directly. |

---

## Files Summary

```
cg-sim/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts                          # Entry point, wires tick loop + render loop
│   ├── types.ts                         # All shared type definitions
│   ├── constants.ts                     # ARENA_SIZE=12, TICK_MS=600, BOSS_SIZE=5, etc.
│   ├── state/
│   │   ├── GameState.ts                 # GameState class + createGameState factory
│   │   ├── Player.ts                    # Player class
│   │   ├── Boss.ts                      # Boss class
│   │   └── inventory.ts                 # Inventory model + loadout validation
│   ├── combat/
│   │   ├── equipment.ts                 # Weapon/armor stat tables
│   │   ├── melee.ts                     # Melee max hit + attack roll
│   │   ├── ranged.ts                    # Ranged max hit + attack roll
│   │   ├── magic.ts                     # Magic attack roll + staff fixed max hit
│   │   ├── hitChance.ts                 # Hit chance formula
│   │   ├── boss.ts                      # Boss defence roll, boss damage tables
│   │   ├── prayer.ts                    # Prayer drain formula
│   │   └── __tests__/
│   │       └── combat.test.ts           # Formula verification tests
│   ├── engine/
│   │   ├── tick.ts                      # advanceTick — main game loop step
│   │   ├── bossAI.ts                    # Boss attack selection + rotation
│   │   ├── playerAttack.ts              # Player attack resolution
│   │   ├── eating.ts                    # Food/potion consumption
│   │   ├── stomp.ts                     # Stomp check
│   │   ├── pathfinding.ts              # BFS pathfinding on 12x12 grid
│   │   └── __tests__/
│   │       ├── tick.test.ts             # Tick engine unit tests
│   │       ├── pathfinding.test.ts      # Pathfinding tests
│   │       └── integration.test.ts      # Multi-tick headless simulation tests
│   ├── render/
│   │   ├── canvas.ts                    # Canvas creation + sizing
│   │   ├── arena.ts                     # Grid + entity rendering
│   │   ├── hud.ts                       # Text HUD sidebar
│   │   ├── loop.ts                      # requestAnimationFrame render loop
│   │   └── endScreen.ts                 # Win/loss overlay
│   ├── input/
│   │   └── input.ts                     # Click + keyboard → InputAction queue
│   └── ui/
│       ├── loadout.ts                   # Loadout configuration form
│       └── dpsPreview.ts                # DPS/max hit preview calculator
```

---

## Definition of Done

1. `npm run dev` starts the app; a 12x12 grid with a green player rectangle and red boss rectangle is visible.
2. Clicking a tile moves the player toward it at 1 tile/tick (walking) or 2 tiles/tick (running).
3. The boss fires attacks every 5 ticks, following the 4-attack rotation (ranged start, switch after 4).
4. Pressing 1/2 activates Protect from Missiles/Magic; correct prayer reduces boss damage to the table values.
5. Player can attack the boss; damage is calculated using OSRS formulas and reduces boss HP.
6. Player can eat food to heal.
7. Fight ends when either entity reaches 0 HP; a summary screen appears.
8. Loadout screen allows configuring armor/weapons/food before starting.
9. `npm test` passes all unit tests:
   - Combat formulas match known OSRS values (T3 staff + Augury = max hit 40, etc.)
   - Boss rotation: 4 attacks then switch, starting ranged
   - Pathfinding: routes around boss 5x5
   - Tick engine: deterministic state advancement
10. The entire game can be run headlessly (no DOM) for automated testing by calling `advanceTick` in a loop.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Combat formula edge cases wrong | Medium | High | Unit test every formula against OSRS wiki calculators. Test specific gear combos with known expected values. |
| Tick timing drift in browser | Low | Medium | Use `setInterval` for simplicity; if drift is noticeable, switch to a self-correcting timer that tracks elapsed time. Not a sprint 1 blocker. |
| Scope creep into tornadoes/floor tiles | High | Medium | Explicitly deferred. Sprint 1 boss does standard attacks + stomp only. No tornadoes, no floor hazards, no prayer-disable. |
| Pathfinding performance | Low | Low | 12x12 BFS is trivial. No optimization needed. |
| Canvas rendering too slow | Very Low | Low | Colored rectangles on a 576px canvas. Not a concern. |

---

## Security Considerations

- Runs entirely client-side; no server, no user data, no auth.
- No external network requests at runtime.
- No `eval()`, no dynamic script injection.
- Asset files (sprites/models) are bundled statically; not loaded from untrusted sources.
- No security concerns for sprint 1.

---

## Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| typescript | ^5.x | Language |
| vite | ^6.x | Dev server + bundler |
| vitest | ^3.x | Test runner |

Zero runtime dependencies. Vanilla TypeScript only.

---

## Open Questions

1. **Prayer-disable attack scope**: Deferred to sprint 2, or include in sprint 1 since it is part of the 4-attack magic rotation? **Recommendation: defer.** Treat magic rotation as 4 standard magic attacks for sprint 1. Add prayer-disable as a sprint 2 enhancement.
2. **Tornado scope**: Definitely deferred. Requires chasing AI, spawn logic, and despawn timers. Sprint 2+.
3. **Floor tile hazards**: Deferred. Requires phase-based timing system and tile state management. Sprint 2+.
4. **Run energy model**: Include basic running (2 tiles/tick) but defer energy drain mechanics? **Recommendation: yes**, infinite run energy in sprint 1. Simplifies movement without losing core value.
5. **Melee halberd range check**: The halberd has 2-tile range. Do we implement range checking in sprint 1? **Recommendation: yes**, it is simple (Manhattan distance to nearest boss tile <= weapon range) and affects gameplay correctness.
6. **Which weapon does the player start with?**: First non-zero tier weapon in loadout priority: staff > bow > halberd? Or explicit selection? **Recommendation: explicit "starting weapon" dropdown on loadout screen.**
