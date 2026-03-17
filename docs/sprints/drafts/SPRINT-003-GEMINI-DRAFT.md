# Sprint 003 Draft: Image Infrastructure & Overhead Prayer Icons

**Author perspective:** Rendering system architect

---

## Overview

Introduce a centralized asset pipeline that preloads every image the application needs, exposes a typed registry with compile-time safety, and provides a single `ready()` promise so no rendering code ever draws before assets are available. On top of that foundation, replace every placeholder visual (Unicode tab icons, colored rectangles for items, text-label prayers) with authentic OSRS sprites, and add overhead prayer/attack-style icons on the game canvas above both the player and the boss.

The design is deliberately over-specified on the image infrastructure side because future sprints will need the same pipeline for boss model sprites, tornado projectiles, floor tile textures, and potentially animation frame sequences. Getting the loader right now avoids retrofitting later.

---

## Use Cases

1. **App startup gate** -- The game displays a loading indicator until `AssetManager.ready()` resolves. No canvas frame or DOM panel renders before every required image is decoded and cached.
2. **Tab icons** -- All 14 tab buttons in the `TabBar` display their authentic OSRS icon images instead of Unicode emoji.
3. **Inventory item sprites** -- The 28-slot inventory grid shows actual OSRS item sprites (paddlefish, corrupted paddlefish, egniol potions at each dose, all weapon tiers) with `image-rendering: pixelated` for authentic scaling.
4. **Prayer panel icons** -- All 29 prayer cells display real OSRS prayer icons (active = bright, inactive = dimmed) instead of text labels.
5. **Equipment panel sprites** -- Equipped armor and weapon slots show item sprites in the paper-doll layout.
6. **Overhead prayer icon (player)** -- When the player has Protect from Magic or Protect from Missiles active, the corresponding overhead icon renders on the game canvas above the player tile, correctly z-ordered above the player rectangle but below hit splats.
7. **Overhead attack-style icon (boss)** -- The boss displays an overhead icon matching its current attack style (ranged or magic). This is a deliberate training aid -- real OSRS Hunlef shows no overhead, but showing the boss's style helps learners react to prayer switches.
8. **Future extensibility** -- A developer adds a new sprite (e.g., tornado projectile) by: (a) adding one entry to the typed asset registry, (b) placing the file in `public/images/`, (c) referencing it via `AssetManager.get('tornado')`. No loader code changes.

---

## Architecture

### Asset Pipeline

```
Build time (one-time script)
  tools/download-images.ts
    → reads AssetManifest
    → fetches from OSRS wiki Special:FilePath/<name>.png
    → writes to public/images/<category>/<name>.png

Runtime
  AssetManager (singleton)
    → iterates AssetManifest at construction
    → creates HTMLImageElement per entry, sets src
    → tracks load/error via Promise.all on per-image promises
    → exposes ready(): Promise<void>
    → exposes get(key: AssetKey): HTMLImageElement  (returns cached, decoded image)

  AssetManifest (const object, compile-time typed)
    → maps AssetKey → { path: string; width: number; height: number }
    → AssetKey is a string literal union: 'tab.inventory' | 'tab.prayer' | ... | 'item.paddlefish' | ... | 'overhead.protect_magic' | ...
```

### Typed Asset Registry

The registry is a `const` object (not an enum) so that:
- Keys are a string literal union (`AssetKey`), giving autocomplete and compile-time typo detection.
- Values carry metadata (path, native dimensions) that renderers can use for scaling decisions.
- Adding a new asset is a single line in one file.

```typescript
// src/assets/manifest.ts
export const ASSET_MANIFEST = {
  // Tabs
  'tab.inventory':  { path: '/images/tabs/Inventory.png', w: 25, h: 27 },
  'tab.prayer':     { path: '/images/tabs/Prayer_tab_icon.png', w: 25, h: 29 },
  'tab.equipment':  { path: '/images/tabs/Worn_Equipment.png', w: 26, h: 31 },
  // ... all 14 tabs

  // Items
  'item.paddlefish':             { path: '/images/items/Paddlefish.png', w: 30, h: 30 },
  'item.corrupted_paddlefish':   { path: '/images/items/Corrupted_paddlefish.png', w: 30, h: 30 },
  'item.egniol_1':               { path: '/images/items/Egniol_potion_(1).png', w: 30, h: 30 },
  'item.egniol_2':               { path: '/images/items/Egniol_potion_(2).png', w: 30, h: 30 },
  'item.egniol_3':               { path: '/images/items/Egniol_potion_(3).png', w: 30, h: 30 },
  'item.egniol_4':               { path: '/images/items/Egniol_potion_(4).png', w: 30, h: 30 },
  // ... all weapon tiers (bow/staff/halberd x basic/attuned/perfected = 9)
  // ... all armor pieces (helm/body/legs x basic/attuned/perfected = 9)

  // Prayers (panel icons, all 29)
  'prayer.thick_skin':            { path: '/images/prayers/Thick_Skin.png', w: 30, h: 30 },
  // ... all 29

  // Overhead icons (canvas-rendered, used by Renderer)
  'overhead.protect_magic':       { path: '/images/overhead/Protect_from_Magic_overhead.png', w: 25, h: 25 },
  'overhead.protect_missiles':    { path: '/images/overhead/Protect_from_Missiles_overhead.png', w: 25, h: 25 },
} as const;

export type AssetKey = keyof typeof ASSET_MANIFEST;
```

