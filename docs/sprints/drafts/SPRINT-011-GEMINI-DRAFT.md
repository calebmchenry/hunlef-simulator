# Sprint 011: Fix Hunlef 3D Animations & Model Orientation

*Draft by: Gemini-substitute (orchestrator-authored)*

## Overview

The Corrupted Hunlef's 3D model appears completely static despite having 8 valid morph-target animations in the GLTF file. The model also faces away from the player. This sprint fixes both issues by: (1) converting the 302-buffer GLTF to a single-buffer GLB for reliable morph target loading, (2) validating the animation pipeline end-to-end, and (3) adding a rotation offset to correct the model's facing direction.

**Root Cause Analysis:**

The GLTF file contains 302 separate data URI buffers — one per morph target POSITION + NORMAL accessor. While the GLTF spec allows multiple buffers, Three.js's GLTFLoader may not correctly populate `geometry.morphAttributes` when morph target data is spread across hundreds of separate buffers. The morph target vertex deltas are valid (confirmed: non-zero values like -46, -56, -74), the one-hot animation weights are correct, and the AnimationController logic is sound. The problem is data delivery, not animation logic.

The model orientation issue is simpler: the OSRS model faces -Z natively (Z range -513 to 370), but the rotation code `Math.atan2(dx, dz)` assumes a +Z-facing model. Adding `Math.PI` to the rotation fixes this.

## Use Cases

- **UC-1**: Player sees the Hunlef subtly moving/breathing while idle
- **UC-2**: Player can distinguish magic vs ranged attacks by the Hunlef's animation
- **UC-3**: Player sees a clear style-switch animation when the Hunlef changes attack styles
- **UC-4**: Player sees the Hunlef collapse/die with a death animation on kill
- **UC-5**: The Hunlef always faces toward the player during combat

## Architecture

### Current Flow (broken)
```
export-gltf.mjs → 302-buffer GLTF → GLTFLoader → (morph targets lost?) → AnimationMixer → (no visual change)
```

### Proposed Fix
```
export-gltf.mjs → 302-buffer GLTF → gltf-transform (consolidate) → single-buffer GLB
    → GLTFLoader → geometry.morphAttributes populated → AnimationMixer → visible animation
```

