import { describe, it, expect } from 'vitest';
import { rangedHitDelay, magicHitDelay, meleeHitDelay } from '../entities/Projectile.ts';
import { GameSimulation } from '../engine/GameSimulation.ts';
import { Loadout } from '../equipment/Loadout.ts';

// ---------- Unit tests for delay formulas ----------

describe('rangedHitDelay', () => {
  const expected = [1, 1, 2, 2, 2, 2, 2, 2, 3, 3];
  for (let d = 1; d <= 10; d++) {
    it(`distance ${d} => ${expected[d - 1]}`, () => {
      expect(rangedHitDelay(d)).toBe(expected[d - 1]);
    });
  }
});

describe('magicHitDelay', () => {
  const expected = [1, 2, 2, 2, 3, 3, 3, 4, 4, 4];
  for (let d = 1; d <= 10; d++) {
    it(`distance ${d} => ${expected[d - 1]}`, () => {
      expect(magicHitDelay(d)).toBe(expected[d - 1]);
    });
  }
});

describe('meleeHitDelay', () => {
  it('always returns 0', () => {
    expect(meleeHitDelay()).toBe(0);
  });
});

// ---------- Integration tests for projectile system ----------

function createSim(weaponType: 'bow' | 'staff' | 'halberd' = 'bow', seed = 42): GameSimulation {
  const loadout = new Loadout({ armorTier: 3, weaponType, weaponTier: 3 });
  return new GameSimulation(loadout, seed, { skipCountdown: true });
}

describe('Boss attack creates a projectile', () => {
  it('boss fires and a projectile is added to sim.projectiles', () => {
    const sim = createSim('bow');
    // Boss attack cooldown starts at 5, fires when it reaches 0
    // Run enough ticks for boss to fire
    for (let i = 0; i < 10; i++) {
      sim.processTick();
      if (sim.state !== 'running') break;
    }
    // At least one projectile should have been created by the boss
    const hasBossProjectile = sim.projectiles.some(p => p.source === 'boss');
    // Either a boss projectile is still in flight, or boss has attacked
    expect(hasBossProjectile || sim.lastBossAttackStyle !== null).toBe(true);
  });
});

describe('Player attack creates a projectile', () => {
  it('player ranged attack creates an arrow projectile', () => {
    const sim = createSim('bow');
    sim.player.attackTarget = 'boss';
    // Player starts at (6,10), boss at (4,1) — walk closer
    sim.player.pos = { x: 6, y: 7 }; // within bow range

    // Run until player fires (attackCooldown starts at 0)
    sim.processTick();

    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);
    expect(playerProj[0].shape).toBe('arrow');
    expect(playerProj[0].style).toBe('ranged');
  });

  it('player magic attack creates a blast projectile', () => {
    const sim = createSim('staff');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    sim.processTick();

    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);
    expect(playerProj[0].shape).toBe('blast');
    expect(playerProj[0].style).toBe('magic');
  });

  it('player melee attack creates a slash projectile', () => {
    const sim = createSim('halberd');
    sim.player.attackTarget = 'boss';
    // Halberd range is 2, need to be adjacent to boss 5x5 footprint at (4,1)
    // Boss occupies (4,1)-(8,5). pos (6,7) is dist 2 from y=5 edge.
    sim.player.pos = { x: 6, y: 7 };

    sim.processTick();

    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);
    expect(playerProj[0].shape).toBe('slash');
    expect(playerProj[0].style).toBe('melee');
  });
});

describe('Damage timing', () => {
  it('ranged damage applies on arrivalTick, not fireTick', () => {
    const sim = createSim('bow');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    const bossHpBefore = sim.boss.hp;
    sim.processTick(); // tick 1: player fires

    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);

    const proj = playerProj[0];
    // For ranged, delay > 0 so arrivalTick > fireTick
    expect(proj.arrivalTick).toBeGreaterThan(proj.fireTick);

    // Boss HP should NOT have changed yet (unless other damage sources exist — isolate)
    // The damage from this projectile specifically should not yet be applied
    // Since arrivalTick > fireTick, damage is deferred
    const bossHpAfterFire = sim.boss.hp;
    // Boss hp after fire should be same as before (no instant damage for ranged)
    expect(bossHpAfterFire).toBe(bossHpBefore);
  });

  it('melee damage is instant (same tick)', () => {
    const sim = createSim('halberd');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    sim.processTick(); // tick 1: player fires melee

    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);

    // Melee delay is 0, so arrivalTick was set to fireTick, then marked as resolved
    const proj = playerProj[0];
    expect(proj.arrivalTick).toBeLessThanOrEqual(proj.fireTick);
  });
});

describe('Projectile cleanup', () => {
  it('projectiles are removed after arrival + render buffer', () => {
    const sim = createSim('bow');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    sim.processTick(); // tick 1: player fires
    const playerProj = sim.projectiles.filter(p => p.source === 'player');
    expect(playerProj.length).toBeGreaterThanOrEqual(1);

    // Run enough ticks for all projectiles to arrive and be cleaned up
    for (let i = 0; i < 20; i++) {
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // All projectiles from tick 1 should be cleaned up by now
    const oldProjectiles = sim.projectiles.filter(p => p.fireTick === 1);
    expect(oldProjectiles.length).toBe(0);
  });
});

describe('Target dying before projectile arrives', () => {
  it('damage is no-op if target is already dead', () => {
    const sim = createSim('bow');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    // Kill the boss manually before any projectile arrives
    sim.processTick(); // player fires
    sim.boss.hp = 0; // boss is dead

    // Run more ticks — should not crash even though boss is dead
    for (let i = 0; i < 10; i++) {
      sim.processTick();
    }

    // Boss HP should still be 0 (no negative HP)
    expect(sim.boss.hp).toBe(0);
  });
});

describe('Multiple simultaneous projectiles', () => {
  it('handles multiple projectiles in flight at once', () => {
    const sim = createSim('bow');
    sim.player.attackTarget = 'boss';
    sim.player.pos = { x: 6, y: 7 };

    // Run several ticks to get both boss and player projectiles in flight
    for (let i = 0; i < 15; i++) {
      // Keep prayer active so player survives
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // The simulation should still be running (no crashes from multiple projectiles)
    expect(['running', 'won', 'lost']).toContain(sim.state);
  });
});
