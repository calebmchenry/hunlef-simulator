# Sprint 016 Draft Critique

This critique evaluates the Claude and Gemini drafts against the intent in `docs/sprints/drafts/SPRINT-016-INTENT.md` and the current implementation in:

- `src/render/Renderer3D.ts`
- `src/input/InputManager.ts`
- `src/input/KeyBindManager.ts`
- `src/engine/GameSimulation.ts`

## Claude Draft

### Strengths

1. **Good scope discipline.** Keeping the work inside `Renderer3D.ts` matches the intent's architecture assumptions and avoids unnecessary churn in simulation code or UI plumbing.

2. **Strong reuse of existing renderer patterns.** The draft leans on `tileToWorld()` / `entityCenterToWorld()`, the floor-overlay mesh pattern, and the existing tornado pooling model in `Renderer3D.ts:954-995`. That makes the implementation fit the codebase instead of fighting it.

3. **Clear phased rollout.** Separating tornado visibility from true-tile work is pragmatic. If the sprint runs short, the first phase still delivers user-visible value.

4. **Explicit snap-vs-lerp framing.** The draft directly addresses the core gameplay lesson in the intent: the rendered entity can lerp while the true tile snaps to the game-logic `pos`.

5. **Useful validation checklist.** Build, tests, visual checks, and a performance target are all present. That is enough structure for a real sprint, not just an idea dump.

### Weaknesses

1. **The tornado visibility fix may not address the main rendering inconsistency.** `loadTornadoGLTF()` currently does not call `applyUnlitMaterials()` (`src/render/Renderer3D.ts:374-395`), while the boss and player GLTF paths do (`src/render/Renderer3D.ts:298-338`, `src/render/Renderer3D.ts:422-429`). Increasing scale, Y offset, and spin helps, but it still leaves tornado visibility dependent on scene lighting.

2. **The boss true tile is the wrong primitive.** A filled 5x5 plane is not really a "tile-boundary indicator," and it pushes against the intent's constraint that true tiles must not obscure hazard readability. An outline/perimeter is a better fit for both the terminology and the visual constraint.

3. **The draft ignores the existing boss style ring.** `bossStyleIndicator` already occupies the boss footprint area at `y = 0.03` with `RingGeometry(2.2, 2.5, 32)` (`src/render/Renderer3D.ts:186-197`, `src/render/Renderer3D.ts:652-654`). A new 5x5 boss indicator needs an explicit coexistence plan.

4. **The player "square outline" via `RingGeometry` is only an approximation.** It is consistent with the current target tile indicator, but it is not a precise tile-boundary shape. For a feature explicitly described as tile-boundary accurate, a strip-based outline is more faithful.

5. **The target tile indicator regression risk is not handled.** The current target ring is created and updated at `y = 0.02` (`src/render/Renderer3D.ts:218-230`, `src/render/Renderer3D.ts:705-713`). The draft adds player/tornado indicators above that layer but never checks whether the target ring becomes visually subordinate or hidden when indicators overlap.

6. **Renderer cleanup is omitted.** The draft adds new meshes, materials, and geometries but does not extend `dispose()` (`src/render/Renderer3D.ts:997-1005`). That is a real ownership gap in a renderer that is recreated on fight restart.

### Gaps in Risk Analysis

- **Missing risk: transparent sort order.** Slight Y separation and `depthWrite: false` are helpful, but Three.js transparent rendering can still produce unstable ordering without explicit `renderOrder`.
- **Missing risk: fallback tornado path.** The fallback cone remains a dark `MeshLambertMaterial` today (`src/render/Renderer3D.ts:387-390`). The risk table should cover visibility improvements for both GLTF and fallback rendering.
- **Missing risk: existing indicator interactions.** The draft does not name the collision risk with the boss style ring or the target tile indicator.
- **Missing risk: renderer-owned resource cleanup.** New pooled overlays and materials need disposal guidance.

### Missing Edge Cases

- **Multiple tornadoes on the same tile.** This can happen because spawn selection samples candidate tiles with replacement (`src/engine/GameSimulation.ts:693-696`). One tile marker per tornado will stack identical meshes at the same position.
- **Tornadoes on top of the boss footprint.** Tornado movement explicitly allows boss overlap (`src/engine/GameSimulation.ts:500-508`). The draft discusses hazard overlap, but not boss/tornado indicator overlap.
- **State-transition behavior.** The sample logic mixes `countdown`, `running`, `won`, and `lost` handling in a way that is not fully coherent. The visibility policy for each indicator type should be defined once and tested.
- **Target tile overlap with true tile overlap.** Clicking the player's current tile or a tile occupied by a tornado should remain readable.

### Definition of Done Completeness

The DoD is solid on the core behavior, but it is still incomplete.

- It does **not** require the fallback tornado representation to be visibly improved.
- It does **not** verify that the boss style ring still reads clearly once the boss true tile exists.
- It does **not** verify overlapping tornado occupancy on one tile.
- It does **not** guard against regression of the existing target tile indicator.
- It does **not** mention cleanup/disposal expectations for the added renderer resources.

