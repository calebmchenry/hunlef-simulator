# Sprint 003: Authentic OSRS Images + Hunlef Protection Prayer Mechanic

## Overview

Replace every placeholder visual with authentic OSRS images sourced from the wiki, and implement the Hunlef's protection prayer mechanic. A download script fetches all PNGs from the OSRS wiki into `public/images/`. Tab icons, inventory sprites, prayer icons, and equipment slot images replace Unicode glyphs, colored rectangles, and text labels. Active protection prayers render as overhead icons on the canvas above both the player and the Hunlef. The Hunlef's overhead shows what style it's currently **protecting against** — a core fight mechanic that determines which weapon the player should use.

**What ships:**
- All 14 tab icons are real OSRS images (backpack, prayer star, helmet, etc.)
- All inventory items show their actual OSRS sprites (food, potions, weapons, armor)
- All 29 prayers in the prayer panel use real OSRS prayer icons
- Equipment panel shows item sprites in paper doll slots
- Player's active protection prayer shows as overhead icon on the canvas
- Hunlef displays an overhead icon showing what style it's protecting against
- Hunlef protection prayer mechanic: starts protecting one style, switches after 6 off-prayer player hits
- Reusable image download script in `tools/`

**What's deferred:** Animated sprites, entity model sprites (player/boss remain colored rectangles), right-click menus, boss model rendering.

---

## Use Cases

1. **UC-1: Asset download** — Developer runs `node tools/download-osrs-images.mjs` to fetch all images from the wiki into `public/images/`. Idempotent (skips existing files).
2. **UC-2: Tab icons** — All 14 tabs show real OSRS icons with `image-rendering: pixelated`.
3. **UC-3: Inventory sprites** — Each slot displays the real OSRS item sprite (paddlefish, egniol potion with dose-specific image, weapons at correct tier).
4. **UC-4: Prayer icons** — All 29 prayers show their real OSRS icon. Active prayers bright, inactive dimmed.
5. **UC-5: Equipment sprites** — Equipped items in paper doll show corresponding OSRS sprites.
6. **UC-6: Player overhead** — When Protect from Magic/Missiles is active, the overhead icon renders above the player on the canvas.
7. **UC-7: Hunlef protection overhead** — The Hunlef shows an overhead icon indicating what combat style it's currently protecting against (melee, magic, or missiles).
8. **UC-8: Hunlef protection switching** — After the player lands 6 attacks with a style the Hunlef ISN'T protecting, the Hunlef switches its protection to that style. This forces weapon switching.

---

## Architecture

### Image Pipeline

```
tools/download-osrs-images.mjs
  └── Fetches from: https://oldschool.runescape.wiki/w/Special:FilePath/<Name>.png
  └── Saves to: public/images/{tabs,items,prayers,overheads}/
  └── Idempotent: skips existing files
  └── Reports: downloaded, skipped, failed

src/render/assets.ts
  └── Typed const manifest mapping IDs → local paths
  └── e.g. ITEM_SPRITES.paddlefish = '/images/items/Paddlefish.png'
```

### Hunlef Protection Prayer (New Game Logic)

```
Boss entity gains:
  protectionStyle: 'melee' | 'magic' | 'ranged'  // what it's protecting against
  offPrayerHitCount: number                        // counts hits NOT matching protection

On player attack that deals damage:
  if player's attack style === boss.protectionStyle:
    → damage is BLOCKED (boss takes 0 damage? or reduced?)
    → offPrayerHitCount unchanged
  else:
    → damage applies normally
    → offPrayerHitCount++
    → if offPrayerHitCount >= 6:
        boss.protectionStyle = player's attack style
        offPrayerHitCount = 0

Overhead icon: shows the protection prayer matching boss.protectionStyle
  - melee → Protect from Melee overhead
  - magic → Protect from Magic overhead
  - ranged → Protect from Missiles overhead
```

**Important**: In OSRS, attacks against the Hunlef's protected style deal **reduced damage** (capped at 0), not zero. The player CAN still hit through the protection but the damage is severely reduced. For sprint 3, implement as: attacks matching the boss's protection style deal 0 damage (simplified). This can be refined in a later sprint.

### Component Changes

