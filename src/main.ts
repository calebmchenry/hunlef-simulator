import { TickEngine } from './engine/TickEngine.ts';
import { GameSimulation } from './engine/GameSimulation.ts';
import { Loadout } from './equipment/Loadout.ts';
import type { LoadoutConfig } from './equipment/Loadout.ts';
import { Renderer3D } from './render/Renderer3D.ts';
import { HUD } from './render/HUD.ts';
import { LoadoutScreen } from './render/LoadoutScreen.ts';
import { InputManager } from './input/InputManager.ts';
import { SidePanel } from './render/SidePanel.ts';

const loadoutContainer = document.getElementById('loadout-screen')!;
const gameContainer = document.getElementById('game-container')!;
const canvasWrapper = document.getElementById('canvas-wrapper')!;
const hudContainer = document.getElementById('hud')!;
const sidePanelContainer = document.getElementById('side-panel')!;
const overlay = document.getElementById('overlay')!;
const overlayTitle = document.getElementById('overlay-title')!;
const overlayStats = document.getElementById('overlay-stats')!;
const restartBtn = document.getElementById('restart-btn')!;

let engine: TickEngine | null = null;
let sim: GameSimulation | null = null;
let renderer: Renderer3D | null = null;
let hud: HUD | null = null;
let input: InputManager | null = null;
let sidePanel: SidePanel | null = null;
let rafId: number | null = null;
let lastTickTime: number = performance.now();

function startFight(config: LoadoutConfig): void {
  // Clean up previous
  if (engine) engine.stop();
  if (input) input.destroy();
  if (renderer) renderer.dispose();
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const loadout = new Loadout(config);
  const seed = Date.now();
  sim = new GameSimulation(loadout, seed);
  renderer = new Renderer3D(canvasWrapper);
  hud = new HUD(hudContainer);

  // Create side panel
  sidePanelContainer.innerHTML = '';
  sidePanel = new SidePanel(sidePanelContainer);

  // Create input manager with F-key config and side panel
  // Use the 3D renderer's canvas for click input (same 576x576 size)
  input = new InputManager(sim, renderer.canvas, renderer, config.fkeyConfig, sidePanel);

  overlay.style.display = 'none';
  loadoutContainer.style.display = 'none';
  gameContainer.style.display = 'flex';

  lastTickTime = performance.now();

  engine = new TickEngine((_tick: number) => {
    if (!sim || !hud || !sidePanel) return;

    lastTickTime = performance.now();
    sim.processTick();
    hud.update(sim);
    sidePanel.update(sim);

    if (sim.state === 'won' || sim.state === 'lost') {
      engine!.stop();
      showEndScreen();
    }
  });

  // rAF render loop — runs at ~60fps, interpolates positions between ticks
  function renderLoop(now: number): void {
    if (!sim || !renderer) return;
    const elapsed = now - lastTickTime;
    const tickProgress = Math.min(elapsed / 600, 1.0);
    renderer.draw(sim, tickProgress);
    if (engine?.running || sim.state === 'countdown') {
      rafId = requestAnimationFrame(renderLoop);
    } else {
      rafId = null;
    }
  }

  // Initial draw and HUD
  renderer.draw(sim, 0);
  hud.update(sim);
  sidePanel.update(sim);

  engine.start();
  rafId = requestAnimationFrame(renderLoop);
}

function showEndScreen(): void {
  if (!sim) return;

  const won = sim.state === 'won';
  overlayTitle.textContent = won ? 'Victory!' : 'Defeated!';
  overlayTitle.style.color = won ? '#44cc44' : '#cc4444';

  const elapsed = (sim.tick * 0.6).toFixed(1);
  const playerDps = sim.tick > 0
    ? (sim.player.totalDamageDealt / (sim.tick * 0.6)).toFixed(2)
    : '0';

  overlayStats.innerHTML = `
    Time: ${elapsed}s (${sim.tick} ticks)<br>
    Damage Dealt: ${sim.player.totalDamageDealt}<br>
    Damage Taken: ${sim.player.totalDamageTaken}<br>
    Player DPS: ${playerDps}<br>
    Boss HP Remaining: ${sim.boss.hp}/${sim.boss.maxHp}
  `;

  overlay.style.display = 'flex';
}

function returnToLoadout(): void {
  if (engine) engine.stop();
  if (input) input.destroy();
  if (renderer) renderer.dispose();
  overlay.style.display = 'none';
  gameContainer.style.display = 'none';
  loadoutContainer.style.display = 'block';
}

// Wire up
restartBtn.addEventListener('click', returnToLoadout);

new LoadoutScreen(loadoutContainer, startFight);
