# Sprint 007 Draft: 3D Rendering — Three.js, OSRS Models, Animated Hunlef

**Author perspective:** Engine architecture specialist

---

## Overview

This sprint replaces the 2D canvas renderer with a Three.js-powered 3D scene while preserving the strict separation between game simulation and rendering. The existing architecture already enforces this boundary: `GameSimulation` owns all game state and tick logic, `Renderer` reads that state and draws it. The 3D transition does not cross that boundary. `GameSimulation` will never import Three.js. The renderer becomes the only consumer of the Three.js dependency, and it continues to receive the same `GameSimulation` reference it always has.

The harder architectural problem is the animation pipeline. OSRS models are not rigged with skeletal bones in the conventional sense. The cache stores per-frame vertex positions as deltas applied to a base mesh. The `GLTFExporter` in osrscachereader already handles this: it produces GLTF files with morph targets (one per animation frame) and uses `STEP` interpolation on the morph target weights to flip between frames at the correct timing. Three.js's `AnimationMixer` can play these morph-target animations natively. The challenge is bridging OSRS's discrete tick-based animation triggers (the simulation says "the boss attacked this tick") with Three.js's continuous time-based `AnimationMixer.update(deltaSeconds)`.

This draft lays out the full pipeline from cache bytes to rendered pixels, the abstraction layer between simulation and renderer, the synchronization strategy, and the incremental migration path.

---

## Architecture

### End-to-End Animation Pipeline

The pipeline has two stages: a build-time extraction step and a runtime loading/playback step.

```
BUILD TIME (runs once, outputs committed to repo)
=================================================

  OSRS Cache (OpenRS2, version 232)
       |
       v
  osrscachereader (RSCache)
       |
       |-- getAllDefs(CONFIGS, SEQUENCE) --> seq_8417.json, seq_8430.json, ...
       |      Each contains: frameIDs[], frameLengths[], frameSounds[]
       |      frameIDs encode: (skeletonGroupId << 16) | (frameIndex + 1)
       |
       |-- getAllFiles(MODELS, modelId) --> model_38595.json (raw vertex/face data)
       |
       |-- modelDef.loadSkeletonAnims(cache, modelDef, skeletonGroupId)
       |      Returns per-frame vertex positions (absolute, not delta)
       |
       v
  GLTFExporter (osrscachereader/src/cacheReader/exporters/GLTFExporter.js)
       |
       |-- constructor(modelDef):
       |      Splits faces into opaque/alpha sets
       |      Deduplicates vertices by (position, color) pairs
       |      Builds remappedVertices lookup
       |
       |-- addSequence(cache, sequenceDef):
       |      For each unique skeletonGroupId in frameIDs:
       |        loadSkeletonAnims --> array of frame vertex positions
       |        addMorphTarget() for each frame (stores delta from base mesh)
       |      addAnimation(morphTargetIndices, cumulativeLengths)
       |        Lengths converted: frameLengths in game ticks --> seconds (÷50)
       |        STEP interpolation (discrete frame snapping, no blending)
       |
       |-- addColors():
       |      HSLtoRGB(faceColor, brightness=0.6) for each unique face color
       |      Creates a 1D color palette PNG texture
       |      Maps each vertex to a UV pointing at its palette entry
       |
       |-- export() --> JSON string of complete .gltf
       |
       v
  Output: hunlef.gltf (or .glb)
       Contains: base mesh, N morph targets, M named animations,
                 color palette texture, UV coordinates
       Each animation uses STEP interpolation on morph weights
       Frame timing matches OSRS tick system (frameLengths / 50 = seconds)


RUNTIME (browser, on every fight start)
========================================

  hunlef.gltf (loaded from /assets/models/)
       |
       v
  Three.js GLTFLoader.load()
       |
       |-- Parses buffers, creates BufferGeometry with morph attributes
       |-- Creates MeshStandardMaterial from color palette texture
       |-- Creates AnimationClip[] from animation samplers
       |
       v
  Three.js scene graph:
       Scene
         |-- AmbientLight
         |-- DirectionalLight
         |-- Floor (PlaneGeometry 12x12 tiles)
         |-- BossGroup (Group)
         |     |-- HunlefMesh (Mesh with morph targets)
         |     |-- OverheadSprite (Sprite, prayer icon)
         |-- PlayerGroup (Group)
         |     |-- PlayerMesh (simple geometry or future model)
         |     |-- OverheadSprite (Sprite, prayer icon)
         |-- ProjectileGroup (Group)
         |     |-- [dynamic Mesh children per active projectile]
         |-- HitSplatGroup (Group via CSS2DRenderer)
               |-- [dynamic CSS2D overlays]
       |
       v
  AnimationMixer (one per animated entity)
       |-- mixer.clipAction(idleClip).play()    // default state
       |-- mixer.clipAction(attackClip).play()   // triggered by simulation
       |-- mixer.update(deltaSeconds)            // called every rAF frame
```

