# Sprint 001 Draft: Gemini Perspective — Engine Architecture First

**Author perspective:** Game engine architect — prioritize clean architecture, separation of concerns, and extensibility over sprint 1 visual output.

---

## Overview

Sprint 1 establishes the foundational game engine: an ECS-based simulation layer, a deterministic tick engine, a rendering abstraction backed by PixiJS, and a minimal playable arena proving the architecture works end-to-end. The visible output will be modest (colored rectangles on a tile grid, basic prayer switching), but the architecture will cleanly support tornadoes, floor hazards, 3D model rendering, audio, and full combat in subsequent sprints without refactoring the core.

### Key Architectural Decisions

1. **ECS (Entity-Component-System)** for all game state — not class hierarchies. Entities are numeric IDs; components are plain data objects; systems are pure functions over component queries. This makes the simulation fully serializable, testable headlessly, and trivially extensible.
2. **PixiJS v8** for rendering — a proven WebGL/Canvas renderer that gives us a GPU-accelerated scene graph now (colored sprites, tile maps) and a path to custom WebGL shaders for OSRS model rendering later. We do not write our own Canvas2D draw loops.
3. **Strict sim/presentation split** — the simulation (tick engine, ECS world, combat formulas) has zero knowledge of PixiJS, the DOM, or any rendering concept. A one-way data flow: simulation produces state, rendering reads it.
4. **Headless-first testing** — the tick engine and all systems run without a browser. Unit and integration tests execute via `vitest` against pure TypeScript with no DOM dependency.

---

## Use Cases (Sprint 1 Scope)

| # | Use Case | Notes |
|---|----------|-------|
| UC-1 | Player opens the app and sees a 12x12 tile grid with a player entity and a boss entity | Placeholder visuals (colored rectangles). Boss occupies 5x5 tiles. |
| UC-2 | Tick engine advances simulation at 600ms intervals | Observable via entity position changes and boss attack counter. |
| UC-3 | Player clicks a tile to move; movement resolves on tick boundaries | 1 tile/tick walking. Pathfinding via BFS on the 12x12 grid with boss collision. |
| UC-4 | Boss performs its 4-attack rotation (Ranged -> Magic -> Ranged -> ...) | Visual indicator of current style + attack counter. Projectile is a colored circle moving toward player. |
| UC-5 | Player switches protection prayers via keybind or click | Prayer state toggles; damage reduction applies on next boss attack. |
| UC-6 | Damage calculation for one weapon type (T3 staff) hits boss | Player auto-attacks when in range. Max hit and accuracy formulas verified against known values. |
| UC-7 | A minimal loadout screen lets the player pick armor tier and weapon tier | HTML/CSS overlay, not PixiJS. Feeds initial component data into ECS world. |
| UC-8 | Stomp damage applies when player stands under boss | Validates collision detection on the 5x5 footprint. |

---

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────┐
│                   Presentation                   │
│  PixiJS Renderer  │  Input Handler  │  Audio*    │
│  (renders ECS     │  (DOM events →  │  (future)  │
│   state each      │   command queue) │            │
│   frame)          │                  │            │
└────────┬──────────┴──────┬───────────┴────────────┘
         │ reads            │ writes
         ▼                  ▼
┌─────────────────────────────────────────────────┐
│                 Command Queue                    │
│  Array<GameCommand> — buffered per tick          │
└────────────────────┬────────────────────────────┘
                     │ consumed by
                     ▼
┌─────────────────────────────────────────────────┐
│                  Simulation                       │
│  Tick Engine  │  ECS World  │  Systems            │
│  (600ms loop, │  (entities, │  (movement, combat, │
│   deterministic│  components)│   boss AI, prayer,  │
│   step fn)    │             │   collision)         │
└─────────────────────────────────────────────────┘
```

### ECS Design

```typescript
// src/sim/ecs/types.ts

/** Entity is just a number */
export type Entity = number;

/** Component type tag — used as Map key */
export type ComponentType = string;

/** Base component — all components are plain objects with a `type` discriminator */
export interface Component {
  readonly type: ComponentType;
}

