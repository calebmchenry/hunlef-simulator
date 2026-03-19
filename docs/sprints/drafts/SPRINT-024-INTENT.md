# Sprint 024 Intent: Player Animation Polish

## Seed Prompt

Add visible player animations — running, attacking, eating, idle. The player model has morph target animations (idle, attack, eat per weapon variant) but we need to verify they're triggering correctly and add a running/movement visual since no walk clip exists in the GLTF.

## Orientation Summary

- `PlayerAnimationController.ts` exists with idle/attack/eat states, all wired to game events in `Renderer3D.updatePlayerAnimations()`
- Attack triggers on `didPlayerAttackThisTick()`, eat triggers on `sim.playerAteThisTick` — both look correct
- The player GLTFs (player_body_bow/staff/halberd.gltf) have 3 clips: idle, attack, eat — NO walk/run clip
- The idle-at-construction bug (same as boss had) likely affects player too — `playIdle()` no-ops in constructor
- For running: need a procedural approach (bob/tilt) since there's no walk animation clip

## Relevant Codebase Areas

- `src/render/PlayerAnimationController.ts` — state machine (idle, attack, eat)
- `src/render/Renderer3D.ts` — `updatePlayerAnimations()` (line ~1023), `updatePlayer()` (movement interpolation), `loadPlayerGLTFs()`, `setPlayerModel()`
- `src/engine/GameSimulation.ts` — `playerAteThisTick`, projectile creation for attacks, player position/movement
- `public/models/player_body_*.gltf` — 3 weapon variants with morph target animations

## Constraints

1. No new GLTF exports needed — work with existing clips
2. Don't touch cg-sim-player
3. Player morph target pipeline must continue working (retargetMorphAnimations stays)
4. Running visual should be procedural (bob/tilt) since no walk clip exists

## Success Criteria

1. Player idle animation visibly plays when standing still
2. Player attack animation plays when attacking the boss
3. Player eat animation plays when consuming food
4. Player has visible movement feedback when running (procedural bob or tilt)
5. Animations transition cleanly between states
6. All 193 tests pass, build succeeds

## Uncertainty Assessment

| Factor | Level | Rationale |
|--------|-------|-----------|
| Correctness | Low | Animation triggers already exist and look correct |
| Scope | Low | Mostly verification + one procedural running effect |
| Architecture | Low | Extends existing PlayerAnimationController pattern |