### The frameID Encoding

The `frameIDs` in sequence definitions like `seq_8430.json` use a packed format:

```
frameID = (skeletonGroupId << 16) | (frameIndexWithinGroup + 1)

Example: frameID 153223169
  skeletonGroupId = 153223169 >> 16 = 2338
  frameIndex      = (153223169 & 0xFFFF) - 1 = 0
```

The `GLTFExporter.addSequence()` method decodes this to load the correct skeleton animation group and map each frame to its morph target index. Multiple sequences can share skeleton groups (e.g., idle and walk may use the same bone group with different frame subsets).

### frameLengths: OSRS Ticks to Seconds

OSRS frame lengths are in "client ticks" of 20ms each (50 per second), distinct from the 600ms game ticks. The `GLTFExporter` converts these to seconds by dividing by 50 and accumulating:

```
seq_8430 (magic attack): frameLengths = [5, 5, 4, 4, 4, 4, 4, 5, 5, 4, 4, 4, 4, 4]
  Total client ticks: 60
  Total duration: 60 / 50 = 1.2 seconds (2 game ticks)
  Cumulative times: [0.10, 0.20, 0.28, 0.36, 0.44, 0.52, 0.60, 0.70, 0.80, 0.88, 0.96, 1.04, 1.12, 1.20]
```

These cumulative times become the keyframe timestamps in the GLTF animation. Three.js's `AnimationMixer` will advance through them based on wall-clock delta time, producing smooth per-frame playback at the correct OSRS cadence regardless of the browser's refresh rate.

---

### Simulation-Renderer Abstraction

The current boundary is clean and must stay clean:

```
GameSimulation                          Renderer
==============                          ========
  boss.pos: Position                      reads sim.boss.pos
  boss.currentStyle: AttackStyle          reads sim.boss.currentStyle
  boss.protectionStyle: ProtectionStyle   reads sim.boss.protectionStyle
  boss.hp / maxHp                         reads sim.boss.hp
  player.pos / prevPos                    reads sim.player.pos, prevPos
  player.attackTarget                     reads sim.player.attackTarget
  prayerManager.activePrayer              reads sim.prayerManager.activePrayer
  hitSplats: HitSplat[]                   reads sim.hitSplats
  projectiles: Projectile[]              reads sim.projectiles
  state: GameState                        reads sim.state
  tick: number                            reads sim.tick
  countdownTicks: number                  reads sim.countdownTicks
```

The 3D renderer reads exactly the same fields. No new fields are needed on `GameSimulation`. The renderer infers animation state from the simulation state it already has:

| Simulation state | Inferred animation |
|---|---|
| `boss.attackCooldown === boss.attackSpeed` (just fired) | Play attack animation (magic or ranged based on `lastBossAttackStyle`) |
| `boss.hp <= 0` | Play death animation |
| `boss.pos` changed from previous frame | Play walk animation |
| None of the above | Play idle animation |

This inference happens inside the renderer (or a thin `AnimationController` helper owned by the renderer). The simulation never says "play animation X." It only says "I attacked" or "I moved" through its existing state fields.

To make the "just attacked" inference reliable, the renderer needs one additional readable field that already exists: `sim.lastBossAttackStyle`. This was added in Sprint 5 for projectile rendering and tells the renderer which attack animation to trigger.

### New Concept: RenderState Snapshot

Rather than having the renderer reach deep into `GameSimulation` on every frame, introduce a lightweight snapshot type:

```typescript
// src/render/RenderState.ts — pure data, no Three.js imports
export interface EntityRenderState {
  id: string;
  pos: { x: number; y: number };
  prevPos: { x: number; y: number };
  size: number;
  animationHint: 'idle' | 'walk' | 'attack_magic' | 'attack_ranged' | 'attack_stomp' | 'death' | 'style_switch';
}

export interface RenderState {
  tick: number;
  gameState: 'countdown' | 'running' | 'won' | 'lost';
  countdownTicks: number;
  boss: EntityRenderState & {
    hp: number;
    maxHp: number;
    currentStyle: 'ranged' | 'magic';
    protectionStyle: 'melee' | 'magic' | 'ranged';
  };
  player: EntityRenderState & {
    hp: number;
    maxHp: number;
    activePrayer: string | null;
    attackTarget: 'boss' | null;
    targetTile: { x: number; y: number } | null;
  };
  projectiles: ProjectileRenderData[];
  hitSplats: HitSplatRenderData[];
}
```

A function `extractRenderState(sim: GameSimulation): RenderState` lives in the render module and produces this snapshot each tick. The `animationHint` field is computed here by comparing the current tick's state against the previous snapshot. This keeps animation inference logic out of both the simulation and the Three.js renderer.

