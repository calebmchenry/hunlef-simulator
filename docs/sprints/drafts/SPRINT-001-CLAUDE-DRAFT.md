# Sprint 001: Foundation — Tick Engine, Game State, and Playable Arena

## Overview

Stand up the project from scratch and deliver a minimal playable loop: a player on a 12×12 tile grid fighting a Corrupted Hunlef that executes its 4-attack rotation. The player can move, switch prayers, and attack with one weapon style. No tornadoes, no floor tiles, no combo eating — just the core tick engine, combat math, movement, and prayer switching.

**Goal:** A browser tab where you can click "Start Fight", see the arena, move around, pray-switch against the boss's ranged/magic rotation, and deal damage back. The tick engine and combat formulas are unit-tested against known OSRS values.

---

## Use Cases

1. **Developer verification** — Run `npm run dev`, open browser, see a 12×12 grid with player and boss entities.
2. **Prayer switching practice** — Boss cycles ranged→magic every 4 attacks. Player toggles Protect from Missiles / Protect from Magic. Correct prayer reduces damage per the armor-tier table; wrong prayer means ~68 typeless.
3. **Basic combat** — Player equips one weapon (T3 staff as default), attacks the boss, sees hit/miss and damage numbers. Boss HP bar depletes.
4. **Win/loss** — Boss reaches 0 HP → win screen. Player reaches 0 HP → loss screen. Both show elapsed ticks. "Restart" returns to loadout screen.
5. **Loadout selection** — Choose armor tier and one weapon tier before starting. Inventory slots not yet enforced (sprint 2).
6. **Headless testing** — `GameSimulation.runTicks(n)` advances state without rendering, enabling automated tests.

---

## Architecture

### Tech Stack Decision

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Language | TypeScript (strict) | Type safety for complex combat math; catches formula bugs at compile time |
| Bundler | Vite | Fast HMR, zero-config TS, simple for greenfield |
| Rendering | 2D Canvas (top-down) | OSRS is tile-based; 2D is sufficient for sprint 1. Defer 3D model rendering to a later sprint. Colored rectangles for entities, grid lines for tiles. |
| Testing | Vitest | Co-located with Vite, fast, native TS support |
| State management | Plain TypeScript classes | No framework needed; game state is a single object graph advanced by the tick engine |
| UI framework | None (vanilla DOM) | Loadout screen and HUD are simple enough for raw HTML/CSS. No React/Vue overhead. |

### Core Architecture

```
src/
├── engine/
│   ├── TickEngine.ts          # 600ms interval loop, dispatches tick events
│   └── GameSimulation.ts      # Owns all game state, processes one tick
├── combat/
│   ├── formulas.ts            # Pure functions: maxHit, attackRoll, hitChance
│   ├── CombatStyle.ts         # Enum: Melee, Ranged, Magic
│   └── PrayerManager.ts       # Active prayers, drain calculation
├── entities/
│   ├── Player.ts              # Player state: hp, prayer, position, equipment, cooldowns
│   ├── Boss.ts                # Boss state: hp, attack counter, current style, position
│   └── types.ts               # Shared entity types (Position, Equipment, etc.)
├── world/
│   ├── Arena.ts               # 12×12 grid, tile occupancy, collision
│   └── Pathfinding.ts         # BFS/A* for click-to-move on the grid
├── equipment/
│   ├── items.ts               # Static data: weapon/armor stats from INTENT.md tables
│   └── Loadout.ts             # Player loadout configuration type
├── input/
│   └── InputManager.ts        # Click-to-move, prayer hotkeys, attack commands
├── render/
│   ├── Renderer.ts            # Canvas drawing: grid, entities, projectiles
│   ├── HUD.ts                 # DOM-based: HP/prayer orbs, boss HP bar, prayer icons
│   └── LoadoutScreen.ts       # Pre-fight configuration UI
├── main.ts                    # Entry point: wires everything together
└── index.html                 # Single HTML page
```

### State Flow (per tick)

