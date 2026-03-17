# Sprint 002 — Codex Draft: Side Panel Tabs, Inventory/Prayer/Equipment UI, F-Key Config

## Overview

Add a tabbed side panel with Inventory, Prayer, Equipment, and (optionally) Combat tabs. Wire up configurable F-key bindings stored in localStorage. Reuse the existing HUD bars — do not rebuild them. This sprint ships UI panels, not new game mechanics.

**Perspective:** Pragmatic minimalist. Get the layout right, get the colors close enough, ship it. No drag-and-drop, no pixel-perfect textures, no new combat systems. If it looks recognizably OSRS and the tabs switch with F-keys, it is done.

---

## Use Cases

1. **UC-1: Tab switching** — During a fight, player presses an F-key (e.g. F3) and the side panel switches to the bound tab (e.g. Prayer). Visual tab highlight updates.
2. **UC-2: Inventory display** — Inventory tab shows a 4x7 grid. Slots are populated from the player's loadout (weapons, fish, potions). Items display as labeled colored rectangles or simple icons. No drag-and-drop, no rearranging.
3. **UC-3: Prayer toggling** — Prayer tab shows a grid of Gauntlet-relevant prayers. Clicking a prayer icon toggles it on/off via the existing `PrayerManager`. Active prayers are visually highlighted. The existing overhead protection F1/F2 shortcuts still work regardless of which tab is open.
4. **UC-4: Equipment display** — Equipment tab shows a simplified paper-doll layout with the player's currently equipped armor set and weapon. Slots that are empty show a dim outline. Read-only — no equip/unequip during combat.
5. **UC-5: F-key configuration** — On the loadout screen, a small config section lets the player assign F1-F6 to tabs (Inventory, Prayer, Equipment, Combat). Defaults match OSRS (F1=Combat, F4=Equipment, F5=Prayer, Esc=Inventory). Bindings persist in localStorage.
6. **UC-6: Existing HUD preserved** — HP bar, prayer bar, boss HP bar, attack counter, and tick counter remain visible above/outside the tab content area. They are not moved into a tab.

---

## Architecture

### Design Principles

- **Extend, don't replace.** The current `HUD` class stays. A new `SidePanel` class wraps it and adds tabs below the bars.
- **DOM-only panels.** All tab content is HTML/CSS. No canvas rendering for UI panels. This matches the existing approach in `HUD.ts`.
- **Data flows down.** `SidePanel.update(sim)` is called each tick, same as `HUD.update(sim)`. Panels read from `GameSimulation` — no new state objects.
- **Keybinds are a lookup table.** A `KeybindManager` holds a `Record<string, TabId>` mapping. InputManager delegates tab-switch keys to it. Prayer hotkeys (F1/F2 for overhead switching) remain hardcoded in InputManager — they are combat inputs, not tab navigation.

### Tab Content

| Tab ID | Label | Content |
|--------|-------|---------|
| `inventory` | Inventory | 4x7 grid of item slots from loadout |
| `prayer` | Prayer | Grid of ~8 relevant prayers (Protect Magic/Missiles, Piety, Rigour, Augury, Eagle Eye, Mystic Might, Steel Skin) |
| `equipment` | Equipment | Paper-doll layout: Head, Body, Legs, Weapon, plus a stats summary |
| `combat` | Combat | (Optional stretch) Attack style display — which weapon is active. Low priority. |

Only 3 tabs are required (Inventory, Prayer, Equipment). Combat tab is stretch.

### State Additions

