export type ProjectileShape = 'spike' | 'orb' | 'arrow' | 'blast' | 'slash';

export interface Projectile {
  /** Who fired it */
  source: 'boss' | 'player';
  /** Combat style */
  style: 'ranged' | 'magic' | 'melee';

  /** Pixel coordinates for rendering */
  startX: number;
  startY: number;
  endX: number;
  endY: number;

  /** Timing (game ticks) */
  fireTick: number;
  arrivalTick: number;

  /** Pre-rolled damage (calculated at fire time, applied on arrival) */
  damage: number;
  /** True if boss protection blocked it (0 damage) */
  blocked: boolean;

  /** Visual properties */
  color: string;
  shape: ProjectileShape;
  effect?: 'disable_prayers';
}

/**
 * OSRS ranged hit delay formula.
 * Used for bows, crossbows, crystal spikes.
 */
export function rangedHitDelay(distance: number): number {
  return 1 + Math.floor((3 + distance) / 6);
}

/**
 * OSRS magic hit delay formula.
 * Used for spells, magic orbs.
 */
export function magicHitDelay(distance: number): number {
  return 1 + Math.floor((1 + distance) / 3);
}

/**
 * Melee hit delay: always instant (0 ticks).
 */
export function meleeHitDelay(): number {
  return 0;
}
