import { describe, it, expect, vi, afterEach } from 'vitest';
import { TickEngine } from '../TickEngine.ts';
import { Rng } from '../Rng.ts';

describe('TickEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments tick on each interval', () => {
    vi.useFakeTimers();
    let lastTick = 0;
    const engine = new TickEngine((tick) => { lastTick = tick; });

    engine.start();
    expect(lastTick).toBe(0);

    vi.advanceTimersByTime(600);
    expect(lastTick).toBe(1);

    vi.advanceTimersByTime(600);
    expect(lastTick).toBe(2);

    vi.advanceTimersByTime(600);
    expect(lastTick).toBe(3);

    engine.stop();
  });

  it('does not tick after stop', () => {
    vi.useFakeTimers();
    let lastTick = 0;
    const engine = new TickEngine((tick) => { lastTick = tick; });

    engine.start();
    vi.advanceTimersByTime(1200);
    expect(lastTick).toBe(2);

    engine.stop();
    vi.advanceTimersByTime(1200);
    expect(lastTick).toBe(2);
  });

  it('tracks currentTick property', () => {
    vi.useFakeTimers();
    const engine = new TickEngine(() => {});
    expect(engine.currentTick).toBe(0);
    engine.start();
    vi.advanceTimersByTime(3000);
    expect(engine.currentTick).toBe(5);
    engine.stop();
  });

  it('reset clears tick counter', () => {
    vi.useFakeTimers();
    const engine = new TickEngine(() => {});
    engine.start();
    vi.advanceTimersByTime(1200);
    engine.reset();
    expect(engine.currentTick).toBe(0);
    expect(engine.running).toBe(false);
  });
});

describe('Rng', () => {
  it('produces deterministic sequence from same seed', () => {
    const rng1 = new Rng(12345);
    const rng2 = new Rng(12345);

    const seq1 = Array.from({ length: 100 }, () => rng1.next());
    const seq2 = Array.from({ length: 100 }, () => rng2.next());

    expect(seq1).toEqual(seq2);
  });

  it('produces values in [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt produces values in [min, max] inclusive', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(15);
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = new Rng(111);
    const rng2 = new Rng(222);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    expect(seq1).not.toEqual(seq2);
  });
});
