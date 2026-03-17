# Sprint 003 Intent: Authentic OSRS Images — Tab Icons, Item Sprites, Overhead Prayers

## Seed

Replace all placeholder visuals with authentic OSRS images. Tab icons use the real OSRS icons (backpack for inventory, etc). All inventory items display actual OSRS item sprites sourced from the wiki. Active protection prayers render as overhead icons above both player and Hunlef on the game canvas. Use agent-browser to verify visuals.

## Context

- **Sprint 2 complete**: OSRS-styled side panel with 3 functional tabs, inventory interaction (eat/drink/switch), prayer click-to-toggle, equipment paper doll. 77 tests passing.
- **Current placeholders**: Tab icons are Unicode emoji (🎒, ✝, 🛡). Inventory items are colored rectangles with text labels. Player/boss are colored rectangles. No overhead prayer icons.
- **Image source**: OSRS wiki `Special:FilePath/<Filename>.png` serves all game images directly. All URLs verified working.
- **Zero runtime deps constraint**: Download images at build time to `public/images/`, serve locally. No runtime fetching from wiki.

## Verified Image URLs (from OSRS Wiki)

### Tab Icons
- Inventory: `Inventory.png` (25x27)
- Prayer: `Prayer_tab_icon.png` (25x29)
- Equipment: `Worn_Equipment.png` (26x31)
- Combat: `Combat_icon.png` (19x19)
- Stats: `Skills_icon.png` (24x22)
- Quests: `Quest_List_tab_icon.png` (18x18)
- Spellbook: `Spellbook.png` (24x23)
- Clan: `Your_Clan_icon.png` (22x26)
- Friends: `Friends_List.png` (22x22)
- Ignore: `Ignore_List.png` (22x22)
- Logout: `Logout.png` (21x30)
- Settings: `Settings.png` (23x23)
- Emotes: `Emotes_button.png` (18x27)
- Music: `Music.png` (21x25)

### Item Sprites (all ~30x30 with transparent bg)
- Paddlefish: `Paddlefish.png`
- Corrupted paddlefish: `Corrupted_paddlefish.png`
- Egniol potion (1-4): `Egniol_potion_(N).png`
- Corrupted bow (basic/attuned/perfected): `Corrupted_bow_(tier).png`
- Corrupted staff (basic/attuned/perfected): `Corrupted_staff_(tier).png`
- Corrupted halberd (basic/attuned/perfected): `Corrupted_halberd_(tier).png`
- Corrupted helm (basic/attuned/perfected): `Corrupted_helm_(tier).png`
- Corrupted body (basic/attuned/perfected): `Corrupted_body_(tier).png`
- Corrupted legs (basic/attuned/perfected): `Corrupted_legs_(tier).png`

### Prayer Icons
- Prayer book: `Protect_from_Magic.png`, `Protect_from_Missiles.png`
- Overhead: `Protect_from_Magic_overhead.png`, `Protect_from_Missiles_overhead.png` (25x25)

### All other prayer icons for the 5x6 grid
Each prayer has a wiki image: `Thick_Skin.png`, `Burst_of_Strength.png`, etc.

## Relevant Codebase Areas

- `src/render/TabBar.ts` — Replace Unicode glyphs with `<img>` elements
- `src/render/InventoryPanel.ts` — Replace colored rects with `<img>` item sprites
- `src/render/PrayerPanel.ts` — Replace text labels + extracted sprites with wiki prayer icons
- `src/render/EquipmentPanel.ts` — Add item images to equipment slots
- `src/render/Renderer.ts` — Draw overhead prayer icons on canvas above player/boss
- `src/entities/Inventory.ts` — Add `spriteUrl` field to InventoryItem
- `src/equipment/items.ts` — Add sprite paths to weapon/armor data

## Constraints

- Zero runtime deps (no fetching from wiki at runtime)
- All images must be downloaded to `public/images/` and served locally
- Need a build script or one-time download script to fetch all images from wiki
- Images should use `image-rendering: pixelated` for authentic OSRS look
- Canvas overhead icons need to be pre-loaded as Image objects for ctx.drawImage()

## Success Criteria

1. All 14 tab icons show real OSRS images instead of Unicode
2. Inventory items show actual OSRS item sprites (food, potions, weapons)
3. Equipment panel shows item sprites in paper doll slots
4. Prayer panel shows real prayer icons for all 29 prayers
5. Active protection prayer shows as overhead icon above player on canvas
6. Hunlef's current attack style shows matching overhead icon above boss on canvas
7. All images are locally served from `public/images/`
8. Visual verification via agent-browser confirms authentic OSRS look

## Verification Strategy

- agent-browser screenshots of each tab and the game canvas
- Compare against OSRS wiki screenshots for visual fidelity
- Existing 77 tests still pass

## Uncertainty Assessment

- **Correctness: Low** — Images are well-defined, URLs verified
- **Scope: Low** — Bounded to image replacement, one new canvas feature (overheads)
- **Architecture: Low** — Extends existing patterns (DOM img elements, canvas drawImage)

## Open Questions

1. Should we download images via a script in `tools/` or manually place them?
2. Should the overhead prayer icon above the boss match the boss's CURRENT attack style or the player's prayer? (In OSRS, the boss shows no overhead — only the player does. But for a practice tool, showing the boss's style overhead helps learners.)
3. Should we also add prayer icons for the full prayer grid (all 29) or just the protection prayers?