### Canvas Rendering: Overhead Icons

```
Z-order (back to front):
  1. Background + grid lines
  2. Boss rectangle + border
  3. Boss overhead icon (attack style)
  4. Boss label + HP text
  5. Player rectangle
  6. Player overhead icon (active prayer)
  7. Target tile indicator
  8. Hit splats (topmost)
```

Overhead icon positioning:
- **Player**: Centered horizontally on the player tile. Vertically: `playerTileTop - iconHeight - 4px` gap. The icon is 25x25 source pixels, rendered at 28x28 canvas pixels (slight upscale for visibility at the 48px tile size).
- **Boss**: Centered horizontally on the boss's 5-tile span. Vertically: `bossTileTop - iconHeight - 6px` gap. Rendered at 32x32 (larger to match boss scale).

Visual treatment:
- **1px black outline** around the icon for contrast against any background (drawn via 4-pass shadow technique: draw the icon offset by 1px in each cardinal direction with `globalCompositeOperation = 'source-over'` and a black tint, then draw the real icon on top). This is the standard OSRS approach.
- **No bobbing animation** in this sprint. The icon is static, locked to the entity position. Bobbing is a polish item for a future sprint and would require per-frame sine offset tracking -- unnecessary complexity for a training tool.
- **No shadow beneath the icon**. The black outline provides sufficient contrast.

### Data Flow for Overhead Icons

```
Renderer.draw(sim):
  player overhead:
    prayer = sim.prayerManager.activePrayer   // 'magic' | 'missiles' | null
    if prayer:
      img = assetManager.get(`overhead.protect_${prayer}`)
      drawOverheadIcon(img, player.pos, 1, 28)  // entitySize=1 tile, iconSize=28px

  boss overhead:
    style = sim.boss.currentStyle              // 'ranged' | 'magic'
    overheadKey = style === 'ranged' ? 'overhead.protect_missiles' : 'overhead.protect_magic'
    img = assetManager.get(overheadKey)
    drawOverheadIcon(img, boss.pos, boss.size, 32)
```

Note: The boss overhead shows the *matching protection prayer icon* for its attack style. This communicates "you should be praying this" -- the training aid described in the intent. Ranged attack = show Protect from Missiles icon. Magic attack = show Protect from Magic icon.

### Item-to-Asset Mapping

Each `InventoryItem` gains an `assetKey: AssetKey` field (replacing the `color` fallback). The mapping is deterministic from item ID:

| Item ID pattern | AssetKey |
|----------------|----------|
| `paddlefish` | `item.paddlefish` |
| `corrupted_paddlefish` | `item.corrupted_paddlefish` |
| `egniol_N` | `item.egniol_N` |
| `bow_1` | `item.bow_basic` |
| `staff_2` | `item.staff_attuned` |
| `halberd_3` | `item.halberd_perfected` |

A lookup function `itemIdToAssetKey(id: string): AssetKey` in the manifest module provides the mapping with exhaustive checking.

---

## Implementation

### Phase 1: Asset Manifest & AssetManager

