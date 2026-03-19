# Sprint 028: Hunlef Style-Switch Audio Cue

## Overview

Ship the MVP audio cue for the Corrupted Hunllef style switch without changing simulation timing. `GameSimulation` already emits `style_switch` 2 ticks after the 4th attack, and `Renderer3D.updateBossAnimations()` already treats that as a one-shot event. Reuse that path and add a minimal Web Audio cue plus a simple mute toggle. For MVP, the sound is synthesized; we can swap in the real OSRS asset later.

## Implementation

- Add a tiny `src/audio/AudioManager.ts` wrapper around the Web Audio API with four responsibilities: lazily create/resume an `AudioContext`, track muted state, play the style-switch cue, and clean up on dispose.
- Keep audio out of `GameSimulation`. The sim should continue to emit `style_switch` exactly as it does now in `src/engine/GameSimulation.ts:403-405`; no timing or engine logic changes are needed.
- In `src/render/Renderer3D.ts`, instantiate the audio manager and call `playStyleSwitchCue()` inside the `'style_switch'` branch of `updateBossAnimations()`, alongside `playStyleSwitch(...)`. Because this branch already runs only for a new boss event, the cue will fire once per switch instead of once per frame.
- Make the cue a short synthesized tone built from one or two oscillators plus a gain envelope. It only needs to be distinctive and readable as a switch warning, not OSRS-accurate yet.
- Add a small `Sound: On/Off` control in the existing HUD flow and persist the preference in `localStorage`, so restart/loadout round-trips keep the mute state.
- Handle autoplay explicitly: start with audio locked, resume on the first real user gesture (`Start Fight`, canvas click, or key press), and no-op if a cue fires before unlock. Do not queue missed sounds or emit noisy autoplay errors.

## Definition of Done

- A single synthesized cue plays on each Hunllef `style_switch`.
- Cue timing matches the existing event timing: 2 ticks after the 4th attack.
- Audio can be muted/unmuted, and the preference persists.
- Browsers that block autoplay do not break the fight loop; audio starts only after user interaction.
- Replacing the synthesized cue with the real OSRS sound later only requires swapping the cue implementation, not the trigger path.
