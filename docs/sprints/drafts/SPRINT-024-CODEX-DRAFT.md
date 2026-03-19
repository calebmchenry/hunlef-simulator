# Sprint 024: Player Animation Polish

## Overview

This sprint is a narrow player-animation pass. The existing player GLTFs already provide `idle`, `attack`, and `eat` morph clips, and `Renderer3D.updatePlayerAnimations()` already appears to trigger attack and eat from simulation events. The remaining work is to verify those clips play correctly on the live player model, fix startup so idle actually begins when the player model is constructed, and add a procedural running effect because there is no walk/run clip in the assets.

## Implementation

- Verify `loadPlayerGLTFs()`, morph retargeting, and `PlayerAnimationController` still bind and play the existing `idle` / `attack` / `eat` clips across all player weapon variants.
- Fix the idle-at-construction bug in `PlayerAnimationController`: initial idle should be explicitly started instead of being skipped because the controller begins in the `'idle'` state before any action is playing.
- Add a lightweight procedural movement layer in `Renderer3D.updatePlayer()` or adjacent frame-update code: subtle bob/tilt driven by interpolated player movement, blending back to neutral when stationary and not replacing the existing morph animations.

## Definition of Done

- Player idle visibly loops while standing still, including immediately after model construction.
- Player attack and eat animations still trigger correctly during gameplay.
- Player movement has clear procedural run feedback without new GLTF assets or simulation changes.
- Tests and build pass.
