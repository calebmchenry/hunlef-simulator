# Sprint 002: OSRS-Faithful Side Panel — Inventory, Prayer, Equipment + F-Key Config

## Overview

Replace the placeholder DOM sidebar with a pixel-accurate recreation of the OSRS side panel system. The panel is exactly **249px wide**, uses CSS-generated stone textures, embeds OSRS bitmap fonts via `@font-face`, and contains three tabbed views: Inventory (4x7 grid), Prayer (5x6 grid with click-to-toggle), and Equipment (11-slot paper doll). A stone-textured tab bar with proper active/raised and inactive/recessed states switches between views. F-key bindings are configured via dropdowns on the loadout screen before the fight begins, replacing the current hardcoded F1/F2 prayer switching.

**What ships:** A side panel that looks and feels like the real OSRS interface. Players configure F-key tab mappings on the loadout screen, then use those keys to flip between inventory, prayer, and equipment panels during the fight. Prayer icons are clickable to toggle prayers on/off. Inventory displays all 28 slots populated from the loadout (weapons, food, potions). Equipment shows a paper doll with all 11 slot positions.

**What's deferred:** Drag-and-drop inventory, eating food by clicking inventory slots, weapon switching via inventory, combat options tab, right-click context menus, tooltip overlays on hover, sound effects.

---

## Use Cases

1. **UC-1: Tab switching via F-keys** — During the fight, pressing a configured F-key switches the side panel to the corresponding tab (Inventory, Prayer, or Equipment). The active tab appears raised/lighter; inactive tabs appear recessed/darker.

2. **UC-2: F-key configuration** — On the loadout screen, the player assigns F-keys (F1-F12, Esc) to each of the three tabs via dropdown selectors. Defaults: F1=Inventory, F5=Prayer, F4=Equipment. Configuration persists until changed.

3. **UC-3: Inventory display** — The inventory tab shows a 4x7 grid of 28 slots. Slots are populated from the loadout: equipped weapon in slot 0, remaining weapons in subsequent slots, then egniol potions, then paddlefish, then corrupted paddlefish. Empty slots show a dark brown background.

4. **UC-4: Prayer panel interaction** — The prayer tab shows a 5x6 grid of prayer icons. Clicking Protect from Magic or Protect from Missiles toggles that prayer on/off (integrates with the existing `PrayerManager`). Active prayers show a bright icon with a beige/gold circular glow. Inactive prayers are dimmed. Prayers irrelevant to the Gauntlet are shown dimmed and non-interactive (visual completeness only).

5. **UC-5: Equipment paper doll** — The equipment tab shows 11 labeled slots in the OSRS paper doll layout. Slots occupied by the current loadout display the item name/icon. Empty slots show a silhouette outline matching OSRS.

6. **UC-6: Prayer hotkeys preserved** — F-key prayer switching from Sprint 1 continues to work, but the keys are now configurable. Pressing the Prayer tab's F-key switches to that tab; pressing dedicated prayer hotkeys (or clicking prayer icons) toggles individual prayers.

---

