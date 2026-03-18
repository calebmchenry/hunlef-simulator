# Sprint 011: Fix Hunlef Animations & Model Facing

## Overview

The Corrupted Hunlef GLTF model has 8 morph-target animations (idle, attack_magic, attack_ranged, stomp, prayer_disable, death, style_switch_mage, style_switch_range) that never play. The model also faces away from the player.

**Root cause:** `Renderer3D.loadBossGLTF()` at line 300 checks `if (!hasVertexColors)` and falls back to the static JSON model. The GLTF uses **texture-based coloring** (TEXCOORD_0 + embedded PNG atlas), not vertex colors (`COLOR_0`). So the GLTF is rejected, `AnimationController` is never created, and the boss appears permanently static.

**Secondary bug:** The rotation code `Math.atan2(dx, dz)` assumes the model faces +Z, but the OSRS model natively faces -Z. Adding `Math.PI` fixes this.

Both fixes are surgical — the AnimationController, animation name mapping, and simulation event hooks are already complete and correct.

## Use Cases

1. **Idle animation**: On fight start, Hunlef visibly moves/breathes
2. **Attack animations**: Magic and ranged attacks produce clearly different visual movements
3. **Style switch**: Switching between magic and ranged shows a visible transition animation
4. **Death**: Hunlef visibly collapses on kill, animation clamps (doesn't loop)
5. **Facing**: Hunlef always faces toward the player during combat
6. **Stomp**: When player walks under boss, stomp animation plays
7. **Prayer disable**: Distinct animation for the prayer-disable magic attack

## Architecture

### Current (broken) flow
```
GLTF load → hasVertexColors check → FAILS (texture model) → JSON fallback → static mesh, no animations
```

### Fixed flow
```
GLTF load → texture-aware material conversion → AnimationController created → morph animations play
              ↳ vertex colors? use vertexColors    ↳ 8 named clips mapped
              ↳ texture map? preserve map           ↳ idle loops, attacks play once, death clamps
```

The JSON fallback remains only for genuine GLTF load failures (network error, corrupt file).

## Implementation

### Phase 1: Fix GLTF Material Handling (~40% of effort)

**Files:**
- `src/render/Renderer3D.ts` — `loadBossGLTF()` method

**Tasks:**
- [ ] Remove the `hasVertexColors` gate that rejects texture-based GLTF models
- [ ] Replace the material conversion with texture-aware logic:
  ```typescript
  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry as THREE.BufferGeometry;
      const oldMat = mesh.material as THREE.MeshStandardMaterial;

      const hasColors = !!geom.getAttribute('color');
      const hasMap = !!oldMat.map;

      mesh.material = new THREE.MeshBasicMaterial({
        vertexColors: hasColors,
        map: hasMap ? oldMat.map : null,
        transparent: oldMat.transparent || false,
        opacity: oldMat.opacity ?? 1,
        side: THREE.DoubleSide,
      });
    }
  });
  ```
- [ ] Always proceed to add model to scene and create AnimationController (don't bail on missing vertex colors)
- [ ] Keep JSON fallback only in the GLTF load error callback
- [ ] Add verification logging after material swap:
  ```typescript
  const morphCount = geom.morphAttributes.position?.length ?? 0;
  if (morphCount > 0) {
    console.log(`[Renderer3D] GLTF morph targets: ${morphCount}`);
  }
  ```

### Phase 2: Fix Boss Facing Rotation (~10% of effort)

**Files:**
- `src/render/Renderer3D.ts` — `updateBoss()` method

**Tasks:**
- [ ] Add a model yaw offset constant:
  ```typescript
  const BOSS_MODEL_YAW_OFFSET = Math.PI; // OSRS model faces -Z, Three.js expects +Z
  ```
- [ ] Update rotation line:
  ```typescript
  this.bossGroup.rotation.y = Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET;
  ```
- [ ] Visually verify boss faces player from N/S/E/W positions

### Phase 3: Validation & Polish (~50% of effort)

**Tasks:**
- [ ] Run `npm run build` — must pass
- [ ] Run `npm test` — all 178 tests must pass
- [ ] Visual verification in browser:
  - [ ] Idle animation visible on fight start (model deforms, not static)
  - [ ] Magic attack animation plays on boss attack tick
  - [ ] Ranged attack animation visually distinct from magic
  - [ ] Style switch animation plays on style change
  - [ ] Death animation plays and clamps on boss kill
  - [ ] Prayer-disable animation distinct from regular magic attack
  - [ ] Stomp animation plays when player under boss
  - [ ] Boss faces player at all positions around the arena
- [ ] Performance check: no frame drops below 30fps during animations
- [ ] Console shows no GLTF loading errors or morph target warnings
- [ ] Remove or guard diagnostic logging behind a debug flag
- [ ] If animations appear too subtle, investigate morph target delta scale

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Fix material handling (remove vertex-color gate, preserve texture maps), fix rotation offset |

## Definition of Done

- [ ] GLTF render path is selected on normal startup (not JSON fallback)
- [ ] Idle animation visibly plays — mesh deforms, not static
- [ ] Attack animations trigger on boss attack ticks — magic and ranged look different
- [ ] Style-switch animation plays on style change
- [ ] Death animation plays on kill and clamps (doesn't loop)
- [ ] Prayer-disable animation visually distinct from regular magic attack
- [ ] Stomp animation plays when player walks under boss
- [ ] Boss model faces the player at all times during combat
- [ ] Frame rate stays above 30fps with animations active
- [ ] Console shows no GLTF loading errors or warnings
- [ ] `npm run build` passes
- [ ] `npm test` passes all 178 tests

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Material replacement disrupts morph target rendering | Low | High | Verify `geometry.morphAttributes.position` is populated after material swap; morph targets live on geometry, not material |
| 144 morph targets exceed shader limits | Low | Medium | Three.js uses texture-based morph targets (r150+), selects top-N active per frame; one-hot encoding means only 1 active |
| Texture map not preserved during material swap | Low | Medium | Explicitly copy `oldMat.map` to new material; verify UVs render correctly |
| Wrong rotation offset (not exactly PI) | Low | Low | Visual test at 4 cardinal positions; adjust offset empirically if needed |
| 302-buffer GLTF slow to parse on mobile | Medium | Low | Not blocking — can convert to GLB in a future sprint if needed |

## Security Considerations

No security surface changes. All modifications are local rendering logic. No new dependencies, network requests, or user input handling.

## Dependencies

- Three.js 0.183.2 (existing)
- No new dependencies required

## Open Questions

1. **Resolved: JSON fallback permanence** — Keep JSON fallback for genuine GLTF load errors only. Add a console.warn if GLTF has animations but the loader fails, so it's obvious during development.
2. **Walking animation (seq 8434)** — Not in the GLTF export since the boss doesn't move in the current simulation. Can be added in a future sprint if boss movement is implemented.
3. **GLB optimization** — The 302-buffer GLTF works but is 8MB. Converting to GLB (~4MB) is a straightforward optimization for a future sprint. Not needed for correctness.