/** The World holds all entities and their components */
export interface World {
  nextEntityId: number;
  /** Map<Entity, Map<ComponentType, Component>> */
  entities: Map<Entity, Map<ComponentType, Component>>;
  /** Reverse index: ComponentType -> Set<Entity> for fast queries */
  componentIndex: Map<ComponentType, Set<Entity>>;
  /** Current tick number (0-indexed, increments each 600ms step) */
  tick: number;
  /** Queued commands from input layer, consumed at start of each tick */
  commandQueue: GameCommand[];
  /** Random seed state for deterministic RNG */
  rngState: number;
}
```

### Core Components (Sprint 1)

```typescript
// src/sim/components/position.ts
export interface PositionComponent extends Component {
  type: 'position';
  x: number;  // tile coordinate 0-11
  y: number;  // tile coordinate 0-11
}

// src/sim/components/size.ts
export interface SizeComponent extends Component {
  type: 'size';
  width: number;   // tiles (1 for player, 5 for boss)
  height: number;
}

// src/sim/components/health.ts
export interface HealthComponent extends Component {
  type: 'health';
  current: number;
  max: number;
}

// src/sim/components/combat-style.ts
export type AttackStyle = 'ranged' | 'magic' | 'melee';

export interface CombatStyleComponent extends Component {
  type: 'combatStyle';
  activeStyle: AttackStyle;
  attackCounter: number;     // 0-3, resets on style switch
  attacksPerCycle: number;   // always 4
}

// src/sim/components/prayer.ts
export type ProtectionPrayer = 'none' | 'protectMagic' | 'protectMissiles';

export interface PrayerComponent extends Component {
  type: 'prayer';
  activeProtection: ProtectionPrayer;
  prayerPoints: number;
  maxPrayerPoints: number;
  prayerBonus: number;
}

// src/sim/components/equipment.ts
export interface EquipmentComponent extends Component {
  type: 'equipment';
  armorTier: 0 | 1 | 2 | 3;
  bowTier: 0 | 1 | 2 | 3;
  staffTier: 0 | 1 | 2 | 3;
  halberdTier: 0 | 1 | 2 | 3;
  activeWeapon: 'bow' | 'staff' | 'halberd' | 'none';
}

// src/sim/components/attack-cooldown.ts
export interface AttackCooldownComponent extends Component {
  type: 'attackCooldown';
  ticksRemaining: number;
  attackSpeed: number;  // ticks between attacks
}

// src/sim/components/movement-target.ts
export interface MovementTargetComponent extends Component {
  type: 'movementTarget';
  targetX: number;
  targetY: number;
  path: Array<{ x: number; y: number }>;
}

// src/sim/components/boss-tag.ts
export interface BossTagComponent extends Component {
  type: 'bossTag';
  npcId: number;
}

// src/sim/components/player-tag.ts
export interface PlayerTagComponent extends Component {
  type: 'playerTag';
  stats: PlayerStats;
}

// src/sim/components/projectile.ts
export interface ProjectileComponent extends Component {
  type: 'projectile';
  sourceEntity: Entity;
  targetEntity: Entity;
  style: AttackStyle;
  damage: number;
  ticksToImpact: number;
}
```

### Command Types

```typescript
// src/sim/commands.ts

export type GameCommand =
  | { type: 'MOVE_TO'; targetX: number; targetY: number }
  | { type: 'SWITCH_PRAYER'; prayer: ProtectionPrayer }
  | { type: 'SWITCH_WEAPON'; weapon: 'bow' | 'staff' | 'halberd' }
  | { type: 'EAT_FOOD'; slot: number }
  | { type: 'DRINK_POTION'; slot: number };
