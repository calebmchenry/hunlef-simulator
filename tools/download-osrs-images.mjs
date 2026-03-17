#!/usr/bin/env node
/**
 * Download OSRS images from the wiki.
 * Usage: node tools/download-osrs-images.mjs
 * Idempotent — skips files that already exist.
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public', 'images');

const BASE = 'https://oldschool.runescape.wiki/w/Special:FilePath';

/** @type {Record<string, string[]>} */
const MANIFEST = {
  tabs: [
    'Combat_icon.png',
    'Skills_icon.png',
    'Quest_List_tab_icon.png',
    'Worn_Equipment.png',
    'Prayer_tab_icon.png',
    'Spellbook.png',
    'Your_Clan_icon.png',
    'Friends_List.png',
    'Ignore_List.png',
    'Logout.png',
    'Settings.png',
    'Emotes_button.png',
    'Music.png',
    'Inventory.png',
  ],
  items: [
    'Paddlefish.png',
    'Corrupted_paddlefish.png',
    'Egniol_potion_(1).png',
    'Egniol_potion_(2).png',
    'Egniol_potion_(3).png',
    'Egniol_potion_(4).png',
    'Corrupted_bow_(basic).png',
    'Corrupted_bow_(attuned).png',
    'Corrupted_bow_(perfected).png',
    'Corrupted_staff_(basic).png',
    'Corrupted_staff_(attuned).png',
    'Corrupted_staff_(perfected).png',
    'Corrupted_halberd_(basic).png',
    'Corrupted_halberd_(attuned).png',
    'Corrupted_halberd_(perfected).png',
    'Corrupted_helm_(basic).png',
    'Corrupted_helm_(attuned).png',
    'Corrupted_helm_(perfected).png',
    'Corrupted_body_(basic).png',
    'Corrupted_body_(attuned).png',
    'Corrupted_body_(perfected).png',
    'Corrupted_legs_(basic).png',
    'Corrupted_legs_(attuned).png',
    'Corrupted_legs_(perfected).png',
  ],
  prayers: [
    'Thick_Skin.png',
    'Burst_of_Strength.png',
    'Clarity_of_Thought.png',
    'Sharp_Eye.png',
    'Mystic_Will.png',
    'Rock_Skin.png',
    'Superhuman_Strength.png',
    'Improved_Reflexes.png',
    'Rapid_Restore.png',
    'Rapid_Heal.png',
    'Protect_Item.png',
    'Hawk_Eye.png',
    'Mystic_Lore.png',
    'Steel_Skin.png',
    'Ultimate_Strength.png',
    'Incredible_Reflexes.png',
    'Protect_from_Magic.png',
    'Protect_from_Missiles.png',
    'Protect_from_Melee.png',
    'Eagle_Eye.png',
    'Mystic_Might.png',
    'Retribution.png',
    'Redemption.png',
    'Smite.png',
    'Preserve.png',
    'Chivalry.png',
    'Piety.png',
    'Rigour.png',
    'Augury.png',
  ],
  overheads: [
    'Protect_from_Magic_overhead.png',
    'Protect_from_Missiles_overhead.png',
    'Protect_from_Melee_overhead.png',
  ],
};

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'cg-sim-asset-downloader/1.0 (contact: github)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

let downloaded = 0, skipped = 0, failed = 0;

for (const [folder, files] of Object.entries(MANIFEST)) {
  const dir = join(PUBLIC, folder);
  await mkdir(dir, { recursive: true });

  for (const file of files) {
    const dest = join(dir, file);
    if (await fileExists(dest)) {
      skipped++;
      continue;
    }
    const url = `${BASE}/${encodeURIComponent(file)}`;
    try {
      await download(url, dest);
      downloaded++;
      process.stdout.write(`  + ${folder}/${file}\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`  ! FAILED ${folder}/${file}: ${err.message}\n`);
    }
  }
}

console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);
