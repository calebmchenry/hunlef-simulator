export type PrayerType = 'magic' | 'missiles' | null;
export type OffensivePrayer = 'piety' | 'rigour' | 'augury' | 'eagle_eye' | 'mystic_might' | null;

export interface OffensivePrayerDef {
  id: OffensivePrayer;
  name: string;
  combatStyle: 'melee' | 'ranged' | 'magic';
  accuracyMult: number;
  damageMult: number;
  magicMaxHitBonus: number;
  drainRate: number;
}

export const OFFENSIVE_PRAYERS: OffensivePrayerDef[] = [
  { id: 'eagle_eye',    name: 'Eagle Eye',    combatStyle: 'ranged', accuracyMult: 1.15, damageMult: 1.15, magicMaxHitBonus: 0, drainRate: 12 },
  { id: 'mystic_might', name: 'Mystic Might', combatStyle: 'magic',  accuracyMult: 1.15, damageMult: 1.0,  magicMaxHitBonus: 0, drainRate: 12 },
  { id: 'rigour',       name: 'Rigour',       combatStyle: 'ranged', accuracyMult: 1.20, damageMult: 1.23, magicMaxHitBonus: 0, drainRate: 24 },
  { id: 'augury',       name: 'Augury',       combatStyle: 'magic',  accuracyMult: 1.25, damageMult: 1.0,  magicMaxHitBonus: 1, drainRate: 24 },
  { id: 'piety',        name: 'Piety',        combatStyle: 'melee',  accuracyMult: 1.20, damageMult: 1.23, magicMaxHitBonus: 0, drainRate: 24 },
];

export class PrayerManager {
  activePrayer: PrayerType = null;
  offensivePrayer: OffensivePrayer = null;
  private queuedPrayer: PrayerType | undefined = undefined;
  private queuedOffensive: OffensivePrayer | undefined = undefined;
  private accumulatedDrain = 0;

  /** Queue a protection prayer switch; takes effect next tick */
  queueSwitch(prayer: PrayerType): void {
    this.queuedPrayer = prayer;
  }

  /** Queue an offensive prayer switch; takes effect next tick */
  queueOffensiveSwitch(prayer: OffensivePrayer): void {
    this.queuedOffensive = prayer;
  }

  /** Apply queued protection prayer switch (called at start of tick) */
  applyQueued(): void {
    if (this.queuedPrayer !== undefined) {
      this.activePrayer = this.queuedPrayer;
      this.queuedPrayer = undefined;
    }
  }

  /** Apply queued offensive prayer switch (called at start of tick) */
  applyQueuedOffensive(): void {
    if (this.queuedOffensive !== undefined) {
      // Toggle: if same prayer is already active, turn it off
      if (this.queuedOffensive === this.offensivePrayer) {
        this.offensivePrayer = null;
      } else {
        // Exclusivity: only one offensive prayer at a time
        this.offensivePrayer = this.queuedOffensive;
      }
      this.queuedOffensive = undefined;
    }
  }

  /** Get the def for the currently active offensive prayer, or null */
  getActiveOffensiveDef(): OffensivePrayerDef | null {
    if (this.offensivePrayer === null) return null;
    return OFFENSIVE_PRAYERS.find(p => p.id === this.offensivePrayer) ?? null;
  }

  /**
   * Drain prayer points for one tick (600ms).
   * Total drain rate = sum of all active prayer drain rates.
   * drain_resistance = 2 * prayerBonus + 60
   * Points drained per tick = total_drain_rate / drain_resistance
   *
   * Returns the number of integer points to subtract.
   */
  drain(prayerBonus: number, currentPoints: number): number {
    const totalDrainRate = this.getTotalDrainRate();
    if (totalDrainRate === 0 || currentPoints <= 0) {
      return 0;
    }

    const resistance = 2 * prayerBonus + 60;
    const drainPerTick = totalDrainRate / resistance;

    this.accumulatedDrain += drainPerTick;

    // Use a small epsilon to handle floating point imprecision
    let pointsToDrain = 0;
    const rounded = Math.round(this.accumulatedDrain * 1e8) / 1e8;
    if (rounded >= 1.0) {
      pointsToDrain = Math.floor(rounded);
      this.accumulatedDrain = rounded - pointsToDrain;
    }

    return pointsToDrain;
  }

  /** Get total drain rate from all active prayers */
  private getTotalDrainRate(): number {
    let rate = 0;
    if (this.activePrayer !== null) {
      rate += 12; // Protection prayers drain rate
    }
    const offDef = this.getActiveOffensiveDef();
    if (offDef) {
      rate += offDef.drainRate;
    }
    return rate;
  }

  /** Deactivate all prayers (e.g. when points reach 0) */
  deactivate(): void {
    this.activePrayer = null;
    this.offensivePrayer = null;
    this.accumulatedDrain = 0;
  }

  reset(): void {
    this.activePrayer = null;
    this.offensivePrayer = null;
    this.queuedPrayer = undefined;
    this.queuedOffensive = undefined;
    this.accumulatedDrain = 0;
  }
}
