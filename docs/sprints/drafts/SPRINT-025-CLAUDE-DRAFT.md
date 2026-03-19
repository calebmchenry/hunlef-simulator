# Sprint 025: Player Run Animation & Directional Facing

## Goal
Play a real run animation (OSRS seq 824) when the player moves, and face movement direction while running instead of always facing the boss.

## Phase 1 — Export run animation into player GLTFs

Add `["run", 824]` to every entry in `BODY_EXPORTS` in `export-player-gltf.mjs`, then re-export.

```js
// Each body variant gets run added after eat:
sequences: [
  ["idle", 808],
  ["eat", 829],
  ["run", 824],
  // ["attack", ...] if present
],
```

Update `EXPECTED_CLIP_ORDER` in `PlayerAnimationController.ts` to include `run` so the index-based fallback names clips correctly:

```ts
const EXPECTED_CLIP_ORDER: PlayerAnimState[] = ['idle', 'eat', 'run', 'attack'];
```

**Files:**
- `tools/cache-reader/export-player-gltf.mjs` lines 23-51 — add `["run", 824]` to each variant
- Re-run exporter to regenerate `public/models/player_body*.gltf`

## Phase 2 — Add 'run' state to PlayerAnimationController

Add `'run'` to `PlayerAnimState` type and wire it up:

```ts
export type PlayerAnimState = 'idle' | 'attack' | 'eat' | 'run';
```

Add seq 824 mappings to `ANIM_NAME_MAP`:

```ts
'824': 'run',
seq_824: 'run',
run: 'run',
```

Configure the run action to loop like idle (not once like attack/eat):

```ts
if (state === 'idle' || state === 'run') {
  action.setLoop(THREE.LoopRepeat, Infinity);
} else {
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = false;
}
```

Update the `handleFinished` callback — run doesn't finish (it loops), but if it somehow does, fall back to idle. The existing check (`state !== 'idle'`) already covers this since `'run' !== 'idle'`.

Add `playRun()` method:

```ts
playRun(): void {
  this.crossFadeTo('run');
}
```

**Files:** `src/render/PlayerAnimationController.ts`

## Phase 3 — Trigger run/idle and fix facing in Renderer3D

**`updatePlayerAnimations()`** — trigger run when moving, idle when stopped:

```ts
private updatePlayerAnimations(sim: GameSimulation): void {
  if (!this.playerAnimController) return;

  if (sim.playerAteThisTick && sim.tick !== this.lastPlayerEatTick) {
    this.lastPlayerEatTick = sim.tick;
    this.playerAnimController.playEat();
    return;
  }

  if (sim.tick !== this.lastPlayerAttackTick && this.didPlayerAttackThisTick(sim)) {
    this.lastPlayerAttackTick = sim.tick;
    this.playerAnimController.playAttack();
    return;
  }

  const isMoving = sim.player.prevPos.x !== sim.player.pos.x
    || sim.player.prevPos.y !== sim.player.pos.y;
  if (isMoving) {
    this.playerAnimController.playRun();
  } else {
    this.playerAnimController.playIdle();
  }
}
```

**`updatePlayer()`** — face movement direction while running, face boss otherwise:

```ts
const isMoving = player.prevPos.x !== player.pos.x || player.prevPos.y !== player.pos.y;

if (isMoving) {
  // Face movement direction
  const moveDx = currWorld.x - prevWorld.x;
  const moveDz = currWorld.z - prevWorld.z;
  if (Math.abs(moveDx) > 0.001 || Math.abs(moveDz) > 0.001) {
    this.playerGroup.rotation.y = Math.atan2(moveDx, moveDz) + PLAYER_MODEL_YAW_OFFSET;
  }
  // Keep procedural bob
  const bobPhase = tickProgress * Math.PI;
  this.playerGroup.position.set(worldX, Math.sin(bobPhase) * 0.03, worldZ);
  this.playerGroup.rotation.x = 0.05;
} else {
  // Face boss when idle/attacking
  const dx = this.bossGroup.position.x - worldX;
  const dz = this.bossGroup.position.z - worldZ;
  if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
    this.playerGroup.rotation.y = Math.atan2(dx, dz) + PLAYER_MODEL_YAW_OFFSET;
  }
  this.playerGroup.position.set(worldX, 0, worldZ);
  this.playerGroup.rotation.x = 0;
}
```

**Files:** `src/render/Renderer3D.ts` — `updatePlayer()` (~line 1000), `updatePlayerAnimations()` (~line 1032)

## Definition of Done

- [ ] Player GLTFs contain a `run` clip (seq 824)
- [ ] Player plays run animation when moving between tiles
- [ ] Player faces movement direction while running
- [ ] Player faces boss when idle or attacking
- [ ] Run -> idle transition is clean when player stops moving
- [ ] Attack/eat still interrupt correctly and face boss
- [ ] All tests pass, build succeeds
