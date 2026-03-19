import * as THREE from 'three';

export type PlayerAnimState = 'idle' | 'attack' | 'eat' | 'run';

const ANIM_NAME_MAP: Record<string, PlayerAnimState> = {
  idle: 'idle',
  eat: 'eat',
  run: 'run',
  attack: 'attack',
  '808': 'idle',
  '829': 'eat',
  '824': 'run',
  '419': 'attack',
  '426': 'attack',
  '440': 'attack',
  seq_808: 'idle',
  seq_829: 'eat',
  seq_824: 'run',
  seq_419: 'attack',
  seq_426: 'attack',
  seq_440: 'attack',
};

const EXPECTED_CLIP_ORDER: PlayerAnimState[] = ['idle', 'eat', 'run', 'attack'];

export class PlayerAnimationController {
  private readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Map<PlayerAnimState, THREE.AnimationAction> = new Map();
  private currentState: PlayerAnimState = 'idle';
  private readonly handleFinished = (event: THREE.Event) => {
    const finishedAction = (event as unknown as { action: THREE.AnimationAction }).action;

    for (const [state, action] of this.actions) {
      if (action === finishedAction && state !== 'idle') {
        this.playIdle();
        break;
      }
    }
  };

  constructor(model: THREE.Object3D, animations: THREE.AnimationClip[]) {
    this.root = model;
    this.mixer = new THREE.AnimationMixer(model);

    animations.forEach((clip, index) => {
      if (!ANIM_NAME_MAP[clip.name] && index < EXPECTED_CLIP_ORDER.length) {
        clip.name = EXPECTED_CLIP_ORDER[index];
      }
    });

    for (const clip of animations) {
      const state = ANIM_NAME_MAP[clip.name];
      if (!state) continue;

      const action = this.mixer.clipAction(clip);
      if (state === 'idle' || state === 'run') {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
      }
      this.actions.set(state, action);
    }

    this.mixer.addEventListener('finished', this.handleFinished);

    // Start idle animation directly — bypass crossFadeTo's same-state guard
    // since currentState is already 'idle' at construction time.
    const idleAction = this.actions.get('idle');
    if (idleAction) {
      idleAction.reset();
      idleAction.play();
      this.mixer.update(0);
    }
  }

  playIdle(): void {
    this.crossFadeTo('idle');
  }

  playAttack(): void {
    this.crossFadeTo('attack');
  }

  playRun(): void {
    this.crossFadeTo('run');
  }

  playEat(): void {
    this.crossFadeTo('eat');
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.removeEventListener('finished', this.handleFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }

  private crossFadeTo(state: PlayerAnimState): void {
    if (state === this.currentState) return;

    const nextAction = this.actions.get(state);
    if (!nextAction) return;

    const prevAction = this.actions.get(this.currentState);
    this.currentState = state;

    nextAction.reset();
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.stop();
    }
  }
}
