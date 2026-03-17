import { TAB_ICONS } from './assets.ts';

export type TabId = 'inventory' | 'prayer' | 'equipment';

interface TabDef {
  id: string;
  label: string;
  enabled: boolean;
}

// Top row: Combat, Stats, Quests, Equipment, Prayer, Spellbook, Clan
// Bottom row: Friends, Ignore, Logout, Settings, Emotes, Music, Inventory
const TABS_TOP: TabDef[] = [
  { id: 'combat', label: 'Combat', enabled: false },
  { id: 'stats', label: 'Stats', enabled: false },
  { id: 'quests', label: 'Quests', enabled: false },
  { id: 'equipment', label: 'Equip', enabled: true },
  { id: 'prayer', label: 'Prayer', enabled: true },
  { id: 'spellbook', label: 'Spells', enabled: false },
  { id: 'clan', label: 'Clan', enabled: false },
];

const TABS_BOTTOM: TabDef[] = [
  { id: 'friends', label: 'Friends', enabled: false },
  { id: 'ignore', label: 'Ignore', enabled: false },
  { id: 'logout', label: 'Logout', enabled: false },
  { id: 'settings', label: 'Settings', enabled: false },
  { id: 'emotes', label: 'Emotes', enabled: false },
  { id: 'music', label: 'Music', enabled: false },
  { id: 'inventory', label: 'Inv', enabled: true },
];

export class TabBar {
  private container: HTMLElement;
  private activeTab: TabId = 'inventory';
  private onTabChange: (tab: TabId) => void;
  private tabElements: Map<string, HTMLElement> = new Map();

  constructor(container: HTMLElement, onTabChange: (tab: TabId) => void) {
    this.container = container;
    this.onTabChange = onTabChange;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';
    this.container.classList.add('osrs-tab-bar');

    const topRow = document.createElement('div');
    topRow.classList.add('osrs-tab-row');
    for (const tab of TABS_TOP) {
      topRow.appendChild(this.createTab(tab));
    }

    const bottomRow = document.createElement('div');
    bottomRow.classList.add('osrs-tab-row');
    for (const tab of TABS_BOTTOM) {
      bottomRow.appendChild(this.createTab(tab));
    }

    this.container.appendChild(topRow);
    this.container.appendChild(bottomRow);

    this.updateActiveState();
  }

  private createTab(def: TabDef): HTMLElement {
    const el = document.createElement('div');
    el.classList.add('osrs-tab');
    if (def.enabled) el.classList.add('enabled');

    const iconSrc = TAB_ICONS[def.id as keyof typeof TAB_ICONS];
    if (iconSrc) {
      const img = document.createElement('img');
      img.src = iconSrc;
      img.alt = def.label;
      img.draggable = false;
      img.style.imageRendering = 'pixelated';
      img.style.maxWidth = '20px';
      img.style.maxHeight = '20px';
      el.appendChild(img);
    }

    el.title = def.label;

    if (def.enabled) {
      el.addEventListener('click', () => {
        this.setActive(def.id as TabId);
        this.onTabChange(def.id as TabId);
      });
    }

    this.tabElements.set(def.id, el);
    return el;
  }

  setActive(tab: TabId): void {
    this.activeTab = tab;
    this.updateActiveState();
  }

  private updateActiveState(): void {
    for (const [id, el] of this.tabElements) {
      if (id === this.activeTab) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  }

  getActiveTab(): TabId {
    return this.activeTab;
  }
}
