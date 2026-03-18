# Sprint 016 Critique: Codex Draft vs Gemini Draft

This critique evaluates both drafts against the intent document and the actual codebase state in `Renderer3D.ts`.

---

## Codex Draft

### Strengths

1. **Accurate codebase model.** The architecture section correctly identifies the existing Y-offset layering (`-0.01`, `0.01`, `0.02`, `0.03`), the `tileToWorld()` / `entityCenterToWorld()` helpers, the tornado mesh pool pattern, and the `applyUnlitMaterials()` pipeline. The proposed changes sit cleanly on top of what's actually there.

2. **Mesh-strip outlines over line primitives.** The explicit call-out that `THREE.LineBasicMaterial` has inconsistent `lineWidth` across WebGL implementations is correct and important. The `PlaneGeometry` strip approach is the right call.

3. **Tornado overlap deduplication.** The `Map<string, { x, y, count }>` approach for tornado true tiles is the most thorough treatment of the overlapping-tornado edge case across both drafts. It prevents z-fighting without adding visual noise.

4. **Boss style ring conflict resolution.** Identifying that the existing `RingGeometry(2.2, 2.5, 32)` would visually collide with a 5x5 perimeter indicator, and proposing to shrink it, is a detail the Gemini draft ignores entirely.

5. **Explicit cleanup/dispose coverage.** Phase 5 calls out that shared materials, geometries, and generated textures must be disposed. The Gemini draft doesn't mention `dispose()` at all — a real leak risk given `Renderer3D.dispose()` exists at line 998.

6. **Scope discipline.** The "renderer-only boundary" framing and the "if engine changes start appearing, scope has drifted" guardrail are well-calibrated. The files summary correctly marks entity files as "no change expected."

7. **Use case coverage.** UC-4 (interpolation mismatch is explicit) and UC-5 (overlapping tornado tiles stay stable) address edge cases that the intent's verification strategy specifically calls out.

### Weaknesses

1. **Tornado aura sprite is over-engineered.** The `CanvasTexture` radial gradient on a `THREE.Sprite` at `y = 0.8` is more complex than needed. The Gemini draft's simpler `RingGeometry` ground swirl achieves the same "ground-level visual cue" goal with existing geometry primitives and no texture generation. The sprite approach adds a texture to dispose, a canvas to manage, and a rendering primitive (Sprite) that behaves differently from the rest of the ground-plane overlay system.

2. **No toggle mechanism.** The intent asks (Open Question 3) whether true tiles should be toggleable. The Codex draft explicitly defers this ("always on for Sprint 016; defer UI settings"). This is a reasonable scope call, but it means there's no way to disable true tiles if they prove visually distracting during playtesting — which makes visual tuning harder during development. A simple boolean toggle with no UI binding would cost almost nothing.

3. **Optional file extraction adds ambiguity.** Phases 1 and 5 hedge between "keep it in Renderer3D" and "optionally extract to `trueTileHelpers.ts`." The implementer has to make a judgment call that the draft could have resolved. Given that `Renderer3D.ts` is already ~1005 lines, the draft should commit to one recommendation.

4. **FootprintIndicator interface is specified but never fully used.** The `interface FootprintIndicator { root, edgeMeshes, cornerMeshes, size }` is defined in the architecture section but the implementation phases reference `THREE.Group` directly. The corner meshes mentioned in the interface aren't explained or tasked anywhere.

5. **Vertical bob and spin changes are underspecified.** Phase 3 mentions "faster spin than the current `dt * 3`" and "optional subtle vertical bob" without concrete values. The current spin at line 992 is `mesh.rotation.y += dt * 3` — what should it be? "Faster" and "subtle" aren't implementable without guessing.

6. **Countdown visibility recommendation lacks justification.** Open Question 6 says "yes, show during countdown because they represent real entity positions." But during countdown the entities are static and centered — the true tile adds no information that the entity mesh doesn't already convey. The Gemini draft's "hide during countdown" is more defensible.

### Gaps in Risk Analysis

- **No risk entry for the aura sprite interaction with transparency sorting.** Sprites and mesh-based overlays have different sort behaviors in Three.js. The risks table covers "shared transparent materials sort poorly" generically but doesn't address the specific Sprite-vs-Mesh case.
- **No risk entry for the boss style ring change breaking visual expectations.** Shrinking the ring from `2.2-2.5` to `1.85-2.15` is a notable visual change to an existing feature. Players familiar with the current ring size might find the change confusing.

### Missing Edge Cases

- **True tiles during game-over / won / lost states.** Phase 2 says "leave true tiles visible during countdown as long as the corresponding entity exists in the scene" but doesn't specify what happens when the game ends. Should the player true tile persist on the death tile? Should the boss true tile disappear if the boss dies?
- **Tornado spawn/despawn frame.** When a tornado first spawns, `prevPos` and `pos` may be identical. The draft doesn't address whether the true tile should be visible on the spawn tick (it should — but it's worth stating).