The renderer then consumes `RenderState` instead of `GameSimulation` directly. This makes the renderer fully testable without a simulation instance and provides a natural seam for the 2D/3D toggle.

---

### Tick-to-Animation Synchronization

This is the central architectural challenge. The game simulation advances in discrete 600ms ticks. Three.js animations advance in continuous wall-clock time. They must agree.

**The timing model:**

```
Game ticks:    |---600ms---|---600ms---|---600ms---|
               T=0         T=1         T=2         T=3

rAF frames:   .|..|..|..|..|..|..|..|..|..|..|..|..
               ~16ms each at 60fps (~10 frames per tick)

AnimationMixer: accumulates deltaTime from rAF
                plays morph target keyframes at their authored timestamps
```

**The synchronization strategy: event-driven triggers with free-running playback.**

1. On each game tick, `extractRenderState()` computes the `animationHint` for each entity.
2. If the hint changed from the previous tick (e.g., `idle` -> `attack_magic`), the renderer triggers a transition on the `AnimationMixer`:
   - `currentAction.fadeOut(0.05)` (brief crossfade, ~1 frame)
   - `newAction.reset().fadeIn(0.05).play()`
3. Between ticks, the rAF loop calls `mixer.update(deltaSeconds)` using real wall-clock time. The morph target animation plays at its authored OSRS frame rate (50 client ticks/second), independent of the game tick rate.
4. Position interpolation works the same as today: `lerp(prevPos, pos, tickProgress)` where `tickProgress = elapsed / 600`.

**Why this works:** OSRS animation frame timing is authored in client ticks (20ms), not game ticks (600ms). An attack animation spanning 1.2 seconds (60 client ticks) plays across exactly 2 game ticks. The `AnimationMixer` handles the sub-tick frame progression naturally because it operates on wall-clock time.

**Edge case: animation duration vs. game tick boundaries.** The magic attack animation (seq_8430) is 1.2 seconds. The boss attack cooldown is 5 game ticks (3.0 seconds). So the attack animation finishes well before the next attack, and the mixer transitions back to idle. If an animation were longer than the cooldown, it would be interrupted by the next trigger -- which is correct behavior (matches OSRS).

**Implementation detail: AnimationController class.**

```typescript
// src/render/AnimationController.ts — owned by the 3D renderer
export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private actions: Map<string, THREE.AnimationAction>;
  private currentHint: string = 'idle';

  constructor(mesh: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(mesh);
    this.actions = new Map();
    for (const clip of clips) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    // Start idle
    this.actions.get('idle')?.play();
  }

  /** Called once per game tick with the new animation hint */
  onTick(hint: string): void {
    if (hint === this.currentHint) return;
    const prev = this.actions.get(this.currentHint);
    const next = this.actions.get(hint);
    if (prev) prev.fadeOut(0.05);
    if (next) {
      next.reset().fadeIn(0.05).play();
      // Non-looping animations (attack, death) play once
      if (hint !== 'idle' && hint !== 'walk') {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      }
    }
    this.currentHint = hint;
  }

  /** Called every rAF frame */
  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }
}
```

---

### Scene Graph Structure

The Three.js scene graph maps directly to the entity model:

```
THREE.Scene
  |
  |-- THREE.AmbientLight (intensity: 0.7)
  |     Purpose: flat base illumination matching OSRS's minimal shading
  |
  |-- THREE.DirectionalLight (intensity: 0.5, position: [1, 2, -1])
  |     Purpose: slight directional shadow to give models depth
  |
  |-- floorGroup: THREE.Group
  |     |-- floorMesh: THREE.Mesh(PlaneGeometry(12, 12), floorMaterial)
  |           Material: dark red/brown (#1a0a0a) MeshStandardMaterial
  |           Subdivided into 12x12 grid via geometry or line overlay
  |           Position: centered at world origin, rotated to XZ plane
  |
  |-- entityGroup: THREE.Group
  |     |
  |     |-- bossNode: THREE.Group
  |     |     Position: maps from boss.pos (tile coords -> world coords)
  |     |     Scale: calibrated so 5-tile boss fills 5 world units
  |     |     |-- hunlefMesh: THREE.Mesh (from GLTF, with morph targets)
  |     |     |-- bossOverhead: THREE.Sprite (prayer icon texture)
  |     |     |     Position: offset above model top
  |     |     |-- bossLabel: CSS2DObject ("Hunlef 1000/1000")
  |     |
  |     |-- playerNode: THREE.Group
  |           Position: interpolated from player.prevPos -> player.pos
  |           |-- playerMesh: THREE.Mesh (BoxGeometry placeholder or model)
  |           |-- playerOverhead: THREE.Sprite (prayer icon)
  |           |-- targetIndicator: THREE.LineLoop (dashed square on floor)
  |
  |-- projectileGroup: THREE.Group
  |     |-- [dynamically added/removed Mesh children]
  |           Each projectile: small geometry (diamond, sphere, etc.)
  |           Position interpolated per rAF frame based on travel progress
  |
  |-- overlayGroup: THREE.Group (rendered by CSS2DRenderer)
        |-- [hit splat DOM elements positioned in 3D space]
        |-- [countdown overlay as fullscreen CSS]
```