The player needs an inventory model. Add a simple `InventorySlot[]` array to `Player` or `GameSimulation`, populated from the loadout at fight start. No runtime mutations in this sprint (eating/potions modify counts but don't rearrange slots — that is sprint 1 behavior already).

```typescript
interface InventorySlot {
  itemId: string;      // e.g. 'paddlefish', 'egniol_4', 'corrupted_bow_t3'
  label: string;       // display name
  quantity?: number;   // for stackable items (potions show dose count)
  color: string;       // fallback color for the slot rectangle
}
```

---

## Implementation

### Phase 1: Keybind Config + Storage

**Goal:** F-key assignments configurable on the loadout screen and persisted in localStorage.

| Task | File(s) | Details |
|------|---------|---------|
| Define keybind types and defaults | `src/input/KeybindManager.ts` | `TabId = 'inventory' \| 'prayer' \| 'equipment' \| 'combat'`. Default map: `{F1: 'combat', F4: 'equipment', F5: 'prayer', Escape: 'inventory'}`. Load/save from `localStorage` key `cg-sim-keybinds`. |
| Add config UI to loadout screen | `src/render/LoadoutScreen.ts` | Below existing loadout rows, add a "Keybinds" section. Each tab gets a `<select>` dropdown with options F1-F6 + Escape. Pre-populate from saved config or defaults. On change, save to localStorage. |
| Unit test keybind persistence | `src/input/__tests__/KeybindManager.test.ts` | Test: defaults returned when localStorage is empty. Test: save + load round-trips. Test: duplicate key assignment prevented or last-write-wins. |

### Phase 2: Tab Bar + Side Panel Shell

**Goal:** Tabbed side panel visible during fight. Clicking a tab or pressing an F-key switches the active panel.

| Task | File(s) | Details |
|------|---------|---------|
| Create SidePanel class | `src/render/SidePanel.ts` | Builds the tab bar (3-4 tab buttons) and a content area below the existing HUD bars. Each tab button shows a text label or simple icon. Active tab gets a highlight class. |
| Integrate with HUD container | `src/render/HUD.ts` | Modify `HUD.build()` to leave room for tab content below the bars. Or: `SidePanel` wraps the HUD container and appends tab bar + content div after the bars. Prefer the wrapper approach — fewer changes to existing code. |
| Wire tab switching to InputManager | `src/input/InputManager.ts` | On keydown, check `KeybindManager` for a tab mapping. If found, call `sidePanel.switchTab(tabId)`. This replaces the need for F-keys to be hardcoded for anything except prayer combat switching. |
| Update main.ts | `src/main.ts` | Create `SidePanel` and `KeybindManager` in `startFight()`. Pass `KeybindManager` to `InputManager`. Call `sidePanel.update(sim)` in the tick callback alongside `hud.update(sim)`. |
| CSS for tab bar | `index.html` (inline styles) | Tab bar: row of buttons, dark brown background (`#3e362f`), active tab lighter (`#5a4a3a`). Content area: dark background, fixed height ~260px. OSRS-like colors, not pixel-perfect. |

### Phase 3: Inventory Panel

**Goal:** 4x7 grid showing the player's items from their loadout.

| Task | File(s) | Details |
|------|---------|---------|
| Define inventory slot model | `src/equipment/Inventory.ts` | `InventorySlot` interface. `buildInventory(loadout: Loadout): InventorySlot[]` — maps the loadout config into a 28-slot array. Weapon goes in slot 0. Remaining slots filled with fish/potions (when loadout is expanded to include them). Empty slots are null. |
| Render inventory grid | `src/render/panels/InventoryPanel.ts` | Renders a 4-column CSS grid inside the tab content div. Each slot is a ~36x32 div. Occupied slots show item name abbreviation and a colored background. Empty slots show a dark outline. |
| Hook up to SidePanel | `src/render/SidePanel.ts` | When inventory tab is active, `InventoryPanel.update(sim)` is called. |
| Test inventory building | `src/equipment/__tests__/Inventory.test.ts` | Test: T3 staff loadout produces slot 0 = staff. Test: empty loadout has 28 empty slots. |

### Phase 4: Prayer Panel

**Goal:** Grid of Gauntlet-relevant prayers. Click to toggle. Visual feedback for active prayers.

| Task | File(s) | Details |
|------|---------|---------|
| Define prayer data | `src/combat/prayers.ts` | Array of prayer definitions: `{ id, name, spriteActive, spriteInactive, type: 'protection' \| 'offensive' }`. Include: Protect from Magic, Protect from Missiles, Piety, Rigour, Augury, Eagle Eye, Mystic Might, Steel Skin. Only prayers relevant to Gauntlet — no Smite, no Redemption, etc. |
| Render prayer grid | `src/render/panels/PrayerPanel.ts` | CSS grid, 4 columns. Each prayer is an icon (using existing sprite images for protections, colored rectangles with text for others until sprites are available). Active = bright + highlighted border. Inactive = dimmed. Click handler calls `sim.queuePrayer()` for protection prayers. Offensive prayer toggling is stretch (requires `PrayerManager` extension). |
| Extend PrayerManager for click integration | `src/combat/PrayerManager.ts` | No changes needed for protection prayers — `queueSwitch()` already exists. For offensive prayers (Piety/Rigour/Augury), add a `offensivePrayer` field if combat formulas need it. Otherwise, offensive prayers are display-only in this sprint. |
| Hook up to SidePanel | `src/render/SidePanel.ts` | Prayer panel wired into tab content. Click events on prayer icons dispatch to PrayerManager. |

### Phase 5: Equipment Panel

**Goal:** Simplified paper-doll showing equipped gear.

| Task | File(s) | Details |
|------|---------|---------|
| Render equipment layout | `src/render/panels/EquipmentPanel.ts` | A CSS grid/absolute-positioned layout with slots for Head, Body, Legs, Weapon. Each slot shows the equipped item name or "Empty" with a silhouette-style border. Use `sim.player.loadout` to read equipped gear. |
| Stats summary | `src/render/panels/EquipmentPanel.ts` | Below the paper doll, show total defence bonus and prayer bonus as text. Reads from `loadout.armor` and `loadout.weapon`. |
| Hook up to SidePanel | `src/render/SidePanel.ts` | Equipment panel wired into tab content. |

### Phase 6: Polish + Integration

**Goal:** Everything works together. No regressions.

| Task | File(s) | Details |
|------|---------|---------|
| Prayer F1/F2 still works | `src/input/InputManager.ts` | Prayer combat hotkeys (F1=Protect Magic, F2=Protect Missiles) must work regardless of tab keybind config. If a user binds F1 to Inventory, the prayer shortcut moves to whatever key they assign, OR prayer shortcuts are always active and tab switching is secondary. Decision: prayer shortcuts are separate from tab keybinds — they live in PrayerManager, not KeybindManager. Keep F1/F2 as prayer shortcuts; tab switching uses F3-F6 by default. |
| Verify existing tests pass | All test files | `npm test` — no regressions. |
| Visual polish pass | `index.html` | Darken backgrounds, add subtle borders, ensure text is readable. OSRS-ish brown/tan palette. Not pixel-perfect, just recognizable. |

---

## Files Summary

```
cg-sim/
├── index.html                                    # CSS additions for tabs, panels, grids
├── src/
│   ├── main.ts                                   # Wire SidePanel + KeybindManager into fight loop
│   ├── input/
│   │   ├── InputManager.ts                       # Add tab-switch key handling via KeybindManager
│   │   ├── KeybindManager.ts                     # NEW — F-key → tab mapping, localStorage persistence
│   │   └── __tests__/
│   │       └── KeybindManager.test.ts            # NEW — Keybind load/save/default tests
│   ├── equipment/
│   │   ├── Inventory.ts                          # NEW — InventorySlot model, buildInventory()
│   │   └── __tests__/
│   │       └── Inventory.test.ts                 # NEW — Inventory building tests
│   ├── combat/
│   │   ├── PrayerManager.ts                      # Minor: offensive prayer field (stretch)
│   │   └── prayers.ts                            # NEW — Prayer definitions for Gauntlet
│   ├── render/
│   │   ├── HUD.ts                                # Minor adjustment: leave room for tab content
│   │   ├── SidePanel.ts                          # NEW — Tab bar + content area container
│   │   ├── LoadoutScreen.ts                      # Add keybind config section
│   │   └── panels/
│   │       ├── InventoryPanel.ts                 # NEW — 4x7 item grid renderer
│   │       ├── PrayerPanel.ts                    # NEW — Prayer icon grid with click-to-toggle
│   │       └── EquipmentPanel.ts                 # NEW — Paper-doll equipment display
```

**New files: 9.** Modified files: 4 (`index.html`, `main.ts`, `InputManager.ts`, `LoadoutScreen.ts`). HUD.ts changes are minimal (structural, not behavioral).

---

## Definition of Done

1. Side panel shows 3 tabs (Inventory, Prayer, Equipment) below the existing HP/prayer/boss bars.
2. Pressing a configured F-key switches the active tab. Default bindings work out of the box.
3. Inventory tab displays a 4x7 grid populated from the player's loadout.
4. Prayer tab displays Gauntlet-relevant prayers. Clicking a protection prayer toggles it via PrayerManager.
5. Equipment tab shows the currently equipped weapon and armor with a stats summary.
6. F-key bindings are configurable on the loadout screen and persist across sessions via localStorage.
7. F1/F2 prayer switching (combat hotkeys) still works — no regression.
8. All existing tests pass (`npm test`).
9. New tests: keybind persistence, inventory building from loadout.
10. Side panel styling uses OSRS-adjacent dark brown palette. Looks intentional, not broken.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Scope creep into drag-and-drop inventory | Medium | High | Explicitly out of scope. Inventory is display-only. No item rearranging. |
| F-key conflicts between prayer switching and tab navigation | Medium | Medium | Keep prayer hotkeys (F1/F2) separate from tab keybinds (F3-F6 default). Document clearly. |
| Offensive prayer integration (Piety/Rigour/Augury) pulls in combat formula changes | Medium | Medium | Offensive prayers are display-only in this sprint. PrayerManager changes for offensive prayers deferred unless trivial. |
| Panel layout breaks at different window sizes | Low | Low | Fixed-width side panel (249px). No responsive design needed — simulator targets desktop. |
| Loadout screen gets crowded with keybind config | Low | Low | Keep keybind UI minimal: one row per tab, dropdown for key assignment. Collapsible if needed. |

---

## Security Considerations

- localStorage usage is read/write of a small JSON blob (keybind config). No sensitive data.
- No new network requests. No eval. No dynamic script loading.
- Click handlers on prayer icons are standard DOM event listeners — no injection risk.
- Same security posture as sprint 1: entirely client-side, no server, no auth.

---

## Dependencies

No new dependencies. Same stack as sprint 1:

| Dependency | Version | Purpose |
|-----------|---------|---------|
| typescript | ^5.x | Language |
| vite | ^6.x | Dev server + bundler |
| vitest | ^3.x | Test runner |

Zero runtime dependencies. Vanilla TypeScript + DOM.

---

## Open Questions

1. **Prayer hotkeys vs. tab hotkeys:** Should F1/F2 always toggle protection prayers (current behavior), with tab switching on F3+? Or should tab keybinds be primary, and prayer toggling happen only via clicking the prayer panel? **Recommendation:** Keep F1/F2 as prayer combat hotkeys. Tab switching defaults to F3=Inventory, F4=Equipment, F5=Prayer. Separate concerns.

2. **Inventory contents beyond weapons:** Sprint 1's `LoadoutConfig` only has `armorTier`, `weaponType`, and `weaponTier` — no fish or potion counts. Should this sprint extend `LoadoutConfig` to include fish/potions so the inventory grid has items to display? **Recommendation:** Yes, add fish/potion count fields to `LoadoutConfig`. This is minimal data modeling, not a new game mechanic.

3. **Offensive prayer display vs. function:** Should clicking Piety/Rigour/Augury actually activate them (requiring PrayerManager + formula changes), or just show them as available? **Recommendation:** Display-only for this sprint. Clicking shows a "not yet implemented" visual or does nothing. Wiring into combat formulas is a separate sprint.

4. **Combat tab inclusion:** Is a 4th tab for combat/attack-style display worth the effort? **Recommendation:** Skip it. Three tabs is enough. Attack style info can go in the HUD bar area or the equipment panel.
