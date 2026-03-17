# Sprint 001 Intent: Foundation — Tick Engine, Game State, and Playable Arena

## Seed

Plan the first sprint for building the Corrupted Hunlef fight simulator. This is a greenfield browser-based project. Reference `docs/INTENT.md` for full game mechanics and `docs/assets/` for extracted OSRS cache assets. Start from scratch — no code exists yet.

## Context

- **Greenfield project** — no code, no git history, no existing conventions. Only `SEED.md` (vision), `docs/INTENT.md` (detailed mechanics spec with all combat formulas, boss stats, equipment tables), and `docs/assets/` (extracted OSRS cache data: 29 models, 4 sprites, 20 animation sequences, 6 spotanims, 28 item defs, 5 NPC defs, 10 sound defs).
- **Domain**: OSRS tick-based combat simulator. Core game loop = 600ms discrete ticks. 12×12 tile arena. Boss uses a 4-attack rotation with style switching, tornadoes, floor hazards, prayer-disable, and stomp.
- **Key fidelity requirement**: The simulator must replicate OSRS tick mechanics precisely — prayer switching, combo eating, hit chance formulas, damage calculations, and the boss's attack rotation. This is a practice tool for real players.
- **Tech stack is undecided** — only constraint is "local in browser." Need to choose framework, rendering approach, and project structure.
- **Assets available**: 3D model vertex/face data (JSON), prayer icon sprites (PNG), animation sequence frame data, spotanim projectile definitions, sound synth data. Models will need a rendering pipeline (WebGL or pre-rendered to 2D sprites).

## Recent Sprint Context

None — this is sprint 001.

## Relevant Codebase Areas

No code exists. Key reference documents:
- `docs/INTENT.md` — Complete mechanics specification (432 lines)
- `docs/assets/manifest.json` — Index of all extracted cache assets
- `docs/assets/defs/` — NPC, item, object, spotanim, sequence definitions (JSON)
- `docs/assets/models/` — 3D model data for boss, projectiles, items, armor (JSON)
- `docs/assets/sprites/` — Prayer icon PNGs
- `docs/assets/sounds/` — Sound effect synth definitions (JSON)
- `SEED.md` — Original project vision

## Constraints

- Must run entirely client-side in the browser (no server)
- Tick system must be exactly 600ms per tick
- Combat formulas must match OSRS exactly (see INTENT.md Combat Formulas section)
- Boss attack rotation must be deterministic: starts Ranged, switches every 4 attacks
- 12×12 walkable tile grid, boss is 5×5 tiles
- Sprint 1 should be scoped to be completable — lay foundations, not try to finish everything
- 3D model assets are in OSRS format (vertex/face JSON) — need rendering strategy decision

## Success Criteria

1. Project builds and runs in browser with `npm run dev` or equivalent
2. A 12×12 tile grid renders with a player entity and a boss entity
3. A tick engine advances game state every 600ms
4. Player can move on the grid via click-to-move (tile-based pathfinding)
5. Boss performs its 4-attack rotation cycle (ranged → magic → ranged → ...)
6. Player can switch protection prayers
7. Damage calculation works correctly for at least one weapon type
8. A basic loadout selection screen exists (even if minimal)

## Verification Strategy

- **Reference implementation**: OSRS itself. The INTENT.md formulas are the spec.
- **Correctness tests**: Unit tests for combat formulas (max hit, accuracy roll, hit chance) against known OSRS values. E.g., T3 staff with 99 magic + Augury should produce max hit 40.
- **Tick engine tests**: Verify actions queue correctly, resolve at tick boundaries, and the 600ms cadence is maintained.
- **Boss rotation test**: Verify the boss fires exactly 4 attacks before switching style, starting with Ranged.
- **Integration test**: A "simulate N ticks" function that can run the game headlessly for automated testing.

## Uncertainty Assessment

- **Correctness uncertainty: Medium** — OSRS formulas are well-documented in INTENT.md, but edge cases (e.g., combo eating timing, prayer switch tick-alignment) may surface during implementation.
- **Scope uncertainty: Medium** — Sprint 1 needs to establish foundations without overreaching. The boundary between "foundation" and "feature" is fuzzy (e.g., how much of the boss AI belongs in sprint 1?).
- **Architecture uncertainty: High** — No tech stack chosen. Rendering approach (2D canvas, WebGL, or hybrid) is a major decision. Entity-component-system vs. object-oriented game state. How to structure the tick engine for testability.

## Open Questions

1. **Rendering approach**: Should we use 2D canvas (simpler, OSRS is inherently tile-based and could work as a top-down 2D view), WebGL (can render the extracted 3D models natively), or a hybrid? What visual fidelity level is right for sprint 1?
2. **Framework choice**: Vanilla TypeScript + Canvas? A game framework like Phaser/PixiJS? Or a lightweight approach with just HTML5 Canvas?
3. **How much boss AI in sprint 1?**: Just the attack rotation (4-attack cycle + style switching)? Or also tornadoes and floor tiles?
4. **Model rendering**: The extracted models are OSRS vertex/face data. Should sprint 1 attempt to render them, or use placeholder sprites and defer model rendering?
5. **State management**: ECS pattern? Simple class hierarchy? How should game state be structured for testability and the tick system?
6. **What's the right visual perspective?**: Top-down 2D (like a tile map), isometric (closer to OSRS feel), or 3D camera?