**Tile coordinate to world coordinate mapping:**

```typescript
// 1 tile = 1 world unit. Origin at floor center.
function tileToWorld(tileX: number, tileY: number): THREE.Vector3 {
  return new THREE.Vector3(
    tileX - 6 + 0.5,   // center tiles around origin
    0,                   // ground plane
    tileY - 6 + 0.5    // OSRS Y maps to Three.js Z
  );
}
```

The boss at tile position (4, 4) with size 5 has its center at tile (6, 6), which maps to world (0.5, 0, 0.5) -- roughly centered in the arena.

---

### Incremental Migration: 2D Fallback Alongside 3D

The migration must be incremental. The 2D renderer is the known-working baseline. The 3D renderer is built alongside it, not as a replacement from day one.

**Strategy: RenderBackend interface.**

```typescript
// src/render/RenderBackend.ts
export interface RenderBackend {
  /** Called once when a fight starts, sets up the scene */
  init(canvas: HTMLCanvasElement): void;

  /** Called once per game tick with the new render state */
  onTick(state: RenderState): void;

  /** Called every rAF frame for smooth interpolation */
  onFrame(tickProgress: number, deltaSeconds: number): void;

  /** Tear down resources (dispose geometries, textures) */
  dispose(): void;
}
```

Both `Canvas2DBackend` (wrapping the existing `Renderer`) and `ThreeJSBackend` implement this interface. `main.ts` picks the backend based on a URL parameter or toggle:

```typescript
const use3D = new URLSearchParams(location.search).has('3d');
const backend: RenderBackend = use3D
  ? new ThreeJSBackend()
  : new Canvas2DBackend();
```

This means the 2D renderer stays functional throughout development. The `?3d` flag enables the Three.js path. When the 3D renderer reaches parity, the 2D backend can be removed.

**Canvas stacking:** Both backends render to the same `<canvas>` element. The 2D backend uses `canvas.getContext('2d')`. The 3D backend uses `new THREE.WebGLRenderer({ canvas })`. Only one is active at a time -- they are not overlaid.

**CSS2DRenderer for overlays:** Hit splats and text labels use `CSS2DRenderer`, which creates a separate overlay `<div>` that sits on top of the WebGL canvas. This is cleaner than rendering text into WebGL and provides sharp text at any resolution.

---

### Camera System

OSRS uses an approximately isometric perspective with a ~50-60 degree pitch angle. The camera orbits the arena center.

```typescript
// src/render/CameraController.ts
export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private azimuth: number = 0;         // horizontal rotation (radians)
  private pitch: number = Math.PI / 3; // ~60 degrees from horizontal
  private distance: number = 16;       // distance from arena center
  private target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.updatePosition();
  }

  /** Rotate camera by delta (mouse drag or arrow keys) */
  rotate(deltaAzimuth: number): void {
    this.azimuth += deltaAzimuth;
    this.updatePosition();
  }

  private updatePosition(): void {
    const x = this.distance * Math.sin(this.azimuth) * Math.cos(this.pitch);
    const y = this.distance * Math.sin(this.pitch);
    const z = this.distance * Math.cos(this.azimuth) * Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + x,
      this.target.y + y,
      this.target.z + z
    );
    this.camera.lookAt(this.target);
  }
}
```

The pitch is fixed (not user-adjustable) to match OSRS convention. Only azimuth rotation is exposed via mouse drag or left/right arrow keys. This reuses the existing `InputManager` infrastructure -- arrow key handlers call `cameraController.rotate()` instead of (or in addition to) their current behavior.

---

### Build-Time GLTF Export Script

A new build script creates the GLTF assets from the existing extracted JSON data:

```
tools/cache-reader/export-gltf.mjs

Input:
  - docs/assets/models/model_38595.json (Hunlef mesh data)
  - docs/assets/defs/sequences/seq_8417.json (idle)
  - docs/assets/defs/sequences/seq_8430.json (magic attack)
  - ... (all animation sequences)
  - OSRS cache (via osrscachereader) for skeleton frame data

Output:
  - docs/assets/gltf/hunlef.gltf
      Base mesh with OSRS-accurate vertex colors
      Morph targets for all animation frames
      Named animations: "idle", "walk", "attack_magic", "attack_ranged",
                        "stomp", "prayer_disable", "death",
                        "switch_to_mage", "switch_to_range"
```

