# Sprint 003: Authentic OSRS Images — Tab Icons, Item Sprites, Overhead Prayers

## Overview

Replace every placeholder visual with real OSRS images. Tab icons swap from Unicode emoji to wiki PNGs. Inventory items swap from colored rectangles to item sprites. Prayer icons swap from text labels/extracted sprites to wiki prayer PNGs. Overhead prayer icons render on the canvas above the player and boss. All images are downloaded once via a shell script into `public/images/` and served locally.

**What ships:** Every icon and sprite in the UI looks like the real game. A download script fetches all images from the OSRS wiki. The canvas shows overhead prayer icons above the player (active protection prayer) and above the boss (current attack style).

**What's deferred:** Animated sprites, ground item sprites, NPC models, tile textures, right-click examine with item images, tooltip popups.

---

## Use Cases

1. **UC-1: Tab icons** — All 14 tab buttons display authentic OSRS tab icons instead of Unicode glyphs. Enabled tabs at full opacity; disabled tabs at 35%.
2. **UC-2: Inventory item sprites** — Each inventory slot renders the item's wiki sprite image. Potion dose overlays remain. Text labels removed (image is self-explanatory).
3. **UC-3: Prayer panel icons** — All 29 prayer cells show the wiki prayer icon (inactive variant). Active protection prayers show the active variant. Non-interactive prayers remain dimmed.
4. **UC-4: Equipment panel sprites** — Equipped items (weapon, head, body, legs) show their wiki sprite in the paper doll slot.
5. **UC-5: Player overhead** — When a protection prayer is active, the corresponding overhead icon renders above the player rectangle on the canvas.
6. **UC-6: Boss overhead** — The boss displays an overhead icon matching its current attack style (ranged = Protect from Missiles icon, mage = Protect from Magic icon), helping learners see what they should be praying.

---

## Architecture

### Approach: Keep It Simple

No sprite atlas. No asset pipeline. No image loader abstraction. Just:

1. A shell script (`tools/download-images.sh`) that curls every image from the OSRS wiki into `public/images/`.
2. A `spriteUrl` field on existing data structures pointing to `/images/<Filename>.png`.
3. `<img>` tags in DOM panels, `drawImage()` on the canvas. The browser handles caching.

### Image Storage

```
public/images/
├── tabs/           # 14 tab icons
│   ├── Inventory.png
│   ├── Prayer_tab_icon.png
│   └── ...
├── items/          # food, potions, weapons, armor
│   ├── Paddlefish.png
│   ├── Egniol_potion_(4).png
│   ├── Corrupted_bow_(basic).png
│   └── ...
├── prayers/        # 29 prayer icons (active + inactive variants for protect prayers)
│   ├── Thick_Skin.png
│   ├── Protect_from_Magic.png
│   └── ...
└── overheads/      # 2 overhead icons
    ├── Protect_from_Magic_overhead.png
    └── Protect_from_Missiles_overhead.png
```

All images use `image-rendering: pixelated` via CSS for authentic OSRS crispness.

### Data Model Changes

```typescript
// InventoryItem — add one field
interface InventoryItem {
  id: string;
  name: string;
  category: 'food' | 'combo_food' | 'potion' | 'weapon';
  quantity: number;
  color: string;        // kept as fallback
  spriteUrl: string;    // NEW — e.g. '/images/items/Paddlefish.png'
}

// TabDef — icon becomes image path
interface TabDef {
  id: string;
  label: string;
  icon: string;         // CHANGED from Unicode to '/images/tabs/Inventory.png'
  enabled: boolean;
}

// PrayerDef — add icon paths for all prayers
interface PrayerDef {
  id: string;
  name: string;
  row: number;
  col: number;
  levelReq: number;
  interactive: boolean;
  spriteActive?: string;    // already exists for protect prayers; extend to all
  spriteInactive?: string;  // already exists for protect prayers; extend to all
  iconUrl: string;          // NEW — wiki prayer icon path
}

// Weapon / ArmorSet — add sprite paths
interface Weapon {
  // ...existing fields...
  spriteUrl: string;    // NEW
}
```

---

## Implementation

