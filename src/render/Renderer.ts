import type { GameSimulation } from '../engine/GameSimulation.ts';
import type { Projectile } from '../entities/Projectile.ts';
import { OVERHEAD_ICONS } from './assets.ts';

const TILE_SIZE = 48;
const GRID_SIZE = 12;
const CANVAS_SIZE = TILE_SIZE * GRID_SIZE; // 576

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private overheadMagic = new Image();
  private overheadMissiles = new Image();
  private overheadMelee = new Image();
  private fightTextTick: number = 0; // tick when "FIGHT!" should show

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;

    // Preload overhead images
    this.overheadMagic.src = OVERHEAD_ICONS.magic;
    this.overheadMissiles.src = OVERHEAD_ICONS.missiles;
    this.overheadMelee.src = OVERHEAD_ICONS.melee;
  }

  draw(sim: GameSimulation, tickProgress: number = 0): void {
    const ctx = this.ctx;

    // Background
    ctx.fillStyle = '#1a0a0a';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Grid
    ctx.strokeStyle = '#3a1a1a';
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_SIZE; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, 0);
      ctx.lineTo(x * TILE_SIZE, CANVAS_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_SIZE; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE_SIZE);
      ctx.lineTo(CANVAS_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }

    // Boss 5x5
    const boss = sim.boss;
    ctx.fillStyle = '#cc4422';
    ctx.fillRect(
      boss.pos.x * TILE_SIZE + 1,
      boss.pos.y * TILE_SIZE + 1,
      boss.size * TILE_SIZE - 2,
      boss.size * TILE_SIZE - 2,
    );

    // Boss style-colored border
    const borderColor = boss.currentStyle === 'ranged' ? '#44cc44' : '#aa44cc';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(
      boss.pos.x * TILE_SIZE + 1,
      boss.pos.y * TILE_SIZE + 1,
      boss.size * TILE_SIZE - 2,
      boss.size * TILE_SIZE - 2,
    );

    // Attack target highlight (yellow border on boss when targeted)
    if (sim.player.attackTarget === 'boss') {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(
        boss.pos.x * TILE_SIZE - 1,
        boss.pos.y * TILE_SIZE - 1,
        boss.size * TILE_SIZE + 2,
        boss.size * TILE_SIZE + 2,
      );
      ctx.setLineDash([]);
    }

    // Boss label
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Hunlef`,
      (boss.pos.x + boss.size / 2) * TILE_SIZE,
      (boss.pos.y + boss.size / 2) * TILE_SIZE - 4,
    );
    ctx.fillText(
      `${boss.hp}/${boss.maxHp}`,
      (boss.pos.x + boss.size / 2) * TILE_SIZE,
      (boss.pos.y + boss.size / 2) * TILE_SIZE + 12,
    );

    // Player 1x1 (interpolated between prevPos and pos)
    const player = sim.player;
    const px = lerp(player.prevPos.x, player.pos.x, tickProgress) * TILE_SIZE;
    const py = lerp(player.prevPos.y, player.pos.y, tickProgress) * TILE_SIZE;
    ctx.fillStyle = '#44cccc';
    ctx.fillRect(
      px + 4,
      py + 4,
      TILE_SIZE - 8,
      TILE_SIZE - 8,
    );

    // Target tile indicator
    if (player.targetTile) {
      ctx.strokeStyle = '#88ffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        player.targetTile.x * TILE_SIZE + 2,
        player.targetTile.y * TILE_SIZE + 2,
        TILE_SIZE - 4,
        TILE_SIZE - 4,
      );
      ctx.setLineDash([]);
    }

    // Overhead icons (drawn after entities, before hit splats)
    const OVERHEAD_SIZE = 24;

    // Player overhead: based on active prayer (interpolated with player position)
    const activePrayer = sim.prayerManager.activePrayer;
    if (activePrayer) {
      const img = activePrayer === 'magic' ? this.overheadMagic : this.overheadMissiles;
      if (img.complete && img.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = false;
        const opx = px + TILE_SIZE / 2 - OVERHEAD_SIZE / 2;
        const opy = py - 8 - OVERHEAD_SIZE;
        ctx.drawImage(img, opx, opy, OVERHEAD_SIZE, OVERHEAD_SIZE);
      }
    }

    // Boss overhead: based on protectionStyle
    const bossProtection = boss.protectionStyle;
    let bossOverheadImg: HTMLImageElement | null = null;
    switch (bossProtection) {
      case 'magic': bossOverheadImg = this.overheadMagic; break;
      case 'ranged': bossOverheadImg = this.overheadMissiles; break;
      case 'melee': bossOverheadImg = this.overheadMelee; break;
    }
    if (bossOverheadImg && bossOverheadImg.complete && bossOverheadImg.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = false;
      const bx = (boss.pos.x + boss.size / 2) * TILE_SIZE - OVERHEAD_SIZE / 2;
      const by = boss.pos.y * TILE_SIZE - 8 - OVERHEAD_SIZE;
      ctx.drawImage(bossOverheadImg, bx, by, OVERHEAD_SIZE, OVERHEAD_SIZE);
    }

    // Projectiles (after entities, before hit splats)
    this.drawProjectiles(sim, tickProgress);

    // Hit splats
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.imageSmoothingEnabled = true;
    for (const splat of sim.hitSplats) {
      const age = sim.tick - splat.tickCreated;
      const alpha = 1 - age * 0.3;
      const offsetY = -age * 8;

      ctx.globalAlpha = Math.max(0.2, alpha);

      // Background circle
      const cx = splat.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = splat.y * TILE_SIZE + TILE_SIZE / 2 + offsetY;

      ctx.fillStyle = splat.damage > 0 ? '#cc2222' : '#4444cc';
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(splat.damage), cx, cy + 5);
      ctx.globalAlpha = 1;
    }

    // Countdown overlay
    if (sim.state === 'countdown') {
      // Semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Large countdown number
      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 72px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(sim.countdownTicks), CANVAS_SIZE / 2, CANVAS_SIZE / 2);
      ctx.textBaseline = 'alphabetic';
    }

    // "FIGHT!" text for 2 ticks after countdown ends
    if (sim.state === 'running' && this.fightTextTick === 0 && sim.countdownTicks <= 0 && sim.tick <= 12) {
      this.fightTextTick = sim.tick;
    }
    if (this.fightTextTick > 0 && sim.tick - this.fightTextTick < 2) {
      ctx.fillStyle = '#ff4400';
      ctx.font = 'bold 64px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FIGHT!', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawProjectiles(sim: GameSimulation, tickProgress: number): void {
    const ctx = this.ctx;

    for (const proj of sim.projectiles) {
      const duration = Math.max(1, proj.arrivalTick - proj.fireTick);
      const ticksElapsed = sim.tick - proj.fireTick;
      const progress = Math.min(1, Math.max(0, (ticksElapsed + tickProgress) / duration));
      const x = proj.startX + (proj.endX - proj.startX) * progress;
      const y = proj.startY + (proj.endY - proj.startY) * progress;
      const angle = Math.atan2(proj.endY - proj.startY, proj.endX - proj.startX);

      ctx.save();
      switch (proj.shape) {
        case 'spike':
          this.drawSpike(ctx, x, y, angle, proj);
          break;
        case 'orb':
          this.drawOrb(ctx, x, y, proj);
          break;
        case 'arrow':
          this.drawArrow(ctx, x, y, angle, proj);
          break;
        case 'blast':
          this.drawBlast(ctx, x, y, proj);
          break;
        case 'slash':
          this.drawSlash(ctx, proj.endX, proj.endY, angle, proj);
          break;
      }
      ctx.restore();
    }
  }

  /** Boss ranged: green diamond polygon ~12px, rotated toward travel direction */
  private drawSpike(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, _proj: Projectile): void {
    const size = 6;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#44cc44';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.lineTo(0, -size);
    ctx.closePath();
    ctx.fill();
  }

  /** Boss magic: purple filled circle ~10px with outer glow */
  private drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, _proj: Projectile): void {
    // Outer glow
    ctx.fillStyle = 'rgba(170, 68, 204, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    // Inner orb
    ctx.fillStyle = '#aa44cc';
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Player ranged: green line with triangular arrowhead ~20px, oriented toward target */
  private drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, _proj: Projectile): void {
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Shaft
    ctx.strokeStyle = '#44cc44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    // Arrowhead
    ctx.fillStyle = '#44cc44';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(4, -4);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fill();
  }

  /** Player magic: cyan filled circle ~8px */
  private drawBlast(ctx: CanvasRenderingContext2D, x: number, y: number, _proj: Projectile): void {
    ctx.fillStyle = '#44ccff';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Player melee: white arc near target position, show for 1 tick only */
  private drawSlash(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, _proj: Projectile): void {
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 16, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }
}
