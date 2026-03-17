import type { TileInfo } from '../entities/types.ts';
import type { Rng } from '../engine/Rng.ts';

export interface FloorPattern {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FLOOR_PATTERNS: FloorPattern[][] = [
  // Pattern 0: Center block 6x6
  [{ x: 3, y: 3, w: 6, h: 6 }],

  // Pattern 1: Four corner blocks 4x4
  [
    { x: 0, y: 0, w: 4, h: 4 },
    { x: 0, y: 8, w: 4, h: 4 },
    { x: 8, y: 0, w: 4, h: 4 },
    { x: 8, y: 8, w: 4, h: 4 },
  ],

  // Pattern 2: Offset corners 4x4
  [
    { x: 1, y: 1, w: 4, h: 4 },
    { x: 1, y: 7, w: 4, h: 4 },
    { x: 7, y: 1, w: 4, h: 4 },
    { x: 7, y: 7, w: 4, h: 4 },
  ],

  // Pattern 3: Border ring (2-tile wide border)
  [
    { x: 0, y: 0, w: 12, h: 2 },
    { x: 0, y: 10, w: 12, h: 2 },
    { x: 0, y: 2, w: 2, h: 8 },
    { x: 10, y: 2, w: 2, h: 8 },
  ],

  // Pattern 4: Corner 3x3 blocks + center 4x4
  [
    { x: 0, y: 0, w: 3, h: 3 },
    { x: 0, y: 9, w: 3, h: 3 },
    { x: 9, y: 0, w: 3, h: 3 },
    { x: 9, y: 9, w: 3, h: 3 },
    { x: 4, y: 4, w: 4, h: 4 },
  ],
];

// Phase 3 permanent safe tiles (a few tiles that never activate)
// Small safe zone near center
const PHASE3_SAFE_TILES: { x: number; y: number }[] = [
  { x: 5, y: 5 },
  { x: 6, y: 5 },
  { x: 5, y: 6 },
  { x: 6, y: 6 },
];

export class FloorHazardManager {
  tiles: TileInfo[][];
  private previousPattern: number = -1;
  private cycleStartTick: number = -1;
  private cycleState: 'idle' | 'warning' | 'hazard' = 'idle';
  private phase3Activated: boolean = false;

  constructor() {
    this.tiles = [];
    for (let x = 0; x < 12; x++) {
      this.tiles[x] = [];
      for (let y = 0; y < 12; y++) {
        this.tiles[x][y] = { state: 'safe', tickChanged: 0, permanent: false };
      }
    }
  }

  getPhase(bossHp: number): number {
    if (bossHp >= 667) return 1;
    if (bossHp >= 333) return 2;
    return 3;
  }

  getWarningTicks(phase: number): number {
    switch (phase) {
      case 1: return 6;
      case 2: return 4;
      case 3: return 3;
      default: return 6;
    }
  }

  getHazardTicks(): number {
    return 6;
  }

  getCycleDuration(phase: number): number {
    return this.getWarningTicks(phase) + this.getHazardTicks();
  }

  tick(bossHp: number, currentTick: number, rng: Rng): void {
    const phase = this.getPhase(bossHp);

    // Activate Phase 3 permanent safe tiles
    if (phase === 3 && !this.phase3Activated) {
      this.phase3Activated = true;
      for (const tile of PHASE3_SAFE_TILES) {
        this.tiles[tile.x][tile.y].permanent = true;
        this.tiles[tile.x][tile.y].state = 'safe';
      }
    }

    const warningTicks = this.getWarningTicks(phase);
    const hazardTicks = this.getHazardTicks();

    // Start first cycle
    if (this.cycleState === 'idle') {
      this.startNewCycle(currentTick, rng);
      return;
    }

    const elapsed = currentTick - this.cycleStartTick;

    if (this.cycleState === 'warning' && elapsed >= warningTicks) {
      // Transition to hazard
      this.transitionToHazard(currentTick);
    } else if (this.cycleState === 'hazard' && elapsed >= warningTicks + hazardTicks) {
      // Clear hazard and start new cycle
      this.clearHazard(currentTick);
      this.startNewCycle(currentTick, rng);
    }
  }

  private startNewCycle(currentTick: number, rng: Rng): void {
    // Select random pattern, never same as previous
    let patternIndex: number;
    do {
      patternIndex = rng.nextInt(0, FLOOR_PATTERNS.length - 1);
    } while (patternIndex === this.previousPattern);

    this.previousPattern = patternIndex;
    this.cycleStartTick = currentTick;
    this.cycleState = 'warning';
    this.activatePattern(patternIndex, currentTick);
  }

  private activatePattern(patternIndex: number, currentTick: number): void {
    const pattern = FLOOR_PATTERNS[patternIndex];
    for (const rect of pattern) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          if (x >= 0 && x < 12 && y >= 0 && y < 12) {
            const tile = this.tiles[x][y];
            if (tile.permanent) continue; // Phase 3 safe tiles never activate
            tile.state = 'warning';
            tile.tickChanged = currentTick;
          }
        }
      }
    }
  }

  private transitionToHazard(currentTick: number): void {
    this.cycleState = 'hazard';
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        const tile = this.tiles[x][y];
        if (tile.state === 'warning') {
          tile.state = 'hazard';
          tile.tickChanged = currentTick;
        }
      }
    }
  }

  private clearHazard(currentTick: number): void {
    this.cycleState = 'idle';
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        const tile = this.tiles[x][y];
        if (tile.state === 'hazard') {
          tile.state = 'safe';
          tile.tickChanged = currentTick;
        }
      }
    }
  }

  /** Reset to initial state */
  reset(): void {
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        this.tiles[x][y] = { state: 'safe', tickChanged: 0, permanent: false };
      }
    }
    this.previousPattern = -1;
    this.cycleStartTick = -1;
    this.cycleState = 'idle';
    this.phase3Activated = false;
  }
}
