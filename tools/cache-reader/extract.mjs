#!/usr/bin/env node
/**
 * OSRS Cache Extractor
 *
 * Extracts game data from OSRS cache files using osrscachereader.
 * Supports loading from:
 *   - Local cache directory (containing main_file_cache.dat2 + .idx files)
 *   - OpenRS2 archive URL (e.g. https://archive.openrs2.org/caches/runescape/1718/disk.zip)
 *   - OpenRS2 version number (e.g. 220)
 *   - "latest" for the most recent cache
 *
 * Usage:
 *   node extract.mjs --source <path|url|version|latest> --output <dir> [options]
 *
 * Options:
 *   --source, -s    Cache source (path, URL, version number, or "latest")
 *   --output, -o    Output directory (default: ./output)
 *   --sprites       Extract sprites as PNG images
 *   --npcs          Extract NPC definitions as JSON
 *   --items         Extract item definitions as JSON
 *   --objects       Extract object definitions as JSON
 *   --spotanims     Extract spot animation (GFX) definitions as JSON
 *   --sequences     Extract animation sequence definitions as JSON
 *   --models        Extract model data as GLTF
 *   --all           Extract everything
 *   --id <n>        Extract only a specific ID (for single-item extraction)
 *   --help, -h      Show this help message
 */

import { RSCache, IndexType, ConfigType, GLTFExporter } from "osrscachereader";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createCanvas } from "canvas";

// ---------- CLI argument parsing ----------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    source: null,
    output: "./output",
    sprites: false,
    npcs: false,
    items: false,
    objects: false,
    spotanims: false,
    sequences: false,
    models: false,
    all: false,
    id: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--source":
      case "-s":
        opts.source = args[++i];
        break;
      case "--output":
      case "-o":
        opts.output = args[++i];
        break;
      case "--sprites":
        opts.sprites = true;
        break;
      case "--npcs":
        opts.npcs = true;
        break;
      case "--items":
        opts.items = true;
        break;
      case "--objects":
        opts.objects = true;
        break;
      case "--spotanims":
        opts.spotanims = true;
        break;
      case "--sequences":
        opts.sequences = true;
        break;
      case "--models":
        opts.models = true;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--id":
        opts.id = parseInt(args[++i], 10);
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
    }
  }

  if (opts.all) {
    opts.sprites = true;
    opts.npcs = true;
    opts.items = true;
    opts.objects = true;
    opts.spotanims = true;
    opts.sequences = true;
  }

  return opts;
}

function printHelp() {
  console.log(`
OSRS Cache Extractor

Usage:
  node extract.mjs --source <path|url|version|latest> --output <dir> [options]

Sources:
  --source ./cache/              Local cache directory
  --source ./cache.zip           Local zip file
  --source https://archive.openrs2.org/caches/runescape/1718/disk.zip
  --source 220                   Cache version number
  --source latest                Most recent cache

Extraction options:
  --sprites       Extract sprites as PNG images
  --npcs          Extract NPC definitions as JSON
  --items         Extract item definitions as JSON
  --objects       Extract object definitions as JSON
  --spotanims     Extract spot animation (GFX) definitions as JSON
  --sequences     Extract animation sequence definitions as JSON
  --models        Extract 3D model data (raw bytes)
  --all           Extract all definition types (sprites, NPCs, items, objects, spotanims, sequences)
  --id <n>        Extract only a specific ID

Output:
  --output, -o    Output directory (default: ./output)

Examples:
  node extract.mjs -s latest -o ./out --npcs
  node extract.mjs -s ./cache/ -o ./out --sprites --id 42
  node extract.mjs -s 220 -o ./out --all
`);
}

// ---------- Helpers ----------

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function cleanDef(def) {
  // Remove internal fields and produce a clean JSON-serializable object
  if (!def) return null;
  const obj = {};
  for (const [key, value] of Object.entries(def)) {
    // Skip pixel data, palette data, and other non-serializable internals
    if (key === "pixels" || key === "pixelIdx" || key === "palette") continue;
    if (typeof value === "function") continue;
    obj[key] = value;
  }
  return obj;
}

// ---------- Extraction functions ----------

async function extractSprites(cache, outputDir, specificId) {
  const dir = join(outputDir, "sprites");
  ensureDir(dir);

  console.log("Extracting sprites...");
  const index = cache.getIndex(IndexType.SPRITES);
  const archiveIds = Object.keys(index.archives).map(Number);

  let count = 0;
  for (const archiveId of archiveIds) {
    if (specificId !== null && archiveId !== specificId) continue;

    try {
      const files = await cache.getAllFiles(IndexType.SPRITES, archiveId);
      if (!files) continue;

      for (const file of files) {
        if (!file || !file.def) continue;
        const spriteDef = file.def;

        if (spriteDef.sprites) {
          for (const sprite of spriteDef.sprites) {
            if (!sprite || sprite.width === 0 || sprite.height === 0) continue;

            try {
              const canvas = createCanvas(sprite.width, sprite.height);
              const ctx = canvas.getContext("2d");
              const imageData = sprite.createImageData(ctx);
              ctx.putImageData(imageData, 0, 0);

              const buffer = canvas.toBuffer("image/png");
              const filename = `sprite_${archiveId}_frame${sprite.frame}.png`;
              writeFileSync(join(dir, filename), buffer);
              count++;
            } catch (e) {
              // Skip sprites that fail to render
            }
          }
        }
      }
    } catch (e) {
      // Skip archives that fail to load
    }
  }

  console.log(`  Extracted ${count} sprite images to ${dir}`);
}

