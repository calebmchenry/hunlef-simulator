# Sprint 011: Fix Hunlef Animation Visibility and Model Facing

## Overview

This sprint fixes two player-visible bugs:

1. Hunlef appears static in 3D even though animation clips exist.
2. Hunlef does not reliably face the player during combat.

### Concrete root cause of static animations

The GLTF animation data is loading correctly, but `Renderer3D` exits the GLTF path before animation setup:

- `loadBossGLTF()` checks for `geometry.getAttribute('color')`.
- `corrupted_hunlef.gltf` uses a palette texture (`TEXCOORD_0` + material map), not vertex colors (`COLOR_0`).
- That check therefore fails and triggers `loadBossJSON()` fallback.
- The JSON fallback is static geometry and never creates `AnimationController`, so no morph animations can play.

In short: this is a renderer decision bug, not a broken morph-target file.

### Investigation summary

- Diagnostic command confirms the GLTF contains `302` buffers and `144` morph targets with non-zero float data.
- `GLTFLoader` source handles this format as expected:
  - `loadBuffer()` resolves each buffer URI by index.
  - `loadBufferView()` slices the referenced buffer by offset/length.
  - `addMorphTargets()` pulls accessor dependencies for each target and assigns `geometry.morphAttributes.position`.
- A local `GLTFLoader.parse()` validation run (texture-stripped for Node) loads meshes with `morphPos=144`, `influences=144`, and clips with `morphTargetInfluences` tracks.

## Use Cases

1. On fight start, Hunlef idle animation visibly loops.
2. On boss attack ticks, magic/ranged attack animations visibly play and differ.
3. On style swaps, style switch animations visibly play once then return to idle.
4. On boss death, death animation plays once and clamps.
5. During movement, Hunlef consistently faces the player.

## Architecture

### Current (broken) flow

`GLTF load -> color attribute gate fails -> JSON fallback -> static mesh`

### Desired flow

`GLTF load -> unlit textured material conversion -> AnimationController -> visible morph animation`

### Key architecture points

- Treat texture-based GLTF color (`map` + UVs) as valid; do not require vertex colors.
- Keep JSON as a hard fallback only for true load failure or malformed geometry.
- Track model-facing offset per active model source:
  - GLTF export path likely needs `+Math.PI` yaw offset.
  - JSON fallback path may use a different offset.

## Implementation (Phased)

### Phase 1: Instrument and assert load path

- Add temporary logs in `loadBossGLTF()`:
  - mesh count
  - `morphAttributes.position?.length`
  - presence of `color` and `uv` attributes
  - animation clip count/names
- Log whether renderer selected GLTF or JSON path.
- Add a warning if GLTF has animations but renderer chooses JSON.

### Phase 2: Fix render-path gating (core fix)

- Remove the `hasVertexColors` gate as a blocker for GLTF usage.
- Replace material conversion with texture-aware unlit conversion:
  - keep `map` from source material
  - set `vertexColors` only when color attribute exists
  - preserve transparency/opacity/double-sided settings
- Keep existing JSON fallback only in GLTF load error callback.
- Ensure `AnimationController` is created whenever GLTF animations are present.

### Phase 3: Correct facing rotation

- Introduce `BOSS_YAW_OFFSET` (or a per-model `bossYawOffset` state).
- Update facing math:
  - `rotation = Math.atan2(dx, dz) + bossYawOffset`
- Set offset based on active model source (`GLTF` vs `JSON`) to avoid regressions.
- Start GLTF offset at `Math.PI`, then verify visually at N/S/E/W player positions.

### Phase 4: Validation and cleanup

- Remove or gate diagnostics behind a debug flag.
- Verify all animation states visually:
  - idle
  - attack magic/ranged
  - style switch
  - death clamp
- Run:
  - `npm run build`
  - `npm test` (all existing tests)
  - `cd ../cg-sim-player && npm run run -- --fights 3`

### Phase 5: Optional asset pipeline hardening (non-blocking)

- Keep current `.gltf` as functional baseline.
- Optionally add GLTF->GLB post-processing in `tools/cache-reader/export-gltf.mjs` to reduce payload and parse overhead from many embedded buffers.
- This optimization is not required to fix static animations.

## Files Summary

| File | Change | Why |
|---|---|---|
| `src/render/Renderer3D.ts` | Required | Remove false fallback gate, preserve textured unlit materials, add yaw offset handling |
| `src/render/AnimationController.ts` | Optional | Only if additional diagnostics/guard behavior is needed |
| `tools/cache-reader/export-gltf.mjs` | Optional | Add GLB post-process optimization; not required for correctness |
| `public/models/corrupted_hunlef.gltf` | No required change | Current animation data is usable |

## Definition of Done

1. Hunlef uses GLTF render path in normal startup (not JSON fallback).
2. Idle animation is visibly active within the first second of combat.
3. Attack, style-switch, and death animations visibly play at correct times.
4. Death animation clamps at end frame.
5. Hunlef faces player correctly across arena positions.
6. `npm run build` passes.
7. `npm test` passes existing suite.
8. `cg-sim-player` batch run still completes.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Material conversion drops texture map | Hunlef appears washed out/white | Explicitly carry over `map` and verify UV path |
| Wrong yaw offset after GLTF path re-enabled | Boss faces away/sideways | Use explicit offset variable and validate in controlled positions |
| Hidden dependency on JSON fallback behavior | New regressions in edge cases | Keep JSON fallback on load error, add path-selection logs |
| 302 embedded buffers increase load time | Slower startup on weaker devices | Optional GLB consolidation in Phase 5 |

## Security

No new security surface is introduced. Changes are local rendering and asset-loading logic only. No new runtime network endpoints, auth flow, or external script execution.

## Dependencies

- Required: existing Three.js + current GLTF asset pipeline.
- Optional (Phase 5 only): a GLTF/GLB conversion tool for post-processing.

## Open Questions

1. Should JSON fallback remain permanently, or should we fail loudly if animated GLTF cannot initialize?
2. Do we want a small renderer health check that asserts non-empty `morphTargetInfluences` in development builds?
3. Is GLB conversion worth doing now for startup performance, or can it wait until after visual correctness is restored?
4. Should model-facing offsets be data-driven (per asset metadata) instead of hardcoded constants?
