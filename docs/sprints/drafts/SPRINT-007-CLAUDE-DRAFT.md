# Sprint 007: 3D Rendering — Three.js, OSRS Models, Animated Hunlef

## Overview

Replace the 2D Canvas renderer with a Three.js WebGL scene. Load the actual OSRS Corrupted Hunlef model (2180 vertices, 3605 faces) with correct vertex colors converted from OSRS 16-bit HSL. Extract animation frame data from the OSRS cache via osrscachereader's GLTFExporter to produce GLTF files with morph-target animations. Render a 3D arena with OSRS-style perspective camera.

**What ships:** Three.js WebGL renderer displaying a 12x12 tile arena floor, the Corrupted Hunlef model with HSL-accurate vertex colors and idle/attack animations, a player representation, 3D projectiles, overhead icons as sprites, hit splats, and an OSRS-style camera (50-60 degree pitch, rotatable).

**What's deferred:** Player model extraction (player is a simple mesh for now), texture-mapped models (all CG models are vertex-colored, no textures needed), post-processing effects, mobile touch controls.

---

## Use Cases

1. **UC-1: 3D arena** — The 12x12 corrupted gauntlet arena renders as a 3D tiled floor plane with the correct dark red/maroon coloring, viewed from an OSRS-style overhead perspective.
2. **UC-2: Hunlef model** — The Corrupted Hunlef renders as its actual OSRS model (model 38595) with correct colors, occupying a 5x5 tile area.
3. **UC-3: Animated Hunlef** — The Hunlef plays its idle animation (seq 8417, 14 frames) when standing, attack animations (8430 magic, 8431 ranged) when firing, and style-switch animations (8754, 8755).
4. **UC-4: OSRS camera** — Camera looks down at ~50-60 degrees, can be rotated around the arena center with mouse drag or arrow keys, with zoom constrained to reasonable bounds.
5. **UC-5: 3D projectiles** — Boss projectiles (models 40670, 40673) and player projectiles render as 3D objects traveling through the scene with arc height.
6. **UC-6: Overlays in 3D** — Hit splats, overhead prayer icons, and countdown text render as billboard sprites or CSS2D overlays that always face the camera.
7. **UC-7: Game logic unchanged** — All 155 existing tests still pass. Tick engine, combat, prayer, pathfinding are untouched.

---

## Architecture

### Rendering Pipeline Transition

**Current (2D):**
```
Renderer.draw(sim, tickProgress)
  ctx.fillRect(...)          ← colored rectangles
  ctx.drawImage(...)         ← overhead icons
  ctx.fillText(...)          ← hit splat text
```

**New (3D):**
```
Renderer3D.draw(sim, tickProgress)
  scene.update(sim, tickProgress)     ← move meshes, trigger animations
  webglRenderer.render(scene, camera) ← Three.js draws everything
  css2dRenderer.render(scene, camera) ← overlays (hit splats, labels)
```

The rAF render loop from Sprint 006 stays identical. `renderer.draw(sim, tickProgress)` is still the only call — the internal implementation changes from Canvas 2D to Three.js.

### Model Data Flow

Two paths, used for different model categories:

**Path A — Build-time GLTF (animated models):**
```
OSRS Cache → osrscachereader → GLTFExporter.addSequence() → .gltf files
  → Three.js GLTFLoader at runtime → AnimationMixer plays morph targets
```

**Path B — Runtime BufferGeometry (static models):**
```
model_XXXXX.json → parse at runtime → BufferGeometry
  → positions from vertexPositionsX/Y/Z
  → indices from faceVertexIndices1/2/3
  → vertex colors from faceColors[] via HSLtoRGB()
```

Path A is required for the Hunlef (animated). Path B is simpler and sufficient for projectiles, tornado, and arena tiles.

### OSRS HSL-to-RGB Color Conversion

The OSRS cache stores face colors as 16-bit packed HSL values: `(hue << 10) | (saturation << 7) | luminance`. The osrscachereader GLTFExporter at `tools/cache-reader/node_modules/osrscachereader/src/cacheReader/exporters/GLTFExporter.js` contains the reference implementation:

