# Sprint 003: Authentic OSRS Images — Asset Pipeline, Item Sprites, Overhead Prayers

## Overview

Build a complete asset pipeline that fetches authentic OSRS images from the wiki, organizes them locally, and wires them into every visual surface of the simulator. A download script in `tools/` fetches all required PNGs from the OSRS wiki `Special:FilePath/` endpoint and saves them to `public/images/` organized by category. A TypeScript asset manifest maps item IDs and prayer IDs to their local image paths. All images are preloaded before the first render frame. Tab icons, inventory item sprites, prayer icons, and equipment slot sprites replace the current Unicode glyphs, colored rectangles, and text labels. Active protection prayers render as overhead icons on the canvas above both the player and the Hunlef.

**What ships:** Every placeholder visual in the UI is replaced with an authentic OSRS image sourced from the wiki. The canvas shows overhead prayer icons above the player (their active protection prayer) and above the boss (its current attack style). All images are locally served from `public/images/` with no runtime wiki fetching. A reusable download script makes it trivial to add new images in future sprints.

**What's deferred:** Animated sprites (e.g., Hunlef attack animations), entity model sprites on the canvas (player/boss remain colored rectangles), right-click item examine with item icons, mobile touch targets.

---

## Use Cases

1. **UC-1: Asset download** — A developer runs `node tools/download-osrs-images.mjs` and all required OSRS images are fetched from the wiki and saved to `public/images/{category}/`. The script is idempotent: existing files are skipped. The script reports which files were downloaded, skipped, or failed.

2. **UC-2: Tab icons** — The 14-tab bar displays authentic OSRS tab icons (backpack for Inventory, prayer star for Prayer, helmet for Equipment, etc.) instead of Unicode glyphs. Icons render at their native size with `image-rendering: pixelated` for the authentic OSRS pixel-art look.

3. **UC-3: Inventory item sprites** — Each inventory slot displays the real OSRS item sprite (paddlefish, corrupted paddlefish, egniol potion with dose-specific sprite, corrupted bow/staff/halberd at the correct tier). The colored rectangle and text label are replaced by a 32x32 `<img>` element with a transparent background.

4. **UC-4: Prayer panel icons** — All 29 prayers in the 5x6 grid display their real OSRS prayer icon instead of text labels. Active prayers show the bright variant; inactive prayers show the dimmed variant.

5. **UC-5: Equipment slot sprites** — Equipped items in the paper doll (helm, body, legs, weapon) show the corresponding OSRS item sprite instead of plain text.

6. **UC-6: Overhead prayer on player** — When the player has Protect from Magic or Protect from Missiles active, the corresponding overhead prayer icon renders on the canvas above the player's tile, matching OSRS visual language.

7. **UC-7: Overhead attack style on boss** — The Hunlef's current attack style (ranged or magic) renders as an overhead icon above the boss on the canvas. This is a training aid — real OSRS does not show an overhead on the boss, but it helps learners identify the incoming attack style.

---

## Architecture

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image source | OSRS wiki `Special:FilePath/<Name>.png` | Canonical source, all URLs verified in intent doc. Serves raw PNGs directly. |
| Download mechanism | Node.js script in `tools/` using `fetch()` (Node 18+) | No new dependencies. Script runs once, results committed to `public/images/`. |
| Local image organization | `public/images/{tabs,items,prayers,overheads}/` | Flat category dirs. Vite serves `public/` as static assets at `/images/...`. |
| Asset manifest | `src/render/assets.ts` — const object mapping IDs to paths | Compile-time type safety. No runtime resolution logic. Single source of truth for all image paths. |
| Preloading | `ImagePreloader` class loads all canvas images as `HTMLImageElement` before first draw | Canvas `drawImage()` requires loaded `Image` objects. DOM `<img>` elements handle their own loading. Only overhead icons (used on canvas) need explicit preloading. |
| Pixel rendering | `image-rendering: pixelated` on all `<img>` elements + `ctx.imageSmoothingEnabled = false` on canvas | OSRS uses nearest-neighbor scaling. Without this, browser bilinear interpolation blurs the pixel art. |
| Transparent backgrounds | Wiki PNGs already have alpha transparency | No processing needed. Just ensure CSS backgrounds do not bleed through unexpectedly. |
| Overhead icon positioning | Centered above entity, offset upward by entity height + 8px | Standard OSRS overhead positioning. For the 5x5 boss, centered above the 5-tile-wide body. |

