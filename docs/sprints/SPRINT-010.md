# Sprint 010: Fix 3D Interaction — Click Raycasting, Camera Follow, Animation Names

## Overview

Three critical bugs from the 2D→3D transition that were never properly migrated:

1. **Click-to-tile is broken**: `InputManager` still uses 2D pixel math (`px / TILE_SIZE`) but the canvas is now a 3D perspective view. Clicks need Three.js raycasting to find which tile was clicked. Currently clicks map to wrong tiles entirely.

2. **Camera doesn't follow the player**: `CameraController` orbits around a fixed point `(0,0,0)`. The camera should track the player's position so the view follows them around the arena.

3. **Animations don't play**: All 8 GLTF animation clip names are `undefined` (the exporter didn't set names). `AnimationController` looks up clips by name and finds nothing. Fix: either assign names in the export script, or map clips by index.

## Root Cause Analysis

### Bug 1: Click Mapping
- `src/input/InputManager.ts` line 40-41: `tileX = Math.floor(px / 48)` — this is 2D pixel-to-tile math
- With a 3D perspective camera, screen pixels don't map linearly to tiles
- Need: Three.js `Raycaster` to cast a ray from the camera through the click point, intersect with the arena floor plane, then convert the hit point to tile coordinates

### Bug 2: Camera Not Following Player
- `src/render/CameraController.ts`: `target = new THREE.Vector3(0, 0, 0)` — never updated
- `setTarget()` method exists but is never called
- Need: each frame, update the camera target to the player's interpolated world position

### Bug 3: Animation Clip Names
- `public/models/corrupted_hunlef.gltf`: all 8 animation `.name` fields are `undefined`
- `src/render/AnimationController.ts` maps state names to clip names, but can't find any clips
- Confirmed: `node -e "JSON.parse(require('fs').readFileSync('public/models/corrupted_hunlef.gltf')).animations.forEach((a,i) => console.log(i, a.name))"` → all undefined
- Fix options: (a) re-export GLTF with names set, (b) assign names by index after loading, (c) look up clips by index instead of name
- The 8 clips are in sequence order: idle(8417), magic(8430), ranged(8431), stomp(8432), prayer-disable(8433), death(8436), switch-mage(8754), switch-range(8755)

## Implementation

### Phase 1: Three.js Raycasting for Click-to-Tile (~35% effort)

**Files:**
- `src/input/InputManager.ts` — Modify
- `src/render/Renderer3D.ts` — Modify (expose camera + scene for raycasting)

**Tasks:**
- [ ] Add a method to Renderer3D that converts a screen click to a tile coordinate:
  ```typescript
  screenToTile(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    // Intersect with the floor plane (y = 0)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, hit);
    if (!hit) return null;
    // Convert world coords to tile coords
    const tileX = Math.floor((hit.x - ARENA_OFFSET_X) / TILE_SCALE + 0.5);
    const tileZ = Math.floor((hit.z - ARENA_OFFSET_Z) / TILE_SCALE + 0.5);
    // Validate bounds
    if (tileX < 0 || tileX >= 12 || tileZ < 0 || tileZ >= 12) return null;
    return { x: tileX, y: tileZ };
  }
  ```
- [ ] Modify InputManager to accept a reference to Renderer3D
- [ ] Replace the old `px / TILE_SIZE` math with `renderer.screenToTile(e.clientX, e.clientY)`
- [ ] Boss click detection: check if the raycasted tile is within `boss.occupies(tileX, tileY)`
- [ ] Also check: does clicking directly on the boss 3D model work? Could raycast against the boss mesh for more precise targeting.
- [ ] Use the cg-sim-player's Playwright browser tests to verify clicks land on correct tiles

### Phase 2: Camera Follows Player (~25% effort)

**Files:**
- `src/render/CameraController.ts` — Modify
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] In `Renderer3D.draw()`, after computing the player's interpolated world position, call:
  ```typescript
  this.cameraController.setTarget(playerWorldX, 0, playerWorldZ);
  ```
