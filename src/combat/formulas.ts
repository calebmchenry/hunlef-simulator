/**
 * OSRS combat formulas — pure functions.
 * All formulas match the OSRS wiki DPS calculator.
 */

// ── Melee ──

export function meleeMaxHit(
  strLevel: number,
  strBonus: number,
  prayerMult: number,
  stanceBonus: number,
): number {
  const effectiveStr = Math.floor(Math.floor(strLevel * prayerMult) + stanceBonus + 8);
  return Math.floor((effectiveStr * (strBonus + 64) + 320) / 640);
}

export function meleeAttackRoll(
  atkLevel: number,
  atkBonus: number,
  prayerMult: number,
  stanceBonus: number,
): number {
  const effectiveAtk = Math.floor(Math.floor(atkLevel * prayerMult) + stanceBonus + 8);
  return effectiveAtk * (atkBonus + 64);
}

// ── Ranged ──

export function rangedMaxHit(
  rngLevel: number,
  rngStrBonus: number,
  prayerMult: number,
): number {
  const effectiveStr = Math.floor(Math.floor(rngLevel * prayerMult) + 8);
  return Math.floor(0.5 + (effectiveStr * (rngStrBonus + 64)) / 640);
}

export function rangedAttackRoll(
  rngLevel: number,
  rngAtkBonus: number,
  prayerMult: number,
  stanceBonus: number,
): number {
  const effectiveAtk = Math.floor(Math.floor(rngLevel * prayerMult) + stanceBonus + 8);
  return effectiveAtk * (rngAtkBonus + 64);
}

// ── Magic (Corrupted Staff — powered staff with fixed max hit) ──

export function magicMaxHit(tier: 1 | 2 | 3, augury: boolean): number {
  const base: Record<1 | 2 | 3, number> = { 1: 23, 2: 31, 3: 39 };
  return base[tier] + (augury ? 1 : 0);
}

export function magicAttackRoll(
  magLevel: number,
  magAtkBonus: number,
  prayerMult: number,
): number {
  // Powered staves use +9 instead of +8 for the effective level calculation
  const effectiveMag = Math.floor(Math.floor(magLevel * prayerMult) + 9);
  return effectiveMag * (magAtkBonus + 64);
}

// ── General ──

export function hitChance(attackRoll: number, defenceRoll: number): number {
  if (attackRoll > defenceRoll) {
    return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  } else {
    return attackRoll / (2 * (defenceRoll + 1));
  }
}

export function npcDefenceRoll(defLevel: number, defBonus: number): number {
  return (defLevel + 9) * (defBonus + 64);
}
