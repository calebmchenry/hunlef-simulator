# Sprint 027: Player Pathing Through Boss

## Overview

The stomp mechanic is already fully implemented (`GameSimulation.ts:374-388`). When the boss is ready to attack and the player is underneath, it stomps for typeless damage that ignores prayers and doesn't count toward the attack cycle.

The only remaining change: **the boss currently blocks pathfinding**. The player should be able to walk freely through the boss's 5x5 footprint. In OSRS, the Hunlef is not a movement obstacle.

## Implementation

### Task 1: Remove boss blocking from Arena.isWalkable()

**File:** `src/world/Arena.ts`

Remove the `boss.occupies(x, y)` check from `isWalkable()`. The boss footprint should not block player movement.

The method signature still accepts `boss` param (other callers may need it), but it no longer blocks based on boss position.

### Task 2: Update Pathfinding

**File:** `src/world/Pathfinding.ts`

- Remove the corner-cutting prevention that checks boss tiles (since boss tiles are now walkable)
- Remove the `findNearestWalkable` fallback for targets inside the boss (player can now walk directly to any tile including under the boss)

### Task 3: Verify stomp still triggers

The stomp check at `GameSimulation.ts:374` uses `boss.occupies(player.pos)` directly — this is independent of pathfinding. With the boss no longer blocking movement, the player CAN walk under the boss, and the stomp WILL trigger when the boss attacks.

Manual verification: walk under the boss, observe stomp damage and animation.

## Definition of Done

- [ ] Player can walk through the boss's 5x5 footprint
- [ ] Pathfinding routes through/under the boss when it's the shortest path
- [ ] Stomp triggers when player is under boss during an attack tick
- [ ] Stomp deals typeless damage (ignores protection prayers)
- [ ] Stomp doesn't advance the attack rotation counter
- [ ] Stomp animation plays
- [ ] All tests pass, build succeeds

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing pathfinding tests assume boss blocks movement | Medium | Update affected tests |
| Tornado floor hazards interact oddly with player-under-boss | Low | Separate system, unaffected |