### Constructive Recommendation

Keep the renderer-only scope and the phased plan. Change the boss indicator to an outline, explicitly fix tornado material handling, add `renderOrder`, and expand the DoD to cover overlapping tornadoes, boss-ring coexistence, and target-ring regression.

## Gemini Draft

### Strengths

1. **Better true-tile primitive choice.** The outline-strip approach matches the intent's "tile-boundary indicators" language better than filled quads.

2. **More complete tornado visibility treatment.** Scale, tint, and a ground-level cue are a stronger response to "hard to see" than size-only changes.

3. **Concrete rendering-order thinking.** The Y-layer table is specific, and the draft notices that the target tile indicator can become a casualty of new overlays.

4. **Reusable indicator factory.** A `createTileOutline()` helper is a reasonable abstraction if the sprint wants consistent 1x1 and 5x5 indicator styling.

5. **Implementation details are explicit.** Constants, opacities, geometry sizes, and update points are concrete enough for an implementer to act on directly.

### Weaknesses

1. **The scope is broader than the intent, and the draft understates that.** The overview says the work is renderer-only, but the implementation adds a toggle keybind and names `KeyBindManager.ts`. That is not renderer-only anymore.

2. **The input integration point is wrong for the current codebase.** `KeyBindManager` is only a key-to-tab lookup object (`src/input/KeyBindManager.ts:13-39`). Actual keydown behavior lives in `InputManager.ts:49-61`. A toggle plan that names only `KeyBindManager.ts` is incomplete.

3. **The proposed key value is wrong for the current event handling.** The draft uses `KeyT`, but `InputManager` currently calls `getTabForKey(e.key)` (`src/input/InputManager.ts:49-50`). `KeyT` is an `e.code`-style value, not an `e.key` value.

4. **The tornado material analysis is based on the wrong current pipeline.** The draft assumes a MeshBasic-material path after unlit conversion, but `loadTornadoGLTF()` does not currently call `applyUnlitMaterials()` (`src/render/Renderer3D.ts:374-395`). The tinting plan needs to start from the actual material types.

5. **The draft also misses the boss style ring collision.** The existing ring at `y = 0.03` still needs a compatibility plan with a 5x5 boss outline.

6. **There is no scope-cut strategy.** The draft adds toggle plumbing, swirl meshes, outline groups, and target-ring movement, but it does not say what gets cut first if the sprint runs long.

### Gaps in Risk Analysis

- **Missing risk: wrong input wiring.** The draft should explicitly call out `InputManager` vs `KeyBindManager`, plus `e.key` vs `e.code`.
- **Missing risk: tornado material-path mismatch.** The proposed tint plan assumes a different current renderer path than the one on disk.
- **Missing risk: boss style ring coexistence.** This is one of the clearest existing-renderer interactions and should be in the table.
- **Missing risk: cleanup/disposal.** The draft adds pooled swirls, grouped outlines, and new materials/geometries but never discusses lifetime management.
- **Low-value risk included instead of a real one.** The `performance.now()` "drift" concern is not a meaningful risk here; tab backgrounding or frame-rate discontinuity is the real visual issue.

### Missing Edge Cases

- **Multiple tornadoes on the same tile.** The game can produce this today, and one outline per tornado will stack at one position.
- **Tornadoes on the boss footprint.** The engine allows this, so the boss outline and tornado indicators need an overlap story.
- **Game-end behavior.** The draft does not clearly specify what happens to true tiles and swirls on `won` / `lost`.
- **Toggle regression behavior.** If the toggle stays in scope, the draft should verify that it does not interfere with existing F-key tab behavior.
- **Spawn/despawn cleanup.** Pooled swirl and outline meshes need explicit visibility cleanup on the tick a tornado appears or disappears.

### Definition of Done Completeness

The DoD covers the main visual outcomes, but it is not complete enough for the added scope.

- It adds toggle behavior to the DoD even though the intent does not require it.
- It does **not** verify boss style ring coexistence.
- It does **not** verify overlapping tornado behavior on a single tile.
- It does **not** verify the fallback tornado path.
- It does **not** verify that the input change preserves existing tab/F-key behavior.
- It does **not** mention cleanup/disposal expectations for the new renderer resources.

### Constructive Recommendation

Keep the outline geometry and the stronger tornado-visibility treatment. Cut the toggle unless it is intentionally promoted into sprint scope. If the toggle stays, move the plan to `InputManager.ts`, normalize the key semantics, and add regression checks for existing tab bindings.

## Overall Recommendation

Claude is better scoped and closer to the current renderer architecture. Gemini has the better true-tile primitive and the stronger tornado-visibility concept. The best final sprint plan would combine:

1. Claude's renderer-local scope and phased rollout.
2. Gemini's outline-style true tiles instead of filled boss planes.
3. An explicit tornado-material fix in `loadTornadoGLTF()`.
4. An explicit plan for boss-ring and target-ring coexistence.
5. A DoD item for overlapping tornadoes on the same tile.
6. `renderOrder` and `dispose()` updates as first-class implementation work, not afterthoughts.