### Phase 1: Download Script + Image Files (~15% effort)

**Files:**
- `tools/download-images.sh` — New

**Tasks:**
- [ ] Write a bash script that uses `curl` to download every image listed in SPRINT-003-INTENT.md from `https://oldschool.runescape.wiki/images/<Filename>.png`
- [ ] Organize into subdirectories: `tabs/`, `items/`, `prayers/`, `overheads/`
- [ ] Tab icons (14): `Inventory.png`, `Prayer_tab_icon.png`, `Worn_Equipment.png`, `Combat_icon.png`, `Skills_icon.png`, `Quest_List_tab_icon.png`, `Spellbook.png`, `Your_Clan_icon.png`, `Friends_List.png`, `Ignore_List.png`, `Logout.png`, `Settings.png`, `Emotes_button.png`, `Music.png`
- [ ] Item sprites: Paddlefish, Corrupted paddlefish, Egniol potion (1-4), Corrupted bow/staff/halberd (basic/attuned/perfected), Corrupted helm/body/legs (basic/attuned/perfected)
- [ ] Prayer icons (29): One icon per prayer in the grid. For Protect from Magic and Protect from Missiles, also download the `_overhead` variant
- [ ] Add `public/images/` to `.gitignore` (or commit the images — TBD, see Open Questions)
- [ ] Run the script, verify all files present

### Phase 2: Tab Bar — Swap Unicode for `<img>` (~10% effort)

**Files:**
- `src/render/TabBar.ts` — Modify

**Tasks:**
- [ ] Change `icon` field in `TABS_TOP` and `TABS_BOTTOM` from Unicode strings to image paths (e.g. `'/images/tabs/Inventory.png'`)
- [ ] In `createTab()`, replace `el.textContent = def.icon` with:
  ```typescript
  const img = document.createElement('img');
  img.src = def.icon;
  img.alt = def.label;
  img.draggable = false;
  el.appendChild(img);
  ```
- [ ] Add CSS: `.osrs-tab img { width: 24px; height: 24px; image-rendering: pixelated; }`

### Phase 3: Inventory Panel — Item Sprites (~15% effort)

**Files:**
- `src/entities/Inventory.ts` — Modify
- `src/render/InventoryPanel.ts` — Modify
- `src/equipment/items.ts` — Modify

**Tasks:**
- [ ] Add `spriteUrl: string` to `InventoryItem` interface
- [ ] In `Inventory.buildFromLoadout()`, set `spriteUrl` for each item:
  - Paddlefish: `'/images/items/Paddlefish.png'`
  - Corrupted paddlefish: `'/images/items/Corrupted_paddlefish.png'`
  - Egniol potion: `'/images/items/Egniol_potion_(N).png'` (where N = current doses)
  - Weapons: `'/images/items/Corrupted_bow_(basic).png'` etc.
- [ ] In `Inventory.decrementDose()`, update `spriteUrl` to match new dose count
- [ ] Add `spriteUrl` to `Weapon` and `ArmorSet` interfaces in `items.ts`, populate for all tiers
- [ ] In `InventoryPanel.update()`, replace the colored `div.item-icon` with an `<img>`:
  ```typescript
  const img = document.createElement('img');
  img.src = item.spriteUrl;
  img.alt = item.name;
  img.classList.add('item-sprite');
  slot.appendChild(img);
  ```
- [ ] Remove the `item-name` text div (the sprite is the label now)
- [ ] Keep the dose overlay for potions
- [ ] CSS: `.item-sprite { width: 36px; height: 32px; image-rendering: pixelated; object-fit: contain; }`

### Phase 4: Prayer Panel — Wiki Icons (~15% effort)

**Files:**
- `src/render/PrayerPanel.ts` — Modify
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Add `iconUrl` to every entry in the `PRAYERS` array (e.g. `'/images/prayers/Thick_Skin.png'`)
- [ ] Update `spriteActive` / `spriteInactive` for Protect from Magic and Protect from Missiles to use new wiki paths instead of extracted sprite paths:
  - Active: `'/images/prayers/Protect_from_Magic.png'` (shown brighter via CSS)
  - Inactive: same image, dimmed via CSS opacity