```typescript
// Port to TypeScript for runtime use:
function osrsHSLtoRGB(hsl: number): [number, number, number] {
  const hue = ((hsl >> 10) & 63) / 64 + 0.5 / 64;
  const sat = ((hsl >> 7) & 7) / 8 + 0.5 / 8;
  const lum = (hsl & 127) / 128;

  const chroma = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = lum - chroma / 2;

  let r = m, g = m, b = m;
  const sector = Math.floor(hue * 6);
  // ... standard HSL sector switch (same as GLTFExporter.js lines 34-58)

  // Apply OSRS brightness (0.6 gamma)
  const brightness = 0.6;
  r = Math.pow(r, brightness);
  g = Math.pow(g, brightness);
  b = Math.pow(b, brightness);

  return [r, g, b]; // 0.0-1.0 range, ready for Three.js Color attribute
}
```

This is applied per-face. Since Three.js BufferGeometry uses per-vertex colors, each face's three vertices get the face's color. The GLTFExporter handles this by deduplicating vertex+color pairs (a vertex shared by two differently-colored faces gets two entries in the buffer). We replicate this logic for runtime Path B.

### Camera System

OSRS uses a fixed-pitch perspective camera at roughly 50-60 degrees from horizontal, rotatable around the player/scene center. Implementation:

```typescript
camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
// Position: spherical coordinates around arena center
// pitch ~55 degrees, distance ~20 units (tuned to show full 12x12 arena)
camera.position.set(0, 14, 10); // y=up, z=toward viewer
camera.lookAt(arenaCenter);
```

Rotation is yaw-only (orbit around Y axis) with pitch locked. This is simpler than full OrbitControls and matches OSRS behavior:

```typescript
class OSRSCameraController {
  private yaw = 0;           // radians, 0 = south-facing
  private pitch = 55;        // degrees, fixed
  private distance = 18;     // units from center
  private center: Vector3;   // arena center (6, 0, 6) in tile coords

  rotate(deltaYaw: number) { this.yaw += deltaYaw; }
  zoom(delta: number) { this.distance = clamp(this.distance + delta, 10, 30); }

  update(camera: PerspectiveCamera) {
    const pitchRad = this.pitch * Math.PI / 180;
    camera.position.set(
      this.center.x + this.distance * Math.cos(pitchRad) * Math.sin(this.yaw),
      this.center.y + this.distance * Math.sin(pitchRad),
      this.center.z + this.distance * Math.cos(pitchRad) * Math.cos(this.yaw),
    );
    camera.lookAt(this.center);
  }
}
```

Input: mouse drag (horizontal) rotates yaw. Scroll wheel zooms. Arrow keys rotate. No pitch adjustment exposed to the user.

### Animation System

OSRS animations use morph targets (shape keys), not skeletal bones. Each animation frame is a complete set of vertex positions. The GLTFExporter produces GLTF files where:

