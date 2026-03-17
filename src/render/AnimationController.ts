/**
 * Wraps Three.js AnimationMixer to manage Hunlef animation states.
 * Syncs to game ticks: idle loops, attack/switch play once then return to idle.
 */
import * as THREE from 'three';

export type AnimState = 'idle' | 'attack_magic' | 'attack_ranged' | 'stomp' | 'prayer_disable' | 'style_switch_mage' | 'style_switch_range' | 'death';

// Map GLTF clip names (OSRS sequence IDs) to animation states.
// The GLTF exporter names clips by sequence ID or "seq_<id>".
const ANIM_NAME_MAP: Record<string, AnimState> = {
  // Friendly names (in case GLTF uses them)
  'idle': 'idle',
  'attack_magic': 'attack_magic',
  'magic_attack': 'attack_magic',
  'attack_ranged': 'attack_ranged',
  'ranged_attack': 'attack_ranged',
  'stomp': 'stomp',
  'prayer_disable': 'prayer_disable',
  'style_switch_mage': 'style_switch_mage',
  'style_switch_range': 'style_switch_range',
  'death': 'death',
  // OSRS sequence IDs (raw numeric names from GLTF export)
  '8417': 'idle',
  '8430': 'attack_magic',
  '8431': 'attack_ranged',
  '8432': 'stomp',
  '8433': 'prayer_disable',
  '8436': 'death',
  '8754': 'style_switch_mage',
  '8755': 'style_switch_range',
  // With "seq_" prefix variant
  'seq_8417': 'idle',
  'seq_8430': 'attack_magic',
  'seq_8431': 'attack_ranged',
  'seq_8432': 'stomp',
  'seq_8433': 'prayer_disable',
  'seq_8436': 'death',
  'seq_8754': 'style_switch_mage',
  'seq_8755': 'style_switch_range',
};

const EXPECTED_CLIP_ORDER: AnimState[] = [
  'idle',
  'attack_magic',
  'attack_ranged',
  'stomp',
  'prayer_disable',
  'death',
  'style_switch_mage',
  'style_switch_range',
];

export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private actions: Map<AnimState, THREE.AnimationAction> = new Map();
  private currentState: AnimState = 'idle';

  constructor(model: THREE.Object3D, animations: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);

    // Some exports omit clip.name; assign by known sequence order.
    animations.forEach((clip, index) => {
      if (!clip.name && index < EXPECTED_CLIP_ORDER.length) {
        clip.name = EXPECTED_CLIP_ORDER[index];
      }
    });

    // Log clip names for debugging
    console.log('[AnimationController] GLTF clip names:', animations.map(a => a.name));

    // Map animation clips to states
    for (const clip of animations) {
      const state = ANIM_NAME_MAP[clip.name];
      if (state) {
        const action = this.mixer.clipAction(clip);
        if (state === 'idle') {
          action.setLoop(THREE.LoopRepeat, Infinity);
        } else if (state === 'death') {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = false;
        }
        this.actions.set(state, action);
      }
    }

    // Listen for finished animations to return to idle
    this.mixer.addEventListener('finished', (e) => {
      const finishedAction = (e as unknown as { action: THREE.AnimationAction }).action;
      // Find which state this action belongs to
      for (const [state, action] of this.actions) {
        if (action === finishedAction && state !== 'idle' && state !== 'death') {
          this.playIdle();
          break;
        }
      }
    });

    // Start with idle
    this.playIdle();
  }

  playIdle(): void {
    if (this.currentState === 'death') return; // Don't interrupt death
    this.crossFadeTo('idle');
  }

  playAttack(style: 'magic' | 'ranged'): void {
    if (this.currentState === 'death') return;
    const state: AnimState = style === 'magic' ? 'attack_magic' : 'attack_ranged';
    this.crossFadeTo(state);
  }

  playStomp(): void {
    if (this.currentState === 'death') return;
    this.crossFadeTo('stomp');
  }

  playStyleSwitch(style: 'magic' | 'ranged'): void {
    if (this.currentState === 'death') return;
    const state: AnimState = style === 'magic' ? 'style_switch_mage' : 'style_switch_range';
    this.crossFadeTo(state);
  }

  playDeath(): void {
    this.crossFadeTo('death');
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }

  private crossFadeTo(state: AnimState): void {
    const nextAction = this.actions.get(state);
    if (!nextAction) return;

    const prevAction = this.actions.get(this.currentState);
    this.currentState = state;

    nextAction.reset();
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      nextAction.crossFadeFrom(prevAction, 0.1, false);
    }
  }

  get state(): AnimState {
    return this.currentState;
  }
}
