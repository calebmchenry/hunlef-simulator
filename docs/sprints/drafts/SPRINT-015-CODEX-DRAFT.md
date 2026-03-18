# Sprint 015: Player Model Export, Runtime Swapping, and Player Animations

## Overview

Sprint 015 should replace the current cyan player box with a recognizable OSRS-style player model that:

- wears corrupted crystal armor
- wields the currently equipped corrupted weapon type
- plays at least idle, attack, run, and eat animations
- continues to render safely when exported assets or clips are missing

The existing codebase already provides the three critical ingredients:

- `tools/cache-reader/export-gltf.mjs` proves the project can export cache models plus morph-target sequences to self-contained GLTF with data URIs.
- `src/render/Renderer3D.ts` already has the boss GLTF loading/material conversion/fallback pattern and the runtime state needed to detect movement, attacks, and weapon swaps.
- `src/render/AnimationController.ts` shows the expected Three.js `AnimationMixer` pattern for clip lookup, one-shot actions, and returning to idle.

This sprint should ship:

- an offline player export pipeline that produces three precomposed GLTFs:
  - `player_bow.gltf`
  - `player_staff.gltf`
  - `player_halberd.gltf`
- a deterministic way to discover and record player animation sequence IDs from cache revision `232`
- renderer-side model swapping keyed off `sim.player.loadout.weapon.type`
- a player animation controller with graceful fallback when clips are unavailable
- a last-resort placeholder path so the player never disappears if a variant fails to load

This sprint should not ship:

- runtime composition of body, armor, and weapon meshes in the browser
- tier-specific visual variants for T1/T2/T3 weapons and armor
- a generalized character-customization system
- a broad refactor of the existing boss animation controller unless a tiny shared helper clearly reduces duplication

The recommended visual scope for Sprint 015 is one canonical perfected corrupted appearance. Combat tier still matters for simulation stats, but renderer visuals should key off weapon type only for this sprint.

## Use Cases

1. A fight starts with a bow loadout. The player appears as an armored OSRS character instead of a cyan box, holding a corrupted bow, and idle animation loops.
2. A player starts with a staff or halberd loadout. The correct weapon variant is shown without changing combat logic.
3. A player swaps weapons during countdown or combat. The visible model changes from bow to staff or halberd on the same runtime state change that already updates `Loadout.weapon`.
4. A moving player plays a run animation while traveling between tiles, then returns to idle when stationary.
5. A player attack fires on a tick. The visible model plays a weapon-appropriate attack clip, then returns to idle or run.
6. A player eats. The eat clip plays once if available; if not, the renderer falls back to idle without breaking.
7. A GLTF file or clip is missing. The renderer keeps either the previous valid model, a generic player variant, or the existing box placeholder instead of rendering nothing.

## Architecture

### 1. Keep composition offline, not in `Renderer3D`

The player model should be precomposed offline and shipped as a small fixed set of runtime assets. The browser should not discover item model IDs, merge `ModelDefinition`s, or solve cache-specific animation issues at startup.

Recommended export contract:

- export exactly three animated player GLTFs, one per weapon type
- normalize clip names across all variants to the same friendly names:
  - `idle`
  - `run`
  - `attack`
  - `eat`
- keep all GLTF buffers and palette textures embedded as data URIs, matching the boss export pattern

This keeps runtime logic simple:

- `Renderer3D` only decides which variant is active
- `PlayerAnimationController` only decides which friendly clip to play
- cache-research complexity stays in `tools/cache-reader`

### 2. Compose the player from `IDENTKIT` body parts plus worn-item models

The cache reader already exposes the pieces needed for composition:

- `ConfigType.IDENTKIT` is readable in cache revision `232`
- there are `307` kit definitions spanning `bodyPartId` `0` through `13`
- item definitions expose wearable models through `maleModel0/1/2`
- `ModelGroup` and `ModelDefinition.mergeWith()` already support offline model merging