1. The base mesh is the model's rest pose
2. Each animation frame is a morph target (vertex position deltas from rest pose)
3. Animation channels use STEP interpolation (no blending between frames — matches OSRS's discrete frame look)
4. Frame timing uses `frameLengths` from sequence defs (in game ticks at 20ms/tick for client-side, converted to seconds by dividing by 50)

Key sequences for Corrupted Hunlef (NPC 9035, model 38595):

| Sequence | Name | Frames | Duration (ticks) | Usage |
|----------|------|--------|-------------------|-------|
| 8417 | idle | 14 | 60 | Standing idle loop |
| 8416 | walk | 16 | 60 | Walking |
| 8430 | magic attack | 14 | 60 | Magic projectile fire |
| 8431 | ranged attack | 23 | 90 | Ranged projectile fire |
| 8432 | stomp | 21 | 90 | Melee stomp attack |
| 8433 | prayer disable | 22 | 90 | Disable overhead prayer |
| 8436 | death | 18 | 60 | Death animation |
| 8754 | switch to mage | 16 | 60 | Style switch (to mage) |
| 8755 | switch to range | 16 | 60 | Style switch (to range) |

At runtime, `THREE.AnimationMixer` manages playback. The sim's `boss.currentAnimation` state drives which clip plays. Transitions are instant (crossfade duration = 0) to match OSRS feel.

### Scene Composition

```
Scene
├── AmbientLight (intensity 0.6 — flat OSRS-like illumination)
├── DirectionalLight (intensity 0.4, from above-right — subtle shadows)
├── ArenaFloor (PlaneGeometry 12x12, subdivided, dark maroon #1a0a0a)
│   └── GridLines (LineSegments — tile grid in #3a1a1a)
├── BossGroup (Group)
│   ├── HunlefMesh (from GLTF, with morph target animations)
│   └── OverheadSprite (prayer icon, billboard)
├── PlayerGroup (Group)
│   ├── PlayerMesh (simple BoxGeometry or low-poly shape, #44cccc)
│   └── OverheadSprite (prayer icon, billboard)
├── ProjectilesGroup (Group)
│   └── [ProjectileMesh...] (from model JSON or simple geometries)
├── HitSplatsGroup (CSS2DObject instances)
└── CountdownOverlay (CSS2DObject, centered)
```

### Overlay Strategy: CSS2DRenderer

Hit splats, overhead icons, countdown, and text labels use Three.js CSS2DRenderer, which projects 3D positions to 2D screen space and renders DOM elements on top of the WebGL canvas. This approach:

- Keeps text crisp (not pixelated from 3D rendering)
- Overhead icons are already PNG images (existing `assets.ts` data URIs work directly)
- Hit splats keep their current DOM styling (red/blue circles with white text)
- The CSS2DRenderer canvas overlays the WebGL canvas with `pointer-events: none`

Alternative considered: Three.js Sprite with SpriteMaterial and canvas textures. Rejected because CSS2D is simpler and pixel-perfect for UI elements.

### Performance Analysis

Total geometry budget: **7,704 vertices / 13,652 faces** across all 29 models. This is trivially small for WebGL. For context:

- A single modern game character is typically 10,000-50,000 vertices
- WebGL can comfortably handle 100,000+ vertices at 60fps
- The Hunlef (2,180 verts) is the largest model. Even with morph targets (which store per-frame deltas), the GPU cost is negligible
- Morph target evaluation is a single shader pass: `finalPos = basePos + weight * delta`
- With ~10 animations averaging 17 frames each, morph target memory is roughly: 2,180 verts * 3 floats * 4 bytes * 170 frames = ~4.4MB — well within budget

The only performance consideration is draw calls. With naive rendering, each model is one draw call (or two if it has alpha faces). The entire scene should be under 20 draw calls. No instancing, LOD, or frustum culling needed.

---

## Implementation

### Phase 0: Animation Frame Extraction Script (~15% effort)

**Files:**
- `tools/cache-reader/extract-gltf-models.mjs` — New file

**Tasks:**
- [ ] Create a new extraction script that uses osrscachereader to load animation frames and export GLTF
- [ ] For NPC 9035 (Corrupted Hunlef, model 38595):
  - Load the model definition from cache
  - Instantiate `GLTFExporter` with the model def
  - For each sequence (8417, 8416, 8430, 8431, 8432, 8433, 8436, 8754, 8755):
    - Call `exporter.addSequence(cache, sequenceDef)` — this loads skeleton animation frames from the cache, creates morph targets for each frame, and registers the animation timeline
  - Call `exporter.addColors()` to generate the UV-mapped color palette texture
  - Call `exporter.export()` to produce the GLTF JSON string
  - Write to `docs/assets/gltf/hunlef.gltf`
- [ ] For the tornado model (from NPC 9039):
  - Same process with its standing/walk animations
  - Write to `docs/assets/gltf/tornado.gltf`
- [ ] The GLTFExporter handles: vertex deduplication by color+alpha pair, Y/Z axis negation (OSRS→GLTF coordinate conversion), HSL-to-RGB via color palette texture, morph target delta computation, STEP interpolation animation channels
- [ ] Verify output loads in a GLTF validator (e.g., gltf-viewer.donmccurdy.com)

**Key detail — how addSequence works internally:**
The `GLTFExporter.addSequence()` method (lines 519-557 of the exporter) handles the heavy lifting:
1. Reads `frameIDs` from the sequence def — each is `(skeletonId << 16) | frameIndex`
2. Calls `modelDef.loadSkeletonAnims(cache, modelDef, skeletonId)` to load the skeleton from the cache, which returns transformed vertex positions for each frame
3. Each frame becomes a morph target (vertex deltas from rest pose)
4. Frame timing comes from `frameLengths`, converted to seconds by dividing cumulative ticks by 50

### Phase 1: Three.js Setup + Arena Floor (~15% effort)

**Files:**
- `package.json` — Modify (add `three` dependency)
- `src/render/Renderer3D.ts` — New file
- `src/render/OSRSCamera.ts` — New file
- `src/main.ts` — Modify

**Tasks:**
- [ ] `npm install three` and `npm install -D @types/three`
- [ ] Create `Renderer3D` class with the same interface as `Renderer`:
  ```typescript
  export class Renderer3D {
    private webglRenderer: THREE.WebGLRenderer;
    private css2dRenderer: CSS2DRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private cameraController: OSRSCameraController;

    constructor(canvas: HTMLCanvasElement) { ... }
    draw(sim: GameSimulation, tickProgress: number): void { ... }
    dispose(): void { ... }
  }
  ```
- [ ] Initialize `WebGLRenderer` with the existing canvas element (576x576, can be resized later)
- [ ] Set up `CSS2DRenderer` as an overlay div on top of the WebGL canvas
- [ ] Create arena floor: `PlaneGeometry(12, 12)` rotated to lie flat, dark maroon material (#1a0a0a)
- [ ] Add grid lines: `LineSegments` with `LineBasicMaterial` (#3a1a1a) for the 12x12 tile grid
- [ ] Lighting: `AmbientLight(0xffffff, 0.6)` + `DirectionalLight(0xffffff, 0.4)` from above
- [ ] In `main.ts`, swap `new Renderer(canvas)` for `new Renderer3D(canvas)`
- [ ] The rAF loop calls `renderer.draw(sim, tickProgress)` exactly as before

**Coordinate mapping:**
OSRS game tiles (0-11 integer grid) map to Three.js world units 1:1. Arena center at (6, 0, 6). Y is up. One tile = one unit. The Hunlef model vertices are in OSRS units (~1 unit = 1/128 tile) and need scaling by 1/128 to fit the tile grid. A 5-tile boss at tile (3,3) occupies world coords (3, 0, 3) to (8, 0, 8).

### Phase 2: OSRS Camera Controller (~10% effort)

**Files:**
- `src/render/OSRSCamera.ts` — New file
- `src/input/InputManager.ts` — Modify

**Tasks:**
- [ ] Implement `OSRSCameraController`:
  - Spherical coordinates: yaw (0-2pi), fixed pitch (55 deg), distance (10-30 units)
  - `update(camera)` — sets camera position from spherical coords, calls `lookAt(center)`
  - `rotate(deltaYaw)` — horizontal rotation
  - `zoom(delta)` — clamp distance
- [ ] Wire mouse drag to yaw rotation:
  - `mousedown` on canvas: start tracking
  - `mousemove`: `deltaX * 0.01` radians per pixel
  - `mouseup`: stop
  - Use a modifier key or right-click to distinguish from tile-click (existing click-to-move)
- [ ] Wire scroll wheel to zoom
- [ ] Wire left/right arrow keys to rotate (if not already used)
- [ ] Initial view: looking south (yaw=0), showing full arena with Hunlef visible

### Phase 3: Hunlef Model Loading + Vertex Colors (~20% effort)

**Files:**
- `src/render/ModelLoader.ts` — New file
- `src/render/OSRSColors.ts` — New file
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Create `OSRSColors.ts` with the HSL-to-RGB conversion ported from the GLTFExporter:
  ```typescript
  export function osrsHSLtoRGB(hsl: number): THREE.Color {
    const hue = ((hsl >> 10) & 63) / 64 + 0.5 / 64;
    const sat = ((hsl >> 7) & 7) / 8 + 0.5 / 8;
    const lum = (hsl & 127) / 128;
    // ... HCL sector math (6 cases)
    // Apply brightness gamma = 0.6
    return new THREE.Color(r, g, b);
  }
  ```
- [ ] Create `ModelLoader.ts`:
  - **GLTF path** (for animated Hunlef): use `THREE.GLTFLoader` to load `hunlef.gltf`
    - The GLTF already contains correct colors (via UV-mapped palette texture from GLTFExporter)
    - Extract `AnimationClip[]` from the loaded GLTF for the AnimationMixer
  - **JSON path** (for static models): parse model JSON into `BufferGeometry`
    ```typescript
    function buildGeometryFromJSON(modelData: OSRSModelJSON): THREE.BufferGeometry {
      const geo = new THREE.BufferGeometry();

      // Build vertex buffer with deduplication (same approach as GLTFExporter constructor)
      // Each face references 3 vertex indices + 1 color
      // A vertex appearing in faces of different colors must be duplicated
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const vertexColorMap: Map<string, number> = new Map();

      for (let f = 0; f < modelData.faceCount; f++) {
        const color = osrsHSLtoRGB(modelData.faceColors[f]);
        const faceVerts = [
          modelData.faceVertexIndices1[f],
          modelData.faceVertexIndices2[f],
          modelData.faceVertexIndices3[f],
        ];
        for (const vi of faceVerts) {
          const key = `${vi}_${modelData.faceColors[f]}`;
          if (!vertexColorMap.has(key)) {
            vertexColorMap.set(key, positions.length / 3);
            positions.push(
              modelData.vertexPositionsX[vi],
              -modelData.vertexPositionsY[vi],  // Y negated (OSRS convention)
              -modelData.vertexPositionsZ[vi],  // Z negated
            );
            colors.push(color.r, color.g, color.b);
          }
          indices.push(vertexColorMap.get(key)!);
        }
      }

      geo.setIndex(indices);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    }
    ```
  - Material for vertex-colored meshes: `MeshLambertMaterial({ vertexColors: true })` — gives flat-ish OSRS shading
- [ ] Load and place the Hunlef:
  - Load `hunlef.gltf` via GLTFLoader
  - Scale: OSRS model units are roughly 1/128 of a tile. The Hunlef's vertex X range is about [-117, 116], so ~234 units wide. At 5 tiles wide, scale factor = 5 / 234 * 128 ≈ 0.027. Fine-tune visually.
  - Position at boss tile center: `(boss.pos.x + 2.5, 0, boss.pos.y + 2.5)` in world coords
  - Create `AnimationMixer` for the Hunlef mesh

### Phase 4: Animation Playback (~10% effort)

**Files:**
- `src/render/AnimationController.ts` — New file
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] Create `AnimationController` wrapping `THREE.AnimationMixer`:
  ```typescript
  class AnimationController {
    private mixer: THREE.AnimationMixer;
    private clips: Map<string, THREE.AnimationClip>;
    private currentAction: THREE.AnimationAction | null;

    play(name: string, loop: boolean = true) {
      const clip = this.clips.get(name);
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      if (this.currentAction && this.currentAction !== action) {
        this.currentAction.stop();
      }
      action.play();
      this.currentAction = action;
    }

    update(deltaSeconds: number) {
      this.mixer.update(deltaSeconds);
    }
  }
  ```
- [ ] In `Renderer3D.draw()`, determine which animation to play based on sim state:
  - Boss idle → play "8417" (idle)
  - Boss just attacked with magic → play "8430", then return to idle
  - Boss just attacked with ranged → play "8431", then return to idle
  - Boss style switch → play "8754" or "8755"
  - Boss dead → play "8436" (death), no loop
- [ ] Call `animationController.update(deltaTime)` each frame (deltaTime from rAF timestamps)
- [ ] GLTF animations use STEP interpolation, so frames snap discretely — matching OSRS's look

### Phase 5: Player + Projectiles + Tornado as 3D Objects (~15% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify

**Tasks:**
- [ ] **Player mesh**: `BoxGeometry(0.6, 1.2, 0.6)` with `MeshLambertMaterial({ color: 0x44cccc })`
  - Position interpolated: `lerp(player.prevPos, player.pos, tickProgress)`
  - Positioned at `(x + 0.5, 0.6, y + 0.5)` — centered on tile, half-height up
- [ ] **Projectiles**: For each active projectile, create/reuse a 3D mesh:
  - Boss ranged (spike shape): load model 40670 via JSON path, or use `ConeGeometry` colored green
  - Boss magic (orb): load model 40673 via JSON path, or use `SphereGeometry` colored purple
  - Player projectiles: simple geometries (arrow = cone+cylinder, blast = sphere, slash = torus arc)
  - **Interpolated position** along the travel path (same math as current 2D renderer)
  - **Arc height**: add a parabolic Y offset: `y = 4 * arcHeight * t * (1 - t)` where t is travel progress. This gives projectiles a satisfying arc through 3D space. arcHeight ~1-2 units.
  - **Rotation**: orient projectile mesh toward travel direction using `mesh.lookAt(target)`
- [ ] **Projectile pooling**: pre-allocate a small pool of meshes (max ~5 active projectiles), show/hide as needed. No garbage collection pressure.
- [ ] **Tornado**: If GLTF exported with animation, load and animate. Otherwise, load from model JSON and spin with `mesh.rotation.y += deltaTime * 3`.

### Phase 6: Overlays — Hit Splats, Overhead Icons, Countdown (~10% effort)

**Files:**
- `src/render/Renderer3D.ts` — Modify
- `src/render/OverlayManager.ts` — New file

**Tasks:**
- [ ] **CSS2DRenderer setup**: create a div overlay on top of the WebGL canvas, render CSS2D objects
- [ ] **Overhead prayer icons**: `CSS2DObject` containing an `<img>` element
  - Positioned at entity world position + Y offset (above head): `(x, 2.5, z)`
  - Use existing base64 PNGs from `assets.ts` (overheadMagic, overheadMissiles, overheadMelee)
  - Update per-frame: show/hide based on `sim.prayerManager.activePrayer` and `boss.protectionStyle`
- [ ] **Hit splats**: `CSS2DObject` containing a styled div (red/blue circle + white damage number)
  - Positioned at the damaged entity's world position + small Y offset
  - Fade out over 3 ticks (same logic as current 2D renderer: `alpha = 1 - age * 0.3`)
  - Remove from scene when expired
- [ ] **Countdown overlay**: `CSS2DObject` centered on arena
  - Large number during countdown state
  - "FIGHT!" text for 2 ticks after countdown ends
  - Semi-transparent backdrop: can use a full-screen CSS overlay div (simpler than 3D)
- [ ] **Boss style indicator**: colored border/glow on the Hunlef model
  - Option A: swap emissive color on the Hunlef material (green for ranged, purple for mage)
  - Option B: add a colored ring/circle on the ground beneath the boss
  - Option A is simpler and preserves the color-coded style information

### Phase 7: Polish + Integration (~5% effort)

**Files:**
- `src/main.ts` — Modify
- `src/render/Renderer3D.ts` — Modify
- `index.html` — Modify (if CSS2D overlay div needed)

**Tasks:**
- [ ] Ensure `Renderer3D.dispose()` cleans up WebGL context, geometries, materials, textures
- [ ] Handle window resize: update camera aspect ratio and renderer size
- [ ] Keep the old `Renderer` class — do not delete it. The 3D renderer is a new class. Can add a toggle later.
- [ ] Verify all 155 tests pass (they never import Renderer directly — they test game logic)
- [ ] `npm run build` passes with zero errors
- [ ] Visual verification:
  - [ ] Hunlef model visible with correct reddish/corrupted colors
  - [ ] Idle animation plays smoothly
  - [ ] Attack animation triggers on boss attack
  - [ ] Camera rotates with mouse drag
  - [ ] Projectiles travel in 3D arcs
  - [ ] Overhead icons visible above player and boss
  - [ ] Hit splats appear on damage
  - [ ] Countdown works
  - [ ] Arena grid visible

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add `three` + `@types/three` |
| `tools/cache-reader/extract-gltf-models.mjs` | New | Extract animated GLTF from OSRS cache |
| `src/render/Renderer3D.ts` | New | Three.js WebGL renderer (replaces 2D Renderer) |
| `src/render/OSRSCamera.ts` | New | OSRS-style camera controller (fixed pitch, yaw rotation) |
| `src/render/OSRSColors.ts` | New | OSRS 16-bit HSL to RGB conversion |
| `src/render/ModelLoader.ts` | New | Load GLTF + build BufferGeometry from JSON |
| `src/render/AnimationController.ts` | New | Wrapper around Three.js AnimationMixer |
| `src/render/OverlayManager.ts` | New | CSS2DRenderer overlays (hit splats, icons, countdown) |
| `src/render/Renderer.ts` | Keep | Old 2D renderer preserved (not deleted) |
| `src/main.ts` | Modify | Swap Renderer for Renderer3D |
| `src/input/InputManager.ts` | Modify | Add camera rotation/zoom input |
| `index.html` | Modify | Add CSS2D overlay container div |
| `docs/assets/gltf/hunlef.gltf` | New (generated) | Animated Hunlef GLTF with morph targets |
| `docs/assets/gltf/tornado.gltf` | New (generated) | Animated tornado GLTF |

---

## Key Technical Details

### Vertex Deduplication

OSRS models store face colors, not vertex colors. A single vertex (e.g., vertex 42) may be shared by faces of different colors. Three.js BufferGeometry requires per-vertex attributes. The solution (used by the GLTFExporter and replicated in our runtime loader):

- For each face, examine its 3 vertex indices and its color
- The key `(vertexIndex, colorValue)` determines uniqueness
- If this vertex+color pair hasn't been seen, add a new entry to the position and color buffers
- The index buffer references these deduplicated entries

The Hunlef model (2,180 original vertices, 3,605 faces) expands to roughly 3,000-4,000 deduplicated vertex+color entries. Still trivial for WebGL.

### Model Coordinate System

OSRS models use: X = east, Y = up (negated in export), Z = south (negated in export). The GLTFExporter already handles this (line 459): `[x, -y, -z]`. Our runtime JSON loader must do the same negation.

Model scale: the Hunlef's vertex positions span roughly [-117, 116] on X and Z, and [0, -400] on Y (before negation). At the 5-tile boss size, the scale factor to map model units to tile units needs to be calibrated so the model fills its 5x5 tile footprint.

### GLTF Morph Target Memory

Each morph target stores vertex position deltas (3 floats per vertex). For the Hunlef:
- 2,180 base vertices (after dedup, ~3,500)
- ~170 total animation frames across all sequences
- Memory: 3,500 * 3 * 4 bytes * 170 = ~7.1 MB

This is well within browser memory budgets. The GLTF file itself will be larger due to base64 encoding (~9.5 MB), but loads once and stays in GPU memory.

### Three.js Bundle Size

Three.js core is ~150KB gzipped. We need:
- `three` (core: Scene, WebGLRenderer, PerspectiveCamera, BufferGeometry, materials, lights)
- `three/addons/loaders/GLTFLoader` (GLTF loading)
- `three/addons/renderers/CSS2DRenderer` (overlay rendering)

Tree-shaking with the bundler should keep the final bundle addition under 120KB gzipped.

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all 155 existing tests (game logic untouched)
- [ ] GLTF extraction script runs and produces valid `hunlef.gltf`
- [ ] Three.js renders a 3D 12x12 tile arena with grid lines
- [ ] Corrupted Hunlef model displays with correct OSRS vertex colors (reddish/dark corrupted palette)
- [ ] Hunlef plays idle animation when standing
- [ ] Hunlef plays attack animation on magic/ranged attacks
- [ ] OSRS-style camera: ~55 degree pitch, rotatable with mouse drag
- [ ] Camera zoom with scroll wheel
- [ ] Player rendered as a simple 3D shape at correct tile position
- [ ] Player position interpolates smoothly between ticks (existing rAF loop)
- [ ] Projectiles render as 3D objects with arc trajectory
- [ ] Overhead prayer icons visible above player and boss
- [ ] Hit splats display with damage numbers near entities
- [ ] Countdown overlay functional
- [ ] Boss style indicated visually (color glow or ground ring)
- [ ] Consistent 60fps on a modern laptop
- [ ] Old 2D Renderer preserved (not deleted)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GLTF export fails (cache frame loading) | Medium | High | Test `addSequence` on a single animation first. Fall back to static model (no animation) if frame extraction fails. The model itself renders fine without animations. |
| HSL color conversion produces wrong colors | Medium | Medium | Compare our runtime conversion output against the GLTFExporter's color palette PNG pixel-by-pixel. The reference implementation is known-correct. |
| Model orientation/scale wrong | High | Low | Iterative visual tuning. Start with a simple axes helper to verify coordinate system. Scale factor is just a constant to adjust. |
| Three.js bundle bloats build size | Low | Low | Tree-shaking handles this. Three.js is well-structured for it. Worst case ~150KB gzipped is acceptable. |
| Camera rotation conflicts with click-to-move | Medium | Medium | Use right-click drag or middle-click for camera rotation. Left-click stays for tile clicking. |
| Morph target GLTF too large | Low | Low | 7-10MB is fine for a single-page app. Could compress with Draco if needed, but unnecessary at this scale. |
| CSS2DRenderer overlay z-ordering | Medium | Low | CSS2D objects naturally layer over WebGL. Adjust CSS z-index if needed. |
| Animation timing mismatch with game ticks | Medium | Medium | GLTF frame timing is in seconds (ticks / 50). Game ticks are 600ms. Animation playback is cosmetic-only — game logic is not affected by animation state. |

---

## Dependencies

- **Runtime**: `three` (~150KB gzipped) — first and only runtime dependency
- **Dev**: `@types/three` — TypeScript type definitions
- **Build tool**: osrscachereader (already in tools/cache-reader) — used offline for GLTF extraction