| File | Change |
|------|--------|
| `src/render/TabBar.ts` | Replace Unicode text with `<img>` elements |
| `src/render/InventoryPanel.ts` | Replace colored divs with `<img>` item sprites |
| `src/render/PrayerPanel.ts` | Replace text labels + old sprites with wiki prayer icons |
| `src/render/EquipmentPanel.ts` | Add `<img>` item sprites to filled slots |
| `src/render/Renderer.ts` | Preload overhead images, draw above player + boss |
| `src/entities/Boss.ts` | Add `protectionStyle`, `offPrayerHitCount`, switching logic |
| `src/engine/GameSimulation.ts` | Check boss protection on player attack, count off-prayer hits |
| `src/equipment/items.ts` | Add `spriteUrl` to Weapon and ArmorSet |
| `src/entities/Inventory.ts` | Add `spriteUrl` to InventoryItem |

---

## Implementation

### Phase 1: Download Script + Asset Manifest (~15% effort)

**Files:**
- `tools/download-osrs-images.mjs` — New
- `src/render/assets.ts` — New

**Tasks:**
- [ ] Create download script that fetches all images from OSRS wiki:

  **Tab icons (14):**
  `Combat_icon.png`, `Skills_icon.png`, `Quest_List_tab_icon.png`, `Worn_Equipment.png`, `Prayer_tab_icon.png`, `Spellbook.png`, `Your_Clan_icon.png`, `Friends_List.png`, `Ignore_List.png`, `Logout.png`, `Settings.png`, `Emotes_button.png`, `Music.png`, `Inventory.png`

  **Item sprites (~30):**
  `Paddlefish.png`, `Corrupted_paddlefish.png`, `Egniol_potion_(1).png` through `(4)`, `Corrupted_bow_(basic).png`/`(attuned)`/`(perfected)`, same for staff/halberd/helm/body/legs (9 weapons + 9 armor pieces)

  **Prayer icons (29+):**
  `Thick_Skin.png`, `Burst_of_Strength.png`, `Clarity_of_Thought.png`, `Sharp_Eye.png`, `Mystic_Will.png`, `Rock_Skin.png`, `Superhuman_Strength.png`, `Improved_Reflexes.png`, `Rapid_Restore.png`, `Rapid_Heal.png`, `Protect_Item.png`, `Hawk_Eye.png`, `Mystic_Lore.png`, `Steel_Skin.png`, `Ultimate_Strength.png`, `Incredible_Reflexes.png`, `Protect_from_Magic.png`, `Protect_from_Missiles.png`, `Protect_from_Melee.png`, `Eagle_Eye.png`, `Mystic_Might.png`, `Retribution.png`, `Redemption.png`, `Smite.png`, `Preserve.png`, `Chivalry.png`, `Piety.png`, `Rigour.png`, `Augury.png`

  **Overhead icons (3):**
  `Protect_from_Magic_overhead.png`, `Protect_from_Missiles_overhead.png`, `Protect_from_Melee_overhead.png`

- [ ] Organize into `public/images/{tabs,items,prayers,overheads}/`
- [ ] Script is idempotent (skips existing files)
- [ ] Create `src/render/assets.ts` — typed manifest mapping IDs to paths:
  ```typescript
  export const TAB_ICONS = { inventory: '/images/tabs/Inventory.png', ... } as const;
  export const ITEM_SPRITES = { paddlefish: '/images/items/Paddlefish.png', ... } as const;
  export const PRAYER_ICONS = { protect_magic: '/images/prayers/Protect_from_Magic.png', ... } as const;
  export const OVERHEAD_ICONS = { magic: '/images/overheads/Protect_from_Magic_overhead.png', ... } as const;
  ```
- [ ] Run the download script, verify all images are present

### Phase 2: Tab Icons (~10% effort)

**Files:**
- `src/render/TabBar.ts` — Modify

**Tasks:**
- [ ] Replace Unicode `textContent` with `<img>` elements for all 14 tabs
- [ ] Source paths from `TAB_ICONS` manifest
- [ ] CSS: `image-rendering: pixelated`, centered in 33x36px tab, ~20px max dimension
- [ ] Verify all 14 icons render correctly

### Phase 3: Inventory + Equipment Sprites (~15% effort)

**Files:**
- `src/render/InventoryPanel.ts` — Modify
- `src/render/EquipmentPanel.ts` — Modify
- `src/entities/Inventory.ts` — Modify
- `src/equipment/items.ts` — Modify

**Tasks:**
- [ ] Add `spriteUrl: string` to `InventoryItem` interface
- [ ] Add `spriteUrl: string` to `Weapon` and `ArmorSet` types in `items.ts`
- [ ] Populate spriteUrl for all items using `ITEM_SPRITES` manifest
- [ ] Inventory: build `<img>` element from `item.spriteUrl` instead of colored div + text label
  - Keep dose overlay for potions (quantity number in top-left)
  - Image fills slot with `object-fit: contain`, transparent background
