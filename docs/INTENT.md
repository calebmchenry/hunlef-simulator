# Corrupted Hunlef Fight Simulator — Intent Document

High-fidelity browser-based simulator for the Corrupted Hunlef boss fight from Old School RuneScape.
Scope begins at the start of the boss fight; pre-fight Gauntlet prep is out of scope.

---

## Tick System

- **1 tick = 600 ms** (exact)
- All game state advances in discrete 600 ms increments
- Player inputs queue during a tick and resolve at the start of the next tick
- Movement: 1 tile/tick walking, 2 tiles/tick running
- Prayer switches take effect the tick after the input is registered
- Eating standard food occupies the action slot for that tick; combo food (corrupted paddlefish) can be eaten the same tick as a regular fish with no delay

---

## The Arena

- **Room size:** 12×12 walkable tiles
- **No pillars** — open arena with no line-of-sight blockers
- **Floor tiles:** Persistent hazard system active throughout the fight — see Boss Special Attacks
- **Spawn position:** Player enters from the south; boss is centered in the room

---

## Player Loadout (Configurable at Start)

Maximum 28 inventory slots total. Weapons and potions all occupy inventory space.

### Armor
Four options: **none**, **tier 1 (Basic)**, **tier 2 (Attuned)**, **tier 3 (Perfected)**

Each tier = full set of helm + body + legs (3 armor pieces; treated as a set for selection purposes).

| Tier | Helm Def (all) | Body Def (all) | Legs Def (all) | Total Prayer Bonus |
|------|---------------|---------------|---------------|-------------------|
| None | 0 | 0 | 0 | +0 |
| T1 (Basic) | +28 | +86 | +52 | +6 |
| T2 (Attuned) | +48 | +102 | +74 | +9 |
| T3 (Perfected) | +68 | +124 | +92 | +12 |

All defense bonuses apply equally to stab, slash, crush, magic, and ranged.
No set bonus effect inside the Gauntlet.

### Weapons

Three weapon types, each with four tiers (none / T1 / T2 / T3).

#### Corrupted Bow (Ranged)
| Tier | Ranged Atk | Ranged Str | Prayer | Attack Speed | Range |
|------|-----------|-----------|--------|-------------|-------|
| None | — | — | — | — | — |
| T1 (Basic) | +72 | +42 | +1 | 4 ticks (rapid) | 10 tiles |
| T2 (Attuned) | +118 | +88 | +2 | 4 ticks (rapid) | 10 tiles |
| T3 (Perfected) | +172 | +138 | +3 | 4 ticks (rapid) | 10 tiles |

Rapid style = 4 ticks / Accurate style = 5 ticks. Simulator defaults to rapid.

#### Corrupted Staff (Magic — Powered Staff)
| Tier | Magic Atk | Magic Dmg% | Prayer | Attack Speed | Fixed Max Hit | Range |
|------|----------|-----------|--------|-------------|--------------|-------|
| None | — | — | — | — | — | — |
| T1 (Basic) | +84 | 0% | +1 | 4 ticks | **23** | 10 tiles |
| T2 (Attuned) | +128 | 0% | +2 | 4 ticks | **31** | 10 tiles |
| T3 (Perfected) | +184 | 0% | +3 | 4 ticks | **39** | 10 tiles |

**Important:** Corrupted staves are powered staves with a fixed max hit. Magic damage % gear bonuses do NOT affect max hit. Magic level affects accuracy only. Augury raises T3 max hit by 1 (to 40).

#### Corrupted Halberd (Melee)
| Tier | Slash Atk | Str Bonus | Prayer | Attack Speed | Melee Range |
|------|----------|----------|--------|-------------|------------|
| None | — | — | — | — | — |
| T1 (Basic) | +68 | +42 | +1 | 4 ticks | **2 tiles** |
| T2 (Attuned) | +114 | +88 | +2 | 4 ticks | **2 tiles** |
| T3 (Perfected) | +166 | +138 | +3 | 4 ticks | **2 tiles** |

Attack speed inside the Gauntlet = 4 ticks (special override; normally 7 ticks outside).
2-tile range allows attacking the boss without being directly adjacent.

### Inventory Items

#### Egniol Potions
- Restores **prayer points** — formula: `floor(Prayer_Level / 4) + 7` (e.g. level 70 → 24 pts, level 99 → 31 pts)
- Restores **40% run energy** and applies a stamina effect (reduced drain rate for a duration)
- Does NOT restore hitpoints
- Available in 1–4 dose variants (each dose = one usage)
- Player configures number of doses; inventory slots = `ceil(doses / 4)`

