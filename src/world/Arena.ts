import type { Position } from '../entities/types.ts';
import type { Boss } from '../entities/Boss.ts';

export class Arena {
  readonly width = 12;
  readonly height = 12;

  isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  isWalkable(x: number, y: number, _boss: Boss): boolean {
    // Boss does NOT block movement — player can walk through the Hunlef.
    // Stomps trigger when the player is under the boss during an attack tick.
    return this.isInBounds(x, y);
  }

  /** Get player spawn position (south center) */
  get playerSpawn(): Position {
    return { x: 6, y: 10 };
  }

  /** Get boss spawn position (SW corner, roughly centered) */
  get bossSpawn(): Position {
    return { x: 4, y: 2 };
  }
}
