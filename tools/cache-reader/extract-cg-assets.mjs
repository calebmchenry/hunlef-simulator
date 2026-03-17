#!/usr/bin/env node
/**
 * Corrupted Gauntlet Asset Extractor
 *
 * Pulls all assets needed for the CG Hunlef fight simulator from the OSRS cache.
 * Uses osrscachereader to decode cache data from OpenRS2.
 */

import { RSCache, IndexType, ConfigType } from "osrscachereader";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createCanvas } from "canvas";

const OUTPUT = join(import.meta.dirname, "../../docs/assets");
const CACHE_VERSION = 232;

// --- Asset IDs we need ---

const NPC_IDS = [9035, 9036, 9037, 9038, 9039]; // Corrupted Hunlef (4 variants) + Tornado
const SPOTANIM_IDS = [1708, 1710, 1712, 1714, 1716, 1718]; // Corrupted projectiles + floor tile
const OBJECT_IDS = [36048]; // Floor hazard tile

// Prayer icon sprites
const SPRITE_IDS = [127, 128, 147, 148];

// Animation sequences (Corrupted Hunlef)
const SEQUENCE_IDS = [
  8416, 8417, // walk, idle (from NPC def)
  8419, 8420, // generic attack, stomp (from performance tracker)
  8422, // idle alt
  8430, 8431, 8432, 8433, 8434, 8435, 8436, // magic, ranged, stomp, prayer-disable, walk, ready, death
  8754, 8755, // style switch to mage, style switch to range
];

// We'll discover model IDs from NPC/spotanim/object defs
const discoveredModelIds = new Set();
const discoveredSpriteIds = new Set(SPRITE_IDS);

// --- Helpers ---

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

function saveDef(subdir, name, def) {
  const dir = join(OUTPUT, subdir);
  ensureDir(dir);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(def, null, 2));
}

// --- Extraction functions ---

async function extractNpcs(cache) {
  console.log("\n=== NPC Definitions ===");
  const allDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.NPC);

  for (const id of NPC_IDS) {
    const def = allDefs[id];
    if (!def) {
      console.log(`  NPC ${id}: NOT FOUND`);
      continue;
    }
    const cleaned = cleanDef(def);
    saveDef("defs/npcs", `npc_${id}`, cleaned);
    console.log(`  NPC ${id}: ${cleaned.name} (models: [${cleaned.models}], stand: ${cleaned.standingAnimation}, walk: ${cleaned.walkingAnimation})`);

    // Collect model IDs
    if (cleaned.models) cleaned.models.forEach((m) => discoveredModelIds.add(m));
    // Collect animation IDs from NPC def
    if (cleaned.standingAnimation > 0 && !SEQUENCE_IDS.includes(cleaned.standingAnimation)) {
      SEQUENCE_IDS.push(cleaned.standingAnimation);
    }
    if (cleaned.walkingAnimation > 0 && !SEQUENCE_IDS.includes(cleaned.walkingAnimation)) {
      SEQUENCE_IDS.push(cleaned.walkingAnimation);
    }
  }
}

async function extractSpotanims(cache) {
  console.log("\n=== SpotAnim/Graphics Definitions ===");
  const allDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SPOTANIM);

  for (const id of SPOTANIM_IDS) {
    const def = allDefs[id];
    if (!def) {
      console.log(`  SpotAnim ${id}: NOT FOUND`);
      continue;
    }
    const cleaned = cleanDef(def);
    saveDef("defs/spotanims", `spotanim_${id}`, cleaned);
    console.log(`  SpotAnim ${id}: model=${cleaned.modelId}, seq=${cleaned.sequenceId}`);

    // Collect model and sequence IDs
    if (cleaned.modelId > 0) discoveredModelIds.add(cleaned.modelId);
    if (cleaned.sequenceId > 0 && !SEQUENCE_IDS.includes(cleaned.sequenceId)) {
      SEQUENCE_IDS.push(cleaned.sequenceId);
    }
  }
}

async function extractObjects(cache) {
  console.log("\n=== Object Definitions ===");
  const allDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.OBJECT);

  for (const id of OBJECT_IDS) {
    const def = allDefs[id];
    if (!def) {
      console.log(`  Object ${id}: NOT FOUND`);
      continue;
    }
    const cleaned = cleanDef(def);
    saveDef("defs/objects", `object_${id}`, cleaned);
    console.log(`  Object ${id}: ${cleaned.name} (models: ${JSON.stringify(cleaned.objectModels || cleaned.models)})`);

    // Collect model IDs
    const models = cleaned.objectModels || cleaned.models || [];
    if (Array.isArray(models)) models.forEach((m) => { if (m > 0) discoveredModelIds.add(m); });
  }
}

async function extractSequences(cache) {
  console.log("\n=== Animation Sequences ===");
  const allDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SEQUENCE);

  for (const id of SEQUENCE_IDS) {
    const def = allDefs[id];
    if (!def) {
      console.log(`  Sequence ${id}: NOT FOUND`);
      continue;
    }
    const cleaned = cleanDef(def);
    saveDef("defs/sequences", `seq_${id}`, cleaned);
    const frameCount = cleaned.frameIds ? cleaned.frameIds.length : 0;
    const totalDuration = cleaned.frameLengths ? cleaned.frameLengths.reduce((a, b) => a + b, 0) : 0;
    console.log(`  Sequence ${id}: ${frameCount} frames, total duration=${totalDuration} ticks`);
  }
}

