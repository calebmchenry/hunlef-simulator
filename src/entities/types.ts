export interface Position {
  x: number;
  y: number;
}

export interface CombatStats {
  attack: number;
  strength: number;
  defence: number;
  ranged: number;
  magic: number;
  hitpoints: number;
  prayer: number;
}

export type AttackStyle = 'ranged' | 'magic';

export type ProtectionStyle = 'melee' | 'magic' | 'ranged';

export type WeaponType = 'staff' | 'bow' | 'halberd';

export type Tier = 0 | 1 | 2 | 3;

export interface HitSplat {
  damage: number;
  x: number;
  y: number;
  tickCreated: number;
}

export type ProjectileShape = 'spike' | 'orb' | 'arrow' | 'blast' | 'slash';

// Floor hazard types
export type TileState = 'safe' | 'warning' | 'hazard';

export interface TileInfo {
  state: TileState;
  tickChanged: number;
  permanent: boolean; // Phase 3 safe tiles — never activate
}

// Tornado types
export interface Tornado {
  pos: Position;
  prevPos: Position;
  spawnTick: number;
  lifetime: number; // 20 ticks
}