The exporter should build one canonical male base preset and check it into code as a manifest, rather than redetecting body kits each run. The likely approach is:

1. Choose one stable male kit for each visible base body part.
2. Omit any base-body parts that are fully hidden by helm/body/legs/weapon equipment.
3. Load the corrupted armor and weapon item definitions, not just raw model IDs, so recolors, retextures, resize values, and offsets can be applied correctly.
4. Merge base body + armor + weapon into one `ModelDefinition`.
5. Export each merged variant with only the clips needed for this sprint.

Important implementation rule: the checked-in manifest should be item-definition driven, not model-ID driven. The corrupted weapon items reuse geometry across tiers but can differ by recolor metadata, and future iteration will be safer if the exporter reads the item definition first and derives model IDs from there.

### 3. Use a dedicated player asset manifest

The player pipeline needs a source-of-truth manifest that lives outside `Renderer3D`. That manifest should record:

- canonical base kit IDs
- corrupted armor item IDs
- weapon item IDs per rendered weapon type
- chosen sequence IDs per clip and per weapon variant
- output filenames

Suggested shape:

```ts
type PlayerWeaponVariant = 'bow' | 'staff' | 'halberd';

interface PlayerRenderManifest {
  baseKits: number[];
  armorItemIds: { helm: number; body: number; legs: number };
  variants: Record<PlayerWeaponVariant, {
    weaponItemId: number;
    sequences: {
      idle: number;
      run: number;
      eat: number;
      attack: number;
    };
    output: string;
  }>;
}
```

This manifest is the seam between discovery and export:

- discovery scripts write or update it
- the exporter consumes it
- runtime code should only see friendly clip names and final filenames

### 4. Discover animation sequence IDs with an explicit offline workflow

The cache does not appear to expose a direct "player weapon -> attack animation" mapping in the files already used by this repo. That means sequence selection needs to be a first-class part of the sprint, not a hard-coded guess.

Confirmed cache facts from revision `232`:

- sequence `808` exists and has `12` frames with total duration `252`
- sequence `829` exists and has `10` frames with total duration `73`
- a dense band of short classic humanoid-looking sequences also exists in the older range around `422` through `437`

Recommended discovery workflow:

1. Confirm known shared clips:
   - `808` as idle
   - `829` as eat
2. Build a temporary composite player model using the same merge path intended for final export.
3. Enumerate candidate non-Animaya sequences from a bounded range rather than the full cache. Start with:
   - confirmed IDs `808` and `829`
   - a candidate range around `400-1200`
   - prioritize short one-shot and medium loop clips such as `422-437`
4. For each candidate:
   - attempt `exporter.addSequence(cache, seqDef)`
   - record whether the sequence loads without throwing
   - record frame count and total duration
   - optionally export a preview GLTF or frame strip for manual inspection
5. Manually shortlist:
   - one shared `run` clip
   - one attack clip for bow
   - one attack clip for staff
   - one attack clip for halberd
6. Write the final IDs back into the player manifest.

This sprint should treat sequence discovery as an artifact-producing step, not tribal knowledge. A checked-in script plus manifest is preferable to burying numeric IDs inside `Renderer3D`.

### 5. Model swapping should key off current weapon type, not config

Runtime swapping is simpler than the export problem because the current simulation already exposes the state we need:

- `Loadout.weapon` is the live equipped weapon
- `GameSimulation.processInventoryAction()` already changes `player.loadout.weapon`
- `Renderer3D.draw()` already receives `sim` each frame

Recommended runtime architecture:

- replace `playerMesh: THREE.Mesh` with a player render root that can host:
  - loaded GLTF variants
  - a fallback primitive placeholder
- preload and cache all three variants during renderer startup
- track `lastPlayerWeaponType`
- when `sim.player.loadout.weapon.type` changes:
  - hide the old variant
  - show the cached variant for the new type
  - keep the previous valid model visible if the new variant has not loaded yet

This should be visibility-based swapping, not fresh network loading on every equip. There is only one player and three variants, so a small in-memory cache is the right tradeoff for responsiveness.

