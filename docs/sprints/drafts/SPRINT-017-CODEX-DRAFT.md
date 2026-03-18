# Sprint 017: Fix GLTF Morph Target Animation Rendering (Renderer-Side)

## Overview

This sprint fixes animation playback bugs in the Three.js runtime path, not the export path. The current assets already include morph targets and animation clips for boss and player bodies, but visible deformation is blocked by renderer-side binding/material issues.

From the current code:
- `src/render/Renderer3D.ts` replaces GLTF materials in `applyUnlitMaterials()` without explicitly preserving morph-target shader support.
- Boss and player body GLTFs are multi-primitive meshes (loaded by Three.js as grouped mesh children), while animation tracks target node `weights`, which can bind to an object that does not directly own the active `morphTargetInfluences` arrays.
- Boss trigger wiring currently handles attack/style-switch/death, but `stomp` and `prayer_disable` are not dispatched from renderer logic.

Sprint goal: make boss/player morph animations visibly play and keep controller APIs/fallback behavior intact.

## Use Cases

1. Boss idle loop visibly deforms the mesh instead of appearing static.
2. Boss ranged vs magic attacks play as distinct animations on the correct attack ticks.
3. Boss style-switch animation plays when style changes, without cancelling same-tick attack playback.
4. Boss death animation plays once and clamps on victory.
5. Player idle/attack/eat animations play across all three body variants (`bow`, `staff`, `halberd`).
6. Boss stomp animation can be triggered from gameplay overlap events.
7. Prayer-disable animation is reachable via a real gameplay trigger or explicit debug hook.
8. GLTF fallback paths (boss JSON / cyan player box) remain stable when assets are missing.

## Architecture

### Current Runtime Flow

`GLTFLoader -> applyUnlitMaterials -> AnimationController/PlayerAnimationController -> AnimationMixer.update()`

The controllers and mixer loop are already in place. The missing pieces are model preparation and trigger dispatch correctness.

### Target Runtime Flow

`GLTFLoader -> morph-capable material pass -> morph-binding prep for multi-primitive roots -> existing controllers -> deterministic trigger dispatch`

### Proposed Components

1. Material pass hardening (`Renderer3D.applyUnlitMaterials`)
- Detect morph-capable geometry (`geometry.morphAttributes.position?.length > 0`).
- Ensure replacement `MeshBasicMaterial` instances keep morph-target support enabled.
- Preserve existing texture/opacity/vertex color behavior.

2. Morph-binding prep for multi-primitive models
- Add a renderer helper that prepares animation roots before constructing controllers.
- For models loaded as group + child meshes, align root/child morph influence binding so mixer-driven weight tracks affect rendered meshes.
- Keep this as a runtime adapter so existing exported assets and controller APIs do not change.

3. Boss animation trigger dispatcher
- Keep current attack and death triggers.
- Gate style-switch trigger so attack and style-switch do not fight on the same tick.
- Add stomp trigger wiring from overlap conditions.
- Add prayer-disable trigger wiring once event source is defined (or expose a debug/manual trigger in this sprint).

4. Controller behavior safeguards
- Keep `AnimationController` and `PlayerAnimationController` public APIs unchanged.
- Add no-op guards for redundant state transitions where resets cause visible popping.

## Implementation

### Phase 1: Model Preparation Utilities

- [ ] Add a renderer helper (in `Renderer3D.ts` or extracted util) to prepare morph animation bindings on loaded GLTF roots.
- [ ] Apply helper in boss load path before `new AnimationController(...)`.
- [ ] Apply helper in player body assembly path before `new PlayerAnimationController(...)`.
- [ ] Add optional diagnostics (dev-only logs) for:
  - root type/name
  - child mesh count with morph targets
  - clip count + mapped states

### Phase 2: Material Pipeline Fix

- [ ] Update `applyUnlitMaterials()` so replacement materials remain morph-capable on morph geometries.
- [ ] Verify behavior for both single-material and material-array meshes.
- [ ] Confirm alpha/texture behavior for second primitive remains unchanged visually.

### Phase 3: Trigger Correctness

- [ ] Update boss trigger logic to avoid same-tick collision between `playAttack(...)` and `playStyleSwitch(...)`.
- [ ] Add stomp dispatch when boss and player overlap on a tick transition.
- [ ] Define temporary handling for `prayer_disable`:
  - either map to an existing gameplay event if semantically correct, or
  - expose a debug trigger so the clip can be validated while gameplay hook is pending.
- [ ] Keep death clamp behavior unchanged.

### Phase 4: Validation and Regression Checks

- [ ] Manual render verification for boss clips: `idle`, `attack_magic`, `attack_ranged`, `style_switch_*`, `death`, `stomp`, `prayer_disable`.
- [ ] Manual render verification for player clips: `idle`, `attack`, `eat` on all three body variants.
- [ ] Build/test checks:
  - `npm run build`
  - `npm test`
  - `cd ../cg-sim-player && npm test`
- [ ] Fallback checks: missing boss/player GLTFs still use existing fallback visuals without errors.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Morph-capable unlit material replacement, morph-binding prep for multi-primitive roots, and boss trigger dispatch fixes |
| `src/render/AnimationController.ts` | Modify (small) | Add state-transition guard(s) if needed to prevent unnecessary action resets/popping |
| `src/render/PlayerAnimationController.ts` | Modify (small) | Add same transition guard pattern for player animations if needed |
| `src/engine/GameSimulation.ts` | Optional modify | Add explicit prayer-disable event signal if renderer cannot infer it reliably from existing state |

## Definition of Done

- [ ] Boss morph deformation is visibly active during idle and combat clips.
- [ ] Boss magic/ranged attacks play on correct attack ticks.
- [ ] Boss style-switch plays on style change and does not suppress attack animation in the same tick.
- [ ] Boss death plays once and clamps.
- [ ] Boss stomp clip is triggerable from gameplay overlap.
- [ ] Prayer-disable clip is reachable (via gameplay event or documented debug trigger).
- [ ] Player `idle`/`attack`/`eat` clips visibly play on all body variants.
- [ ] No regressions in fallback model behavior.
- [ ] `npm run build`, `npm test`, and `../cg-sim-player` tests pass.

## Risks

- Multi-primitive binding assumptions may differ between Three.js internals and current assets, requiring one more adapter iteration.
- If primitive morph target counts diverge in future exports, shared/root binding strategies can break silently.
- Adding stomp/style/prayer dispatch without event gating can create rapid clip resets and visible popping.
- Player morph amplitudes are subtle at current world scale, making “working but hard to see” validation noisy.

## Security

- No new runtime dependencies.
- No new network paths or user-input surfaces.
- Changes are confined to rendering/event wiring and optional simulation event flags.

## Dependencies

- Existing Three.js stack (`three` `^0.183.2`, `GLTFLoader`, `AnimationMixer`).
- Existing simulation tick/event data from `GameSimulation`.
- Existing GLTF model set in `public/models` (no exporter changes required for this sprint).

## Open Questions

1. Should `prayer_disable` be driven by a new explicit simulation event, or mapped to an existing mechanic in the current simplified boss logic?
2. Is a pure renderer-side morph-binding adapter sufficient for all current/future exported multi-primitive assets, or should we also add an asset validator for animation track targets?
3. For style-switch ticks that also include an attack, should attack always take visual priority, or should style-switch preempt in specific cases?
4. Do we want a temporary debug animation trigger panel for validating non-frequently-occurring clips (`stomp`, `prayer_disable`) during development?