async function extractConfigDefs(cache, configType, typeName, outputDir, specificId) {
  const dir = join(outputDir, typeName);
  ensureDir(dir);

  console.log(`Extracting ${typeName} definitions...`);

  try {
    const defs = await cache.getAllDefs(IndexType.CONFIGS, configType);
    if (!defs) {
      console.log(`  No ${typeName} definitions found.`);
      return;
    }

    let count = 0;

    if (specificId !== null) {
      const def = defs[specificId];
      if (def) {
        const cleaned = cleanDef(def);
        writeFileSync(
          join(dir, `${typeName}_${specificId}.json`),
          JSON.stringify(cleaned, null, 2)
        );
        count = 1;
      }
    } else {
      // Write individual files
      const allDefs = [];
      for (const def of defs) {
        if (!def) continue;
        const cleaned = cleanDef(def);
        allDefs.push(cleaned);
        count++;
      }
      // Write a combined file
      writeFileSync(
        join(dir, `${typeName}_all.json`),
        JSON.stringify(allDefs, null, 2)
      );
    }

    console.log(`  Extracted ${count} ${typeName} definitions to ${dir}`);
  } catch (e) {
    console.error(`  Error extracting ${typeName}:`, e.message || e);
  }
}

async function extractModels(cache, outputDir, specificId) {
  const dir = join(outputDir, "models");
  ensureDir(dir);

  console.log("Extracting models...");
  const index = cache.getIndex(IndexType.MODELS);
  const archiveIds = Object.keys(index.archives).map(Number);

  let count = 0;
  const idsToExtract = specificId !== null ? [specificId] : archiveIds.slice(0, 100); // limit to 100 by default for models

  for (const archiveId of idsToExtract) {
    try {
      const files = await cache.getAllFiles(IndexType.MODELS, archiveId);
      if (!files) continue;

      for (const file of files) {
        if (!file || !file.def) continue;
        const modelDef = file.def;
        const cleaned = cleanDef(modelDef);
        writeFileSync(
          join(dir, `model_${archiveId}.json`),
          JSON.stringify(cleaned, null, 2)
        );
        count++;
      }
    } catch (e) {
      // Skip models that fail
    }
  }

  console.log(`  Extracted ${count} model definitions to ${dir}`);
  if (specificId === null) {
    console.log(`  (Limited to first 100 models. Use --id <n> for specific models.)`);
  }
}

// ---------- Main ----------

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!opts.source) {
    console.error("Error: --source is required. Use --help for usage info.");
    process.exit(1);
  }

  const nothingSelected =
    !opts.sprites && !opts.npcs && !opts.items && !opts.objects &&
    !opts.spotanims && !opts.sequences && !opts.models;

  if (nothingSelected) {
    console.error("Error: No extraction type specified. Use --all or specific flags. Use --help for usage info.");
    process.exit(1);
  }

  ensureDir(opts.output);

  // Determine source - if it's a number, parse it
  let source = opts.source;
  if (source !== "latest" && !isNaN(source) && !source.includes("/") && !source.includes(".")) {
    source = parseInt(source, 10);
  }

  console.log(`Loading cache from: ${source}`);
  console.log(`Output directory: ${opts.output}`);
  console.log("");

  const cache = new RSCache(source, (progress) => {
    // progress callback
  });

  await cache.onload;
  console.log("Cache loaded successfully.\n");

  // Run extractions
  if (opts.npcs) {
    await extractConfigDefs(cache, ConfigType.NPC, "npcs", opts.output, opts.id);
  }

  if (opts.items) {
    await extractConfigDefs(cache, ConfigType.ITEM, "items", opts.output, opts.id);
  }

  if (opts.objects) {
    await extractConfigDefs(cache, ConfigType.OBJECT, "objects", opts.output, opts.id);
  }

  if (opts.spotanims) {
    await extractConfigDefs(cache, ConfigType.SPOTANIM, "spotanims", opts.output, opts.id);
  }

  if (opts.sequences) {
    await extractConfigDefs(cache, ConfigType.SEQUENCE, "sequences", opts.output, opts.id);
  }

  if (opts.sprites) {
    await extractSprites(cache, opts.output, opts.id);
  }

  if (opts.models) {
    await extractModels(cache, opts.output, opts.id);
  }

  console.log("\nDone.");
  cache.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
