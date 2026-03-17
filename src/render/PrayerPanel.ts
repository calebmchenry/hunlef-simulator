import type { GameSimulation } from '../engine/GameSimulation.ts';
import { PRAYER_ICONS } from './assets.ts';

interface PrayerDef {
  id: string;
  name: string;
  row: number;
  col: number;
  levelReq: number;
  interactive: boolean;
}

const OFFENSIVE_PRAYER_IDS = ['piety', 'rigour', 'augury', 'eagle_eye', 'mystic_might'];

// 29 prayers in OSRS order (5 cols x 6 rows)
const PRAYERS: PrayerDef[] = [
  // Row 0
  { id: 'thick_skin', name: 'Thick Skin', row: 0, col: 0, levelReq: 1, interactive: false },
  { id: 'burst_of_strength', name: 'Burst of Str', row: 0, col: 1, levelReq: 4, interactive: false },
  { id: 'clarity_of_thought', name: 'Clarity', row: 0, col: 2, levelReq: 7, interactive: false },
  { id: 'sharp_eye', name: 'Sharp Eye', row: 0, col: 3, levelReq: 8, interactive: false },
  { id: 'mystic_will', name: 'Mystic Will', row: 0, col: 4, levelReq: 9, interactive: false },
  // Row 1
  { id: 'rock_skin', name: 'Rock Skin', row: 1, col: 0, levelReq: 10, interactive: false },
  { id: 'superhuman_str', name: 'Superhuman', row: 1, col: 1, levelReq: 13, interactive: false },
  { id: 'improved_reflexes', name: 'Improved Ref', row: 1, col: 2, levelReq: 16, interactive: false },
  { id: 'rapid_restore', name: 'Rapid Restore', row: 1, col: 3, levelReq: 19, interactive: false },
  { id: 'rapid_heal', name: 'Rapid Heal', row: 1, col: 4, levelReq: 22, interactive: false },
  // Row 2
  { id: 'protect_item', name: 'Protect Item', row: 2, col: 0, levelReq: 25, interactive: false },
  { id: 'hawk_eye', name: 'Hawk Eye', row: 2, col: 1, levelReq: 26, interactive: false },
  { id: 'mystic_lore', name: 'Mystic Lore', row: 2, col: 2, levelReq: 27, interactive: false },
  { id: 'steel_skin', name: 'Steel Skin', row: 2, col: 3, levelReq: 28, interactive: false },
  { id: 'ultimate_str', name: 'Ultimate Str', row: 2, col: 4, levelReq: 31, interactive: false },
  // Row 3
  { id: 'incredible_reflexes', name: 'Incredible Ref', row: 3, col: 0, levelReq: 34, interactive: false },
  { id: 'protect_from_magic', name: 'Prot Magic', row: 3, col: 1, levelReq: 37, interactive: true },
  { id: 'protect_from_missiles', name: 'Prot Missiles', row: 3, col: 2, levelReq: 40, interactive: true },
  { id: 'protect_from_melee', name: 'Prot Melee', row: 3, col: 3, levelReq: 43, interactive: false },
  { id: 'eagle_eye', name: 'Eagle Eye', row: 3, col: 4, levelReq: 44, interactive: true },
  // Row 4
  { id: 'mystic_might', name: 'Mystic Might', row: 4, col: 0, levelReq: 45, interactive: true },
  { id: 'retribution', name: 'Retribution', row: 4, col: 1, levelReq: 46, interactive: false },
  { id: 'redemption', name: 'Redemption', row: 4, col: 2, levelReq: 49, interactive: false },
  { id: 'smite', name: 'Smite', row: 4, col: 3, levelReq: 52, interactive: false },
  { id: 'preserve', name: 'Preserve', row: 4, col: 4, levelReq: 55, interactive: false },
  // Row 5
  { id: 'chivalry', name: 'Chivalry', row: 5, col: 0, levelReq: 60, interactive: false },
  { id: 'piety', name: 'Piety', row: 5, col: 1, levelReq: 70, interactive: true },
  { id: 'rigour', name: 'Rigour', row: 5, col: 2, levelReq: 74, interactive: true },
  { id: 'augury', name: 'Augury', row: 5, col: 3, levelReq: 77, interactive: true },
];

export class PrayerPanel {
  private container: HTMLElement;
  private sim: GameSimulation | null = null;
  private cellElements: Map<string, HTMLElement> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';
    const grid = document.createElement('div');
    grid.classList.add('osrs-prayer-grid');

    // Create 6x5 grid (30 cells), some may be empty
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 5; col++) {
        const prayer = PRAYERS.find(p => p.row === row && p.col === col);
        const cell = document.createElement('div');
        cell.classList.add('osrs-prayer-cell');

        if (prayer) {
          if (prayer.interactive) {
            cell.classList.add('interactive');
          }

          const iconUrl = PRAYER_ICONS[prayer.id];
          if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            img.alt = prayer.name;
            img.draggable = false;
            img.style.imageRendering = 'pixelated';
            cell.appendChild(img);
          } else {
            const label = document.createElement('div');
            label.classList.add('prayer-label');
            label.textContent = prayer.name;
            cell.appendChild(label);
          }

          // Non-interactive prayers are dimmed
          if (!prayer.interactive) {
            cell.style.opacity = '0.35';
          }

          if (prayer.interactive) {
            cell.addEventListener('click', () => {
              if (!this.sim) return;
              if (prayer.id === 'protect_from_magic') {
                this.sim.queuePrayer(
                  this.sim.prayerManager.activePrayer === 'magic' ? null : 'magic',
                );
              } else if (prayer.id === 'protect_from_missiles') {
                this.sim.queuePrayer(
                  this.sim.prayerManager.activePrayer === 'missiles' ? null : 'missiles',
                );
              } else if (OFFENSIVE_PRAYER_IDS.includes(prayer.id)) {
                this.sim.queueOffensivePrayer(prayer.id as any);
              }
            });
          }

          this.cellElements.set(prayer.id, cell);
        }
        // Empty cells for positions with no prayer (e.g., row 5 col 4)
        grid.appendChild(cell);
      }
    }

    this.container.appendChild(grid);
  }

  update(sim: GameSimulation): void {
    this.sim = sim;
    const activePrayer = sim.prayerManager.activePrayer;
    const offensivePrayer = sim.prayerManager.offensivePrayer;

    // Update protect from magic
    const magicCell = this.cellElements.get('protect_from_magic');
    if (magicCell) {
      if (activePrayer === 'magic') {
        magicCell.classList.add('active');
        magicCell.style.opacity = '1';
      } else {
        magicCell.classList.remove('active');
        magicCell.style.opacity = '0.6';
      }
    }

    // Update protect from missiles
    const missilesCell = this.cellElements.get('protect_from_missiles');
    if (missilesCell) {
      if (activePrayer === 'missiles') {
        missilesCell.classList.add('active');
        missilesCell.style.opacity = '1';
      } else {
        missilesCell.classList.remove('active');
        missilesCell.style.opacity = '0.6';
      }
    }

    // Update offensive prayers
    for (const id of OFFENSIVE_PRAYER_IDS) {
      const cell = this.cellElements.get(id);
      if (cell) {
        if (offensivePrayer === id) {
          cell.classList.add('active');
          cell.style.opacity = '1';
        } else {
          cell.classList.remove('active');
          cell.style.opacity = '0.6';
        }
      }
    }
  }
}