The script:
1. Loads the OSRS cache via `new RSCache(232)`
2. Loads the model definition for model 38595 (Hunlef)
3. Creates a `GLTFExporter(modelDef)`
4. For each animation sequence, calls `exporter.addSequence(cache, seqDef)` -- this triggers `loadSkeletonAnims` internally to fetch the frame vertex data from the cache
5. Calls `exporter.addColors()` to build the OSRS HSL-to-RGB color palette texture
6. Calls `exporter.export()` to produce the GLTF JSON
7. Writes the output to `docs/assets/gltf/`

The critical dependency is that `loadSkeletonAnims` requires access to the raw cache data (archive 0, ANIMATIONS index). The model JSON files we have do not contain animation frame data -- they contain only the base mesh geometry. The animation frames must be loaded from the cache at export time.

**Animation name mapping:**

| Sequence ID | Name in GLTF | Usage |
|---|---|---|
| 8417 | `idle` | Default standing animation |
| 8416 | `walk` | Boss walking (currently unused, boss is stationary) |
| 8430 | `attack_magic` | Boss magic attack (14 frames, 1.2s) |
| 8431 | `attack_ranged` | Boss ranged attack |
| 8432 | `attack_stomp` | Boss stomp attack |
| 8433 | `prayer_disable` | Boss disabling player prayer |
| 8436 | `death` | Boss death animation |
| 8754 | `switch_to_mage` | Style switch to mage |
| 8755 | `switch_to_range` | Style switch to range |

---

## Use Cases

1. **Fight starts** -- Three.js scene initializes. GLTF model loaded via `GLTFLoader`. Hunlef mesh placed at boss tile position. Idle animation begins playing. 12x12 floor grid rendered. Player shown as a teal box (matching current color). Camera at ~60 degree pitch.

2. **Boss attacks (magic)** -- `extractRenderState()` detects `lastBossAttackStyle === 'magic'` on the tick the boss fires. `animationHint` becomes `'attack_magic'`. `AnimationController.onTick()` crossfades from idle to the magic attack clip. The 14-frame morph target animation plays over 1.2 seconds while the rAF loop continues advancing `mixer.update(dt)`.

3. **Player moves** -- Simulation sets `player.pos` and `player.prevPos`. The rAF loop interpolates `playerNode.position` between the two using `tickProgress`. Identical behavior to the current 2D lerp, but in 3D world coordinates.

4. **Projectile travels** -- Projectile created in `sim.projectiles[]`. Renderer creates a small 3D mesh (diamond for ranged spike, sphere for magic orb) and adds it to `projectileGroup`. Each rAF frame, the mesh position is interpolated along the travel path. On arrival tick, the mesh is removed.

5. **Camera rotation** -- User drags mouse or presses arrow keys. `CameraController.rotate()` adjusts the azimuth. Camera orbits the arena center. All entity positions remain in tile-to-world coordinates, unaffected by camera angle.

6. **Overhead prayer icons** -- `THREE.Sprite` objects using the existing prayer icon PNGs as textures. Positioned above each entity's 3D model. Billboard behavior (always faces camera) is built into `THREE.Sprite`.

7. **Hit splats** -- `CSS2DObject` elements rendered by `CSS2DRenderer`. Positioned at the entity's world coordinates. Styled with the same red/blue circles and white text as the current 2D renderer. Float upward and fade out over 2 ticks.

8. **2D fallback** -- User opens the app without `?3d`. The existing 2D `Renderer` runs as before. All 155 tests pass because they never touch the renderer.

---

## Implementation

### Phase 1: GLTF Export Script

Build the pipeline that produces animated GLTF files from the cache.

| File | Action | Description |
|---|---|---|
| `tools/cache-reader/export-gltf.mjs` | Create | New script that loads cache, creates GLTFExporter for Hunlef model (38595), calls `addSequence()` for all 9 animation sequences, calls `addColors()`, writes GLTF output to `docs/assets/gltf/hunlef.gltf`. Maps sequence IDs to human-readable animation names. |
| `docs/assets/gltf/` | Create (dir) | Output directory for generated GLTF files. |

### Phase 2: RenderState Abstraction

Introduce the data-only interface between simulation and rendering.

| File | Action | Description |
|---|---|---|
| `src/render/RenderState.ts` | Create | Define `RenderState`, `EntityRenderState`, `ProjectileRenderData`, `HitSplatRenderData` interfaces. Implement `extractRenderState(sim: GameSimulation): RenderState` function that reads simulation fields and computes `animationHint` for each entity by diffing against previous state. |
| `src/render/RenderBackend.ts` | Create | Define `RenderBackend` interface with `init()`, `onTick()`, `onFrame()`, `dispose()` methods. |

### Phase 3: Wrap Existing 2D Renderer as Canvas2DBackend

Preserve the current renderer behind the new interface.