### 6. Add a player-specific animation controller

The current `AnimationController` is intentionally boss-specific. Player clips and triggers differ enough that a separate `PlayerAnimationController` is the safer sprint boundary.

Recommended player states:

- `idle`
- `run`
- `attack`
- `eat`

Recommended trigger sources:

- `attack`: a new player projectile with `fireTick === sim.tick`, or the halberd's immediate-hit projectile created on that same tick
- `eat`: `sim.playerAteThisTick` with renderer-side `lastPlayerEatTick` tracking
- `run`: player tile changed between `prevPos` and `pos`
- `idle`: default fallback when no higher-priority action is active

Recommended priority:

1. `eat`
2. `attack`
3. `run`
4. `idle`

If a clip is missing from the active GLTF variant, the controller should silently fall back to `idle` or `run`. The player render path should be more tolerant than the boss path because sequence discovery is part of this sprint.

### 7. Facing should be event-driven and stable

The boss already rotates toward the player each frame. The player should use a slightly different rule set:

- when moving, face movement direction
- when stationary but attacking, face the boss
- otherwise keep the last valid yaw

This avoids idle jitter and preserves readable combat silhouettes during brief pauses between ticks.

### 8. Fallback ladder should be explicit

The sprint should define the fallback order before implementation:

1. Preferred: animated precomposed GLTF for the requested weapon type
2. Secondary: animated generic player variant if the requested variant fails
3. Tertiary: static precomposed GLTF for the requested weapon type if animation export fails
4. Last resort: existing cyan box placeholder

This fallback ladder matters because export, discovery, and runtime loading are three separate failure domains.

## Implementation

### Phase 1: Player Asset Discovery and Manifest

**Files:**

- `tools/cache-reader/discover-player-assets.mjs` or split discovery scripts
- `tools/cache-reader/export-gltf.mjs` as reference only
- new checked-in player manifest file

**Tasks:**

- [ ] Add a player-specific discovery script instead of overloading the current boss-only export script with exploration logic.
- [ ] Confirm corrupted armor and weapon item IDs from cache definitions and record them in a player manifest.
- [ ] Probe `IDENTKIT` definitions and choose one canonical male base-body preset for visible uncovered parts.
- [ ] Confirm shared known sequences `808` and `829` directly from cache revision `232`.
- [ ] Add candidate-sequence scanning for humanoid clips, starting from a bounded range such as `400-1200` and prioritizing short clips in the `422-437` band.
- [ ] Produce a shortlist of final sequence IDs for `idle`, `run`, `eat`, and each weapon type's `attack`.
- [ ] Check the chosen IDs into a manifest instead of hard-coding them in renderer code.

### Phase 2: Composite Player GLTF Export

**Files:**

- new `tools/cache-reader/export-player-gltf.mjs`
- optional shared helper module under `tools/cache-reader/`
- generated `public/models/player_bow.gltf`
- generated `public/models/player_staff.gltf`
- generated `public/models/player_halberd.gltf`

**Tasks:**

- [ ] Implement model-loading helpers that read kit models and item wearable models from cache.
- [ ] Apply item-definition recolor, retexture, resize, and offset metadata before merge.
- [ ] Support `maleModel0/1/2` even if the current corrupted set only uses `maleModel0`, so the exporter is not accidentally special-cased too tightly.
- [ ] Merge base body + perfected corrupted armor + one weapon variant via `ModelGroup` / `mergeWith`.
- [ ] Add exactly four sequences per exported variant: `idle`, `run`, `attack`, `eat`.
- [ ] Rename exported clips to friendly normalized names so runtime code never depends on raw numeric sequence IDs.
- [ ] Reuse the existing data-URI export pattern so browser runtime does not depend on sidecar `.bin` or texture files.
- [ ] Validate that each GLTF contains embedded buffers only and at least the required clip set.

### Phase 3: Renderer Runtime Integration

**Files:**