### Component Changes

```
tools/download-osrs-images.mjs (new)
  └── Fetches all PNGs from wiki → public/images/{category}/

src/render/assets.ts (new)
  ├── ASSET_PATHS: Record<string, string>   — full manifest
  ├── TAB_ICONS: Record<tabId, string>      — tab icon paths
  ├── ITEM_SPRITES: Record<itemId, string>  — inventory/equipment item sprites
  ├── PRAYER_ICONS: Record<prayerId, { active: string, inactive: string }>
  └── OVERHEAD_ICONS: Record<string, string>

src/render/ImagePreloader.ts (new)
  └── Loads overhead icon images as HTMLImageElement for canvas use
  └── Returns Promise<Map<string, HTMLImageElement>>

src/render/TabBar.ts (modify)
  └── Replace el.textContent = icon with <img src="..."> from TAB_ICONS

src/render/InventoryPanel.ts (modify)
  └── Replace colored div + text label with <img> from ITEM_SPRITES

src/render/PrayerPanel.ts (modify)
  └── Replace text labels with <img> from PRAYER_ICONS for all 29 prayers
  └── Swap active/inactive src on prayer state change

src/render/EquipmentPanel.ts (modify)
  └── Add <img> elements in filled slots from ITEM_SPRITES

src/render/Renderer.ts (modify)
  └── Draw overhead prayer icons above player and boss using preloaded images

src/entities/Inventory.ts (modify)
  └── Add spriteId field to InventoryItem for manifest lookup

src/equipment/items.ts (modify)
  └── Add spriteId to Weapon and ArmorSet for manifest lookup
```

### Preloading Strategy

Only images drawn on the `<canvas>` via `ctx.drawImage()` require explicit preloading — these are the overhead prayer/attack style icons (4 images total). DOM `<img>` elements handle their own loading natively and do not block rendering (they pop in when loaded, which is fine for panel UI since images are local and load in <1ms).

```
Application startup:
  1. ImagePreloader.loadAll() — fetches overhead icons into HTMLImageElement map
  2. Promise resolves → Renderer receives preloaded image map
  3. First draw call can safely use ctx.drawImage() without missing frames

Panel rendering:
  - TabBar, InventoryPanel, PrayerPanel, EquipmentPanel all use <img src="...">
  - No preloading needed — browser handles loading from local /public/ path
  - CSS: image-rendering: pixelated on all .osrs-sprite img elements
```

---

## Implementation

### Phase 1: Download Script + Directory Structure (~15% effort)

**Files:**
- `tools/download-osrs-images.mjs` — New
- `public/images/tabs/` — New directory (created by script)
- `public/images/items/` — New directory
- `public/images/prayers/` — New directory
- `public/images/overheads/` — New directory

**Tasks:**
- [ ] Create `tools/download-osrs-images.mjs` using Node.js built-in `fetch()` (Node 18+):
  ```javascript
  const WIKI_BASE = 'https://oldschool.runescape.wiki/images';
  // For each image, fetch from Special:FilePath which redirects to the CDN
  // Save to public/images/{category}/{filename}.png
  ```
