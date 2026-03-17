import type { Tier, WeaponType } from '../entities/types.ts';

export interface ArmorSet {
  tier: Tier;
  name: string;
  defBonus: number;   // total def bonus (all styles equal)
  prayerBonus: number;
}

export interface Weapon {
  type: WeaponType;
  tier: Tier;
  name: string;
  attackBonus: number;   // rangedAtk, magicAtk, or slashAtk
  strengthBonus: number; // rangedStr, or meleeStr (0 for staff)
  prayerBonus: number;
  attackSpeed: number;   // in ticks
  range: number;         // in tiles (Chebyshev)
  fixedMaxHit?: number;  // for powered staves
}

export const ARMOR_SETS: Record<Tier, ArmorSet> = {
  0: { tier: 0, name: 'None', defBonus: 0, prayerBonus: 0 },
  1: { tier: 1, name: 'Basic (T1)', defBonus: 28 + 86 + 52, prayerBonus: 6 },
  2: { tier: 2, name: 'Attuned (T2)', defBonus: 48 + 102 + 74, prayerBonus: 9 },
  3: { tier: 3, name: 'Perfected (T3)', defBonus: 68 + 124 + 92, prayerBonus: 12 },
};

export const WEAPONS: Record<WeaponType, Record<1 | 2 | 3, Weapon>> = {
  bow: {
    1: { type: 'bow', tier: 1, name: 'Basic Bow (T1)', attackBonus: 72, strengthBonus: 42, prayerBonus: 1, attackSpeed: 4, range: 10 },
    2: { type: 'bow', tier: 2, name: 'Attuned Bow (T2)', attackBonus: 118, strengthBonus: 88, prayerBonus: 2, attackSpeed: 4, range: 10 },
    3: { type: 'bow', tier: 3, name: 'Perfected Bow (T3)', attackBonus: 172, strengthBonus: 138, prayerBonus: 3, attackSpeed: 4, range: 10 },
  },
  staff: {
    1: { type: 'staff', tier: 1, name: 'Basic Staff (T1)', attackBonus: 84, strengthBonus: 0, prayerBonus: 1, attackSpeed: 4, range: 10, fixedMaxHit: 23 },
    2: { type: 'staff', tier: 2, name: 'Attuned Staff (T2)', attackBonus: 128, strengthBonus: 0, prayerBonus: 2, attackSpeed: 4, range: 10, fixedMaxHit: 31 },
    3: { type: 'staff', tier: 3, name: 'Perfected Staff (T3)', attackBonus: 184, strengthBonus: 0, prayerBonus: 3, attackSpeed: 4, range: 10, fixedMaxHit: 39 },
  },
  halberd: {
    1: { type: 'halberd', tier: 1, name: 'Basic Halberd (T1)', attackBonus: 68, strengthBonus: 42, prayerBonus: 1, attackSpeed: 4, range: 2 },
    2: { type: 'halberd', tier: 2, name: 'Attuned Halberd (T2)', attackBonus: 114, strengthBonus: 88, prayerBonus: 2, attackSpeed: 4, range: 2 },
    3: { type: 'halberd', tier: 3, name: 'Perfected Halberd (T3)', attackBonus: 166, strengthBonus: 138, prayerBonus: 3, attackSpeed: 4, range: 2 },
  },
};

/** Max hit through correct prayer by armor tier (Corrupted Hunlef) */
export const PROTECTED_MAX_HIT: Record<Tier, number> = {
  0: 16,
  1: 14,
  2: 10,
  3: 8,
};

/** Unprotected / wrong prayer max hit */
export const UNPROTECTED_MAX_HIT = 68;

/** Stomp max hit (typeless) */
export const STOMP_MAX_HIT = 68;

/** Tornado damage by armor tier (typeless) */
export const TORNADO_DAMAGE: Record<Tier, { min: number; max: number }> = {
  0: { min: 15, max: 30 },
  1: { min: 15, max: 25 },
  2: { min: 10, max: 20 },
  3: { min: 7, max: 15 },
};
