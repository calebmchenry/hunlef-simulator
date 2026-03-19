import type { Position, CombatStats } from './types.ts';
import type { Loadout } from '../equipment/Loadout.ts';
import { Inventory } from './Inventory.ts';

export class Player {
  pos: Position;
  prevPos: Position;
  midPos: Position | null = null;
  hp: number = 99;
  maxHp: number = 99;
  prayerPoints: number = 77;
  maxPrayerPoints: number = 77;
  attackCooldown: number = 0;
  targetTile: Position | null = null;
  attackTarget: 'boss' | null = null;
  totalDamageDealt: number = 0;
  totalDamageTaken: number = 0;
  inventory: Inventory;

  readonly stats: CombatStats = {
    attack: 99,
    strength: 99,
    defence: 99,
    ranged: 99,
    magic: 99,
    hitpoints: 99,
    prayer: 77,
  };

  loadout: Loadout;

  constructor(loadout: Loadout, startPos: Position) {
    this.pos = { ...startPos };
    this.prevPos = { ...startPos };
    this.loadout = loadout;
    this.inventory = new Inventory();
    this.inventory.buildFromLoadout(loadout.config);
  }

  reset(startPos: Position): void {
    this.pos = { ...startPos };
    this.prevPos = { ...startPos };
    this.midPos = null;
    this.hp = 99;
    this.prayerPoints = 77;
    this.attackCooldown = 0;
    this.targetTile = null;
    this.attackTarget = null;
    this.totalDamageDealt = 0;
    this.totalDamageTaken = 0;
    this.inventory.buildFromLoadout(this.loadout.config);
  }
}
