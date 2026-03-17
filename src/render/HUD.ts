import type { GameSimulation } from '../engine/GameSimulation.ts';

export class HUD {
  private container: HTMLElement;
  private hpBar!: HTMLElement;
  private hpText!: HTMLElement;
  private prayerBar!: HTMLElement;
  private prayerText!: HTMLElement;
  private bossBar!: HTMLElement;
  private bossText!: HTMLElement;
  private attackInfo!: HTMLElement;
  private tickInfo!: HTMLElement;
  private bossProtInfo!: HTMLElement;
  private countdownInfo!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="bar-container bar-hp">
        <div class="bar-label"><span>HP</span><span id="hp-text">99/99</span></div>
        <div class="bar-outer"><div class="bar-inner" id="hp-bar" style="width:100%"></div></div>
      </div>
      <div class="bar-container bar-prayer">
        <div class="bar-label"><span>Prayer</span><span id="prayer-text">77/77</span></div>
        <div class="bar-outer"><div class="bar-inner" id="prayer-bar" style="width:100%"></div></div>
      </div>
      <div class="bar-container bar-boss">
        <div class="bar-label"><span>Hunlef</span><span id="boss-text">1000/1000</span></div>
        <div class="bar-outer"><div class="bar-inner" id="boss-bar" style="width:100%"></div></div>
      </div>
      <div id="attack-info">Attacks: 0/4 (Ranged)</div>
      <div id="boss-prot-info">Boss protects: Ranged</div>
      <div id="tick-info">Tick: 0</div>
      <div id="countdown-info" style="display:none"></div>
    `;

    this.hpBar = this.container.querySelector('#hp-bar')!;
    this.hpText = this.container.querySelector('#hp-text')!;
    this.prayerBar = this.container.querySelector('#prayer-bar')!;
    this.prayerText = this.container.querySelector('#prayer-text')!;
    this.bossBar = this.container.querySelector('#boss-bar')!;
    this.bossText = this.container.querySelector('#boss-text')!;
    this.attackInfo = this.container.querySelector('#attack-info')!;
    this.tickInfo = this.container.querySelector('#tick-info')!;
    this.bossProtInfo = this.container.querySelector('#boss-prot-info')!;
    this.countdownInfo = this.container.querySelector('#countdown-info')!;
  }

  update(sim: GameSimulation): void {
    const p = sim.player;
    const b = sim.boss;

    // HP
    const hpPct = (p.hp / p.maxHp) * 100;
    this.hpBar.style.width = `${hpPct}%`;
    this.hpText.textContent = `${p.hp}/${p.maxHp}`;

    // Prayer
    const prayerPct = (p.prayerPoints / p.maxPrayerPoints) * 100;
    this.prayerBar.style.width = `${prayerPct}%`;
    this.prayerText.textContent = `${p.prayerPoints}/${p.maxPrayerPoints}`;

    // Boss HP
    const bossPct = (b.hp / b.maxHp) * 100;
    this.bossBar.style.width = `${bossPct}%`;
    this.bossText.textContent = `${b.hp}/${b.maxHp}`;

    // Attack info
    const styleLabel = b.currentStyle === 'ranged' ? 'Ranged' : 'Magic';
    this.attackInfo.textContent = `Attacks: ${b.attackCounter}/4 (${styleLabel})`;

    // Boss protection info
    const protLabel = b.protectionStyle.charAt(0).toUpperCase() + b.protectionStyle.slice(1);
    this.bossProtInfo.textContent = `Boss protects: ${protLabel} (${b.offPrayerHitCount}/6)`;

    // Tick
    this.tickInfo.textContent = `Tick: ${sim.tick}`;

    // Countdown
    if (sim.state === 'countdown') {
      this.countdownInfo.style.display = 'block';
      this.countdownInfo.textContent = `Countdown: ${sim.countdownTicks}`;
      this.countdownInfo.style.color = '#ffcc00';
      this.countdownInfo.style.fontWeight = 'bold';
    } else {
      this.countdownInfo.style.display = 'none';
    }
  }
}
