# Sprint 025: Player Run Animation & Directional Facing

## Overview

Play a real run animation (OSRS sequence 824) when the player moves between tiles, and face the movement direction while running instead of always facing the boss.

## Implementation

### Task 1: Export run animation into player GLTFs

**File:** `tools/cache-reader/export-player-gltf.mjs`

Add `["run", 824]` to every entry in `BODY_EXPORTS` sequences, then re-run the export script to regenerate all `public/models/player_body_*.gltf` files.

Update `EXPECTED_CLIP_ORDER` in `PlayerAnimationController.ts` to include `run` so the index-based fallback names clips correctly.

### Task 2: Add 'run' state to PlayerAnimationController

**File:** `src/render/PlayerAnimationController.ts`

- Add `'run'` to `PlayerAnimState` type
- Add seq 824 mappings to `ANIM_NAME_MAP`: `'824': 'run'`, `'seq_824': 'run'`, `'run': 'run'`
- Configure run action to loop infinitely (like idle, not once like attack/eat)
- Add `playRun()` method

### Task 3: Trigger run/idle and fix facing

**File:** `src/render/Renderer3D.ts`

In `updatePlayerAnimations()`:
- After eat/attack checks, detect movement (`prevPos !== pos`)
- If moving → `playRun()`
- If stationary → `playIdle()`

In `updatePlayer()`:
- When moving: face movement direction (`atan2(moveDx, moveDz)`) + keep procedural bob
- When stationary: face boss (`atan2(bossDx, bossDz)`) + reset bob

## Definition of Done

- [ ] Player GLTFs contain a `run` clip (seq 824)
- [ ] Player plays run animation when moving between tiles
- [ ] Player faces movement direction while running
- [ ] Player faces boss when idle or attacking
- [ ] Run → idle transition is clean when player stops moving
- [ ] Attack/eat still interrupt correctly
- [ ] All tests pass, build succeeds
