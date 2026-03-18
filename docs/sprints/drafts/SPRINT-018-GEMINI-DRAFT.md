# Sprint 018: Fix Three Visual Bugs

## Overview
Address three visual bugs discovered during Sprint 017 testing in the 3D renderer: a mint green static effect covering the screen when tornadoes spawn, the Hunlef boss facing the wrong direction, and attack animations spazzing out when triggered repeatedly.

## Use Cases
- As a player, I should see tornadoes spawn and move correctly without screen distortion or mint green artifacting.
- As a player, the boss (Hunlef) should face toward me at all times to correctly telegraph its target.
- As a player, boss attack animations should play smoothly without rapidly restarting (spazzing) when the same attack style is fired on consecutive ticks.

## Architecture
No structural architecture changes are necessary. The fixes require surgical updates to existing rendering logic:
- **Renderer3D:** Adjust the boss yaw offset math to align with the Three.js coordinate system. Investigate and resolve the tornado mesh loading/fallback to prevent the full-screen visual bug.
- **AnimationController:** Introduce a state-guard to prevent re-triggering and resetting an animation clip if the requested state is already playing.

## Implementation
1. **Bug 1 (Mint Green Screen / Tornadoes):** 
   - Root cause investigation: The "mint green" color corresponds to the `MeshBasicMaterial({ color: 0xccddff })` used in the fallback cone in `loadTornadoGLTF()`. If this cone or the GLTF meshes are uninitialized in their position and scale when added to the scene, they might clip the camera.
   - Fix: Ensure the fallback material renders correctly or that the `tornado_tex0.png` texture loads gracefully. Ensure tornadoes are positioned correctly before becoming visible in the render loop.
2. **Bug 2 (Boss Facing Direction):** 
   - Modify `BOSS_MODEL_YAW_OFFSET` in `src/render/Renderer3D.ts`. The current `Math.PI` offset causes the boss to face 180 degrees away from the player. We will test and update this offset (likely to `0` or `-Math.PI/2`) so `Math.atan2(dx, dz)` correctly orientates the boss towards the player.
3. **Bug 3 (Attack Animation Spazzing):** 
   - Update `crossFadeTo(state: AnimState)` in `src/render/AnimationController.ts`. Add an early exit guard: `if (this.currentState === state) return;`. This prevents `nextAction.reset().play()` from restarting the same animation from frame 0 if it is already the active state.

## Files Summary
- `src/render/Renderer3D.ts`: Correct `BOSS_MODEL_YAW_OFFSET` for boss rotation. Fix tornado GLTF loading/fallback mesh geometry to remove the green screen glitch.
- `src/render/AnimationController.ts`: Add `currentState` check in `crossFadeTo()` to avoid redundant resets of active animations.

## Definition of Done
- Tornadoes render without causing a mint green screen or static artifacts.
- The boss consistently faces the player from any tile in the arena.
- Consecutive attacks of the same style result in smooth animations without spazzing or rapid restarting.
- Idle and style-switch animations continue to function without regression.
- Code compiles, and Playwright verification tests and screenshots pass successfully.

## Risks
- The green screen issue may be deeper than the fallback cone (e.g., a WebGL texture loading corruption). If so, further debugging of the GLTF pipeline may be required.
- Modifying `crossFadeTo` might affect how consecutive, visually distinct attacks (if any are added later) blend.

## Security
- No security implications. No new npm dependencies or external network requests are being introduced.

## Dependencies
- All modifications are internal. No external package dependencies.

## Open Questions
- Is the mint green screen solely caused by the fallback cone material, or is it a symptom of a larger WebGL state issue when `tornado_tex0.png` fails to load?
- If the player fires a Magic attack while a Magic attack animation is already halfway done, should the animation restart completely, blend into itself, or just continue? The proposed fix (ignoring the reset) assumes it should just continue.