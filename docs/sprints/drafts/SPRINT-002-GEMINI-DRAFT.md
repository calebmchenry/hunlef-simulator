# Sprint 002 Draft: Side Panel Component Architecture

**Author perspective:** Component architecture specialist

---

## Overview

Deliver a reusable, component-based side panel system hosting Inventory, Prayer, and Equipment tabs with configurable F-key bindings. The emphasis is on clean separation between data models and rendering, a generic widget system that future sprints can extend without touching panel infrastructure, and a CSS custom property theme that keeps OSRS styling centralized and maintainable.

---

## Use Cases

1. **Tab navigation** — Player presses a configurable F-key during a fight and the side panel switches to the corresponding tab (Inventory, Prayer, or Equipment).
2. **Inventory display** — The 28-slot inventory grid renders the player's current loadout items (weapons, fish, potions) in the correct slots.
3. **Prayer toggling** — Player clicks a prayer icon in the Prayer panel (or uses an F-key) to toggle overhead protection prayers, integrating with the existing `PrayerManager`.
4. **Equipment inspection** — Equipment panel shows a paper-doll layout with the player's currently equipped armor and weapon.
5. **F-key configuration** — On the loadout screen, player assigns F-keys to tabs before entering the fight; bindings persist for the session.
6. **Future extensibility** — Eating food, drinking potions, and weapon switching (sprint 3+) plug into the inventory data model via an `InventorySlot.use()` action pattern without changing the panel infrastructure.

---

## Architecture

### Component Hierarchy

```
SidePanel (container widget, 249px)
├── TabBar (2 rows of tab icons, manages active state)
│   └── TabButton[] (icon + keybind label, click/keypress to activate)
└── ContentArea (swaps visible Panel)
    ├── InventoryPanel extends Panel
    ├── PrayerPanel extends Panel
    └── EquipmentPanel extends Panel
```

### Data Model Layer (decoupled from rendering)

```
Player
├── inventory: InventorySlot[28]     // data model, no DOM references
├── equipment: EquipmentSlots        // slot-based model with validation
└── (existing) loadout, stats, hp...

InventorySlot { item: InventoryItem | null; quantity: number }
InventoryItem { id: string; name: string; type: ItemCategory; sprite: string; stackable: boolean }

EquipmentSlots {
  head: EquipmentSlot;   cape: EquipmentSlot;   neck: EquipmentSlot;
  ammo: EquipmentSlot;   weapon: EquipmentSlot; body: EquipmentSlot;
  shield: EquipmentSlot; legs: EquipmentSlot;   hands: EquipmentSlot;
  feet: EquipmentSlot;   ring: EquipmentSlot;
}
EquipmentSlot { item: EquippedItem | null; accepts: SlotType }
```

### Key Abstractions

| Abstraction | Responsibility |
|-------------|---------------|
| `Panel` (abstract class) | Lifecycle: `build()`, `update(sim)`, `destroy()`. Owns a root `HTMLElement`. |
| `TabBar` | Renders tab icons, tracks active tab index, emits `tabChanged` callbacks. |
| `KeyBindManager` | Maps physical keys to abstract actions (not specific tabs). Decoupled from `InputManager`. Configurable at loadout time. |
| `PrayerDefinition[]` | Static data array defining all prayers: id, name, level req, drain rate, sprite paths, effect type. Panels read this; they don't hardcode prayer knowledge. |
| `InventoryModel` | Array of 28 `InventorySlot` objects on `Player`. Provides `addItem()`, `removeItem()`, `getSlot()`, `useSlot()`. Rendering reads this model. |
| `EquipmentModel` | Typed slot map on `Player`. Provides `equip()`, `unequip()` with slot-type validation (e.g., only a weapon-type item goes in the weapon slot). |

### Data Flow

```
User input (F-key / click)
  → KeyBindManager resolves action
  → If tab-switch action: SidePanel.setActiveTab(tabId)
  → If prayer-toggle action: PrayerManager.queueSwitch(prayer)
  → If inventory-use action (sprint 3+): InventoryModel.useSlot(index) → game effect

Game tick
  → GameSimulation.processTick()
  → HUD.update(sim) → SidePanel.update(sim)
    → active Panel.update(sim) re-renders from data models
```

---

## Implementation

### Phase 1: CSS Theme + Panel Infrastructure