```
1. InputManager collects queued inputs (move target, prayer toggle, attack command)
2. GameSimulation.processTick():
   a. Player prayer drain
   b. Player movement (1 step toward target tile)
   c. Boss AI: decide attack (rotation counter), check stomp
   d. Boss attack resolution: roll hit, apply damage (prayer-reduced or full)
   e. Player attack resolution: check cooldown, roll hit, apply damage to boss
   f. Death checks (player HP ≤ 0, boss HP ≤ 0)
3. Renderer.draw(gameState)
4. HUD.update(gameState)
```

---

## Implementation

### Phase 1: Project Scaffold & Tick Engine (Foundation)

**Tasks:**

1. **Initialize project**
   - `npm create vite@latest . -- --template vanilla-ts`
   - Configure `tsconfig.json`: `strict: true`, `target: "ES2022"`, `moduleResolution: "bundler"`
   - Add Vitest: `npm i -D vitest`
   - Add `vitest` config in `vite.config.ts`
   - Verify `npm run dev` shows a blank page

2. **Implement `TickEngine`** — `src/engine/TickEngine.ts`
   ```typescript
   export class TickEngine {
     private intervalId: number | null = null;
     private tickCount = 0;
     private readonly TICK_MS = 600;
     private onTick: (tick: number) => void;

     constructor(onTick: (tick: number) => void) { this.onTick = onTick; }
     start(): void { /* setInterval at 600ms */ }
     stop(): void { /* clearInterval */ }
     get currentTick(): number { return this.tickCount; }
   }
   ```
   - `setInterval` based (not `requestAnimationFrame` — ticks are game logic, not rendering)
   - Expose `currentTick` for HUD display

3. **Implement `GameSimulation`** — `src/engine/GameSimulation.ts`
   ```typescript
   export class GameSimulation {
     player: Player;
     boss: Boss;
     arena: Arena;
     tickCount = 0;
     status: 'waiting' | 'running' | 'won' | 'lost' = 'waiting';

     processTick(): void { /* see State Flow above */ }
     runTicks(n: number): void { /* headless batch — for testing */ }
   }
   ```

4. **Write tick engine tests** — `src/engine/__tests__/TickEngine.test.ts`
   - `runTicks(10)` advances `tickCount` to 10
   - State mutations happen exactly once per tick call

### Phase 2: Arena, Entities, and Movement

**Tasks:**

5. **Implement `Arena`** — `src/world/Arena.ts`
   ```typescript
   export class Arena {
     readonly width = 12;
     readonly height = 12;
     isWalkable(x: number, y: number, bossPos: Position, bossSize: number): boolean;
   }
   ```
   - All 144 tiles walkable except tiles occupied by the boss's 5×5 footprint
   - Boss position = southwest corner of its 5×5 area (OSRS convention)

6. **Implement `Position` and entity types** — `src/entities/types.ts`
   ```typescript
   export interface Position { x: number; y: number; }
   export interface CombatStats {
     attack: number; strength: number; defence: number;
     ranged: number; magic: number; hitpoints: number; prayer: number;
   }
   ```

7. **Implement `Player`** — `src/entities/Player.ts`
   ```typescript
   export class Player {
     position: Position;
     hp: number;
     maxHp = 99;
     prayerPoints: number;
     stats: CombatStats;
     equipment: Loadout;
     targetTile: Position | null = null;  // click-to-move destination
     attackCooldown = 0;                  // ticks until next attack
   }
   ```

8. **Implement `Boss`** — `src/entities/Boss.ts`
   ```typescript
   export type BossStyle = 'ranged' | 'magic';

   export class Boss {
     position: Position;               // SW corner of 5×5
     hp = 1000;
     maxHp = 1000;
     readonly size = 5;
     currentStyle: BossStyle = 'ranged';
     attackCounter = 0;                // 0–3, switches style at 4
     attackCooldown = 0;               // 5-tick attack speed
     stats: CombatStats;               // all 240s
     defenceBonus = 20;
   }
   ```
   - Boss starts centered: position `{x: 3, y: 3}` (SW corner), occupying tiles (3,3)–(7,7)