- [ ] Define the complete image manifest in the script as a const array:
  ```javascript
  const IMAGES = [
    // Tab icons (14)
    { category: 'tabs', filename: 'Inventory.png', wikiName: 'Inventory.png' },
    { category: 'tabs', filename: 'Prayer_tab_icon.png', wikiName: 'Prayer_tab_icon.png' },
    { category: 'tabs', filename: 'Worn_Equipment.png', wikiName: 'Worn_Equipment.png' },
    { category: 'tabs', filename: 'Combat_icon.png', wikiName: 'Combat_icon.png' },
    { category: 'tabs', filename: 'Skills_icon.png', wikiName: 'Skills_icon.png' },
    { category: 'tabs', filename: 'Quest_List_tab_icon.png', wikiName: 'Quest_List_tab_icon.png' },
    { category: 'tabs', filename: 'Spellbook.png', wikiName: 'Spellbook.png' },
    { category: 'tabs', filename: 'Your_Clan_icon.png', wikiName: 'Your_Clan_icon.png' },
    { category: 'tabs', filename: 'Friends_List.png', wikiName: 'Friends_List.png' },
    { category: 'tabs', filename: 'Ignore_List.png', wikiName: 'Ignore_List.png' },
    { category: 'tabs', filename: 'Logout.png', wikiName: 'Logout.png' },
    { category: 'tabs', filename: 'Settings.png', wikiName: 'Settings.png' },
    { category: 'tabs', filename: 'Emotes_button.png', wikiName: 'Emotes_button.png' },
    { category: 'tabs', filename: 'Music.png', wikiName: 'Music.png' },

    // Item sprites (~30)
    { category: 'items', filename: 'Paddlefish.png', wikiName: 'Paddlefish.png' },
    { category: 'items', filename: 'Corrupted_paddlefish.png', wikiName: 'Corrupted_paddlefish.png' },
    // Egniol potions (4 dose variants)
    ...([1,2,3,4].map(n => ({
      category: 'items', filename: `Egniol_potion_(${n}).png`, wikiName: `Egniol_potion_(${n}).png`
    }))),
    // Corrupted weapons (3 types x 3 tiers)
    ...(['bow','staff','halberd'].flatMap(type =>
      ['basic','attuned','perfected'].map(tier => ({
        category: 'items',
        filename: `Corrupted_${type}_(${tier}).png`,
        wikiName: `Corrupted_${type}_(${tier}).png`
      }))
    )),
    // Corrupted armor (3 pieces x 3 tiers)
    ...(['helm','body','legs'].flatMap(piece =>
      ['basic','attuned','perfected'].map(tier => ({
        category: 'items',
        filename: `Corrupted_${piece}_(${tier}).png`,
        wikiName: `Corrupted_${piece}_(${tier}).png`
      }))
    )),

    // Prayer icons (29 prayers, active variants)
    // ... all 29 prayer PNGs

    // Overhead icons (2 protection prayers)
    { category: 'overheads', filename: 'Protect_from_Magic_overhead.png', wikiName: 'Protect_from_Magic_overhead.png' },
    { category: 'overheads', filename: 'Protect_from_Missiles_overhead.png', wikiName: 'Protect_from_Missiles_overhead.png' },
  ];
  ```
- [ ] Implement idempotent download: skip files that already exist on disk
- [ ] Add `--force` flag to re-download all files regardless
- [ ] Add rate limiting: 100ms delay between requests to be respectful to the wiki
- [ ] Log results: `[SKIP] tabs/Inventory.png (exists)`, `[OK] items/Paddlefish.png (2.3 KB)`, `[FAIL] ...`
- [ ] Add `"download-images"` script to `package.json`: `"node tools/download-osrs-images.mjs"`
- [ ] Create `.gitkeep` files in each `public/images/{category}/` directory so git tracks the structure
- [ ] Add `public/images/` to `.gitignore` (images are fetched, not committed) OR commit the images (small PNGs, ~100KB total). Decision: commit them so the project works out of the box without running the script.

### Phase 2: Asset Manifest + Preloader (~15% effort)

**Files:**
- `src/render/assets.ts` — New
- `src/render/ImagePreloader.ts` — New

