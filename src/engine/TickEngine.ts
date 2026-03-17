export class TickEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _currentTick = 0;
  private _running = false;
  private onTick: (tick: number) => void;

  constructor(onTick: (tick: number) => void) {
    this.onTick = onTick;
  }

  get currentTick(): number {
    return this._currentTick;
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.intervalId = setInterval(() => {
      this._currentTick++;
      this.onTick(this._currentTick);
    }, 600);
  }

  stop(): void {
    this._running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.stop();
    this._currentTick = 0;
  }
}
