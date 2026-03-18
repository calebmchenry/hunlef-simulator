import type { Tier, WeaponType } from '../entities/types.ts';
import type { LoadoutConfig } from '../equipment/Loadout.ts';
import { ARMOR_SETS, WEAPONS } from '../equipment/items.ts';
import {
  meleeMaxHit, meleeAttackRoll,
  rangedMaxHit, rangedAttackRoll,
  magicMaxHit, magicAttackRoll,
  hitChance, npcDefenceRoll,
} from '../combat/formulas.ts';
import type { FKeyConfig } from '../input/KeyBindManager.ts';
import { DEFAULT_FKEY_CONFIG } from '../input/KeyBindManager.ts';

const FKEY_OPTIONS = ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const WEAPON_TYPE_OPTIONS: Array<{ value: WeaponType; label: string }> = [
  { value: 'staff', label: 'Staff' },
  { value: 'bow', label: 'Bow' },
  { value: 'halberd', label: 'Halberd' },
];

export class LoadoutScreen {
  private container: HTMLElement;
  private onStart: (config: LoadoutConfig) => void;

  constructor(container: HTMLElement, onStart: (config: LoadoutConfig) => void) {
    this.container = container;
    this.onStart = onStart;
    this.build();
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  private build(): void {
    this.container.innerHTML = `
      <h1>Corrupted Hunlef Simulator</h1>
      <div class="loadout-row">
        <label>Armor Tier</label>
        <select id="armor-tier">
          <option value="0">${ARMOR_SETS[0].name}</option>
          <option value="1">${ARMOR_SETS[1].name}</option>
          <option value="2">${ARMOR_SETS[2].name}</option>
          <option value="3" selected>${ARMOR_SETS[3].name}</option>
        </select>
      </div>
      <div class="loadout-row">
        <label>Weapon Type</label>
        <select id="weapon-type">
          <option value="staff">Staff</option>
          <option value="bow">Bow</option>
          <option value="halberd">Halberd</option>
        </select>
      </div>
      <div class="loadout-row">
        <label>Weapon Tier</label>
        <select id="weapon-tier">
          <option value="1">T1 (Basic)</option>
          <option value="2">T2 (Attuned)</option>
          <option value="3" selected>T3 (Perfected)</option>
        </select>
      </div>
      <div class="loadout-row">
        <label>2nd Weapon (optional)</label>
        <select id="secondary-weapon-type">
          <option value="">None</option>
          <option value="staff">Staff</option>
          <option value="bow">Bow</option>
          <option value="halberd">Halberd</option>
        </select>
      </div>
      <div class="loadout-row" id="secondary-tier-row" style="display:none">
        <label>2nd Weapon Tier</label>
        <select id="secondary-weapon-tier">
          <option value="1">T1 (Basic)</option>
          <option value="2">T2 (Attuned)</option>
          <option value="3" selected>T3 (Perfected)</option>
        </select>
      </div>
      <hr style="border-color:#4a2020;margin:10px 0">
      <div class="loadout-row">
        <label>Paddlefish</label>
        <input type="number" id="paddlefish-count" min="0" max="28" value="12" style="width:60px;padding:4px;background:#1a0a0a;color:#e0d0c0;border:1px solid #4a2020;border-radius:3px;font-size:13px">
      </div>
      <div class="loadout-row">
        <label>C. Paddlefish</label>
        <input type="number" id="corrupted-paddlefish-count" min="0" max="28" value="4" style="width:60px;padding:4px;background:#1a0a0a;color:#e0d0c0;border:1px solid #4a2020;border-radius:3px;font-size:13px">
      </div>
      <div class="loadout-row">
        <label>Egniol Doses</label>
        <input type="number" id="egniol-doses" min="0" max="28" value="8" style="width:60px;padding:4px;background:#1a0a0a;color:#e0d0c0;border:1px solid #4a2020;border-radius:3px;font-size:13px">
      </div>
      <div id="slot-counter" style="font-size:12px;color:#888;margin:4px 0;text-align:right"></div>
      <hr style="border-color:#4a2020;margin:10px 0">
      <div style="font-size:13px;color:#ff8844;margin-bottom:6px">F-Key Config</div>
      <div class="loadout-row">
        <label>Inventory Key</label>
        <select id="fkey-inventory">${this.buildFkeyOptions(DEFAULT_FKEY_CONFIG.inventory)}</select>
      </div>
      <div class="loadout-row">
        <label>Prayer Key</label>
        <select id="fkey-prayer">${this.buildFkeyOptions(DEFAULT_FKEY_CONFIG.prayer)}</select>
      </div>
      <div class="loadout-row">
        <label>Equipment Key</label>
        <select id="fkey-equipment">${this.buildFkeyOptions(DEFAULT_FKEY_CONFIG.equipment)}</select>
      </div>
      <div id="fkey-error" style="font-size:11px;color:#cc4444;min-height:16px"></div>
      <div id="dps-preview">Loading...</div>
      <button id="start-btn">Start Fight</button>
    `;

    const armorSelect = this.container.querySelector('#armor-tier') as HTMLSelectElement;
    const weaponTypeSelect = this.container.querySelector('#weapon-type') as HTMLSelectElement;
    const weaponTierSelect = this.container.querySelector('#weapon-tier') as HTMLSelectElement;
    const secondaryTypeSelect = this.container.querySelector('#secondary-weapon-type') as HTMLSelectElement;
    const secondaryTierRow = this.container.querySelector('#secondary-tier-row') as HTMLElement;
    const secondaryTierSelect = this.container.querySelector('#secondary-weapon-tier') as HTMLSelectElement;
    const paddlefishInput = this.container.querySelector('#paddlefish-count') as HTMLInputElement;
    const corruptedInput = this.container.querySelector('#corrupted-paddlefish-count') as HTMLInputElement;
    const egniolInput = this.container.querySelector('#egniol-doses') as HTMLInputElement;
    const slotCounter = this.container.querySelector('#slot-counter') as HTMLElement;
    const fkeyInventory = this.container.querySelector('#fkey-inventory') as HTMLSelectElement;
    const fkeyPrayer = this.container.querySelector('#fkey-prayer') as HTMLSelectElement;
    const fkeyEquipment = this.container.querySelector('#fkey-equipment') as HTMLSelectElement;
    const fkeyError = this.container.querySelector('#fkey-error') as HTMLElement;
    const startBtn = this.container.querySelector('#start-btn') as HTMLButtonElement;

    const updateSlotCount = () => {
      const weapons = secondaryTypeSelect.value ? 1 : 0;
      const paddlefish = Math.max(0, Number(paddlefishInput.value) || 0);
      const corrupted = Math.max(0, Number(corruptedInput.value) || 0);
      const doses = Math.max(0, Number(egniolInput.value) || 0);
      const vials = Math.ceil(doses / 4);
      const total = weapons + vials + paddlefish + corrupted;
      slotCounter.textContent = `Slots: ${total}/28`;
      slotCounter.style.color = total > 28 ? '#cc4444' : '#888';
    };

    const updateSecondaryOptions = () => {
      const primaryType = weaponTypeSelect.value as WeaponType;
      const currentSecondary = secondaryTypeSelect.value as WeaponType | '';
      const availableSecondaryTypes = WEAPON_TYPE_OPTIONS.filter(option => option.value !== primaryType);

      secondaryTypeSelect.innerHTML = [
        '<option value="">None</option>',
        ...availableSecondaryTypes.map(
          option => `<option value="${option.value}">${option.label}</option>`
        ),
      ].join('');

      const nextSecondary = availableSecondaryTypes.some(option => option.value === currentSecondary)
        ? currentSecondary
        : '';

      secondaryTypeSelect.value = nextSecondary;
      secondaryTierRow.style.display = nextSecondary ? 'flex' : 'none';
      updateSlotCount();
    };

    const validateFkeys = (): boolean => {
      const values = [fkeyInventory.value, fkeyPrayer.value, fkeyEquipment.value];
      const unique = new Set(values);
      if (unique.size < values.length) {
        fkeyError.textContent = 'Duplicate key assignments!';
        return false;
      }
      fkeyError.textContent = '';
      return true;
    };

    secondaryTypeSelect.addEventListener('change', () => {
      secondaryTierRow.style.display = secondaryTypeSelect.value ? 'flex' : 'none';
      updateSlotCount();
    });

    const updatePreview = () => {
      this.updateDpsPreview(
        Number(armorSelect.value) as Tier,
        weaponTypeSelect.value as WeaponType,
        Number(weaponTierSelect.value) as 1 | 2 | 3,
      );
      updateSlotCount();
    };

    armorSelect.addEventListener('change', updatePreview);
    weaponTypeSelect.addEventListener('change', () => {
      updateSecondaryOptions();
      updatePreview();
    });
    weaponTierSelect.addEventListener('change', updatePreview);
    paddlefishInput.addEventListener('input', updateSlotCount);
    corruptedInput.addEventListener('input', updateSlotCount);
    egniolInput.addEventListener('input', updateSlotCount);
    fkeyInventory.addEventListener('change', validateFkeys);
    fkeyPrayer.addEventListener('change', validateFkeys);
    fkeyEquipment.addEventListener('change', validateFkeys);
    updateSecondaryOptions();
    updatePreview();
    updateSlotCount();

    startBtn.addEventListener('click', () => {
      if (!validateFkeys()) return;

      const fkeyConfig: FKeyConfig = {
        inventory: fkeyInventory.value,
        prayer: fkeyPrayer.value,
        equipment: fkeyEquipment.value,
      };

      const config: LoadoutConfig = {
        armorTier: Number(armorSelect.value) as Tier,
        weaponType: weaponTypeSelect.value as WeaponType,
        weaponTier: Number(weaponTierSelect.value) as 1 | 2 | 3,
        paddlefishCount: Math.max(0, Number(paddlefishInput.value) || 0),
        corruptedPaddlefishCount: Math.max(0, Number(corruptedInput.value) || 0),
        egniolDoses: Math.max(0, Number(egniolInput.value) || 0),
        fkeyConfig,
      };

      if (secondaryTypeSelect.value && secondaryTypeSelect.value !== weaponTypeSelect.value) {
        config.secondaryWeaponType = secondaryTypeSelect.value as WeaponType;
        config.secondaryWeaponTier = Number(secondaryTierSelect.value) as 1 | 2 | 3;
      }

      this.onStart(config);
    });
  }

  private buildFkeyOptions(selected: string): string {
    return FKEY_OPTIONS.map(
      key => `<option value="${key}"${key === selected ? ' selected' : ''}>${key}</option>`
    ).join('');
  }

  private updateDpsPreview(armorTier: Tier, weaponType: WeaponType, weaponTier: 1 | 2 | 3): void {
    const preview = this.container.querySelector('#dps-preview')!;
    const weapon = WEAPONS[weaponType][weaponTier];
    // Armor tier affects defense, not DPS calculation
    void ARMOR_SETS[armorTier];

    const bossDefRoll = npcDefenceRoll(240, 20);
    let maxHit: number;
    let attackRoll: number;

    switch (weaponType) {
      case 'staff':
        maxHit = magicMaxHit(weaponTier, false);
        attackRoll = magicAttackRoll(99, weapon.attackBonus, 1.0);
        break;
      case 'bow':
        maxHit = rangedMaxHit(99, weapon.strengthBonus, 1.0);
        attackRoll = rangedAttackRoll(99, weapon.attackBonus, 1.0, 0);
        break;
      case 'halberd':
        maxHit = meleeMaxHit(99, weapon.strengthBonus, 1.0, 0);
        attackRoll = meleeAttackRoll(99, weapon.attackBonus, 1.0, 0);
        break;
    }

    const accuracy = hitChance(attackRoll, bossDefRoll);
    const avgDmg = accuracy * (maxHit + 1) / 2;
    const dps = avgDmg / (weapon.attackSpeed * 0.6);

    preview.innerHTML = `
      <strong>${weapon.name}</strong><br>
      Max Hit: ${maxHit} | Accuracy: ${(accuracy * 100).toFixed(1)}%<br>
      DPS: ${dps.toFixed(2)} | Avg Damage/Hit: ${avgDmg.toFixed(1)}<br>
      Boss Def Roll: ${bossDefRoll} | Your Att Roll: ${attackRoll}
    `;
  }
}
