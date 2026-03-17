import type { Position, Tornado } from './types.ts';

/** Create a new tornado entity */
export function createTornado(pos: Position, spawnTick: number): Tornado {
  return {
    pos: { ...pos },
    prevPos: { ...pos },
    spawnTick,
    lifetime: 20,
  };
}

/** Check if a tornado has expired */
export function isTornadoExpired(tornado: Tornado, currentTick: number): boolean {
  return currentTick - tornado.spawnTick >= tornado.lifetime;
}
