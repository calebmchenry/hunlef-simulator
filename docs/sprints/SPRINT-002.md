# Sprint 002: OSRS-Faithful Side Panel — Inventory, Prayer, Equipment + F-Key Config

## Overview

Replace the placeholder DOM sidebar with a pixel-accurate recreation of the OSRS side panel. The panel is exactly **249px wide**, uses CSS-generated stone textures, embeds OSRS bitmap fonts via `@font-face`, and contains three functional tabbed views: **Inventory** (4x7 interactive grid), **Prayer** (5x6 grid with click-to-toggle), and **Equipment** (11-slot paper doll). A stone-textured tab bar with 14 tabs (matching OSRS, only 3 functional) switches between views. F-key bindings are configured on the loadout screen.

**What ships:** A side panel that looks like the real OSRS interface. Inventory items are clickable — eat food, drink potions, switch weapons mid-fight. Prayer icons toggle protection prayers on click. Equipment shows the paper doll. F-key configuration is on the loadout screen. Existing HP/prayer/boss bars remain above the tabbed content.

**What's deferred:** Drag-and-drop inventory, right-click context menus, tooltip overlays, combat options tab, sound effects, offensive prayer toggling (Piety/Rigour/Augury — shown but non-interactive).

---

## Use Cases

1. **UC-1: Tab switching** — During fight, player presses a configured F-key and the side panel switches to the corresponding tab. Active tab appears raised/lighter; inactive tabs are recessed/darker.
2. **UC-2: F-key configuration** — On loadout screen, player assigns F-keys to Inventory/Prayer/Equipment tabs via dropdowns. Defaults: Esc=Inventory, F5=Prayer, F4=Equipment.
3. **UC-3: Inventory interaction** — Inventory tab shows 4x7 grid populated from loadout. Click paddlefish to eat (heals 20 HP), click corrupted paddlefish to combo-eat (heals 16 HP, no action cost), click egniol potion to drink (restores prayer points), click a weapon to equip it (switches active weapon).
4. **UC-4: Prayer toggling** — Prayer tab shows 5x6 grid. Clicking Protect from Magic or Protect from Missiles toggles that prayer on/off via existing PrayerManager. Active prayers glow with beige/gold highlight. Other prayers shown dimmed.
5. **UC-5: Equipment paper doll** — Equipment tab shows 11 slots in OSRS paper doll layout. Displays current armor set and weapon. Read-only (equipping is done via inventory click).
6. **UC-6: Existing HUD preserved** — HP bar, prayer bar, boss HP bar, attack counter, tick counter remain above the tabbed panel area.

---

## Architecture

### Tech Stack Additions

| Addition | Decision | Rationale |
|----------|----------|-----------|
| Fonts | RuneStar OTF via `@font-face` | Pixel-perfect OSRS text rendering |
| Stone texture | CSS composited gradients | Zero image dependencies |
| Color theme | CSS custom properties | Centralized OSRS palette |
| Panel width | 249px fixed | Matches OSRS side panel exactly |
| Tab dimensions | 33x36px each, 14 tabs in 2 rows of 7 | Matches OSRS layout |

### Component Hierarchy

```
HUD (existing, above tabs)
├── HP bar, Prayer bar, Boss HP bar
├── Attack counter, Tick counter

SidePanel (249px container, below HUD)
├── TabBar (2 rows of 7 stone tabs)
│   └── 14 TabButtons (3 functional, 11 decorative)
├── ContentArea (~261px tall, swaps visible panel)
│   ├── InventoryPanel (4x7 interactive grid)
│   ├── PrayerPanel (5x6 grid, click-to-toggle)
│   └── EquipmentPanel (11-slot paper doll)
```

### New Data Models

```typescript
// Inventory slot model (on Player)
interface InventoryItem {
  id: string;           // 'paddlefish', 'egniol_4', 'perfected_staff'
  name: string;         // Display name
  category: 'food' | 'combo_food' | 'potion' | 'weapon';
  quantity: number;     // Doses for potions, 1 for everything else
  color: string;        // Fallback display color
}

// Player.inventory: (InventoryItem | null)[]  — 28-slot array

// F-key config
interface FKeyConfig {
  inventory: string;    // e.g. 'Escape'
  prayer: string;       // e.g. 'F5'
  equipment: string;    // e.g. 'F4'
}
```

### State Flow

