# Sprint 025: Player Run Animation and Facing

## Overview

This sprint replaces the current procedural-only movement cue with a real run clip and state-based facing. Add OSRS sequence `824` to every exported player body GLTF, wire a looping `run` state into `PlayerAnimationController`, and trigger it whenever the player moves between tiles. While running, the player should face movement direction; while idle or attacking, the player should face the boss.

## Implementation

- Update `tools/cache-reader/export-player-gltf.mjs` so every `BODY_EXPORTS` variant includes `["run", 824]`, then re-export the player GLTFs with a named `run` clip.
- Extend `src/render/PlayerAnimationController.ts` with a looping `run` state and `playRun()` method. `run` should behave like `idle` as a persistent locomotion state, while `attack` and `eat` remain one-shots.
- In `src/render/Renderer3D.ts`, treat `prevPos !== pos` as running: `updatePlayerAnimations()` should switch between `run` and `idle` based on movement, without breaking attack/eat triggers. `updatePlayer()` should face along movement while running, and face the boss when stationary or attacking.

## Definition of Done

- Player GLTFs include a named `run` animation exported from sequence `824`.
- Moving player plays `run` and faces travel direction.
- Idle or attacking player faces the boss.
- Run/idle transitions are clean and attack/eat still work.
