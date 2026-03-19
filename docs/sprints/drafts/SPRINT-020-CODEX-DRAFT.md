# Sprint 020: Fix Boss Attack Animation "Exploded" Look

## Overview

This sprint fixes Hunllef attack animations that currently look "exploded" in 3D. The root issue is excessive morph target geometry deltas in attack clips relative to idle, not mixer timing or state transitions.

The implementation will scale only attack-linked morph target geometry at GLTF load time in `Renderer3D`, before `AnimationController` playback starts. This avoids the prior failed approach of per-frame `morphTargetInfluences` scaling, which suppressed all visible animation.

## Use Cases

1. As a player, I see magic and ranged attack animations where the boss body stays cohesive instead of flying apart.
2. As a player, idle and style-switch animations look unchanged from the current good baseline.
3. As a player, stomp and death remain readable and not visibly degraded.
4. As a developer, animation state flow in `AnimationController` remains intact (idle loop, one-shot attacks/switches, death lock).
5. As a developer, GLTF load fallback to JSON still works if `/models/corrupted_hunlef.gltf` fails to load.

## Architecture

### Current Pipeline

- `Renderer3D.loadBossGLTF()` currently does:
1. load `/models/corrupted_hunlef.gltf`
2. scale scene by `BOSS_MODEL_SCALE`
3. retarget morph tracks via `retargetMorphAnimations(model, gltf.animations)`
4. swap materials to unlit
5. create `AnimationController(model, gltf.animations)`
- `AnimationController` maps clip names/sequence IDs to states and updates `AnimationMixer`.
- Crossfades intentionally stop previous one-hot morph actions immediately to avoid additive blend artifacts.

### Target Design

1. Add a load-time boss-only morph normalization step in `Renderer3D.ts`, executed after retargeting and before controller creation.
2. Identify attack morph target indices from attack clips (`attack_magic`, `attack_ranged`, plus sequence-id aliases).
3. Traverse boss meshes with `geometry.morphAttributes.position` and scale only selected morph targets by a configurable factor (start at `0.30`).
4. Keep idle/style-switch/death/stomp geometry untouched in the first pass.
5. Mark processed geometry to prevent accidental double-scaling on repeated loads.
6. Keep `AnimationController.ts` behavior unchanged; it should consume normalized clips/geometry transparently.

### Non-Goals

- No per-frame morph influence scaling.
- No new dependency.
- No changes to `cg-sim-player`.
- No mandatory export-pipeline changes in this sprint.

## Implementation

### Phase 1: Add Boss Attack Morph Normalization Helpers

- [ ] Add constants in `Renderer3D.ts`:
1. attack clip aliases (`attack_magic`, `attack_ranged`, `8430`, `8431`, `seq_8430`, `seq_8431`)
2. default scale factor (initial `0.30`)
3. geometry user-data marker for idempotency
- [ ] Add helper to collect morph indices referenced by a clip's morph tracks.
- [ ] Add helper to resolve "attack" clips robustly by name and sequence-id aliases.

### Phase 2: Scale Morph Geometry Deltas for Selected Indices

- [ ] Implement a helper that traverses boss meshes and mutates `geometry.morphAttributes.position[index]`.
- [ ] Scale deltas relative to base positions (per vertex): `base + (morph - base) * factor`.
- [ ] Skip out-of-range indices safely and log counts for diagnostics.
- [ ] Mark processed geometry with user-data marker to avoid reprocessing.

### Phase 3: Integrate into `loadBossGLTF`

- [ ] Call normalization in `loadBossGLTF()` after `retargetMorphAnimations(...)`.
- [ ] Keep `applyUnlitMaterials(...)` and `new AnimationController(...)` call order otherwise unchanged.
- [ ] Add focused logs: attack clip count, morph indices selected, meshes/targets scaled.

### Phase 4: Verification

- [ ] Capture before/after screenshots of attack peak frames (magic and ranged).
- [ ] Confirm idle and style-switch look visually unchanged.
- [ ] Confirm death and stomp are not materially degraded.
- [ ] Run:
1. `npm run build`
2. `npm test`
3. `cd ../cg-sim-player && npm test`
- [ ] Confirm frame rate remains above 30 FPS during active combat.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Add load-time attack morph-index discovery and geometry-delta scaling; integrate into `loadBossGLTF` |
| `src/render/AnimationController.ts` | No change (validation only) | Preserve existing mixer/state behavior; verify compatibility with normalized geometry |
| `tools/cache-reader/export-gltf.mjs` | No change (optional follow-up) | Runtime fix is primary; export-time normalization remains a future option |

## Definition of Done

- [ ] Magic and ranged attack animations are visibly cohesive and no longer appear exploded.
- [ ] Idle animation remains visually unchanged.
- [ ] Style-switch animations remain visually unchanged.
- [ ] Death and stomp animations show no obvious quality regression.
- [ ] No per-frame global `morphTargetInfluences` scaling logic is introduced.
- [ ] GLTF failure path still falls back to static JSON boss rendering.
- [ ] `npm run build`, `npm test`, and `../cg-sim-player` tests pass.
- [ ] Combat scene performance remains above 30 FPS.

## Risks

- Clip-to-index extraction could miss some morph tracks if exporter naming changes.
- Scale factor may over-correct, making attack motion too subtle from the zoomed-out camera.
- Shared geometry instances could receive unintended repeated scaling without robust idempotency markers.
- Attack-only scope might expose remaining issues in stomp/prayer-disable under certain camera angles.

## Security

- No new dependencies or third-party runtime code.
- No new network calls, file writes, or dynamic code execution paths.
- Changes are limited to local render-time geometry processing and existing asset load flow.

## Dependencies

- Existing Three.js render stack (`GLTFLoader`, `AnimationMixer`, `BufferGeometry` morph attributes).
- Existing Hunllef GLTF clip naming and sequence-id conventions.
- Existing model asset at `public/models/corrupted_hunlef.gltf`.
- Existing screenshot/manual visual verification workflow (Playwright + system Chrome).

## Open Questions

1. Is `0.30` the right initial attack morph scale factor, or should tuning start closer to `0.35-0.40`?
2. Should sprint scope remain attack-only, or include `stomp`/`prayer_disable` if they still look exaggerated?
3. Should attack morph indices be hardcoded from known ranges (`14-50`) or derived from clip tracks at runtime?
4. If runtime normalization works, do we also migrate this into `tools/cache-reader/export-gltf.mjs` for asset-level correctness?
5. Do we want a temporary debug flag to toggle normalization on/off for side-by-side visual validation?