- [ ] Camera now orbits around the player (not arena center)
- [ ] Smooth follow: lerp the camera target toward the player position to avoid jerky camera:
  ```typescript
  setTarget(x: number, y: number, z: number): void {
    // Smooth follow with lerp
    this.target.lerp(new THREE.Vector3(x, y, z), 0.1);
  }
  ```
- [ ] Keep the existing orbit controls (arrow keys rotate, scroll zooms) working relative to the new target
- [ ] Handle edge case: during countdown, camera should show the full arena (maybe center on arena midpoint, switch to following player when running starts)

### Phase 3: Fix Animation Clip Names (~25% effort)

**Files:**
- `tools/cache-reader/export-gltf.mjs` — Modify (add names to exported clips)
- `src/render/AnimationController.ts` — Modify (fallback to index-based lookup)
- `public/models/corrupted_hunlef.gltf` — Re-export

**Tasks:**
- [ ] **Option A (preferred)**: Fix the export script to set clip names:
  - In `export-gltf.mjs`, after exporting, modify the GLTF JSON to set animation names:
    ```javascript
    const ANIM_NAMES = ['idle', 'attack_magic', 'attack_ranged', 'stomp', 'prayer_disable', 'death', 'style_switch_mage', 'style_switch_range'];
    gltfJson.animations.forEach((anim, i) => { anim.name = ANIM_NAMES[i]; });
    ```
  - Re-run the export script to regenerate the GLTF
- [ ] **Option B (fallback)**: In AnimationController, after loading, assign names by index:
  ```typescript
  const EXPECTED_ORDER = ['idle', 'attack_magic', 'attack_ranged', 'stomp', 'prayer_disable', 'death', 'style_switch_mage', 'style_switch_range'];
  clips.forEach((clip, i) => {
    if (!clip.name && i < EXPECTED_ORDER.length) {
      clip.name = EXPECTED_ORDER[i];
    }
  });
  ```
- [ ] Verify idle animation plays on load
- [ ] Verify attack animations trigger when boss fires
- [ ] Verify death animation plays when boss dies

### Phase 4: Verification with cg-sim-player (~15% effort)

**Files:**
- Tests in cg-sim-player sibling directory

**Tasks:**
- [ ] Run `cd ../cg-sim-player && npm run run -- --fights 5 --json` to verify bot can still play
- [ ] Start `npm run dev` in cg-sim and visually verify with agent-browser:
  - [ ] Click on a tile → player moves to THAT tile (not a random one)
  - [ ] Click on boss → attack target set (not movement)
  - [ ] Camera follows player as they move around the arena
  - [ ] Camera orbit (arrow keys) still works relative to player
  - [ ] Hunlef idle animation visible (subtle movement)
  - [ ] Hunlef attack animation on boss attack ticks
- [ ] All 178 tests still pass

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/input/InputManager.ts` | Modify | Replace 2D pixel math with Three.js raycasting |
| `src/render/Renderer3D.ts` | Modify | Expose screenToTile(), update camera target each frame |
| `src/render/CameraController.ts` | Modify | Smooth lerp follow, keep orbit working |
| `src/render/AnimationController.ts` | Modify | Index-based clip fallback |
| `tools/cache-reader/export-gltf.mjs` | Modify | Set animation clip names in GLTF |
| `public/models/corrupted_hunlef.gltf` | Re-export | GLTF with named animation clips |

---

## Definition of Done

- [ ] `npm run build` passes
- [ ] `npm test` passes all 178 tests
- [ ] Clicking a tile in the 3D view moves the player to that exact tile
- [ ] Clicking the boss (any tile in 5x5 footprint) sets attack target
- [ ] Camera follows the player's position smoothly
- [ ] Camera orbit (arrow keys) and zoom (scroll) still work
- [ ] Hunlef idle animation plays continuously
- [ ] Hunlef attack animation triggers on boss attack ticks
- [ ] Hunlef death animation plays on kill
- [ ] `cd ../cg-sim-player && npm run run -- --fights 3` completes without errors
- [ ] agent-browser screenshots confirm correct visuals