**Tasks:**
- [ ] Create `src/render/assets.ts` with typed const manifest:
  ```typescript
  // Tab icon paths keyed by tab ID (matches TabBar TabDef.id)
  export const TAB_ICONS: Record<string, string> = {
    combat: '/images/tabs/Combat_icon.png',
    stats: '/images/tabs/Skills_icon.png',
    quests: '/images/tabs/Quest_List_tab_icon.png',
    equipment: '/images/tabs/Worn_Equipment.png',
    prayer: '/images/tabs/Prayer_tab_icon.png',
    spellbook: '/images/tabs/Spellbook.png',
    clan: '/images/tabs/Your_Clan_icon.png',
    friends: '/images/tabs/Friends_List.png',
    ignore: '/images/tabs/Ignore_List.png',
    logout: '/images/tabs/Logout.png',
    settings: '/images/tabs/Settings.png',
    emotes: '/images/tabs/Emotes_button.png',
    music: '/images/tabs/Music.png',
    inventory: '/images/tabs/Inventory.png',
  };

  // Item sprites keyed by InventoryItem.id or composite key
  export const ITEM_SPRITES: Record<string, string> = {
    paddlefish: '/images/items/Paddlefish.png',
    corrupted_paddlefish: '/images/items/Corrupted_paddlefish.png',
    egniol_1: '/images/items/Egniol_potion_(1).png',
    egniol_2: '/images/items/Egniol_potion_(2).png',
    egniol_3: '/images/items/Egniol_potion_(3).png',
    egniol_4: '/images/items/Egniol_potion_(4).png',
    bow_1: '/images/items/Corrupted_bow_(basic).png',
    bow_2: '/images/items/Corrupted_bow_(attuned).png',
    bow_3: '/images/items/Corrupted_bow_(perfected).png',
    staff_1: '/images/items/Corrupted_staff_(basic).png',
    staff_2: '/images/items/Corrupted_staff_(attuned).png',
    staff_3: '/images/items/Corrupted_staff_(perfected).png',
    halberd_1: '/images/items/Corrupted_halberd_(basic).png',
    halberd_2: '/images/items/Corrupted_halberd_(attuned).png',
    halberd_3: '/images/items/Corrupted_halberd_(perfected).png',
  };

  // Armor sprites keyed by "{piece}_{tier}"
  export const ARMOR_SPRITES: Record<string, string> = {
    helm_1: '/images/items/Corrupted_helm_(basic).png',
    helm_2: '/images/items/Corrupted_helm_(attuned).png',
    helm_3: '/images/items/Corrupted_helm_(perfected).png',
    body_1: '/images/items/Corrupted_body_(basic).png',
    body_2: '/images/items/Corrupted_body_(attuned).png',
    body_3: '/images/items/Corrupted_body_(perfected).png',
    legs_1: '/images/items/Corrupted_legs_(basic).png',
    legs_2: '/images/items/Corrupted_legs_(attuned).png',
    legs_3: '/images/items/Corrupted_legs_(perfected).png',
  };

  // Prayer icons keyed by prayer ID from PrayerPanel PRAYERS array
  export const PRAYER_ICONS: Record<string, string> = {
    thick_skin: '/images/prayers/Thick_Skin.png',
    burst_of_strength: '/images/prayers/Burst_of_Strength.png',
    // ... all 29 prayers
  };

  // Overhead icons for canvas rendering
  export const OVERHEAD_ICONS = {
    protect_magic: '/images/overheads/Protect_from_Magic_overhead.png',
    protect_missiles: '/images/overheads/Protect_from_Missiles_overhead.png',
  } as const;
  ```
- [ ] Create `src/render/ImagePreloader.ts`:
  ```typescript
  export class ImagePreloader {
    private images: Map<string, HTMLImageElement> = new Map();

    async loadAll(): Promise<void> {
      const entries = Object.entries(OVERHEAD_ICONS);
      await Promise.all(entries.map(([key, src]) => this.loadOne(key, src)));
    }

    private loadOne(key: string, src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { this.images.set(key, img); resolve(); };
        img.onerror = () => reject(new Error(`Failed to load: ${src}`));
        img.src = src;
      });
    }

    get(key: string): HTMLImageElement | undefined {
      return this.images.get(key);
    }
  }
  ```
- [ ] Preloader loads only the overhead icons (4 images). All other images are DOM `<img>` elements that load natively.
- [ ] Add error handling: if an overhead icon fails to load, log a warning and fall back to drawing a colored circle (graceful degradation, no crash).

### Phase 3: Tab Bar Image Icons (~10% effort)

**Files:**
- `src/render/TabBar.ts` — Modify
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Update `TabDef` interface: replace `icon: string` (Unicode) with `iconPath: string` (image path from `TAB_ICONS`):
  ```typescript
  interface TabDef {
    id: string;
    label: string;
    iconPath: string;   // was 'icon: string'
    enabled: boolean;
  }
  ```
- [ ] Update `TABS_TOP` and `TABS_BOTTOM` arrays: populate `iconPath` from `TAB_ICONS` manifest
- [ ] Update `createTab()` method: replace `el.textContent = def.icon` with:
  ```typescript
  const img = document.createElement('img');
  img.src = def.iconPath;
  img.alt = def.label;
  img.draggable = false;
  img.classList.add('osrs-tab-icon');
  el.appendChild(img);
  ```
- [ ] Add CSS for tab icons:
  ```css
  .osrs-tab-icon {
    width: 20px;
    height: 20px;
    image-rendering: pixelated;
    object-fit: contain;
    pointer-events: none;
  }
  ```
- [ ] Disabled tabs: apply `filter: brightness(0.5)` to the icon image
- [ ] Verify all 14 tab icons render at correct size without distortion

### Phase 4: Inventory Item Sprites (~15% effort)