```
LoadoutScreen
  └── User configures gear + food/potion counts + F-key bindings
  └── Config includes: armorTier, weapons, paddlefishCount, egniolDoses, fkeyConfig

startFight(config)
  └── Player.inventory built from config (28-slot array)
  └── SidePanel created with TabBar + 3 panels
  └── InputManager reads fkeyConfig for tab switching

Per tick:
  └── SidePanel.update(sim) refreshes active panel
  └── InventoryPanel: re-renders slot quantities (food count changes after eating)
  └── PrayerPanel: updates active/inactive states from PrayerManager
  └── EquipmentPanel: updates active weapon display

Click events:
  └── Inventory slot click → GameSimulation.useInventoryItem(slotIndex)
      ├── Food: heal HP, remove from slot, consume action tick
      ├── Combo food: heal HP, remove from slot, no action cost
      ├── Potion: restore prayer points, decrement dose
      └── Weapon: switch equipped weapon
  └── Prayer icon click → GameSimulation.queuePrayer(type)

F-key press:
  └── InputManager checks FKeyConfig → SidePanel.switchTab(tabId)
```

---

## Implementation

### Phase 1: OSRS Fonts + CSS Stone Theme (~10% effort)

**Files:**
- `public/fonts/runescape_plain_11.otf` — Download from RuneStar/fonts
- `public/fonts/runescape_plain_12.otf`
- `public/fonts/runescape_bold_12.otf`
- `src/render/osrs-theme.css` — New
- `index.html` — Modify (add CSS link, update CSP)

**Tasks:**
- [ ] Download OSRS bitmap font OTF files from RuneStar/fonts GitHub repo
- [ ] Create `osrs-theme.css` with `@font-face` declarations for all 3 variants
- [ ] Define CSS custom properties for the full OSRS color palette:
  - Stone: `--osrs-stone-dark: #3e362f`, `--osrs-stone-mid: #4a3f36`, `--osrs-stone-light: #5c504a`
  - Tabs: `--osrs-tab-active: #5c504a`, `--osrs-tab-inactive: #332c26`, `--osrs-tab-border: #1b1610`
  - Text: `--osrs-text-yellow: #ff981f`, `--osrs-text-orange: #ff8800`, `--osrs-text-white: #ffffff`
  - Panels: `--osrs-inventory-slot-bg: #3e3529`, `--osrs-equipment-slot-bg: #483e33`
  - Prayer: `--osrs-prayer-active-glow: #b8a457`
- [ ] Build CSS stone texture class using composited gradients (no image files)
- [ ] Update CSP meta tag for font-src

### Phase 2: Tab Bar + Side Panel Container (~15% effort)

**Files:**
- `src/render/TabBar.ts` — New
- `src/render/SidePanel.ts` — New
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Implement `TabBar` class — renders 14 tabs in 2 rows of 7 (33x36px each)
  - Top row: Combat, Stats, Quests, **Equipment**, **Prayer**, Spellbook, Clan
  - Bottom row: Friends, Ignore, Logout, Settings, Emotes, Music, **Inventory**
  - Only Equipment, Prayer, Inventory are enabled (clickable). Others decorative (35% opacity).
  - Active tab: lighter stone bg + bright top border. Inactive: darker, recessed.
  - Tab icons: simple Unicode/emoji glyphs or tiny inline SVGs for each tab
- [ ] Implement `SidePanel` class — 249px container:
  - Hosts TabBar at top
  - ContentArea below (~261px)
  - `switchTab(tabId)` swaps visible panel, updates TabBar active state
  - `update(sim)` delegates to active panel
- [ ] Integrate SidePanel into `main.ts` — replace current HUD panel area below the bars

### Phase 3: Inventory Data Model + Panel (~20% effort)

**Files:**
- `src/entities/Inventory.ts` — New
- `src/entities/Player.ts` — Modify
- `src/equipment/Loadout.ts` — Modify
- `src/render/InventoryPanel.ts` — New
- `src/render/LoadoutScreen.ts` — Modify

**Tasks:**
- [ ] Implement `Inventory` class:
  - 28-slot array of `(InventoryItem | null)`
  - `buildFromLoadout(config)`: populate slots in order: weapon(s), egniol vials, paddlefish, corrupted paddlefish
  - `useItem(index)`: returns action to perform (eat, drink, equip) or null
  - `removeItem(index)`: clears a slot (after food consumed)
  - `decrementDose(index)`: for potions (4→3→2→1→remove)
