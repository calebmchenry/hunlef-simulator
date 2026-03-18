#!/usr/bin/env node
/**
 * Export player armor/body variants and weapon overlays as GLTF using osrscachereader.
 *
 * Follows the existing export-gltf.mjs structure:
 * - animated body exports for idle / eat / attack
 * - static overlay exports for helm, legs, and weapons
 * - color palette data on every export
 */

import { RSCache, IndexType, ConfigType, GLTFExporter } from "osrscachereader";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT = join(import.meta.dirname, "../../public/models");
const CACHE_VERSION = 232;

const BODY_MODEL_ID = 38105;

const BODY_EXPORTS = [
  {
    name: "player_body",
    sequences: [
      ["idle", 808],
      ["eat", 829],
    ],
  },
  {
    name: "player_body_bow",
    sequences: [
      ["idle", 808],
      ["eat", 829],
      ["attack", 426],
    ],
  },
  {
    name: "player_body_staff",
    sequences: [
      ["idle", 808],
      ["eat", 829],
      ["attack", 419],
    ],
  },
  {
    name: "player_body_halberd",
    sequences: [
      ["idle", 808],
      ["eat", 829],
      ["attack", 440],
    ],
  },
];

const STATIC_MODELS = {
  player_helm: 38025,
  player_legs: 38078,
  player_bow: 38302,
  player_staff: 38312,
  player_halberd: 38303,
};

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function applyAnimationNames(gltfJsonText, clipNames) {
  try {
    const gltf = JSON.parse(gltfJsonText);
    if (Array.isArray(gltf.animations)) {
      gltf.animations.forEach((anim, index) => {
        if (index < clipNames.length) {
          anim.name = clipNames[index];
        }
      });
    }
    return JSON.stringify(gltf);
  } catch (e) {
    console.warn(`  Failed to apply animation names: ${e.message}`);
    return gltfJsonText;
  }
}

async function exportAnimatedBody(cache, name, sequenceEntries) {
  console.log(`=== Exporting Animated Player Body: ${name} ===`);
  console.log(`Model ID: ${BODY_MODEL_ID}`);

  try {
    const modelFiles = await cache.getAllFiles(IndexType.MODELS, BODY_MODEL_ID);
    if (!modelFiles || modelFiles.length === 0) {
      throw new Error("Player body model not found in cache");
    }

    const modelDef = modelFiles[0].def;
    if (!modelDef) {
      throw new Error("Player body model has no definition");
    }

    console.log(
      `  Model loaded: ${modelDef.vertexCount} verts, ${modelDef.faceCount} faces`
    );

    const exporter = new GLTFExporter(modelDef);
    const allSeqs = await cache.getAllDefs(
      IndexType.CONFIGS,
      ConfigType.SEQUENCE
    );

    for (const [clipName, seqId] of sequenceEntries) {
      const seqDef = allSeqs[seqId];
      if (!seqDef) {
        console.log(`  Sequence ${clipName} (${seqId}): NOT FOUND, skipping`);
        continue;
      }

      try {
        console.log(
          `  Adding sequence ${clipName} (${seqId}): ${seqDef.frameIDs?.length || 0} frames...`
        );
        await exporter.addSequence(cache, seqDef);
        console.log("    -> OK");
      } catch (e) {
        console.log(`    -> FAILED: ${e.message}`);
      }
    }

    exporter.addColors();

    const clipNames = sequenceEntries.map(([clipName]) => clipName);
    const gltfJson = applyAnimationNames(exporter.export(), clipNames);
    const outPath = join(OUTPUT, `${name}.gltf`);
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
  console.log("Player GLTF Export Tool");
  console.log(`Cache version: ${CACHE_VERSION}\n`);

  ensureDir(OUTPUT);

  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;
  console.log("Cache loaded.\n");

  const bodyResults = [];
  for (const bodyExport of BODY_EXPORTS) {
    bodyResults.push(
      await exportAnimatedBody(cache, bodyExport.name, bodyExport.sequences)
    );
    console.log("");
  }

  console.log("=== Exporting Static Models ===");
  for (const [name, modelId] of Object.entries(STATIC_MODELS)) {
    await exportStaticModel(cache, name, modelId);
  }

  console.log("\n=== DONE ===");
  console.log(
    `Animated body exports: ${bodyResults.every(Boolean) ? "SUCCESS" : "PARTIAL/FAILED"}`
  );

  cache.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
