import type { Position } from '../entities/types.ts';
import type { Boss } from '../entities/Boss.ts';
import type { Arena } from './Arena.ts';

interface Node {
  x: number;
  y: number;
  parent: Node | null;
}

// OSRS BFS exploration order (from wiki): W, E, S, N, SW, SE, NW, NE
// Cardinal directions first, then diagonals. This means equal-length paths
// prefer cardinal steps as a tiebreaker, while still finding shortest paths
// that use diagonals when they're genuinely shorter.
const DIRS = [
  { dx: -1, dy: 0 },  // W
  { dx: 1, dy: 0 },   // E
  { dx: 0, dy: 1 },   // S
  { dx: 0, dy: -1 },  // N
  { dx: -1, dy: 1 },  // SW
  { dx: 1, dy: 1 },   // SE
  { dx: -1, dy: -1 }, // NW
  { dx: 1, dy: -1 },  // NE
];

/**
 * OSRS pathfinding step: cardinal directions first, then diagonal.
 * Matches the BFS exploration order from the OSRS wiki:
 * W, E, S, N, SW, SE, NW, NE — cardinal tiles are checked before diagonal.
 * Returns the next position (1 tile toward target), or current pos if stuck.
 */
export function naiveStep(
  from: Position,
  to: Position,
  arena: Arena,
  boss: Boss,
): Position {
  if (from.x === to.x && from.y === to.y) return from;

  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  // Try cardinal (horizontal) first
  if (dx !== 0) {
    const horiz = { x: from.x + dx, y: from.y };
    if (arena.isWalkable(horiz.x, horiz.y, boss)) return horiz;
  }

  // Try cardinal (vertical)
  if (dy !== 0) {
    const vert = { x: from.x, y: from.y + dy };
    if (arena.isWalkable(vert.x, vert.y, boss)) return vert;
  }

  // Try diagonal last
  if (dx !== 0 && dy !== 0) {
    const diag = { x: from.x + dx, y: from.y + dy };
    if (canStep(from, diag, dx, dy, arena, boss)) return diag;
  }

  return from; // stuck
}

/** Check if a diagonal step is valid (target walkable + no corner cutting) */
function canStep(
  from: Position,
  to: Position,
  dx: number,
  dy: number,
  arena: Arena,
  boss: Boss,
): boolean {
  if (!arena.isWalkable(to.x, to.y, boss)) return false;
  // Prevent diagonal corner-cutting through blocked tiles
  if (dx !== 0 && dy !== 0) {
    if (!arena.isWalkable(from.x + dx, from.y, boss) ||
        !arena.isWalkable(from.x, from.y + dy, boss)) {
      return false;
    }
  }
  return true;
}

/**
 * 8-directional BFS pathfinding with OSRS direction order (W,E,S,N,SW,SE,NW,NE).
 * Cardinal directions are explored first, so equal-length paths prefer cardinal
 * steps — but diagonals are still used when they produce a genuinely shorter path.
 * Returns the next position to move to (1 tile toward target), or current pos if no path.
 */
export function findNextStep(
  from: Position,
  to: Position,
  arena: Arena,
  boss: Boss,
): Position {
  if (from.x === to.x && from.y === to.y) return from;

  const target = to;
  const visited = new Set<string>();
  const queue: Node[] = [];
  const startKey = `${from.x},${from.y}`;
  visited.add(startKey);
  queue.push({ x: from.x, y: from.y, parent: null });

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];

    if (current.x === target.x && current.y === target.y) {
      // Trace back to the first step
      let node: Node = current;
      while (node.parent && node.parent.parent !== null) {
        node = node.parent;
      }
      return { x: node.x, y: node.y };
    }

    for (const dir of DIRS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;

      if (visited.has(key)) continue;
      if (!arena.isWalkable(nx, ny, boss)) continue;

      // Prevent diagonal corner-cutting through blocked tiles
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (!arena.isWalkable(current.x + dir.dx, current.y, boss) ||
            !arena.isWalkable(current.x, current.y + dir.dy, boss)) {
          continue;
        }
      }

      visited.add(key);
      queue.push({ x: nx, y: ny, parent: current });
    }
  }

  // No path found, stay put
  return from;
}