Build the typed registry and image loader. No visual changes yet -- this phase is pure infrastructure.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/assets/manifest.ts` | Create | `ASSET_MANIFEST` const object mapping every `AssetKey` to `{ path, w, h }`. `AssetKey` type derived via `keyof typeof`. Helper function `itemIdToAssetKey()`. |
| `src/assets/AssetManager.ts` | Create | Singleton class. Constructor iterates manifest, creates `HTMLImageElement` per entry, collects load promises. `ready(): Promise<void>` resolves when all loaded. `get(key: AssetKey): HTMLImageElement` returns cached image (throws if not ready). |
| `src/assets/index.ts` | Create | Re-exports `AssetManager`, `AssetKey`, `ASSET_MANIFEST`, `itemIdToAssetKey`. |

**Design decisions:**
- `AssetManager` is a class, not a module-level singleton, so tests can construct fresh instances with mock manifests.
- `get()` throws on unknown key at compile time (via `AssetKey` type) and at runtime if called before `ready()` resolves. This is intentional -- it surfaces integration bugs immediately rather than silently rendering nothing.
- Error handling: if any image fails to load, `ready()` rejects with a list of failed asset keys. The app shows an error screen. No partial rendering.

### Phase 2: Build-Time Download Script

A Node script that fetches all images from the OSRS wiki and writes them to `public/images/`.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `tools/download-images.ts` | Create | Reads `ASSET_MANIFEST`, constructs wiki URL per entry (`https://oldschool.runescape.wiki/images/<filename>`), downloads to `public/images/<category>/`. Skips existing files (idempotent). Reports missing/failed downloads. |
| `public/images/tabs/` | Create (dir) | Destination for tab icon PNGs. |
| `public/images/items/` | Create (dir) | Destination for item sprite PNGs. |
| `public/images/prayers/` | Create (dir) | Destination for prayer icon PNGs. |
| `public/images/overhead/` | Create (dir) | Destination for overhead prayer icon PNGs. |

### Phase 3: Tab Icons & Inventory Sprites (DOM panels)

Replace placeholder visuals in the DOM-rendered panels with real images sourced from `AssetManager`.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/render/TabBar.ts` | Modify | Change `TabDef.icon` from `string` (emoji) to `AssetKey`. In `createTab()`, create an `<img>` element with `src` from `AssetManager.get(def.icon).src` instead of setting `textContent`. Add `image-rendering: pixelated` via class. |
| `src/render/InventoryPanel.ts` | Modify | Replace colored `div.item-icon` with `<img>` element. Source from `AssetManager.get(item.assetKey).src`. Remove `item.color` usage. Keep `item-name` text label below sprite. Keep dose overlay for potions. |
| `src/entities/Inventory.ts` | Modify | Add `assetKey: AssetKey` field to `InventoryItem` interface. Replace `color: string` field. Update `buildFromLoadout()` to set `assetKey` via `itemIdToAssetKey()` instead of hardcoded colors. |
| `src/equipment/items.ts` | Modify | Add `assetKey: AssetKey` to `Weapon` and `ArmorSet` interfaces. Populate for all tiers. |
| `src/render/osrs-theme.css` | Modify | Add `.osrs-sprite { image-rendering: pixelated; image-rendering: crisp-edges; }` utility class. |

### Phase 4: Prayer Panel & Equipment Panel Sprites

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/render/PrayerPanel.ts` | Modify | Add `assetKey: AssetKey` to `PrayerDef`. Replace hardcoded sprite paths with `AssetManager.get(prayer.assetKey).src`. For all 29 prayers (not just the two interactive ones), display the real icon. Non-interactive prayers get a dimmed/desaturated CSS treatment (opacity or CSS filter). Active prayers get bright rendering + the existing highlight background. Remove `spriteActive`/`spriteInactive` fields -- active state is now handled by CSS class toggling brightness, not swapping image sources. |
| `src/render/EquipmentPanel.ts` | Modify | When a slot is filled, render an `<img>` with the item's asset instead of text. For armor, map slot ID (head/body/legs) to the appropriate armor piece asset key. For weapon, use `weapon.assetKey`. Empty slots keep the current text label. |

### Phase 5: Canvas Overhead Icons

