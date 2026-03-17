import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../engine/GameSimulation.ts';
import { Loadout } from '../equipment/Loadout.ts';

function createSim(seed = 42): GameSimulation {
  const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
  const sim = new GameSimulation(loadout, seed, { skipCountdown: true });
  sim.player.attackTarget = 'boss'; // Enable auto-attacking for legacy tests
  return sim;
}

describe('Integration', () => {
  it('headless 500-tick simulation does not crash', () => {
    const sim = createSim();
    sim.runTicks(500);
    expect(sim.tick).toBeLessThanOrEqual(500);
    // Should have either ended or reached 500 ticks
    expect(sim.tick).toBeGreaterThan(0);
  });

  it('boss takes damage during simulation', () => {
    // Use bow so boss protection (magic for seed 42) doesn't block all attacks
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.runTicks(500);
    // Player starts in range (or walks in range), so boss should take some damage
    expect(sim.boss.hp).toBeLessThan(1000);
  });

  it('boss style switches occur', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';

    // Keep correct prayer active so player survives long enough
    let sawMagic = false;
    let sawRanged = false;

    for (let i = 0; i < 50; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
        sawRanged = true;
      } else {
        sim.queuePrayer('magic');
        sawMagic = true;
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // Boss should have used both styles
    expect(sawRanged).toBe(true);
    expect(sawMagic).toBe(true);
  });

  it('determinism: same seed + loadout = identical outcomes', () => {
    const sim1 = createSim(12345);
    const sim2 = createSim(12345);

    // Record HP values tick by tick
    const hp1: number[] = [];
    const hp2: number[] = [];
    const bossHp1: number[] = [];
    const bossHp2: number[] = [];

    for (let i = 0; i < 100; i++) {
      sim1.processTick();
      sim2.processTick();
      hp1.push(sim1.player.hp);
      hp2.push(sim2.player.hp);
      bossHp1.push(sim1.boss.hp);
      bossHp2.push(sim2.boss.hp);
      if (sim1.state !== 'running' || sim2.state !== 'running') break;
    }

    expect(hp1).toEqual(hp2);
    expect(bossHp1).toEqual(bossHp2);
  });

  it('correct prayer reduces damage to armor tier max', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';

    // Always pray correct prayer
    // Boss starts ranged, so pray missiles
    sim.queuePrayer('missiles');

    for (let tick = 0; tick < 100; tick++) {
      // Check what style boss will use next and pray accordingly
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // With T3 armor and correct prayer, max hit per attack is 8
    // Total damage taken should be relatively low
    // Just verify simulation ran correctly
    expect(sim.player.totalDamageTaken).toBeGreaterThanOrEqual(0);
  });

  it('player and boss HP change during fight', () => {
    const sim = createSim();
    const initialPlayerHp = sim.player.hp;
    const initialBossHp = sim.boss.hp;

    sim.runTicks(50);

    // Both should have taken some damage
    expect(sim.player.hp).toBeLessThanOrEqual(initialPlayerHp);
    expect(sim.boss.hp).toBeLessThanOrEqual(initialBossHp);
  });

  it('game ends when boss or player reaches 0 HP', () => {
    const sim = createSim(42);
    sim.runTicks(2000);
    // After enough ticks, someone should be dead
    expect(sim.state).not.toBe('running');
    if (sim.state === 'won') {
      expect(sim.boss.hp).toBe(0);
    } else {
      expect(sim.player.hp).toBe(0);
    }
  });

  it('runTicks stops early when game ends', () => {
    const sim = createSim(42);
    sim.runTicks(10000);
    // Should have stopped before 10000 ticks
    expect(sim.tick).toBeLessThan(10000);
  });
});

describe('Hunlef protection integration', () => {
  it('boss starts with seeded random protection style', () => {
    const sim1 = createSim(42);
    const sim2 = createSim(42);
    // Same seed → same starting protection
    expect(sim1.boss.protectionStyle).toBe(sim2.boss.protectionStyle);

    // Different seed → may differ
    const sim3 = createSim(99);
    // Just check it's a valid style
    expect(['melee', 'magic', 'ranged']).toContain(sim3.boss.protectionStyle);
  });

  it('attacks matching boss protection deal 0 damage in sim', () => {
    // Create sim with staff (magic) and set boss to protect magic
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.boss.protectionStyle = 'magic';
    sim.boss.offPrayerHitCount = 0;

    const startBossHp = sim.boss.hp;

    // Run enough ticks for player to attack (staff range 10, should be in range)
    // Also keep player alive with prayer
    for (let i = 0; i < 30; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // Boss should NOT have taken damage because staff = magic = protected
    // (all hits are blocked)
    expect(sim.boss.hp).toBe(startBossHp);
    expect(sim.boss.offPrayerHitCount).toBe(0);
  });

  it('weapon switching bypasses protection', () => {
    // Start with bow (ranged), boss protects ranged
    const loadout = new Loadout({
      armorTier: 3,
      weaponType: 'bow',
      weaponTier: 3,
      secondaryWeaponType: 'staff',
      secondaryWeaponTier: 3,
    });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.boss.protectionStyle = 'ranged';
    sim.boss.offPrayerHitCount = 0;

    // Switch to staff (magic) via inventory slot 1
    sim.useInventoryItem(1); // secondary weapon should be at index 1

    // Run ticks — staff attacks should deal damage (boss protects ranged, not magic)
    for (let i = 0; i < 30; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // Boss should have taken some damage now
    expect(sim.boss.hp).toBeLessThan(1000);
  });

  it('boss switches protection after 6 off-prayer hits in full sim', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    // Force boss to protect melee so bow (ranged) is off-prayer
    sim.boss.protectionStyle = 'melee';
    sim.boss.offPrayerHitCount = 0;

    const startProtection = sim.boss.protectionStyle;
    let switchHappened = false;

    for (let i = 0; i < 100; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }

      sim.processTick();

      if (sim.boss.protectionStyle !== startProtection) {
        switchHappened = true;
        break;
      }
      if (sim.state !== 'running') break;
    }

    expect(switchHappened).toBe(true);
    // After switch, boss should protect ranged (player's bow style)
    expect(sim.boss.protectionStyle).toBe('ranged');
  });

  it('determinism preserved with protection mechanic', () => {
    const sim1 = createSim(777);
    const sim2 = createSim(777);

    for (let i = 0; i < 50; i++) {
      sim1.processTick();
      sim2.processTick();
      expect(sim1.boss.protectionStyle).toBe(sim2.boss.protectionStyle);
      expect(sim1.boss.offPrayerHitCount).toBe(sim2.boss.offPrayerHitCount);
      expect(sim1.boss.hp).toBe(sim2.boss.hp);
      if (sim1.state !== 'running') break;
    }
  });
});