| File | Action | Description |
|---|---|---|
| `src/render/Canvas2DBackend.ts` | Create | Wraps the existing `Renderer` class. `init()` creates the `Renderer`. `onTick()` is a no-op (2D renderer reads state directly). `onFrame()` calls `renderer.draw(sim, tickProgress)`. `dispose()` is a no-op. Accepts `GameSimulation` in constructor since the existing renderer reads `sim` directly. |
| `src/render/Renderer.ts` | Modify | No functional changes. Optionally refactor `draw()` to accept `RenderState` instead of `GameSimulation` for cleaner decoupling, but this can be deferred. |

### Phase 4: Three.js Scene Setup

Build the 3D scene graph with static elements.

| File | Action | Description |
|---|---|---|
| `src/render/ThreeJSBackend.ts` | Create | Implements `RenderBackend`. `init()` creates `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `AmbientLight`, `DirectionalLight`, floor mesh (12x12 PlaneGeometry, dark red/brown material, subdivided grid lines as `LineSegments`). Creates empty groups: `entityGroup`, `projectileGroup`, `overlayGroup`. Sets up `CSS2DRenderer` for text overlays. |
| `src/render/CameraController.ts` | Create | Manages camera position. Fixed ~60 degree pitch, configurable azimuth. Methods: `rotate(delta)`, `getCamera()`. |
| `package.json` | Modify | Add `three` as a runtime dependency (~118KB gzipped). Add `@types/three` as a dev dependency. |

### Phase 5: Model Loading and Animation

Load the GLTF model and wire up animation control.

| File | Action | Description |
|---|---|---|
| `src/render/ModelLoader.ts` | Create | Wraps `THREE.GLTFLoader`. `loadHunlef(): Promise<{ mesh, clips }>` loads `hunlef.gltf`, returns the mesh and animation clips. Handles scale calibration (OSRS model units to world units: the model vertex coordinates are small integers, need scaling factor so the 5-tile boss fills 5 world units). |
| `src/render/AnimationController.ts` | Create | Owns an `AnimationMixer` for one entity. Methods: `onTick(hint: string)` triggers animation transitions with crossfade. `update(deltaSeconds)` advances the mixer. Handles looping vs. one-shot (idle/walk loop, attack/death play once then return to idle via `'finished'` event). |
| `src/render/ThreeJSBackend.ts` | Modify | `init()` now awaits `ModelLoader.loadHunlef()`, creates `bossNode` with the mesh, creates `AnimationController` with the clips. `onTick()` calls `animController.onTick(state.boss.animationHint)`. `onFrame()` calls `animController.update(dt)`, updates entity positions, updates projectile positions, calls `renderer.render(scene, camera)`. |

### Phase 6: Entity Rendering

Map simulation entities to scene graph nodes.

| File | Action | Description |
|---|---|---|
| `src/render/ThreeJSBackend.ts` | Modify | `onTick()` updates boss node position from `state.boss.pos` (tile-to-world), updates overhead sprite texture based on `state.boss.protectionStyle`, updates boss style border (via emissive color on material or outline pass). Creates/removes projectile meshes from `projectileGroup` based on `state.projectiles`. Creates/removes CSS2D hit splat elements from `overlayGroup` based on `state.hitSplats`. `onFrame()` interpolates player position (`lerp(prevPos, pos, tickProgress)` in world coords), interpolates projectile positions along travel paths. |
| `src/render/ThreeJSBackend.ts` | Modify | Player rendered as a BoxGeometry (teal, ~0.8x0.8x1.2 world units) matching the current 2D cyan square. Target tile indicator as a LineLoop on the floor plane. |

### Phase 7: Overlay Rendering

Hit splats, countdown, fight text, labels.

| File | Action | Description |
|---|---|---|
| `src/render/ThreeJSBackend.ts` | Modify | Hit splats as `CSS2DObject`: red/blue circle background, white damage text. Positioned at entity world position, offset upward per age. Alpha decreases over 2 ticks. Countdown overlay as a fullscreen CSS element (same DOM approach as currently exists). "FIGHT!" text as CSS overlay. Boss HP label as CSS2DObject below overhead icon. |

### Phase 8: Camera Input and Backend Selection

Wire up camera controls and the 2D/3D toggle in main.ts.

| File | Action | Description |
|---|---|---|
| `src/input/InputManager.ts` | Modify | Add camera rotation bindings: left/right arrow keys (or mouse drag on canvas) call `cameraController.rotate()`. These bindings only activate when the 3D backend is in use. The `InputManager` receives an optional `CameraController` reference. |
| `src/main.ts` | Modify | Import `Canvas2DBackend` and `ThreeJSBackend`. Check for `?3d` URL param. Create the appropriate backend. Replace the direct `Renderer` instantiation with `backend.init(canvas)`. In the rAF loop, replace `renderer.draw(sim, tickProgress)` with `backend.onFrame(tickProgress, deltaSeconds)`. On tick, call `backend.onTick(extractRenderState(sim))`. On fight end, call `backend.dispose()`. |

---

## Files Summary

| File | Action | Phase |
|---|---|---|
| `tools/cache-reader/export-gltf.mjs` | Create | 1 |
| `docs/assets/gltf/hunlef.gltf` | Create (generated) | 1 |
| `src/render/RenderState.ts` | Create | 2 |
| `src/render/RenderBackend.ts` | Create | 2 |
| `src/render/Canvas2DBackend.ts` | Create | 3 |
| `src/render/ThreeJSBackend.ts` | Create | 4, 5, 6, 7 |
| `src/render/CameraController.ts` | Create | 4 |
| `src/render/ModelLoader.ts` | Create | 5 |
| `src/render/AnimationController.ts` | Create | 5 |
| `src/input/InputManager.ts` | Modify | 8 |
| `src/main.ts` | Modify | 8 |
| `src/render/Renderer.ts` | Modify (optional) | 3 |
| `package.json` | Modify | 4 |

**Modified files:** 3 | **New files:** 8 (+ 1 generated asset + 1 directory)

---

## Definition of Done

1. **GLTF export script runs successfully** -- `node tools/cache-reader/export-gltf.mjs` produces `docs/assets/gltf/hunlef.gltf` with the base mesh, morph targets for all animation frames, and 9 named animation clips.
2. **GLTF colors match OSRS** -- The color palette texture uses the same `HSLtoRGB()` conversion as the existing GLTFExporter with `brightness = 0.6`. Visual comparison against an OSRS screenshot shows correct Hunlef coloring.
3. **3D scene renders** -- With `?3d` URL parameter, the Three.js WebGLRenderer displays a 12x12 tile floor with the Hunlef model centered.
4. **Idle animation plays** -- The Hunlef model loops its idle animation (seq_8417, 14 frames) continuously while standing. Morph targets animate at the correct frame rate.
5. **Attack animations trigger** -- When the boss fires a magic attack, the magic attack animation (seq_8430) plays. When the boss fires a ranged attack, the ranged attack animation (seq_8431) plays. After the animation completes, the model returns to idle.
6. **Camera angle is OSRS-style** -- Camera views the arena from approximately 60 degrees above horizontal.
7. **Camera rotates** -- Mouse drag or arrow keys rotate the camera around the arena center.
8. **Player renders in 3D** -- A teal box (or simple geometry) represents the player, interpolated smoothly between ticks.
9. **Projectiles render in 3D** -- Boss ranged (green diamond) and magic (purple sphere) projectiles travel from boss to player in 3D space. Player projectiles travel from player to boss.
10. **Overhead prayer icons display** -- Sprite objects float above both boss and player, showing the correct prayer icon.
11. **Hit splats visible** -- CSS2D overlays show red/blue damage circles with white text at entity positions.
12. **2D renderer still works** -- Without `?3d`, the existing 2D canvas renderer runs exactly as before.
13. **All 155 tests pass** -- No regressions. Tests do not import Three.js or touch the renderer.
14. **Three.js is the only new runtime dependency** -- No other packages added.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `loadSkeletonAnims` fails for Hunlef model because the method requires specific cache archive access patterns | High | Test the GLTF export script early as a standalone step (Phase 1). If `loadSkeletonAnims` does not work for Hunlef's skeleton groups, fall back to building morph targets from the raw model JSON (compute frame deltas manually). The `addMorphTarget()` method accepts arbitrary vertex arrays. |
| OSRS model scale/orientation does not match the 3D scene coordinate system | Medium | OSRS models use integer vertex coordinates with Y-up and Z-into-screen. The GLTFExporter already flips Y and Z: `dest.push([x, -y, -z])`. At runtime, calibrate a uniform scale factor so the boss mesh spans ~5 world units. This is a single constant that may need manual tuning. |
| Morph target animation looks wrong (vertices pop, faces invert) | Medium | Morph targets encode deltas from the base mesh. If the base mesh has a different vertex order than the animation frames, deltas will be wrong. The GLTFExporter's `remappedVertices` handles the vertex deduplication mapping. Verify by loading the GLTF in a standalone Three.js viewer before integrating into the app. |
| Three.js bundle size increases load time | Low | Three.js is ~118KB gzipped. The GLTF model with morph targets will add more (estimated 200-500KB for Hunlef with all animation frames). Use code splitting to lazy-load Three.js only when `?3d` is active. The 2D path has zero additional bundle cost. |
| CSS2DRenderer performance with many hit splats | Low | At most ~5 hit splats are active simultaneously (2-tick lifetime, 1 boss + 1 player attack per tick). CSS2D is efficient for this volume. If performance issues appear, switch to `THREE.Sprite` with canvas-rendered textures. |
| AnimationMixer drift relative to game tick timing | Low | The mixer uses wall-clock delta time, which is independent of the 600ms tick interval. Since animation triggers are event-driven (fired on tick), not time-driven, there is no drift. The only visual artifact would be an animation finishing slightly before or after a tick boundary, which is imperceptible at 60fps. |
| Scope is too large for one sprint | High | Phase 1 (GLTF export) and Phase 2-3 (abstraction layer + 2D backend wrapper) are independently valuable and testable. If the 3D renderer (Phases 4-7) is not complete, the abstraction layer still improves the codebase, and the GLTF asset is ready for the next sprint. Prioritize: export script first, then static scene, then animation, then polish. |

---

## Future Considerations

**Tornado 3D models.** Tornados (NPC 9039, model 42728) are entities with per-tick position updates that chase the player. In the 3D scene, they would be additional nodes in `entityGroup` with their own `AnimationController` (the tornado has its own idle/move sequences). The `RenderState` would gain a `tornados: EntityRenderState[]` array. No changes to the `RenderBackend` interface needed -- `onTick()` already receives the full state.

**Floor tile effects.** Corrupted floor tiles (object 36048) are textured quads on the ground plane. In the scene graph, they would be children of `floorGroup`, added/removed per tick based on simulation state. The tile geometry can be a simple subdivided quad with the corrupted texture applied, positioned at the correct tile coordinates.

**Particle systems.** OSRS projectile impacts, prayer switches, and style changes have particle effects. Three.js has no built-in particle system, but `THREE.Points` with a custom `ShaderMaterial` can produce simple sprite-based particles. This is a purely visual enhancement with no simulation impact. The `RenderState.animationHint` system provides the trigger points (e.g., `'attack_magic'` hint triggers a particle burst at the boss position).

**Sound.** The sound effects extracted in Phase 2 (`docs/assets/sounds/`) are in OSRS synth format, not playable WAV/MP3. A future sprint would need a synth decoder or replacement sound files. Sound triggers would follow the same pattern as animation triggers: driven by `RenderState` changes, with no simulation coupling.

---

## Dependencies

- **Sprint 6 complete** -- 155 tests, rAF render loop with `tickProgress` interpolation, projectile system.
- **osrscachereader** -- Already installed at `tools/cache-reader/node_modules/osrscachereader`. The GLTFExporter at `src/cacheReader/exporters/GLTFExporter.js` is the core of the build pipeline.
- **OSRS cache data** -- The export script requires cache access via `new RSCache(232)`. This downloads from OpenRS2 on first run.
- **Three.js** -- New runtime dependency. Version `^0.170.0` or latest stable. Only import: `three` and `three/addons/loaders/GLTFLoader` and `three/addons/renderers/CSS2DRenderer`.

---

## Open Questions

1. **Should the GLTF be committed to the repo or generated at build time?** The GLTF file with all morph targets may be 200KB-1MB. Committing it avoids requiring cache access for contributors. Generating it keeps the repo lean but adds a build dependency. Recommendation: commit the generated GLTF. It is a build artifact derived from cache data, analogous to the model JSON files already committed.

2. **Should the player model be extracted in this sprint?** The player appearance depends on equipped armor tier, which varies per run. Options: (a) single generic player model, (b) multiple armor variant models, (c) keep the teal box for now. Recommendation: teal box for this sprint. Player model extraction is a separate effort.

3. **Should projectile models use the extracted OSRS models (40670, 40673) or remain as simple 3D shapes?** The extracted models exist but would need their own GLTF export and may be overkill for small fast-moving objects. Recommendation: simple Three.js geometries (ConeGeometry for spikes, SphereGeometry for orbs) colored to match the current 2D palette. Replace with OSRS models in a future sprint.

4. **How should the export script name animations in the GLTF?** The `GLTFExporter.addAnimation()` accepts a `name` parameter. Options: use sequence IDs (`"seq_8430"`), use descriptive names (`"attack_magic"`), or both. Recommendation: descriptive names. The `AnimationController` maps `animationHint` strings to clip names, so human-readable names simplify the mapping.

5. **Should the `RenderState` snapshot be created every tick or every frame?** Creating it every frame is wasteful since game state only changes on ticks. Creating it only on ticks means the rAF loop cannot access it for interpolation. Recommendation: create on tick, but include `prevPos` in the snapshot so the rAF loop has the data it needs for interpolation without re-querying the simulation.

6. **What is the correct scale factor for OSRS model vertex coordinates?** The Hunlef model's vertex positions range roughly from -200 to +200 in each axis. The boss should span ~5 world units (5 tiles). So the scale factor is approximately `5 / 400 = 0.0125`. This needs empirical tuning by viewing the model in the scene.
