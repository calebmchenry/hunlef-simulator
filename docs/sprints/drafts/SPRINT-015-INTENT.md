# Sprint 015 Intent: Player Model & Animations

## Seed

Replace the cyan box placeholder with an actual OSRS-style player model wearing corrupted crystal armor and wielding the appropriate corrupted weapon. Include combat animations (idle, attack, run, eat). Research how OSRS player models are composed and animated.

## Research Findings

### How OSRS Player Models Work
- **Composition:** Player model = base body parts + equipment overlays. Equipment items have `maleModel0` fields in their cache definitions pointing to worn model IDs.
- **In the Gauntlet:** The player wears corrupted crystal armor (3 tiers) and wields corrupted weapons (bow/staff/halberd, 3 tiers each).
- **Animations:** OSRS uses frame-based morph target animations, NOT skeletal rigs. The existing boss model uses this same approach — each animation is a sequence of morph targets.
- **Export pipeline:** The project already has `tools/cache-reader/export-gltf.mjs` which uses `osrscachereader`'s `GLTFExporter` to export models with morph-target animations. This pattern can be extended.

### Discovered Model IDs (from extracted item definitions)
| Equipment | Model ID | Notes |
|-----------|----------|-------|
| Perfected corrupted helm | 38025 | Same visual regardless of tier choice |
| Perfected corrupted body | 38105 | |
| Perfected corrupted legs | 38078 | |
| Corrupted bow (all tiers) | 38302 | Weapon models shared across tiers |
| Corrupted staff (all tiers) | 38312 | |
| Corrupted halberd (all tiers) | 38303 | |

### Animation Approach
- Player animations are tied to equipment/weapon type via animation sequence IDs in the cache
- Key animation types needed: idle/stance, attack (per weapon), run/walk, eat
- Known IDs: IDLE=808, CONSUMING/EAT=829. Weapon-specific attack anims need discovery from item/weapon definitions in the cache
- The `osrscachereader` library can load sequence definitions and add them as morph targets to the GLTF export

### Proposed Architecture
Instead of compositing separate body+armor+weapon models at runtime (complex), the approach is:
1. Export 3 pre-composed GLTF files: `player_bow.gltf`, `player_staff.gltf`, `player_halberd.gltf`
2. Each includes: player body + perfected corrupted armor + the weapon, with relevant animations
3. Swap the player model in Renderer3D when the player equips a different weapon
4. Create a `PlayerAnimationController` similar to the boss's `AnimationController`

### Reference: Corrupted Hunlef Fight Videos
- The player appears as a small figure wearing distinctive purple/magenta crystal armor
- Movement is 1-2 tiles per tick (run), weapon attacks have unique wind-up animations
- Bow: rapid pull-back motion. Staff: overhead cast. Halberd: sweeping slash
- Eating animation briefly pauses the player

## Relevant Codebase Areas

| File | Role |
|------|------|
| `tools/cache-reader/export-gltf.mjs` | Existing GLTF export script (boss model) — template for player export |
| `src/render/Renderer3D.ts` | Player mesh (currently cyan box at L183-188), model loading patterns |
| `src/render/AnimationController.ts` | Boss animation state machine — template for player animations |
| `src/render/ModelLoader.ts` | JSON → BufferGeometry fallback loader |
| `public/models/` | Where exported GLTF files are served |
| `docs/assets/defs/items/` | Item definitions with maleModel0 IDs |

## Constraints

- Must keep all 187 cg-sim tests passing
- Must keep all cg-sim-player tests passing
- Never modify cg-sim-player
- Must work with Three.js 0.183.2 (existing)
- GLTF files must use data URIs (no external file references) for browser compatibility
- Player model must match the boss model's render style (MeshBasicMaterial with vertex colors)
- osrscachereader v1.1.3 is already installed — use existing `GLTFExporter` API

## Success Criteria

1. Player appears as a recognizable OSRS character in corrupted crystal armor
2. Player model changes when weapon is swapped (bow/staff/halberd)
3. Idle animation plays when standing
4. Attack animation plays on player attack tick (distinct per weapon type)
5. Player model faces the correct direction during movement/combat
6. No performance regression (30+ fps with both boss and player animated)

## Verification Strategy

- `npm run build` + `npm test` (187+ tests)
- `cd ../cg-sim-player && npm test`
- Visual verification: player model visible, animations play, weapon swap changes model
- Performance: no frame drops below 30fps

## Uncertainty Assessment

- **Correctness: Medium** — Need to discover animation sequence IDs for player combat actions. The model composition (body + armor + weapon in a single GLTF) hasn't been done before in this project.
- **Scope: Medium** — Could expand if model composition is harder than expected or if certain animations aren't available in the cache.
- **Architecture: Medium** — New export script, new player animation controller, model swapping on weapon change. More complex than previous sprints.

## Open Questions

1. **Can osrscachereader's GLTFExporter handle composite models (body + armor + weapon)?** Or do we need to merge vertex buffers manually?
2. **What are the exact animation sequence IDs for player attacks with bow/staff/halberd?** These need to be discovered from the cache (item definitions reference them, or they can be found via RuneLite animation IDs).
3. **Should we export all 3 weapon variants, or start with just the equipped weapon?** Full implementation needs all 3 for weapon swapping.
4. **Player body model:** What model ID is the base male/female body in the Gauntlet? Is it a kit definition or a specific model ID?
5. **How should the player model handle different armor tiers?** Always use perfected (T3) visuals for simplicity? Or export per-tier?
6. **Run animation:** Is there a distinct run animation, or does OSRS just move the model between tiles (which is what the sim currently does via interpolation)?