#### Fish
| Type | HP Healed | Eat Delay | Notes |
|------|----------|----------|-------|
| Paddlefish | 20 HP | 1 tick | Standard food |
| Corrupted paddlefish | 16 HP | None | Combo food — instant eat, can follow standard food in same tick |

Combo-eating: one standard paddlefish + one corrupted paddlefish in the same tick = up to 36 HP healed simultaneously.

---

## Player Combat Stats (Defaults for Simulation)

The simulator uses fixed base stats (Gauntlet character), configurable if needed:
- Attack: 99, Strength: 99, Defence: 99
- Ranged: 99, Magic: 99
- Hitpoints: 99, Prayer: 77 (base Gauntlet context)

---

## The Boss: Corrupted Hunlef

### Stats
| Property | Value |
|----------|-------|
| Combat Level | 894 |
| Hitpoints | 1,000 |
| Attack | 240 |
| Strength | 240 |
| Defence | 240 |
| Magic | 240 |
| Ranged | 240 |
| Size | 5×5 tiles |
| Attack Speed | **5 ticks (3.0 s)** |
| Defence bonus (all styles) | +20 |
| NPC IDs | 9035, 9036, 9037, 9038 |
| Immune to poison/venom | Yes |

### Defence Roll (for player hit chance calculations)
```
NPC Defence Roll = (240 + 9) × (20 + 64) = 249 × 84 = 20,916
```

---

## Boss Attack Mechanics

### Standard Attack Rotation
- Boss starts in **Ranged** style
- Fires **4 attacks** with one style, then switches to the other (Ranged → Magic → Ranged → …)
- The attack counter counts: standard attacks, the prayer-disable attack, and tornado summons
- Stomp attacks do **not** advance the counter
- Boss telegraphs the style switch via a visible animation change

### Standard Attacks
Both attacks are projectile-based:
- **Ranged attack:** projectile color TBD — verify from cache (green/yellow applies to the Crystalline version)
- **Magic attack:** projectile color TBD — verify from cache (blue/purple applies to the Crystalline version; Corrupted variant is likely red/orange toned)

**Damage with correct protection prayer:**
| Armor | Max Hit (Corrupted) |
|-------|-------------------|
| None | 16 |
| T1 (Basic) | 14 |
| T2 (Attuned) | 10 |
| T3 (Perfected) | 8 |

**Without correct prayer:** Boss hits for full max hit (~68 typeless).

---

## Boss Special Attacks

### 1. Floor Tile Hazard (Persistent Environmental)
Active throughout the entire fight. Does not count toward the 4-attack cycle.

- Tiles randomly cycle from **safe → warning → active hazard** (warning tile color TBD — blue applies to the Crystalline version; verify Corrupted variant color from cache)
- Standing on an active hazard tile deals **10–20 damage per tick**
- The pattern advances through three phases based on boss HP:

| HP Phase | HP Range | Tile Speed |
|----------|----------|-----------|
| Phase 1 | 1000–667 | Slow |
| Phase 2 | 666–333 | Medium |
| Phase 3 | 332–1 | Fast |

- In Phase 3, specific "safe tiles" exist that **never** become hazard tiles
- Warning → active transition: ~3–5 ticks in Phase 1, as fast as 1–2 ticks in Phase 3 (needs verification)

### 2. Tornado Summon
- Boss summons tornadoes that chase the player
- Counts as **one attack** in the 4-attack rotation
- Tornado count scales with boss HP:

| HP Range | Tornado Count |
|----------|--------------|
| 667–1000 | 2 |
| 333–666 | 3 |
| 1–332 | 4 |

- Each tornado chases the player, moving **1 tile per tick**
- Tornadoes last **20 ticks (12 seconds)** then despawn
- Damage while overlapping a tornado:

| Armor | Damage per tick |
|-------|----------------|
| None | 15–30 |
| T1 | 15–25 |
| T2 | 10–20 |
| T3 | 7–15 |

- Player must outrun tornadoes; no pillars to break pathing

### 3. Prayer-Disable Attack (Magic Phase Only)
- Occurs **exactly once per magic attack cycle** (one of the 4 magic attacks is the disable; which position in the cycle is random)
- Visually distinct from the standard magic attack (different color/animation)
- **Instantly disables all active prayers**
- Counts as one of the 4 attacks in the magic rotation
- Player must immediately re-enable protection prayer

### 4. Stomp Attack (Triggered)
- Triggered when the player walks **under the boss** (within its 5×5 tile footprint)
- Deals up to **68 typeless damage** (not reduced by prayer or armor)
- Does **not** count toward the 4-attack rotation
- Avoidable by never standing inside the boss's 5×5 tile area

