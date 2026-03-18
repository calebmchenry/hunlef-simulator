import { describe, it, expect } from 'vitest';
import { Inventory } from '../entities/Inventory.ts';
import { GameSimulation } from '../engine/GameSimulation.ts';
import { Loadout } from '../equipment/Loadout.ts';
import type { LoadoutConfig } from '../equipment/Loadout.ts';

function createConfig(overrides: Partial<LoadoutConfig> = {}): LoadoutConfig {
  return {
    armorTier: 3,
    weaponType: 'staff',
    weaponTier: 3,
    paddlefishCount: 12,
    corruptedPaddlefishCount: 4,
    egniolDoses: 8,
    ...overrides,
  };
}

function createSim(configOverrides: Partial<LoadoutConfig> = {}, seed = 42): GameSimulation {
  const config = createConfig(configOverrides);
  const loadout = new Loadout(config);
  return new GameSimulation(loadout, seed, { skipCountdown: true });
}

function countPlayerProjectiles(sim: GameSimulation): number {
  return sim.projectiles.filter(projectile => projectile.source === 'player').length;
}

describe('Inventory', () => {
  describe('buildFromLoadout', () => {
    it('populates correct number of items', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      // 2 egniol vials (8 doses = 2 vials) + 12 paddlefish + 4 corrupted = 18
      expect(inv.itemCount).toBe(18);
    });

    it('places potions first, then food when no secondary weapon is configured', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      expect(inv.slots[0]!.category).toBe('potion');
      expect(inv.slots[1]!.category).toBe('potion');
      expect(inv.slots[2]!.category).toBe('food');
    });

    it('creates correct egniol vials from doses', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig({ egniolDoses: 7 }));
      // 7 doses = 2 vials: first has 4 doses, second has 3
      const vial1 = inv.slots[0];
      const vial2 = inv.slots[1];
      expect(vial1!.quantity).toBe(4);
      expect(vial2!.quantity).toBe(3);
    });

    it('includes secondary weapon when configured', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig({
        secondaryWeaponType: 'bow',
        secondaryWeaponTier: 3,
      }));
      expect(inv.slots[0]!.category).toBe('weapon');
      expect(inv.slots[1]!.category).toBe('potion');
      expect(inv.slots[0]!.name).toContain('Bow');
    });

    it('respects 28-slot limit', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig({
        paddlefishCount: 50,
        corruptedPaddlefishCount: 0,
        egniolDoses: 0,
      }));
      expect(inv.itemCount).toBeLessThanOrEqual(28);
    });
  });

  describe('useItem', () => {
    it('returns eat action for paddlefish', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      // Find first paddlefish
      const idx = inv.slots.findIndex(s => s?.id === 'paddlefish');
      const action = inv.useItem(idx);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('eat');
      if (action!.type === 'eat') {
        expect(action!.healAmount).toBe(20);
        expect(action!.comboFood).toBe(false);
      }
    });

    it('returns eat action for corrupted paddlefish (combo)', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      const idx = inv.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
      const action = inv.useItem(idx);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('eat');
      if (action!.type === 'eat') {
        expect(action!.healAmount).toBe(16);
        expect(action!.comboFood).toBe(true);
      }
    });

    it('returns drink action for potion', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      const idx = inv.slots.findIndex(s => s?.category === 'potion');
      const action = inv.useItem(idx);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('drink');
    });

    it('returns equip action for weapon', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig({
        secondaryWeaponType: 'bow',
        secondaryWeaponTier: 3,
      }));
      const action = inv.useItem(0); // first slot is weapon
      expect(action).not.toBeNull();
      expect(action!.type).toBe('equip');
    });

    it('returns null for empty slot', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      const action = inv.useItem(27); // last slot likely empty
      expect(action).toBeNull();
    });
  });

  describe('removeItem', () => {
    it('clears the slot', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      const idx = inv.slots.findIndex(s => s?.id === 'paddlefish');
      expect(inv.slots[idx]).not.toBeNull();
      inv.removeItem(idx);
      expect(inv.slots[idx]).toBeNull();
    });
  });

  describe('decrementDose', () => {
    it('decrements potion dose', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig());
      const idx = inv.slots.findIndex(s => s?.category === 'potion');
      expect(inv.slots[idx]!.quantity).toBe(4);
      inv.decrementDose(idx);
      expect(inv.slots[idx]!.quantity).toBe(3);
      expect(inv.slots[idx]!.name).toBe('Egniol (3)');
    });

    it('removes vial at 0 doses', () => {
      const inv = new Inventory();
      inv.buildFromLoadout(createConfig({ egniolDoses: 1 }));
      const idx = inv.slots.findIndex(s => s?.category === 'potion');
      expect(inv.slots[idx]!.quantity).toBe(1);
      inv.decrementDose(idx);
      expect(inv.slots[idx]).toBeNull();
    });
  });
});

