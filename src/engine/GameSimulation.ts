import { Player } from '../entities/Player.ts';
import { Boss } from '../entities/Boss.ts';
import type { BossAttackResult } from '../entities/Boss.ts';
import { Arena } from '../world/Arena.ts';
import { Rng } from './Rng.ts';
import { PrayerManager } from '../combat/PrayerManager.ts';
import type { PrayerType, OffensivePrayer } from '../combat/PrayerManager.ts';
import { findNextStep } from '../world/Pathfinding.ts';
import {
  meleeMaxHit, meleeAttackRoll,
  rangedMaxHit, rangedAttackRoll,
  magicMaxHit, magicAttackRoll,
  hitChance, npcDefenceRoll,
} from '../combat/formulas.ts';
import { PROTECTED_MAX_HIT, UNPROTECTED_MAX_HIT, STOMP_MAX_HIT, TORNADO_DAMAGE, WEAPONS } from '../equipment/items.ts';
import type { Loadout } from '../equipment/Loadout.ts';
import type { HitSplat, AttackStyle, Position, ProtectionStyle, Tornado } from '../entities/types.ts';
import type { InventoryAction } from '../entities/Inventory.ts';
import { ITEM_SPRITES } from '../render/assets.ts';
import type { Projectile } from '../entities/Projectile.ts';
import { rangedHitDelay, magicHitDelay, meleeHitDelay } from '../entities/Projectile.ts';
import { FloorHazardManager } from '../world/FloorHazardManager.ts';
import { createTornado, isTornadoExpired } from '../entities/Tornado.ts';

export type GameState = 'countdown' | 'running' | 'won' | 'lost';

export interface GameSimulationOptions {
  skipCountdown?: boolean;
}

const TILE_SIZE = 48;

export class GameSimulation {
  player: Player;
  boss: Boss;
  arena: Arena;
  rng: Rng;
  prayerManager: PrayerManager;
  floorHazardManager: FloorHazardManager;
  tornadoes: Tornado[] = [];

  tick: number = 0;
  state: GameState;
  countdownTicks: number = 10;

  hitSplats: HitSplat[] = [];
  projectiles: Projectile[] = [];
  lastBossAttackStyle: AttackStyle | null = null;

  // Input queues
  private queuedMove: Position | null = null;
  private queuedPrayer: PrayerType | undefined = undefined;
  private queuedOffensivePrayer: OffensivePrayer | undefined = undefined;
  private queuedAttackTarget: 'boss' | null | undefined = undefined;
  private queuedInventoryActions: InventoryAction[] = [];
  /** Whether the player consumed a regular food this tick (costs action) */
  playerAteThisTick: boolean = false;

  constructor(loadout: Loadout, seed: number = 42, options?: GameSimulationOptions) {
    this.arena = new Arena();
    this.rng = new Rng(seed);
    this.prayerManager = new PrayerManager();
    this.floorHazardManager = new FloorHazardManager();
    this.player = new Player(loadout, this.arena.playerSpawn);
    this.boss = new Boss(this.arena.bossSpawn);
    // Initialize boss protection prayer from seeded RNG
    this.boss.initProtection(() => this.rng.next());

    // Skip countdown for tests or start in countdown
    if (options?.skipCountdown) {
      this.state = 'running';
      this.countdownTicks = 0;
    } else {
      this.state = 'countdown';
    }
  }

  /** Queue a move command */
  queueMove(target: Position): void {
    this.queuedMove = target;
  }

  /** Queue a protection prayer switch */
  queuePrayer(prayer: PrayerType): void {
    this.queuedPrayer = prayer;
  }

  /** Queue an offensive prayer switch */
  queueOffensivePrayer(prayer: OffensivePrayer): void {
    this.queuedOffensivePrayer = prayer;
  }

  /** Queue an attack target */
  queueAttackTarget(target: 'boss' | null): void {
    this.queuedAttackTarget = target;
  }

  /** Queue an inventory item use */
  useInventoryItem(index: number): void {
    const action = this.player.inventory.useItem(index);
    if (action) {
      this.queuedInventoryActions.push(action);
    }
  }

