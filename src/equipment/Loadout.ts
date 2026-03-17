import type { Tier, WeaponType } from '../entities/types.ts';
import { ARMOR_SETS, WEAPONS } from './items.ts';
import type { ArmorSet, Weapon } from './items.ts';
import type { FKeyConfig } from '../input/KeyBindManager.ts';

export interface LoadoutConfig {
  armorTier: Tier;
  weaponType: WeaponType;
  weaponTier: 1 | 2 | 3;
  secondaryWeaponType?: WeaponType;
  secondaryWeaponTier?: 1 | 2 | 3;
  paddlefishCount?: number;
  corruptedPaddlefishCount?: number;
  egniolDoses?: number;
  fkeyConfig?: FKeyConfig;
}

export class Loadout {
  armor: ArmorSet;
  weapon: Weapon;
  config: LoadoutConfig;

  constructor(config: LoadoutConfig) {
    this.config = config;
    this.armor = ARMOR_SETS[config.armorTier];
    this.weapon = WEAPONS[config.weaponType][config.weaponTier];
  }

  switchWeapon(weaponType: WeaponType, weaponTier: 1 | 2 | 3): void {
    this.weapon = WEAPONS[weaponType][weaponTier];
  }

  get totalPrayerBonus(): number {
    return this.armor.prayerBonus + this.weapon.prayerBonus;
  }
}
