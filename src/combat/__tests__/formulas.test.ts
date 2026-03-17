import { describe, it, expect } from 'vitest';
import {
  meleeMaxHit, meleeAttackRoll,
  rangedMaxHit, rangedAttackRoll,
  magicMaxHit, magicAttackRoll,
  hitChance, npcDefenceRoll,
} from '../formulas.ts';
import { GameSimulation } from '../../engine/GameSimulation.ts';
import { Loadout } from '../../equipment/Loadout.ts';

describe('Combat Formulas', () => {
  describe('magicMaxHit', () => {
    it('T1 without augury = 23', () => {
      expect(magicMaxHit(1, false)).toBe(23);
    });
    it('T2 without augury = 31', () => {
      expect(magicMaxHit(2, false)).toBe(31);
    });
    it('T3 without augury = 39', () => {
      expect(magicMaxHit(3, false)).toBe(39);
    });
    it('T3 with augury = 40', () => {
      expect(magicMaxHit(3, true)).toBe(40);
    });
  });

  describe('npcDefenceRoll', () => {
    it('Hunlef: (240+9)*(20+64) = 20916', () => {
      expect(npcDefenceRoll(240, 20)).toBe(20916);
    });
  });

  describe('meleeMaxHit', () => {
    it('T3 halberd + 99 str + no prayer + no stance', () => {
      // effective_str = floor(floor(99*1.0) + 0 + 8) = 107
      // max_hit = floor((107 * (138+64) + 320) / 640) = floor((107*202 + 320)/640)
      // = floor((21614 + 320)/640) = floor(21934/640) = floor(34.27) = 34
      expect(meleeMaxHit(99, 138, 1.0, 0)).toBe(34);
    });
    it('T3 halberd + 99 str + Piety (1.23)', () => {
      // effective_str = floor(floor(99*1.23) + 0 + 8) = floor(121.77) + 8 = 121 + 8 = 129
      // max_hit = floor((129 * 202 + 320) / 640) = floor((26058+320)/640) = floor(26378/640) = floor(41.21) = 41
      expect(meleeMaxHit(99, 138, 1.23, 0)).toBe(41);
    });
  });

  describe('rangedMaxHit', () => {
    it('T3 bow + 99 ranged + no prayer', () => {
      // effective_str = floor(floor(99*1.0) + 8) = 107
      // max_hit = floor(0.5 + 107 * (138+64) / 640) = floor(0.5 + 107*202/640)
      // = floor(0.5 + 21614/640) = floor(0.5 + 33.77) = floor(34.27) = 34
      expect(rangedMaxHit(99, 138, 1.0)).toBe(34);
    });
    it('T3 bow + 99 ranged + Rigour (1.23)', () => {
      // effective_str = floor(floor(99*1.23) + 8) = 121 + 8 = 129
      // max_hit = floor(0.5 + 129 * 202 / 640) = floor(0.5 + 26058/640) = floor(0.5 + 40.72) = floor(41.22) = 41
      expect(rangedMaxHit(99, 138, 1.23)).toBe(41);
    });
  });

  describe('meleeAttackRoll', () => {
    it('T3 halberd + 99 atk + no prayer + no stance', () => {
      // effective_atk = floor(floor(99*1.0) + 0 + 8) = 107
      // attack_roll = 107 * (166 + 64) = 107 * 230 = 24610
      expect(meleeAttackRoll(99, 166, 1.0, 0)).toBe(24610);
    });
  });

  describe('rangedAttackRoll', () => {
    it('T3 bow + 99 ranged + no prayer + no stance', () => {
      // effective_atk = floor(floor(99*1.0) + 0 + 8) = 107
      // attack_roll = 107 * (172 + 64) = 107 * 236 = 25252
      expect(rangedAttackRoll(99, 172, 1.0, 0)).toBe(25252);
    });
  });

  describe('magicAttackRoll', () => {
    it('T3 staff + 99 magic + no prayer', () => {
      // effective_mag = floor(floor(99*1.0) + 9) = 108
      // attack_roll = 108 * (184 + 64) = 108 * 248 = 26784
      expect(magicAttackRoll(99, 184, 1.0)).toBe(26784);
    });
  });

  describe('hitChance', () => {
    it('when attRoll > defRoll', () => {
      // attRoll=25000, defRoll=20916
      // hitChance = 1 - (20916+2)/(2*(25000+1)) = 1 - 20918/50002 = 1 - 0.41834... = 0.58165...
      const result = hitChance(25000, 20916);
      expect(result).toBeCloseTo(0.5816, 3);
    });

    it('when attRoll <= defRoll', () => {
      // attRoll=15000, defRoll=20916
      // hitChance = 15000/(2*(20916+1)) = 15000/41834 = 0.3586...
      const result = hitChance(15000, 20916);
      expect(result).toBeCloseTo(0.3586, 3);
    });

    it('when attRoll == defRoll', () => {
      // attRoll=20916, defRoll=20916
      // attRoll <= defRoll, so: 20916 / (2 * 20917) = 20916/41834 = 0.4999...
      const result = hitChance(20916, 20916);
      expect(result).toBeCloseTo(0.4999, 3);
    });
  });
});