- `src/render/Renderer3D.ts`
- new `src/render/playerModelManifest.ts` or equivalent runtime mapping

**Tasks:**

- [ ] Replace the `playerMesh` cyan box as the primary player representation with a player render root that can host GLTF variants plus fallback placeholder geometry.
- [ ] Add preload logic for all three player GLTF variants during renderer initialization.
- [ ] Cache loaded scenes and animation controllers by weapon type.
- [ ] Swap active visible variant when `sim.player.loadout.weapon.type` changes.
- [ ] Keep the previous valid variant or the box placeholder visible if a requested model is not yet available.
- [ ] Add player scale and yaw-offset constants, calibrated against one-tile world scale.
- [ ] Keep the current target tile indicator and overhead-icon positioning working against the new player root.

### Phase 4: Player Animation and Facing Logic

**Files:**

- new `src/render/PlayerAnimationController.ts`
- `src/render/Renderer3D.ts`
- optional pure helper module for render-state decisions

**Tasks:**

- [ ] Implement a player-specific animation controller around `THREE.AnimationMixer`.
- [ ] Normalize clip lookup around friendly names rather than raw sequence IDs.
- [ ] Detect player attack ticks from newly fired player projectiles, including halberd's immediate-hit path.
- [ ] Detect eat events from `sim.playerAteThisTick` with per-tick deduping.
- [ ] Play `run` while the player is moving and return to `idle` when stationary.
- [ ] Add stable facing rules: movement direction first, boss-facing during attacks, otherwise preserve prior yaw.
- [ ] Make every state transition tolerant of missing clips so unresolved discovery gaps do not break rendering.

### Phase 5: Fallbacks, Verification, and Size Control

**Files:**

- `src/render/Renderer3D.ts`
- `public/models/player_*.gltf`
- optional test helpers under `src/__tests__/`

**Tasks:**

- [ ] Add an explicit fallback order for missing variant files, missing clips, and total GLTF load failure.
- [ ] If animated export proves unstable for one or more variants, ship static precomposed GLTFs first rather than blocking the whole sprint on perfect animation parity.
- [ ] Limit exported clip count to the minimum required set so preload size stays acceptable.
- [ ] Optionally add pure tests for variant resolution and player render-state decisions if that logic is extracted from `Renderer3D`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `cd ../cg-sim-player && npm test`.
- [ ] Manually verify:
  - player model replaces the cyan box
  - bow/staff/halberd swaps change the visible model
  - idle, run, eat, and attack behavior look reasonable
  - fallback placeholder appears only on real asset failure

## Files Summary

| File | Change | Why |
|---|---|---|
| `tools/cache-reader/export-gltf.mjs` | Reference only or light helper extraction | Current boss exporter demonstrates the correct GLTF/data-URI/sequence-add pattern but should not absorb all player-specific complexity |
| `tools/cache-reader/discover-player-assets.mjs` | Required new file | Makes sequence and base-body discovery reproducible instead of hiding cache research in notes |
| `tools/cache-reader/export-player-gltf.mjs` | Required new file | Owns composite player export for bow/staff/halberd variants |
| `public/models/player_bow.gltf` | Required generated asset | Runtime player variant for bow |
| `public/models/player_staff.gltf` | Required generated asset | Runtime player variant for staff |
| `public/models/player_halberd.gltf` | Required generated asset | Runtime player variant for halberd |
| `src/render/Renderer3D.ts` | Required | Replace placeholder player mesh with cached GLTF variants, model swapping, facing, and fallback handling |
| `src/render/PlayerAnimationController.ts` | Required new file | Boss and player states differ enough to justify a dedicated controller |
| `src/render/AnimationController.ts` | No change expected | Useful reference for mixer usage; keep boss logic stable unless a tiny shared helper emerges naturally |
| `src/equipment/Loadout.ts` | No logic change expected | Existing `loadout.weapon.type` already provides the runtime swap signal the renderer should follow |
| `src/entities/Player.ts` | No logic change expected | Existing movement and inventory state is enough for render triggers |
| `src/engine/GameSimulation.ts` | Optional tiny change only | Only touch if a small render-facing helper is needed for attack/eat event clarity |

