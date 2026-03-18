#!/usr/bin/env node
/**
 * Sprint 015 Phase 1: Discovery script for player animation sequence IDs
 * and model composition validation.
 *
 * Goals:
 * 1. Find weapon-specific attack animation IDs from item definitions
 * 2. Check if armor models are full-body replacements
 * 3. Test model composition (merging multiple ModelDefs)
 * 4. Validate known animation sequences (idle=808, eat=829) on player models
 */

import { RSCache, IndexType, ConfigType, GLTFExporter } from "osrscachereader";
import { writeFileSync } from "fs";
import { join } from "path";

const CACHE_VERSION = 232;

// Known item IDs from extracted definitions
const ITEMS = {
  corrupted_bow_perfected: 23856,
  corrupted_staff_perfected: 23854,
  corrupted_halberd_perfected: 23850,
  corrupted_helm_perfected: 23843,
  corrupted_body_perfected: 23846,
  corrupted_legs_perfected: 23849,
};

// Known worn model IDs
const MODELS = {
  helm: 38025,
  body: 38105,
  legs: 38078,
  bow: 38302,
  staff: 38312,
  halberd: 38303,
};

// Known player animation IDs to test
const KNOWN_ANIMS = {
  idle: 808,
  eat: 829,
  // Generic attack anims to test
  bow_attack_candidates: [426, 4230, 7552, 7617, 7618, 1074],
  staff_attack_candidates: [419, 393, 414, 440, 7855],
  halberd_attack_candidates: [440, 428, 430, 8145, 8056, 2066, 2067],
};