describe('Offensive prayer combat formula integration', () => {
  it('T3 staff + Augury → max hit 40', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.player.attackTarget = 'boss';
    sim.queueOffensivePrayer('augury');
    sim.processTick(); // applies the prayer

    // Access private method via casting for testing
    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(40);
  });

  it('T3 staff without Augury → max hit 39', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });

    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(39);
  });

  it('T3 bow + Rigour → accuracy uses 1.20 mult', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('rigour');
    sim.processTick();

    // effective_atk = floor(floor(99*1.20) + 0 + 8) = floor(118.8) + 8 = 118 + 8 = 126
    // attack_roll = 126 * (172 + 64) = 126 * 236 = 29736
    const attackRoll = (sim as any).getPlayerAttackRoll();
    expect(attackRoll).toBe(29736);
  });

  it('T3 bow + Rigour → max hit uses 1.23 mult', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('rigour');
    sim.processTick();

    const maxHit = (sim as any).getPlayerMaxHit();
    // effective_str = floor(floor(99*1.23) + 8) = 121 + 8 = 129
    // max_hit = floor(0.5 + 129 * 202 / 640) = floor(0.5 + 40.72) = 41
    expect(maxHit).toBe(41);
  });

  it('T3 halberd + Piety → accuracy uses 1.20 mult', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'halberd', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('piety');
    sim.processTick();

    // effective_atk = floor(floor(99*1.20) + 0 + 8) = 118 + 8 = 126
    // attack_roll = 126 * (166 + 64) = 126 * 230 = 28980
    const attackRoll = (sim as any).getPlayerAttackRoll();
    expect(attackRoll).toBe(28980);
  });

  it('T3 halberd + Piety → max hit uses 1.23 mult', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'halberd', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('piety');
    sim.processTick();

    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(41);
  });

  it('mismatched prayer: Piety with bow → no bonus', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('piety');
    sim.processTick();

    // Piety is melee, bow is ranged → no bonus
    const attackRoll = (sim as any).getPlayerAttackRoll();
    // No prayer: effective_atk = floor(99*1.0) + 0 + 8 = 107, roll = 107 * 236 = 25252
    expect(attackRoll).toBe(25252);

    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(34); // No prayer boost
  });

  it('T3 staff + Augury → accuracy uses 1.25 mult', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('augury');
    sim.processTick();

    // effective_mag = floor(floor(99*1.25) + 9) = floor(123.75) + 9 = 123 + 9 = 132
    // attack_roll = 132 * (184 + 64) = 132 * 248 = 32736
    const attackRoll = (sim as any).getPlayerAttackRoll();
    expect(attackRoll).toBe(32736);
  });

  it('T3 bow + Eagle Eye → accuracy 1.15, damage 1.15', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'bow', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('eagle_eye');
    sim.processTick();

    // effective_atk = floor(floor(99*1.15) + 0 + 8) = floor(113.85) + 8 = 113 + 8 = 121
    // attack_roll = 121 * 236 = 28556
    const attackRoll = (sim as any).getPlayerAttackRoll();
    expect(attackRoll).toBe(28556);

    // effective_str = floor(floor(99*1.15) + 8) = 113 + 8 = 121
    // max_hit = floor(0.5 + 121 * 202 / 640) = floor(0.5 + 38.19) = floor(38.69) = 38
    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(38);
  });

  it('T3 staff + Mystic Might → accuracy 1.15, no damage bonus', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42, { skipCountdown: true });
    sim.queueOffensivePrayer('mystic_might');
    sim.processTick();

    // effective_mag = floor(floor(99*1.15) + 9) = 113 + 9 = 122
    // attack_roll = 122 * 248 = 30256
    const attackRoll = (sim as any).getPlayerAttackRoll();
    expect(attackRoll).toBe(30256);

    // Magic max hit is fixed, no damage mult for mystic_might (magicMaxHitBonus=0)
    const maxHit = (sim as any).getPlayerMaxHit();
    expect(maxHit).toBe(39); // Same as without prayer
  });
});
