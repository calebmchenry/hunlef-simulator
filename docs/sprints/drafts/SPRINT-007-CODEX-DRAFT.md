# Sprint 007: 3D Rendering -- Three.js with OSRS Models from JSON

## Overview

Replace the 2D canvas renderer with Three.js. Build meshes directly from the JSON model data already in `docs/assets/models/` using `BufferGeometry` at runtime -- no GLTF pipeline, no build step, no exporter. Copy the OSRS HSL-to-RGB conversion into the project. Static models only; animation is deferred to a later sprint. Fixed camera angle with keyboard rotation. Keep it shippable.

**What ships:** Three.js WebGL canvas, Hunlef model (38595) rendered with correct OSRS colors, 12x12 tile floor, player as a simple 3D shape, projectiles as 3D primitives, overhead icons as sprites, hit splats as sprites, fixed-angle camera with arrow-key rotation.

**What's deferred:** Skeletal/morph-target animation, orbit controls, GLTF export pipeline, animation frame extraction, smooth model transitions, player model, particle effects.

---

## Use Cases

1. **UC-1: 3D Hunlef** -- The Corrupted Hunlef renders as a colored 3D mesh built from model_38595.json. Colors match OSRS via HSL-to-RGB conversion.
2. **UC-2: Arena floor** -- A 12x12 tile grid renders as a flat plane with corrupted gauntlet coloring, visible from the camera angle.
3. **UC-3: Player shape** -- Player renders as a simple colored 3D box or capsule at 1x1 tile scale. Interpolated movement from Sprint 006 carries over.
4. **UC-4: Camera** -- Fixed ~55-degree pitch looking down at the arena. Arrow keys rotate the camera around the arena center. No mouse orbit yet.
5. **UC-5: Projectiles** -- Boss and player projectiles render as simple 3D shapes (spheres, cones) instead of 2D canvas drawings. Same interpolation math from Sprint 006.
6. **UC-6: Overlays** -- Overhead prayer icons and hit splats render as Three.js sprites floating in the scene. Countdown/FIGHT text stays as a screen-space overlay.
7. **UC-7: Existing tests pass** -- All 155 tests still pass. Tests never touch the renderer.

---

## Architecture

### Strategy: BufferGeometry from JSON

Skip GLTF entirely. The model JSONs contain everything needed:
- `vertexPositionsX/Y/Z` -- vertex coordinates
- `faceVertexIndices1/2/3` -- triangle indices
- `faceColors` -- 16-bit packed OSRS HSL per face

At runtime: build a `Float32Array` of positions, a `Uint16Array` of indices, and a per-vertex color `Float32Array` (expand face colors to vertex colors). Feed into `THREE.BufferGeometry`. One `MeshBasicMaterial({ vertexColors: true })` per mesh.

This is ~50 lines of code vs. hundreds for a GLTF pipeline.

### HSL-to-RGB

Copy the `HSLtoRGB` and `adjustForBrightness` functions from `osrscachereader/src/cacheReader/exporters/GLTFExporter.js` into `src/render/osrsColor.ts`. These unpack the 16-bit HSL format `(hue<<10 | sat<<7 | lum)` and convert to RGB with OSRS brightness correction.

### Scene Graph

```
Scene
  |-- AmbientLight (soft, ~0.6 intensity)
  |-- DirectionalLight (from above-right, ~0.8 intensity)
  |-- floorGroup (12x12 tile plane)
  |-- bossGroup (Hunlef mesh, positioned at boss.pos)
  |-- playerMesh (box/capsule, positioned at interpolated player pos)
  |-- projectileGroup (child meshes per active projectile)
  |-- spriteGroup (overhead icons, hit splats)
  |-- overlayGroup (countdown text as sprite)
```

### Renderer Rewrite

`Renderer` class changes from Canvas2D to Three.js but keeps the same external API:

```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement)  // creates WebGLRenderer, scene, camera
  draw(sim: GameSimulation, tickProgress: number): void  // updates positions, calls renderer.render()
}
```