### Definition of Done Completeness

The DoD is thorough with 13 checkable items. Notably includes "no per-frame geometry or material allocation" which is a good performance guardrail. However:

- Missing: no mention of verifying behavior across game states (countdown, running, won, lost).
- Missing: no mention of verifying the boss style ring still looks correct after shrinking.
- The DoD says "tornadoes are easier to spot than the current 0.4-scale implementation" — this is subjective and not verifiable without a baseline comparison or specific metric.

---

## Gemini Draft

### Strengths

1. **Toggle keybind included in scope.** Adding `T` to toggle true tiles is practical and low-cost. The draft includes the `KeyBindManager.ts` file change and a conflict-check risk entry. This directly addresses Intent Open Question 3 rather than deferring it.

2. **Ground swirl ring is simpler and cheaper than a sprite.** Using `RingGeometry(0.15, 0.45, 16)` with a pulsing opacity is a clean approach that stays within the existing ground-plane overlay pattern. No texture generation, no `CanvasTexture`, no sprite sorting issues.

3. **Concrete implementation values throughout.** Line widths (`0.06`), Y offsets (`0.035`), scale values (`0.7`), material parameters (`opacity: 0.8`), ring dimensions — the draft gives specific numbers for everything, making it directly implementable with minimal guesswork.

4. **Phase effort estimates.** The percentages (30%, 15%, 40%, 15%) help an implementer understand relative complexity and time allocation.

5. **Clear rendering order table.** The Y-axis layering table with exact offsets and the proposal to raise `targetTileIndicator` from `0.02` to `0.05` is a concrete, complete layering plan.

6. **Color choices are well-justified.** The color table includes specific hex values with rationale tied to both RuneLite conventions and contrast against the existing floor palette.

### Weaknesses

1. **Ignores the boss style ring collision.** The existing `bossStyleIndicator` at `RingGeometry(2.2, 2.5, 32)` (line 194 in `Renderer3D.ts`) sits at `y = 0.03`. The proposed boss true tile at `y = 0.035` with a 5x5 outline will visually collide with this ring. The Codex draft correctly identifies this problem; the Gemini draft doesn't mention it at all. This is the most significant omission.

2. **No `dispose()` coverage.** The draft adds up to 10+ new meshes, shared materials, and shared geometries but never mentions extending `Renderer3D.dispose()`. The existing dispose method (line 998) only cleans up a few specific resources. This is a memory leak waiting to happen during hot-reload development cycles.

3. **`MeshLambertMaterial` fallback cone issue is unaddressed.** The draft changes the cone fallback color from `0x888888` to `0xccddff` but leaves the material as `MeshLambertMaterial` (line 388). The Codex draft correctly notes that the tornado loader doesn't reuse `applyUnlitMaterials()` unlike other model pipelines. `MeshLambertMaterial` depends on scene lighting, which means the cone brightness will vary with camera angle and light setup. The draft should either convert to `MeshBasicMaterial` or call `applyUnlitMaterials()`.

4. **Hiding true tiles during countdown is inconsistent with initial entity placement.** Phase 3b says "if state is `countdown`, set `playerTrueTile.visible = false`." But the boss and tornadoes don't exist during countdown (tornadoes spawn later), so this only affects the player. The guard should be "if entity doesn't exist or game hasn't started" rather than checking for a specific state string.

5. **Tornado true tile pool doesn't handle overlap.** The draft manages tornado true tiles "identically to how `tornadoMeshPool` / `activeTornadoMeshes` already works" — one indicator per tornado. But two tornadoes on the same tile means two identical white outlines at the same position, which will z-fight. The Codex draft's deduplication approach is the correct solution.

6. **`KeyBindManager` is the wrong integration point.** The existing `KeyBindManager` (lines 1-39) is a simple FKey-to-tab mapper for inventory/prayer/equipment tabs. It has no `keydown` listener and no concept of action callbacks — it's just a config lookup. Wiring a toggle keybind through it would require either rearchitecting the class or adding an awkward special case. The actual keydown handling likely lives in `InputManager.ts` (which was in the grep results). The draft should specify `InputManager.ts` instead.

7. **Raising `targetTileIndicator` Y from `0.02` to `0.05` is a visual regression risk.** The target tile indicator currently sits at the same Y as floor hazard overlays (`0.02`). Raising it to `0.05` — the topmost ground element — changes its visual relationship to everything on the floor. This isn't necessarily wrong, but the draft presents it as a mechanical fix without acknowledging it's a behavioral change to an existing feature.

8. **Boss true tile color is blue (`0x4488ff`) — poor choice.** The intent notes the floor is dark maroon and hazards are crimson/orange-red. Blue has good contrast against those. However, blue is conventionally associated with friendly/safe indicators in OSRS, not with a dangerous boss footprint. The Codex draft's pink/magenta (`#ff4f88`) better signals "danger zone" while still contrasting with hazard red. This is a minor style point but worth flagging.