9. **Implement `Pathfinding`** — `src/world/Pathfinding.ts`
   - BFS on the 12×12 grid, avoiding boss footprint tiles
   - Returns next tile toward destination (one step per tick when walking)
   - No diagonal movement needed for sprint 1 (OSRS supports it, but can defer)
   - Actually: OSRS uses diagonal movement. Implement 8-directional BFS.

10. **Implement `InputManager`** — `src/input/InputManager.ts`
    - Canvas click → convert pixel coords to tile coords → set `player.targetTile`
    - Keyboard bindings: `F1` = Protect from Magic, `F2` = Protect from Missiles, `Esc` = turn off prayers
    - Queue inputs; they take effect on the next tick

11. **Write movement tests** — `src/world/__tests__/Pathfinding.test.ts`
    - Player at (0,0), target (2,2): should reach in 2 ticks (diagonal)
    - Player cannot path through boss footprint
    - Player within boss 5×5 area triggers stomp flag

### Phase 3: Combat Formulas

**Tasks:**

12. **Implement combat formulas** — `src/combat/formulas.ts`
    ```typescript
    // All formulas are pure functions matching INTENT.md exactly.

    export function meleeMaxHit(strLevel: number, strBonus: number, prayerMult: number, stanceBonus: number): number {
      const effectiveStr = Math.floor(Math.floor((strLevel) * prayerMult) + stanceBonus + 8);
      return Math.floor((effectiveStr * (strBonus + 64) + 320) / 640);
    }

    export function meleeAttackRoll(atkLevel: number, atkBonus: number, prayerMult: number, stanceBonus: number): number {
      const effectiveAtk = Math.floor(Math.floor((atkLevel) * prayerMult) + stanceBonus + 8);
      return effectiveAtk * (atkBonus + 64);
    }

    export function rangedMaxHit(rngLevel: number, rngStrBonus: number, prayerMult: number): number {
      const effectiveStr = Math.floor(Math.floor((rngLevel) * prayerMult) + 8);
      return Math.floor(0.5 + effectiveStr * (rngStrBonus + 64) / 640);
    }

    export function rangedAttackRoll(rngLevel: number, rngAtkBonus: number, prayerMult: number, stanceBonus: number): number {
      const effectiveAtk = Math.floor(Math.floor((rngLevel) * prayerMult) + stanceBonus + 8);
      return effectiveAtk * (rngAtkBonus + 64);
    }

    export function magicAttackRoll(magLevel: number, magAtkBonus: number, prayerMult: number): number {
      const effectiveMag = Math.floor(Math.floor((magLevel) * prayerMult) + 9);
      return effectiveMag * (magAtkBonus + 64);
    }

    export function magicMaxHit(tier: 1 | 2 | 3, augury: boolean): number {
      const base = { 1: 23, 2: 31, 3: 39 }[tier];
      return augury ? base + 1 : base;
    }

    export function hitChance(attackRoll: number, defenceRoll: number): number {
      if (attackRoll > defenceRoll) {
        return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
      }
      return attackRoll / (2 * (defenceRoll + 1));
    }

    export function npcDefenceRoll(defLevel: number, defBonus: number): number {
      return (defLevel + 9) * (defBonus + 64);
      // Hunlef: (240 + 9) * (20 + 64) = 249 * 84 = 20,916
    }
    ```

