# Sprint 007: 3D Rendering — Three.js, OSRS Models, Animated Hunlef

## Overview

Replace the 2D Canvas renderer with Three.js WebGL. The Corrupted Hunlef renders as its actual OSRS 3D model with correct vertex colors, viewed from an OSRS-style perspective camera. Animation frame data is extracted from the OSRS cache and exported as GLTF with morph targets so the Hunlef plays idle, attack, and style-switch animations. The arena is a 12x12 tiled floor. Player is a simple 3D shape. Projectiles and overlays (hit splats, overhead icons) transition to 3D sprites.

**Strategy**: Start fast (Phase 1-3: get static 3D models on screen from JSON), then add the animation pipeline (Phase 4-5: extract frames, export GLTF, wire AnimationMixer). This lets us validate the 3D setup before investing in animation complexity.

**What ships:** Three.js WebGL scene with animated Hunlef model, 12x12 corrupted arena floor, OSRS-style camera (rotatable), 3D projectiles, sprite overlays, all existing game logic unchanged.

**What's deferred:** Player character model (uses simple shape), texture-mapped models, post-processing, mobile touch, boss walking animation.

---

## Use Cases

1. **UC-1: 3D Hunlef** — The Corrupted Hunlef renders as model 38595 (2180 verts, 3605 faces) with correct OSRS HSL-to-RGB vertex colors.
2. **UC-2: Animated Hunlef** — Idle animation (seq 8417) plays continuously. Attack animations (8430 magic, 8431 ranged) trigger on boss attacks. Style-switch animations (8754, 8755) play on rotation changes. Death animation (8436) on kill.
3. **UC-3: 3D arena** — 12x12 tile floor with dark red/maroon corrupted gauntlet coloring.
4. **UC-4: OSRS camera** — ~55 degree pitch perspective camera. Rotates around arena center with arrow keys or mouse drag. Zoom constrained.
5. **UC-5: Player shape** — Simple colored 3D box/capsule at 1x1 tile scale with smooth interpolated movement.
6. **UC-6: 3D projectiles** — Crystal spikes and magic orbs as 3D shapes traveling through the scene.
7. **UC-7: 3D overlays** — Hit splats, overhead prayer icons, countdown text as billboard sprites.
8. **UC-8: Existing logic unchanged** — All 155 tests pass. Game simulation untouched.

---

## Architecture

### Three.js Integration

```
index.html
├── #game-container
│   ├── Three.js WebGLRenderer canvas (replaces old 2D canvas)
│   ├── CSS2DRenderer overlay (hit splats, labels)
│   └── #hud (DOM, unchanged)
├── #side-panel (DOM, unchanged)
```

### Renderer Transition

The `Renderer` class is rewritten but maintains the same `draw(sim, tickProgress)` interface:

```typescript
// Old: src/render/Renderer.ts (2D Canvas)
class Renderer {
  draw(sim: GameSimulation, tickProgress: number): void {
    ctx.fillRect(...) // colored rectangles
  }
}

// New: src/render/Renderer3D.ts (Three.js)
class Renderer3D {
  draw(sim: GameSimulation, tickProgress: number): void {
    this.updateScene(sim, tickProgress); // move meshes, trigger anims
    this.webglRenderer.render(this.scene, this.camera);
    this.css2dRenderer.render(this.scene, this.camera);
  }
}
```

The rAF loop in `main.ts` calls `renderer.draw(sim, tickProgress)` exactly as before.

### OSRS Color Conversion

```typescript
// src/render/osrsColor.ts
function osrsHSLtoRGB(hsl: number): [number, number, number] {
  const h = ((hsl >> 10) & 63) / 64 + 0.0078125;  // HUE_OFFSET
  const s = ((hsl >> 7) & 7) / 8 + 0.0625;         // SAT_OFFSET
  const l = (hsl & 127) / 128;
  // Standard HSL→RGB, then brightness adjustment: pow(channel, 0.6)
  // Copied from osrscachereader/GLTFExporter.js
}
```

### Model Loading (Two Paths)

**Path A: Runtime JSON → BufferGeometry** (Phase 1-2, static)
- Load JSON models at startup
- Convert to Three.js BufferGeometry with per-face vertex colors
- ~50 lines of conversion code per model
- Fast, no build step, but no animation

