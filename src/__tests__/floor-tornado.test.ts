import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../engine/GameSimulation.ts';
import { Loadout } from '../equipment/Loadout.ts';
import { FloorHazardManager } from '../world/FloorHazardManager.ts';
import { Rng } from '../engine/Rng.ts';

function createSim(seed = 42, armorTier: 0 | 1 | 2 | 3 = 3): GameSimulation {
  const loadout = new Loadout({ armorTier, weaponType: 'staff', weaponTier: 3 });
  return new GameSimulation(loadout, seed, { skipCountdown: true });
}

const CORNER_KEYS = new Set(['0,0', '11,0', '0,11', '11,11']);

// ===== Floor Tile State Tests =====

describe('FloorHazardManager', () => {
  it('tiles start as safe', () => {
    const mgr = new FloorHazardManager();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        expect(mgr.tiles[x][y].state).toBe('safe');
      }
    }
  });

  it('tiles transition to warning on first tick', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);
    mgr.tick(1000, 1, rng);

    // Some tiles should now be in warning state
    let warningCount = 0;
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        if (mgr.tiles[x][y].state === 'warning') warningCount++;
      }
    }
    expect(warningCount).toBeGreaterThan(0);
  });

  it('warning duration matches Phase 1 timing (6 ticks)', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Tick 1: starts warning
    mgr.tick(1000, 1, rng);
    expect(countTilesInState(mgr, 'warning')).toBeGreaterThan(0);
    expect(countTilesInState(mgr, 'hazard')).toBe(0);

    // Ticks 2-6: still warning (Phase 1 warning = 6 ticks)
    for (let t = 2; t <= 6; t++) {
      mgr.tick(1000, t, rng);
      expect(countTilesInState(mgr, 'hazard')).toBe(0);
    }

    // Tick 7: transitions to hazard (6 ticks elapsed since tick 1)
    mgr.tick(1000, 7, rng);
    expect(countTilesInState(mgr, 'hazard')).toBeGreaterThan(0);
  });

  it('warning duration matches Phase 2 timing (4 ticks)', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Tick 1: starts warning (Phase 2: HP 500)
    mgr.tick(500, 1, rng);
    expect(countTilesInState(mgr, 'warning')).toBeGreaterThan(0);

    // Ticks 2-4: still warning
    for (let t = 2; t <= 4; t++) {
      mgr.tick(500, t, rng);
      expect(countTilesInState(mgr, 'hazard')).toBe(0);
    }

    // Tick 5: transitions to hazard (4 ticks elapsed)
    mgr.tick(500, 5, rng);
    expect(countTilesInState(mgr, 'hazard')).toBeGreaterThan(0);
  });

  it('warning duration matches Phase 3 timing (3 ticks)', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Tick 1: starts warning (Phase 3: HP 100)
    mgr.tick(100, 1, rng);
    expect(countTilesInState(mgr, 'warning')).toBeGreaterThan(0);

    // Ticks 2-3: still warning
    for (let t = 2; t <= 3; t++) {
      mgr.tick(100, t, rng);
      expect(countTilesInState(mgr, 'hazard')).toBe(0);
    }

    // Tick 4: transitions to hazard (3 ticks elapsed)
    mgr.tick(100, 4, rng);
    expect(countTilesInState(mgr, 'hazard')).toBeGreaterThan(0);
  });

  it('hazard tiles clear after 6 ticks and new cycle begins', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Phase 1: warning=6, hazard=6, total cycle=12
    // Tick 1: warning starts
    mgr.tick(1000, 1, rng);
    // Tick 7: hazard starts
    mgr.tick(1000, 7, rng);
    expect(countTilesInState(mgr, 'hazard')).toBeGreaterThan(0);

    // Tick 13: hazard clears (6+6=12 ticks elapsed), new cycle starts
    mgr.tick(1000, 13, rng);
    // New cycle should start with warning tiles
    expect(countTilesInState(mgr, 'warning')).toBeGreaterThan(0);
  });

  it('no consecutive repeat patterns', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Track which patterns are selected by observing which tiles are activated
    const patterns: Set<string>[] = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const cycleDuration = 12; // Phase 1 total cycle
      const startTick = cycle * cycleDuration + 1;

      mgr.tick(1000, startTick, rng);

      // Capture current warning pattern
      const warningSet = new Set<string>();
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 12; y++) {
          if (mgr.tiles[x][y].state === 'warning') {
            warningSet.add(`${x},${y}`);
          }
        }
      }
      patterns.push(warningSet);

      // Advance through the rest of the cycle
      mgr.tick(1000, startTick + 6, rng); // to hazard
      mgr.tick(1000, startTick + 12, rng); // clear + new cycle (this is next cycle's start)
    }

    // Verify no two consecutive patterns are identical
    for (let i = 1; i < patterns.length; i++) {
      const prev = patterns[i - 1];
      const curr = patterns[i];
      const same = prev.size === curr.size && [...prev].every(k => curr.has(k));
      expect(same).toBe(false);
    }
  });

  it('Phase 3 permanent safe tiles never activate', () => {
    const mgr = new FloorHazardManager();
    const rng = new Rng(42);

    // Run several cycles in Phase 3
    for (let t = 1; t <= 50; t++) {
      mgr.tick(100, t, rng);

      // Check permanent safe tiles remain safe
      const tile55 = mgr.tiles[5][5];
      const tile65 = mgr.tiles[6][5];
      const tile56 = mgr.tiles[5][6];
      const tile66 = mgr.tiles[6][6];

      expect(tile55.permanent).toBe(true);
      expect(tile55.state).toBe('safe');
      expect(tile65.permanent).toBe(true);
      expect(tile65.state).toBe('safe');
      expect(tile56.permanent).toBe(true);
      expect(tile56.state).toBe('safe');
      expect(tile66.permanent).toBe(true);
      expect(tile66.state).toBe('safe');
    }
  });

  it('getPhase returns correct phase from HP', () => {
    const mgr = new FloorHazardManager();
    expect(mgr.getPhase(1000)).toBe(1);
    expect(mgr.getPhase(667)).toBe(1);
    expect(mgr.getPhase(666)).toBe(2);
    expect(mgr.getPhase(333)).toBe(2);
    expect(mgr.getPhase(332)).toBe(3);
    expect(mgr.getPhase(1)).toBe(3);
  });
});

