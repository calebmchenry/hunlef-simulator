# Sprint 009: Fix Hunlef 3D Model — Colors, Rotation, Animations

## Overview

Three bugs with the Corrupted Hunlef 3D model need fixing: incorrect/washed-out colors (should be vibrant corrupted red/pink, currently grey/muted), the model doesn't rotate to face the player, and animations aren't playing despite 8 clips being present in the GLTF.

**Root causes to investigate:**
1. **Colors**: The GLTF export may have lost OSRS HSL color data, or Three.js lighting (ambient + directional) is washing out the vertex colors. The model uses `MeshBasicMaterial({ vertexColors: true })` which ignores lighting — but the GLTF loader may use a different material. Also check if the GLTF exporter applied the brightness gamma correction (`pow(channel, 0.6)`) correctly.
2. **Rotation**: No code in Renderer3D's update loop rotates the boss mesh toward the player position. Need to add `bossMesh.lookAt(playerWorldPos)` or calculate yaw rotation.
3. **Animations**: The AnimationController exists and is wired, but clips may have naming mismatches between what the GLTF exports and what the controller expects. Check console for errors. Also verify the AnimationMixer.update(delta) is being called each frame.

**What ships:** Hunlef model with correct corrupted red/pink colors, rotates to face the player, plays idle animation continuously and attack animations on boss attack ticks.

---

## Use Cases

1. **UC-1: Correct colors** — The Hunlef model displays vibrant corrupted red/pink/orange crystal coloring matching the OSRS in-game appearance, not grey/washed out.
2. **UC-2: Faces player** — The Hunlef model rotates to face the player's current position each frame.
3. **UC-3: Idle animation** — When not attacking, the Hunlef plays its idle animation (subtle movement/breathing).
4. **UC-4: Attack animations** — When the boss fires a ranged or magic attack, the corresponding attack animation plays, then returns to idle.
5. **UC-5: Style switch animation** — When the boss switches between ranged and magic, the transition animation plays.

---

## Implementation

### Phase 1: Diagnose + Fix Colors (~40% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify
- `src/render/ModelLoader.ts` — Modify (if using runtime JSON loading as fallback)
- `tools/cache-reader/export-gltf.mjs` — Possibly re-export with correct colors

**Tasks:**
- [ ] Check what material the GLTF loader creates for the Hunlef mesh — is it MeshBasicMaterial or MeshStandardMaterial? GLTF defaults to PBR (MeshStandardMaterial) which reacts to lighting and can wash out vertex colors.
- [ ] If MeshStandardMaterial: either switch to MeshBasicMaterial (unlit, vertex colors only — matches OSRS flat shading) or adjust lighting to not wash out colors.
- [ ] Check the GLTF file: does it contain the correct RGB vertex colors? Sample a few faces and compare against the expected OSRS HSL-to-RGB values.
- [ ] If GLTF colors are wrong: re-export using the osrscachereader GLTFExporter with correct brightness gamma (`pow(channel, 0.6)`).
- [ ] If GLTF colors are correct but washed out by material: traverse the GLTF scene after loading and replace all materials:
  ```typescript
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        // Copy vertex color data from existing material
      });
    }
  });
  ```
- [ ] Verify visually: Hunlef should have distinctive corrupted red/pink/orange crystal appearance.

### Phase 2: Boss Rotation Toward Player (~20% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] In the draw/update method, after updating boss mesh position, rotate it to face the player:
  ```typescript
  // Get player world position
  const playerWorldX = lerp(player.prevPos.x, player.pos.x, tickProgress) * tileScale + offset;
  const playerWorldZ = lerp(player.prevPos.y, player.pos.y, tickProgress) * tileScale + offset;

  // Boss looks at player (rotate around Y axis only — no tilting)
  const dx = playerWorldX - bossMesh.position.x;
  const dz = playerWorldZ - bossMesh.position.z;
  bossMesh.rotation.y = Math.atan2(dx, dz);
  ```
- [ ] Ensure the rotation is smooth (not jerky) — since this runs at 60fps via rAF it should be naturally smooth.
- [ ] Handle edge case: player directly on top of boss (stomp position) — don't spin wildly, keep last rotation.

### Phase 3: Fix Animation Playback (~30% effort)

**Files:**
- `src/render/AnimationController.ts` — Modify
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Debug animation clip naming: log `gltf.animations.map(a => a.name)` to see what names the GLTF exported. Compare against what AnimationController expects.
- [ ] Fix naming mismatches — the GLTF exporter may use sequence IDs (e.g., "8417") while the controller looks for state names (e.g., "idle"). Update the mapping.
- [ ] Verify `AnimationMixer.update(delta)` is called in the rAF loop with correct delta (wall-clock seconds, not tick count).
- [ ] Verify idle animation starts playing automatically on load:
  ```typescript
  const idleAction = mixer.clipAction(idleClip);
  idleAction.play();
  ```
- [ ] Wire attack triggers: when `sim.lastBossAttackStyle` changes or boss fires, call `animController.playAttack(style)`.
- [ ] Wire style switch: when `boss.currentStyle` changes, play the switch animation.
- [ ] Wire death: when `sim.state === 'won'`, play death animation.
- [ ] Test: idle should loop continuously, attack plays once then returns to idle.

### Phase 4: Visual Verification (~10% effort)

**Tasks:**
- [ ] `npm run build` — zero errors
- [ ] `npm test` — all 178 tests pass (no game logic changes)
- [ ] agent-browser screenshots:
  - [ ] Hunlef model with correct corrupted red/pink colors
  - [ ] Hunlef facing toward the player
  - [ ] Hunlef in attack pose (if capturable mid-animation)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/Renderer3D.ts` | Modify | Fix material, add boss rotation, wire animation triggers |
| `src/render/AnimationController.ts` | Modify | Fix clip name mapping, ensure idle plays |
| `src/render/ModelLoader.ts` | Possibly modify | Color fix if needed for runtime JSON path |
| `tools/cache-reader/export-gltf.mjs` | Possibly modify | Re-export GLTF with correct colors if needed |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all 178 tests
- [ ] Hunlef model displays vibrant corrupted red/pink/orange colors (not grey/washed out)
- [ ] Hunlef rotates to face the player's position each frame
- [ ] Hunlef idle animation plays continuously when not attacking
- [ ] Hunlef attack animation triggers on boss attack ticks
- [ ] AnimationMixer.update() called each rAF frame with correct delta
- [ ] agent-browser screenshots confirm correct visuals

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GLTF has no vertex colors (export bug) | Medium | High | Fallback: load model from JSON using ModelLoader (already works with correct colors from Sprint 7 Phase 2). |
| Animation clips have no morph target data | Medium | High | Fallback: programmatic animation (rotation pulse on attack, idle bob). GLTF may have exported empty clips. |
| MeshBasicMaterial loses depth/shading | Low | Low | MeshBasicMaterial is unlit but OSRS models ARE flat-shaded. This actually matches the OSRS look better than PBR. |
