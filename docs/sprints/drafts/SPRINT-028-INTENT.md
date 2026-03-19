# Sprint 028 Intent: Audio — Style Switch Sound Cue

## Seed Prompt

Add the style switch audio cue — the most important sound in the Corrupted Gauntlet fight. When the Hunlef changes attack style (every 4 attacks), a distinctive sound plays 2 ticks after the last attack. This is the key audio indicator players listen for.

## Research Findings

- Style switch animation sequences (8754, 8755) have **empty frameSounds arrays** — the sound is triggered by game logic, not the animation
- Attack sequences have frameSounds: attack_magic (4144, 4150), attack_ranged (2524, 3907)
- osrscachereader can export sounds via `IndexType.SOUNDEFFECTS` but they're in OSRS synth format (.dat), not WAV
- The OSRS wiki has audio files for some sounds but not these specific IDs
- A community dump of 3899 OSRS sound effects in WAV format exists
- No audio system exists in the project yet — building from scratch
- The simulator already fires `style_switch` events at the correct timing (2 ticks after 4th attack)

## Approach Options

1. **Extract from OSRS cache** — use osrscachereader to export sound data, convert to playable format. Most authentic but complex (OSRS sounds are synthesized, not samples).
2. **Use OSRS wiki audio files** — the wiki has .ogg files for many sounds. If the style switch sound is there, download and use it directly.
3. **Synthesize with Web Audio API** — create an approximation of the style switch sound using oscillators/filters. Fastest to implement, least authentic.
4. **Placeholder approach** — use a simple beep/tone as a placeholder, improve later.

## Relevant Code

- `src/engine/GameSimulation.ts:403-405` — style_switch event fires 2 ticks after 4th attack
- `src/render/Renderer3D.ts:959-980` — `updateBossAnimations()` detects new boss events including style_switch
- No existing audio code in the project

## Success Criteria

1. A distinctive sound plays when the Hunlef switches attack style
2. Sound timing matches the game event (2 ticks after 4th attack)
3. Sound plays through browser audio (Web Audio API or HTML5 Audio)
4. User can mute/unmute sounds
5. No audio autoplay issues (browsers block autoplay before user interaction)

## Uncertainty Assessment

| Factor | Level | Rationale |
|--------|-------|-----------|
| Correctness | Medium | Need the right sound — placeholder is OK for MVP |
| Scope | Low | Single sound, single trigger point |
| Architecture | Medium | New audio system from scratch, but simple |
