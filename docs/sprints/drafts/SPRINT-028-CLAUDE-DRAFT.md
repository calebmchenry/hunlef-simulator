# Sprint 028: Style Switch Audio Cue

## Overview

Add the most important audio cue in the Corrupted Gauntlet: the style switch sound. When the Hunlef switches attack style (every 4 attacks), a sound plays 2 ticks after the 4th attack. The simulator already fires `style_switch` events at the correct timing — this sprint wires up audio output.

MVP uses a synthesized tone via Web Audio API. The sound file can be swapped later for the authentic OSRS sound.

## Implementation

### Task 1: Create AudioManager

**New file:** `src/audio/AudioManager.ts`

A singleton that owns the `AudioContext` and manages mute state.

```ts
export class AudioManager {
  private ctx: AudioContext | null = null;
  private _muted: boolean = false;

  /** Lazily create AudioContext on first user interaction. */
  ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** Resume suspended context (browsers suspend until user gesture). */
  resume(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  get muted(): boolean { return this._muted; }

  toggleMute(): boolean {
    this._muted = !this._muted;
    return this._muted;
  }

  /**
   * Play the style switch cue — a short descending two-tone beep.
   * Designed to be attention-grabbing without being annoying.
   */
  playStyleSwitch(): void {
    const ctx = this.ensureContext();
    if (!ctx || this._muted) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    // Two quick tones: high then low
    const osc1 = ctx.createOscillator();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(880, now);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.1);

    const gain2 = ctx.createGain();
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0.3, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(440, now + 0.1);
    osc2.connect(gain2);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  }
}
```

Key design decisions:
- **Lazy AudioContext creation**: Browsers block `AudioContext` construction/resumption until a user gesture. Don't create it at module load.
- **Singleton**: One `AudioContext` for the app. Multiple contexts waste resources and can hit browser limits.
- **Synthesized tone**: Two-tone descending square wave (880Hz → 440Hz). Punchy and distinctive. Easy to swap for a real sample later via `decodeAudioData`.

### Task 2: Wire AudioManager into Renderer3D

**File:** `src/render/Renderer3D.ts`

1. Import and instantiate `AudioManager` in the `Renderer3D` constructor.
2. Call `audioManager.resume()` on the first user interaction (the existing `pointerdown`/`click` listeners on the canvas are sufficient — add `resume()` there).
3. In `updateBossAnimations()`, after the `case 'style_switch':` block plays the animation, also call `audioManager.playStyleSwitch()`.

```ts
// In updateBossAnimations, case 'style_switch':
case 'style_switch':
  if (sim.lastBossStyleSwitchStyle !== null) {
    this.animController.playStyleSwitch(sim.lastBossStyleSwitchStyle);
  }
  this.audioManager.playStyleSwitch();
  break;
```

The `isNewEvent` guard at line 951 already prevents duplicate triggers — no additional dedup needed.

### Task 3: Autoplay Policy Handling

**File:** `src/render/Renderer3D.ts`

Browsers suspend `AudioContext` until a user gesture. The simulator requires a click to start (loadout screen → "Start" button), so by the time `style_switch` fires, there has been user interaction.

Hook `audioManager.resume()` into the start flow:
- Add a one-time `click`/`pointerdown` listener on `document` that calls `audioManager.ensureContext()` and `audioManager.resume()`.
- This covers both the loadout "Start" click and any canvas interaction.

No special "click to enable audio" banner needed — the existing UX flow guarantees interaction before audio plays.

### Task 4: Mute Toggle Button

**File:** `src/render/HUD.ts`

Add a small mute/unmute icon button to the HUD overlay. Position it in the top-right corner, out of the way.

```html
<button id="mute-btn" class="mute-toggle" title="Toggle sound">🔊</button>
```

On click, call `audioManager.toggleMute()` and swap the icon (`🔊` ↔ `🔇`). The `AudioManager` instance needs to be passed to the HUD (add it as a constructor param or expose via a setter).

Persist mute preference in `localStorage` under key `cg-sim-muted`. Read it in `AudioManager` constructor to restore user preference across sessions.

### Task 5: Tests

**File:** `src/audio/__tests__/AudioManager.test.ts`

- `toggleMute()` toggles state and returns new value
- `playStyleSwitch()` does nothing when muted (no error thrown)
- `playStyleSwitch()` does nothing when AudioContext is null (no error thrown)
- `ensureContext()` returns null gracefully if `AudioContext` constructor throws

No need to test actual audio output — that's browser-level. Test the state machine and guard conditions.

## Architecture Notes

```
User clicks "Start"
  → document click handler calls audioManager.ensureContext() + resume()

GameSimulation fires style_switch event (tick + 2)
  → Renderer3D.updateBossAnimations() detects new event
    → animController.playStyleSwitch() — visual
    → audioManager.playStyleSwitch() — audio
```

The audio system is intentionally minimal. It has one method per sound effect. When we add more sounds (attack impacts, prayer sounds, etc.), we add more methods to `AudioManager` — no need for a generic sound registry or asset loading system until there are enough sounds to warrant one.

## Definition of Done

- [ ] Style switch sound plays when the Hunlef changes attack style
- [ ] Sound timing aligns with the `style_switch` event (2 ticks after 4th attack)
- [ ] No autoplay errors — AudioContext is created/resumed on user gesture
- [ ] Mute button in HUD toggles sound on/off
- [ ] Mute preference persists in localStorage
- [ ] Muted state prevents sound playback (no errors, just silence)
- [ ] AudioManager unit tests pass
- [ ] Build succeeds, existing tests unaffected

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| AudioContext blocked by browser policy | Low | Created lazily after user gesture; resume() on click |
| Synthesized tone sounds bad / annoying | Medium | Easy to tune frequencies/envelope; placeholder by design |
| Safari AudioContext quirks | Low | Safari supports Web Audio API; `webkitAudioContext` fallback if needed |
| Multiple rapid style switches overlap sounds | Low | Sound is short (350ms); attack cycle is 4 attacks × 5 ticks = 20+ ticks (12+ seconds) |
