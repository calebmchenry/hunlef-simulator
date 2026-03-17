# Sprint 004 Intent: Offensive Prayers, Countdown, Click-to-Attack, OSRS Combat Targeting

## Seed

Offensive prayers (toggle on/off), 10-tick countdown before fight starts (no attacks during countdown but player can equip items and turn on prayers), Hunlef always starts in ranged offensive phase, click-to-attack on Hunlef (no auto-attack), moving interrupts attack requiring re-click to resume, clicking on Hunlef attacks rather than moving to that tile.

## Context

- **Sprint 3 complete**: 90 tests, OSRS images everywhere, Hunlef protection prayer mechanic, overhead icons on canvas.
- **PrayerManager** only supports `'magic' | 'missiles' | null`. Needs offensive prayers: Piety (melee +23% str, +20% atk), Rigour (ranged +23% dmg, +20% acc), Augury (magic +25% acc), Eagle Eye (+15% ranged), Mystic Might (+15% magic). Each has its own drain rate.
- **Combat formulas** currently pass `1.0` as prayer multiplier everywhere. Need to read from active offensive prayer.
- **GameSimulation** auto-attacks when in range. Must become click-to-attack with target tracking.
- **InputManager.handleClick** always queues a move. Must detect boss tile clicks.
- **GameState** is `'running' | 'won' | 'lost'`. Needs `'countdown'` state.
- **Boss** already starts `currentStyle = 'ranged'` (correct).

## Relevant Codebase

- `src/combat/PrayerManager.ts` — Expand for offensive prayers + drain
- `src/engine/GameSimulation.ts` — Add countdown state, click-to-attack, movement interrupts attack
- `src/input/InputManager.ts` — Detect clicks on boss tiles vs ground tiles
- `src/render/PrayerPanel.ts` — Make offensive prayers interactive (Piety, Rigour, Augury, Eagle Eye, Mystic Might)
- `src/entities/Player.ts` — Add attack target tracking
- `src/combat/formulas.ts` — Already has prayer mult params, just need to pass correct values
- `src/render/Renderer.ts` — Render countdown timer, attack target indicator
- `src/render/HUD.ts` — Show countdown

## Key Mechanics

### Offensive Prayers (OSRS values)
| Prayer | Type | Accuracy Mult | Damage/Str Mult | Drain Rate |
|--------|------|--------------|-----------------|------------|
| Eagle Eye | Ranged | 1.15 | 1.15 | 12 |
| Mystic Might | Magic | 1.15 | - (staff fixed) | 12 |
| Rigour | Ranged | 1.20 | 1.23 | 24 |
| Augury | Magic | 1.25 | - (staff fixed but +1 max hit) | 24 |
| Piety | Melee | 1.20 (atk) | 1.23 (str) | 24 |

- Only ONE offensive prayer active at a time (mutually exclusive within category)
- Can have offensive prayer + protection prayer active simultaneously
- Offensive prayers stack with protection prayers for drain

### 10-Tick Countdown
- GameState: `'countdown'` → after 10 ticks → `'running'`
- During countdown: no attacks from either side, player can move, equip items, toggle prayers
- Visual: large countdown number on canvas ("10", "9", ... "1", "FIGHT!")

### Click-to-Attack (OSRS Mechanics)
- Clicking a ground tile: queue move (existing behavior)
- Clicking on the boss (any tile in 5x5 footprint): set attack target = boss, clear move target
- With attack target set: player auto-walks into weapon range, then attacks on cooldown
- Moving (clicking a ground tile) clears the attack target — must re-click boss to resume
- If player is already in range: attack fires immediately on next tick, no movement needed
- Player does NOT auto-attack on fight start — must explicitly click the boss

## Constraints

- Zero runtime deps
- All 90 existing tests must pass
- Offensive prayer multipliers must match OSRS exactly
- Boss always starts ranged offensive (already correct)
- Prayer drain must handle multiple active prayers (protection + offensive)

## Success Criteria

1. Offensive prayers toggle on/off via prayer panel clicks
2. Active offensive prayer applies correct multiplier to combat formulas
3. Multiple prayers drain simultaneously (protection + offensive)
4. 10-tick countdown before combat begins
5. Player can prep during countdown (equip, pray) but cannot attack
6. Clicking boss tiles initiates attack targeting
7. Clicking ground tiles clears attack target
8. Player auto-walks into range when targeting boss
9. Attack fires on cooldown only while target is set

## Uncertainty Assessment

- **Correctness: Medium** — Offensive prayer multipliers need exact OSRS values
- **Scope: Low** — Well-defined mechanics, bounded changes
- **Architecture: Medium** — Click-to-attack targeting is a new interaction pattern