---

## Combat Formulas

### Melee Max Hit
```
effective_str = floor( floor( (str_level + boost) × prayer_mult ) + stance_bonus + 8 )
max_hit = floor( (effective_str × (equip_str_bonus + 64) + 320) / 640 )
```
- Prayer multipliers: Ultimate Strength 1.15, Piety 1.23
- Stance bonus: Aggressive +3, Controlled +1, Accurate/Defensive +0

### Melee Accuracy (Attack Roll)
```
effective_atk = floor( floor( (atk_level + boost) × prayer_mult ) + stance_bonus + 8 )
attack_roll = effective_atk × (equip_atk_bonus + 64)
```
- Prayer multipliers: Incredible Reflexes 1.15, Piety 1.20
- Stance bonus: Accurate +3, Controlled +1

### Ranged Max Hit
```
effective_rng_str = floor( floor( (ranged_level + boost) × prayer_mult ) + 8 )
max_hit = floor( 0.5 + effective_rng_str × (equip_rng_str + 64) / 640 )
```
- Prayer multipliers: Eagle Eye 1.15, Rigour 1.23

### Ranged Accuracy (Attack Roll)
```
effective_rng_atk = floor( floor( (ranged_level + boost) × prayer_mult ) + stance_bonus + 8 )
attack_roll = effective_rng_atk × (equip_rng_atk + 64)
```
- Prayer multipliers: Eagle Eye 1.15, Rigour 1.20 (note: accuracy multiplier differs from damage)
- Stance bonus: Accurate +3

### Magic (Corrupted Staff — Fixed Max Hit)
Fixed max hits per tier (not dependent on magic level or magic damage %):
- T1: 23, T2: 31, T3: 39 (40 with Augury)

Accuracy roll:
```
effective_magic = floor( floor( (magic_level + boost) × prayer_mult ) + stance_bonus + 9 )
attack_roll = effective_magic × (equip_magic_atk + 64)
```
- Prayer multipliers: Mystic Might 1.15, Augury 1.25

### Hit Chance
```
if attack_roll > defence_roll:
    hit_chance = 1 − (defence_roll + 2) / (2 × (attack_roll + 1))
else:
    hit_chance = attack_roll / (2 × (defence_roll + 1))
```

### Average DPS
```
avg_damage_per_hit = hit_chance × (max_hit + 1) / 2
dps = avg_damage_per_hit / (attack_speed_ticks × 0.6)
```

---

## Prayer Mechanics

### Drain Rate
```
drain_resistance = 2 × total_prayer_bonus + 60
seconds_per_point = 0.6 × (drain_resistance / drain_rate_of_prayer)
```
- Protect from Magic drain rate: 12 per drain tick
- Protect from Missiles drain rate: 12 per drain tick
- With full T3 armor (+12 prayer bonus): `resistance = 84`, drain = 1 point every 4.2 seconds
- With no armor (+0 prayer bonus): `resistance = 60`, drain = 1 point every 3.0 seconds

### Damage Reduction
- Correct protection prayer vs. NPC: ~100% damage reduction (to the table values above)
- Incorrect or no prayer: full max hit applies (~68 for Corrupted Hunlef)
- Prayer-disable attack bypasses this by removing all prayers

---

## Player Movement

- Walking: 1 tile per tick
- Running: 2 tiles per tick (uses run energy)
- Run energy drain: reduced by Egniol potion stamina effect
- Player cannot move through the boss's 5×5 tile footprint
- Tornadoes occupy a single tile; player overlapping deals damage each tick

---

## Inventory System

- 28 total inventory slots
- Weapons occupy slots when in inventory (not on action bar)
- Each potion dose = carried as a vial; 4 doses = 1 slot, 3 doses = 1 slot, etc.
- Fish = 1 slot per fish
- Loadout validation: total slots used by weapons (not equipped), potions, and fish must not exceed 28

---

## Assets

### Source
All visual and audio assets should be sourced from the OSRS cache via the OpenRS2 Archive:
`https://archive.openrs2.org/` (use the most recent live OSRS cache build)

### NPC IDs
| NPC | IDs | Notes |
|-----|-----|-------|
| Corrupted Hunlef | 9035, 9036, 9037, 9038 | 4 variants for attack style / phase transitions |
| Corrupted Tornado | **9039** | Tornado NPC in Corrupted Gauntlet |

The game engine re-spawns the boss NPC with a different ID when it switches attack style.