## Architecture

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel width | 249px fixed | Matches measured OSRS side panel exactly |
| Stone texture | CSS `linear-gradient` + `radial-gradient` noise layers | Zero image dependencies. Approximates the mottled dark brown (#3e362f base) using composited gradient layers. |
| Font rendering | RuneStar/fonts OTF files as `@font-face` | OSRS uses custom bitmap fonts. RuneStar has reverse-engineered the exact glyphs as OTF. Bundle `runescape_plain_11.otf`, `runescape_plain_12.otf`, `runescape_bold_12.otf`. |
| Tab system | DOM elements, CSS classes for active/inactive | Simple state toggle. Canvas not needed for a 14-tab bar. |
| F-key config | `FKeyConfig` type stored in `LoadoutConfig` | Config flows through the existing loadout pipeline to `InputManager`. |
| Prayer clicks | DOM `click` handlers on prayer icon elements | PrayerManager already has `queueSwitch()`. Click handler calls the same path as keyboard input. |
| Inventory model | `InventorySlot[]` array on `Player` | 28-slot array built from loadout at fight start. Display-only for Sprint 2 (no drag/drop/use). |

### Component Hierarchy

```
SidePanel (249px container)
├── TabBar (2 rows of 7 stone tabs, 33x36px each)
│   └── Tab icons: only Inventory/Prayer/Equipment are functional; others are decorative
├── PanelContent (swapped by active tab)
│   ├── InventoryPanel (4x7 grid, 36x32px item slots)
│   ├── PrayerPanel (5x6 grid, click-to-toggle)
│   └── EquipmentPanel (11-slot paper doll)
```

### State Flow

```
LoadoutScreen
  └── User selects F-key mappings → stored in LoadoutConfig.fkeyConfig

startFight(config)
  └── new Inventory(config) → populates 28 slots
  └── new SidePanel(container, sim, fkeyConfig)
  └── InputManager reads fkeyConfig for tab switching + prayer hotkeys

Per tick:
  └── SidePanel.update(sim) → refreshes active panel content
      ├── InventoryPanel: re-renders slot contents (quantities change when food is eaten - future sprint)
      ├── PrayerPanel: updates active/inactive glow states from PrayerManager
      └── EquipmentPanel: static after fight start (no weapon switching yet)

Keyboard input:
  └── F-key press → InputManager checks fkeyConfig
      ├── If mapped to a tab → SidePanel.switchTab(tabId)
      └── If Esc → close panel / deselect (OSRS behavior)
```

---

## Implementation

### Phase 1: OSRS Fonts + CSS Stone Foundation (~10% effort)

**Files:**
- `src/assets/fonts/runescape_plain_11.otf` (download from RuneStar/fonts)
- `src/assets/fonts/runescape_plain_12.otf`
- `src/assets/fonts/runescape_bold_12.otf`
- `src/render/styles/osrs-theme.css` — New file
- `index.html` — Modify

**Tasks:**
- [ ] Download OSRS bitmap font OTF files from `https://github.com/RuneStar/fonts` into `src/assets/fonts/`
- [ ] Create `osrs-theme.css` with `@font-face` declarations for all three font variants:
  ```css
  @font-face {
    font-family: 'RuneScape Plain 11';
    src: url('/src/assets/fonts/runescape_plain_11.otf') format('opentype');
  }
  ```
- [ ] Define CSS custom properties for the OSRS color palette:
  ```css
  :root {
    --osrs-stone-dark: #3e362f;
    --osrs-stone-mid: #4a3f36;
    --osrs-stone-light: #5c504a;
    --osrs-stone-highlight: #6e5f54;
    --osrs-panel-bg: #3e362f;
    --osrs-tab-active: #5c504a;
    --osrs-tab-inactive: #332c26;
    --osrs-tab-border: #1b1610;
    --osrs-text-yellow: #ff981f;
    --osrs-text-orange: #ff8800;
    --osrs-text-white: #ffffff;
    --osrs-text-shadow: #000000;
    --osrs-prayer-active-glow: #b8a457;
    --osrs-inventory-slot-bg: #3e3529;
    --osrs-equipment-slot-bg: #483e33;
    --osrs-equipment-slot-border: #2b2420;
  }
  ```
- [ ] Build CSS stone texture using composited gradients (no image files):
  ```css
  .osrs-stone {
    background:
      radial-gradient(ellipse at 20% 50%, rgba(80,70,60,0.3) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, rgba(90,75,62,0.2) 0%, transparent 40%),
      radial-gradient(ellipse at 50% 80%, rgba(70,60,50,0.25) 0%, transparent 45%),
      linear-gradient(135deg, #443a32 0%, #3e362f 40%, #352e28 70%, #3e362f 100%);
  }
  ```
- [ ] Add `<link>` for the new CSS file in `index.html`
- [ ] Update CSP meta tag to allow font loading from self

### Phase 2: Tab Bar Component (~15% effort)

**Files:**
- `src/render/TabBar.ts` — New file
- `src/render/styles/osrs-theme.css` — Modify

**Tasks:**
- [ ] Implement `TabBar` class:
  ```typescript
  interface TabDef {
    id: string;          // 'inventory' | 'prayer' | 'equipment' | 'combat' | ...
    icon: string;        // Unicode glyph or inline SVG path for the tab icon
    enabled: boolean;    // false = decorative only (greyed out, no click)
  }
  ```
- [ ] Render 14 tabs in 2 rows of 7 (matching OSRS layout), each 33x36px
- [ ] Top row: Combat, Stats, Quests, Equipment, Prayer, Spellbook, (Clan)
- [ ] Bottom row: (Friends), (Ignore), (Logout), Settings, (Emotes), (Music), Inventory
- [ ] Only Inventory, Prayer, and Equipment tabs are enabled (clickable). All others are decorative (greyed icon, no hover effect).
- [ ] Active tab styling: lighter stone texture (var(--osrs-tab-active)), 1px bright border on top, recessed shadow on inactive tabs
- [ ] CSS for active vs inactive state:
  ```css
  .osrs-tab {
    width: 33px; height: 36px;
    background: var(--osrs-tab-inactive);
    border: 1px solid var(--osrs-tab-border);
    border-bottom: none;
    cursor: pointer;
    image-rendering: pixelated;
  }
  .osrs-tab.active {
    background: var(--osrs-tab-active);
    border-top-color: var(--osrs-stone-highlight);
    position: relative;
    z-index: 1;
  }
  .osrs-tab.disabled {
    opacity: 0.35;
    cursor: default;
  }
  ```
- [ ] Click handler on enabled tabs calls `SidePanel.switchTab(tabId)`
- [ ] Expose `setActiveTab(tabId)` method for F-key integration

### Phase 3: Side Panel Container + Inventory Panel (~20% effort)

**Files:**
- `src/render/SidePanel.ts` — New file
- `src/render/InventoryPanel.ts` — New file
- `src/entities/Inventory.ts` — New file
- `src/entities/Player.ts` — Modify
- `src/equipment/Loadout.ts` — Modify
- `src/render/styles/osrs-theme.css` — Modify

**Tasks:**
- [ ] Define `InventorySlot` type:
  ```typescript
  interface InventorySlot {
    itemId: string;       // e.g. 'perfected_bow', 'paddlefish', 'egniol_4'
    name: string;
    quantity: number;     // 1 for most items, dose count display for potions
    icon: string;         // CSS class or inline representation
    stackable: boolean;
  }
  ```
- [ ] Implement `Inventory` class with 28-slot array:
  - `buildFromLoadout(config: LoadoutConfig): InventorySlot[]` — Populates slots in order: equipped weapon, second weapon (if any), egniol potion vials (ceil(doses/4) slots), paddlefish (1 slot each), corrupted paddlefish (1 slot each). Remaining slots empty.
  - `getSlot(index: number): InventorySlot | null`
  - `getUsedSlotCount(): number`
- [ ] Update `LoadoutConfig` to include food and potion counts:
  ```typescript
  interface LoadoutConfig {
    armorTier: Tier;
    weaponType: WeaponType;
    weaponTier: 1 | 2 | 3;
    secondaryWeaponType?: WeaponType;
    secondaryWeaponTier?: 1 | 2 | 3;
    paddlefishCount: number;
    corruptedPaddlefishCount: number;
    egniolDoses: number;
  }
  ```
- [ ] Add `inventory: Inventory` field to `Player`
- [ ] Implement `SidePanel` class:
  - 249px wide container with stone background
  - Hosts `TabBar` at top, content area below (~261px tall)
  - `switchTab(tabId)` swaps visible content panel
  - `update(sim)` delegates to the active panel's update method
- [ ] Implement `InventoryPanel`:
  - 4 columns x 7 rows grid using CSS Grid
  - Each cell: 36x32px content area with dark brown background (`var(--osrs-inventory-slot-bg)`)
  - Occupied slots show item name in RuneScape Plain 11 font (yellow text with black shadow)
  - Empty slots: blank dark background
  - Item quantity overlay in top-left corner (green text for stacks)
- [ ] CSS for inventory grid:
  ```css
  .inventory-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(7, 1fr);
    gap: 2px;
    padding: 4px;
  }
  .inventory-slot {
    width: 36px; height: 32px;
    background: var(--osrs-inventory-slot-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'RuneScape Plain 11', monospace;
    font-size: 11px;
    color: var(--osrs-text-yellow);
    text-shadow: 1px 1px 0 var(--osrs-text-shadow);
    image-rendering: pixelated;
    position: relative;
  }
  ```

### Phase 4: Prayer Panel with Click-to-Toggle (~20% effort)

**Files:**
- `src/render/PrayerPanel.ts` — New file
- `src/combat/PrayerManager.ts` — Modify
- `src/render/styles/osrs-theme.css` — Modify

**Tasks:**
- [ ] Define the full OSRS prayer list (29 prayers) in display order for the 5x6 grid:
  ```
  Row 0: Thick Skin, Burst of Str, Clarity of Thought, Sharp Eye, Mystic Will
  Row 1: Rock Skin, Superhuman Str, Improved Reflexes, Rapid Restore, Rapid Heal
  Row 2: Protect Item, Hawk Eye, Mystic Lore, Steel Skin, Ultimate Str
  Row 3: Incredible Reflexes, Protect from Magic, Protect from Missiles, Protect from Melee, Eagle Eye
  Row 4: Mystic Might, Retribution, Redemption, Smite, Preserve
  Row 5: Chivalry, Piety, Rigour, Augury, (empty)
  ```
- [ ] Implement `PrayerPanel` class:
  - Render 5x6 grid of prayer icons
  - Each prayer cell: ~46x46px (fits 5 across in 249px with padding)
  - Only Protect from Magic (row 3, col 0) and Protect from Missiles (row 3, col 1) are interactive for Sprint 2
  - Future-relevant prayers (Piety, Rigour, Augury, Eagle Eye, Mystic Might) are displayed but non-interactive (greyed out with a lock/tooltip - deferred)
  - All other prayers shown dimmed at ~35% opacity
- [ ] Active prayer glow effect (CSS only, no images):
  ```css
  .prayer-icon.active {
    opacity: 1.0;
    filter: brightness(1.3);
  }
  .prayer-icon.active::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(184,164,87,0.4) 0%, transparent 70%);
    pointer-events: none;
  }
  ```
- [ ] Click handler on interactive prayers:
  ```typescript
  prayerEl.addEventListener('click', () => {
    const current = sim.prayerManager.activePrayer;
    if (current === prayerType) {
      sim.queuePrayer(null);  // toggle off
    } else {
      sim.queuePrayer(prayerType);  // toggle on
    }
  });
  ```
- [ ] `update(sim)` reads `sim.prayerManager.activePrayer` and toggles `.active` class on the corresponding icon element
- [ ] Use the existing extracted sprite PNGs for Protect from Magic/Missiles (sprites 127, 128, 147, 148). For other prayers, use placeholder colored rectangles with prayer name abbreviations until sprites are extracted.
- [ ] Show remaining prayer points at top of panel in RuneScape Bold 12: "Prayer: 77/77"

### Phase 5: Equipment Paper Doll Panel (~15% effort)

**Files:**
- `src/render/EquipmentPanel.ts` — New file
- `src/render/styles/osrs-theme.css` — Modify

**Tasks:**
- [ ] Implement `EquipmentPanel` with the 11-slot paper doll layout using CSS Grid:
  ```
  Grid layout (5 cols x 5 rows, some cells span):
          [Head]
  [Cape]  [Neck]  [Ammo]
  [Weapon][Body]  [Shield]
          [Legs]
  [Hands] [Feet]  [Ring]
  ```
- [ ] Each equipment slot: ~36x36px box with rounded 1px border
- [ ] Empty slot styling:
  ```css
  .equip-slot {
    width: 36px; height: 36px;
    background: var(--osrs-equipment-slot-bg);
    border: 1px solid var(--osrs-equipment-slot-border);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .equip-slot.empty::after {
    content: '';
    width: 24px; height: 24px;
    opacity: 0.2;
    /* Silhouette shapes per slot type via CSS mask or simple outlines */
  }
  ```
- [ ] Map loadout to equipment slots:
  - Head: armor helm (if tier > 0)
  - Body: armor body (if tier > 0)
  - Legs: armor legs (if tier > 0)
  - Weapon: currently equipped weapon
  - All other slots (Cape, Neck, Ammo, Shield, Hands, Feet, Ring): empty with silhouette
- [ ] Display item name in RuneScape Plain 11 below each occupied slot (yellow text, black shadow)
- [ ] "Equipment Stats" section at bottom showing computed bonuses from current loadout:
  - Stab/Slash/Crush/Magic/Range attack bonuses
  - Same for defense
  - Prayer bonus total
  - Use RuneScape Plain 11, white text

### Phase 6: F-Key Configuration on Loadout Screen (~10% effort)

**Files:**
- `src/render/LoadoutScreen.ts` — Modify
- `src/input/InputManager.ts` — Modify
- `src/input/FKeyConfig.ts` — New file
- `src/equipment/Loadout.ts` — Modify

**Tasks:**
- [ ] Define `FKeyConfig` type:
  ```typescript
  type FKeyAction = 'inventory' | 'prayer' | 'equipment' | 'pray_magic' | 'pray_missiles' | 'pray_off';
  type FKeyBinding = 'F1'|'F2'|'F3'|'F4'|'F5'|'F6'|'F7'|'F8'|'F9'|'F10'|'F11'|'F12'|'Escape';

  interface FKeyConfig {
    bindings: Map<FKeyBinding, FKeyAction>;
  }

  const DEFAULT_FKEY_CONFIG: FKeyConfig = {
    bindings: new Map([
      ['Escape', 'inventory'],
      ['F4', 'equipment'],
      ['F5', 'prayer'],
      ['F1', 'pray_magic'],
      ['F2', 'pray_missiles'],
    ]),
  };
  ```
- [ ] Add F-key config section to `LoadoutScreen`:
  - Section header: "F-Key Configuration"
  - One dropdown per action: Inventory Tab, Prayer Tab, Equipment Tab, Protect Magic, Protect Missiles
  - Each dropdown lists F1-F12 + Esc as options
  - Validation: warn if same key assigned to multiple actions (highlight in red)
  - Default values match OSRS defaults
- [ ] Add inventory configuration to `LoadoutScreen`:
  - Paddlefish count (0-24, default 12)
  - Corrupted paddlefish count (0-12, default 4)
  - Egniol potion doses (0-12, default 8)
  - Show computed slot usage: "Inventory: 17/28 slots used"
  - Warn (red text) if > 28 slots
- [ ] Update `LoadoutConfig` to carry `fkeyConfig` and inventory counts
- [ ] Rewrite `InputManager` to read from `FKeyConfig`:
  - Remove hardcoded F1/F2 prayer switching
  - On keydown, look up key in `fkeyConfig.bindings`
  - If action is a tab switch, call `sidePanel.switchTab()`
  - If action is a prayer toggle, call `sim.queuePrayer()` as before
  - Continue to support Esc as prayer-off if not mapped to a tab

### Phase 7: Integration + Polish (~10% effort)

**Files:**
- `src/render/HUD.ts` — Modify
- `src/main.ts` — Modify
- `index.html` — Modify
- `src/render/SidePanel.ts` — Modify
- `src/__tests__/sidepanel.test.ts` — New file
- `src/input/__tests__/fkey.test.ts` — New file
- `src/entities/__tests__/inventory.test.ts` — New file

**Tasks:**
- [ ] Refactor `HUD.ts`: Move HP/prayer/boss bars to the top of the side panel (above tabs), or keep them in a separate strip above the canvas. The side panel below the bars contains the tabbed content. Decide: HP/prayer orbs move to left side of canvas (OSRS-style minimap area) or stay as bars above the panel.
- [ ] Update `main.ts` to:
  - Create `SidePanel` instead of raw `HUD`
  - Pass `fkeyConfig` to `InputManager`
  - Build `Inventory` from `LoadoutConfig` and attach to `Player`
  - Call `sidePanel.update(sim)` each tick
- [ ] Update `index.html`:
  - Replace `#hud` 220px sidebar with 249px `#side-panel` container
  - Link new `osrs-theme.css`
  - Ensure stone texture background extends full panel height
- [ ] Write tests:
  - `sidepanel.test.ts`: Tab switching changes visible panel, only enabled tabs respond to clicks
  - `fkey.test.ts`: Custom F-key bindings fire correct actions, default config matches expected, duplicate key detection
  - `inventory.test.ts`: Loadout with T3 bow + 8 egniol doses + 12 paddlefish + 4 corrupted paddlefish = correct slot count, slot ordering is correct, empty slots are null
- [ ] Visual polish pass:
  - Verify 249px width renders without horizontal scroll on 1080p+ screens
  - Text renders crisply with `font-smooth: never` / `-webkit-font-smoothing: none` for bitmap font look
  - Active prayer glow is clearly visible but not garish
  - Tab active/inactive contrast is distinguishable
  - Stone texture looks mottled/natural, not flat or banded

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/assets/fonts/runescape_plain_11.otf` | Create (download) | OSRS bitmap font - small body text |
| `src/assets/fonts/runescape_plain_12.otf` | Create (download) | OSRS bitmap font - standard text |
| `src/assets/fonts/runescape_bold_12.otf` | Create (download) | OSRS bitmap font - headers/emphasis |
| `src/render/styles/osrs-theme.css` | Create | OSRS color palette, stone textures, font-face, panel/tab/grid styles |
| `src/render/SidePanel.ts` | Create | 249px container, manages TabBar + panel content switching |
| `src/render/TabBar.ts` | Create | 14-tab stone bar (2x7), active/inactive states |
| `src/render/InventoryPanel.ts` | Create | 4x7 inventory grid display |
| `src/render/PrayerPanel.ts` | Create | 5x6 prayer grid with click-to-toggle |
| `src/render/EquipmentPanel.ts` | Create | 11-slot paper doll layout |
| `src/entities/Inventory.ts` | Create | 28-slot inventory model, built from loadout |
| `src/input/FKeyConfig.ts` | Create | F-key binding types, defaults, validation |
| `index.html` | Modify | Link osrs-theme.css, replace #hud with #side-panel (249px), update CSP for fonts |
| `src/render/HUD.ts` | Modify | Extract HP/prayer/boss bars into SidePanel header or separate component |
| `src/render/LoadoutScreen.ts` | Modify | Add F-key config dropdowns, inventory item counts, slot usage display |
| `src/input/InputManager.ts` | Modify | Replace hardcoded F1/F2 with FKeyConfig-driven dispatch |
| `src/entities/Player.ts` | Modify | Add `inventory: Inventory` field |
| `src/equipment/Loadout.ts` | Modify | Extend LoadoutConfig with fkeyConfig + food/potion counts |
| `src/main.ts` | Modify | Wire SidePanel, Inventory, FKeyConfig into startup flow |
| `src/combat/PrayerManager.ts` | Modify | No functional changes, but prayer click handlers call existing queueSwitch |
| `src/__tests__/sidepanel.test.ts` | Create | Tab switching, panel visibility |
| `src/input/__tests__/fkey.test.ts` | Create | F-key config validation, binding dispatch |
| `src/entities/__tests__/inventory.test.ts` | Create | Inventory slot population from loadout |

---

## Definition of Done

- [ ] Side panel renders at exactly 249px wide with CSS stone texture background
- [ ] OSRS bitmap fonts (`@font-face`) render all panel text without anti-aliasing artifacts
- [ ] Tab bar shows 14 tabs in 2 rows of 7, each 33x36px with stone texture
- [ ] Active tab is visually raised/lighter; inactive tabs are recessed/darker
- [ ] Only Inventory, Prayer, and Equipment tabs are interactive; others are greyed decorative
- [ ] Clicking an enabled tab or pressing its configured F-key switches the panel content
- [ ] Inventory panel displays 4x7 grid with items from loadout in correct slots
- [ ] Inventory correctly computes slot usage (weapons + ceil(doses/4) potions + fish counts)
- [ ] Prayer panel displays 5x6 grid with all 29 prayer positions
- [ ] Clicking Protect from Magic/Missiles toggles the prayer via PrayerManager
- [ ] Active prayer shows bright icon + beige/gold radial glow; inactive is dimmed
- [ ] Equipment panel shows 11-slot paper doll with correct item placement from loadout
- [ ] Empty equipment slots show silhouette outlines
- [ ] F-key configuration dropdowns appear on loadout screen with OSRS-default values
- [ ] Loadout screen shows food/potion configuration with live slot count (warns if >28)
- [ ] Configured F-keys correctly switch tabs and toggle prayers during the fight
- [ ] No duplicate F-key binding allowed (UI validation with red highlight)
- [ ] All Sprint 1 functionality preserved: tick engine, combat, movement, prayer drain, win/loss
- [ ] `npm test` passes all existing tests plus new tests for inventory, F-key config, and tab switching
- [ ] No runtime dependencies added
- [ ] Panel renders without horizontal overflow on 1080p+ screens

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CSS stone texture looks flat/unconvincing | Medium | Medium | Layer 3+ radial gradients with different sizes and opacities. Reference OSRS screenshots during tuning. Consider a tiny repeating SVG noise pattern as fallback. |
| Bitmap fonts render blurry on non-integer DPI | Medium | Medium | Use `font-smooth: never`, `-webkit-font-smoothing: none`, `text-rendering: optimizeSpeed`. Test on 1x and 2x DPI screens. |
| RuneStar font OTFs have licensing issues | Low | High | RuneStar fonts are distributed under open terms for OSRS tooling. Verify license file in the repo before bundling. If blocked, fall back to a pixel font like "Press Start 2P" or render text to canvas with manual bitmap lookup. |
| 249px panel too narrow for readable content | Low | Low | OSRS uses this width at 1x scale. Match their font sizes and padding exactly. |
| F-key conflicts with browser shortcuts | Medium | Low | `e.preventDefault()` on all F-key handlers. F5 (refresh) and F12 (devtools) are the main conflicts. Document that F12 is not usable as a binding. |
| Prayer click target too small on mobile | Medium | Low | Desktop-first. Mobile is out of scope for Sprint 2. Prayer cells are ~46x46px which is adequate for mouse. |
| LoadoutConfig changes break Sprint 1 tests | Low | Medium | Add new fields as optional with defaults. Existing tests pass without specifying food/fkey config. |

---

## Security Considerations

- No new network requests. Font files are bundled locally.
- No user data stored (F-key config is ephemeral, resets on page load). If persistence is added later, use `localStorage` only.
- Click handlers are attached to specific DOM elements, not global document listeners (except keydown, which already exists).
- CSP update: `font-src 'self'` added to allow loading bundled OTF files. No external font CDN.
- No `eval`, no dynamic script injection, no `innerHTML` with user-controlled content (all panel HTML is hardcoded template strings).

---

## Dependencies

### Runtime
None. Zero runtime dependencies (unchanged from Sprint 1).

### Dev
No new dev dependencies. Existing Vite + TypeScript + Vitest are sufficient.

### External Assets (bundled at build time)
| Asset | Source | License |
|-------|--------|---------|
| `runescape_plain_11.otf` | [RuneStar/fonts](https://github.com/RuneStar/fonts) | BSD 2-Clause |
| `runescape_plain_12.otf` | RuneStar/fonts | BSD 2-Clause |
| `runescape_bold_12.otf` | RuneStar/fonts | BSD 2-Clause |

---

## Open Questions

1. **HP/Prayer orbs placement:** OSRS puts minimap + orbs in the top-right, separate from the side panel. Should we keep HP/prayer bars above the side panel (simpler), or create a separate minimap-area component to the left of the tab bar (more faithful)? Recommendation: keep as horizontal bars above the panel content for Sprint 2; move to orb-style in a later visual polish sprint.

2. **Prayer icon sprites beyond Protect Magic/Missiles:** We only have sprites 127/128/147/148 extracted. The other 27 prayers need icons. Options: (a) extract all prayer sprites from the OSRS cache now, (b) use colored placeholder squares with abbreviations, (c) only render the two functional prayers and leave other cells empty. Recommendation: option (b) for visual completeness without blocking on asset extraction.

3. **Inventory item icons:** No item sprites are currently extracted. For Sprint 2, use colored rectangles with text labels (e.g. green square + "T3 Bow"). Extract real item sprites in a dedicated asset sprint. This keeps scope bounded.

4. **Tab icon source:** The 14 tab icons (backpack, prayer star, helmet, sword, etc.) need source sprites. Same approach as prayer icons: use simplified CSS shapes or Unicode glyphs as placeholders, extract real sprites later.

5. **Second weapon slot:** The intent document mentions weapon switching as deferred, but the loadout config should support selecting two weapons now (for correct inventory slot counting). Should `LoadoutConfig` include `secondaryWeaponType/Tier` in Sprint 2, or defer entirely? Recommendation: include the config fields but grey out the UI; populate the inventory slot but don't enable in-fight switching.

6. **Food/potion loadout defaults:** What are sensible defaults for a first-time user? Recommendation: 12 paddlefish, 4 corrupted paddlefish, 8 egniol doses (2 potion slots). This leaves room for 1 weapon = 17/28 slots, which is a realistic CG loadout.

7. **Panel content height:** OSRS has ~261px between tab rows for content. Should we enforce this exactly (and use internal scrolling if content overflows) or let the panel grow? Recommendation: enforce 261px with `overflow: hidden` — the OSRS prayer and inventory grids are designed to fit exactly within this height.