```

### Systems (Sprint 1)

Each system is a pure function: `(world: World) => void` (mutates world in place for performance; purity is at the tick boundary — given the same world state and commands, the same output is produced).

| System | File | Responsibility |
|--------|------|----------------|
| `commandSystem` | `src/sim/systems/command.ts` | Drains `world.commandQueue`, translates commands into component mutations (e.g., sets `MovementTargetComponent`, toggles `PrayerComponent`). |
| `movementSystem` | `src/sim/systems/movement.ts` | Advances entities with `MovementTargetComponent` along their path by 1 tile/tick (walking). Respects boss collision box. |
| `bossAISystem` | `src/sim/systems/boss-ai.ts` | Manages the 4-attack rotation, style switching, fires projectile entities, handles stomp detection. |
| `projectileSystem` | `src/sim/systems/projectile.ts` | Decrements `ticksToImpact` on projectile entities; on impact, applies damage via `combatSystem`. |
| `combatSystem` | `src/sim/systems/combat.ts` | Resolves damage: rolls hit chance, calculates max hit, applies prayer reduction, mutates `HealthComponent`. Also handles player -> boss attacks. |
| `prayerDrainSystem` | `src/sim/systems/prayer-drain.ts` | Drains prayer points based on active prayers and prayer bonus. |
| `deathSystem` | `src/sim/systems/death.ts` | Checks for HP <= 0, sets game-over flag. |

### System Execution Order

```typescript
// src/sim/tick-engine.ts
const SYSTEM_PIPELINE: Array<(world: World) => void> = [
  commandSystem,      // 1. Process player input
  prayerDrainSystem,  // 2. Drain prayer
  movementSystem,     // 3. Move entities
  bossAISystem,       // 4. Boss decides and fires attacks
  projectileSystem,   // 5. Advance/resolve projectiles
  combatSystem,       // 6. Apply damage
  deathSystem,        // 7. Check win/loss
];

export function stepWorld(world: World): void {
  for (const system of SYSTEM_PIPELINE) {
    system(world);
  }
  world.tick++;
}
```

### Tick Engine

```typescript
// src/sim/tick-engine.ts

export const TICK_DURATION_MS = 600;

export interface TickEngine {
  start(): void;
  stop(): void;
  /** Run N ticks synchronously — for headless testing */
  stepN(n: number): void;
  getWorld(): World;
}

export function createTickEngine(world: World): TickEngine {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(() => stepWorld(world), TICK_DURATION_MS);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    stepN(n: number) {
      for (let i = 0; i < n; i++) {
        stepWorld(world);
      }
    },
    getWorld() {
      return world;
    },
  };
}
```

### Rendering Layer (PixiJS)

The renderer reads ECS world state each animation frame and updates PixiJS display objects. It never mutates the world. A `RenderSystem` maps entities to PixiJS sprites via a `DisplayComponent` registry local to the renderer (not stored in ECS).

```typescript
// src/render/renderer.ts
import { Application, Graphics, Container } from 'pixi.js';
import { World, Entity } from '../sim/ecs/types';

