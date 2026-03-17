import { TabBar } from './TabBar.ts';
import type { TabId } from './TabBar.ts';
import { InventoryPanel } from './InventoryPanel.ts';
import { PrayerPanel } from './PrayerPanel.ts';
import { EquipmentPanel } from './EquipmentPanel.ts';
import type { GameSimulation } from '../engine/GameSimulation.ts';

export class SidePanel {
  private container: HTMLElement;
  private tabBar: TabBar;
  private contentArea: HTMLElement;
  private inventoryPanel: InventoryPanel;
  private prayerPanel: PrayerPanel;
  private equipmentPanel: EquipmentPanel;
  private inventoryContainer: HTMLElement;
  private prayerContainer: HTMLElement;
  private equipmentContainer: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('osrs-side-panel');

    // Tab bar
    const tabBarEl = document.createElement('div');
    this.container.appendChild(tabBarEl);
    this.tabBar = new TabBar(tabBarEl, (tab) => this.switchTab(tab));

    // Content area
    this.contentArea = document.createElement('div');
    this.contentArea.classList.add('osrs-content-area', 'osrs-stone');
    this.container.appendChild(this.contentArea);

    // Inventory panel
    this.inventoryContainer = document.createElement('div');
    this.contentArea.appendChild(this.inventoryContainer);
    this.inventoryPanel = new InventoryPanel(this.inventoryContainer);

    // Prayer panel
    this.prayerContainer = document.createElement('div');
    this.prayerContainer.style.display = 'none';
    this.contentArea.appendChild(this.prayerContainer);
    this.prayerPanel = new PrayerPanel(this.prayerContainer);

    // Equipment panel
    this.equipmentContainer = document.createElement('div');
    this.equipmentContainer.style.display = 'none';
    this.contentArea.appendChild(this.equipmentContainer);
    this.equipmentPanel = new EquipmentPanel(this.equipmentContainer);
  }

  switchTab(tab: TabId): void {
    this.tabBar.setActive(tab);

    this.inventoryContainer.style.display = tab === 'inventory' ? '' : 'none';
    this.prayerContainer.style.display = tab === 'prayer' ? '' : 'none';
    this.equipmentContainer.style.display = tab === 'equipment' ? '' : 'none';
  }

  update(sim: GameSimulation): void {
    const activeTab = this.tabBar.getActiveTab();
    switch (activeTab) {
      case 'inventory':
        this.inventoryPanel.update(sim);
        break;
      case 'prayer':
        this.prayerPanel.update(sim);
        break;
      case 'equipment':
        this.equipmentPanel.update(sim);
        break;
    }
  }

  getActiveTab(): TabId {
    return this.tabBar.getActiveTab();
  }
}
