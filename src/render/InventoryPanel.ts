import type { GameSimulation } from '../engine/GameSimulation.ts';

export class InventoryPanel {
  private container: HTMLElement;
  private sim: GameSimulation | null = null;
  private slotElements: HTMLElement[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';
    const grid = document.createElement('div');
    grid.classList.add('osrs-inventory-grid');

    this.slotElements = [];
    for (let i = 0; i < 28; i++) {
      const slot = document.createElement('div');
      slot.classList.add('osrs-inventory-slot');
      slot.dataset.index = String(i);
      slot.addEventListener('click', () => {
        if (this.sim) {
          this.sim.useInventoryItem(i);
        }
      });
      this.slotElements.push(slot);
      grid.appendChild(slot);
    }

    this.container.appendChild(grid);
  }

  update(sim: GameSimulation): void {
    this.sim = sim;
    const inventory = sim.player.inventory;

    for (let i = 0; i < 28; i++) {
      const slot = this.slotElements[i];
      const item = inventory.slots[i];

      if (item) {
        slot.classList.add('has-item');
        slot.innerHTML = '';

        if (item.spriteUrl) {
          const img = document.createElement('img');
          img.src = item.spriteUrl;
          img.alt = item.name;
          img.draggable = false;
          img.classList.add('item-sprite');
          img.style.imageRendering = 'pixelated';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          slot.appendChild(img);
        } else {
          const icon = document.createElement('div');
          icon.classList.add('item-icon');
          icon.style.backgroundColor = item.color;
          slot.appendChild(icon);

          const name = document.createElement('div');
          name.classList.add('item-name');
          name.textContent = item.name;
          slot.appendChild(name);
        }

        if (item.category === 'potion' && item.quantity > 0) {
          const dose = document.createElement('div');
          dose.classList.add('dose-overlay');
          dose.textContent = String(item.quantity);
          slot.appendChild(dose);
        }
      } else {
        slot.classList.remove('has-item');
        slot.innerHTML = '';
      }
    }
  }
}
