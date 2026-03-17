#!/usr/bin/env node
/**
 * Phase 2: Extract additional sequences (from spotanims) and sound effects.
 */

import { RSCache, IndexType, ConfigType } from "osrscachereader";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const OUTPUT = join(import.meta.dirname, "../../docs/assets");
const CACHE_VERSION = 232;

// Sequences referenced by spotanims that we didn't extract in phase 1
const EXTRA_SEQUENCE_IDS = [8757, 693, 8756, 7884, 8424];

// Sound IDs discovered in sequence frameSounds
const SOUND_IDS = [977, 2251, 2524, 3821, 3907, 4144, 4150, 4153, 4186, 4188];

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function cleanDef(def) {
  if (!def) return null;
  const obj = {};
  for (const [key, value] of Object.entries(def)) {
    if (key === "pixels" || key === "pixelIdx" || key === "palette") continue;
    if (typeof value === "function") continue;
    obj[key] = value;
  }
  return obj;
}

async function main() {
  console.log("Phase 2: Additional sequences + sound effects");
  console.log(`Cache version: ${CACHE_VERSION}\n`);

  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;
  console.log("Cache loaded.\n");

  // Extract additional sequences
  console.log("=== Additional Sequences (from spotanims) ===");
  const seqDir = join(OUTPUT, "defs/sequences");
  ensureDir(seqDir);
  const allSeqs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SEQUENCE);

  const newSounds = new Set();

  for (const id of EXTRA_SEQUENCE_IDS) {
    const def = allSeqs[id];
    if (!def) {
      console.log(`  Sequence ${id}: NOT FOUND`);
      continue;
    }
    const cleaned = cleanDef(def);
    writeFileSync(join(seqDir, `seq_${id}.json`), JSON.stringify(cleaned, null, 2));
    const frameCount = cleaned.frameIDs ? cleaned.frameIDs.length : (cleaned.frameLengths ? cleaned.frameLengths.length : 0);
    console.log(`  Sequence ${id}: ${frameCount} frames`);

    // Collect any additional sound IDs
    if (cleaned.frameSounds) {
      for (const s of cleaned.frameSounds) {
        if (s && s.id && !SOUND_IDS.includes(s.id)) {
          newSounds.add(s.id);
        }
      }
    }
  }

  if (newSounds.size > 0) {
    console.log(`  Found additional sound IDs: ${[...newSounds].join(", ")}`);
    for (const s of newSounds) SOUND_IDS.push(s);
  }

  // Extract sound effects
  console.log("\n=== Sound Effects ===");
  const soundDir = join(OUTPUT, "sounds");
  ensureDir(soundDir);

  let soundCount = 0;
  for (const soundId of SOUND_IDS) {
    try {
      const files = await cache.getAllFiles(IndexType.SOUNDEFFECTS, soundId);
      if (!files || files.length === 0) {
        console.log(`  Sound ${soundId}: NOT FOUND in SOUNDEFFECTS`);
        continue;
      }

      for (const file of files) {
        if (!file) continue;
        // Get raw data - sound effects are in OSRS synth format
        const data = file.data || file.rawData || file;
        if (data && data.length) {
          writeFileSync(join(soundDir, `sound_${soundId}.dat`), Buffer.from(data));
          console.log(`  Sound ${soundId}: ${data.length} bytes`);
          soundCount++;
        } else if (file.def) {
          // Try to get the definition
          const cleaned = cleanDef(file.def);
          writeFileSync(join(soundDir, `sound_${soundId}.json`), JSON.stringify(cleaned, null, 2));
          console.log(`  Sound ${soundId}: saved as JSON def`);
          soundCount++;
        } else {
          console.log(`  Sound ${soundId}: no data extractable`);
        }
      }
    } catch (e) {
      console.log(`  Sound ${soundId}: FAILED - ${e.message}`);
    }
  }

  console.log(`  Total: ${soundCount} sounds`);

  // Update manifest
  const manifestPath = join(OUTPUT, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.additionalSequenceIds = EXTRA_SEQUENCE_IDS;
  manifest.soundIds = SOUND_IDS;
  manifest.phase2ExtractedAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log("\n=== DONE ===");
  cache.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
