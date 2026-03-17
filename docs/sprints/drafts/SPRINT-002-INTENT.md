# Sprint 002 Intent: OSRS-Faithful Side Panel — Inventory, Prayer, Equipment + F-Key Config

## Seed

Build inventory panel, prayer menu, and equipment panel UI styled to match the OSRS interface exactly. Players configure which F-keys map to inventory/prayer/equipment views before starting the fight.

## Context

- **Sprint 1 shipped**: Tick engine, combat formulas, boss AI, movement, prayer switching, loadout screen, win/loss flow. 54 tests passing. Zero runtime deps.
- **Current HUD**: Simple DOM sidebar with HP/prayer bars, prayer icons, attack counter. No tabs, no inventory grid, no equipment panel.
- **Input system**: F1/F2 hardcoded for Protect from Magic / Protect from Missiles. Needs to support tab switching + configurable keybinds.
- **Equipment data exists**: `items.ts` has all weapon/armor stats. `Loadout.ts` has armor + weapon config. No inventory slots modeled yet.
- **Assets available**: Prayer icon sprites (127, 128, 147, 148) extracted. OSRS bitmap fonts available from RuneStar/fonts repo as OTF/TTF.

## OSRS Interface Specifications (from research)

### Side Panel
- Width: **249px**, content height: ~261px between tab rows
- Background: dark brown stone texture (~#3e362f mottled)
- Font: OSRS bitmap fonts (Plain 11, Plain 12, Bold 12) from RuneStar/fonts

### Tab Bar
- **14 tabs** in 2 rows of 7, each ~33x36px
- Stone texture tabs with icons. Active = lighter/raised, inactive = darker/recessed
- Default OSRS F-key assignments: F1=Combat, F2=Stats, F3=Quests, F4=Equipment, F5=Prayer, F6=Spellbook, F7-F12=social/settings, Esc=Inventory
- F-keys are rebindable in OSRS since 2015

### Inventory Panel (tab icon: backpack)
- 4 columns x 7 rows = 28 slots
- Item sprites: 36x32px per icon
- Dark brown background, items float on slots
- Shows weapon(s), food, potions from loadout

### Prayer Panel (tab icon: prayer star)
- 5 columns x 6 rows grid
- 29+ prayers in fixed order (we only need the ones relevant to Gauntlet)
- Active prayer: bright icon + beige circle highlight
- Inactive: dimmed icon
- Click to toggle prayers on/off

### Equipment Panel (tab icon: helmet)
- Paper doll layout with 11 slots:
  ```
        [Head]
  [Cape][Neck][Ammo]
  [Weapon][Body][Shield]
        [Legs]
  [Hands][Feet][Ring]
  ```
- Empty slots show silhouette outlines
- Equipment stats button at bottom

## Relevant Codebase Areas

- `src/render/HUD.ts` — Current sidebar, needs replacement with tabbed panel
- `src/input/InputManager.ts` — Hardcoded F1/F2, needs configurable keybinds
- `src/render/LoadoutScreen.ts` — Add F-key config section
- `src/equipment/items.ts` — Has weapon/armor data, needs inventory slot model
- `src/entities/Player.ts` — Needs inventory array
- `src/combat/PrayerManager.ts` — Needs click-to-toggle integration
- `index.html` — CSS for new panel styling

## Constraints

- Zero runtime dependencies (vanilla TS + DOM + Canvas)
- Must look like the OSRS interface — stone textures, bitmap fonts, correct panel layouts
- Must preserve all sprint 1 functionality (tick engine, combat, movement)
- F-key configuration must happen on the loadout screen before fight starts
- Prayer panel clicks must integrate with existing PrayerManager
- Only need to show panels relevant to the Gauntlet fight (no spellbook, quests, etc.)

## Success Criteria

1. Side panel has tabbed navigation matching OSRS stone aesthetic
2. Inventory shows 4x7 grid with equipped items visible
3. Prayer panel shows relevant prayers with click-to-toggle
4. Equipment panel shows paper doll with equipped gear
5. F-key bindings are configurable on loadout screen
6. Configured F-keys switch between tabs during fight
7. Visual fidelity matches OSRS interface (stone texture, correct colors, bitmap font)

## Verification Strategy

- Visual comparison against OSRS screenshots
- agent-browser screenshots for automated visual verification
- Existing tests still pass (no regressions)
- New tests: F-key config persistence, tab switching, prayer toggle via click

## Uncertainty Assessment

- **Correctness: Low** — OSRS interface is well-documented, visual reference is clear
- **Scope: Medium** — Three panels + tab system + F-key config + styling is substantial but bounded
- **Architecture: Medium** — Tab system is new UI pattern; need to decide how it integrates with existing HUD and input systems

## Open Questions

1. Which tabs to include? Just Inventory/Prayer/Equipment? Or also Combat Options (attack styles)?
2. Should the stone texture be a CSS background or a canvas-drawn texture?
3. How to source the OSRS bitmap fonts — bundle RuneStar OTF files?
4. Should inventory support drag-and-drop or just display? (Sprint 2 = display only?)
5. Do we need to model the full inventory (28 slots with food/potions) or just show equipped weapon + armor?