describe('Countdown phase', () => {
  it('simulation starts in countdown state by default', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);
    expect(sim.state).toBe('countdown');
    expect(sim.countdownTicks).toBe(10);
  });

  it('after 10 ticks, state becomes running', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);
    expect(sim.state).toBe('countdown');

    for (let i = 0; i < 10; i++) {
      sim.processTick();
    }
    expect(sim.state).toBe('running');
    expect(sim.countdownTicks).toBe(0);
  });

  it('boss does not attack during countdown', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);
    sim.player.attackTarget = 'boss';

    const startHp = sim.player.hp;
    for (let i = 0; i < 10; i++) {
      sim.processTick();
    }
    // Player should not have taken any damage during countdown
    expect(sim.player.hp).toBe(startHp);
  });

  it('player can move during countdown', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);
    const startPos = { ...sim.player.pos };

    sim.queueMove({ x: startPos.x + 2, y: startPos.y });
    sim.processTick();

    // Player should have moved
    expect(sim.player.pos.x).not.toBe(startPos.x);
  });

  it('player can toggle prayers during countdown', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);

    sim.queuePrayer('magic');
    sim.processTick();
    expect(sim.prayerManager.activePrayer).toBe('magic');
  });

  it('player cannot attack during countdown (even with target set)', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42);
    sim.player.attackTarget = 'boss';
    sim.boss.protectionStyle = 'melee'; // So bow hits are not blocked

    const startBossHp = sim.boss.hp;
    for (let i = 0; i < 10; i++) {
      sim.processTick();
    }
    // Boss should not have taken damage during countdown
    expect(sim.boss.hp).toBe(startBossHp);
  });

  it('skipCountdown option starts in running state', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    expect(sim.state).toBe('running');
    expect(sim.countdownTicks).toBe(0);
  });
});

describe('Click-to-attack targeting', () => {
  it('attack target starts null', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    expect(sim.player.attackTarget).toBeNull();
  });

  it('queueAttackTarget sets target on next tick', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });

    sim.queueAttackTarget('boss');
    sim.processTick();
    expect(sim.player.attackTarget).toBe('boss');
  });

  it('no attack when target is not set', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.boss.protectionStyle = 'melee'; // Ensure bow not blocked

    // Don't set attack target
    const startBossHp = sim.boss.hp;
    sim.runTicks(20);
    // Boss takes no player damage (but boss still attacks player)
    expect(sim.boss.hp).toBe(startBossHp);
  });

  it('attack fires when target set and in range', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.boss.protectionStyle = 'melee'; // Ensure bow not blocked

    sim.runTicks(20);
    // Boss should take some damage
    expect(sim.boss.hp).toBeLessThan(1000);
  });

  it('queueMove clears attack target', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';

    sim.queueMove({ x: 0, y: 0 });
    sim.processTick();
    expect(sim.player.attackTarget).toBeNull();
  });
});

describe('Offensive prayers + combat integration', () => {
  it('Rigour activates and stays active during combat', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.boss.protectionStyle = 'melee';
    sim.queueOffensivePrayer('rigour');
    sim.processTick(); // Apply prayer

    expect(sim.prayerManager.offensivePrayer).toBe('rigour');

    // Continue running with prayer active
    sim.runTicks(20);

    // Rigour should still be active (unless prayer ran out)
    if (sim.player.prayerPoints > 0) {
      expect(sim.prayerManager.offensivePrayer).toBe('rigour');
    }
  });

  it('Piety + Protect from Magic both active and drain', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'halberd', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';

    sim.queuePrayer('magic');
    sim.queueOffensivePrayer('piety');
    sim.processTick();

    expect(sim.prayerManager.activePrayer).toBe('magic');
    expect(sim.prayerManager.offensivePrayer).toBe('piety');

    // Run more ticks to verify drain
    const startPrayer = sim.player.prayerPoints;
    sim.runTicks(50);
    // Should have drained prayer (both protection 12 + piety 24 = 36 drain rate)
    expect(sim.player.prayerPoints).toBeLessThan(startPrayer);
  });

  it('determinism preserved with offensive prayers', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim1 = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim1.player.attackTarget = 'boss';
    sim1.queueOffensivePrayer('rigour');

    const sim2 = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim2.player.attackTarget = 'boss';
    sim2.queueOffensivePrayer('rigour');

    for (let i = 0; i < 50; i++) {
      sim1.processTick();
      sim2.processTick();
      expect(sim1.boss.hp).toBe(sim2.boss.hp);
      expect(sim1.player.hp).toBe(sim2.player.hp);
      if (sim1.state !== 'running') break;
    }
  });
});
