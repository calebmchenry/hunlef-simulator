# Sprint 018 Intent: Fix Three Visual Bugs (Tornado Screen, Boss Facing, Attack Animation)

## Seed

Fix three visual bugs discovered during Sprint 017 testing:
1. Screen goes mint green/static when tornadoes spawn
2. Hunlef model faces the wrong direction
3. Attack animation spazzes out instead of playing smoothly

Idle animation and style-switch animations look correct.

## Orientation Summary

- **Project:** CG (Corrupted Gauntlet) fight simulator with Three.js 3D rendering, morph target animations confirmed working as of Sprint 017
- **Recent work:** Sprint 017 converted GLTFs from inline data URIs to external .bin/.png files, confirmed morph target animations play correctly, removed invalid `morphTargets` material property
- **Key files:** `src/render/Renderer3D.ts` (1400+ lines), `src/render/AnimationController.ts` (155 lines)
- **Constraint:** Never modify `cg-sim-player`, no new npm dependencies
- **Verification:** Playwright + system Chrome can now take screenshots (external .bin/.png files work)

## Root Cause Analysis

### Bug 1: Mint Green Static When Tornadoes Spawn

**File:** `src/render/Renderer3D.ts`, lines 684-707, 1357-1363

The tornado GLTF texture (`tornado_tex0.png`, 40x4 pixels) may be failing to load in the GLTF pipeline. When the texture fails, the GLTF load error callback fires and creates a fallback cone mesh with `MeshBasicMaterial({ color: 0xccddff })` — a light cyan/mint color. However, the "mint green static" effect covering the ENTIRE screen suggests a more serious issue — possibly a WebGL state corruption, shared texture/framebuffer issue, or the tornado meshes being rendered at enormous scale filling the viewport.

**Investigation needed:** Capture a screenshot at the exact moment tornadoes spawn to see the actual visual. Check if the tornado GLTF texture is loading correctly with external files. Check if any WebGL state (clear color, depth test, blend mode) is being corrupted.

### Bug 2: Hunlef Faces Wrong Direction

**File:** `src/render/Renderer3D.ts`, lines 30, 950-967

The boss rotation is calculated as:
```typescript
this.bossGroup.rotation.y = Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET;
```
Where `BOSS_MODEL_YAW_OFFSET = Math.PI` and `dx = playerX - bossX`, `dz = playerZ - bossZ`.

The offset of π radians (180°) was intended to correct for OSRS models facing -Z while Three.js faces +Z. But the dynamic facing calculation using `Math.atan2(dx, dz)` may already account for the Three.js coordinate system, making the π offset produce a 180° error — the boss faces AWAY from the player instead of toward them.

**Fix candidates:**
- Remove the `BOSS_MODEL_YAW_OFFSET` entirely
- Change it to 0 or a different value
- Adjust the `atan2` arguments (swap dx/dz, negate one)

### Bug 3: Attack Animation Spazzes Out

**Files:** `src/render/AnimationController.ts` lines 136-149, `src/render/Renderer3D.ts` lines 902-942

The `crossFadeTo()` method always calls `nextAction.reset().play()` which restarts the animation from frame 0. The attack trigger code in `updateBossAnimations()` uses `sim.tick !== this.lastBossAttackTick` as a guard, but:

1. If multiple projectiles fire on the same tick, only one should trigger
2. If `crossFadeTo` is called while the same attack animation is already playing (e.g., magic→magic on consecutive ticks), it resets to frame 0 each time, creating rapid restart "spazzing"
3. The idle animation doesn't spaz because it uses `LoopRepeat` which doesn't visually glitch on reset

**Fix:** Add a guard in `crossFadeTo()` — if the requested state equals the current state, don't reset/replay. Only crossfade when actually changing states.

## Relevant Codebase Areas

| Area | File | Lines | Bug |
|------|------|-------|-----|
| Tornado GLTF loading | `src/render/Renderer3D.ts` | 684-707 | Bug 1 |
| Tornado mesh cloning | `src/render/Renderer3D.ts` | 1357-1363 | Bug 1 |
| Unlit material application | `src/render/Renderer3D.ts` | 608-636 | Bug 1 |
| Boss yaw offset constant | `src/render/Renderer3D.ts` | 30 | Bug 2 |
| Boss rotation calculation | `src/render/Renderer3D.ts` | 950-967 | Bug 2 |
| Attack animation trigger | `src/render/Renderer3D.ts` | 902-942 | Bug 3 |
| crossFadeTo method | `src/render/AnimationController.ts` | 136-149 | Bug 3 |
| Animation state management | `src/render/AnimationController.ts` | 54-104 | Bug 3 |

## Constraints

- Never modify `cg-sim-player`
- No new npm dependencies
- Keep existing AnimationController API (playIdle, playAttack, etc.)
- Keep existing GLTF model files (don't regenerate)
- Maintain fallback paths (static JSON boss, cyan player box)
- Frame rate > 30fps
- `npm run build`, `npm test`, `cd ../cg-sim-player && npm test` must pass

## Success Criteria

1. No mint green screen when tornadoes spawn — tornadoes render as expected
2. Hunlef faces toward the player during combat
3. Attack animations play smoothly without spazzing/rapid-restart
4. Idle and style-switch animations still work correctly (no regression)
5. All tests pass

## Verification Strategy

Use Playwright + system Chrome screenshots to:
1. Capture tornado spawn moment and verify rendering
2. Verify boss faces player from multiple positions
3. Capture attack animation frames and verify smooth progression

## Uncertainty Assessment

| Factor | Level | Notes |
|--------|-------|-------|
| Correctness | **Low** | Root causes identified from code analysis, fixes are surgical |
| Scope | **Low** | Three specific bugs, well-bounded in 2 files |
| Architecture | **Low** | No new patterns, small changes to existing code |

## Open Questions

1. **Bug 1 specifics:** Is the mint green screen the fallback cone color, or is it a WebGL state issue? Need screenshot to confirm.
2. **Bug 2 direction:** Should the offset be 0, -π/2, or something else? Need to test with screenshots.
3. **Bug 3 same-state guard:** Should calling `playAttack('magic')` while magic attack is already playing be a complete no-op, or should it extend/restart the animation?
