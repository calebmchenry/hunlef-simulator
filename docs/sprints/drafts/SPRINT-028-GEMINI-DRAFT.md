# Sprint 028: Audio — Style Switch Sound Cue

## Objective
Implement a minimal audio system using the Web Audio API to play a distinctive sound cue when the Corrupted Hunlef switches attack styles.

## Requirements

1. **Audio System (Web Audio API)**
   - Create a minimal audio manager to handle sound playback.
   - Synthesize a basic placeholder tone (oscillator/filter) for the MVP. This avoids the complexity of extracting/converting OSRS sound formats right now.
   - Handle browser autoplay policies by ensuring the audio context is initialized or resumed only after user interaction.

2. **Event Integration**
   - The simulation already fires a `style_switch` event 2 ticks after the 4th attack (visible in `GameSimulation.ts`).
   - Hook into this event (e.g., inside `Renderer3D.ts`'s `updateBossAnimations` where new events are detected) to trigger the sound.

3. **User Interface**
   - Add a mute toggle button to the UI to allow users to easily enable or disable audio.
   - Ensure the audio system respects this mute state before attempting to play any sounds.

## Implementation Steps

1. **Create `AudioManager`**
   - Encapsulates `AudioContext`.
   - Methods: `init()` (called on user click), `toggleMute()`, and `playStyleSwitchSound()`.
   - `playStyleSwitchSound()` should synthesize a noticeable beep/tone using an oscillator with a simple volume envelope.

2. **Add Mute Toggle**
   - Add a simple sound toggle icon/button to the application UI.
   - Ensure interacting with the UI initializes the `AudioContext` to comply with autoplay restrictions.

3. **Trigger Sound**
   - Inside the render loop (likely near `updateBossAnimations` where new boss events are evaluated), detect when a fresh `style_switch` event occurs and call `playStyleSwitchSound()`.