- [ ] Update `LoadoutConfig` to include food/potion counts:
  ```
  paddlefishCount: number
  corruptedPaddlefishCount: number
  egniolDoses: number
  ```
- [ ] Update `LoadoutScreen` with number inputs for food/potions + slot counter (max 28)
- [ ] Add `inventory: Inventory` to Player, built at fight start
- [ ] Implement `InventoryPanel`:
  - CSS Grid: 4 columns x 7 rows, ~2px gap
  - Each slot: dark brown bg (`--osrs-inventory-slot-bg`), 36x32px content area
  - Items shown as colored rectangles with item name in RuneScape Plain 11 font
  - Potion doses shown as quantity overlay in top-left
  - Click handler: `sim.useInventoryItem(slotIndex)`

### Phase 4: Inventory Interaction Logic (~15% effort)

**Files:**
- `src/engine/GameSimulation.ts` — Modify
- `src/entities/Inventory.ts` — Modify
- `src/combat/PrayerManager.ts` — Modify (for potion restore)

**Tasks:**
- [ ] Implement `GameSimulation.useInventoryItem(index)`:
  - **Paddlefish**: heal `min(20, maxHp - currentHp)`, remove from inventory, consume action tick (player cannot attack this tick)
  - **Corrupted paddlefish**: heal `min(16, maxHp - currentHp)`, remove from inventory, NO action cost (combo food)
  - **Egniol potion**: restore `floor(prayerLevel / 4) + 7` prayer points, decrement dose, remove vial at 0 doses
  - **Weapon**: switch `player.equippedWeapon`, no action cost, update combat stats
- [ ] Queue inventory actions like other inputs — take effect next tick
- [ ] Combo eating: paddlefish + corrupted paddlefish can both be used in the same tick
- [ ] Tests:
  - Eating paddlefish heals 20, removes from inventory, consumes action
  - Combo eating: regular + corrupted in same tick = 36 HP healed
  - Egniol potion restores correct prayer points (floor(77/4)+7 = 26)
  - Weapon switch changes equipped weapon and attack stats
  - Cannot eat at full HP (no-op)

### Phase 5: Prayer Panel (~15% effort)

**Files:**
- `src/render/PrayerPanel.ts` — New
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Define static prayer data array (29 prayers in OSRS order):
  - Each entry: `{ id, name, row, col, levelReq, spriteId?, interactive: boolean }`
  - Only Protect from Magic and Protect from Missiles are interactive in sprint 2
  - All others displayed dimmed at 35% opacity
- [ ] Implement `PrayerPanel`:
  - CSS Grid: 5 columns x 6 rows
  - Each prayer cell: ~46x46px with prayer icon
  - Use extracted prayer sprite PNGs (sprite_127, sprite_128, sprite_147, sprite_148) for protection prayers
  - Other prayers: simple text label or placeholder icon
  - Active prayer: full opacity + beige/gold circular glow background (`--osrs-prayer-active-glow`)
  - Inactive interactive prayers: 60% opacity, no glow
  - Non-interactive prayers: 35% opacity, no pointer cursor
- [ ] Click handler on interactive prayers → `sim.queuePrayer(type)`
- [ ] `update(sim)` reads `PrayerManager.activePrayer` and updates glow states

### Phase 6: Equipment Panel (~10% effort)

**Files:**
- `src/render/EquipmentPanel.ts` — New
- `src/render/osrs-theme.css` — Modify

**Tasks:**
- [ ] Implement `EquipmentPanel` with OSRS paper doll layout:
  ```
  Row 0:              [Head]
  Row 1:     [Cape]   [Neck]   [Ammo]
  Row 2:   [Weapon]   [Body]   [Shield]
  Row 3:              [Legs]
  Row 4:    [Hands]   [Feet]   [Ring]
  ```
  - CSS Grid: 3 columns x 5 rows, centered
  - Each slot: bordered rectangle (`--osrs-equipment-slot-bg`, `--osrs-equipment-slot-border`)
  - Empty slots: dim silhouette text ("Head", "Cape", etc.) at 30% opacity
  - Filled slots: item name in RuneScape Plain 12 font, yellow text
  - For Gauntlet: Head/Body/Legs show armor tier name, Weapon shows equipped weapon
  - Other slots always empty (no cape/neck/ammo/shield/hands/feet/ring in Gauntlet)