13. **Implement static equipment data** — `src/equipment/items.ts`
    ```typescript
    export interface WeaponStats {
      atkBonus: number; strBonus: number; prayerBonus: number;
      attackSpeed: number; range: number; style: 'melee' | 'ranged' | 'magic';
    }
    export interface ArmorStats {
      defBonus: number;  // applies to all styles equally
      prayerBonus: number;
    }

    export const BOWS: Record<1 | 2 | 3, WeaponStats> = {
      1: { atkBonus: 72,  strBonus: 42,  prayerBonus: 1, attackSpeed: 4, range: 10, style: 'ranged' },
      2: { atkBonus: 118, strBonus: 88,  prayerBonus: 2, attackSpeed: 4, range: 10, style: 'ranged' },
      3: { atkBonus: 172, strBonus: 138, prayerBonus: 3, attackSpeed: 4, range: 10, style: 'ranged' },
    };

    export const STAVES: Record<1 | 2 | 3, WeaponStats & { fixedMaxHit: number }> = {
      1: { atkBonus: 84,  strBonus: 0, prayerBonus: 1, attackSpeed: 4, range: 10, style: 'magic', fixedMaxHit: 23 },
      2: { atkBonus: 128, strBonus: 0, prayerBonus: 2, attackSpeed: 4, range: 10, style: 'magic', fixedMaxHit: 31 },
      3: { atkBonus: 184, strBonus: 0, prayerBonus: 3, attackSpeed: 4, range: 10, style: 'magic', fixedMaxHit: 39 },
    };

    export const HALBERDS: Record<1 | 2 | 3, WeaponStats> = {
      1: { atkBonus: 68,  strBonus: 42,  prayerBonus: 1, attackSpeed: 4, range: 2, style: 'melee' },
      2: { atkBonus: 114, strBonus: 88,  prayerBonus: 2, attackSpeed: 4, range: 2, style: 'melee' },
      3: { atkBonus: 166, strBonus: 138, prayerBonus: 3, attackSpeed: 4, range: 2, style: 'melee' },
    };

    export const ARMOR_TIERS: Record<0 | 1 | 2 | 3, ArmorStats> = {
      0: { defBonus: 0,   prayerBonus: 0 },
      1: { defBonus: 166, prayerBonus: 6 },   // 28+86+52
      2: { defBonus: 224, prayerBonus: 9 },   // 48+102+74
      3: { defBonus: 284, prayerBonus: 12 },  // 68+124+92
    };
    ```

14. **Write formula tests** — `src/combat/__tests__/formulas.test.ts`
    - **T3 staff + 99 magic + Augury**: `magicMaxHit(3, true)` → 40
    - **T3 staff + 99 magic + no prayer**: `magicMaxHit(3, false)` → 39
    - **T3 halberd + 99 str + Piety**: `meleeMaxHit(99, 138, 1.23, 0)` → verify against known value
    - **T3 bow + 99 ranged + Rigour**: `rangedMaxHit(99, 138, 1.23)` → verify against known value
    - **Hunlef defence roll**: `npcDefenceRoll(240, 20)` → 20,916
    - **Hit chance**: given attack roll > defence roll, verify formula matches expected probability
    - **Hit chance**: given attack roll ≤ defence roll, verify formula

### Phase 4: Boss AI & Prayer System

**Tasks:**

15. **Implement `PrayerManager`** — `src/combat/PrayerManager.ts`
    ```typescript
    export type ProtectionPrayer = 'magic' | 'missiles' | null;

    export class PrayerManager {
      active: ProtectionPrayer = null;
      private readonly drainRate = 12;  // protect prayers drain 12 per drain tick

      activate(prayer: ProtectionPrayer): void;
      deactivate(): void;
      drainTick(prayerBonus: number): number; // returns points drained this tick
      isProtecting(style: 'ranged' | 'magic'): boolean;
    }
    ```
    - Drain formula: `drainResistance = 2 * prayerBonus + 60`, `secondsPerPoint = 0.6 * (drainResistance / drainRate)`
    - Prayer switches queue and take effect next tick (matching OSRS)

16. **Implement boss attack rotation in `Boss`**
    - `Boss.decideAttack()`: returns `'standard_ranged' | 'standard_magic' | 'prayer_disable'`
    - Start ranged. After 4 attacks, switch to magic. After 4 magic attacks, switch to ranged.
    - During magic phase: one of the 4 attacks is prayer-disable (random position 0–3)
    - Attack cooldown: 5 ticks between attacks

