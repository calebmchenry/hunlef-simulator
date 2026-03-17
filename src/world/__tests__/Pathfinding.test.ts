import { describe, it, expect } from 'vitest';
import { findNextStep } from '../Pathfinding.ts';
import { Arena } from '../Arena.ts';
import { Boss } from '../../entities/Boss.ts';

describe('Pathfinding', () => {
  const arena = new Arena();
  const boss = new Boss({ x: 4, y: 2 });

  it('returns current position when already at target', () => {
    const result = findNextStep({ x: 0, y: 0 }, { x: 0, y: 0 }, arena, boss);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('moves one tile toward adjacent target', () => {
    const result = findNextStep({ x: 0, y: 0 }, { x: 0, y: 2 }, arena, boss);
    expect(result).toEqual({ x: 0, y: 1 });
  });

  it('moves diagonally when appropriate', () => {
    const result = findNextStep({ x: 0, y: 0 }, { x: 2, y: 2 }, arena, boss);
    expect(result).toEqual({ x: 1, y: 1 });
  });

  it('cannot walk into boss 5x5 footprint', () => {
    // Boss at (4,2) to (8,6)
    // Player at (3, 4), trying to go to (5, 4) which is inside boss
    const result = findNextStep({ x: 3, y: 4 }, { x: 5, y: 4 }, arena, boss);
    // Should not enter the boss tile
    expect(boss.occupies(result.x, result.y)).toBe(false);
  });

  it('paths around the boss', () => {
    // Player on left side of boss, target on right side
    const from = { x: 3, y: 4 };
    const to = { x: 9, y: 4 };

    // Walk to destination by repeatedly calling findNextStep
    let current = from;
    const path: Array<{ x: number; y: number }> = [current];
    for (let i = 0; i < 20; i++) {
      const next = findNextStep(current, to, arena, boss);
      if (next.x === current.x && next.y === current.y) break;
      current = next;
      path.push(current);
      // Verify never walks through boss
      expect(boss.occupies(current.x, current.y)).toBe(false);
      if (current.x === to.x && current.y === to.y) break;
    }

    expect(current).toEqual(to);
  });

  it('stays put if no path exists (surrounded)', () => {
    // This shouldn't happen in practice with a 12x12 arena and 5x5 boss,
    // but verify the function handles it gracefully
    const tinyBoss = new Boss({ x: 0, y: 0 });
    // Player at (11, 11) going to (0, 0) which is inside boss
    const result = findNextStep({ x: 11, y: 11 }, { x: 2, y: 2 }, arena, tinyBoss);
    // Should find a path around or stop at nearest walkable
    expect(tinyBoss.occupies(result.x, result.y)).toBe(false);
  });

  it('does not move out of bounds', () => {
    const result = findNextStep({ x: 0, y: 0 }, { x: -1, y: -1 }, arena, boss);
    expect(arena.isInBounds(result.x, result.y)).toBe(true);
  });
});