async function extractSprites(cache) {
  console.log("\n=== Sprites ===");
  const dir = join(OUTPUT, "sprites");
  ensureDir(dir);

  const spriteIds = [...discoveredSpriteIds];
  let count = 0;

  for (const spriteId of spriteIds) {
    try {
      const files = await cache.getAllFiles(IndexType.SPRITES, spriteId);
      if (!files) {
        console.log(`  Sprite ${spriteId}: NOT FOUND`);
        continue;
      }

      for (const file of files) {
        if (!file || !file.def || !file.def.sprites) continue;

        for (const sprite of file.def.sprites) {
          if (!sprite || sprite.width === 0 || sprite.height === 0) continue;

          try {
            const canvas = createCanvas(sprite.width, sprite.height);
            const ctx = canvas.getContext("2d");
            const imageData = sprite.createImageData(ctx);
            ctx.putImageData(imageData, 0, 0);

            const buffer = canvas.toBuffer("image/png");
            const filename = `sprite_${spriteId}_frame${sprite.frame}.png`;
            writeFileSync(join(dir, filename), buffer);
            count++;
            console.log(`  Sprite ${spriteId} frame ${sprite.frame}: ${sprite.width}x${sprite.height} -> ${filename}`);
          } catch (e) {
            console.log(`  Sprite ${spriteId} frame ${sprite.frame}: RENDER FAILED - ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`  Sprite ${spriteId}: LOAD FAILED - ${e.message}`);
    }
  }

  console.log(`  Total: ${count} sprite images`);
}

async function extractModels(cache) {
  console.log("\n=== Models ===");
  const dir = join(OUTPUT, "models");
  ensureDir(dir);

  const modelIds = [...discoveredModelIds].sort((a, b) => a - b);
  console.log(`  Discovered ${modelIds.length} model IDs: [${modelIds.join(", ")}]`);

  let count = 0;
  for (const modelId of modelIds) {
    try {
      const files = await cache.getAllFiles(IndexType.MODELS, modelId);
      if (!files) {
        console.log(`  Model ${modelId}: NOT FOUND`);
        continue;
      }

      for (const file of files) {
        if (!file || !file.def) continue;
        const cleaned = cleanDef(file.def);
        writeFileSync(join(dir, `model_${modelId}.json`), JSON.stringify(cleaned, null, 2));
        count++;

        // Log basic info
        const vCount = cleaned.vertexCount || cleaned.verticesCount || "?";
        const fCount = cleaned.faceCount || cleaned.facesCount || "?";
        console.log(`  Model ${modelId}: ${vCount} vertices, ${fCount} faces`);
      }
    } catch (e) {
      console.log(`  Model ${modelId}: EXTRACT FAILED - ${e.message}`);
    }
  }

  console.log(`  Total: ${count} models`);
}

// Also extract item definitions for inventory icons
async function extractItems(cache) {
  console.log("\n=== Item Definitions (inventory items) ===");
  const allDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.ITEM);

  // We need to find corrupted bow, staff, halberd (each tier), paddlefish, corrupted paddlefish, egniol potion
  // Search by name since we don't have item IDs memorized
  const searchTerms = [
    "corrupted bow", "corrupted staff", "corrupted halberd",
    "corrupted helm", "corrupted body", "corrupted legs",
    "corrupted paddlefish", "paddlefish",
    "egniol",
  ];

  const foundItems = [];

  for (let i = 0; i < allDefs.length; i++) {
    const def = allDefs[i];
    if (!def || !def.name) continue;
    const nameLower = def.name.toLowerCase();

    for (const term of searchTerms) {
      if (nameLower.includes(term)) {
        const cleaned = cleanDef(def);
        foundItems.push(cleaned);
        saveDef("defs/items", `item_${cleaned.id}`, cleaned);
        console.log(`  Item ${cleaned.id}: ${cleaned.name} (model: ${cleaned.inventoryModel}, sprite: ${cleaned.spriteId || "?"})`);

        // Collect inventory model
        if (cleaned.inventoryModel > 0) discoveredModelIds.add(cleaned.inventoryModel);
        break;
      }
    }
  }

  console.log(`  Total: ${foundItems.length} items`);
}

// --- Main ---

async function main() {
  console.log("Corrupted Gauntlet Asset Extractor");
  console.log(`Cache version: ${CACHE_VERSION}`);
  console.log(`Output: ${OUTPUT}`);
  ensureDir(OUTPUT);

  console.log("\nLoading cache...");
  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;
  console.log("Cache loaded.");

  // Phase 1: Extract definitions (discovers model IDs along the way)
  await extractNpcs(cache);
  await extractSpotanims(cache);
  await extractObjects(cache);
  await extractItems(cache);

  // Phase 2: Extract sequences (now includes any discovered from phase 1)
  await extractSequences(cache);

  // Phase 3: Extract sprites
  await extractSprites(cache);

  // Phase 4: Extract models (using all discovered model IDs)
  await extractModels(cache);

  // Write a manifest of everything extracted
  const manifest = {
    cacheVersion: CACHE_VERSION,
    extractedAt: new Date().toISOString(),
    npcIds: NPC_IDS,
    spotanimIds: SPOTANIM_IDS,
    objectIds: OBJECT_IDS,
    spriteIds: [...discoveredSpriteIds],
    sequenceIds: SEQUENCE_IDS,
    modelIds: [...discoveredModelIds].sort((a, b) => a - b),
  };
  writeFileSync(join(OUTPUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${join(OUTPUT, "manifest.json")}`);

  console.log("\n=== DONE ===");
  cache.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