17. **Implement boss damage resolution in `GameSimulation`**
    - If player has correct prayer: damage = `random(0, reducedMaxHit)` per armor tier table
    - If no/wrong prayer: damage = `random(0, 68)` typeless
    - Stomp: if player tile overlaps boss 5×5, deal `random(0, 68)` typeless, does not advance counter
    - Prayer-disable: set `PrayerManager.active = null`

18. **Implement player attack resolution**
    - Check attack cooldown (4 ticks for all gauntlet weapons)
    - Check range (halberd: 2 tiles, bow/staff: 10 tiles) — distance = Chebyshev to nearest boss tile
    - Roll accuracy: `hitChance(playerAttackRoll, bossDefenceRoll)`
    - Roll damage: `random(0, maxHit)` if hit, 0 if miss

19. **Write boss rotation tests** — `src/entities/__tests__/Boss.test.ts`
    - Boss fires exactly 4 ranged attacks, then switches to magic
    - After 4 magic attacks, switches back to ranged
    - Prayer-disable occurs exactly once per magic phase
    - Stomp does not advance the attack counter

20. **Write prayer drain tests** — `src/combat/__tests__/PrayerManager.test.ts`
    - Full T3 armor (+12 prayer bonus): drain rate matches expected
    - No armor (+0 prayer bonus): drain rate matches expected
    - Prayer deactivates when points reach 0

### Phase 5: Rendering & HUD

**Tasks:**

21. **Implement `Renderer`** — `src/render/Renderer.ts`
    ```typescript
    export class Renderer {
      private ctx: CanvasRenderingContext2D;
      private readonly TILE_SIZE = 48;  // pixels per tile
      // Canvas = 12 * 48 = 576px square

      draw(state: GameSimulation): void {
        this.drawGrid();
        this.drawBoss(state.boss);
        this.drawPlayer(state.player);
        this.drawProjectiles(state);  // simple circles for now
      }
    }
    ```
    - Grid: light lines on dark background (corrupted gauntlet aesthetic — dark red/purple tones)
    - Boss: 5×5 tile colored rectangle (orange-red for corrupted)
    - Player: 1×1 tile colored rectangle (white/cyan)
    - Style indicator: border color on boss changes with attack style (green = ranged, red = magic)
    - Hit splats: brief text overlay showing damage number (fade after 1 second)

22. **Implement `HUD`** — `src/render/HUD.ts`
    - DOM elements overlaid on or beside the canvas
    - Player HP orb (green bar, text: "HP: 78/99")
    - Prayer points orb (cyan bar, text: "Prayer: 45/77")
    - Active prayer indicator using the extracted sprite PNGs (`docs/assets/sprites/sprite_127_frame0.png` for Protect from Magic, `sprite_128_frame0.png` for Protect from Missiles)
    - Boss HP bar (red bar above canvas, text: "Hunlef: 847/1000")
    - Attack counter display: "Attacks: 2/4 (Ranged)" — shows remaining attacks before style switch
    - Current tick counter

23. **Implement `LoadoutScreen`** — `src/render/LoadoutScreen.ts`
    - HTML form shown before fight starts
    - Dropdowns: armor tier (0–3), weapon type + tier (staff/bow/halberd × 0–3)
    - Only one weapon selectable for sprint 1 (simplifies combat resolution)
    - "Start Fight" button → hides loadout, shows canvas, starts TickEngine
    - Computed DPS preview: show max hit and hit chance for the selected weapon vs. Hunlef

24. **Wire everything in `main.ts`**
    ```typescript
    const sim = new GameSimulation(loadout);
    const renderer = new Renderer(canvas);
    const hud = new HUD(hudContainer);
    const input = new InputManager(canvas, sim);
    const engine = new TickEngine((tick) => {
      sim.processTick();
      renderer.draw(sim);
      hud.update(sim);
      if (sim.status === 'won' || sim.status === 'lost') {
        engine.stop();
        showEndScreen(sim);
      }
    });
    ```

25. **Implement win/loss screen**
    - On death or kill: overlay showing result, elapsed ticks (× 0.6 = seconds), damage dealt
    - "Restart" button returns to loadout screen

