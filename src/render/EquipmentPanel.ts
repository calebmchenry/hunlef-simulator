import type { GameSimulation } from '../engine/GameSimulation.ts';
import { ITEM_SPRITES } from './assets.ts';
import { armorSprite } from '../entities/Inventory.ts';

interface SlotDef {
  id: string;
  label: string;
  row: number;
  col: number;
}

const EQUIPMENT_SLOTS: SlotDef[] = [
  { id: 'head', label: 'Head', row: 0, col: 1 },
  { id: 'cape', label: 'Cape', row: 1, col: 0 },
  { id: 'neck', label: 'Neck', row: 1, col: 1 },
  { id: 'ammo', label: 'Ammo', row: 1, col: 2 },
  { id: 'weapon', label: 'Weapon', row: 2, col: 0 },
  { id: 'body', label: 'Body', row: 2, col: 1 },
  { id: 'shield', label: 'Shield', row: 2, col: 2 },
  { id: 'legs', label: 'Legs', row: 3, col: 1 },
  { id: 'hands', label: 'Hands', row: 4, col: 0 },
  { id: 'feet', label: 'Feet', row: 4, col: 1 },
  { id: 'ring', label: 'Ring', row: 4, col: 2 },
];

export class EquipmentPanel {
  private container: HTMLElement;
  private slotElements: Map<string, HTMLElement> = new Map();
  private statsEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';

    const grid = document.createElement('div');
    grid.classList.add('osrs-equipment-grid');

    // Create 5 rows x 3 cols grid
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const slotDef = EQUIPMENT_SLOTS.find(s => s.row === row && s.col === col);
        const cell = document.createElement('div');

        if (slotDef) {
          cell.classList.add('osrs-equipment-slot');
          cell.textContent = slotDef.label;
          cell.dataset.slotId = slotDef.id;
          this.slotElements.set(slotDef.id, cell);
        } else {
          // Empty spacer
          cell.style.width = '72px';
          cell.style.height = '36px';
        }

        grid.appendChild(cell);
      }
    }

    this.container.appendChild(grid);

    this.statsEl = document.createElement('div');
    this.statsEl.classList.add('osrs-equipment-stats');
    this.container.appendChild(this.statsEl);
  }

  private setSlotContent(el: HTMLElement, label: string, spriteUrl: string, name: string): void {
    el.innerHTML = '';
    if (spriteUrl) {
      el.classList.add('filled');
      const img = document.createElement('img');
      img.src = spriteUrl;
      img.alt = name;
      img.draggable = false;
      img.style.imageRendering = 'pixelated';
      img.style.maxWidth = '32px';
      img.style.maxHeight = '32px';
      img.style.objectFit = 'contain';
      el.appendChild(img);
    } else {
      el.classList.remove('filled');
      el.textContent = label;
    }
  }

  update(sim: GameSimulation): void {
    const loadout = sim.player.loadout;
    const armor = loadout.armor;
    const weapon = loadout.weapon;

    // Fill equipped slots
    for (const [id, el] of this.slotElements) {
      const slotDef = EQUIPMENT_SLOTS.find(s => s.id === id)!;
      switch (id) {
        case 'head':
          if (armor.tier > 0) {
            this.setSlotContent(el, slotDef.label, armorSprite('helm', armor.tier), armor.name + ' helm');
          } else {
            this.setSlotContent(el, slotDef.label, '', '');
          }
          break;
        case 'body':
          if (armor.tier > 0) {
            this.setSlotContent(el, slotDef.label, armorSprite('body', armor.tier), armor.name + ' body');
          } else {
            this.setSlotContent(el, slotDef.label, '', '');
          }
          break;
        case 'legs':
          if (armor.tier > 0) {
            this.setSlotContent(el, slotDef.label, armorSprite('legs', armor.tier), armor.name + ' legs');
          } else {
            this.setSlotContent(el, slotDef.label, '', '');
          }
          break;
        case 'weapon': {
          const wKey = `${weapon.type}_${weapon.tier}` as keyof typeof ITEM_SPRITES;
          const wSprite = ITEM_SPRITES[wKey] ?? '';
          this.setSlotContent(el, slotDef.label, wSprite, weapon.name);
          break;
        }
        default:
          this.setSlotContent(el, slotDef.label, '', '');
          break;
      }
    }

    // Stats summary
    this.statsEl.innerHTML = `
      <div class="stat-header">Attack Bonuses</div>
      <div>Weapon: +${weapon.attackBonus}</div>
      <div class="stat-header">Defence Bonuses</div>
      <div>Armour: +${armor.defBonus}</div>
      <div class="stat-header">Other</div>
      <div>Str: +${weapon.strengthBonus} | Prayer: +${loadout.totalPrayerBonus}</div>
    `;
  }
}