**Files:**
- `src/render/InventoryPanel.ts` — Modify
- `src/entities/Inventory.ts` — Modify
- `src/render/assets.ts` — Referenced
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Add `spriteId` field to `InventoryItem` interface in `Inventory.ts`:
  ```typescript
  export interface InventoryItem {
    id: string;
    name: string;
    category: 'food' | 'combo_food' | 'potion' | 'weapon';
    quantity: number;
    color: string;      // kept as fallback
    spriteId: string;   // NEW — key into ITEM_SPRITES manifest
  }
  ```
- [ ] Update `Inventory.buildFromLoadout()` to populate `spriteId` for every item:
  - Weapons: `spriteId = '${config.weaponType}_${config.weaponTier}'` (e.g., `'bow_3'`)
  - Egniol potions: `spriteId = 'egniol_${doses}'` (changes as doses decrement)
  - Paddlefish: `spriteId = 'paddlefish'`
  - Corrupted paddlefish: `spriteId = 'corrupted_paddlefish'`
- [ ] Update `Inventory.decrementDose()` to update `spriteId` alongside existing `id` and `name` updates
- [ ] Rewrite `InventoryPanel.update()` to render `<img>` sprites instead of colored divs:
  ```typescript
  if (item) {
    slot.classList.add('has-item');
    slot.innerHTML = '';

    const spritePath = ITEM_SPRITES[item.spriteId];
    if (spritePath) {
      const img = document.createElement('img');
      img.src = spritePath;
      img.alt = item.name;
      img.draggable = false;
      img.classList.add('osrs-item-sprite');
      slot.appendChild(img);
    } else {
      // Fallback: colored rectangle (existing behavior)
      const icon = document.createElement('div');
      icon.classList.add('item-icon');
      icon.style.backgroundColor = item.color;
      slot.appendChild(icon);
    }

    // Potion dose overlay (still needed on top of sprite)
    if (item.category === 'potion' && item.quantity > 0) {
      const dose = document.createElement('div');
      dose.classList.add('dose-overlay');
      dose.textContent = String(item.quantity);
      slot.appendChild(dose);
    }
  }
  ```
- [ ] CSS for item sprites:
  ```css
  .osrs-item-sprite {
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
    object-fit: contain;
    pointer-events: none;
  }
  ```
- [ ] Remove the text `item-name` element — the sprite replaces the name label. Item names can be shown on hover via `title` attribute on the slot element.
- [ ] Verify all item sprites render with transparent backgrounds (no white box artifacts)

### Phase 5: Prayer Panel Icons (~15% effort)

**Files:**
- `src/render/PrayerPanel.ts` — Modify
- `src/render/assets.ts` — Referenced
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Add all 29 prayer image filenames to the download script and asset manifest. Full list:
  ```
  Thick_Skin, Burst_of_Strength, Clarity_of_Thought, Sharp_Eye, Mystic_Will,
  Rock_Skin, Superhuman_Strength, Improved_Reflexes, Rapid_Restore, Rapid_Heal,
  Protect_Item, Hawk_Eye, Mystic_Lore, Steel_Skin, Ultimate_Strength,
  Incredible_Reflexes, Protect_from_Magic, Protect_from_Missiles,
  Protect_from_Melee, Eagle_Eye, Mystic_Might, Retribution, Redemption,
  Smite, Preserve, Chivalry, Piety, Rigour, Augury
  ```
- [ ] Update `PrayerDef` to use manifest paths instead of hardcoded sprite paths:
  ```typescript
  interface PrayerDef {
    id: string;
    name: string;
    row: number;
    col: number;
    levelReq: number;
    interactive: boolean;
    iconPath: string;   // from PRAYER_ICONS manifest
  }
  ```
- [ ] Remove the old `spriteActive` / `spriteInactive` fields that reference `/docs/assets/sprites/sprite_*` paths
- [ ] Update `build()` to render `<img>` for ALL 29 prayers (not just the two interactive ones):
  ```typescript
  const img = document.createElement('img');
  img.src = PRAYER_ICONS[prayer.id];
  img.alt = prayer.name;
  img.draggable = false;
  img.classList.add('osrs-prayer-icon');
  cell.appendChild(img);
  ```
