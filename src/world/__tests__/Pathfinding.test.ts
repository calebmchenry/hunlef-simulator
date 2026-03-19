import { describe, it, expect } from 'vitest';
import { findNextStep, naiveStep } from '../Pathfinding.ts';
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

  it('can walk through boss footprint', () => {
    // Player at (3, 4), target at (5, 4) which is inside boss — should walk through
    const result = findNextStep({ x: 3, y: 4 }, { x: 5, y: 4 }, arena, boss);
    expect(result).toEqual({ x: 4, y: 4 });
  });

  it('paths through boss when it is the shortest route', () => {
    // Player on left side of boss, target on right side — should go straight through
    const from = { x: 3, y: 4 };
    const to = { x: 9, y: 4 };

    let current = from;
    for (let i = 0; i < 20; i++) {
      const next = findNextStep(current, to, arena, boss);
      if (next.x === current.x && next.y === current.y) break;
      current = next;
      if (current.x === to.x && current.y === to.y) break;
    }

    expect(current).toEqual(to);
  });

  it('reaches target inside boss footprint', () => {
    // Walk from far corner to a tile inside boss — should eventually arrive
    let current = { x: 11, y: 11 };
    const target = { x: 5, y: 3 };
    for (let i = 0; i < 20; i++) {
      const next = findNextStep(current, target, arena, boss);
      if (next.x === current.x && next.y === current.y) break;
      current = next;
      if (current.x === target.x && current.y === target.y) break;
    }
    expect(current).toEqual(target);
  });

  it('does not move out of bounds', () => {
    const result = findNextStep({ x: 0, y: 0 }, { x: -1, y: -1 }, arena, boss);
    expect(arena.isInBounds(result.x, result.y)).toBe(true);
  });
});

describe('naiveStep (cardinal-first)', () => {
  const arena = new Arena();
  const boss = new Boss({ x: 4, y: 2 });

  it('returns current position when already at target', () => {
    expect(naiveStep({ x: 5, y: 5 }, { x: 5, y: 5 }, arena, boss)).toEqual({ x: 5, y: 5 });
  });

  it('prefers cardinal (horizontal) when both axes differ', () => {
    const result = naiveStep({ x: 0, y: 2 }, { x: 2, y: 0 }, arena, boss);
    expect(result).toEqual({ x: 1, y: 2 });
  });

  it('moves cardinally when only X differs', () => {
    const result = naiveStep({ x: 0, y: 5 }, { x: 3, y: 5 }, arena, boss);
    expect(result).toEqual({ x: 1, y: 5 });
  });

  it('moves cardinally when only Y differs', () => {
    const result = naiveStep({ x: 5, y: 0 }, { x: 5, y: 3 }, arena, boss);
    expect(result).toEqual({ x: 5, y: 1 });
  });

  it('can step through boss footprint', () => {
    // Player adjacent to boss, target inside boss — should walk in
    const result = naiveStep({ x: 3, y: 3 }, { x: 5, y: 3 }, arena, boss);
    expect(result).toEqual({ x: 4, y: 3 });
  });

  it('steps through boss when cardinal path goes through it', () => {
    // Player at (3,2), target at (10,10). Horizontal step is (4,2) — inside boss but walkable now.
    const result = naiveStep({ x: 3, y: 2 }, { x: 10, y: 10 }, arena, boss);
    expect(result).toEqual({ x: 4, y: 2 });
  });
});
