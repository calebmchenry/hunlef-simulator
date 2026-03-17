# Sprint 007 Intent: 3D Rendering — Three.js, OSRS Models, Animated Hunlef

## Seed

Transition from 2D colored rectangles to 3D rendering using Three.js. Render the actual OSRS models extracted from the cache. Extract animation frame data so the Corrupted Hunlef is fully animated (idle, attack, walk, death). OSRS-style perspective camera (~50-60 degree pitch, rotatable).

## Context

- **Sprint 6 complete**: 155 tests, smooth 60fps rendering via rAF, 2-tile running, projectile animations.
- **Existing assets**: 29 OSRS model JSONs in docs/assets/models/ (boss 2180 verts / 3605 faces, tornado, projectiles, items, armor). Animation sequence metadata in docs/assets/defs/sequences/ (frame IDs, frame lengths, sounds). NPC defs with standing/walking animation IDs.
- **Missing**: Animation frame data (bone transforms). Need to extract from OSRS cache using osrscachereader.
- **osrscachereader has a GLTFExporter** at tools/cache-reader/node_modules/osrscachereader/src/cacheReader/exporters/GLTFExporter.js with correct HSL-to-RGB conversion and morph-target animation support.
- **OSRS color format**: 16-bit HSL packed as (hue<<10 | sat<<7 | lum). Conversion code exists in the exporter.
- **Current renderer**: 2D Canvas, 576x576, renders at 60fps via rAF with tickProgress interpolation.

## Key Decisions (from interview)

1. **Three.js** — First runtime dependency (~118KB gzipped). Worth it for 3D.
2. **OSRS-style perspective camera** — ~50-60 degree pitch, rotatable around arena
3. **Extract animation frames** — Full animated models from the start

## Architecture Overview

### Rendering Transition
- Replace 2D Canvas with a Three.js WebGLRenderer
- Keep the existing side panel (DOM) — it stays as HTML/CSS
- The Three.js canvas replaces the current 2D canvas element
- All 2D overlay elements (hit splats, countdown, overhead icons) become Three.js sprites or CSS2DRenderer objects
- The rAF render loop already exists — Three.js renderer.render() replaces the old ctx.draw calls

### Model Pipeline
1. **Build step**: Script extracts animation frames from cache, then exports models as GLTF with morph-target animations
2. **Runtime**: Three.js GLTFLoader loads the GLTF files, creates meshes with proper OSRS colors
3. **Alternative**: Build BufferGeometry directly from JSON at runtime (simpler for static models)

### Animation Pipeline
1. osrscachereader loads animation frame data from cache archive 0 (ANIMATIONS)
2. GLTFExporter produces .gltf with morph targets per frame
3. Three.js AnimationMixer plays the animations at the correct tick rate
4. Key animations needed: idle (8417), walk (8416), magic attack (8430), ranged attack (8431), stomp (8432), prayer-disable (8433), death (8436), style switch (8754, 8755)

### Scene Setup
- Arena: 12x12 tile floor plane with corrupted gauntlet texture/color
- Boss: Animated Hunlef model at 5x5 tile scale
- Player: For now, a simple colored shape or small player model (no player model extracted yet)
- Projectiles: Use the extracted projectile models (40670, 40673) or keep as simple 3D shapes
- Overhead icons: Three.js Sprite objects floating above entities
- Hit splats: CSS2DRenderer or Three.js sprites
- Lighting: Simple ambient + directional to match OSRS flat-ish shading

## Relevant Codebase

- `src/render/Renderer.ts` — Full rewrite to Three.js
- `src/main.ts` — Wire Three.js canvas, keep rAF loop structure
- `tools/cache-reader/` — osrscachereader with GLTFExporter
- `docs/assets/models/` — 29 model JSONs
- `docs/assets/defs/sequences/` — Animation sequence metadata
- `docs/assets/defs/npcs/` — NPC definitions with animation IDs

## Constraints

- Three.js is the ONLY new runtime dependency
- Side panel (DOM) stays as-is — only the game canvas changes
- Existing game logic (GameSimulation, combat, tick engine) unchanged
- All 155 tests must still pass (they don't touch the renderer)
- HUD/side panel updates stay DOM-based per-tick

## Success Criteria

1. Three.js renders a 3D arena with the Corrupted Hunlef model
2. Model colors match OSRS (correct HSL-to-RGB conversion)
3. Hunlef plays idle animation when standing, attack animations when firing
4. OSRS-style camera angle (~50-60 degree pitch)
5. Camera can be rotated with mouse drag or arrow keys
6. Projectiles render as 3D objects traveling through the scene
7. Overhead prayer icons float above entities
8. Hit splats visible near entities
9. 12x12 tile floor visible with corrupted gauntlet coloring
10. Player represented (simple shape or model)

## Uncertainty Assessment

- **Correctness: Medium** — HSL conversion exists but needs testing. Model orientation/scale may need adjustment.
- **Scope: High** — This is the biggest sprint yet. Full renderer rewrite + animation extraction pipeline.
- **Architecture: High** — New dependency (Three.js), new rendering paradigm, GLTF pipeline, camera system.