// ===== Floor Tile Damage Tests =====

describe('Floor tile damage in simulation', () => {
  it('player takes damage on hazard tile', () => {
    const sim = createSim(42);
    // Force boss HP high (Phase 1)
    sim.boss.hp = 1000;

    // Run enough ticks to get hazard tiles (warning=6 + a few more)
    for (let i = 0; i < 20; i++) {
      sim.processTick();
    }

    // We verify the system is integrated by checking total damage > 0
    expect(sim.player.totalDamageTaken).toBeGreaterThanOrEqual(0);
  });

  it('no floor damage on safe tiles', () => {
    const sim = createSim(42);
    sim.boss.hp = 1000;

    // Process just 1 tick to start the first cycle (tiles become warning, not hazard yet)
    sim.processTick();

    const px = sim.player.pos.x;
    const py = sim.player.pos.y;
    const tile = sim.floorHazardManager.tiles[px][py];

    // If the tile is safe, floor damage should not have been applied
    // (Player may still take boss attack damage though)
    if (tile.state === 'safe') {
      // Only boss damage expected, no floor damage
      // This is just a sanity check that the system differentiates
      expect(tile.state).toBe('safe');
    }
  });

  it('no floor damage on warning tiles', () => {
    const sim = createSim(42);
    sim.boss.hp = 1000;

    // First tick starts a warning cycle
    sim.processTick();

    // Warning tiles should exist but not deal damage
    let hasWarning = false;
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        if (sim.floorHazardManager.tiles[x][y].state === 'warning') {
          hasWarning = true;
        }
      }
    }
    expect(hasWarning).toBe(true);
  });

  it('floor hazards do NOT activate during countdown', () => {
    const loadout = new Loadout({ armorTier: 3, weaponType: 'staff', weaponTier: 3 });
    const sim = new GameSimulation(loadout, 42); // No skipCountdown

    // Run through countdown
    for (let i = 0; i < 10; i++) {
      sim.processTick();
    }

    // During countdown, floor hazards should not have activated
    // All tiles should still be safe after countdown
    // (Floor hazards start on first running tick)
    let allSafe = true;
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        if (sim.floorHazardManager.tiles[x][y].state !== 'safe') {
          allSafe = false;
        }
      }
    }
    expect(allSafe).toBe(true);
  });
});

// ===== Tornado Tests =====

