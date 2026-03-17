# Sprint 002 Merge Notes

## Draft Strengths

### Claude Draft (545 lines)
- Most detailed OSRS styling: CSS custom properties, stone texture via composited gradients, exact 249px width
- Full 14-tab layout (only 3 functional, rest decorative) — matches OSRS authenticity
- Detailed prayer grid layout with all 29 prayers in correct OSRS order
- @font-face approach for RuneStar bitmap fonts

### Codex Draft (216 lines)
- Pragmatic: extend existing HUD rather than replace
- KeybindManager as a simple lookup table — clean separation
- InventorySlot with color fallback for items (no sprite dependency)
- Noted that prayer F-key hotkeys are combat inputs, not tab navigation — important distinction

### Gemini Draft (273 lines)
- Component hierarchy: SidePanel > TabBar > ContentArea > Panel — most modular
- Data model layer: InventorySlot with item/quantity decoupled from rendering
- EquipmentSlots as a typed record with slot validation
- CSS custom property theme for centralized OSRS styling
- inventory.use() action pattern for future eating/drinking

## Interview Decisions Applied

1. **3 tabs only**: Inventory, Prayer, Equipment (no Combat Options)
2. **Pixel-perfect OSRS clone**: RuneStar fonts, stone textures, exact colors, 249px panel
3. **Interactive inventory**: Click to eat food, drink potions, switch weapons — NOT display-only

## Key Merge Decisions

| Topic | Decision | Source |
|-------|----------|--------|
| Panel width | 249px fixed | Claude (OSRS wiki measurement) |
| Tab count rendered | 14 tabs (2 rows of 7), only 3 functional | Claude |
| Stone texture | CSS gradients, no image files | Claude |
| Fonts | RuneStar OTF via @font-face | Claude |
| Component architecture | SidePanel > TabBar + ContentArea > Panel classes | Gemini |
| Data model | InventorySlot[] on Player, decoupled from rendering | Gemini |
| Keybind system | KeyBindManager class with configurable F-key map | Codex |
| Prayer hotkeys vs tab keys | Separate concerns: F-keys switch tabs, prayer clicks toggle prayers | Codex |
| Inventory interaction | Click to eat/drink/switch — functional, not display-only | User interview |
| CSS theme | Custom properties for all OSRS colors | Claude + Gemini |
| HUD bars | Keep existing HP/prayer/boss bars above the tabbed panel | Codex |
