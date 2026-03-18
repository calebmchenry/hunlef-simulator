# Sprint 011 Intent: Fix Hunlef 3D Animations & Model Orientation

## Seed

Fix Hunlef animations (idle, attack, style switch, death must all visibly play) and fix Hunlef model rotation so it faces the player. Need to investigate why animations aren't working despite clips being named correctly — may need to dig into the GLTF export, morph targets, or animation data. Also fix rotation so the model faces the player during combat.

## Context

- GLTF animation data is **structurally valid** — 144 morph targets with real vertex deltas (e.g., -46, -56, -74 OSRS units), 8 animations with correct one-hot encoded weights and proper timestamps
- The GLTF has **302 separate data URI buffers** (~8 MB total) — extremely unusual for GLTF. Each morph target uses 2 buffers (POSITION + NORMAL, 27360 + 14592 bytes each). This may cause Three.js GLTFLoader to silently fail loading morph attributes into `geometry.morphAttributes`
- Model faces **-Z natively** (Z range -513 to 370, asymmetric), but the rotation code `Math.atan2(dx, dz)` assumes the model faces +Z — needs a PI offset or the model needs re-orienting in the export
- Three.js 0.183 auto-detects morph targets from `geometry.morphAttributes` — the material replacement (MeshBasicMaterial) is NOT the issue
- The AnimationController and Renderer3D code is architecturally correct. The problem is at the data level, not the logic level

## Recent Sprint Context

- **Sprint 010** (just completed): Fixed click raycasting, camera follow, and animation clip names. Codex assigned names by index in AnimationController and re-exported the GLTF with named clips. Build/tests pass (178/178).
- **Sprint 009**: Fixed Hunlef colors (replaced PBR materials with MeshBasicMaterial for vertex colors), added rotation-to-face-player code, and "fixed" animations — but animations still don't visually play
- **Sprint 007**: Introduced Three.js rendering, GLTF model loading, AnimationController

## Relevant Codebase Areas

| File | Role |
|------|------|
| `src/render/AnimationController.ts` | Manages animation state machine (idle/attack/death/etc), uses Three.js AnimationMixer with morph target clips |
| `src/render/Renderer3D.ts` | Loads GLTF model, replaces materials, creates AnimationController, updates boss animations per tick, rotates boss to face player |
| `src/render/ModelLoader.ts` | Fallback JSON model loader (no animations) |
| `tools/cache-reader/export-gltf.mjs` | Exports Hunlef from OSRS cache as GLTF with morph target animations via osrscachereader |
| `public/models/corrupted_hunlef.gltf` | 8 MB GLTF with 302 data URI buffers, 144 morph targets, 8 animations |
| `node_modules/osrscachereader/src/cacheReader/exporters/GLTFExporter.js` | Library that builds the GLTF — uses one-hot morph target encoding with STEP interpolation |

## Constraints

- Must keep all 178 existing tests passing
- Must use the OSRS cache data (osrscachereader) as the animation source of truth
- Must work with Three.js WebGL renderer (currently 0.183.2)
- Animation system must use morph targets (OSRS doesn't have skeletal rigs)
- GLTF must load in the browser without external file references (data URIs or single-file GLB)
- Model visual quality must be preserved (vibrant OSRS vertex colors via MeshBasicMaterial)

## Success Criteria

1. **Idle animation visibly plays** — the Hunlef model should subtly move/breathe when standing idle
2. **Attack animations are distinct** — magic and ranged attacks should produce clearly different visual movements
3. **Style switch animations play** — switching between magic and ranged should show a visible transition animation
4. **Death animation plays** — the Hunlef should visibly collapse/die when killed
5. **Model faces the player** — the Hunlef should always face toward the player character during combat
6. **Performance acceptable** — animations should not cause frame drops below 30fps on a modern machine

## Verification Strategy

- **Reference**: OSRS wiki animation GIFs for the Corrupted Hunlef (visual comparison)
- **Testing approach**:
  - `npm run build` passes
  - `npm test` passes all 178 tests
  - Visual verification in browser: idle animation visible, attack animations trigger on boss attack ticks, death animation plays on kill
  - `cd ../cg-sim-player && npm run run -- --fights 3` still works
- **Edge cases**:
  - First frame of idle should play immediately on model load
  - Rapid style switches shouldn't cause animation glitches
  - Death animation should clamp (not loop)
  - Model rotation should work at all camera angles

## Uncertainty Assessment

- **Correctness uncertainty: Medium** — We know the GLTF data is valid and the Three.js code is correct, but the 302-buffer issue is unusual and may require non-obvious fixes (GLB conversion, buffer consolidation, or a different morph target loading approach)
- **Scope uncertainty: Low** — Two clear bugs (animations not playing, model facing wrong way)
- **Architecture uncertainty: Medium** — May need to modify the export pipeline (export-gltf.mjs), the GLTF file format (convert to GLB), or potentially the morph target approach entirely if Three.js can't handle 144 morph targets

## Open Questions

1. Is Three.js GLTFLoader actually failing to load the 302 separate data URI buffers into `geometry.morphAttributes`? If so, would consolidating into a single-buffer GLB fix this?
2. Does Three.js have a practical limit on morph target count? (144 is high — the shader may only support 4-8 active at once, but one-hot encoding should only need 1)
3. Should we convert the GLTF to GLB format (single binary file) for better compatibility and smaller file size?
4. What is the model's "default facing direction" in OSRS units, and what rotation offset is needed to make `Math.atan2(dx, dz)` correct?
5. Are there alternative GLTF viewers/validators we can use to confirm the animation data works outside Three.js?