export interface GameRenderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  sync(world: World): void;
  destroy(): void;
}
```

For sprint 1, `sync()` draws:
- 12x12 grid lines
- Player as a colored rectangle at their tile position
- Boss as a 5x5 colored rectangle
- Projectiles as small colored circles (orange = ranged, purple = magic)
- Prayer indicator icons (using extracted sprite PNGs)
- HP bars for player and boss

### Deterministic RNG

All combat rolls use a seeded PRNG so fights are reproducible (important for replay and debugging).

```typescript
// src/sim/rng.ts
/** Mulberry32 — simple, fast, seedable 32-bit PRNG */
export function mulberry32(state: number): { next(): number; state: number } {
  return {
    get state() { return state; },
    next() {
      state |= 0; state = state + 0x6D2B79F5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  };
}
```

---

## Implementation

### Phase 1: Project Scaffolding (Day 1)

**Goal:** Working build pipeline, empty PixiJS canvas renders, test runner works.

| Task | File(s) | Details |
|------|---------|---------|
| 1.1 Init project | `package.json`, `tsconfig.json` | `npm create vite@latest` with TypeScript template. Add `pixi.js@^8`, `vitest` as dev dep. |
| 1.2 Directory structure | See Files Summary | Create all directories. No code yet, just the skeleton. |
| 1.3 Vite config | `vite.config.ts` | Alias `@sim` -> `src/sim`, `@render` -> `src/render`, `@ui` -> `src/ui`. |
| 1.4 PixiJS bootstrap | `src/render/renderer.ts`, `src/main.ts`, `index.html` | Render a blank 768x768 canvas (12 tiles x 64px). Confirm WebGL context. |
| 1.5 Vitest config | `vitest.config.ts` | Headless, no DOM. Verify with a trivial test. |
| 1.6 ESLint + Prettier | `.eslintrc.cjs`, `.prettierrc` | Strict TypeScript rules. |

### Phase 2: ECS Core + Tick Engine (Days 1-2)

**Goal:** World can hold entities with components, tick engine steps the world, all testable headlessly.

| Task | File(s) | Details |
|------|---------|---------|
| 2.1 ECS types | `src/sim/ecs/types.ts` | `Entity`, `Component`, `World` interfaces as designed above. |
| 2.2 World factory | `src/sim/ecs/world.ts` | `createWorld(seed: number): World`. Functions: `addEntity`, `addComponent`, `removeComponent`, `getComponent`, `queryEntities(componentTypes[])`. |
| 2.3 World tests | `src/sim/ecs/__tests__/world.test.ts` | Add/remove entities, query by component type, verify index consistency. |
| 2.4 Tick engine | `src/sim/tick-engine.ts` | `createTickEngine`, `stepWorld` as designed. `stepN` for headless. |
| 2.5 Tick engine tests | `src/sim/__tests__/tick-engine.test.ts` | Verify tick counter increments, `stepN` runs correct count, system pipeline executes in order. |
| 2.6 RNG | `src/sim/rng.ts` | Mulberry32. Deterministic: same seed -> same sequence. |
| 2.7 RNG tests | `src/sim/__tests__/rng.test.ts` | Verify determinism: two instances with same seed produce identical sequences. |
| 2.8 Command types | `src/sim/commands.ts` | `GameCommand` union type. |

### Phase 3: Core Components + Data Tables (Days 2-3)

**Goal:** All sprint 1 component types defined, weapon/armor stat tables implemented.

| Task | File(s) | Details |
|------|---------|---------|
| 3.1 Component definitions | `src/sim/components/*.ts` | One file per component: `position.ts`, `size.ts`, `health.ts`, `combat-style.ts`, `prayer.ts`, `equipment.ts`, `attack-cooldown.ts`, `movement-target.ts`, `boss-tag.ts`, `player-tag.ts`, `projectile.ts`. |
| 3.2 Component barrel export | `src/sim/components/index.ts` | Re-export all components. |
| 3.3 Equipment data tables | `src/sim/data/equipment.ts` | Typed lookup tables for armor stats, bow stats, staff stats, halberd stats per tier. Directly from INTENT.md tables. |
| 3.4 Boss stats table | `src/sim/data/boss.ts` | Boss HP, attack, defence, attack speed, defence bonus, size. NPC ID -> phase mapping. |
| 3.5 Prayer data table | `src/sim/data/prayers.ts` | Drain rates, multipliers for each prayer (Piety, Rigour, Augury, Eagle Eye, Protect from Magic/Missiles, etc.). |
| 3.6 Data table tests | `src/sim/data/__tests__/equipment.test.ts` | Spot-check: T3 staff magic atk = +184, T2 armor body def = +102, etc. |

### Phase 4: Combat Formulas (Days 3-4)

**Goal:** All OSRS combat formulas implemented and verified against known values.

| Task | File(s) | Details |
|------|---------|---------|
| 4.1 Melee formulas | `src/sim/formulas/melee.ts` | `meleeMaxHit(stats, equipment, prayer)`, `meleeAttackRoll(stats, equipment, prayer)`. |
| 4.2 Ranged formulas | `src/sim/formulas/ranged.ts` | `rangedMaxHit(stats, equipment, prayer)`, `rangedAttackRoll(stats, equipment, prayer)`. |
| 4.3 Magic formulas | `src/sim/formulas/magic.ts` | `magicMaxHit(staffTier, prayer)` (fixed), `magicAttackRoll(stats, equipment, prayer)`. |
| 4.4 Hit chance | `src/sim/formulas/hit-chance.ts` | `calculateHitChance(attackRoll, defenceRoll)`. |
| 4.5 Boss defence roll | `src/sim/formulas/defence.ts` | `bossDefenceRoll()` -> 20,916. |
| 4.6 Boss damage w/ prayer | `src/sim/formulas/boss-damage.ts` | `bossDamageOnPlayer(armorTier, prayerCorrect)` lookup. |
| 4.7 Formula barrel | `src/sim/formulas/index.ts` | Re-export all formulas. |
| 4.8 Formula tests | `src/sim/formulas/__tests__/combat.test.ts` | T3 staff + 99 magic + Augury -> max hit 40. T3 bow + 99 ranged + Rigour -> verify known max hit. Boss defence roll = 20,916. Hit chance for T3 staff = verify against community-known value. |

### Phase 5: Systems Implementation (Days 4-6)

**Goal:** All sprint 1 systems work. A headless simulation can run a fight.

| Task | File(s) | Details |
|------|---------|---------|
| 5.1 Command system | `src/sim/systems/command.ts` | Drain queue, apply MOVE_TO (compute BFS path, set MovementTarget), SWITCH_PRAYER (mutate PrayerComponent), SWITCH_WEAPON (mutate EquipmentComponent). |
| 5.2 Movement system | `src/sim/systems/movement.ts` | Pop next tile from path, update PositionComponent. Collision: reject moves into boss 5x5 footprint. |
| 5.3 BFS pathfinding | `src/sim/pathfinding.ts` | BFS on 12x12 grid. Blocked tiles = boss footprint. Returns `Array<{x, y}>`. |
| 5.4 Pathfinding tests | `src/sim/__tests__/pathfinding.test.ts` | Path around boss, path to adjacent tile, unreachable tile returns empty. |
| 5.5 Boss AI system | `src/sim/systems/boss-ai.ts` | Track attack counter. Every `attackSpeed` ticks, fire attack: create projectile entity with correct style. At counter=4, switch style. Stomp check: if player position is within boss footprint, deal typeless damage. |
| 5.6 Projectile system | `src/sim/systems/projectile.ts` | Decrement `ticksToImpact`; at 0, resolve: roll hit, apply damage to target health, remove projectile entity. |
| 5.7 Combat system | `src/sim/systems/combat.ts` | Player auto-attack: if active weapon is set and target is in range and cooldown is 0, create projectile toward boss. Decrement attack cooldown each tick. |
| 5.8 Prayer drain system | `src/sim/systems/prayer-drain.ts` | Compute drain rate from active prayers + prayer bonus. Decrement prayer points. If points reach 0, deactivate prayers. |
| 5.9 Death system | `src/sim/systems/death.ts` | If player HP <= 0 or boss HP <= 0, set `world.gameOver` flag with result. |
| 5.10 System pipeline tests | `src/sim/__tests__/integration.test.ts` | Run 100 ticks headlessly. Verify: boss fires at correct intervals, style switches at count 4, player takes no damage with correct prayer, player takes full damage without prayer, stomp triggers when under boss. |
| 5.11 World factory | `src/sim/world-factory.ts` | `createFightWorld(loadout: Loadout, seed: number): World` — spawns player entity at (6, 1), boss entity at (4, 5) (centered in room), populates all components. |

### Phase 6: Rendering + Input (Days 6-8)

**Goal:** PixiJS renders the ECS world state. Player can click to move and switch prayers.

| Task | File(s) | Details |
|------|---------|---------|
| 6.1 Tile grid renderer | `src/render/tile-grid.ts` | Draws 12x12 grid lines. Tile size = 64px. Total canvas = 768x768 (plus HUD space). |
| 6.2 Entity renderer | `src/render/entity-renderer.ts` | Maps entity position + size to PixiJS `Graphics` rectangles. Player = blue 64x64, boss = red 320x320. Updates position each frame by reading ECS. |
| 6.3 Projectile renderer | `src/render/projectile-renderer.ts` | Small circles: orange for ranged, purple for magic. Interpolated position between source and target for smooth animation between ticks. |
| 6.4 HUD renderer | `src/render/hud.ts` | HP bar (player), HP bar (boss), prayer indicator (uses extracted sprite PNGs from `docs/assets/sprites/`), attack counter display. Rendered as PixiJS UI elements above the game area. |
| 6.5 Renderer orchestrator | `src/render/renderer.ts` | `GameRenderer.sync(world)` calls all sub-renderers. Manages PixiJS `Application`, `Container` hierarchy. |
| 6.6 Input handler | `src/input/input-handler.ts` | Click on canvas -> translate pixel coords to tile coords -> push `MOVE_TO` command. Keyboard: F1/F2 for prayer switching -> push `SWITCH_PRAYER` command. 1/2/3 for weapon switch -> push `SWITCH_WEAPON` command. |
| 6.7 Frame loop | `src/main.ts` | `requestAnimationFrame` loop: calls `renderer.sync(engine.getWorld())`. Tick engine runs on its own `setInterval`. Rendering interpolates between ticks for smooth visuals. |
| 6.8 Tick interpolation | `src/render/interpolation.ts` | Track time since last tick. Interpolate entity positions between previous and current tile for smooth movement. `lerp(prevPos, currPos, tickProgress)`. |

### Phase 7: Loadout Screen + Integration (Days 8-9)

**Goal:** Player can configure loadout and start a fight.

| Task | File(s) | Details |
|------|---------|---------|
| 7.1 Loadout types | `src/ui/loadout-types.ts` | `Loadout` interface: armor tier, weapon tiers, fish counts, potion doses. |
| 7.2 Loadout screen | `src/ui/loadout-screen.ts` | HTML/CSS overlay (not PixiJS). Dropdowns for armor/weapon tiers. Number inputs for fish/potions. DPS preview per weapon (uses formulas). Slot counter with 28-max validation. "Start Fight" button. |
| 7.3 Loadout -> World | `src/ui/loadout-screen.ts` | On "Start Fight": hide overlay, call `createFightWorld(loadout, Date.now())`, create tick engine, start rendering. |
| 7.4 Game over screen | `src/ui/game-over-screen.ts` | On death/win: stop tick engine, show overlay with fight duration, damage taken, DPS. "Restart" returns to loadout. |
| 7.5 App bootstrap | `src/main.ts` | Entry point: show loadout screen. Wire up transitions between screens. |

---

## Files Summary

```
cg-sim/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── public/
│   └── sprites/                          # Copy prayer PNGs here from docs/assets/sprites/
│       ├── prayer-protect-magic.png
│       ├── prayer-protect-missiles.png
│       ├── prayer-protect-magic-inactive.png
│       └── prayer-protect-missiles-inactive.png
├── src/
│   ├── main.ts                           # App entry point, frame loop, screen transitions
│   ├── sim/
│   │   ├── ecs/
│   │   │   ├── types.ts                  # Entity, Component, World interfaces
│   │   │   ├── world.ts                  # createWorld, addEntity, addComponent, queryEntities
│   │   │   └── __tests__/
│   │   │       └── world.test.ts
│   │   ├── components/
│   │   │   ├── index.ts                  # Barrel re-export
│   │   │   ├── position.ts
│   │   │   ├── size.ts
│   │   │   ├── health.ts
│   │   │   ├── combat-style.ts
│   │   │   ├── prayer.ts
│   │   │   ├── equipment.ts
│   │   │   ├── attack-cooldown.ts
│   │   │   ├── movement-target.ts
│   │   │   ├── boss-tag.ts
│   │   │   ├── player-tag.ts
│   │   │   └── projectile.ts
│   │   ├── systems/
│   │   │   ├── command.ts
│   │   │   ├── movement.ts
│   │   │   ├── boss-ai.ts
│   │   │   ├── projectile.ts
│   │   │   ├── combat.ts
│   │   │   ├── prayer-drain.ts
│   │   │   └── death.ts
│   │   ├── formulas/
│   │   │   ├── index.ts                  # Barrel re-export
│   │   │   ├── melee.ts
│   │   │   ├── ranged.ts
│   │   │   ├── magic.ts
│   │   │   ├── hit-chance.ts
│   │   │   ├── defence.ts
│   │   │   ├── boss-damage.ts
│   │   │   └── __tests__/
│   │   │       └── combat.test.ts
│   │   ├── data/
│   │   │   ├── equipment.ts              # Weapon + armor stat tables
│   │   │   ├── boss.ts                   # Boss stats, NPC ID -> phase mapping
│   │   │   ├── prayers.ts               # Prayer drain rates, multipliers
│   │   │   └── __tests__/
│   │   │       └── equipment.test.ts
│   │   ├── commands.ts                   # GameCommand union type
│   │   ├── rng.ts                        # Deterministic Mulberry32 PRNG
│   │   ├── pathfinding.ts               # BFS on 12x12 grid
│   │   ├── tick-engine.ts               # createTickEngine, stepWorld, SYSTEM_PIPELINE
│   │   ├── world-factory.ts             # createFightWorld(loadout, seed)
│   │   └── __tests__/
│   │       ├── tick-engine.test.ts
│   │       ├── rng.test.ts
│   │       ├── pathfinding.test.ts
│   │       └── integration.test.ts       # Headless multi-tick simulation tests
│   ├── render/
│   │   ├── renderer.ts                   # GameRenderer: init, sync, destroy
│   │   ├── tile-grid.ts                 # 12x12 grid drawing
│   │   ├── entity-renderer.ts           # ECS entities -> PixiJS display objects
│   │   ├── projectile-renderer.ts       # Projectile interpolation + rendering
│   │   ├── hud.ts                       # HP bars, prayer icons, attack counter
│   │   └── interpolation.ts            # Tick-fraction lerp for smooth visuals
│   ├── input/
│   │   └── input-handler.ts             # Click-to-move, keybinds -> command queue
│   └── ui/
│       ├── loadout-types.ts             # Loadout interface
│       ├── loadout-screen.ts            # HTML/CSS loadout configuration
│       └── game-over-screen.ts          # Win/loss summary overlay
└── docs/
    └── assets/                          # Already exists — extracted OSRS cache data
```

---

## Definition of Done

1. `npm run dev` starts the app; a 12x12 tile grid renders with placeholder player and boss entities.
2. Tick engine advances at 600ms intervals; observable via boss attack counter changing.
3. Clicking a tile causes the player to walk there at 1 tile/tick, pathing around the boss.
4. Boss fires 4 ranged attacks, switches to magic, fires 4 magic attacks, repeats. Projectiles visually travel to player.
5. Player can toggle Protect from Magic / Protect from Missiles via keyboard or click. Correct prayer reduces boss damage to the tier-appropriate table value; incorrect/no prayer allows full ~68 damage.
6. Player auto-attacks boss with the selected weapon when in range. T3 staff max hit = 39 (40 with Augury) verified by test.
7. Standing under the boss triggers stomp for up to 68 typeless damage.
8. Loadout screen allows selecting armor tier and weapon tiers; validates 28-slot inventory limit.
9. Game over triggers on player or boss reaching 0 HP; summary screen shows fight duration.
10. `npm test` passes: all formula tests, pathfinding tests, ECS tests, tick engine tests, and integration tests (headless 100+ tick simulation).
11. Zero rendering code imports from `src/sim/`. Zero simulation code imports from `src/render/` or `pixi.js`.

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ECS overhead slows iteration vs. plain classes | Medium | Medium | Keep the ECS minimal (no archetype storage, no bitmasking). `Map<Entity, Map<string, Component>>` is simple and sufficient at this scale (~10 entities). Optimize later only if profiling shows need. |
| PixiJS v8 API instability or bundle size concerns | Low | Low | Pin exact version. PixiJS v8 is stable as of 2025. Tree-shaking via Vite keeps bundle small. Fallback: v7 has near-identical API. |
| Tick engine drift (setInterval inaccuracy) | Medium | Medium | Track wall-clock time. If a tick callback fires late, run multiple `stepWorld` calls to catch up. Never skip ticks. |
| Rendering interpolation jank during tick catch-up | Low | Medium | Cap visual interpolation delta. If > 2 ticks behind, snap to current state rather than fast-forwarding. |
| Sprint scope too large — architecture investment delays visible output | High | Medium | Phases are ordered so that headless simulation (Phases 1-5) works before any rendering. If time runs short, reduce Phase 6 to a minimal canvas with no interpolation. The loadout screen (Phase 7) can be a single hardcoded loadout. |
| Combat formula edge cases differ from OSRS | Medium | Medium | Test against multiple known data points from the OSRS wiki and community DPS calculators. Flag discrepancies as bugs for sprint 2. |

---

## Security Considerations

- **Client-only application** — no server, no network requests, no user data storage. Attack surface is minimal.
- **No eval or dynamic code execution** — all game logic is statically typed TypeScript.
- **Asset loading** — sprites are bundled at build time from `public/sprites/`, not fetched from external URLs. No XSS vector.
- **RNG seed** — uses `Date.now()` by default. Not cryptographically sensitive; this is a single-player simulator.
- **Dependencies** — PixiJS is a well-maintained, widely-used library. Pin exact versions in `package-lock.json`. Vitest is dev-only. Minimize dependency count.

---

## Dependencies

### Runtime
| Package | Version | Purpose |
|---------|---------|---------|
| `pixi.js` | `^8.6` | WebGL/Canvas rendering, scene graph, sprite management |

### Dev
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | `^5.7` | Type safety |
| `vite` | `^6.2` | Build tool, dev server, HMR |
| `vitest` | `^3.0` | Test runner (headless, fast, Vite-native) |
| `eslint` | `^9.0` | Linting |
| `prettier` | `^3.5` | Code formatting |
| `@vitest/coverage-v8` | `^3.0` | Coverage reporting |

### Assets (already extracted)
- `docs/assets/sprites/sprite_127_frame0.png` — Protect from Magic icon
- `docs/assets/sprites/sprite_128_frame0.png` — Protect from Missiles icon
- `docs/assets/models/` — 29 OSRS model JSONs (deferred to future sprint for 3D rendering)

---

## Open Questions

1. **Tick interpolation strategy**: Should the renderer interpolate entity positions between ticks for smooth movement, or snap to tile positions? Interpolation looks better but adds complexity. Recommendation: implement it (Phase 6.8) but make it toggleable.

2. **ECS component storage**: The proposed `Map<Entity, Map<string, Component>>` is simple but has overhead. Should we use a column-oriented store (`Map<ComponentType, Map<Entity, Component>>`) instead for faster system queries? At ~10 entities it does not matter, but the column layout is more conventional for ECS and would be trivial to adopt now.

3. **PixiJS container hierarchy**: Should each tile be a PixiJS container (enabling per-tile click detection and future floor tile effects), or render the grid as a single Graphics object? Recommendation: individual tile containers — more memory but enables floor tile hazards in sprint 2 without refactoring.

4. **Projectile travel time**: OSRS projectiles have a travel time based on distance. Should sprint 1 model this (1 tick delay for projectile arrival) or have instant damage? Recommendation: 1 tick delay — it is core to prayer switching timing.

5. **Prayer switching tick alignment**: INTENT.md says "prayer switches take effect the tick after input is registered." Need to verify: does this mean the command is buffered and applied at the *start* of the next tick (matching our command system design), or is there an additional 1-tick delay beyond that?

6. **Audio architecture placeholder**: Should sprint 1 define the audio system interface (even if unimplemented) to avoid coupling issues later? Recommendation: define `src/audio/audio-manager.ts` with a no-op implementation and hook points in the system pipeline.

7. **WebGL model rendering path**: The extracted models have vertex/face data. Future sprints will need a custom WebGL shader or a Three.js integration alongside PixiJS. Should we choose PixiJS's WebGL context sharing approach now, or plan for a separate WebGL canvas overlaid? This affects the PixiJS `Application` configuration in sprint 1.