**Path B: GLTF with morph targets** (Phase 4-5, animated)
- Build script uses osrscachereader to extract animation frame data from cache
- GLTFExporter produces .gltf files with morph-target animations
- Three.js GLTFLoader loads them at runtime
- AnimationMixer plays animations synced to game ticks

Phase 1-3 uses Path A to get models on screen immediately. Phase 4-5 replaces the boss mesh with the GLTF-animated version.

### Camera Setup

```typescript
const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
// OSRS-style: ~55 degree pitch looking down
camera.position.set(0, 400, 350); // above and slightly behind
camera.lookAt(0, 0, 0);           // arena center

// Arrow keys / mouse drag rotate camera around Y axis
// Constrain: no looking directly down or sideways
```

### Animation Sync

Three.js animations run in continuous time. Game ticks are discrete (600ms). Sync strategy:
- AnimationMixer.update(delta) called in the rAF loop with real wall-clock delta
- Trigger specific animations via mixer.clipAction(clip).play() when game events happen
- Idle animation loops continuously
- Attack animations play once on boss attack tick, then return to idle

---

## Implementation

### Phase 1: Three.js Setup + Arena Floor (~15% effort)

**Files:**
- `package.json` — Add `three` dependency
- `src/render/Renderer3D.ts` — New (Three.js renderer)
- `src/render/osrsColor.ts` — New (HSL-to-RGB conversion)
- `src/main.ts` — Modify (use Renderer3D)
- `index.html` — Modify (canvas setup)

**Tasks:**
- [ ] `npm install three` + `npm install -D @types/three`
- [ ] Create `osrsColor.ts` with `osrsHSLtoRGB()` function (copy logic from osrscachereader GLTFExporter)
- [ ] Create `Renderer3D` class with same `draw(sim, tickProgress)` interface
- [ ] Set up Three.js scene: WebGLRenderer, PerspectiveCamera at OSRS angle, ambient + directional light
- [ ] Create 12x12 tile floor as a PlaneGeometry with dark red/maroon material (corrupted gauntlet palette)
- [ ] Add grid lines on the floor (LineSegments or TextureLoader with grid pattern)
- [ ] Wire into `main.ts`: replace `new Renderer(canvas)` with `new Renderer3D(container)`
- [ ] Verify: app shows a 3D tiled floor from an overhead angle

### Phase 2: Static Boss Model + Player Shape (~20% effort)

**Files:**
- `src/render/ModelLoader.ts` — New (JSON → BufferGeometry converter)
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Create `ModelLoader` class:
  - `loadFromJSON(modelData: OSRSModelJSON): THREE.BufferGeometry`
  - Expand per-face colors to per-vertex (duplicate vertices, 3 per face)
  - Convert OSRS HSL colors to RGB via `osrsHSLtoRGB()`
  - Set position, index, and color buffer attributes
  - Handle faceAlphas (semi-transparent faces)
- [ ] Load boss model (38595) at startup, create Mesh with `MeshBasicMaterial({ vertexColors: true })`
- [ ] Scale and position boss mesh to occupy 5x5 tiles in the 3D scene
- [ ] Coordinate system: OSRS Y is height (up), map to Three.js Y-up. Scale factor: tile = some unit (e.g., 1 tile = 10 Three.js units)
- [ ] Create player as a simple `BoxGeometry` (cyan color) at 1x1 tile scale
- [ ] Update player position each frame using lerp (same interpolation as Sprint 6)
- [ ] Update boss position from game state
- [ ] Verify: boss 3D model visible on the arena, colored correctly

### Phase 3: Camera Controls + Overlays + Projectiles (~20% effort)

**Files:**
- `src/render/CameraController.ts` — New
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Implement `CameraController`:
  - Arrow keys rotate camera around arena center (Y-axis orbit)
  - Mouse drag (middle button or right-click + drag) also rotates
  - Scroll wheel zooms in/out (constrained range)
  - Camera pitch fixed at ~55 degrees (no vertical rotation)
- [ ] Overhead prayer icons: Three.js `Sprite` with `SpriteMaterial` from the existing overhead PNGs
  - Position above player/boss, billboard (always faces camera)
- [ ] Hit splats: CSS2DRenderer `CSS2DObject` with styled DOM elements
  - Or Three.js Sprite with dynamically created canvas textures
  - Position at entity location, float upward over time
