import { describe, it, expect } from 'vitest';
import { PrayerManager } from '../PrayerManager.ts';

describe('PrayerManager', () => {
  it('starts with no active prayer', () => {
    const pm = new PrayerManager();
    expect(pm.activePrayer).toBeNull();
  });

  it('queued prayer takes effect after applyQueued', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    expect(pm.activePrayer).toBeNull(); // Not yet applied
    pm.applyQueued();
    expect(pm.activePrayer).toBe('magic');
  });

  it('can switch between prayers', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    expect(pm.activePrayer).toBe('magic');

    pm.queueSwitch('missiles');
    pm.applyQueued();
    expect(pm.activePrayer).toBe('missiles');
  });

  it('can deactivate prayer', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    pm.queueSwitch(null);
    pm.applyQueued();
    expect(pm.activePrayer).toBeNull();
  });

  it('drains with T3 armor (+12 prayer bonus)', () => {
    // resistance = 2 * 12 + 60 = 84
    // drainPerTick = 12 / 84 = 0.142857...
    // After 7 ticks: accumulated = 7 * 0.142857 = 1.0
    // So should drain 1 point after 7 ticks
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();

    let totalDrained = 0;
    for (let i = 0; i < 7; i++) {
      totalDrained += pm.drain(12, 77 - totalDrained);
    }
    expect(totalDrained).toBe(1);
  });

  it('drains with no armor (+0 prayer bonus)', () => {
    // resistance = 2 * 0 + 60 = 60
    // drainPerTick = 12 / 60 = 0.2
    // After 5 ticks: accumulated = 5 * 0.2 = 1.0
    // So should drain 1 point after 5 ticks
    const pm = new PrayerManager();
    pm.queueSwitch('missiles');
    pm.applyQueued();

    let totalDrained = 0;
    for (let i = 0; i < 5; i++) {
      totalDrained += pm.drain(0, 77 - totalDrained);
    }
    expect(totalDrained).toBe(1);
  });

  it('does not drain when no prayer is active', () => {
    const pm = new PrayerManager();
    const drained = pm.drain(12, 77);
    expect(drained).toBe(0);
  });

  it('deactivates when called', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    pm.deactivate();
    expect(pm.activePrayer).toBeNull();
  });

  it('deactivation resets accumulated drain', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();

    // Accumulate some partial drain
    pm.drain(12, 77);
    pm.drain(12, 77);

    pm.deactivate();

    // Re-enable prayer
    pm.queueSwitch('magic');
    pm.applyQueued();

    // Should start fresh drain accumulation
    let totalDrained = 0;
    for (let i = 0; i < 7; i++) {
      totalDrained += pm.drain(12, 77 - totalDrained);
    }
    expect(totalDrained).toBe(1);
  });
});

describe('Offensive Prayers', () => {
  it('starts with no offensive prayer', () => {
    const pm = new PrayerManager();
    expect(pm.offensivePrayer).toBeNull();
  });

  it('activates Rigour via queue', () => {
    const pm = new PrayerManager();
    pm.queueOffensiveSwitch('rigour');
    pm.applyQueuedOffensive();
    expect(pm.offensivePrayer).toBe('rigour');
  });

  it('exclusivity: activating Piety deactivates Rigour', () => {
    const pm = new PrayerManager();
    pm.queueOffensiveSwitch('rigour');
    pm.applyQueuedOffensive();
    expect(pm.offensivePrayer).toBe('rigour');

    pm.queueOffensiveSwitch('piety');
    pm.applyQueuedOffensive();
    expect(pm.offensivePrayer).toBe('piety');
  });

  it('toggle: clicking active prayer deactivates it', () => {
    const pm = new PrayerManager();
    pm.queueOffensiveSwitch('piety');
    pm.applyQueuedOffensive();
    expect(pm.offensivePrayer).toBe('piety');

    pm.queueOffensiveSwitch('piety');
    pm.applyQueuedOffensive();
    expect(pm.offensivePrayer).toBeNull();
  });

  it('protection + offensive coexist', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    pm.queueOffensiveSwitch('rigour');
    pm.applyQueuedOffensive();

    expect(pm.activePrayer).toBe('magic');
    expect(pm.offensivePrayer).toBe('rigour');
  });

  it('drain rate sums both prayers (protect 12 + rigour 24 = 36)', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    pm.queueOffensiveSwitch('rigour');
    pm.applyQueuedOffensive();

    // resistance = 2 * 12 + 60 = 84
    // total drain = 36 / 84 = 0.42857...
    // After 7 ticks: 7 * 0.42857 = 3.0
    let totalDrained = 0;
    for (let i = 0; i < 7; i++) {
      totalDrained += pm.drain(12, 77 - totalDrained);
    }
    expect(totalDrained).toBe(3);
  });

  it('drain with only offensive prayer (eagle_eye drainRate=12)', () => {
    const pm = new PrayerManager();
    pm.queueOffensiveSwitch('eagle_eye');
    pm.applyQueuedOffensive();

    // No protection prayer, just eagle eye (12)
    // resistance = 2 * 12 + 60 = 84
    // drain = 12 / 84 = 0.142857...
    // After 7 ticks: 1.0
    let totalDrained = 0;
    for (let i = 0; i < 7; i++) {
      totalDrained += pm.drain(12, 77 - totalDrained);
    }
    expect(totalDrained).toBe(1);
  });

  it('deactivate clears both protection and offensive', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('magic');
    pm.applyQueued();
    pm.queueOffensiveSwitch('augury');
    pm.applyQueuedOffensive();

    pm.deactivate();
    expect(pm.activePrayer).toBeNull();
    expect(pm.offensivePrayer).toBeNull();
  });

  it('reset clears both prayers', () => {
    const pm = new PrayerManager();
    pm.queueSwitch('missiles');
    pm.applyQueued();
    pm.queueOffensiveSwitch('piety');
    pm.applyQueuedOffensive();

    pm.reset();
    expect(pm.activePrayer).toBeNull();
    expect(pm.offensivePrayer).toBeNull();
  });

  it('getActiveOffensiveDef returns correct def', () => {
    const pm = new PrayerManager();
    expect(pm.getActiveOffensiveDef()).toBeNull();

    pm.queueOffensiveSwitch('augury');
    pm.applyQueuedOffensive();
    const def = pm.getActiveOffensiveDef();
    expect(def).not.toBeNull();
    expect(def!.id).toBe('augury');
    expect(def!.combatStyle).toBe('magic');
    expect(def!.accuracyMult).toBe(1.25);
    expect(def!.magicMaxHitBonus).toBe(1);
    expect(def!.drainRate).toBe(24);
  });
});