- [ ] In `build()`, replace text-label fallback with `<img>` for all prayers:
  ```typescript
  const img = document.createElement('img');
  img.src = prayer.iconUrl;
  img.alt = prayer.name;
  img.draggable = false;
  cell.appendChild(img);
  ```
- [ ] Active/inactive state: use CSS `filter: brightness(1.3)` for active, `opacity: 0.35` for non-interactive, `opacity: 0.6` for interactive-but-inactive
- [ ] Remove old sprite_127/128/147/148 references

### Phase 5: Equipment Panel — Slot Sprites (~10% effort)

**Files:**
- `src/render/EquipmentPanel.ts` — Modify

**Tasks:**
- [ ] When a slot is filled (head/body/legs/weapon), render an `<img>` with the item's sprite URL instead of text
- [ ] Map equipment slots to sprite URLs:
  - Weapon: from `loadout.weapon.spriteUrl`
  - Head: `'/images/items/Corrupted_helm_(tier).png'`
  - Body: `'/images/items/Corrupted_body_(tier).png'`
  - Legs: `'/images/items/Corrupted_legs_(tier).png'`
- [ ] Empty slots keep their dim text label
- [ ] CSS: `.osrs-equipment-slot img { width: 36px; height: 32px; image-rendering: pixelated; }`

### Phase 6: Canvas Overhead Icons (~20% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Pre-load 2 overhead images as `HTMLImageElement` in the `Renderer` constructor:
  ```typescript
  private overheadMagic: HTMLImageElement;
  private overheadMissiles: HTMLImageElement;

  constructor(canvas: HTMLCanvasElement) {
    // ...existing...
    this.overheadMagic = new Image();
    this.overheadMagic.src = '/images/overheads/Protect_from_Magic_overhead.png';
    this.overheadMissiles = new Image();
    this.overheadMissiles.src = '/images/overheads/Protect_from_Missiles_overhead.png';
  }
  ```
- [ ] In `draw()`, after rendering the player rectangle, draw the player's active prayer overhead:
  ```typescript
  const activePrayer = sim.prayerManager.activePrayer;
  if (activePrayer) {
    const icon = activePrayer === 'magic' ? this.overheadMagic : this.overheadMissiles;
    const px = player.pos.x * TILE_SIZE + TILE_SIZE / 2 - 12;
    const py = player.pos.y * TILE_SIZE - 20;
    ctx.drawImage(icon, px, py, 25, 25);
  }
  ```
- [ ] After rendering the boss, draw the boss's current attack style as an overhead:
  ```typescript
  const bossIcon = boss.currentStyle === 'ranged' ? this.overheadMissiles : this.overheadMagic;
  const bx = (boss.pos.x + boss.size / 2) * TILE_SIZE - 12;
  const by = boss.pos.y * TILE_SIZE - 25;
  ctx.drawImage(bossIcon, bx, by, 25, 25);
  ```
- [ ] Use `ctx.imageSmoothingEnabled = false` before drawImage for pixelated rendering

### Phase 7: CSS + Polish (~15% effort)

