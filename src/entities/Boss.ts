import type { Position, AttackStyle, ProtectionStyle } from './types.ts';

export type BossAttackResult = AttackStyle | 'tornado';

const PROTECTION_STYLES: ProtectionStyle[] = ['melee', 'magic', 'ranged'];

export class Boss {
  /** SW corner of the 5x5 footprint */
  pos: Position;
  hp: number = 1000;
  maxHp: number = 1000;
  readonly size: number = 5;

  currentStyle: AttackStyle = 'ranged';
  attackCounter: number = 0; // 0-3, switch after 4
  attackCooldown: number = 5; // fires when reaches 0, then resets to 5
  readonly attackSpeed: number = 5;
  cycleCount: number = 0; // increments when attackCounter resets

  /** What combat style the boss is currently protecting against */
  protectionStyle: ProtectionStyle = 'ranged';
  /** Number of player hits that did NOT match protection style since last switch */
  offPrayerHitCount: number = 0;

  // All stats are 240
  readonly stats = {
    attack: 240,
    strength: 240,
    defence: 240,
    magic: 240,
    ranged: 240,
  };

  readonly defBonus: number = 20;

  totalDamageDealt: number = 0;

  constructor(pos: Position, startingProtection?: ProtectionStyle) {
    this.pos = { ...pos };
    if (startingProtection !== undefined) {
      this.protectionStyle = startingProtection;
    }
  }

  /** Pick a random starting protection style from seeded RNG */
  initProtection(rngNext: () => number): void {
    const idx = Math.floor(rngNext() * PROTECTION_STYLES.length);
    this.protectionStyle = PROTECTION_STYLES[idx];
    this.offPrayerHitCount = 0;
  }

  /**
   * Process a player hit against the boss.
   * Returns true if the hit was blocked by protection (0 damage).
   */
  processPlayerHit(playerStyle: ProtectionStyle): boolean {
    if (playerStyle === this.protectionStyle) {
      // Blocked — no off-prayer count increment
      return true;
    }
    // Off-prayer hit
    this.offPrayerHitCount++;
    if (this.offPrayerHitCount >= 6) {
      this.protectionStyle = playerStyle;
      this.offPrayerHitCount = 0;
    }
    return false;
  }

  /** Check if a tile (x, y) is inside the boss's 5x5 footprint */
  occupies(x: number, y: number): boolean {
    return (
      x >= this.pos.x &&
      x < this.pos.x + this.size &&
      y >= this.pos.y &&
      y < this.pos.y + this.size
    );
  }

  /** Get the center position of the boss */
  get center(): Position {
    return {
      x: this.pos.x + 2,
      y: this.pos.y + 2,
    };
  }

  /** Fire an attack and advance rotation. Returns the style used or 'tornado'. */
  fireAttack(): BossAttackResult {
    // Check if this should be a tornado summon:
    // Every other cycle (odd cycles), first attack is tornado
    const isTornado = this.cycleCount % 2 === 1 && this.attackCounter === 0;

    const style = this.currentStyle;
    this.attackCounter++;
    if (this.attackCounter >= 4) {
      this.attackCounter = 0;
      this.cycleCount++;
      this.currentStyle = this.currentStyle === 'ranged' ? 'magic' : 'ranged';
    }
    this.attackCooldown = this.attackSpeed;

    if (isTornado) {
      return 'tornado';
    }
    return style;
  }

  /** Chebyshev distance from a point to the nearest tile of the boss */
  chebyshevDistTo(p: Position): number {
    // Clamp to the nearest point on the boss footprint
    const cx = Math.max(this.pos.x, Math.min(this.pos.x + this.size - 1, p.x));
    const cy = Math.max(this.pos.y, Math.min(this.pos.y + this.size - 1, p.y));
    return Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy));
  }

  reset(pos: Position): void {
    this.pos = { ...pos };
    this.hp = 1000;
    this.currentStyle = 'ranged';
    this.attackCounter = 0;
    this.attackCooldown = 5;
    this.totalDamageDealt = 0;
    this.protectionStyle = 'ranged';
    this.offPrayerHitCount = 0;
    this.cycleCount = 0;
  }
}
