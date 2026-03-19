# Sprint 020 Intent: Fix Boss Attack Animation "Exploded" Look

## Seed

Fix the boss attack animation "exploded" look. Attack morph target deltas are 3.4x larger than idle, making the boss look like it's flying apart. Previous attempt (uniform 0.5x morphTargetInfluences scaling) failed — it made ALL animations invisible from the zoomed-out camera.

## Critical Correction from Previous Attempt

The Sprint 019 approach failed because it scaled `morphTargetInfluences` uniformly every frame. This affects ALL morph targets equally (idle + attack + death + style-switch), killing visible animation entirely.

**Key insight the previous attempt missed:** Morph target deltas ARE stored per-morph-target in the geometry. Each morph target index has its own `BufferAttribute` in `geometry.morphAttributes.position[i]`. The boss has 144 morph targets with this mapping:

| Clip | Morph Target Indices | Avg Delta | Max Delta |
|------|---------------------|-----------|-----------|
| idle | 0-13 | 32 | 337 |
| attack_magic | 14-27 | 78 | 346 |
| attack_ranged | 28-50 | 109 | 639 |
| stomp | 51-71 | 88 | 535 |
| prayer_disable | 72-93 | 82 | 520 |
| death | 94-111 | 90 | 615 |
| style_switch_mage | 112-127 | 40 | 521 |
| style_switch_range | 128-143 | 40 | 721 |

**We CAN scale the geometry deltas for specific morph target indices.** Scale only the attack clip morph target geometry (indices 14-50) without touching idle (0-13) or style-switch (112-143). This is a one-time operation at GLTF load time, not per-frame.

## Orientation Summary

- **Project:** CG fight simulator. Sprint 017-019 just landed: animations work, tornado fixed, boss facing fixed, wider viewport, zoomed-out camera.
- **Current state:** Animations play correctly. Idle and style-switch look great. Attack animations have body parts flying apart due to large morph deltas.
- **Key files:** `src/render/Renderer3D.ts` (loadBossGLTF, morph target geometry), `tools/cache-reader/export-gltf.mjs` (GLTF export pipeline)
- **Constraint:** Never modify cg-sim-player, no new deps. Camera is now at distance 18 (wider viewport 1024×576).
- **Verification:** Playwright + system Chrome screenshots with external .bin/.png GLTF files.

## Relevant Codebase Areas

| Area | File | Notes |
|------|------|-------|
| Boss GLTF loading | `src/render/Renderer3D.ts:647-665` | After load, before AnimationController creation |
| Morph geometry | Three.js `geometry.morphAttributes.position` | Array of 144 BufferAttribute, one per morph target |
| Animation clips | GLTF animations | 8 clips with one-hot weight encoding referencing morph indices |
| Export pipeline | `tools/cache-reader/export-gltf.mjs` | Could scale deltas at export time instead |
| AnimationController | `src/render/AnimationController.ts` | Unchanged — receives clips as-is |

## Constraints

- Never modify cg-sim-player
- No new npm dependencies
- Idle and style-switch animations must remain visually unchanged
- Death animation quality should not degrade
- `npm run build`, `npm test`, `cd ../cg-sim-player && npm test` must pass
- Frame rate > 30fps

## Success Criteria

1. Attack animations (magic + ranged) look cohesive — boss body stays together
2. Idle animation unchanged (already looks good)
3. Style-switch animation unchanged (already looks good)
4. Death and stomp animations not degraded
5. Verified via Playwright screenshots comparing before/after

## Verification Strategy

1. Take "before" screenshots of attack animation (current state — exploded)
2. Apply fix
3. Take "after" screenshots of same animation moments
4. Compare: attacks should look more cohesive, idle should be identical

## Uncertainty Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| Correctness | **Low** | We know the exact morph target indices per clip and can scale geometry directly |
| Scope | **Low** | Single operation at load time, one file |
| Architecture | **Low** | Extends existing GLTF post-processing pattern |

## Open Questions

1. **Scale factor:** What value makes attacks look cohesive? Start with 0.3 for attack clips (reduces 78→23 avgDelta, comparable to idle's 32).
2. **Which clips to scale:** Just attacks (magic + ranged)? Or also stomp, prayer_disable, death? User said idle and style-switch look great — everything else may need some reduction.
3. **Load-time vs export-time:** Load-time scaling in Renderer3D is simpler and doesn't require re-exporting. Export-time is cleaner long-term but requires running the export pipeline.
4. **How to identify attack morph target indices:** Parse the animation clip weight data to find which morph targets each clip references, or hardcode the known ranges.
