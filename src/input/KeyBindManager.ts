export interface FKeyConfig {
  inventory: string;
  prayer: string;
  equipment: string;
}

export const DEFAULT_FKEY_CONFIG: FKeyConfig = {
  inventory: 'Escape',
  prayer: 'F5',
  equipment: 'F4',
};

export class KeyBindManager {
  private config: FKeyConfig;

  constructor(config?: FKeyConfig) {
    this.config = config ? { ...config } : { ...DEFAULT_FKEY_CONFIG };
  }

  getTabForKey(key: string): string | null {
    if (key === this.config.inventory) return 'inventory';
    if (key === this.config.prayer) return 'prayer';
    if (key === this.config.equipment) return 'equipment';
    return null;
  }

  getKeyForTab(tabId: string): string {
    switch (tabId) {
      case 'inventory': return this.config.inventory;
      case 'prayer': return this.config.prayer;
      case 'equipment': return this.config.equipment;
      default: return '';
    }
  }

  getConfig(): FKeyConfig {
    return { ...this.config };
  }
}