async function main() {
  console.log("=== Sprint 015 Phase 1: Player Animation Discovery ===\n");

  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;
  console.log("Cache loaded.\n");

  // 1. Load item definitions and check for animation fields
  console.log("=== Step 1: Item Definition Animation Fields ===");
  const items = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.ITEM);

  for (const [name, id] of Object.entries(ITEMS)) {
    const item = items[id];
    if (!item) {
      console.log(`  ${name} (${id}): NOT FOUND`);
      continue;
    }
    console.log(`  ${name} (${id}): ${item.name}`);
    // Print all fields that might contain animation references
    const animFields = {};
    for (const [k, v] of Object.entries(item)) {
      if (
        typeof v === "number" &&
        v > 0 &&
        (k.toLowerCase().includes("anim") ||
          k.toLowerCase().includes("stance") ||
          k.toLowerCase().includes("attack") ||
          k.toLowerCase().includes("block") ||
          k.toLowerCase().includes("walk") ||
          k.toLowerCase().includes("run") ||
          k.toLowerCase().includes("idle") ||
          k.toLowerCase().includes("seq"))
      ) {
        animFields[k] = v;
      }
    }
    if (Object.keys(animFields).length > 0) {
      console.log(`    Animation fields: ${JSON.stringify(animFields)}`);
    } else {
      console.log(`    No animation fields found in item def`);
      // Print params which sometimes contain animation refs
      if (item.params) {
        console.log(`    Params: ${JSON.stringify(item.params)}`);
      }
    }
    console.log(`    maleModel0: ${item.maleModel0}`);
  }

  // 2. Check armor model vertex extents (are they full-body?)
  console.log("\n=== Step 2: Armor Model Analysis ===");
  for (const [name, modelId] of Object.entries(MODELS)) {
    try {
      const files = await cache.getAllFiles(IndexType.MODELS, modelId);
      if (!files || files.length === 0) {
        console.log(`  ${name} (${modelId}): NOT FOUND`);
        continue;
      }
      const def = files[0].def;
      if (!def) {
        console.log(`  ${name} (${modelId}): no definition`);
        continue;
      }
      console.log(
        `  ${name} (${modelId}): ${def.vertexCount} verts, ${def.faceCount} faces`
      );

      // Check vertex extents
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      if (def.vertexPositionsX) {
        for (let i = 0; i < def.vertexCount; i++) {
          minX = Math.min(minX, def.vertexPositionsX[i]);
          maxX = Math.max(maxX, def.vertexPositionsX[i]);
          minY = Math.min(minY, def.vertexPositionsY[i]);
          maxY = Math.max(maxY, def.vertexPositionsY[i]);
          minZ = Math.min(minZ, def.vertexPositionsZ[i]);
          maxZ = Math.max(maxZ, def.vertexPositionsZ[i]);
        }
        console.log(
          `    Extents: X[${minX},${maxX}] Y[${minY},${maxY}] Z[${minZ},${maxZ}]`
        );
        console.log(
          `    Span: X=${maxX - minX} Y=${maxY - minY} Z=${maxZ - minZ}`
        );
      }
    } catch (e) {
      console.log(`  ${name} (${modelId}): ERROR: ${e.message}`);
    }
  }

  // 3. Test model composition — try merging helm + body + legs
  console.log("\n=== Step 3: Model Composition Test ===");
  try {
    const armorModels = [];
    for (const part of ["helm", "body", "legs"]) {
      const files = await cache.getAllFiles(IndexType.MODELS, MODELS[part]);
      if (files && files[0]?.def) {
        armorModels.push({ name: part, def: files[0].def });
      }
    }
    console.log(
      `  Loaded ${armorModels.length} armor parts: ${armorModels.map((m) => m.name).join(", ")}`
    );

    // Check if GLTFExporter can handle merging or if we need manual merge
    // First test: just export body armor alone to verify it works
    const bodyDef = armorModels.find((m) => m.name === "body")?.def;
    if (bodyDef) {
      const testExporter = new GLTFExporter(bodyDef);
      testExporter.addColors();
      const testGltf = testExporter.export();
      console.log(
        `  Single armor part (body) export: ${(Buffer.byteLength(testGltf) / 1024).toFixed(1)} KB — SUCCESS`
      );
    }

    // Try manual vertex buffer merge
    console.log("  Attempting manual vertex buffer merge...");
    const merged = mergeModelDefs(armorModels.map((m) => m.def));
    console.log(
      `  Merged: ${merged.vertexCount} verts, ${merged.faceCount} faces`
    );
    const mergedExporter = new GLTFExporter(merged);
    mergedExporter.addColors();
    const mergedGltf = mergedExporter.export();
    console.log(
      `  Merged armor export: ${(Buffer.byteLength(mergedGltf) / 1024).toFixed(1)} KB — SUCCESS`
    );

    // Now add weapon
    const bowFiles = await cache.getAllFiles(IndexType.MODELS, MODELS.bow);
    if (bowFiles && bowFiles[0]?.def) {
      const withWeapon = mergeModelDefs([
        ...armorModels.map((m) => m.def),
        bowFiles[0].def,
      ]);
      console.log(
        `  Merged armor+bow: ${withWeapon.vertexCount} verts, ${withWeapon.faceCount} faces`
      );
      const weaponExporter = new GLTFExporter(withWeapon);
      weaponExporter.addColors();
      const weaponGltf = weaponExporter.export();
      console.log(
        `  Armor+bow export: ${(Buffer.byteLength(weaponGltf) / 1024).toFixed(1)} KB — SUCCESS`
      );

      // Save test file
      const outPath = join(import.meta.dirname, "../../public/models/player_bow_test.gltf");
      writeFileSync(outPath, weaponGltf);
      console.log(`  Test file saved: ${outPath}`);
    }
  } catch (e) {
    console.error(`  Composition FAILED: ${e.message}`);
    console.error(`  Stack: ${e.stack}`);
  }

  // 4. Test animation sequences on merged model
  console.log("\n=== Step 4: Animation Sequence Testing ===");
  try {
    const allSeqs = await cache.getAllDefs(
      IndexType.CONFIGS,
      ConfigType.SEQUENCE
    );

    // Load merged armor model for testing
    const armorDefs = [];
    for (const part of ["helm", "body", "legs"]) {
      const files = await cache.getAllFiles(IndexType.MODELS, MODELS[part]);
      if (files && files[0]?.def) armorDefs.push(files[0].def);
    }
    const bowFiles = await cache.getAllFiles(IndexType.MODELS, MODELS.bow);
    if (bowFiles && bowFiles[0]?.def) armorDefs.push(bowFiles[0].def);

    const playerModel = mergeModelDefs(armorDefs);

    // Test known animations
    for (const [name, seqId] of Object.entries(KNOWN_ANIMS)) {
      if (Array.isArray(seqId)) continue; // skip candidate arrays for now
      const seq = allSeqs[seqId];
      if (!seq) {
        console.log(`  ${name} (${seqId}): NOT FOUND in cache`);
        continue;
      }
      try {
        const testExp = new GLTFExporter(playerModel);
        await testExp.addSequence(cache, seq);
        console.log(
          `  ${name} (${seqId}): OK — ${seq.frameIDs?.length || 0} frames`
        );
      } catch (e) {
        console.log(`  ${name} (${seqId}): FAILED — ${e.message}`);
      }
    }

    // Test candidate attack animations
    for (const [weaponName, candidates] of Object.entries(KNOWN_ANIMS)) {
      if (!Array.isArray(candidates)) continue;
      console.log(`\n  --- ${weaponName} ---`);
      for (const seqId of candidates) {
        const seq = allSeqs[seqId];
        if (!seq) {
          console.log(`    ${seqId}: NOT FOUND`);
          continue;
        }
        try {
          const testExp = new GLTFExporter(playerModel);
          await testExp.addSequence(cache, seq);
          console.log(
            `    ${seqId}: OK — ${seq.frameIDs?.length || 0} frames`
          );
        } catch (e) {
          console.log(`    ${seqId}: FAILED — ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`  Animation test FAILED: ${e.message}`);
  }

  // 5. Broader animation scan — try a range of player anim IDs
  console.log("\n=== Step 5: Broad Animation Scan (400-900) ===");
  try {
    const allSeqs = await cache.getAllDefs(
      IndexType.CONFIGS,
      ConfigType.SEQUENCE
    );

    const armorDefs = [];
    for (const part of ["helm", "body", "legs"]) {
      const files = await cache.getAllFiles(IndexType.MODELS, MODELS[part]);
      if (files && files[0]?.def) armorDefs.push(files[0].def);
    }
    const playerModel = mergeModelDefs(armorDefs);

    const working = [];
    for (let seqId = 380; seqId <= 850; seqId++) {
      const seq = allSeqs[seqId];
      if (!seq || !seq.frameIDs || seq.frameIDs.length === 0) continue;
      try {
        const testExp = new GLTFExporter(playerModel);
        await testExp.addSequence(cache, seq);
        working.push({
          id: seqId,
          frames: seq.frameIDs.length,
          duration: seq.frameLengths
            ? seq.frameLengths.reduce((a, b) => a + b, 0)
            : "?",
        });
      } catch (_e) {
        // skip failures silently
      }
    }
    console.log(`  Found ${working.length} compatible sequences:`);
    for (const w of working) {
      console.log(`    seq ${w.id}: ${w.frames} frames, duration=${w.duration}`);
    }
  } catch (e) {
    console.error(`  Broad scan FAILED: ${e.message}`);
  }

  cache.close();
  console.log("\n=== DISCOVERY COMPLETE ===");
  process.exit(0);
}

/**
 * Merge multiple ModelDef objects into a single ModelDef by concatenating
 * vertex buffers and offsetting face indices.
 */
function mergeModelDefs(defs) {
  let totalVerts = 0;
  let totalFaces = 0;
  for (const d of defs) {
    totalVerts += d.vertexCount;
    totalFaces += d.faceCount;
  }

  const merged = {
    vertexCount: totalVerts,
    faceCount: totalFaces,
    vertexPositionsX: new Int32Array(totalVerts),
    vertexPositionsY: new Int32Array(totalVerts),
    vertexPositionsZ: new Int32Array(totalVerts),
    faceVertexIndices1: new Int32Array(totalFaces),
    faceVertexIndices2: new Int32Array(totalFaces),
    faceVertexIndices3: new Int32Array(totalFaces),
    faceColors: new Int16Array(totalFaces),
    faceAlphas: d => d.faceAlphas ? new Int32Array(totalFaces) : null,
    faceRenderPriorities: new Int8Array(totalFaces),
    faceRenderTypes: new Int8Array(totalFaces),
    textureCoordinateU: null,
    textureCoordinateV: null,
    textureFaces: null,
    textureRenderTypes: null,
  };

  // Check if any model has faceAlphas
  const hasFaceAlphas = defs.some((d) => d.faceAlphas);
  merged.faceAlphas = hasFaceAlphas ? new Int32Array(totalFaces) : null;

  let vOff = 0;
  let fOff = 0;
  for (const d of defs) {
    // Copy vertices
    for (let i = 0; i < d.vertexCount; i++) {
      merged.vertexPositionsX[vOff + i] = d.vertexPositionsX[i];
      merged.vertexPositionsY[vOff + i] = d.vertexPositionsY[i];
      merged.vertexPositionsZ[vOff + i] = d.vertexPositionsZ[i];
    }
    // Copy faces with vertex index offset
    for (let i = 0; i < d.faceCount; i++) {
      merged.faceVertexIndices1[fOff + i] = d.faceVertexIndices1[i] + vOff;
      merged.faceVertexIndices2[fOff + i] = d.faceVertexIndices2[i] + vOff;
      merged.faceVertexIndices3[fOff + i] = d.faceVertexIndices3[i] + vOff;
      merged.faceColors[fOff + i] = d.faceColors ? d.faceColors[i] : 0;
      if (merged.faceAlphas && d.faceAlphas) {
        merged.faceAlphas[fOff + i] = d.faceAlphas[i];
      }
      merged.faceRenderPriorities[fOff + i] = d.faceRenderPriorities
        ? d.faceRenderPriorities[i]
        : 0;
      merged.faceRenderTypes[fOff + i] = d.faceRenderTypes
        ? d.faceRenderTypes[i]
        : 0;
    }
    vOff += d.vertexCount;
    fOff += d.faceCount;
  }

  return merged;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
