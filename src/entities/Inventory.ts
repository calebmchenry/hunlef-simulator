import type { LoadoutConfig } from '../equipment/Loadout.ts';
import { WEAPONS } from '../equipment/items.ts';
import type { WeaponType } from './types.ts';
import { ITEM_SPRITES } from '../render/assets.ts';

export interface InventoryItem {
  id: string;
  name: string;
  category: 'food' | 'combo_food' | 'potion' | 'weapon';
  quantity: number; // doses for potions, 1 for everything else
  color: string;    // fallback display color
  spriteUrl: string; // OSRS wiki sprite path
}

export type InventoryAction =
  | { type: 'eat'; healAmount: number; slotIndex: number; comboFood: false }
  | { type: 'eat'; healAmount: number; slotIndex: number; comboFood: true }
  | { type: 'drink'; slotIndex: number }
  | { type: 'equip'; weaponType: WeaponType; weaponTier: 1 | 2 | 3; slotIndex: number };

function weaponSprite(type: WeaponType, tier: 1 | 2 | 3): string {
  const key = `${type}_${tier}` as keyof typeof ITEM_SPRITES;
  return ITEM_SPRITES[key] ?? '';
}

function egniolSprite(doses: number): string {
  const key = `egniol_${doses}` as keyof typeof ITEM_SPRITES;
  return ITEM_SPRITES[key] ?? '';
}

export function armorSprite(slot: 'helm' | 'body' | 'legs', tier: number): string {
  if (tier === 0) return '';
  const key = `${slot}_${tier}` as keyof typeof ITEM_SPRITES;
  return ITEM_SPRITES[key] ?? '';
}

export class Inventory {
  slots: (InventoryItem | null)[];

  constructor() {
    this.slots = new Array(28).fill(null);
  }

  buildFromLoadout(config: LoadoutConfig): void {
    this.slots = new Array(28).fill(null);
    let idx = 0;

    // Secondary weapon goes in inventory; primary is already equipped via Loadout.weapon
    if (config.secondaryWeaponType && config.secondaryWeaponTier) {
      const secondaryWeapon = WEAPONS[config.secondaryWeaponType][config.secondaryWeaponTier];
      this.slots[idx++] = {
        id: `${config.secondaryWeaponType}_${config.secondaryWeaponTier}`,
        name: secondaryWeapon.name,
        category: 'weapon',
        quantity: 1,
        color: '#8888cc',
        spriteUrl: weaponSprite(config.secondaryWeaponType, config.secondaryWeaponTier),
      };
    }

    // Egniol vials (each vial has 4 doses, total doses / 4 = number of vials, round up)
    const egniolDoses = config.egniolDoses ?? 0;
    const egniolVials = Math.ceil(egniolDoses / 4);
    let remainingDoses = egniolDoses;
    for (let i = 0; i < egniolVials && idx < 28; i++) {
      const doses = Math.min(4, remainingDoses);
      this.slots[idx++] = {
        id: `egniol_${doses}`,
        name: `Egniol (${doses})`,
        category: 'potion',
        quantity: doses,
        color: '#44aaaa',
        spriteUrl: egniolSprite(doses),
      };
      remainingDoses -= doses;
    }

    // Paddlefish
    const paddlefishCount = config.paddlefishCount ?? 0;
    for (let i = 0; i < paddlefishCount && idx < 28; i++) {
      this.slots[idx++] = {
        id: 'paddlefish',
        name: 'Paddlefish',
        category: 'food',
        quantity: 1,
        color: '#cc8844',
        spriteUrl: ITEM_SPRITES.paddlefish,
      };
    }

    // Corrupted paddlefish
    const corruptedCount = config.corruptedPaddlefishCount ?? 0;
    for (let i = 0; i < corruptedCount && idx < 28; i++) {
      this.slots[idx++] = {
        id: 'corrupted_paddlefish',
        name: 'C. Paddlefish',
        category: 'combo_food',
        quantity: 1,
        color: '#884488',
        spriteUrl: ITEM_SPRITES.corrupted_paddlefish,
      };
    }
  }

  useItem(index: number): InventoryAction | null {
    const item = this.slots[index];
    if (!item) return null;

    switch (item.category) {
      case 'food':
        return { type: 'eat', healAmount: 20, slotIndex: index, comboFood: false };
      case 'combo_food':
        return { type: 'eat', healAmount: 16, slotIndex: index, comboFood: true };
      case 'potion':
        return { type: 'drink', slotIndex: index };
      case 'weapon': {
        // Parse weapon type and tier from id
        const parts = item.id.split('_');
        const weaponType = parts[0] as WeaponType;
        const weaponTier = Number(parts[1]) as 1 | 2 | 3;
        return { type: 'equip', weaponType, weaponTier, slotIndex: index };
      }
    }
  }

  removeItem(index: number): void {
    this.slots[index] = null;
  }

  decrementDose(index: number): void {
    const item = this.slots[index];
    if (!item || item.category !== 'potion') return;

    item.quantity--;
    if (item.quantity <= 0) {
      this.slots[index] = null;
    } else {
      item.id = `egniol_${item.quantity}`;
      item.name = `Egniol (${item.quantity})`;
      item.spriteUrl = egniolSprite(item.quantity);
    }
  }

  get itemCount(): number {
    return this.slots.filter(s => s !== null).length;
  }
}