Establish the visual foundation and generic widget system before any panel content.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `index.html` | Modify | Add CSS custom properties block (`:root { --osrs-* }`), restructure `#hud` to `#side-panel` with `#tab-bar` + `#content-area` children |
| `src/ui/Panel.ts` | Create | Abstract `Panel` base class: `build(): HTMLElement`, `update(sim): void`, `destroy(): void` |
| `src/ui/TabBar.ts` | Create | `TabBar` class: renders tab icons in 2 rows, manages active/inactive styling, `onTabChanged` callback |
| `src/ui/SidePanel.ts` | Create | `SidePanel` container: owns `TabBar` + `ContentArea`, registers `Panel` instances, handles tab switching |
| `src/ui/types.ts` | Create | `TabId`, `TabDefinition { id, label, icon, defaultKey }`, `PanelConstructor` types |

**CSS custom properties (added to `index.html`):**
```css
:root {
  --osrs-bg-dark: #3e362f;
  --osrs-bg-panel: #494034;
  --osrs-bg-slot: #3e3529;
  --osrs-bg-slot-hover: #564b3e;
  --osrs-border-dark: #2b2520;
  --osrs-border-light: #6b5f4f;
  --osrs-text-primary: #ff981f;
  --osrs-text-secondary: #c8aa6e;
  --osrs-text-inactive: #9f8f6f;
  --osrs-prayer-active-bg: #bfae8e;
  --osrs-tab-active: #635b4f;
  --osrs-tab-inactive: #3e362f;
  --osrs-hp-green: #22aa22;
  --osrs-prayer-cyan: #22aacc;
  --osrs-boss-red: #cc3333;
}
```

### Phase 2: KeyBindManager + Input Refactor

Decouple key handling from hardcoded actions. The `KeyBindManager` maps keys to named actions; `InputManager` delegates to it.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/input/KeyBindManager.ts` | Create | `KeyBindManager` class: stores `Map<string, string>` (key → action name), methods `bind(key, action)`, `unbind(key)`, `getAction(key): string \| null`, `getKeyForAction(action): string \| null`, `setBindings(bindings)`, `getBindings()` |
| `src/input/InputManager.ts` | Modify | Replace hardcoded F1/F2 switch block with `KeyBindManager.getAction(e.key)` lookup. Actions: `'prayer-magic'`, `'prayer-missiles'`, `'prayer-off'`, `'tab-inventory'`, `'tab-prayer'`, `'tab-equipment'` |
| `src/input/defaultBindings.ts` | Create | Export `DEFAULT_KEYBINDINGS: Record<string, string>` mapping F1→prayer-magic, F2→prayer-missiles, Escape→tab-inventory, F5→tab-prayer, F4→tab-equipment (OSRS defaults) |

### Phase 3: Inventory Data Model

Build the data layer that future sprints (eating, potions, weapon switching) will operate on. No rendering yet.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/equipment/inventory.ts` | Create | `InventoryItem` interface, `ItemCategory` enum (`weapon`, `food`, `potion`, `other`), `InventorySlot` interface, `InventoryModel` class with `slots: InventorySlot[28]`, `addItem()`, `removeItem()`, `getSlot()`, `useSlot()`, `isFull()`, `count()` |
| `src/equipment/equipmentModel.ts` | Create | `SlotType` enum (head, cape, neck, ammo, weapon, body, shield, legs, hands, feet, ring), `EquipmentSlot` interface, `EquipmentModel` class with `equip(slot, item)` (validates `item.slotType === slot`), `unequip(slot)`, `getSlot()`, `toArray()` |
| `src/equipment/Loadout.ts` | Modify | Extend to populate `InventoryModel` from config (fish count, potion doses, extra weapons). Extend to populate `EquipmentModel` from selected armor + active weapon. |
| `src/equipment/items.ts` | Modify | Add `InventoryItem` definitions for paddlefish, corrupted paddlefish, and Egniol potion (with dose variants). Add sprite path references. |
| `src/entities/Player.ts` | Modify | Add `inventory: InventoryModel` and `equipment: EquipmentModel` properties, initialized from `Loadout` in constructor. Reset them in `reset()`. |

### Phase 4: Prayer Data Definitions