- [ ] Active/inactive visual state: use CSS `filter` and `opacity` rather than swapping image `src`:
  ```css
  .osrs-prayer-icon {
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
    object-fit: contain;
    filter: brightness(0.6);
    opacity: 0.7;
  }
  .osrs-prayer-cell.active .osrs-prayer-icon {
    filter: brightness(1.2);
    opacity: 1.0;
  }
  .osrs-prayer-cell:not(.interactive) .osrs-prayer-icon {
    filter: brightness(0.4);
    opacity: 0.35;
  }
  ```
  This avoids needing separate active/inactive image files for each prayer. The wiki provides a single icon per prayer; CSS brightness adjustment achieves the visual distinction.
- [ ] Update `update()` to toggle only the `.active` CSS class instead of swapping `img.src`
- [ ] Remove the text-label fallback for non-interactive prayers — all 29 now have real icons

### Phase 6: Equipment Slot Sprites (~10% effort)

**Files:**
- `src/render/EquipmentPanel.ts` — Modify
- `src/render/assets.ts` — Referenced

**Tasks:**
- [ ] Update `EquipmentPanel.update()` to render item sprites in filled slots:
  ```typescript
  case 'head':
    if (armor.tier > 0) {
      el.classList.add('filled');
      el.innerHTML = '';
      const img = document.createElement('img');
      img.src = ARMOR_SPRITES[`helm_${armor.tier}`];
      img.classList.add('osrs-item-sprite');
      el.appendChild(img);
    }
    break;
  case 'weapon':
    el.classList.add('filled');
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = ITEM_SPRITES[`${weapon.type}_${weapon.tier}`];
    img.classList.add('osrs-item-sprite');
    el.appendChild(img);
    break;
  ```
- [ ] Map equipment slot IDs to sprite keys: `head → helm_{tier}`, `body → body_{tier}`, `legs → legs_{tier}`, `weapon → {type}_{tier}`
- [ ] Empty slots retain their text label as before (no sprite for empty slots)
- [ ] Add `title` attribute with item name for hover tooltip

### Phase 7: Overhead Prayer Icons on Canvas (~15% effort)

**Files:**
- `src/render/Renderer.ts` — Modify
- `src/render/ImagePreloader.ts` — Referenced
- `src/main.ts` — Modify (wire preloader into renderer)

**Tasks:**
- [ ] Add `ImagePreloader` dependency to `Renderer`:
  ```typescript
  export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private preloader: ImagePreloader;

    constructor(canvas: HTMLCanvasElement, preloader: ImagePreloader) {
      // ...existing setup...
      this.preloader = preloader;
      this.ctx.imageSmoothingEnabled = false; // pixelated rendering for all canvas images
    }
  }
  ```
- [ ] Add overhead icon drawing in `draw()` after player and boss rendering:
  ```typescript
  // Player overhead prayer icon
  const activePrayer = sim.prayerManager.activePrayer;
  if (activePrayer) {
    const iconKey = activePrayer === 'magic' ? 'protect_magic' : 'protect_missiles';
    const icon = this.preloader.get(iconKey);
    if (icon) {
      const px = player.pos.x * TILE_SIZE + TILE_SIZE / 2;
      const py = player.pos.y * TILE_SIZE - 8;
      const iconSize = 24;
      ctx.drawImage(icon, px - iconSize / 2, py - iconSize, iconSize, iconSize);
    }
  }

  // Boss overhead attack style icon
  const bossStyle = sim.boss.currentStyle;
  const bossIconKey = bossStyle === 'magic' ? 'protect_magic' : 'protect_missiles';
  const bossIcon = this.preloader.get(bossIconKey);
  if (bossIcon) {
    const bx = (boss.pos.x + boss.size / 2) * TILE_SIZE;
    const by = boss.pos.y * TILE_SIZE - 8;
    const iconSize = 28;
    ctx.drawImage(bossIcon, bx - iconSize / 2, by - iconSize, iconSize, iconSize);
  }
  ```
- [ ] Ensure `ctx.imageSmoothingEnabled = false` is set at the start of every `draw()` call (some browsers reset it)
- [ ] Overhead icons render above hit splats (draw order: grid, boss, player, overheads, hit splats)
- [ ] Update `main.ts` startup flow:
  ```typescript
  const preloader = new ImagePreloader();
  await preloader.loadAll();
  const renderer = new Renderer(canvas, preloader);
  // ... rest of startup
  ```
- [ ] Handle the case where preloading fails: renderer draws without overhead icons, logs warning