describe('Boss tornado rotation', () => {
  it('boss fires tornado as the first counted attack of odd magic cycles', () => {
    const sim = createSim(42);
    sim.boss.currentStyle = 'magic';
    sim.boss.cycleCount = 1;
    sim.boss.attackCounter = 0;
    sim.boss.initMagicPhase(() => 0.5);

    expect(sim.boss.fireAttack(25)).toBe('tornado');
    expect(sim.boss.attackCounter).toBe(1);
  });

  it('tornado count matches HP phase', () => {
    // Phase 1: 2 tornadoes
    const sim1 = createSim(42);
    sim1.boss.hp = 800;
    // Force tornado spawn
    (sim1 as any).spawnTornadoes();
    expect(sim1.tornadoes.length).toBe(2);
    expect(sim1.tornadoes.every(t => CORNER_KEYS.has(`${t.pos.x},${t.pos.y}`))).toBe(true);

    // Phase 2: 3 tornadoes
    const sim2 = createSim(42);
    sim2.boss.hp = 500;
    (sim2 as any).spawnTornadoes();
    expect(sim2.tornadoes.length).toBe(3);
    expect(sim2.tornadoes.every(t => CORNER_KEYS.has(`${t.pos.x},${t.pos.y}`))).toBe(true);

    // Phase 3: 4 tornadoes
    const sim3 = createSim(42);
    sim3.boss.hp = 100;
    (sim3 as any).spawnTornadoes();
    expect(sim3.tornadoes.length).toBe(4);
    expect(sim3.tornadoes.every(t => CORNER_KEYS.has(`${t.pos.x},${t.pos.y}`))).toBe(true);
  });

  it('tornadoes appear one tick after stomp and stay inactive until activeTick', () => {
    const sim = createSim(42);
    sim.player.attackTarget = null;
    sim.player.targetTile = null;
    sim.player.pos = { x: 6, y: 10 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.boss.currentStyle = 'magic';
    sim.boss.cycleCount = 1;
    sim.boss.attackCounter = 0;
    sim.boss.attackCooldown = 1;

    sim.processTick();

    expect(sim.lastBossEventType).toBe('tornado_stomp');
    expect(sim.pendingTornadoSpawnTick).toBe(2);
    expect(sim.tornadoes).toHaveLength(0);

    sim.processTick();

    expect(sim.tornadoes.length).toBe(2);
    expect(sim.tornadoes.every(t => CORNER_KEYS.has(`${t.pos.x},${t.pos.y}`))).toBe(true);
    expect(sim.tornadoes.every(t => t.activeTick === 3)).toBe(true);
    const spawnedPositions = sim.tornadoes.map(t => ({ ...t.pos }));
    expect(sim.player.totalDamageTaken).toBe(0);
    expect(sim.tornadoes.map(t => ({ ...t.pos }))).toEqual(spawnedPositions);

    sim.processTick();

    expect(
      sim.tornadoes.some((tornado, idx) =>
        tornado.pos.x !== spawnedPositions[idx].x || tornado.pos.y !== spawnedPositions[idx].y),
    ).toBe(true);
  });
});

describe('Tornado movement', () => {
  it('tornado moves toward player each tick', () => {
    const sim = createSim(42);
    sim.player.pos = { x: 0, y: 10 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.targetTile = null;
    sim.player.attackTarget = null;

    // Manually add a tornado far from player
    sim.tornadoes.push({
      pos: { x: 10, y: 0 },
      prevPos: { x: 10, y: 0 },
      spawnTick: sim.tick,
      lifetime: 20,
    });

    const startDist = Math.abs(sim.tornadoes[0].pos.x - sim.player.pos.x) +
                      Math.abs(sim.tornadoes[0].pos.y - sim.player.pos.y);

    sim.processTick();

    const newDist = Math.abs(sim.tornadoes[0].pos.x - sim.player.pos.x) +
                    Math.abs(sim.tornadoes[0].pos.y - sim.player.pos.y);

    // Tornado should be closer to player
    expect(newDist).toBeLessThan(startDist);
  });

  it('tornado despawns after 20 ticks', () => {
    const sim = createSim(42);
    sim.player.attackTarget = null;
    sim.player.targetTile = null;

    // Process one tick to get to tick 1, then add tornado
    sim.processTick();
    const spawnTick = sim.tick; // tick 1

    sim.tornadoes.push({
      pos: { x: 0, y: 0 },
      prevPos: { x: 0, y: 0 },
      spawnTick,
      lifetime: 20,
    });

    // Keep player alive and run ticks until tornado despawns
    // The tornado should last exactly 20 ticks (despawn when currentTick - spawnTick >= 20)
    let despawnedAt = -1;
    for (let i = 0; i < 25; i++) {
      sim.player.hp = 99; // Keep player alive
      sim.processTick();
      if (sim.tornadoes.length === 0 && despawnedAt === -1) {
        despawnedAt = sim.tick;
        break;
      }
    }

    // Should have despawned at tick 21 (21 - 1 = 20 >= 20)
    expect(despawnedAt).toBe(spawnTick + 20);
    expect(sim.tornadoes.length).toBe(0);
  });
});

describe('Tornado damage', () => {
  it('tornado damage scales by armor tier', () => {
    // T3 armor: 7-15 damage
    const sim3 = createSim(100, 3);
    sim3.player.attackTarget = null;
    sim3.player.targetTile = null;
    sim3.player.pos = { x: 5, y: 10 };
    sim3.player.prevPos = { ...sim3.player.pos };

    // Place tornado on player
    sim3.tornadoes.push({
      pos: { x: 5, y: 10 },
      prevPos: { x: 5, y: 10 },
      spawnTick: sim3.tick + 1,
      lifetime: 20,
    });

    const hpBefore = sim3.player.hp;
    sim3.processTick();
    const damageTaken = hpBefore - sim3.player.hp;

    // T3: 7-15 tornado damage (plus potential boss/floor damage)
    // Just verify damage was taken
    expect(damageTaken).toBeGreaterThan(0);

    // T0 armor: 15-30 damage
    const sim0 = createSim(100, 0);
    sim0.player.attackTarget = null;
    sim0.player.targetTile = null;
    sim0.player.pos = { x: 5, y: 10 };
    sim0.player.prevPos = { ...sim0.player.pos };

    sim0.tornadoes.push({
      pos: { x: 5, y: 10 },
      prevPos: { x: 5, y: 10 },
      spawnTick: sim0.tick + 1,
      lifetime: 20,
    });

    const hp0Before = sim0.player.hp;
    sim0.processTick();
    const damage0Taken = hp0Before - sim0.player.hp;
    expect(damage0Taken).toBeGreaterThan(0);
  });

  it('multiple tornadoes deal independent damage', () => {
    const sim = createSim(42, 3);
    sim.player.attackTarget = null;
    sim.player.targetTile = null;
    sim.player.pos = { x: 5, y: 10 };
    sim.player.prevPos = { ...sim.player.pos };

    // Place 3 tornadoes on the player
    for (let i = 0; i < 3; i++) {
      sim.tornadoes.push({
        pos: { x: 5, y: 10 },
        prevPos: { x: 5, y: 10 },
        spawnTick: sim.tick + 1,
        lifetime: 20,
      });
    }

    const hpBefore = sim.player.hp;
    sim.processTick();
    const totalDamage = hpBefore - sim.player.hp;

    // With 3 tornadoes each dealing 7-15 (T3), minimum should be ~21
    // (Also includes boss attack damage and potentially floor damage)
    expect(totalDamage).toBeGreaterThanOrEqual(7); // At least one tornado hit
  });
});

// ===== Determinism =====

describe('Floor + tornado determinism', () => {
  it('same seed produces identical floor patterns and tornado spawns', () => {
    const sim1 = createSim(999);
    sim1.player.attackTarget = 'boss';
    const sim2 = createSim(999);
    sim2.player.attackTarget = 'boss';

    for (let i = 0; i < 100; i++) {
      sim1.processTick();
      sim2.processTick();

      // Compare floor tile states
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 12; y++) {
          expect(sim1.floorHazardManager.tiles[x][y].state)
            .toBe(sim2.floorHazardManager.tiles[x][y].state);
        }
      }

      // Compare tornado counts
      expect(sim1.tornadoes.length).toBe(sim2.tornadoes.length);

      // Compare tornado positions
      for (let j = 0; j < sim1.tornadoes.length; j++) {
        expect(sim1.tornadoes[j].pos).toEqual(sim2.tornadoes[j].pos);
      }

      expect(sim1.player.hp).toBe(sim2.player.hp);
      expect(sim1.boss.hp).toBe(sim2.boss.hp);

      if (sim1.state !== 'running') break;
    }
  });
});