## Definition of Done

- [ ] The player no longer renders as the cyan box during normal successful asset load.
- [ ] Three precomposed player GLTFs exist for bow, staff, and halberd.
- [ ] Each exported player GLTF is self-contained with embedded buffers and palette data.
- [ ] `Renderer3D` swaps visible player variants based on the current equipped weapon type.
- [ ] The player has at least one working idle clip and one working attack clip per rendered weapon type.
- [ ] A working run clip and eat clip are present, or missing-clip fallback behavior is implemented and verified.
- [ ] Player facing is stable and readable during movement and attacks.
- [ ] If a variant or clip fails to load, the renderer falls back gracefully instead of hiding the player.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] `cd ../cg-sim-player && npm test` passes.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Base-body kit selection overlaps badly with worn corrupted armor | Visible clipping or doubled geometry | Keep body-part selection in a manifest, omit hidden parts deliberately, and validate the canonical preset visually before wiring runtime |
| Sequence IDs for run or weapon attacks are guessed instead of discovered | Wrong-looking or broken animations | Treat sequence discovery as its own scripted phase and store chosen IDs in a checked-in manifest |
| Merged wearable models do not animate correctly when sequences are applied | Weapon or armor stays rigid while body animates incorrectly | Validate merged-model animation in the export tool before touching the renderer; fall back to static precomposed variants if needed |
| Three animated GLTF variants are too large to preload comfortably | Startup hitch or increased memory use | Export only required clips, avoid extra debug clips in shipping assets, and switch to lazy-load plus prefetch only if size becomes a real measured problem |
| Runtime swap logic removes the current model before the next variant is ready | Brief invisible player during weapon swaps | Keep prior valid variant visible until replacement is loaded and ready |
| One or more clips are absent from a variant export | Animation controller throws or gets stuck | Make player clip lookup tolerant and fall back to `idle` or placeholder behavior |

## Security

This sprint does not add network, auth, or persistence surface area, but it does add an asset-loading path that should remain tightly controlled.

Security and integrity rules for this sprint:

- use fixed local model paths under `public/models`
- do not allow user-controlled asset URLs
- keep GLTF exports self-contained with embedded data URIs
- keep the player manifest checked into the repo so asset selection is reviewable and deterministic
- fail closed to known local fallback assets rather than attempting remote recovery

## Dependencies

- Existing `osrscachereader@1.1.3` under `tools/cache-reader` is sufficient; it already exposes `GLTFExporter`, `IDENTKIT`, and model merge primitives.
- Existing Three.js GLTF runtime support in `Renderer3D.ts` is sufficient for loading player variants.
- Cache revision `232` remains the source of truth for model and sequence discovery in this sprint.
- No `cg-sim-player` code changes are expected.
- Manual visual verification is required because current automated tests do not exercise WebGL animation output directly.

## Open Questions

1. Which exact male `IDENTKIT` IDs should define the canonical base body for Sprint 015? Recommendation: choose one visually clean preset once and check it into a manifest instead of deriving it dynamically.
2. Which cache `232` sequence IDs should be used for bow, staff, and halberd attack clips? Recommendation: confirm them through scripted preview export rather than importing guesses from notes.
3. Should `run` be weapon-specific or shared across all rendered variants in Sprint 015? Recommendation: use a shared run clip first unless cache preview clearly shows meaningful weapon-specific differences worth the extra export complexity.
4. Should the renderer always show perfected corrupted visuals, even when the sim uses T1 or T2 stats? Recommendation: yes for Sprint 015; keep runtime visuals keyed to weapon type only.
5. Should all three player variants preload on renderer startup, or should only the equipped variant load eagerly? Recommendation: preload all three if the measured total size is acceptable; otherwise eager-load current variant and prefetch the other two immediately after.