### Phase 8: Image Optimization + Polish (~5% effort)

**Files:**
- `src/render/osrs-theme.css` — Modify
- Various render files — Minor tweaks

**Tasks:**
- [ ] Add global CSS rule for all OSRS sprite images:
  ```css
  img[class*="osrs-"] {
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    -ms-interpolation-mode: nearest-neighbor;
  }
  ```
- [ ] Verify no images have white/colored backgrounds leaking through transparent areas
- [ ] Ensure inventory slot `<img>` elements do not cause layout shifts (set explicit `width`/`height` attributes)
- [ ] Test that dose overlay renders correctly on top of potion sprites (z-index stacking)
- [ ] Verify overhead icons are visible against both light and dark tile backgrounds on the canvas
- [ ] Test graceful fallback: if `public/images/` is empty (images not downloaded), colored rectangles and text labels still render for all panels

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/download-osrs-images.mjs` | Create | Node.js script to fetch all OSRS images from wiki to `public/images/` |
| `public/images/tabs/*.png` | Create (14 files) | Tab bar icons (Inventory, Prayer, Equipment, etc.) |
| `public/images/items/*.png` | Create (~30 files) | Item sprites (food, potions, weapons, armor) |
| `public/images/prayers/*.png` | Create (29 files) | Prayer panel icons for all 29 prayers |
| `public/images/overheads/*.png` | Create (2 files) | Overhead protection prayer icons for canvas |
| `src/render/assets.ts` | Create | TypeScript const manifest mapping IDs to image paths |
| `src/render/ImagePreloader.ts` | Create | Async loader for canvas-bound images (overhead icons) |
| `src/render/TabBar.ts` | Modify | Replace Unicode glyphs with `<img>` elements from TAB_ICONS |
| `src/render/InventoryPanel.ts` | Modify | Replace colored divs with `<img>` item sprites |
| `src/render/PrayerPanel.ts` | Modify | Replace text labels and old sprite paths with wiki prayer icons |
| `src/render/EquipmentPanel.ts` | Modify | Add item sprites to filled equipment slots |
| `src/render/Renderer.ts` | Modify | Draw overhead prayer icons on canvas above player and boss |
| `src/render/osrs-theme.css` | Modify | Add `image-rendering: pixelated` rules, sprite sizing classes |
| `src/entities/Inventory.ts` | Modify | Add `spriteId` field to `InventoryItem` interface |
| `src/equipment/items.ts` | Modify | Add `spriteId` to `Weapon` and `ArmorSet` interfaces |
| `src/main.ts` | Modify | Wire `ImagePreloader` into startup, pass to `Renderer` |
| `package.json` | Modify | Add `"download-images"` script |

---

## Definition of Done

- [ ] `node tools/download-osrs-images.mjs` successfully downloads all ~75 images to `public/images/` organized by category
- [ ] Running the script a second time skips all existing files (idempotent)
- [ ] `src/render/assets.ts` contains typed const mappings for every downloaded image, with no missing keys
- [ ] All 14 tab icons render as OSRS images (no Unicode glyphs remain)
- [ ] All inventory items display real OSRS item sprites (no colored rectangles remain)
- [ ] Egniol potions show the correct dose-specific sprite (4-dose, 3-dose, etc.) and update when a dose is consumed
- [ ] All 29 prayer icons in the 5x6 grid show real OSRS prayer images (no text labels remain)
- [ ] Active prayers are visually brighter; inactive prayers are dimmed; non-interactive prayers are heavily dimmed
- [ ] Equipped items in the equipment panel show item sprites in the paper doll slots
- [ ] Player's active protection prayer renders as an overhead icon above the player on the canvas
- [ ] Boss's current attack style renders as an overhead icon above the Hunlef on the canvas
- [ ] All images use `image-rendering: pixelated` — no blurry bilinear interpolation
- [ ] Canvas images use `ctx.imageSmoothingEnabled = false`
- [ ] All images have transparent backgrounds (no white/colored box artifacts)
- [ ] Overhead icons are preloaded before the first draw frame (no missing-image flicker)
- [ ] If images are not present (download script not run), the UI degrades gracefully to colored rectangles and text labels
- [ ] All existing 77 tests pass without modification
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] No runtime network requests to the OSRS wiki (all images served from `public/images/`)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Wiki image URLs change or return 404 | Low | High | The download script logs failures clearly. All URLs were verified in the intent doc. If a URL changes, update the `wikiName` mapping in the script. Consider pinning to a known-good wiki revision URL. |
| Wiki rate-limits or blocks the download script | Medium | Medium | 100ms delay between requests. User-Agent header identifies the tool. Total request count is ~75, well within reason. If blocked, images can be manually downloaded via browser. |
| Image sizes vary, causing layout inconsistency | Medium | Low | All `<img>` elements have explicit CSS `width`/`height` constraints. `object-fit: contain` prevents distortion. Tab icons are 20x20, item sprites 32x32, prayer icons 32x32. |
| Preloader fails, canvas draw crashes | Low | High | `Renderer.draw()` checks `preloader.get()` return value before calling `drawImage()`. If undefined, skip overhead icon silently. |
| Large number of DOM `<img>` elements hurts performance | Low | Low | Maximum ~28 inventory + 29 prayer + 11 equipment + 14 tab = ~82 `<img>` elements. Trivial for modern browsers. All local, no network waterfall. |
| Browser caching causes stale images after update | Low | Low | Vite adds content hashes to public assets in production builds. During dev, Vite's dev server handles cache busting. |
| Transparent PNG backgrounds look wrong on stone texture | Low | Medium | Test each category against its container background. If needed, add a subtle inner shadow or background color to inventory slots for contrast. |

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged from Sprint 2).

### Dev
No new dev dependencies. Node.js 18+ built-in `fetch()` is used for the download script. Existing Vite + TypeScript + Vitest toolchain is sufficient.

### External Assets (downloaded at build time)

| Asset Category | Source | Count | Approx Size |
|---------------|--------|-------|-------------|
| Tab icons | OSRS Wiki `Special:FilePath/` | 14 | ~15 KB total |
| Item sprites | OSRS Wiki `Special:FilePath/` | ~30 | ~40 KB total |
| Prayer icons | OSRS Wiki `Special:FilePath/` | 29 | ~30 KB total |
| Overhead icons | OSRS Wiki `Special:FilePath/` | 2 | ~3 KB total |
| **Total** | | **~75** | **~88 KB** |

All images are small PNGs (mostly 25x25 to 36x36 pixels) with transparent backgrounds. The OSRS Wiki serves these under fair-use terms for fan projects.

---

## Open Questions

1. **Commit images or gitignore them?** The ~75 PNGs total ~88 KB. Committing them means the project works out of the box after `git clone` without running the download script. Gitignoring them keeps the repo lighter but requires an extra setup step. Recommendation: commit them. 88 KB is negligible and eliminates a footgun for new contributors.

2. **Boss overhead icon — use protection prayer icons or distinct attack style icons?** The intent doc suggests showing the boss's attack style as an overhead. OSRS does not have distinct "ranged attack" or "magic attack" overhead icons for monsters. Options: (a) reuse the protection prayer overhead icons (mage overhead above boss when it attacks with magic), (b) use colored circles (green for ranged, purple for magic) like the existing border color. Recommendation: option (a) — reuse protection prayer overheads. It reinforces the association between the boss's attack and the correct prayer to use.

3. **Prayer icon active/inactive — single image + CSS or two separate images?** The OSRS wiki provides one image per prayer. The active/inactive distinction in OSRS comes from the game cache (different sprite IDs for lit/unlit). We can either: (a) download both variants if available on the wiki, or (b) use a single image with CSS `filter: brightness()` for active/inactive states. Recommendation: option (b). CSS brightness is simpler, requires half the images, and looks close enough. If visual fidelity is insufficient, downloading the deactivated variants is a follow-up task.

4. **Download script language — .mjs or .ts?** Using `.mjs` avoids needing `ts-node` or a separate TypeScript compilation step for the tool. Using `.ts` keeps everything in one language. Recommendation: `.mjs` — it runs directly with `node` and the script is simple enough that TypeScript type safety adds no value.

5. **Should the download script also fetch entity sprites (player model, Hunlef model)?** The intent doc defers animated sprites and entity models. The download script could include placeholders for these in a `public/images/entities/` directory for a future sprint. Recommendation: add the directory structure but do not download entity images in this sprint. Keep the manifest extensible.

6. **Overhead icon draw order relative to hit splats?** In OSRS, overhead icons render above entity models but below hit splats. Should we match this, or render overheads on top of everything for visibility? Recommendation: match OSRS — draw overheads before hit splats.