**Files:**
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Global rule: `img { image-rendering: pixelated; }` scoped to the game panel
- [ ] Ensure tab images are vertically centered in their 33x36 tab cells
- [ ] Inventory sprites centered in their grid cells
- [ ] Prayer icons sized consistently in the 5x6 grid (~25x25 per icon)
- [ ] Equipment sprites centered in their slot boxes
- [ ] Verify all existing tests still pass (image changes are DOM-only, should not affect simulation logic)
- [ ] Visual verification via agent-browser

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/download-images.sh` | Create | One-time script to curl all OSRS images from wiki |
| `public/images/tabs/*.png` | Create | 14 tab icon images |
| `public/images/items/*.png` | Create | ~30 item sprite images |
| `public/images/prayers/*.png` | Create | 29 prayer icon images |
| `public/images/overheads/*.png` | Create | 2 overhead prayer icons |
| `src/render/TabBar.ts` | Modify | Unicode glyphs to `<img>` tags |
| `src/render/InventoryPanel.ts` | Modify | Colored divs to `<img>` sprites |
| `src/render/PrayerPanel.ts` | Modify | Text labels + extracted sprites to wiki `<img>` icons |
| `src/render/EquipmentPanel.ts` | Modify | Text labels to `<img>` sprites for filled slots |
| `src/render/Renderer.ts` | Modify | Pre-load and drawImage overhead prayer icons |
| `src/entities/Inventory.ts` | Modify | Add `spriteUrl` to `InventoryItem` |
| `src/equipment/items.ts` | Modify | Add `spriteUrl` to `Weapon` and `ArmorSet` |
| `src/render/osrs-theme.css` | Modify | `image-rendering: pixelated`, sprite sizing rules |

---

## Definition of Done

- [ ] `tools/download-images.sh` runs successfully and populates `public/images/` with all required PNGs
- [ ] `npm run build` passes with zero errors
- [ ] `npm test` — all existing tests pass (no simulation logic changed)
- [ ] All 14 tab buttons show real OSRS tab icon images
- [ ] Inventory slots show item sprite images (paddlefish, potions, weapons)
- [ ] Potion dose overlay still visible on top of sprite
- [ ] Potion sprite updates when dose decrements (e.g. Egniol 4 to Egniol 3)
- [ ] All 29 prayer cells show wiki prayer icons
- [ ] Active protection prayer icon is visually distinct (brighter)
- [ ] Equipment panel shows item sprites in filled slots (weapon, head, body, legs)
- [ ] Player overhead icon appears on canvas when a protection prayer is active
- [ ] Boss overhead icon appears on canvas matching its current attack style
- [ ] Overhead icons render crisp (pixelated, no anti-aliasing blur)
- [ ] All images served locally from `public/images/` — zero runtime wiki requests
- [ ] Visual verification via agent-browser confirms authentic OSRS look

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Wiki image URLs change or 404 | Low | High | Download script logs failures. All URLs verified in intent doc. Can re-run script to fix. |
| Images look blurry at small sizes | Medium | Medium | `image-rendering: pixelated` on all `<img>` and `imageSmoothingEnabled = false` on canvas. |
| Overhead icons occlude boss HP text | Medium | Low | Position overheads above the entity with enough offset. Adjust Y offset if needed. |
| Large number of image files slows page load | Low | Low | Images are tiny (1-5 KB each). Browser caches aggressively. No preloading needed except 2 canvas overheads. |
| Existing tests break due to DOM changes | Low | Medium | Tests exercise simulation logic, not DOM rendering. Verify with `npm test` after each phase. |

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged).

### Dev
Unchanged: vite, typescript, vitest.

### Assets (new)
| Asset | Source | Purpose |
|-------|--------|---------|
| Tab icons (14 PNGs) | `oldschool.runescape.wiki/images/` | Authentic tab bar icons |
| Item sprites (~30 PNGs) | `oldschool.runescape.wiki/images/` | Inventory + equipment visuals |
| Prayer icons (29 PNGs) | `oldschool.runescape.wiki/images/` | Prayer panel grid |
| Overhead icons (2 PNGs) | `oldschool.runescape.wiki/images/` | Canvas overhead prayer display |

### External
- `curl` — required by download script (available on all target platforms)

---

## Open Questions

1. **Commit images or gitignore?** Images are small (~1-5 KB each, ~50 files total). Committing them avoids requiring contributors to run the download script. Recommendation: commit them.

2. **Boss overhead — show or not?** In real OSRS, the boss has no overhead icon. But showing the boss's attack style overhead helps learners know what to pray. Recommendation: show it, with an option to disable later.

3. **Potion sprite per dose or single sprite?** The wiki has separate images for each dose (`Egniol_potion_(1).png` through `(4).png`). Use the per-dose images so the sprite visually changes as doses are consumed.

4. **Armor sprites in equipment panel — which piece?** The wiki has separate sprites for helm, body, and legs. Map each equipment slot to its specific sprite (not the full armor set image).

5. **Remove old extracted sprites?** Sprint 2 placed extracted sprite files at `/docs/assets/sprites/sprite_127_frame0.png` etc. for protection prayers. After this sprint, those are unused. Clean them up or leave them?