Make the prayer panel data-driven so adding prayers later is just appending to an array.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/combat/prayers.ts` | Create | `PrayerDefinition` interface: `{ id: string; name: string; levelReq: number; drainRate: number; spriteActive: string; spriteInactive: string; effect: PrayerEffect; category: 'overhead' \| 'offensive' \| 'defensive' }`. Export `PRAYERS: PrayerDefinition[]` with all CG-relevant prayers: Protect from Magic, Protect from Missiles, Piety, Rigour, Augury, Eagle Eye, Mystic Might, Incredible Reflexes, Ultimate Strength. |
| `src/combat/PrayerManager.ts` | Modify | Import `PRAYERS` definitions. Add method `getPrayerDef(id): PrayerDefinition`. Support toggling by prayer ID string (not just 'magic'/'missiles'). Keep backward compat with existing `PrayerType` for sprint 1 code. |

### Phase 5: Panel Implementations

Concrete panel classes that read from the data models and render to DOM.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/ui/InventoryPanel.ts` | Create | Extends `Panel`. Renders 4x7 grid. Each cell reads `player.inventory.getSlot(i)`. Shows item sprite or empty slot background. Click handler reserved for sprint 3+ (eat/drink/equip). |
| `src/ui/PrayerPanel.ts` | Create | Extends `Panel`. Iterates `PRAYERS` array, renders 5x6 grid. Each cell: dimmed sprite if inactive, bright + highlight circle if active. Click toggles via `PrayerManager.queueSwitch()`. Grayed out if level req not met. |
| `src/ui/EquipmentPanel.ts` | Create | Extends `Panel`. Paper-doll layout with 11 named slots. Each slot reads `player.equipment.getSlot(slotType)`. Shows item sprite or silhouette outline. |
| `src/render/HUD.ts` | Modify | Replace monolithic `build()` with composition: keep HP/prayer/boss bars at top, delegate tab content to `SidePanel`. `update()` calls `sidePanel.update(sim)`. |

### Phase 6: Loadout Screen F-Key Config

Let the player configure which F-keys map to which tabs before the fight.

**Files:**

| File | Action | Description |
|------|--------|-------------|
| `src/render/LoadoutScreen.ts` | Modify | Add "F-Key Bindings" section with dropdowns or click-to-rebind UI for each action. Writes to `KeyBindManager`. Add inventory slot counter showing used/28 slots. |
| `src/main.ts` | Modify | Create `KeyBindManager` at app level. Pass to `InputManager`, `SidePanel`, and `LoadoutScreen`. Wire `SidePanel` into the game loop via `HUD`. |

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `index.html` | Modify | 1 |
| `src/ui/Panel.ts` | Create | 1 |
| `src/ui/TabBar.ts` | Create | 1 |
| `src/ui/SidePanel.ts` | Create | 1 |
| `src/ui/types.ts` | Create | 1 |
| `src/input/KeyBindManager.ts` | Create | 2 |
| `src/input/InputManager.ts` | Modify | 2 |
| `src/input/defaultBindings.ts` | Create | 2 |
| `src/equipment/inventory.ts` | Create | 3 |
| `src/equipment/equipmentModel.ts` | Create | 3 |
| `src/equipment/Loadout.ts` | Modify | 3 |
| `src/equipment/items.ts` | Modify | 3 |
| `src/entities/Player.ts` | Modify | 3 |
| `src/combat/prayers.ts` | Create | 4 |
| `src/combat/PrayerManager.ts` | Modify | 4 |
| `src/ui/InventoryPanel.ts` | Create | 5 |
| `src/ui/PrayerPanel.ts` | Create | 5 |
| `src/ui/EquipmentPanel.ts` | Create | 5 |
| `src/render/HUD.ts` | Modify | 5 |
| `src/render/LoadoutScreen.ts` | Modify | 6 |
| `src/main.ts` | Modify | 6 |

**New files:** 11 | **Modified files:** 7 | **Total:** 18

---

## Definition of Done

1. **Widget system works generically** — Adding a new tab requires only: create a `Panel` subclass, register it with `SidePanel`, and add a keybinding entry. No other files change.
2. **Tab switching via F-keys** — Configured F-keys switch the active panel during combat. At least three tabs functional (Inventory, Prayer, Equipment).
3. **Inventory model is decoupled** — `InventoryModel` and `EquipmentModel` exist as pure data on `Player` with no DOM references. Panel classes read models to render.
4. **Prayer panel is data-driven** — All displayed prayers come from the `PRAYERS` array. Adding a prayer means one array entry, zero rendering code changes.
5. **Equipment panel validates slots** — `EquipmentModel.equip()` rejects items placed in wrong slot types (e.g., weapon in head slot).
6. **F-key config on loadout screen** — Player can reassign F-key bindings before the fight. Bindings persist for the session.
7. **CSS theme is centralized** — All OSRS colors reference `--osrs-*` custom properties. Changing a color in `:root` updates the entire UI.
8. **Sprint 1 tests pass** — All 54 existing tests still green. No regressions in tick engine, combat, movement, or prayer switching.
9. **New tests added:**
   - `KeyBindManager`: bind/unbind/resolve, conflict detection
   - `InventoryModel`: add/remove/isFull, slot bounds
   - `EquipmentModel`: equip/unequip, validation rejects wrong slot types
   - `PrayerDefinition` data: all prayers have required fields, level reqs correct
   - Tab switching: SidePanel activates correct panel for each tab ID