- [ ] Equipment: show `<img>` for filled slots (helm, body, legs, weapon)
  - Replace text-only display with item sprite + name below
- [ ] All images use `image-rendering: pixelated`

### Phase 4: Prayer Panel Icons (~10% effort)

**Files:**
- `src/render/PrayerPanel.ts` — Modify

**Tasks:**
- [ ] Update prayer data array: add `iconUrl` field for all 29 prayers, sourced from `PRAYER_ICONS` manifest
- [ ] Replace text labels and old extracted sprites with `<img>` elements from wiki
- [ ] Active prayer: full opacity + glow (existing CSS works)
- [ ] Inactive interactive: 60% opacity
- [ ] Non-interactive: 35% opacity
- [ ] Remove old extracted sprite references (sprite_127, sprite_128, etc.) — wiki versions are higher quality

### Phase 5: Hunlef Protection Prayer Mechanic (~25% effort)

**Files:**
- `src/entities/Boss.ts` — Modify
- `src/engine/GameSimulation.ts` — Modify
- `src/entities/__tests__/Boss.test.ts` — Modify
- `src/__tests__/integration.test.ts` — Modify

**Tasks:**
- [ ] Add to Boss entity:
  ```typescript
  protectionStyle: 'melee' | 'magic' | 'ranged' = 'ranged'  // starting protection
  offPrayerHitCount: number = 0
  ```
- [ ] Modify player attack resolution in `GameSimulation`:
  - If player's weapon style matches `boss.protectionStyle` → attack deals **0 damage**
  - If player's weapon style does NOT match → damage applies normally, increment `offPrayerHitCount`
  - If `offPrayerHitCount >= 6` → `boss.protectionStyle` = player's weapon style, reset counter to 0
- [ ] Starting protection style: randomized from seeded RNG at fight start
- [ ] Tests:
  - Attacks matching boss protection deal 0 damage
  - After 6 off-prayer hits, boss switches protection to attacker's style
  - Counter resets after switch
  - Starting protection is deterministic with seed
  - Player must switch weapons to keep dealing damage (integration test)

### Phase 6: Canvas Overhead Icons (~15% effort)

**Files:**
- `src/render/Renderer.ts` — Modify

**Tasks:**
- [ ] Preload 3 overhead images in Renderer constructor:
  ```typescript
  private overheadMagic = new Image();   // Protect_from_Magic_overhead.png
  private overheadMissiles = new Image(); // Protect_from_Missiles_overhead.png
  private overheadMelee = new Image();    // Protect_from_Melee_overhead.png
  ```
  Set `.src` in constructor; images load asynchronously (draw only after loaded)
- [ ] Draw player overhead: if `prayerManager.activePrayer` is 'magic' or 'missiles', draw matching overhead icon centered above player tile, offset ~8px above the entity
- [ ] Draw boss overhead: based on `boss.protectionStyle` — draw matching overhead icon centered above boss 5x5 area, offset above the boss rectangle
- [ ] Overhead icons: 25x25px native, render at ~24px with `image-rendering: pixelated`
- [ ] Z-order: entities → overhead icons → hit splats (overheads drawn after entities, before splats)

### Phase 7: Integration + Visual Verification (~10% effort)

**Files:**
- `src/__tests__/integration.test.ts` — Modify
- `src/render/HUD.ts` — Modify (remove old prayer icon references)

**Tasks:**
- [ ] Clean up HUD: remove the old F1/F2 prayer icon display (prayer icons now in the prayer panel + overhead on canvas)
- [ ] Integration tests:
  - Hunlef protection switch after 6 hits verified
  - Weapon switching bypasses protection (switch to off-prayer style to deal damage)
  - Determinism preserved with seeded RNG