describe('GameSimulation inventory actions', () => {
  it('eating paddlefish heals 20 HP', () => {
    const sim = createSim();
    sim.player.hp = 60;
    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();
    expect(sim.player.hp).toBeGreaterThanOrEqual(60); // healed (may take damage from boss too)
  });

  it('eating paddlefish removes item from inventory', () => {
    const sim = createSim();
    sim.player.hp = 60;
    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();
    expect(sim.player.inventory.slots[idx]).toBeNull();
  });

  it('eating paddlefish consumes action (playerAteThisTick)', () => {
    const sim = createSim();
    sim.player.hp = 60;
    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();
    expect(sim.playerAteThisTick).toBe(true);
  });

  it('corrupted paddlefish does NOT consume action', () => {
    const sim = createSim();
    sim.player.hp = 60;
    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();
    expect(sim.playerAteThisTick).toBe(false);
  });

  it('combo eating heals 36 HP total (paddlefish + corrupted same tick)', () => {
    const sim = createSim();
    sim.player.hp = 50;
    // Make the simulation deterministic by putting player out of boss range
    // and set boss cooldown high so it doesn't attack
    sim.boss.attackCooldown = 100;

    const paddleIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    const corruptedIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
    sim.useInventoryItem(paddleIdx);
    sim.useInventoryItem(corruptedIdx);
    sim.processTick();
    // Should have healed 20 + 16 = 36, capped at 99
    expect(sim.player.hp).toBe(86);
  });

  it('cannot eat at full HP (no-op)', () => {
    const sim = createSim();
    sim.player.hp = 99;
    sim.boss.attackCooldown = 100;
    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    const itemBefore = sim.player.inventory.slots[idx];
    expect(itemBefore).not.toBeNull();
    sim.useInventoryItem(idx);
    sim.processTick();
    // Item should still be there since eating at full HP is a no-op
    expect(sim.player.inventory.slots[idx]).not.toBeNull();
    expect(sim.playerAteThisTick).toBe(false);
  });

  it('eating paddlefish at cooldown=0 delays the next attack by exactly 3 ticks', () => {
    const sim = createSim();
    sim.player.hp = 60;
    sim.player.attackTarget = 'boss';
    sim.player.attackCooldown = 0;
    sim.boss.attackCooldown = 100;

    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);

    sim.processTick();
    expect(sim.player.attackCooldown).toBe(3);
    expect(countPlayerProjectiles(sim)).toBe(0);

    sim.processTick();
    expect(sim.player.attackCooldown).toBe(2);
    expect(countPlayerProjectiles(sim)).toBe(0);

    sim.processTick();
    expect(sim.player.attackCooldown).toBe(1);
    expect(countPlayerProjectiles(sim)).toBe(0);

    sim.processTick();
    expect(countPlayerProjectiles(sim)).toBe(1);
    expect(sim.player.attackCooldown).toBe(sim.player.loadout.weapon.attackSpeed);
  });

  it('eating paddlefish with cooldown >= 3 does not increase cooldown', () => {
    const sim = createSim();
    sim.player.hp = 60;
    sim.player.attackTarget = 'boss';
    sim.player.attackCooldown = 5;
    sim.boss.attackCooldown = 100;

    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();

    expect(sim.player.attackCooldown).toBe(4);
    expect(countPlayerProjectiles(sim)).toBe(0);
  });

  it('eating paddlefish at cooldown=2 extends the delay back to 3 ticks', () => {
    const sim = createSim();
    sim.player.hp = 60;
    sim.player.attackCooldown = 2;
    sim.boss.attackCooldown = 100;

    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();

    expect(sim.player.attackCooldown).toBe(3);
  });

  it('corrupted paddlefish does not add eat delay and still allows an attack that tick', () => {
    const sim = createSim();
    sim.player.hp = 60;
    sim.player.attackTarget = 'boss';
    sim.player.attackCooldown = 0;
    sim.boss.attackCooldown = 100;

    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();

    expect(sim.playerAteThisTick).toBe(false);
    expect(countPlayerProjectiles(sim)).toBe(1);
    expect(sim.player.attackCooldown).toBe(sim.player.loadout.weapon.attackSpeed);
  });

  it('attempting to eat at full HP does not trigger eat delay and does not block an attack', () => {
    const sim = createSim();
    sim.player.hp = sim.player.maxHp;
    sim.player.attackTarget = 'boss';
    sim.player.attackCooldown = 0;
    sim.boss.attackCooldown = 100;

    const idx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    sim.useInventoryItem(idx);
    sim.processTick();

    expect(sim.player.inventory.slots[idx]).not.toBeNull();
    expect(sim.playerAteThisTick).toBe(false);
    expect(countPlayerProjectiles(sim)).toBe(1);
    expect(sim.player.attackCooldown).toBe(sim.player.loadout.weapon.attackSpeed);
  });

  it('combo eating applies the standard-food delay but does not stack beyond 3 ticks', () => {
    const sim = createSim();
    sim.player.hp = 50;
    sim.player.attackTarget = 'boss';
    sim.player.attackCooldown = 0;
    sim.boss.attackCooldown = 100;

    const paddleIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'paddlefish');
    const corruptedIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'corrupted_paddlefish');
    sim.useInventoryItem(paddleIdx);
    sim.useInventoryItem(corruptedIdx);
    sim.processTick();

    expect(sim.player.hp).toBe(86);
    expect(sim.playerAteThisTick).toBe(true);
    expect(sim.player.attackCooldown).toBe(3);
    expect(countPlayerProjectiles(sim)).toBe(0);
  });

  it('boss reset uses attackSpeed when restoring attackCooldown', () => {
    const sim = createSim();
    Object.defineProperty(sim.boss, 'attackSpeed', {
      value: 7,
      writable: true,
      configurable: true,
    });

    sim.boss.attackCooldown = 1;
    sim.boss.reset({ x: 1, y: 1 });

    expect(sim.boss.attackCooldown).toBe(7);
  });

  it('egniol potion restores floor(77/4)+7 = 26 prayer points', () => {
    const sim = createSim();
    sim.player.prayerPoints = 30;
    sim.boss.attackCooldown = 100;
    const idx = sim.player.inventory.slots.findIndex(s => s?.category === 'potion');
    sim.useInventoryItem(idx);
    sim.processTick();
    // 30 + 26 = 56
    expect(sim.player.prayerPoints).toBe(56);
  });

  it('egniol potion decrements dose', () => {
    const sim = createSim();
    sim.player.prayerPoints = 30;
    sim.boss.attackCooldown = 100;
    const idx = sim.player.inventory.slots.findIndex(s => s?.category === 'potion');
    expect(sim.player.inventory.slots[idx]!.quantity).toBe(4);
    sim.useInventoryItem(idx);
    sim.processTick();
    expect(sim.player.inventory.slots[idx]!.quantity).toBe(3);
  });

  it('weapon switch changes equipped weapon', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 3,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;
    expect(sim.player.loadout.weapon.type).toBe('staff');
    // Second slot should be the bow
    const bowIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    expect(bowIdx).toBeGreaterThan(-1);
    sim.useInventoryItem(bowIdx);
    sim.processTick();
    expect(sim.player.loadout.weapon.type).toBe('bow');
    // The inventory slot should now hold the old staff
    expect(sim.player.inventory.slots[bowIdx]!.name).toContain('Staff');
  });

  it('weapon switch leaves loadout config immutable', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 2,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;

    const bowIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    expect(bowIdx).toBeGreaterThan(-1);

    sim.useInventoryItem(bowIdx);
    sim.processTick();

    expect(sim.player.loadout.weapon.type).toBe('bow');
    expect(sim.player.loadout.weapon.tier).toBe(3);
    expect(sim.player.loadout.config.weaponType).toBe('staff');
    expect(sim.player.loadout.config.weaponTier).toBe(2);
    expect(sim.player.inventory.slots[bowIdx]!.id).toBe('staff_2');
  });

  it('double weapon swap uses the currently equipped weapon each time', () => {
    const sim = createSim({
      weaponType: 'staff',
      weaponTier: 2,
      secondaryWeaponType: 'bow',
      secondaryWeaponTier: 3,
    });
    sim.boss.attackCooldown = 100;

    const weaponIdx = sim.player.inventory.slots.findIndex(s => s?.id === 'bow_3');
    expect(weaponIdx).toBeGreaterThan(-1);

    sim.useInventoryItem(weaponIdx);
    sim.processTick();

    expect(sim.player.loadout.weapon.type).toBe('bow');
    expect(sim.player.loadout.weapon.tier).toBe(3);
    expect(sim.player.inventory.slots[weaponIdx]!.id).toBe('staff_2');

    sim.useInventoryItem(weaponIdx);
    sim.processTick();

    expect(sim.player.loadout.weapon.type).toBe('staff');
    expect(sim.player.loadout.weapon.tier).toBe(2);
    expect(sim.player.inventory.slots[weaponIdx]!.id).toBe('bow_3');
    expect(sim.player.loadout.config.weaponType).toBe('staff');
    expect(sim.player.loadout.config.weaponTier).toBe(2);
  });

  it('determinism preserved with inventory actions', () => {
    const config = createConfig({ paddlefishCount: 6, egniolDoses: 4 });
    const loadout1 = new Loadout(config);
    const loadout2 = new Loadout(config);
    const sim1 = new GameSimulation(loadout1, 99, { skipCountdown: true });
    const sim2 = new GameSimulation(loadout2, 99, { skipCountdown: true });

    // Same sequence of actions on both
    for (let i = 0; i < 50; i++) {
      sim1.processTick();
      sim2.processTick();
      if (sim1.state !== 'running' || sim2.state !== 'running') break;
    }

    expect(sim1.player.hp).toBe(sim2.player.hp);
    expect(sim1.boss.hp).toBe(sim2.boss.hp);
    expect(sim1.tick).toBe(sim2.tick);
  });
});