- [ ] Countdown overlay: Full-screen DOM overlay (keep existing approach — it's already DOM)
- [ ] 3D projectiles: colored Mesh objects (SphereGeometry for orbs, ConeGeometry for spikes)
  - Position interpolated along travel path (same math as Sprint 5-6)
  - Remove from scene on arrival
- [ ] Verify: can rotate camera, overhead icons visible, projectiles travel in 3D

### Phase 4: Animation Frame Extraction (~20% effort)

**Files:**
- `tools/cache-reader/extract-animations.mjs` — New
- `tools/cache-reader/export-gltf.mjs` — New

**Tasks:**
- [ ] Create `extract-animations.mjs` script:
  - Uses osrscachereader to load animation frames from OSRS cache archive 0 (ANIMATIONS)
  - Targets sequences: 8416 (walk), 8417 (idle), 8430 (magic attack), 8431 (ranged attack), 8432 (stomp), 8433 (prayer-disable), 8436 (death), 8754/8755 (style switch)
  - Extracts skeleton data and frame transforms
  - Saves to `docs/assets/defs/frames/`
- [ ] Create `export-gltf.mjs` script:
  - Uses osrscachereader's GLTFExporter to produce GLTF files
  - Converts model 38595 + all animation sequences to a single .gltf with morph targets
  - Output to `public/models/corrupted_hunlef.gltf`
  - Also export tornado (38601) and projectile models (40670, 40673) as static GLTF
- [ ] Run both scripts, verify GLTF files are produced
- [ ] Test: load the GLTF in a standalone Three.js viewer to verify colors and animation

### Phase 5: Animated Hunlef in Scene (~15% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify
- `src/render/AnimationController.ts` — New

**Tasks:**
- [ ] Replace the static boss mesh (from Phase 2) with the GLTF-loaded animated mesh
- [ ] Use Three.js `GLTFLoader` to load `corrupted_hunlef.gltf` at startup
- [ ] Create `AnimationController` class:
  - Wraps Three.js `AnimationMixer`
  - Manages animation state: idle, attack_magic, attack_ranged, stomp, style_switch, death
  - `playIdle()` — loops continuously
  - `playAttack(style)` — plays once, returns to idle
  - `playDeath()` — plays once, holds last frame
  - `update(delta)` — called each rAF frame with wall-clock delta
- [ ] In `Renderer3D.draw()`:
  - Check `sim.lastBossAttackStyle` to trigger attack animations
  - Check `sim.boss.currentStyle` change to trigger style switch
  - Check `sim.state === 'won'` to trigger death animation
  - Call `animationController.update(delta)` each frame
- [ ] Verify: Hunlef idles, animates on attack, switches animation on style change

### Phase 6: Polish + Integration (~10% effort)

**Files:**
- `src/render/Renderer3D.ts` — Polish
- `src/__tests__/integration.test.ts` — Verify unchanged
- Old `src/render/Renderer.ts` — Keep as fallback or remove

**Tasks:**
- [ ] Ensure all 155 existing tests pass (they should — tests don't touch the renderer)
- [ ] Handle game over: stop animation mixer, possibly grey out the scene
- [ ] Handle restart: dispose Three.js resources, recreate scene
- [ ] Performance check: should easily hit 60fps with ~8000 total vertices
- [ ] Visual verification with agent-browser:
  - [ ] Screenshot: 3D Hunlef model on arena floor
  - [ ] Screenshot: camera rotated to different angle
  - [ ] Screenshot: projectile mid-flight in 3D
  - [ ] Screenshot: overhead prayer icons as sprites
  - [ ] Screenshot: Hunlef attack animation (if capturable)
- [ ] Clean up old 2D Renderer.ts (or keep as a --2d flag option)

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add `three` + `@types/three` |
| `src/render/Renderer3D.ts` | Create | Three.js scene, camera, rendering |
| `src/render/osrsColor.ts` | Create | OSRS HSL-to-RGB conversion |
| `src/render/ModelLoader.ts` | Create | JSON model → Three.js BufferGeometry |
| `src/render/CameraController.ts` | Create | OSRS-style camera rotation/zoom |
| `src/render/AnimationController.ts` | Create | AnimationMixer wrapper for boss animations |
| `tools/cache-reader/extract-animations.mjs` | Create | Extract animation frames from OSRS cache |
| `tools/cache-reader/export-gltf.mjs` | Create | Export models + animations to GLTF |
| `public/models/corrupted_hunlef.gltf` | Create | Animated Hunlef GLTF (generated by export script) |
| `public/models/tornado.gltf` | Create | Tornado static GLTF |
| `public/models/projectile_magic.gltf` | Create | Magic projectile GLTF |
| `public/models/projectile_ranged.gltf` | Create | Ranged projectile GLTF |
| `src/main.ts` | Modify | Wire Renderer3D |
| `index.html` | Modify | Canvas container for Three.js |
| `src/render/Renderer.ts` | Keep/Remove | Old 2D renderer (keep as fallback?) |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all 155 existing tests
- [ ] Three.js renders a 3D scene (WebGL canvas replaces 2D canvas)
- [ ] Corrupted Hunlef model (38595) rendered with correct OSRS vertex colors
- [ ] 12x12 tile arena floor visible with corrupted coloring
- [ ] OSRS-style perspective camera (~55 degree pitch)
- [ ] Camera rotates around arena with arrow keys
- [ ] Player represented as a 3D shape with smooth interpolated movement
- [ ] Projectiles render as 3D objects traveling through the scene
- [ ] Overhead prayer icons visible as billboard sprites above entities
- [ ] Hit splats visible near entities
- [ ] Countdown/FIGHT overlay works
- [ ] Hunlef plays idle animation continuously
- [ ] Hunlef plays attack animation on boss attack ticks
- [ ] Hunlef plays style-switch animation on rotation change
- [ ] Animation frame data extracted from OSRS cache
- [ ] GLTF files generated with morph-target animations
- [ ] Side panel (DOM) untouched and functional
- [ ] All game logic (simulation, combat, prayer, targeting) unchanged
- [ ] 60fps rendering maintained

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Animation frame extraction fails | Medium | High | Fallback to static models with programmatic effects (Phase 2 already works standalone). Animation is additive. |
| OSRS model scale/orientation wrong | High | Medium | The OSRS coordinate system may differ from Three.js. Experiment with rotation/scale until the model looks correct. Y-up in both systems. |
| Three.js bundle too large | Low | Low | ~118KB gzipped is small. Tree-shaking with Vite helps. Only import what we use. |
| GLTF morph target animation doesn't work | Medium | Medium | osrscachereader's GLTFExporter supports morph targets but may have bugs. Test with a standalone viewer before integrating. Fallback to JSON frame data with manual vertex updates. |
| CSS2DRenderer for hit splats has z-fighting | Low | Low | Use Three.js Sprites instead if CSS2D doesn't layer correctly. |
| Camera controls conflict with click-to-attack | Medium | Medium | Camera rotation uses arrow keys or middle mouse button. Left click stays for game interaction. Clear separation. |

---

## Security Considerations

- Three.js is a well-maintained, widely-used library (MIT license)
- GLTF files are generated locally from our own extracted cache data
- No external network requests for 3D assets
- WebGL context is same-origin sandboxed

---

## Dependencies

### Runtime (FIRST runtime dependency)
| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `three` | `^0.170` | WebGL rendering, scene graph, animation | ~118KB gzip |

### Dev
| Package | Version | Purpose |
|---------|---------|---------|
| `@types/three` | `^0.170` | TypeScript types for Three.js |
| (existing) vite, typescript, vitest | | |

---

## Open Questions

1. **osrscachereader animation extraction**: Does `loadSkeletonAnims()` or `loadAnimation()` work reliably for the Hunlef's sequences? Need to test before committing to the GLTF pipeline. If it fails, fall back to static models.

2. **OSRS coordinate system**: OSRS uses Y for height, same as Three.js. But the scale factor and origin may need adjustment. The Hunlef model spans ~675 units across X and ~860 units across Y. Need to figure out the mapping: 1 OSRS unit = ? Three.js units.

3. **Player model**: Should we extract a generic player model from the cache, or use a placeholder shape? A simple box/capsule with the OSRS colors is fine for sprint 7.

4. **Should we keep the 2D renderer as a fallback?** Could be useful for testing, performance comparisons, or users with no WebGL. Low effort to keep it.

5. **Floor tile model**: We have model 37410 (floor hazard tile, 24 verts). Should we use it for the arena floor, or create a flat plane? The model might have the correct CG floor coloring.
