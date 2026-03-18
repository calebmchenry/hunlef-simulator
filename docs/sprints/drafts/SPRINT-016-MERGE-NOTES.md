# Sprint 016 Merge Notes

## Draft Strengths

### Claude Draft
- Highly specific, near-copy-paste implementation with exact line numbers and code blocks
- Clean 4-phase structure with effort estimates (20/25/30/25)
- Strong MVP scope-cut ladder (prioritized list of what to drop)
- Correct reuse of existing renderer patterns (pool, tileToWorld, targetTileIndicator)

### Codex Draft
- Superior architectural analysis: identified boss style ring collision, tornado overlap dedup, `applyUnlitMaterials()` gap, `renderOrder` need, and `dispose()` cleanup
- Better boss true tile approach (outline perimeter, not filled plane)
- More conservative tornado scale (0.65-0.7 vs 0.8)
- Comprehensive use cases including edge scenarios (UC-4, UC-5, UC-7)

### Gemini Draft
- Concrete rendering order table with specific Y offsets
- Ground swirl ring concept (simpler than Codex's CanvasTexture sprite)
- Toggleable keybind proposal with implementation detail
- Good color choices with rationale

## Valid Critiques Accepted

1. **Boss true tile must be outline, not filled plane** (all critiques agreed) -- a filled 5x5 plane obscures floor hazards, violating intent constraints
2. **`applyUnlitMaterials()` must be called on tornado GLTF** (Codex + Gemini critique) -- current tornado loader is the only one skipping this, making tornadoes lighting-dependent
3. **Boss style ring must be resized** (Codex + Gemini critique) -- current `RingGeometry(2.2, 2.5)` collides with 5x5 perimeter indicator
4. **Tornado overlap deduplication needed** (all critiques) -- two tornadoes on same tile will z-fight without dedup
5. **`renderOrder` needed** (Codex + Gemini critique) -- Y-offset alone is fragile for Three.js transparent sorting
6. **`dispose()` must be extended** (all critiques) -- new meshes/materials/geometries need cleanup
7. **Fallback cone material must be brightened** (all critiques) -- dark gray `0x888888` `MeshLambertMaterial` stays hard to see even at larger scale

## Valid Critiques Rejected

1. **Toggle keybind** -- user chose "always visible" for simplicity. Defer toggle to a future sprint.
2. **Tornado aura sprite** (Codex draft) -- scope creep; scale + material fix is sufficient per user preference
3. **Ground swirl ring** (Gemini draft) -- scope creep; user chose "scale + material fix only"
4. **Tornado Y float** (Claude draft) -- user chose against floating; keep tornadoes at ground level
5. **Helper file extraction** -- keep everything in Renderer3D.ts for this sprint; it's a renderer-only change
6. **Tornado vertical bob** (Codex) -- unnecessary with the other visibility improvements

## Interview Refinements Applied

- **Tile style:** Outline only (thin rectangular border, 4 plane strips)
- **Toggle:** Always visible, no keybind needed
- **Colors:** Player=yellow (#ffff00), Boss=blue (#4488ff), Tornado=white (#ffffff)
- **Tornado visibility:** Scale increase (~0.7) + `applyUnlitMaterials()` + brighten fallback cone. No ground swirl, no Y float, no aura.