`main.ts` stays exactly the same -- it calls `new Renderer(canvas)` and `renderer.draw(sim, tickProgress)` in the rAF loop.

### Camera

Fixed perspective camera. ~55-degree pitch (looking down), orbiting at a fixed radius around arena center. Arrow keys increment/decrement the orbit angle. No mouse interaction. Camera position computed each frame:

```typescript
const cx = CENTER_X + radius * Math.cos(angle) * Math.cos(pitch);
const cy = CENTER_Y + radius * Math.sin(pitch);
const cz = CENTER_Z + radius * Math.sin(angle) * Math.cos(pitch);
camera.position.set(cx, cy, cz);
camera.lookAt(CENTER_X, 0, CENTER_Z);
```

### Boss Rotation for Attacks

No animation system. When the boss attacks, apply a programmatic Y-axis rotation toward the player. When idle, face a default direction. This is a `bossGroup.rotation.y = angle` assignment, not an animation clip.

---

## Implementation

### Phase 1: OSRS Color Utility (~10% effort)

**Files:**
- `src/render/osrsColor.ts` -- Create

**Tasks:**
- [ ] Copy `HSLtoRGB`, `adjustForBrightness`, `unpackHue`, `unpackSaturation`, `unpackLuminance` from `tools/cache-reader/node_modules/osrscachereader/src/cacheReader/exporters/GLTFExporter.js`
- [ ] Port to TypeScript with proper types
- [ ] Export `osrsHslToRgb(hsl: number): [number, number, number]` that returns normalized `[r, g, b]` floats (0-1) suitable for Three.js vertex colors
- [ ] Use `BRIGHTNESS_MAX = 0.6` as the default brightness (matches the exporter)
- [ ] Unit test: known HSL values produce expected RGB (test a few values from the Hunlef model's `faceColors`)

### Phase 2: JSON-to-BufferGeometry Loader (~20% effort)

**Files:**
- `src/render/ModelLoader.ts` -- Create

**Tasks:**
- [ ] Define `OsrsModelJson` interface matching the JSON structure (vertexPositionsX/Y/Z, faceVertexIndices1/2/3, faceColors, faceAlphas, vertexCount, faceCount)
- [ ] `buildMeshFromJson(json: OsrsModelJson): THREE.Mesh`
  - Build position array: for each face (3 verts), look up X/Y/Z from the vertex arrays using the face indices. Flatten into `Float32Array`
  - Build color array: for each face, convert `faceColors[i]` via `osrsHslToRgb`, assign same color to all 3 vertices of the face. Flatten into `Float32Array`
  - Create `BufferGeometry` with `position` and `color` attributes
  - Apply `computeVertexNormals()` for basic lighting
  - Return `new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }))`
- [ ] OSRS coordinate system: Y is up, but negated in the JSON (negative Y = up). Apply `y = -y` on vertex load. Z may also need negation -- match the exporter: `[-Y, -Z]` or test visually
- [ ] Handle `faceAlphas` if present: faces with alpha > 0 get a separate transparent material (or skip for now -- cut candidate)

### Phase 3: Three.js Scene Setup (~20% effort)

**Files:**
- `src/render/Renderer.ts` -- Full rewrite

**Tasks:**
- [ ] Replace entire file. New `Renderer` class:
  - Constructor: create `WebGLRenderer({ canvas, antialias: true })`, `PerspectiveCamera`, `Scene`
  - Set renderer size to 576x576 (match current canvas size)
  - Add `AmbientLight(0xffffff, 0.6)` and `DirectionalLight(0xffffff, 0.8)` positioned above
- [ ] Build floor: `PlaneGeometry(12, 12)` with dark red/brown material (`#1a0a0a`), rotated flat, subdivided into 12x12 grid with `EdgesGeometry` + `LineSegments` for grid lines
- [ ] Load Hunlef model: `fetch('/docs/assets/models/model_38595.json')` at init, build mesh via `ModelLoader`, scale to fit 5x5 tiles, add to scene
- [ ] Player mesh: simple `BoxGeometry(0.8, 1.6, 0.8)` with cyan material
- [ ] Camera: `PerspectiveCamera(50, 1, 0.1, 100)` positioned at fixed orbit
- [ ] Expose `cameraAngle` property for keyboard input
- [ ] `draw(sim, tickProgress)`:
  - Update boss mesh position from `sim.boss.pos` (convert tile coords to world coords)
  - Update boss mesh Y rotation to face player (simple `Math.atan2`)
  - Update player mesh position from interpolated `lerp(prevPos, pos, tickProgress)`
  - Update/create/remove projectile meshes from `sim.projectiles`
  - Update overhead sprites and hit splat sprites
  - Call `this.threeRenderer.render(this.scene, this.camera)`

### Phase 4: Projectiles as 3D Objects (~15% effort)

**Files:**
- `src/render/Renderer.ts` -- Modify (within the rewrite)

**Tasks:**
- [ ] Pool of simple geometries: `SphereGeometry` for orbs, `ConeGeometry` for spikes/arrows
- [ ] On each `draw()`, sync projectile meshes with `sim.projectiles`:
  - If a projectile has no mesh yet, create one and add to scene
  - Compute interpolated position using the same math from Sprint 006 (tickProgress-based lerp)
  - Orient cones/arrows toward travel direction
  - Remove meshes for projectiles no longer in the array
- [ ] Color by type: green for ranged, purple for magic, white for melee slash (short-lived arc or flat ring)

### Phase 5: Sprites for Overhead Icons + Hit Splats (~15% effort)

**Files:**
- `src/render/Renderer.ts` -- Modify (within the rewrite)
- `src/render/assets.ts` -- May need to expose textures as image URLs for Three.js `TextureLoader`

**Tasks:**
- [ ] Overhead icons: load the existing base64 prayer icon images as Three.js textures. Create `SpriteMaterial` per icon type. Position sprite above entity mesh.
- [ ] Hit splats: create small colored sprites (red circle with white text) floating near the entity. Fade out over 2 ticks (same logic as current 2D renderer).
- [ ] Countdown overlay: render as a large sprite centered in view, or use an HTML overlay div on top of the canvas (simpler, and the DOM element already exists)

### Phase 6: Camera Controls (~5% effort)

**Files:**
- `src/input/InputManager.ts` -- Modify

**Tasks:**
- [ ] Add arrow key listeners (left/right) that adjust `renderer.cameraAngle`
- [ ] In `Renderer.draw()`, recompute camera position from angle each frame
- [ ] Default angle faces the arena from the south (player perspective)

### Phase 7: Install Three.js + Wire Up (~5% effort)

**Files:**
- `package.json` -- Modify
- `src/main.ts` -- Minimal changes (if any)

**Tasks:**
- [ ] `npm install three` and `npm install -D @types/three`
- [ ] Verify `main.ts` needs no changes -- the `Renderer` API is unchanged
- [ ] Verify `npm run build` works with Three.js
- [ ] Verify all 155 tests still pass

### Phase 8: Visual Verification + Polish (~10% effort)

**Tasks:**
- [ ] Hunlef model renders with recognizable shape and correct OSRS colors
- [ ] Model scale: 5x5 tile footprint matches boss size
- [ ] Model orientation: Hunlef faces the correct direction
- [ ] Floor grid visible at camera angle
- [ ] Player box visible and moves smoothly
- [ ] Projectiles travel from source to target
- [ ] Overhead icons visible above entities
- [ ] Hit splats visible near entities
- [ ] Style-colored border on boss (or colored glow/outline) to indicate ranged vs magic
- [ ] Countdown and FIGHT text visible
- [ ] Attack target highlight (yellow dashed border) -- may become a ground-projected ring or glow

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/render/osrsColor.ts` | Create | OSRS 16-bit HSL to RGB conversion |
| `src/render/ModelLoader.ts` | Create | Build Three.js BufferGeometry from JSON model data |
| `src/render/Renderer.ts` | Rewrite | Three.js scene, camera, draw loop |
| `src/input/InputManager.ts` | Modify | Arrow key camera rotation |
| `src/render/assets.ts` | Modify | Possibly expose icon textures for Three.js |
| `package.json` | Modify | Add `three` dependency + `@types/three` |
| `src/__tests__/osrsColor.test.ts` | Create | Unit tests for HSL-to-RGB conversion |

Five files modified/rewritten, three files created. One new runtime dependency (Three.js).

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` -- all 155 existing tests still pass
- [ ] Three.js renders a 3D scene in the 576x576 canvas
- [ ] Hunlef model from model_38595.json is visible with correct OSRS colors
- [ ] Hunlef is positioned and scaled to match 5x5 tile footprint
- [ ] 12x12 tile floor with grid lines is visible
- [ ] Player renders as a colored 3D shape with smooth interpolated movement
- [ ] Projectiles render as 3D shapes traveling between entities
- [ ] Overhead prayer icons float above entities
- [ ] Hit splats visible near entities
- [ ] Camera is at a fixed ~55-degree pitch
- [ ] Arrow keys rotate the camera around the arena
- [ ] Boss programmatically rotates to face player on attack
- [ ] Countdown overlay and FIGHT text work
- [ ] No GLTF files, no build step, no animation extraction

---

## Cut List (if sprint runs long)

These can be dropped without breaking the sprint, ordered by what to cut first:

1. **Hit splat sprites** -- Keep damage numbers in the side panel only. Cut the in-scene sprites.
2. **Overhead icon sprites** -- Prayer state is already shown in the side panel. Visual-only loss.
3. **Projectile 3D shapes** -- Fall back to simple colored spheres for all projectile types (skip cone/arrow geometry).
4. **Boss face-player rotation** -- Boss just faces a fixed direction. Purely cosmetic.
5. **Grid lines on floor** -- Flat colored plane is enough. Grid lines are polish.
6. **Camera rotation** -- Ship with a fixed angle, no keyboard rotation. Add later.
7. **faceAlphas / transparency** -- Skip transparent faces entirely. Most faces are opaque.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OSRS model orientation/scale wrong | High | Low | Model coordinates are in OSRS units (~128 per tile). Scale factor will need trial and error. Start with `scale = TILE_SIZE / 128` and adjust. |
| HSL colors look wrong | Medium | Medium | Test against known OSRS screenshots. The conversion code is proven in the exporter -- porting bugs are the risk. Unit test specific color values. |
| Three.js bundle size bloats the build | Low | Low | Three.js is ~118KB gzipped. Acceptable. Tree-shaking may help if using ES module imports. |
| Vertex winding order produces inside-out faces | Medium | Low | Set `material.side = THREE.DoubleSide` as a fallback. Fix winding later. |
| Performance with 3605-face Hunlef model | Low | Low | 3605 triangles is trivial for WebGL. Not a concern. |
| Projectile mesh creation/destruction causes GC pressure | Medium | Low | Pool meshes. Create a fixed set and show/hide. Only matters if projectile count is high (it's not). |
| rAF loop timing changes with Three.js render cost | Low | Low | Three.js render of this scene is sub-1ms. No impact on interpolation. |

---

## Dependencies

- **three** (new runtime dependency, ~118KB gzipped)
- **@types/three** (dev dependency)

---

## Open Questions

1. **OSRS Y-axis convention** -- The JSON has negative Y for "up". The exporter does `-vertexPositionsY` and `-vertexPositionsZ`. Need to match this. Verify with visual output.
2. **Model coordinate scale** -- OSRS uses ~128 units per tile. What's the exact scale factor to map model coords to the Three.js scene? Will need empirical tuning.
3. **Boss style indicator** -- Currently a colored border on the 2D rectangle. In 3D, options: colored point light near boss, tinted material override, or a colored ring on the ground. Simplest: colored SpriteMaterial label floating above. Decide during implementation.