- [ ] Equipment stats summary at bottom:
  - Attack bonuses, Defence bonuses, Prayer bonus — from current loadout
  - Formatted in RuneScape Plain 12 font

### Phase 7: F-Key Configuration + Input Integration (~10% effort)

**Files:**
- `src/input/KeyBindManager.ts` — New
- `src/input/InputManager.ts` — Modify
- `src/render/LoadoutScreen.ts` — Modify
- `src/equipment/Loadout.ts` — Modify

**Tasks:**
- [ ] Implement `KeyBindManager`:
  - Stores `FKeyConfig`: mapping from tab ID → key string
  - Defaults: `{ inventory: 'Escape', prayer: 'F5', equipment: 'F4' }`
  - `getTabForKey(key: string): string | null`
  - `getKeyForTab(tabId: string): string`
- [ ] Update `LoadoutScreen` with F-key config section:
  - 3 dropdown rows: "Inventory Key: [Esc ▼]", "Prayer Key: [F5 ▼]", "Equipment Key: [F4 ▼]"
  - Options: F1-F12, Escape
  - Validation: no duplicate key assignments
- [ ] Update `LoadoutConfig` to include `fkeyConfig: FKeyConfig`
- [ ] Update `InputManager`:
  - Remove hardcoded F1/F2 prayer switching
  - On F-key press: check KeyBindManager → if mapped to tab, call `SidePanel.switchTab(tabId)`
  - Prayer toggling now happens via prayer panel clicks (not F-keys directly)
  - Esc still has dual function: switch to inventory tab AND/OR deactivate prayers

### Phase 8: Integration + Polish (~5% effort)

**Files:**
- `src/__tests__/inventory.test.ts` — New
- `src/__tests__/integration.test.ts` — Modify
- `src/main.ts` — Modify

**Tasks:**
- [ ] Wire everything in `main.ts`:
  - Create SidePanel after fight starts
  - Pass FKeyConfig to InputManager and SidePanel
  - `SidePanel.update(sim)` called each tick alongside HUD
- [ ] Integration tests:
  - Inventory built from loadout has correct item count
  - Eating food heals correct amount and removes from inventory
  - Potion restores prayer and decrements dose
  - Weapon switch changes equipped weapon
  - Determinism preserved (seeded RNG still produces identical fights)
- [ ] Existing tests still pass (no regressions)
- [ ] Visual verification via agent-browser: screenshot all 3 tabs

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `public/fonts/runescape_plain_11.otf` | Create | OSRS bitmap font |
| `public/fonts/runescape_plain_12.otf` | Create | OSRS bitmap font |
| `public/fonts/runescape_bold_12.otf` | Create | OSRS bitmap font |
| `src/render/osrs-theme.css` | Create | @font-face, CSS custom properties, stone textures |
| `src/render/TabBar.ts` | Create | 14-tab stone bar (3 functional) |
| `src/render/SidePanel.ts` | Create | 249px container, tab switching, content area |
| `src/render/InventoryPanel.ts` | Create | 4x7 interactive grid |
| `src/render/PrayerPanel.ts` | Create | 5x6 prayer grid with click-to-toggle |
| `src/render/EquipmentPanel.ts` | Create | 11-slot paper doll |
| `src/entities/Inventory.ts` | Create | 28-slot data model |
| `src/input/KeyBindManager.ts` | Create | Configurable F-key → tab mapping |
| `src/__tests__/inventory.test.ts` | Create | Inventory + eating/drinking tests |
| `src/entities/Player.ts` | Modify | Add inventory field |
| `src/equipment/Loadout.ts` | Modify | Add food/potion counts, FKeyConfig |
| `src/render/LoadoutScreen.ts` | Modify | Add food/potion inputs, F-key config, slot counter |
| `src/render/HUD.ts` | Modify | Remove prayer icons (moved to prayer panel) |
| `src/input/InputManager.ts` | Modify | Use KeyBindManager, remove hardcoded F1/F2 |
| `src/engine/GameSimulation.ts` | Modify | Add useInventoryItem(), queue inventory actions |
| `src/main.ts` | Modify | Wire SidePanel, pass FKeyConfig |
| `index.html` | Modify | Link osrs-theme.css, update CSP, restructure HUD container |
| `src/__tests__/integration.test.ts` | Modify | Add inventory interaction tests |

---

