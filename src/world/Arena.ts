import type { Position } from '../entities/types.ts';
import type { Boss } from '../entities/Boss.ts';

export class Arena {
  readonly width = 12;
  readonly height = 12;

  isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  isWalkable(x: number, y: number, boss: Boss): boolean {
    if (!this.isInBounds(x, y)) return false;
    if (boss.occupies(x, y)) return false;
    return true;
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