The main rendering feature. Draw overhead prayer icons on the game canvas.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/render/Renderer.ts` | Modify | Accept `AssetManager` in constructor. Add `drawOverheadIcon(img, pos, entitySize, renderSize)` private method implementing the outlined icon technique. In `draw()`, after drawing the boss rectangle but before boss label text, draw the boss overhead. After drawing the player rectangle but before the target tile, draw the player overhead. Outlined icon technique: draw 4 black-tinted copies offset by 1px in each direction, then draw the actual icon centered on top. |

**Detailed overhead rendering logic added to `Renderer.draw()`:**

```
// After boss rectangle + border, before boss label
private drawOverheadIcon(
  img: HTMLImageElement,
  tileX: number,      // top-left tile X of entity
  tileY: number,      // top-left tile Y of entity
  entityTileSize: number,  // 1 for player, 5 for boss
  iconPx: number,     // rendered icon size in canvas pixels
): void {
  const centerX = (tileX + entityTileSize / 2) * TILE_SIZE;
  const topY = tileY * TILE_SIZE;
  const iconX = centerX - iconPx / 2;
  const iconY = topY - iconPx - 4;

  // Black outline (4-pass offset draw)
  ctx.globalCompositeOperation = 'source-over';
  for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    ctx.drawImage(img, iconX + dx, iconY + dy, iconPx, iconPx);
    // After drawing, overlay black at low opacity? No --
    // simpler: use a pre-rendered outline version, or accept
    // the raw sprite (OSRS overhead sprites already have built-in outlines)
  }
  // The OSRS overhead PNGs already include a black outline in the sprite itself.
  // So we just need a single drawImage call:
  ctx.drawImage(img, iconX, iconY, iconPx, iconPx);
}
```

Correction on outline approach: The OSRS `Protect_from_Magic_overhead.png` and `Protect_from_Missiles_overhead.png` sprites from the wiki already include their own black outlines. No multi-pass outline rendering needed. A single `ctx.drawImage()` suffices. If future sprites lack outlines, the 4-pass technique can be added as an option on `drawOverheadIcon`.

### Phase 6: Startup Gate & Integration

Wire the `AssetManager` into the app lifecycle so nothing renders until images are ready.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/main.ts` | Modify | Create `AssetManager` instance. Show a "Loading assets..." message. `await assetManager.ready()` before constructing `Renderer`, `SidePanel`, or `HUD`. Pass `assetManager` to `Renderer` constructor. Make `assetManager` accessible to panel classes (via module-level export or constructor injection). |
| `src/render/SidePanel.ts` | Modify | Accept `AssetManager` in constructor, pass to child panels if they need direct access (or panels use the module-level export). |

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `src/assets/manifest.ts` | Create | 1 |
| `src/assets/AssetManager.ts` | Create | 1 |
| `src/assets/index.ts` | Create | 1 |
| `tools/download-images.ts` | Create | 2 |
| `public/images/tabs/` | Create (dir) | 2 |
| `public/images/items/` | Create (dir) | 2 |
| `public/images/prayers/` | Create (dir) | 2 |
| `public/images/overhead/` | Create (dir) | 2 |
| `src/render/TabBar.ts` | Modify | 3 |
| `src/render/InventoryPanel.ts` | Modify | 3 |
| `src/entities/Inventory.ts` | Modify | 3 |
| `src/equipment/items.ts` | Modify | 3 |
| `src/render/osrs-theme.css` | Modify | 3 |
| `src/render/PrayerPanel.ts` | Modify | 4 |
| `src/render/EquipmentPanel.ts` | Modify | 4 |
| `src/render/Renderer.ts` | Modify | 5 |
| `src/main.ts` | Modify | 6 |
| `src/render/SidePanel.ts` | Modify | 6 |

**New files:** 4 | **Modified files:** 9 | **New directories:** 4 | **Total touched:** 13

---

## Definition of Done

1. **AssetManager loads all images before first render** -- `AssetManager.ready()` resolves only after every entry in `ASSET_MANIFEST` has a decoded `HTMLImageElement`. If any image fails, the app shows an error listing the failed keys.
2. **Typed asset registry catches typos at compile time** -- Passing a string that is not in `AssetKey` to `AssetManager.get()` is a TypeScript error. No `any` casts in image-consuming code.
3. **All 14 tab icons are authentic OSRS images** -- No Unicode emoji remains in `TabBar`.
4. **Inventory items show OSRS sprites** -- Paddlefish, corrupted paddlefish, egniol potions (all 4 doses), all 9 weapon variants, and all 9 armor variants have real sprites. Colored rectangles are gone.
5. **All 29 prayer icons are real OSRS sprites** -- Non-interactive prayers are visually dimmed. Interactive prayers toggle between bright (active) and dimmed states.
6. **Equipment panel shows item sprites** -- Filled slots display the item image; empty slots show the text label.
7. **Player overhead icon on canvas** -- When Protect from Magic or Protect from Missiles is active, the corresponding overhead icon appears above the player tile on the game canvas.
8. **Boss overhead icon on canvas** -- The boss always shows an overhead icon matching its current attack style (ranged = Protect from Missiles icon, magic = Protect from Magic icon). The icon updates immediately on style switch.
9. **Correct z-ordering** -- Overhead icons render above entity rectangles but below hit splats.
10. **`image-rendering: pixelated`** -- All OSRS sprites in DOM elements use pixelated rendering. Canvas images are drawn with `ctx.imageSmoothingEnabled = false`.
11. **Build-time download script works** -- `npx tsx tools/download-images.ts` fetches all images to `public/images/`, is idempotent, and reports failures.
12. **All 77 existing tests pass** -- No regressions.
13. **New tests:**
    - `AssetManager`: resolves `ready()` after all images load; `get()` returns correct image; `get()` throws on unknown key; `ready()` rejects if an image fails.
    - `manifest`: every `AssetKey` has a valid path; `itemIdToAssetKey()` maps all known item IDs correctly.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| OSRS wiki may rate-limit or block automated downloads | Medium | Download script includes polite delays (200ms between requests). Images are committed to repo or `.gitignore`'d with a setup instruction. Script is idempotent -- re-run only fetches missing files. |