### Gaps in Risk Analysis

- **No risk for the boss style ring conflict** (the biggest rendering interaction the sprint introduces).
- **No risk for `dispose()` / resource cleanup.** Adding pooled meshes, shared materials, and shared geometries without cleanup guidance is a leak risk.
- **The "`performance.now()` drift" risk entry is irrelevant.** `performance.now()` doesn't drift — it's a monotonic high-resolution timer. The risk description mischaracterizes what could go wrong (frame-rate-dependent stutter, not timer drift).
- **No risk for the `MeshLambertMaterial` lighting dependency** on the fallback cone.

### Missing Edge Cases

- **Multiple tornadoes on the same tile** (z-fighting, as noted above).
- **Tornado spawn tick behavior** — is `prevPos === pos` on the first tick? Does the true tile appear immediately?
- **Game-over state cleanup** — should true tiles persist after death?
- **Boss death** — the boss can die; should the 5x5 indicator remain?
- **Window resize / camera angle extremes** — the pulsing opacity swirl uses `performance.now()` globally. If the tab is backgrounded, the pulse will jump on re-focus. Minor but observable.

### Definition of Done Completeness

The DoD has 12 items and is generally solid. Notable items:

- Includes "all cg-sim-player tests pass" — good explicit reminder of the read-only constraint.
- Includes the `T` key toggle, which makes the DoD more complete than the Codex version.

However:

- Missing: no mention of `dispose()` / cleanup verification.
- Missing: no mention of verifying behavior across game states (won/lost).
- Missing: no mention of the boss style ring remaining correct (because the draft doesn't address the collision at all).
- "30+ fps" is a good concrete target but there's no methodology specified. Manual frame counter check? `stats.js` panel?

---

## Head-to-Head Comparison

| Dimension | Codex | Gemini | Edge |
|-----------|-------|--------|------|
| Codebase accuracy | Correctly identifies Y offsets, pool patterns, ring geometry, applyUnlitMaterials gap | Mostly correct but misidentifies KeyBindManager as the integration point, misses boss ring collision | Codex |
| Edge case coverage | Tornado overlap dedup, boss ring conflict, dispose, UC-4/UC-5 | Toggle keybind, effort estimates, concrete values | Codex |
| Implementability | Some ambiguity (optional extraction, unspecified spin values, FootprintIndicator interface vs Group) | Very specific values throughout, directly implementable as written | Gemini |
| Scope discipline | Tight — renderer-only, no UI toggle, no particles | Slightly broader — adds keybind, adds swirl pulse — but still reasonable | Tie |
| Risk analysis | 7 risks, mostly well-targeted, misses boss ring change risk | 6 risks, includes keybind conflict, but misses the top 3 actual risks (boss ring, dispose, overlap z-fight) | Codex |
| Tornado visibility approach | Sprite aura — effective but over-engineered | Ring swirl — simpler, stays in ground-plane pattern | Gemini |
| True tile visual design | Mesh strips with corners, outline-only, dedup for overlaps | Mesh strips, outline-only, no overlap handling | Codex |
| DoD completeness | 13 items, strong performance guardrail, missing state transitions | 12 items, includes toggle and cg-sim-player, missing dispose and state transitions | Tie |

---

## Recommendations for the Final Sprint Document

1. **Use the Codex draft as the structural base** — its architecture section, boss ring resolution, tornado dedup, and dispose coverage are all load-bearing.

2. **Adopt the Gemini tornado visibility approach** — `RingGeometry` ground swirl with opacity pulse instead of the `CanvasTexture` sprite aura. Simpler, cheaper, stays in the ground-plane pattern.

3. **Include a toggle** — a simple `trueTilesEnabled` boolean with a public `toggleTrueTiles()` method. Wire it through `InputManager.ts` (not `KeyBindManager.ts`). Costs almost nothing and makes visual tuning during development much easier.

4. **Fix the fallback cone material.** Either convert to `MeshBasicMaterial` or call `applyUnlitMaterials()` on the fallback path. Both drafts partially address this but neither is complete.

5. **Commit to file extraction or not.** If `Renderer3D.ts` is already 1005 lines, extract `createTileOutline()` and `collectTornadoOccupancy()` into `src/render/trueTileHelpers.ts`. Don't hedge.

6. **Add game-state transition behavior to the DoD.** True tiles should be hidden during countdown (entities are static), visible during gameplay, and hidden or frozen on game end.

7. **Specify concrete spin/animation values.** If tornado spin speed changes from `dt * 3`, say what it changes to. If vertical bob is added, specify amplitude and frequency.

8. **Add the boss ring change as an explicit DoD item** — "Boss style ring is visually distinct from and interior to the boss true tile perimeter."
