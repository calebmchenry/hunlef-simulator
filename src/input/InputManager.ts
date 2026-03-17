import type { GameSimulation } from '../engine/GameSimulation.ts';
import { KeyBindManager } from './KeyBindManager.ts';
import type { FKeyConfig } from './KeyBindManager.ts';
import type { SidePanel } from '../render/SidePanel.ts';
import type { TabId } from '../render/TabBar.ts';
import type { Renderer3D } from '../render/Renderer3D.ts';

export class InputManager {
  private sim: GameSimulation;
  private canvas: HTMLCanvasElement;
  private renderer3D: Renderer3D;
  private keyBindManager: KeyBindManager;
  private sidePanel: SidePanel | null;
  private boundClickHandler: (e: MouseEvent) => void;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  constructor(
    sim: GameSimulation,
    canvas: HTMLCanvasElement,
    renderer3D: Renderer3D,
    fkeyConfig?: FKeyConfig,
    sidePanel?: SidePanel,
  ) {
    this.sim = sim;
    this.canvas = canvas;
    this.renderer3D = renderer3D;
    this.keyBindManager = new KeyBindManager(fkeyConfig);
    this.sidePanel = sidePanel ?? null;

    this.boundClickHandler = this.handleClick.bind(this);
    this.boundKeyHandler = this.handleKey.bind(this);

    this.canvas.addEventListener('click', this.boundClickHandler);
    document.addEventListener('keydown', this.boundKeyHandler);
  }

  private handleClick(e: MouseEvent): void {
    const tile = this.renderer3D.screenToTile(e.clientX, e.clientY);
    if (!tile) return;

    // Check if click is on boss footprint
    if (this.sim.boss.occupies(tile.x, tile.y)) {
      this.sim.queueAttackTarget('boss');
    } else {
      this.sim.queueMove(tile);
    }
  }

  private handleKey(e: KeyboardEvent): void {
    const tab = this.keyBindManager.getTabForKey(e.key);
    if (tab) {
      e.preventDefault();
      if (this.sidePanel) {
        this.sidePanel.switchTab(tab as TabId);
      }
      // Escape also deactivates prayers (dual function)
      if (e.key === 'Escape') {
        this.sim.queuePrayer(null);
      }
      return;
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('click', this.boundClickHandler);
    document.removeEventListener('keydown', this.boundKeyHandler);
  }
}