| Large number of images (~70) increases initial load time | Low | All images are small PNGs (25x30 px). Total payload is under 200KB. `Promise.all` parallelizes browser loads. If needed, split into critical (overhead icons, active tab sprites) and deferred sets in a future sprint. |
| Canvas overhead icon positioning breaks at different zoom levels or canvas sizes | Low | All positioning is relative to `TILE_SIZE` and `GRID_SIZE` constants. No hardcoded pixel offsets. The `drawOverheadIcon` helper takes entity position and size as parameters. |
| Replacing `color: string` with `assetKey: AssetKey` on `InventoryItem` breaks tests that construct items with color fields | Medium | Phase 3 includes updating all test fixtures. The `color` field can be kept as optional/deprecated during transition if needed, but clean removal is preferred. |
| Prayer panel refactor (removing `spriteActive`/`spriteInactive` in favor of CSS brightness toggling) may regress existing prayer visuals | Low | The existing extracted sprites at `/docs/assets/sprites/` are replaced by wiki sprites, but the toggle mechanism is simpler (CSS class, not src swap). Test with both prayers before merging. |

---

## Dependencies

- **Sprint 2 complete** -- Side panel with 3 functional tabs, inventory interaction, prayer toggling, equipment panel, 77 tests passing.
- **OSRS wiki image availability** -- All URLs listed in the intent doc are verified working. The download script codifies these.
- **Node.js `fetch`** -- The download script uses Node 18+ built-in `fetch`. No new npm dependencies.
- **No runtime dependencies** -- Zero new packages. `AssetManager` uses only `HTMLImageElement` and `Promise`.

---

## Open Questions

1. **Should `AssetManager` be a true singleton (module-level instance) or dependency-injected?** Module-level is simpler for panel code (`import { assets } from '../assets'`), but DI is better for testing. Recommendation: export a factory function `createAssetManager()` and a module-level `let assets: AssetManager` that `main.ts` initializes. Tests create their own instances. Panels import the module-level reference.

2. **Should overhead icons bob/animate?** OSRS overhead icons have a subtle vertical bob (sine wave, ~2px amplitude, ~1 second period). For a training tool, static positioning is clearer and avoids visual noise during rapid prayer switches. Recommendation: skip animation for this sprint. If players request it, add a `OVERHEAD_BOB_AMPLITUDE` constant that defaults to 0 and can be enabled later.

3. **Should overhead icons have a drop shadow?** The wiki overhead sprites already include black outlines, which provide sufficient contrast against the dark arena background. An additional drop shadow would add visual clutter. Recommendation: no shadow. If the arena gets lighter floor tiles in a future sprint, revisit.

4. **Should the boss overhead show its attack style icon, or the prayer the player *should* be using?** These are the same thing (ranged attack = should pray missiles, magic attack = should pray magic), so the question is about icon choice. Recommendation: show the matching protection prayer overhead icon (Protect from Missiles for ranged, Protect from Magic for magic). This is what OSRS players are trained to recognize, and it directly communicates "pray this now."

5. **Should non-interactive prayers in the panel be completely hidden or just dimmed?** OSRS shows all prayers but grays out those below level requirement. Since this is a CG sim where the player presumably has 77 prayer, all prayers meet the level req. Recommendation: show all 29 with real icons. The non-interactive ones (not relevant to CG) get `opacity: 0.4` and no click handler, matching the current behavior but with real sprites.

6. **Should the download script be an npm script or a standalone tool?** Recommendation: add `"download-images": "tsx tools/download-images.ts"` to `package.json` scripts. Document in the project README that running it once is required after clone (or commit the images to the repo if they are small enough -- ~200KB total is fine to commit).

7. **Future-proofing: should `ASSET_MANIFEST` support animation frames?** Some future sprites (tornado, boss model) may need multiple frames. Recommendation: keep the current manifest as single-image entries. When animation is needed (likely sprint 5+), extend the manifest value type to `{ path: string; w: number; h: number; frames?: number; frameWidth?: number }` and add a `getFrame(key, frameIndex)` method to `AssetManager`. Do not build this now.
