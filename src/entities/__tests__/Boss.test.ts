import { describe, it, expect } from 'vitest';
import { Boss } from '../Boss.ts';

describe('Boss', () => {
  it('starts in ranged style', () => {
    const boss = new Boss({ x: 4, y: 2 });
    expect(boss.currentStyle).toBe('ranged');
  });

  it('delays the style switch for 2 ticks after 4 counted attacks', () => {
    const boss = new Boss({ x: 4, y: 2 });

    // 4 ranged attacks (cycle 0, even — no tornado)
    expect(boss.fireAttack(5)).toBe('ranged');
    expect(boss.fireAttack(10)).toBe('ranged');
    expect(boss.fireAttack(15)).toBe('ranged');
    expect(boss.fireAttack(20)).toBe('ranged');

    expect(boss.currentStyle).toBe('ranged');
    expect(boss.pendingStyleSwitch).toEqual({ nextStyle: 'magic', triggerTick: 22 });
    expect(boss.maybeApplyStyleSwitch(21)).toBeNull();
    expect(boss.currentStyle).toBe('ranged');
    expect(boss.maybeApplyStyleSwitch(22)).toBe('magic');
    expect(boss.currentStyle).toBe('magic');
  });

  it('fires prayer-disable exactly once per magic phase', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.currentStyle = 'magic';
    boss.cycleCount = 1;
    boss.initMagicPhase(() => 0.5); // slot 2

    const attacks = [
      boss.fireAttack(25),
      boss.fireAttack(30),
      boss.fireAttack(35),
      boss.fireAttack(40),
    ];

    expect(attacks).toEqual(['tornado', 'magic', 'prayer_disable', 'magic']);
    expect(attacks.filter(attack => attack === 'prayer_disable')).toHaveLength(1);
  });

  it('never collides prayer-disable with the tornado slot', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.currentStyle = 'magic';
    boss.cycleCount = 1;

    boss.initMagicPhase(() => 0.0);
    expect(boss.prayerDisableSlot).toBe(1);

    boss.initMagicPhase(() => 0.999999);
    expect(boss.prayerDisableSlot).toBe(3);
  });

  it('attack counter resets after 4', () => {
    const boss = new Boss({ x: 4, y: 2 });

    boss.fireAttack(5);
    expect(boss.attackCounter).toBe(1);

    boss.fireAttack(10);
    expect(boss.attackCounter).toBe(2);

    boss.fireAttack(15);
    expect(boss.attackCounter).toBe(3);

    boss.fireAttack(20);
    // After 4th attack, counter resets to 0
    expect(boss.attackCounter).toBe(0);
  });

  it('occupies correctly reports 5x5 footprint', () => {
    const boss = new Boss({ x: 4, y: 2 });

    // Inside
    expect(boss.occupies(4, 2)).toBe(true);
    expect(boss.occupies(8, 6)).toBe(true);
    expect(boss.occupies(6, 4)).toBe(true);

    // Outside
    expect(boss.occupies(3, 2)).toBe(false);
    expect(boss.occupies(9, 2)).toBe(false);
    expect(boss.occupies(4, 1)).toBe(false);
    expect(boss.occupies(4, 7)).toBe(false);
  });

  it('chebyshevDistTo returns 0 when inside boss', () => {
    const boss = new Boss({ x: 4, y: 2 });
    expect(boss.chebyshevDistTo({ x: 6, y: 4 })).toBe(0);
  });

  it('chebyshevDistTo returns correct distance outside boss', () => {
    const boss = new Boss({ x: 4, y: 2 });
    // Player at (3, 2): nearest boss tile is (4, 2), distance = 1
    expect(boss.chebyshevDistTo({ x: 3, y: 2 })).toBe(1);
    // Player at (10, 2): nearest boss tile is (8, 2), distance = 2
    expect(boss.chebyshevDistTo({ x: 10, y: 2 })).toBe(2);
  });

  it('resets cooldown to attackSpeed after firing', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.attackCooldown = 0;
    boss.fireAttack(5);
    expect(boss.attackCooldown).toBe(5);
  });
});

describe('Boss protection prayer', () => {
  it('defaults to ranged protection', () => {
    const boss = new Boss({ x: 4, y: 2 });
    expect(boss.protectionStyle).toBe('ranged');
    expect(boss.offPrayerHitCount).toBe(0);
  });

  it('blocks attacks matching protection style', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    const blocked = boss.processPlayerHit('magic');
    expect(blocked).toBe(true);
    expect(boss.offPrayerHitCount).toBe(0);
  });

  it('allows attacks NOT matching protection style', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    const blocked = boss.processPlayerHit('ranged');
    expect(blocked).toBe(false);
    expect(boss.offPrayerHitCount).toBe(1);
  });

  it('switches protection after 6 off-prayer hits', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    // 6 ranged hits
    for (let i = 0; i < 5; i++) {
      boss.processPlayerHit('ranged');
    }
    expect(boss.offPrayerHitCount).toBe(5);
    expect(boss.protectionStyle).toBe('magic'); // not switched yet

    boss.processPlayerHit('ranged');
    // After 6th hit, boss switches to ranged protection
    expect(boss.protectionStyle).toBe('ranged');
    expect(boss.offPrayerHitCount).toBe(0);
  });

  it('counter resets after switch', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    // 6 ranged hits → switches to ranged
    for (let i = 0; i < 6; i++) {
      boss.processPlayerHit('ranged');
    }
    expect(boss.protectionStyle).toBe('ranged');
    expect(boss.offPrayerHitCount).toBe(0);

    // Now melee is off-prayer
    boss.processPlayerHit('melee');
    expect(boss.offPrayerHitCount).toBe(1);
  });

  it('does not increment counter for on-prayer hits after switch', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    // 6 ranged hits → switches to ranged
    for (let i = 0; i < 6; i++) {
      boss.processPlayerHit('ranged');
    }

    // Now ranged hits are blocked
    const blocked = boss.processPlayerHit('ranged');
    expect(blocked).toBe(true);
    expect(boss.offPrayerHitCount).toBe(0);
  });

  it('initProtection picks from seeded RNG deterministically', () => {
    // Use a fake rng that returns fixed values
    const boss1 = new Boss({ x: 4, y: 2 });
    boss1.initProtection(() => 0.0); // floor(0.0 * 3) = 0 → melee
    expect(boss1.protectionStyle).toBe('melee');

    const boss2 = new Boss({ x: 4, y: 2 });
    boss2.initProtection(() => 0.5); // floor(0.5 * 3) = 1 → magic
    expect(boss2.protectionStyle).toBe('magic');

    const boss3 = new Boss({ x: 4, y: 2 });
    boss3.initProtection(() => 0.9); // floor(0.9 * 3) = 2 → ranged
    expect(boss3.protectionStyle).toBe('ranged');
  });

  it('mixed styles: only counts the current off-prayer style', () => {
    const boss = new Boss({ x: 4, y: 2 });
    boss.protectionStyle = 'magic';

    // 3 ranged hits
    boss.processPlayerHit('ranged');
    boss.processPlayerHit('ranged');
    boss.processPlayerHit('ranged');
    expect(boss.offPrayerHitCount).toBe(3);

    // 2 melee hits (still off-prayer, counter continues)
    boss.processPlayerHit('melee');
    boss.processPlayerHit('melee');
    expect(boss.offPrayerHitCount).toBe(5);

    // 1 more melee hit → 6 total off-prayer → switch to melee
    boss.processPlayerHit('melee');
    expect(boss.protectionStyle).toBe('melee');
    expect(boss.offPrayerHitCount).toBe(0);
  });
});
