# Sprint 24: Player Animation Polish

## Goal
Add visible player animations (running, attacking, eating, idle) by verifying the existing morph targets and adding a procedural running visual.

## Context
The player model contains morph target animations for idle, attack, and eat depending on the weapon equipped. However, there is no walk or run animation in the GLTF files, and there is a bug preventing the idle animation from playing on startup.

## Tasks

1. **Fix Idle on Construction**
   - In `src/render/PlayerAnimationController.ts`, the `currentState` is initialized to `'idle'`, which causes `playIdle()` (called in the constructor) to return early from `crossFadeTo` because it checks `if (state === this.currentState) return;`.
   - Update `currentState` initialization or adjust `crossFadeTo`/`constructor` to ensure the initial idle animation actually plays.

2. **Verify Existing Animations**
   - Ensure the attack animation correctly plays when `didPlayerAttackThisTick()` is true.
   - Ensure the eat animation correctly plays when `sim.playerAteThisTick` is true.
   - These are currently wired up in `Renderer3D.updatePlayerAnimations()`.

3. **Add Procedural Running Visual**
   - In `Renderer3D.updatePlayer()`, detect if the player is currently moving.
   - If moving, apply a procedural bobbing or tilting effect to the player mesh (`this.playerMesh`) using a sine wave based on time or distance traveled to simulate running.
   - Ensure the transform is reset or smoothly blends back to normal when movement stops.

4. **Validation**
   - Ensure the idle animation loops when standing still.
   - Test attacking and eating to confirm morph target clips play cleanly and return to idle.
   - Run around to confirm the procedural run animation feels natural and doesn't conflict with other states.
   - Verify all tests pass (`npm run test`) and the build succeeds (`npm run build`).