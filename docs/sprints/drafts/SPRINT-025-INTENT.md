# Sprint 025 Intent: Player Running Animation and Directional Facing

## Seed Prompt

Two changes:
1. Play a real running animation when the player moves between tiles (export OSRS run sequence 824 into the GLTFs)
2. Face the player in the direction of movement while running (not always toward the boss)

## Orientation Summary

- Player GLTFs currently have idle/eat/attack clips — no run clip. Sequence 824 (run) exists in the OSRS cache and can be added to the export.
- `export-player-gltf.mjs` defines sequences per body variant — just need to add `["run", 824]` to each
- `PlayerAnimationController` has idle/attack/eat states — needs a 'run' state that loops like idle
- `updatePlayer()` in Renderer3D already detects movement (`prevPos !== pos`) and has the facing logic (atan2 toward boss). Need to change facing to movement direction while running.
- `updatePlayerAnimations()` triggers attack/eat — needs to also trigger run when moving

## Relevant Code

- `tools/cache-reader/export-player-gltf.mjs` — add seq 824 to BODY_EXPORTS sequences (lines 23-51)
- `src/render/PlayerAnimationController.ts` — add 'run' state, `playRun()` method, seq 824 mapping
- `src/render/Renderer3D.ts` — `updatePlayer()` (line 1000): change facing logic; `updatePlayerAnimations()` (line 1032): trigger run/idle based on movement

## Success Criteria

1. Player plays run animation when moving between tiles
2. Player faces movement direction while running
3. Player faces boss when stationary (idle) or attacking
4. Run → idle transition is clean when player stops
5. Attack/eat animations still work and temporarily face boss during attack
6. All tests pass, build succeeds

## Uncertainty: Low — all pieces exist, just need wiring.