### Phase 6: Polish & Integration Testing

**Tasks:**

26. **End-to-end headless simulation test** — `src/__tests__/integration.test.ts`
    - Create `GameSimulation` with T3 staff, T3 armor, 99 stats
    - `sim.runTicks(500)` — verify simulation doesn't crash, boss and player take damage
    - Verify boss style switches happen at correct intervals

27. **Prayer switching integration test**
    - Simulate player always praying correctly → damage taken should be ≤ reduced max hit per tick
    - Simulate player never praying → average damage should approximate 68/2 per boss attack

28. **Manual playtesting checklist**
    - [ ] `npm run dev` opens the loadout screen
    - [ ] Selecting T3 staff + T3 armor and clicking "Start" shows the arena
    - [ ] Clicking a tile moves the player toward it
    - [ ] Boss attacks every 5 ticks, visually indicated by style color
    - [ ] F1/F2 toggles prayers, prayer drain is visible
    - [ ] Player attacks when in range, boss HP decreases
    - [ ] Boss switches style after 4 attacks
    - [ ] Walking under boss triggers stomp damage
    - [ ] Win/loss screens appear correctly

---

## Files Summary

| File | Purpose |
|------|---------|
| `package.json` | Vite + Vitest + TypeScript dependencies |
| `tsconfig.json` | Strict TypeScript config |
| `vite.config.ts` | Vite config with Vitest integration |
| `index.html` | Single-page entry point |
| `src/main.ts` | App entry: wires simulation, renderer, input, tick engine |
| `src/engine/TickEngine.ts` | 600ms interval game loop |
| `src/engine/GameSimulation.ts` | Core game state and per-tick processing |
| `src/combat/formulas.ts` | Pure combat math (max hit, accuracy, hit chance) |
| `src/combat/CombatStyle.ts` | Style enum and prayer-style mapping |
| `src/combat/PrayerManager.ts` | Prayer state, drain, protection checks |
| `src/entities/Player.ts` | Player entity state |
| `src/entities/Boss.ts` | Boss entity state, attack rotation logic |
| `src/entities/types.ts` | Shared types (Position, CombatStats) |
| `src/world/Arena.ts` | 12×12 grid, walkability checks |
| `src/world/Pathfinding.ts` | 8-directional BFS pathfinding |
| `src/equipment/items.ts` | Static weapon/armor stat tables |
| `src/equipment/Loadout.ts` | Loadout configuration type |
| `src/input/InputManager.ts` | Mouse click → tile, keyboard → prayer/attack |
| `src/render/Renderer.ts` | Canvas drawing (grid, entities, hit splats) |
| `src/render/HUD.ts` | DOM-based HP/prayer/boss HP display |
| `src/render/LoadoutScreen.ts` | Pre-fight weapon/armor selection UI |
| `src/combat/__tests__/formulas.test.ts` | Combat formula unit tests |
| `src/engine/__tests__/TickEngine.test.ts` | Tick engine unit tests |
| `src/entities/__tests__/Boss.test.ts` | Boss rotation unit tests |
| `src/combat/__tests__/PrayerManager.test.ts` | Prayer drain/switching tests |
| `src/world/__tests__/Pathfinding.test.ts` | Movement and collision tests |
| `src/__tests__/integration.test.ts` | Headless simulation integration tests |

---

## Definition of Done

