import type { Position, AttackStyle, ProtectionStyle } from './types.ts';

export type BossAttackResult = AttackStyle | 'tornado' | 'prayer_disable';

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
  prayerDisableSlot: number = -1;
  pendingStyleSwitch: { nextStyle: AttackStyle; triggerTick: number } | null = null;

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

  /** Pick the prayer-disable slot for the next magic phase. */
  initMagicPhase(rngNext: () => number): void {
    if (this.cycleCount % 2 === 1) {
      this.prayerDisableSlot = Math.floor(rngNext() * 3) + 1;
      return;
    }

    this.prayerDisableSlot = Math.floor(rngNext() * 4);
  }

  /** Fire an attack and advance rotation. Returns the style used or special attack type. */
  fireAttack(currentTick: number = 0): BossAttackResult {
    // Check if this should be a tornado summon:
    // Every other cycle (odd cycles), first attack is tornado
    const isTornado = this.cycleCount % 2 === 1 && this.attackCounter === 0;
    const isPrayerDisable = this.currentStyle === 'magic' && this.attackCounter === this.prayerDisableSlot;

    const style = this.currentStyle;
    this.attackCounter++;
    if (this.attackCounter >= 4) {
      this.attackCounter = 0;
      this.cycleCount++;
      const nextStyle = this.currentStyle === 'ranged' ? 'magic' : 'ranged';
      this.pendingStyleSwitch = { nextStyle, triggerTick: currentTick + 2 };
    }
    this.attackCooldown = this.attackSpeed;

    if (isTornado) {
      return 'tornado';
    }
    if (isPrayerDisable) {
      return 'prayer_disable';
    }
    return style;
  }

  maybeApplyStyleSwitch(currentTick: number): AttackStyle | null {
    if (this.pendingStyleSwitch === null || currentTick < this.pendingStyleSwitch.triggerTick) {
      return null;
    }

    this.currentStyle = this.pendingStyleSwitch.nextStyle;
    this.pendingStyleSwitch = null;
    if (this.currentStyle !== 'magic') {
      this.prayerDisableSlot = -1;
    }

    return this.currentStyle;
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
    this.attackCooldown = this.attackSpeed;
    this.totalDamageDealt = 0;
    this.protectionStyle = 'ranged';
    this.offPrayerHitCount = 0;
    this.cycleCount = 0;
    this.prayerDisableSlot = -1;
    this.pendingStyleSwitch = null;
  }
}