10. **Visual fidelity** — Side panel dimensions match OSRS (249px width), stone-textured background, correct tab icon sizing (33x36px), inventory grid is 4x7.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Over-engineering the widget system delays delivery | Medium | Keep `Panel` abstract class minimal (3 methods). No event bus, no dependency injection framework. Plain callbacks. |
| `InventoryModel.useSlot()` API is speculative for sprint 3+ needs | Low | Implement as a no-op hook now (`useSlot` returns `false`). Sprint 3 fills in eat/drink/equip logic. The slot structure and item definitions are the important parts. |
| `PrayerManager` refactor to support prayer IDs (not just 'magic'/'missiles') may break sprint 1 combat logic | Medium | Keep `PrayerType = 'magic' \| 'missiles' \| null` for the overhead prayer field. The new prayer ID system extends, not replaces. Overhead prayer resolution maps prayer IDs back to `PrayerType`. |
| OSRS bitmap font licensing/bundling may be problematic | Low | Defer custom fonts to a stretch goal. Use system sans-serif with OSRS color theme for sprint 2. Add font support in a follow-up if needed. |
| 18 files is a large surface area for one sprint | Medium | Phases are designed to be independently testable. Phase 1-2 can merge first, then 3-4, then 5-6. Each pair is a shippable increment. |

---

## Security

- No new external dependencies introduced. Zero runtime deps constraint maintained.
- `KeyBindManager` only maps keyboard key names to action strings; no eval or dynamic code execution.
- Inventory/equipment models are local state only. No serialization to localStorage or network in this sprint.
- CSP header in `index.html` already restricts `default-src 'self'`; no changes needed.

---

## Dependencies

- **Sprint 1 complete** — tick engine, combat formulas, boss AI, movement, prayer switching, loadout screen all shipped.
- **Prayer icon sprites** — Sprites 127, 128, 147, 148 already extracted and available at `/docs/assets/sprites/`.
- **Item sprites** — Need inventory item icons (fish, potions, weapons) for the inventory panel. Can use placeholder colored rectangles initially, replace with extracted sprites.
- **No external packages** — All implementation uses vanilla TypeScript + DOM APIs.

---

## Open Questions

1. **Should `InventoryModel` support drag-and-drop reordering in sprint 2, or display-only?** Recommendation: display-only for sprint 2. Click-to-use in sprint 3. Drag-and-drop is a stretch goal.
2. **How many tabs to render in the TabBar?** The OSRS interface has 14 tabs. Should we render all 14 (most grayed out / non-functional) for visual fidelity, or only the 3 functional ones? Recommendation: render all 14 with placeholder icons for visual accuracy; only Inventory, Prayer, and Equipment are interactive.
3. **Should the `EquipmentModel` auto-populate from loadout, or should the player drag items from inventory to equipment?** Recommendation: auto-populate from loadout config for sprint 2. Equipment is read-only during combat in the Gauntlet context.
4. **Where does weapon switching live architecturally?** Sprint 3+ will need `InventoryModel.useSlot(weaponIndex)` to trigger `EquipmentModel.equip(weapon, slot)` and swap the old weapon back to inventory. The `useSlot()` hook and slot-type validation in this sprint are the prerequisite. Does the switching action go through `InputManager` (click on inventory) or a separate keybind?
5. **Should the `SidePanel` support being collapsed/hidden?** OSRS allows this. Recommendation: defer to a later sprint. Always visible for now.
6. **LoadoutConfig needs expansion** — Currently `LoadoutConfig` only has `armorTier`, `weaponType`, `weaponTier`. Sprint 2 needs fish count, potion doses, and potentially a second weapon type. Should `LoadoutConfig` be extended in-place, or should we create a `FullLoadoutConfig` that composes the existing one? Recommendation: extend `LoadoutConfig` directly with optional fields (`fishCount?: number`, `corruptedFishCount?: number`, `egniolDoses?: number`, `secondWeaponType?: WeaponType`, `secondWeaponTier?: 1|2|3`) and keep backward compatibility.
