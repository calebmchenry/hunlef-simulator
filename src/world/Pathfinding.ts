import type { Position } from '../entities/types.ts';
import type { Boss } from '../entities/Boss.ts';
import type { Arena } from './Arena.ts';

interface Node {
  x: number;
  y: number;
  parent: Node | null;
}

const DIRS = [
  { dx: 0, dy: -1 },  // N
  { dx: 0, dy: 1 },   // S
  { dx: -1, dy: 0 },  // W
  { dx: 1, dy: 0 },   // E
  { dx: -1, dy: -1 }, // NW
  { dx: 1, dy: -1 },  // NE
  { dx: -1, dy: 1 },  // SW
  { dx: 1, dy: 1 },   // SE
];

/**
 * 8-directional BFS pathfinding on the arena grid.
 * Returns the next position to move to (1 tile toward target), or current pos if no path.
 */
export function findNextStep(
  from: Position,
  to: Position,
  arena: Arena,
  boss: Boss,
): Position {
  if (from.x === to.x && from.y === to.y) return from;

  // If target is inside boss, find nearest walkable tile to target
  let target = to;
  if (boss.occupies(to.x, to.y)) {
    target = findNearestWalkable(to, arena, boss);
  }

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

function findNearestWalkable(target: Position, arena: Arena, boss: Boss): Position {
  let best = target;
  let bestDist = Infinity;

  for (let x = 0; x < arena.width; x++) {
    for (let y = 0; y < arena.height; y++) {
      if (!arena.isWalkable(x, y, boss)) continue;
      const dist = Math.max(Math.abs(x - target.x), Math.abs(y - target.y));
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }

  return best;
}
