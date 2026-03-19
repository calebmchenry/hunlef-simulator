# Sprint 025 Draft: Player Running Animation & Facing

## Task 1: Run Animation Export & Integration
- **`tools/cache-reader/export-player-gltf.mjs`**: Add `["run", 824]` to sequences for all `BODY_EXPORTS`.
- **`src/render/PlayerAnimationController.ts`**: Add `'run'` to `PlayerAnimState` and mappings. Create a `playRun()` method (set to loop).
- **`src/render/Renderer3D.ts` (`updatePlayerAnimations`)**: Detect movement (`prevPos` != `pos`) to trigger `playRun()`, reverting to `playIdle()` when stopped. Remove the temporary procedural bobbing in `updatePlayer()`.

## Task 2: Directional Facing
- **`src/render/Renderer3D.ts` (`updatePlayer`)**: Modify `playerGroup.rotation.y`. 
  - If moving: Calculate `atan2` using the movement delta (`currWorld.x - prevWorld.x`, `currWorld.z - prevWorld.z`) to face travel direction.
  - If idle/attacking: Continue using the existing `atan2` towards `bossGroup.position`.
