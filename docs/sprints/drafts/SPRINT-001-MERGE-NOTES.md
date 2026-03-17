# Sprint 001 Merge Notes

## Draft Strengths

### Claude Draft
- Best combat formula implementation detail (full TypeScript code inline)
- Clear state flow diagram for tick processing order
- Prayer-disable attack included (user chose to defer)
- Practical file structure — not over-split

### Codex Draft
- Most pragmatic scope and timeline (3 days)
- `advanceTick` as a pure function (adopted)
- Includes eating/food mechanics (user chose to defer)
- `InputAction` union type design (adopted)
- `Loadout` interface with all weapons (adopted for data model, but only one weapon equippable in sprint 1)

### Gemini Draft
- Deterministic RNG with Mulberry32 (adopted — user selected this)
- Clean sim/render separation principle (adopted)
- Projectile-as-entity concept for visual travel time (adopted in simplified form)
- System pipeline execution order (adopted conceptually, but as function calls not ECS systems)

## Critiques Accepted

| Critique | From | Action |
|----------|------|--------|
| ECS is over-engineered for ~10 entities | Claude/Codex | Rejected ECS; using plain classes per user preference |
| PixiJS adds unnecessary dependency for colored rectangles | Claude/Codex | Rejected PixiJS; using vanilla Canvas per user preference |
| Prayer-disable is core to magic rotation | Claude | Noted but deferred per user choice — sprint 1 treats magic phase as 4 standard magic attacks |
| Eating/food is needed for survivability | Codex | Deferred per user choice |
| Deterministic RNG is critical for debugging | Gemini | Adopted per user choice |
| Tick interpolation adds visual polish | Gemini | Deferred — sprint 1 renders once per tick |

## Critiques Rejected

| Critique | From | Reason |
|----------|------|--------|
| Need ESLint + Prettier in sprint 1 | Gemini | Over-engineering for a solo greenfield project. Add when needed. |
| Need path aliases (@sim, @render) | Gemini | Unnecessary at this project size. Relative imports are fine. |
| Column-oriented component storage | Gemini | N/A since we're not using ECS |

## Interview Refinements

1. **Rendering**: Vanilla Canvas 2D — zero runtime dependencies
2. **Architecture**: Plain TypeScript classes, not ECS
3. **Scope**: Core tick engine + movement + boss rotation + prayer switching + deterministic RNG. No eating, no prayer-disable, no weapon switching.
4. **Perspective**: Top-down 2D