**Strategy: Convert to GLB at build time.** Rather than modifying the osrscachereader library (which we don't own), add a post-processing step that consolidates the multi-buffer GLTF into a single-buffer GLB using `@gltf-transform/cli` or a Node.js script. This is the safest approach — it keeps the export pipeline intact while producing a format Three.js handles reliably.

**Alternative: Manual morph target injection.** If GLB conversion doesn't fix the issue, manually load the GLTF JSON, decode each morph target buffer, and inject them into the Three.js geometry via `geometry.morphAttributes.position`. This is more complex but gives full control.

## Implementation

### Phase 1: Diagnose — Confirm GLTFLoader morph target loading (~15% effort)

**Files:** None modified — diagnostic only

**Tasks:**
- [ ] Add diagnostic logging in Renderer3D after GLTF load:
  ```typescript
  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const morphPos = mesh.geometry.morphAttributes.position;
      console.log('[Renderer3D] Morph attributes:', morphPos?.length ?? 0);
      console.log('[Renderer3D] Morph influences:', mesh.morphTargetInfluences?.length ?? 0);
    }
  });
  ```
- [ ] Run the app and check console — this confirms whether morphAttributes are populated
- [ ] If morphAttributes is empty/0: the buffer issue is confirmed, proceed to Phase 2
- [ ] If morphAttributes has 144 entries: the issue is elsewhere (shader limits, material config, etc.)

### Phase 2: Convert GLTF to GLB (~30% effort)

**Files:**
- `tools/cache-reader/export-gltf.mjs` — Modify (add GLB consolidation step)
- `public/models/corrupted_hunlef.glb` — New (replaces .gltf)
- `src/render/Renderer3D.ts` — Modify (load .glb instead of .gltf)
- `package.json` — Modify (add gltf-transform dependency if needed)

**Tasks:**
- [ ] Option A: Use `@gltf-transform/core` to consolidate buffers and convert to GLB:
  ```javascript
  import { NodeIO } from '@gltf-transform/core';
  const io = new NodeIO();
  const doc = await io.read('corrupted_hunlef.gltf');
  await io.write('corrupted_hunlef.glb', doc);
  ```
- [ ] Option B: Write a manual consolidation script that merges all 302 data URI buffers into a single binary buffer and outputs GLB format
- [ ] Update `export-gltf.mjs` to run the consolidation after the initial export
- [ ] Update Renderer3D to load `.glb` instead of `.gltf`
- [ ] Verify: morph attributes now populated in Three.js after loading GLB
- [ ] Re-run diagnostic logging from Phase 1 to confirm

### Phase 3: Fix Model Rotation (~10% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Add a model rotation offset constant:
  ```typescript
  const BOSS_MODEL_YAW_OFFSET = Math.PI; // OSRS model faces -Z, Three.js expects +Z
  ```
- [ ] Update the rotation line in `updateBoss()`:
  ```typescript
  this.bossGroup.rotation.y = Math.atan2(dx, dz) + BOSS_MODEL_YAW_OFFSET;
  ```
- [ ] Test at multiple camera angles to verify the model always faces the player
- [ ] Fine-tune the offset if needed (could be PI, PI/2, or another value depending on exact OSRS coordinate system)

### Phase 4: Validate Animations End-to-End (~30% effort)

**Files:**
- `src/render/AnimationController.ts` — May need tweaks
- `src/render/Renderer3D.ts` — May need tweaks

**Tasks:**
- [ ] Verify idle animation plays on load — model should subtly move
- [ ] Verify attack_magic animation triggers when boss fires magic projectile
- [ ] Verify attack_ranged animation triggers when boss fires ranged projectile
- [ ] Verify style_switch animations play on style change
- [ ] Verify death animation plays and clamps on boss death
- [ ] Check for shader warnings about morph target count limits
- [ ] If animations are too subtle, consider increasing morph target delta scale or animation speed
- [ ] Test rapid style switches — should not cause animation state machine glitches

### Phase 5: Performance & Cleanup (~15% effort)

**Files:**
- Various cleanup

**Tasks:**
- [ ] Remove diagnostic logging added in Phase 1
- [ ] Check frame rate with animations playing (should be >30fps)
- [ ] Consider: does the 8MB GLB need optimization? (Could reduce vertex count or morph target precision)
- [ ] Run full test suite
- [ ] Run cg-sim-player bot fights

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/cache-reader/export-gltf.mjs` | Modify | Add GLB consolidation post-processing step |
| `public/models/corrupted_hunlef.glb` | New | Single-buffer GLB replacing multi-buffer GLTF |
| `public/models/corrupted_hunlef.gltf` | Delete | No longer needed after GLB conversion |
| `src/render/Renderer3D.ts` | Modify | Load .glb, fix rotation offset, diagnostic logging |
| `src/render/AnimationController.ts` | May modify | Tweaks if needed after morph target fix |
| `package.json` | May modify | Add gltf-transform dependency if used |

## Definition of Done

- [ ] `npm run build` passes
- [ ] `npm test` passes all 178 tests
- [ ] Hunlef idle animation visibly plays (mesh deforms, not static)
- [ ] Hunlef attack animations visibly trigger on boss attack ticks (magic and ranged look different)
- [ ] Hunlef style-switch animation plays on style change
- [ ] Hunlef death animation plays on kill and clamps (doesn't loop)
- [ ] Hunlef model faces the player at all times during combat
- [ ] Frame rate stays above 30fps with animations active
- [ ] `cd ../cg-sim-player && npm run run -- --fights 3` completes without errors
- [ ] Console shows no GLTF loading errors or warnings

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GLB conversion doesn't fix morph target loading | Medium | High | Fall back to manual morph target injection |
| 144 morph targets exceed shader limits | Low | High | Three.js dynamically selects top-N targets; one-hot encoding means only 1 active |
| gltf-transform dependency adds bloat | Low | Low | Only used at build/export time, not runtime |
| Performance degradation with 144 morph targets | Low | Medium | Profile and optimize if needed; reduce target count |

## Security

No security implications — all changes are local rendering and asset pipeline.

## Dependencies

- `@gltf-transform/core` (or equivalent) — for GLTF-to-GLB conversion (build-time only)
- `osrscachereader` — existing dependency for OSRS cache access
- `three` 0.183.2 — existing dependency

## Open Questions

1. After GLB conversion, does Three.js load all 144 morph targets into `geometry.morphAttributes`?
2. Is the OSRS model's default facing direction exactly -Z, or is there an additional angle?
3. Should we optimize the model by reducing morph target count (e.g., merging similar frames)?
4. Could STEP interpolation be causing the "static" appearance? (Should only affect smoothness, not visibility)