1. `npm run dev` launches the app in a browser with no errors
2. `npm run test` passes all unit and integration tests
3. Loadout screen allows selecting armor tier (0–3) and one weapon (type + tier)
4. 12×12 tile grid renders with player (1×1) and boss (5×5) entities
5. Tick engine advances game state every 600ms; tick counter visible in HUD
6. Player moves toward clicked tile via 8-directional pathfinding, 1 tile/tick
7. Boss cannot be walked through (5×5 collision)
8. Boss attacks every 5 ticks, cycling ranged→magic every 4 attacks
9. Prayer-disable attack occurs once per magic phase, deactivates player prayers
10. Walking under boss triggers stomp damage (does not advance attack counter)
11. Player can toggle Protect from Magic / Protect from Missiles via keyboard
12. Correct prayer reduces boss damage to armor-tier-reduced max; wrong prayer = full 68 max
13. Prayer drains points over time; deactivates when points reach 0
14. Player attacks boss when in weapon range, with correct cooldown
15. Combat formulas (max hit, accuracy, hit chance) match OSRS values in unit tests
16. Boss HP bar and player HP/prayer orbs update each tick
17. Boss reaching 0 HP → win screen; player reaching 0 HP → loss screen
18. "Restart" from end screen returns to loadout selection
19. `GameSimulation.runTicks(n)` works headlessly for automated testing
20. No runtime TypeScript errors; `strict: true` compiles cleanly

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Combat formula inaccuracy** | Medium | High — defeats the purpose of a practice tool | Unit test every formula against hand-calculated OSRS values from INTENT.md. Cross-reference wiki DPS calculator. |
| **Tick timing drift** | Low | Medium — feel would be wrong | Use `setInterval(600)` for game ticks, separate `requestAnimationFrame` for rendering interpolation if needed. Sprint 1 keeps it simple (no interpolation). |
| **Scope creep** | High | Medium — sprint never finishes | Explicitly exclude: tornadoes, floor tiles, combo eating, inventory management, food consumption, run energy, multi-weapon switching. These are sprint 2+. |
| **Pathfinding edge cases** | Low | Low — player gets stuck | 8-directional BFS on a 12×12 grid is trivial. Edge case: player adjacent to boss corner — ensure diagonal movement doesn't clip through boss tiles. |
| **Prayer tick alignment** | Medium | Medium — prayer switches feel wrong | OSRS rule: prayer switch takes effect the tick after input. Implement input queue → process next tick. Write specific test for this. |

---

## Security Considerations

- **Client-side only** — no server, no user data, no authentication. Attack surface is minimal.
- **No external network requests** at runtime. All assets are bundled.
- **No `eval` or dynamic code execution.** Combat formulas are pure functions.
- **CSP**: The HTML page should set a strict Content-Security-Policy meta tag (`default-src 'self'; style-src 'self' 'unsafe-inline'`).

---

## Dependencies

### Runtime
None. Zero runtime dependencies. Vanilla TypeScript + Canvas API + DOM.

### Dev
| Package | Purpose |
|---------|---------|
| `vite` | Dev server and bundler |
| `typescript` | Compiler |
| `vitest` | Test runner |

---

## Open Questions

1. **Diagonal movement**: OSRS uses 8-directional movement. Should sprint 1 implement full diagonal pathfinding, or start with 4-directional and upgrade later? *Recommendation: implement 8-directional from the start — it's not harder on a 12×12 grid and avoids rework.*

2. **Rendering frame rate vs. tick rate**: Should rendering be decoupled from the 600ms tick (i.e., render at 60fps with interpolation between ticks)? *Recommendation: defer interpolation to sprint 2. Sprint 1 renders once per tick — it will look choppy but is mechanically correct.*

3. **Boss movement**: In OSRS, the Hunlef walks toward the player when they're out of range. Should sprint 1 implement boss movement? *Recommendation: yes, simple 1-tile-per-tick movement toward player when out of attack range. Without this, melee combat is untestable.*

4. **Prayer drain tick granularity**: OSRS drains prayer on a separate cycle (every game tick, checking accumulated drain). How precisely should we model this? *Recommendation: drain a fractional amount per tick, floor when displaying. Track accumulated drain with a float, subtract integer points when ≥ 1.0.*

5. **Hit splat rendering duration**: How long should damage numbers display? *Recommendation: 2 ticks (1.2 seconds), matching approximate OSRS feel.*

6. **Audio**: Sprint 1 has extracted sound synth definitions (`docs/assets/sounds/`). Should we attempt audio? *Recommendation: no. Sound synth data requires an OSRS-specific audio engine to render. Defer to a later sprint.*