- [ ] All existing 77 tests still pass
- [ ] Visual verification with agent-browser:
  - [ ] Screenshot loadout screen (unchanged)
  - [ ] Screenshot inventory tab — real item sprites visible
  - [ ] Screenshot prayer tab — all 29 prayer icons from wiki
  - [ ] Screenshot equipment tab — item sprites in paper doll
  - [ ] Screenshot game canvas — overhead icons above player and boss
  - [ ] Screenshot with prayer active — player overhead visible

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/download-osrs-images.mjs` | Create | Fetches ~75 images from OSRS wiki |
| `src/render/assets.ts` | Create | Typed manifest mapping IDs → image paths |
| `public/images/tabs/*.png` | Create | 14 tab icon PNGs |
| `public/images/items/*.png` | Create | ~30 item sprite PNGs |
| `public/images/prayers/*.png` | Create | 29 prayer icon PNGs |
| `public/images/overheads/*.png` | Create | 3 overhead prayer PNGs |
| `src/render/TabBar.ts` | Modify | Unicode → `<img>` tab icons |
| `src/render/InventoryPanel.ts` | Modify | Colored divs → `<img>` item sprites |
| `src/render/PrayerPanel.ts` | Modify | Text → `<img>` prayer icons |
| `src/render/EquipmentPanel.ts` | Modify | Text → `<img>` equipment sprites |
| `src/render/Renderer.ts` | Modify | Preload + draw overhead icons on canvas |
| `src/entities/Boss.ts` | Modify | Add protectionStyle, offPrayerHitCount |
| `src/engine/GameSimulation.ts` | Modify | Protection check on player attacks, count off-prayer hits |
| `src/equipment/items.ts` | Modify | Add spriteUrl to Weapon/ArmorSet |
| `src/entities/Inventory.ts` | Modify | Add spriteUrl to InventoryItem |
| `src/render/HUD.ts` | Modify | Remove old prayer icon display |
| `src/entities/__tests__/Boss.test.ts` | Modify | Protection prayer tests |
| `src/__tests__/integration.test.ts` | Modify | Protection switching + visual integration |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + new tests
- [ ] `tools/download-osrs-images.mjs` runs successfully and downloads ~75 images
- [ ] All 14 tab icons show real OSRS images (no Unicode glyphs remain)
- [ ] Inventory items display actual OSRS item sprites (paddlefish, potions, weapons)
- [ ] Egniol potion shows dose-specific sprite (4/3/2/1)
- [ ] Equipment panel shows item sprites in paper doll slots
- [ ] All 29 prayer icons in the prayer panel are real OSRS images
- [ ] Active prayers show bright icon + glow; inactive are dimmed
- [ ] Player's active protection prayer shows as overhead icon on the canvas
- [ ] Hunlef displays overhead icon showing what style it's protecting against
- [ ] Hunlef starts fight protecting one random style (seeded RNG)
- [ ] Attacks matching Hunlef's protection deal 0 damage
- [ ] After 6 off-prayer player hits, Hunlef switches protection to that style
- [ ] Off-prayer hit counter resets after each switch
- [ ] All images served locally from `public/images/` (no runtime wiki fetching)
- [ ] All images use `image-rendering: pixelated` for authentic OSRS pixel-art look
- [ ] All 77 Sprint 1+2 tests still pass
- [ ] agent-browser screenshots confirm: tab icons, item sprites, prayer icons, overhead icons all render correctly

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Wiki image URLs change or 404 | Low | High | Download script saves locally; images committed to repo. Script reports failures. |
| Image sizing inconsistent across items | Medium | Low | CSS `object-fit: contain` + fixed slot dimensions. Images are ~25-32px natively, close to slot size. |
| Overhead icons hard to see on dark background | Medium | Medium | OSRS overhead sprites include white outlines. Test visibility in agent-browser. Add subtle drop shadow if needed. |
| Hunlef protection mechanic changes combat balance | Low | Medium | This is the real OSRS mechanic — it's correct. Players need to weapon-switch, which is already implemented. |
| Too many images slow page load | Low | Low | ~75 small PNGs (~25-32px each) total ~100KB. Negligible. |

---

## Security Considerations

- Download script only runs at build time, not at runtime
- Images are fetched from the official OSRS wiki (trusted source)
- No user-provided URLs or dynamic image loading
- All images committed to repo and served as static assets

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged).

### Dev
Unchanged: vite, typescript, vitest.

### Assets (new — downloaded by script)
~75 PNG images from `oldschool.runescape.wiki` via `Special:FilePath/` endpoint.

---

## Open Questions

1. **Hunlef starting protection**: Should it always start with a specific style (e.g., ranged), or be random? Implementation: seeded RNG picks from melee/magic/ranged at fight start.

2. **Off-prayer damage**: In real OSRS, attacks against Hunlef's protected style deal 0 damage (or are they just significantly reduced?). Sprint 3 implements as 0 damage. Can refine later.

3. **Weapon switching UX**: Now that Hunlef protects a style, players MUST switch weapons. The inventory click-to-switch from Sprint 2 supports this. Should there be a visual indicator on the HUD showing "Boss protects: Magic" in text?

4. **Old extracted sprites**: We have prayer sprites in `docs/assets/sprites/` from the cache extraction. The wiki versions are cleaner — should we delete the old ones or keep them as reference?

5. **Image loading race**: Canvas overhead icons load async. If the first draw happens before images load, overheads won't appear for a frame or two. Acceptable? Or add a loading gate?