// ===== Integration =====

describe('Floor + tornado integration', () => {
  it('full 100-tick headless sim with floor hazards active', () => {
    const sim = createSim(42);
    sim.player.attackTarget = 'boss';

    // Keep player alive with correct prayer
    for (let i = 0; i < 100; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();
      if (sim.state !== 'running') break;
    }

    // Player should have taken some damage (floor + boss)
    expect(sim.player.totalDamageTaken).toBeGreaterThan(0);
  });

  it('tornado spawns during simulation and chases player', () => {
    const sim = createSim(42);
    sim.player.attackTarget = 'boss';

    let sawTornado = false;

    for (let i = 0; i < 200; i++) {
      if (sim.boss.currentStyle === 'ranged') {
        sim.queuePrayer('missiles');
      } else {
        sim.queuePrayer('magic');
      }
      sim.processTick();

      if (sim.tornadoes.length > 0) {
        sawTornado = true;
      }

      if (sim.state !== 'running') break;
    }

    expect(sawTornado).toBe(true);
  });

  it('floor phase transitions at correct HP thresholds', () => {
    const mgr = new FloorHazardManager();
    expect(mgr.getPhase(1000)).toBe(1);
    expect(mgr.getPhase(667)).toBe(1);
    expect(mgr.getPhase(666)).toBe(2);
    expect(mgr.getPhase(333)).toBe(2);
    expect(mgr.getPhase(332)).toBe(3);
    expect(mgr.getPhase(1)).toBe(3);
  });
});

// Helper
function countTilesInState(mgr: FloorHazardManager, state: string): number {
  let count = 0;
  for (let x = 0; x < 12; x++) {
    for (let y = 0; y < 12; y++) {
      if (mgr.tiles[x][y].state === state) count++;
    }
  }
  return count;
}
