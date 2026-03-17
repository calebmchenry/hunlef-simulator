#!/usr/bin/env node
/**
 * Export Corrupted Hunlef model + animations as GLTF using osrscachereader.
 *
 * This loads the model from the OSRS cache, adds animation sequences,
 * and exports as GLTF with morph-target animations.
 *
 * Phase 4 of Sprint 007 — this may fail if the animation extraction
 * doesn't work correctly. The fallback is static models (Phase 2).
 */

import { RSCache, IndexType, ConfigType, GLTFExporter } from "osrscachereader";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT = join(import.meta.dirname, "../../public/models");
const CACHE_VERSION = 232;

// Boss model ID
const BOSS_MODEL_ID = 38595;

// Animation sequences for Corrupted Hunlef
const SEQUENCES = {
  idle: 8417,
  magic_attack: 8430,
  ranged_attack: 8431,
  stomp: 8432,
  prayer_disable: 8433,
  death: 8436,
  style_switch_mage: 8754,
  style_switch_range: 8755,
};

// Clip order emitted by exporter.addSequence calls above.
const ANIMATION_CLIP_NAMES = [
  "idle",
  "attack_magic",
  "attack_ranged",
  "stomp",
  "prayer_disable",
  "death",
  "style_switch_mage",
  "style_switch_range",
];

// Other models to export as static GLTF
const STATIC_MODELS = {
  tornado: 38601,
  projectile_magic: 40673,
  projectile_ranged: 40670,
};

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function applyAnimationNames(gltfJsonText) {
  try {
    const gltf = JSON.parse(gltfJsonText);
    if (Array.isArray(gltf.animations)) {
      gltf.animations.forEach((anim, index) => {
        if (index < ANIMATION_CLIP_NAMES.length) {
          anim.name = ANIMATION_CLIP_NAMES[index];
        }
      });
    }
    return JSON.stringify(gltf);
  } catch (e) {
    console.warn(`  Failed to apply animation names: ${e.message}`);
    return gltfJsonText;
  }
}

async function exportAnimatedBoss(cache) {
  console.log("=== Exporting Animated Corrupted Hunlef ===");
  console.log(`Model ID: ${BOSS_MODEL_ID}`);

  try {
    // Load model definition
    const modelFiles = await cache.getAllFiles(IndexType.MODELS, BOSS_MODEL_ID);
    if (!modelFiles || modelFiles.length === 0) {
      throw new Error("Boss model not found in cache");
    }

    const modelDef = modelFiles[0].def;
    if (!modelDef) {
      throw new Error("Boss model has no definition");
    }

    console.log(
      `  Model loaded: ${modelDef.vertexCount} verts, ${modelDef.faceCount} faces`
    );

    // Create GLTF exporter from model
    const exporter = new GLTFExporter(modelDef);

    // Load all sequence definitions
    const allSeqs = await cache.getAllDefs(
      IndexType.CONFIGS,
      ConfigType.SEQUENCE
    );

    // Add each animation sequence
    for (const [name, seqId] of Object.entries(SEQUENCES)) {
      const seqDef = allSeqs[seqId];
      if (!seqDef) {
        console.log(`  Sequence ${name} (${seqId}): NOT FOUND, skipping`);
        continue;
      }

      try {
        console.log(
          `  Adding sequence ${name} (${seqId}): ${seqDef.frameIDs?.length || 0} frames...`
        );
        await exporter.addSequence(cache, seqDef);
        console.log(`    -> OK`);
      } catch (e) {
        console.log(`    -> FAILED: ${e.message}`);
      }
    }

    // Add colors (UV palette texture)
    exporter.addColors();

    // Construct and export
    const gltfJson = applyAnimationNames(exporter.export());
    const outPath = join(OUTPUT, "corrupted_hunlef.gltf");
    writeFileSync(outPath, gltfJson);
    console.log(`  Exported to: ${outPath}`);
    console.log(
      `  File size: ${(Buffer.byteLength(gltfJson) / 1024).toFixed(1)} KB`
    );

    return true;
  } catch (e) {
    console.error(`  EXPORT FAILED: ${e.message}`);
    console.error(`  Stack: ${e.stack}`);
    return false;
  }
}

async function exportStaticModel(cache, name, modelId) {
  console.log(`\n--- Exporting static model: ${name} (${modelId}) ---`);

  try {
    const modelFiles = await cache.getAllFiles(IndexType.MODELS, modelId);
    if (!modelFiles || modelFiles.length === 0) {
      console.log(`  Model ${modelId}: NOT FOUND`);
      return false;
    }

    const modelDef = modelFiles[0].def;
    if (!modelDef) {
      console.log(`  Model ${modelId}: no definition`);
      return false;
    }

    console.log(
      `  Model loaded: ${modelDef.vertexCount} verts, ${modelDef.faceCount} faces`
    );

    const exporter = new GLTFExporter(modelDef);
    exporter.addColors();

    const gltfJson = exporter.export();
    const outPath = join(OUTPUT, `${name}.gltf`);
    writeFileSync(outPath, gltfJson);
    console.log(`  Exported to: ${outPath}`);
    console.log(
      `  File size: ${(Buffer.byteLength(gltfJson) / 1024).toFixed(1)} KB`
    );

    return true;
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log("GLTF Export Tool");
  console.log(`Cache version: ${CACHE_VERSION}\n`);

  ensureDir(OUTPUT);

  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;
  console.log("Cache loaded.\n");

  // Export animated boss
  const bossOk = await exportAnimatedBoss(cache);

  // Export static models
  console.log("\n=== Exporting Static Models ===");
  for (const [name, modelId] of Object.entries(STATIC_MODELS)) {
    await exportStaticModel(cache, name, modelId);
  }

  console.log("\n=== DONE ===");
  console.log(`Boss export: ${bossOk ? "SUCCESS" : "FAILED"}`);

  cache.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