### Animation IDs (from RuneLite gameval `AnimationID.java`)
| Animation | ID | Notes |
|-----------|-----|-------|
| Corrupted Hunlef idle/ready | **8435** | Also 8422 referenced as idle |
| Corrupted Hunlef magic attack | **8430** | |
| Corrupted Hunlef ranged attack | **8431** | |
| Corrupted Hunlef stomp/melee | **8432** | Triggered when player stands under boss |
| Corrupted Hunlef prayer-disable attack | **8433** | Distinct from regular magic attack |
| Corrupted Hunlef walk | **8434** | |
| Corrupted Hunlef death | **8436** | |
| Boss style switch → Mage | **8754** | Transition animation |
| Boss style switch → Range | **8755** | Transition animation |

### Projectile / Spotanim IDs (from RuneLite gameval `SpotanimID.java`)
`_HM` suffix = Corrupted (Hard Mode). All IDs below are for the Corrupted variant.

| Spotanim | ID | Notes |
|----------|-----|-------|
| Magic attack projectile (in-flight) | **1708** | |
| Magic attack impact | **1710** | |
| Ranged attack projectile (in-flight) | **1712** | No separate impact spotanim |
| Prayer-disable projectile (in-flight) | **1714** | |
| Prayer-disable impact | **1716** | |
| Floor tile activation graphic | **1718** | Applied when tile becomes active hazard |

### Object IDs
| Object | ID | Notes |
|--------|-----|-------|
| Floor hazard tile | **36048** | Game object placed in arena; spotanim 1718 applied on activation |

### Sprite IDs (Prayer Icons)
| Sprite | ID |
|--------|-----|
| Protect from Magic (active) | **127** |
| Protect from Missiles (active) | **128** |
| Protect from Magic (inactive) | **147** |
| Protect from Missiles (inactive) | **148** |

### Region IDs
| Region | ID |
|--------|-----|
| Corrupted Gauntlet | **7768** |

### Other Sprites / Textures
- Arena floor tile states (safe, warning, active hazard — exact Corrupted colors to be pulled from cache; Crystalline uses blue/orange)
- Tornado sprite (NPC 9039)
- Inventory item icons: corrupted bow, corrupted staff, corrupted halberd (each tier), paddlefish, corrupted paddlefish, Egniol potion
- HUD elements: HP bar, prayer bar, run energy, inventory grid

### Sound IDs
**Not documented** in any publicly accessible RuneLite constant file. To obtain:
1. Download OSRS cache from OpenRS2 Archive and dump sound definitions linked to NPC IDs 9035–9039
2. Or use RuneLite devtools plugin to capture sound events during gameplay

### RuneLite Plugin References
- **gameval `AnimationID.java`** — canonical animation ID constants (8422–8436 range for Hunlef)
- **gameval `SpotanimID.java`** — projectile/spotanim IDs (1707–1718 range for Hunlef)
- **GauntletPerformanceTracker plugin** — community plugin with verified in-game constants for attack detection

---

## HUD Elements

- **Hitpoints orb** — current / max HP (99 max)
- **Prayer orb** — current prayer points
- **Run energy orb** — current run energy (0–100%)
- **Active prayer indicator** — which overhead protection prayer is active (if any)
- **Inventory panel** — 28-slot grid with item icons and quantities
- **Attack style selector** — which weapon is equipped/active
- **Boss HP bar** — displayed above or near boss (1000 HP total)
- **Attack counter indicator** (optional QoL): shows how many attacks remain before boss switches style
- **Tile overlay** — visual highlight of active hazard tiles (matching game coloring)
- **Tornado indicators** — visual tracking of tornado positions

---

## Win / Loss Conditions

- **Win:** Boss reaches 0 HP
- **Loss:** Player reaches 0 HP
- On death: display a summary screen showing time elapsed, damage taken, DPS achieved
- After win or loss: return to the Start/Restart menu where loadout can be adjusted

---

## Start / Restart Menu

- Configure: armor tier, bow tier, staff tier, halberd tier
- Configure: number of Egniol potion doses, number of fish (paddlefish / corrupted paddlefish)
- Show: total inventory slots used (max 28 warning if exceeded)
- Show: computed max hits and DPS preview per weapon
- Button: Start Fight

---

## Open Questions / Needs Verification

The following values are not published on the OSRS wiki and require cache inspection or in-game testing:

1. **Floor tile phase timing in ticks** — not documented on the OSRS wiki; exact warning→active tick counts require frame analysis from community sources (RuneLite overlay footage, speedrun guides, r/ironscape)
2. **NPC ID → HP phase mapping** — using sequential order (9035 = Phase 1, 9036 = Phase 2, 9037 = Phase 3, 9038 = death transition) until confirmed