## Definition of Done

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes all existing + new tests
- [ ] Side panel is exactly 249px wide with CSS stone texture background
- [ ] OSRS bitmap fonts (RuneStar OTF) render for all panel text
- [ ] Tab bar shows 14 tabs in 2 rows of 7 with stone styling
- [ ] Only Inventory, Prayer, Equipment tabs are clickable; others decorative at 35% opacity
- [ ] Active tab visually raised/lighter; inactive tabs recessed/darker
- [ ] Inventory panel shows 4x7 grid populated from loadout
- [ ] Click paddlefish in inventory → heals 20 HP, removes item, consumes action tick
- [ ] Click corrupted paddlefish → heals 16 HP, removes item, no action cost (combo)
- [ ] Click egniol potion → restores prayer points per formula, decrements dose
- [ ] Click weapon in inventory → switches equipped weapon
- [ ] Prayer panel shows 5x6 grid with all 29 prayer positions
- [ ] Click Protect from Magic / Protect from Missiles toggles prayer on/off
- [ ] Active prayers show bright icon + beige/gold glow; inactive dimmed
- [ ] Equipment panel shows paper doll with 11 slot positions
- [ ] Equipped armor and weapon displayed in correct slots
- [ ] F-key config section on loadout screen with 3 dropdown rows
- [ ] Configured F-keys switch tabs during fight
- [ ] No duplicate F-key assignments allowed
- [ ] LoadoutScreen has food/potion count inputs with 28-slot validation
- [ ] HP/prayer/boss bars and attack counter remain visible above tabs
- [ ] All sprint 1 functionality preserved (combat, movement, tick engine)
- [ ] Determinism test: seeded RNG still produces identical fights

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OSRS font rendering looks wrong at small sizes | Medium | Medium | Test RuneStar OTF at 11px/12px in multiple browsers. Fallback: system monospace with OSRS colors. |
| CSS stone texture doesn't look authentic | Medium | Low | Iterate on gradient composition. Compare against OSRS screenshots. Worst case: subtle enough that layout matters more. |
| Inventory interaction timing edge cases | Medium | Medium | Queue actions same as other inputs. Test combo eating specifically. Match OSRS: regular food costs action tick, combo food doesn't. |
| Weapon switching mid-fight balancing | Low | Medium | OSRS allows weapon switching with no cooldown cost. Implement the same — no action tick consumed. |
| Tab switching interferes with prayer hotkeys | Medium | Medium | Clear separation: F-keys switch tabs, prayer icon clicks toggle prayers. No overlap. |
| Panel doesn't fit on small screens | Low | Low | 249px panel + 576px canvas = 825px minimum. Most screens handle this. |

---

## Security Considerations

- No new external dependencies. Fonts are bundled OTF files served from `public/`.
- No network requests for font loading — everything is self-hosted.
- Inventory actions are validated server-side (in GameSimulation) — clicking an empty slot does nothing.
- No `eval` or dynamic code.

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged from sprint 1).

### Dev
Unchanged: vite, typescript, vitest.

### Assets (new)
| Asset | Source | Purpose |
|-------|--------|---------|
| `runescape_plain_11.otf` | RuneStar/fonts GitHub | OSRS text in inventory/prayers |
| `runescape_plain_12.otf` | RuneStar/fonts GitHub | OSRS text in equipment stats |
| `runescape_bold_12.otf` | RuneStar/fonts GitHub | OSRS bold text for headers |

---

## Open Questions

1. **Combo eating tick rules**: OSRS allows eating regular food + combo food in the same tick. Does the action cost of regular food still apply (blocking attack that tick), or does the combo food override? Implementation: regular food costs 1 action tick; combo food can be used in the same tick without additional cost.

2. **Weapon switch cooldown**: In OSRS, switching weapons inside the Gauntlet does not reset the attack cooldown. Verify this — if the player switches from bow (4 tick cooldown, 2 ticks remaining) to staff, does the cooldown carry over or reset?

3. **Potion dose display**: OSRS shows potion doses as "(4)", "(3)", "(2)", "(1)" in the item name. Should each dose decrement show as a different item in the slot, or update the quantity overlay?

4. **Prayer panel sprite sources**: We have sprites 127/128/147/148 for protection prayers. For other prayers in the grid, should we extract more sprites from the cache, or use text placeholders?

5. **Tab icon rendering**: OSRS tab icons are small pixel sprites. Should we extract these from the cache, use Unicode approximations, or create simple SVG icons?