  /** Convert tile position to pixel center */
  private tileToPx(pos: Position): { px: number; py: number } {
    return {
      px: pos.x * TILE_SIZE + TILE_SIZE / 2,
      py: pos.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  /** Convert boss center to pixel center */
  private bossCenterPx(): { px: number; py: number } {
    const c = this.boss.center;
    return {
      px: c.x * TILE_SIZE + TILE_SIZE / 2,
      py: c.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  /**
   * Resolve arriving projectiles: apply damage + create hit splats.
   * Called as step 4 in tick processing (before new attacks fire).
   */
  private resolveProjectiles(): void {
    for (const proj of this.projectiles) {
      if (proj.arrivalTick !== this.tick) continue;

      if (proj.source === 'boss') {
        // Boss projectile hits player
        if (this.player.hp <= 0) continue; // target already dead
        this.player.hp = Math.max(0, this.player.hp - proj.damage);
        this.player.totalDamageTaken += proj.damage;
        this.boss.totalDamageDealt += proj.damage;
        if (proj.damage > 0) {
          this.hitSplats.push({
            damage: proj.damage,
            x: this.player.pos.x,
            y: this.player.pos.y,
            tickCreated: this.tick,
          });
        }
      } else {
        // Player projectile hits boss
        if (this.boss.hp <= 0) continue; // target already dead
        if (!proj.blocked) {
          this.boss.hp = Math.max(0, this.boss.hp - proj.damage);
          this.player.totalDamageDealt += proj.damage;
          if (proj.damage > 0) {
            this.hitSplats.push({
              damage: proj.damage,
              x: this.boss.center.x,
              y: this.boss.center.y,
              tickCreated: this.tick,
            });
          } else {
            // Miss (0 damage, not blocked)
            this.hitSplats.push({
              damage: 0,
              x: this.boss.center.x,
              y: this.boss.center.y,
              tickCreated: this.tick,
            });
          }
        } else {
          // Blocked by boss protection
          this.hitSplats.push({
            damage: 0,
            x: this.boss.center.x,
            y: this.boss.center.y,
            tickCreated: this.tick,
          });
        }
      }
    }
  }

  /** Process a single game tick */
  processTick(): void {
    if (this.state === 'won' || this.state === 'lost') return;

    this.tick++;

    // 1. Process queued inputs (always, even during countdown)
    // Attack target queue
    if (this.queuedAttackTarget !== undefined) {
      this.player.attackTarget = this.queuedAttackTarget;
      this.queuedAttackTarget = undefined;
      // Setting attack target clears move queue
      if (this.player.attackTarget === 'boss') {
        this.queuedMove = null;
      }
    }

    if (this.queuedMove !== null) {
      this.player.targetTile = this.queuedMove;
      this.player.attackTarget = null; // Ground click clears attack target
      this.queuedMove = null;
    }

    if (this.queuedPrayer !== undefined) {
      this.prayerManager.queueSwitch(this.queuedPrayer);
      this.queuedPrayer = undefined;
    }
    if (this.queuedOffensivePrayer !== undefined) {
      this.prayerManager.queueOffensiveSwitch(this.queuedOffensivePrayer);
      this.queuedOffensivePrayer = undefined;
    }

    // Apply queued prayers
    this.prayerManager.applyQueued();
    this.prayerManager.applyQueuedOffensive();

    // 1b. Process queued inventory actions
    this.playerAteThisTick = false;
    for (const action of this.queuedInventoryActions) {
      this.processInventoryAction(action);
    }
    this.queuedInventoryActions = [];

    // 2. Drain prayer (always, even during countdown)
    const drain = this.prayerManager.drain(
      this.player.loadout.totalPrayerBonus,
      this.player.prayerPoints,
    );
    this.player.prayerPoints = Math.max(0, this.player.prayerPoints - drain);
    if (this.player.prayerPoints <= 0) {
      this.prayerManager.deactivate();
    }

    // 3. Player movement (always, even during countdown)
    // Save previous position for interpolation (before any movement)
    this.player.prevPos = { ...this.player.pos };

    // Auto-walk toward boss when target set and out of range
    if (this.player.attackTarget === 'boss' && !this.player.targetTile) {
      const weapon = this.player.loadout.weapon;
      const dist = this.boss.chebyshevDistTo(this.player.pos);
      if (dist > weapon.range) {
        // Walk toward boss center
        this.player.targetTile = this.boss.center;
      }
    }

    if (this.player.targetTile) {
      // Step 1
      const step1 = findNextStep(
        this.player.pos,
        this.player.targetTile,
        this.arena,
        this.boss,
      );
      this.player.pos = step1;
      if (step1.x === this.player.targetTile.x && step1.y === this.player.targetTile.y) {
        this.player.targetTile = null;
      } else {
        // Check if auto-walk reached range after step 1
        if (this.player.attackTarget === 'boss') {
          const weapon = this.player.loadout.weapon;
          const dist = this.boss.chebyshevDistTo(this.player.pos);
          if (dist <= weapon.range) {
            this.player.targetTile = null;
          }
        }
        // Step 2 (only if still have a target after step 1)
        if (this.player.targetTile) {
          const step2 = findNextStep(
            this.player.pos,
            this.player.targetTile,
            this.arena,
            this.boss,
          );
          this.player.pos = step2;
          if (step2.x === this.player.targetTile.x && step2.y === this.player.targetTile.y) {
            this.player.targetTile = null;
          }
          // If we were auto-walking toward boss and now in range, clear targetTile
          if (this.player.attackTarget === 'boss') {
            const weapon = this.player.loadout.weapon;
            const dist = this.boss.chebyshevDistTo(this.player.pos);
            if (dist <= weapon.range) {
              this.player.targetTile = null;
            }
          }
        }
      }
    }

    // --- Countdown phase: skip combat, stomp, and death ---
    if (this.state === 'countdown') {
      this.countdownTicks--;
      if (this.countdownTicks <= 0) {
        this.state = 'running';
      }
      // Clean up old hit splats
      this.hitSplats = this.hitSplats.filter(s => this.tick - s.tickCreated < 2);
      return;
    }

    // --- Running state: full combat ---

    // 4a. Floor tile tick (advance tile states)
    this.floorHazardManager.tick(this.boss.hp, this.tick, this.rng);

    // 4b. Floor tile damage (player on hazard tile → 10-20 typeless damage)
    {
      const px = this.player.pos.x;
      const py = this.player.pos.y;
      if (px >= 0 && px < 12 && py >= 0 && py < 12) {
        const tile = this.floorHazardManager.tiles[px][py];
        if (tile.state === 'hazard') {
          const floorDmg = this.rng.nextInt(10, 20);
          this.player.hp = Math.max(0, this.player.hp - floorDmg);
          this.player.totalDamageTaken += floorDmg;
          if (floorDmg > 0) {
            this.hitSplats.push({
              damage: floorDmg,
              x: this.player.pos.x,
              y: this.player.pos.y,
              tickCreated: this.tick,
            });
          }
        }
      }
    }

    // 4c. Resolve arriving projectiles (damage arrives)
    this.resolveProjectiles();

    // 5. Boss AI: fire attack -> create projectile
    this.boss.attackCooldown--;
    let bossAttackedThisTick = false;
    let bossAttackResult: BossAttackResult | null = null;
    if (this.boss.attackCooldown <= 0) {
      bossAttackResult = this.boss.fireAttack();
      bossAttackedThisTick = true;
      if (bossAttackResult !== 'tornado') {
        this.lastBossAttackStyle = bossAttackResult;
      }
    }

    // Handle tornado spawn
    if (bossAttackedThisTick && bossAttackResult === 'tornado') {
      this.spawnTornadoes();
    }

    const bossAttackStyle: AttackStyle | null =
      (bossAttackedThisTick && bossAttackResult !== null && bossAttackResult !== 'tornado')
        ? bossAttackResult as AttackStyle
        : null;

    if (bossAttackedThisTick && bossAttackStyle !== null) {
      const correctPrayer =
        (bossAttackStyle === 'magic' && this.prayerManager.activePrayer === 'magic') ||
        (bossAttackStyle === 'ranged' && this.prayerManager.activePrayer === 'missiles');

      let damage: number;
      if (correctPrayer) {
        const maxHit = PROTECTED_MAX_HIT[this.player.loadout.armor.tier];
        damage = this.rng.nextInt(0, maxHit);
      } else {
        damage = this.rng.nextInt(0, UNPROTECTED_MAX_HIT);
      }

      // Calculate distance and travel time
      const dist = this.boss.chebyshevDistTo(this.player.pos);
      const delay = bossAttackStyle === 'ranged'
        ? rangedHitDelay(dist)
        : magicHitDelay(dist);

      const bossPx = this.bossCenterPx();
      const playerPx = this.tileToPx(this.player.pos);

      const proj: Projectile = {
        source: 'boss',
        style: bossAttackStyle,
        startX: bossPx.px,
        startY: bossPx.py,
        endX: playerPx.px,
        endY: playerPx.py,
        fireTick: this.tick,
        arrivalTick: this.tick + delay,
        damage,
        blocked: false,
        color: bossAttackStyle === 'ranged' ? '#44cc44' : '#aa44cc',
        shape: bossAttackStyle === 'ranged' ? 'spike' : 'orb',
      };
      this.projectiles.push(proj);
    }

    // 6. Player attack resolution — only when target is set
    if (this.player.attackCooldown > 0) {
      this.player.attackCooldown--;
    }
    // OSRS eat delay: standard food delays the next attack by 3 ticks.
    // Applied after decrement so the eat tick does not consume a delay tick.
    if (this.playerAteThisTick) {
      this.player.attackCooldown = Math.max(this.player.attackCooldown, 3);
    }
    if (this.player.attackTarget === 'boss' && this.player.attackCooldown <= 0 && !this.playerAteThisTick) {
      const weapon = this.player.loadout.weapon;
      const dist = this.boss.chebyshevDistTo(this.player.pos);
      if (dist <= weapon.range) {
        const playerStyle = this.weaponToProtectionStyle(weapon.type);
        const blocked = this.boss.processPlayerHit(playerStyle);

        let damage = 0;
        if (!blocked) {
          const playerAttackRoll = this.getPlayerAttackRoll();
          const bossDefRoll = npcDefenceRoll(this.boss.stats.defence, this.boss.defBonus);
          const accuracy = hitChance(playerAttackRoll, bossDefRoll);

          if (this.rng.next() < accuracy) {
            const maxHit = this.getPlayerMaxHit();
            damage = this.rng.nextInt(0, maxHit);
          }
        }

        // Calculate travel time
        let delay: number;
        let shape: Projectile['shape'];
        let color: string;
        if (weapon.type === 'halberd') {
          delay = meleeHitDelay();
          shape = 'slash';
          color = '#ffffff';
        } else if (weapon.type === 'bow') {
          delay = rangedHitDelay(dist);
          shape = 'arrow';
          color = '#44cc44';
        } else {
          delay = magicHitDelay(dist);
          shape = 'blast';
          color = '#44ccff';
        }

        const playerPx = this.tileToPx(this.player.pos);
        const bossPx = this.bossCenterPx();

        const projStyle: Projectile['style'] = weapon.type === 'halberd' ? 'melee'
          : weapon.type === 'bow' ? 'ranged' : 'magic';

        const proj: Projectile = {
          source: 'player',
          style: projStyle,
          startX: playerPx.px,
          startY: playerPx.py,
          endX: bossPx.px,
          endY: bossPx.py,
          fireTick: this.tick,
          arrivalTick: this.tick + delay,
          damage,
          blocked,
          color,
          shape,
        };
        this.projectiles.push(proj);

        // For melee (0 delay), resolve immediately since arrivalTick === fireTick
        // and resolveProjectiles already ran for this tick. We handle it inline.
        if (delay === 0) {
          if (this.boss.hp > 0) {
            if (!blocked) {
              this.boss.hp = Math.max(0, this.boss.hp - damage);
              this.player.totalDamageDealt += damage;
              if (damage > 0) {
                this.hitSplats.push({
                  damage,
                  x: this.boss.center.x,
                  y: this.boss.center.y,
                  tickCreated: this.tick,
                });
              } else {
                this.hitSplats.push({
                  damage: 0,
                  x: this.boss.center.x,
                  y: this.boss.center.y,
                  tickCreated: this.tick,
                });
              }
            } else {
              this.hitSplats.push({
                damage: 0,
                x: this.boss.center.x,
                y: this.boss.center.y,
                tickCreated: this.tick,
              });
            }
          }
          // Mark it as already resolved by setting arrivalTick to past
          proj.arrivalTick = this.tick - 1;
        }

        this.player.attackCooldown = weapon.attackSpeed;
      }
    }

    // 7a. Tornado movement (each tornado steps 1 tile toward player)
    for (const tornado of this.tornadoes) {
      tornado.prevPos = { ...tornado.pos };
      // Tornadoes can overlap boss, so use arena.isInBounds-only pathfinding
      // We pass the boss but tornadoes ignore boss collision in findNextStep
      // Actually per spec: "Tornadoes CAN overlap boss footprint"
      // We need a variant that doesn't block on boss tiles
      const nextStep = this.findTornadoNextStep(tornado.pos, this.player.pos);
      tornado.pos = nextStep;
    }

    // 7b. Tornado damage (player overlapping any tornado → tier-scaled damage)
    {
      const tier = this.player.loadout.armor.tier;
      const dmgRange = TORNADO_DAMAGE[tier];
      for (const tornado of this.tornadoes) {
        if (tornado.pos.x === this.player.pos.x && tornado.pos.y === this.player.pos.y) {
          const tornadoDmg = this.rng.nextInt(dmgRange.min, dmgRange.max);
          this.player.hp = Math.max(0, this.player.hp - tornadoDmg);
          this.player.totalDamageTaken += tornadoDmg;
          if (tornadoDmg > 0) {
            this.hitSplats.push({
              damage: tornadoDmg,
              x: this.player.pos.x,
              y: this.player.pos.y,
              tickCreated: this.tick,
            });
          }
        }
      }
    }

    // 7c. Tornado cleanup (remove despawned tornadoes)
    this.tornadoes = this.tornadoes.filter(t => !isTornadoExpired(t, this.tick));

    // 8. Stomp check
    if (this.boss.occupies(this.player.pos.x, this.player.pos.y)) {
      const stompDmg = this.rng.nextInt(0, STOMP_MAX_HIT);
      this.player.hp = Math.max(0, this.player.hp - stompDmg);
      this.player.totalDamageTaken += stompDmg;
      if (stompDmg > 0) {
        this.hitSplats.push({
          damage: stompDmg,
          x: this.player.pos.x,
          y: this.player.pos.y,
          tickCreated: this.tick,
        });
      }
    }

    // 8. Death checks
    if (this.boss.hp <= 0) {
      this.state = 'won';
    } else if (this.player.hp <= 0) {
      this.state = 'lost';
    }

    // 9. Clean up expired projectiles (past arrivalTick + 1 for rendering buffer)
    this.projectiles = this.projectiles.filter(p => p.arrivalTick >= this.tick - 1);

    // Clean up old hit splats (older than 2 ticks)
    this.hitSplats = this.hitSplats.filter(s => this.tick - s.tickCreated < 2);
  }

  /** Run multiple ticks headlessly (for testing) */
  runTicks(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.state === 'won' || this.state === 'lost') break;
      this.processTick();
    }
  }

  /** Skip countdown immediately (convenience for tests) */
  skipCountdown(): void {
    if (this.state === 'countdown') {
      this.state = 'running';
      this.countdownTicks = 0;
    }
  }

  private processInventoryAction(action: InventoryAction): void {
    const player = this.player;
    const inv = player.inventory;

    switch (action.type) {
      case 'eat': {
        if (player.hp >= player.maxHp) return;
        const heal = Math.min(action.healAmount, player.maxHp - player.hp);
        player.hp += heal;
        inv.removeItem(action.slotIndex);
        if (!action.comboFood) {
          this.playerAteThisTick = true;
        }
        break;
      }
      case 'drink': {
        const restore = Math.floor(player.stats.prayer / 4) + 7;
        player.prayerPoints = Math.min(player.maxPrayerPoints, player.prayerPoints + restore);
        inv.decrementDose(action.slotIndex);
        break;
      }
      case 'equip': {
        const oldType = player.loadout.config.weaponType;
        const oldTier = player.loadout.config.weaponTier;
        const oldWeapon = WEAPONS[oldType][oldTier];
        player.loadout.switchWeapon(action.weaponType, action.weaponTier);
        player.loadout.config.weaponType = action.weaponType;
        player.loadout.config.weaponTier = action.weaponTier;
        const slotItem = inv.slots[action.slotIndex];
        if (slotItem) {
          slotItem.id = `${oldType}_${oldTier}`;
          slotItem.name = oldWeapon.name;
          slotItem.category = 'weapon';
          const spriteKey = `${oldType}_${oldTier}` as keyof typeof ITEM_SPRITES;
          slotItem.spriteUrl = ITEM_SPRITES[spriteKey] ?? '';
        }
        break;
      }
    }
  }

  private weaponToProtectionStyle(type: 'bow' | 'staff' | 'halberd'): ProtectionStyle {
    switch (type) {
      case 'bow': return 'ranged';
      case 'staff': return 'magic';
      case 'halberd': return 'melee';
    }
  }

  private getPlayerAttackRoll(): number {
    const weapon = this.player.loadout.weapon;
    const stats = this.player.stats;
    const prayerDef = this.prayerManager.getActiveOffensiveDef();

    // Only apply accuracy mult if prayer combat style matches weapon style
    const weaponStyle = this.weaponToProtectionStyle(weapon.type);
    const prayerMatches = prayerDef !== null && prayerDef.combatStyle === weaponStyle;
    const accuracyMult = prayerMatches ? prayerDef!.accuracyMult : 1.0;

    switch (weapon.type) {
      case 'bow':
        return rangedAttackRoll(stats.ranged, weapon.attackBonus, accuracyMult, 0);
      case 'staff':
        return magicAttackRoll(stats.magic, weapon.attackBonus, accuracyMult);
      case 'halberd':
        return meleeAttackRoll(stats.attack, weapon.attackBonus, accuracyMult, 0);
    }
  }

  private getPlayerMaxHit(): number {
    const weapon = this.player.loadout.weapon;
    const stats = this.player.stats;
    const prayerDef = this.prayerManager.getActiveOffensiveDef();

    const weaponStyle = this.weaponToProtectionStyle(weapon.type);
    const prayerMatches = prayerDef !== null && prayerDef.combatStyle === weaponStyle;

    switch (weapon.type) {
      case 'bow': {
        const damageMult = prayerMatches ? prayerDef!.damageMult : 1.0;
        return rangedMaxHit(stats.ranged, weapon.strengthBonus, damageMult);
      }
      case 'staff': {
        const hasAuguryBonus = prayerMatches && (prayerDef!.magicMaxHitBonus > 0);
        return magicMaxHit(weapon.tier as 1 | 2 | 3, hasAuguryBonus);
      }
      case 'halberd': {
        const damageMult = prayerMatches ? prayerDef!.damageMult : 1.0;
        return meleeMaxHit(stats.strength, weapon.strengthBonus, damageMult, 0);
      }
    }
  }

  /** Spawn tornadoes near boss when fireAttack returns 'tornado' */
  private spawnTornadoes(): void {
    const phase = this.floorHazardManager.getPhase(this.boss.hp);
    let count: number;
    switch (phase) {
      case 1: count = 2; break;
      case 2: count = 3; break;
      case 3: count = 4; break;
      default: count = 2;
    }

    // Find walkable tiles within 2 tiles of boss footprint edge
    const candidates: Position[] = [];
    const boss = this.boss;
    for (let x = boss.pos.x - 2; x <= boss.pos.x + boss.size + 1; x++) {
      for (let y = boss.pos.y - 2; y <= boss.pos.y + boss.size + 1; y++) {
        if (!this.arena.isInBounds(x, y)) continue;
        if (boss.occupies(x, y)) continue;
        candidates.push({ x, y });
      }
    }

    if (candidates.length === 0) return;

    for (let i = 0; i < count; i++) {
      const idx = this.rng.nextInt(0, candidates.length - 1);
      const pos = candidates[idx];
      this.tornadoes.push(createTornado(pos, this.tick));
    }
  }

  /**
   * BFS pathfinding for tornadoes. Like findNextStep but tornadoes CAN overlap boss.
   */
  private findTornadoNextStep(from: Position, to: Position): Position {
    if (from.x === to.x && from.y === to.y) return from;

    const visited = new Set<string>();
    const queue: { x: number; y: number; parent: { x: number; y: number; parent: unknown } | null }[] = [];
    visited.add(`${from.x},${from.y}`);
    queue.push({ x: from.x, y: from.y, parent: null });

    const DIRS = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
    ];

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      if (current.x === to.x && current.y === to.y) {
        let node = current;
        while (node.parent && node.parent.parent !== null) {
          node = node.parent as typeof current;
        }
        return { x: node.x, y: node.y };
      }

      for (const dir of DIRS) {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (!this.arena.isInBounds(nx, ny)) continue;

        // Prevent diagonal corner-cutting through out-of-bounds tiles
        if (dir.dx !== 0 && dir.dy !== 0) {
          if (!this.arena.isInBounds(current.x + dir.dx, current.y) ||
              !this.arena.isInBounds(current.x, current.y + dir.dy)) {
            continue;
          }
        }

        visited.add(key);
        queue.push({ x: nx, y: ny, parent: current });
      }
    }
    return from;
  }
}
