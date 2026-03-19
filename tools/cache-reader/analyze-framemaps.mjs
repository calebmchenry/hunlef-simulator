#!/usr/bin/env node
/**
 * Analyze framemaps for attack vs style-switch animations
 * to understand why attack anims look exploded on model 38595 (165 groups).
 */

import { RSCache, IndexType, ConfigType } from "osrscachereader";

const CACHE_VERSION = 232;
const BOSS_MODEL_ID = 38595;

// NPC IDs for Corrupted Hunlef variants
const NPC_IDS = [9035, 9036, 9037, 9038];

const ANIMS = {
  attack_magic:       { seqId: 8430 },
  attack_ranged:      { seqId: 8431 },
  stomp:              { seqId: 8432 },
  prayer_disable:     { seqId: 8433 },
  idle:               { seqId: 8417 },
  style_switch_mage:  { seqId: 8754 },
  style_switch_range: { seqId: 8755 },
  death:              { seqId: 8436 },
};

async function main() {
  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;

  try {
    // =========================================================================
    // 1. NPC definition analysis — check models array
    // =========================================================================
    console.log("=".repeat(80));
    console.log("SECTION 1: NPC Definitions");
    console.log("=".repeat(80));

    const allNpcDefs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.NPC);
    for (const npcId of NPC_IDS) {
      const def = allNpcDefs[npcId];
      if (!def) { console.log(`NPC ${npcId}: NOT FOUND`); continue; }
      console.log(`NPC ${npcId}: name="${def.name}" models=[${def.models}]`);
      console.log(`  standAnim=${def.standingAnimation} walkAnim=${def.walkingAnimation}`);
      if (def.recolorToFind?.length) {
        console.log(`  recolorToFind=[${def.recolorToFind}]`);
        console.log(`  recolorToReplace=[${def.recolorToReplace}]`);
      }
      // Check for any additional model-related fields
      const interesting = ['models', 'chatheadModels', 'heightScale', 'widthScale',
                           'transforms', 'configs', 'varbitId', 'settingId'];
      for (const key of interesting) {
        if (def[key] !== undefined && def[key] !== null && def[key] !== -1) {
          if (key === 'models') continue; // already printed
          console.log(`  ${key}=${JSON.stringify(def[key])}`);
        }
      }
    }

    // =========================================================================
    // 2. Model analysis — vertex groups
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 2: Model 38595 Vertex Groups");
    console.log("=".repeat(80));

    const modelFiles = await cache.getAllFiles(IndexType.MODELS, BOSS_MODEL_ID);
    const modelDef = modelFiles[0].def;
    const groups = modelDef.vertexGroups ?? [];
    console.log(`Model ${BOSS_MODEL_ID}: ${modelDef.vertexCount} vertices, ${modelDef.faceCount} faces, ${groups.length} vertex groups`);

    const emptyGroups = [];
    const nonEmptyGroups = [];
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g] ?? [];
      if (grp.length === 0) emptyGroups.push(g);
      else nonEmptyGroups.push({ g, count: grp.length });
    }
    console.log(`  Non-empty groups: ${nonEmptyGroups.length}`);
    console.log(`  Empty groups: ${emptyGroups.length} → [${emptyGroups.join(', ')}]`);

    // =========================================================================
    // 3. Sequence definitions
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 3: Sequence Definitions");
    console.log("=".repeat(80));

    const allSeqs = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SEQUENCE);

    for (const [name, info] of Object.entries(ANIMS)) {
      const seq = allSeqs[info.seqId];
      if (!seq) { console.log(`${name} (${info.seqId}): NOT FOUND`); continue; }
      const firstFrameId = seq.frameIDs?.[0] ?? -1;
      const archiveId = firstFrameId >> 16;
      console.log(`${name} (seq ${info.seqId}): ${seq.frameIDs?.length ?? 0} frames, firstFrameID=${firstFrameId}, archive=${archiveId}`);
      info.seq = seq;
      info.archiveId = archiveId;
    }

    // =========================================================================
    // 4. Framemap analysis per archive
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 4: Framemap Analysis");
    console.log("=".repeat(80));

    // Collect unique archive IDs
    const archiveIds = new Set();
    for (const info of Object.values(ANIMS)) {
      if (info.archiveId) archiveIds.add(info.archiveId);
    }

    const archiveFramemaps = new Map();

    for (const archId of archiveIds) {
      console.log(`\n--- Archive ${archId} ---`);
      const files = await cache.getAllFiles(IndexType.FRAMES, archId);
      if (!files || files.length === 0) { console.log("  NO FILES"); continue; }

      // All frames in an archive share the same framemap
      const firstFrame = files.find(f => f?.def);
      if (!firstFrame) { console.log("  NO VALID FRAMES"); continue; }

      const framemap = firstFrame.def.framemap;
      archiveFramemaps.set(archId, framemap);

      console.log(`  Framemap ID: ${framemap.id}`);
      console.log(`  Slot count: ${framemap.types.length}`);

      const GROUP_LIMIT = groups.length; // 165

      let oobSlots = 0;
      let mixedSlots = 0;
      let pureInBoundsSlots = 0;

      for (let s = 0; s < framemap.types.length; s++) {
        const type = framemap.types[s];
        const fm = framemap.frameMaps[s] ?? [];
        const inBounds = fm.filter(g => g < GROUP_LIMIT);
        const outOfBounds = fm.filter(g => g >= GROUP_LIMIT);

        if (outOfBounds.length > 0) {
          const label = inBounds.length > 0 ? "MIXED" : "ALL-OOB";
          if (label === "ALL-OOB") oobSlots++;
          else mixedSlots++;

          console.log(`  Slot ${s}: type=${type} groups=[${fm.join(',')}] → ${label} (inBounds=${inBounds.length}, OOB=${outOfBounds.length})`);
        } else {
          pureInBoundsSlots++;
        }
      }

      console.log(`  Summary: ${pureInBoundsSlots} pure in-bounds, ${mixedSlots} mixed, ${oobSlots} all-OOB`);
    }

    // =========================================================================
    // 5. Detailed animation step trace for first frame of attack_magic vs style_switch_mage
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 5: Step-by-Step Trace (first frame)");
    console.log("=".repeat(80));

    const GROUP_LIMIT = groups.length;

    for (const traceName of ['attack_magic', 'style_switch_mage']) {
      const info = ANIMS[traceName];
      if (!info.seq) continue;

      const firstFrameId = info.seq.frameIDs[0];
      const archId = firstFrameId >> 16;
      const frameIdx = firstFrameId & 0xffff;

      const files = await cache.getAllFiles(IndexType.FRAMES, archId);
      const frameFile = files.find(f => f?.id === frameIdx);
      if (!frameFile) { console.log(`${traceName}: frame ${frameIdx} not found in archive ${archId}`); continue; }
      const frame = frameFile.def;

      console.log(`\n--- ${traceName} (frame 0, frameID=${firstFrameId}) ---`);
      console.log(`  Steps: ${frame.translator_x.length}`);

      let animOffsets = { x: 0, y: 0, z: 0 };
      let lastPivotInfo = "";

      for (let i = 0; i < frame.translator_x.length; i++) {
        const slot = frame.indexFrameIds[i];
        const type = frame.framemap.types[slot];
        const targetGroups = frame.framemap.frameMaps[slot] ?? [];
        const dx = frame.translator_x[i];
        const dy = frame.translator_y[i];
        const dz = frame.translator_z[i];

        const inBounds = targetGroups.filter(g => g < GROUP_LIMIT);
        const outOfBounds = targetGroups.filter(g => g >= GROUP_LIMIT);
        const oobLabel = outOfBounds.length > 0
          ? (inBounds.length > 0 ? " [MIXED]" : " [ALL-OOB]")
          : "";

        if (type === 0) {
          // Compute what the pivot would be
          let sumX = 0, sumY = 0, sumZ = 0, count = 0;
          for (const gi of targetGroups) {
            if (gi >= GROUP_LIMIT) continue;
            const grp = groups[gi] ?? [];
            for (const vi of grp) {
              sumX += modelDef.vertexPositionsX[vi];
              sumY += modelDef.vertexPositionsY[vi];
              sumZ += modelDef.vertexPositionsZ[vi];
              count++;
            }
          }

          if (count > 0) {
            animOffsets.x = dx + sumX / count;
            animOffsets.y = dy + sumY / count;
            animOffsets.z = dz + sumZ / count;
          } else {
            animOffsets.x = dx;
            animOffsets.y = dy;
            animOffsets.z = dz;
          }

          lastPivotInfo = `pivot=(${animOffsets.x.toFixed(1)}, ${animOffsets.y.toFixed(1)}, ${animOffsets.z.toFixed(1)}) vtxCount=${count}`;
          console.log(`  Step ${i}: type=0(PIVOT) slot=${slot} groups=[${targetGroups.join(',')}]${oobLabel} dx,dy,dz=(${dx},${dy},${dz}) → ${lastPivotInfo}`);
        } else if (type === 1) {
          console.log(`  Step ${i}: type=1(TRANSLATE) slot=${slot} groups=[${targetGroups.join(',')}]${oobLabel} dx,dy,dz=(${dx},${dy},${dz}) → inBoundsAffected=${inBounds.length > 0}`);
        } else if (type === 2) {
          const angleX = ((dx & 255) * 8 * Math.PI) / 1024;
          const angleY = ((dy & 255) * 8 * Math.PI) / 1024;
          const angleZ = ((dz & 255) * 8 * Math.PI) / 1024;
          const degX = (angleX * 180 / Math.PI).toFixed(1);
          const degY = (angleY * 180 / Math.PI).toFixed(1);
          const degZ = (angleZ * 180 / Math.PI).toFixed(1);
          console.log(`  Step ${i}: type=2(ROTATE) slot=${slot} groups=[${targetGroups.join(',')}]${oobLabel} raw=(${dx},${dy},${dz}) angles=(${degX}°,${degY}°,${degZ}°) pivot=(${animOffsets.x.toFixed(1)},${animOffsets.y.toFixed(1)},${animOffsets.z.toFixed(1)})`);
        } else if (type === 3) {
          console.log(`  Step ${i}: type=3(SCALE) slot=${slot} groups=[${targetGroups.join(',')}]${oobLabel} sx,sy,sz=(${dx/128},${dy/128},${dz/128})`);
        } else {
          console.log(`  Step ${i}: type=${type} slot=${slot} groups=[${targetGroups.join(',')}]${oobLabel} (${dx},${dy},${dz})`);
        }
      }
    }

    // =========================================================================
    // 6. Critical question: OOB groups that cause wrong pivots
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 6: OOB Pivot Impact Analysis (attack_magic frame 0)");
    console.log("=".repeat(80));

    {
      const info = ANIMS['attack_magic'];
      const firstFrameId = info.seq.frameIDs[0];
      const archId = firstFrameId >> 16;
      const frameIdx = firstFrameId & 0xffff;
      const files = await cache.getAllFiles(IndexType.FRAMES, archId);
      const frameFile = files.find(f => f?.id === frameIdx);
      const frame = frameFile.def;

      // Trace showing which type-2 rotations use a pivot computed from OOB-containing type-0
      let currentPivotHasOOB = false;
      let currentPivotSlot = -1;
      let pivotOOBGroups = [];

      for (let i = 0; i < frame.translator_x.length; i++) {
        const slot = frame.indexFrameIds[i];
        const type = frame.framemap.types[slot];
        const targetGroups = frame.framemap.frameMaps[slot] ?? [];
        const dx = frame.translator_x[i];
        const dy = frame.translator_y[i];
        const dz = frame.translator_z[i];

        if (type === 0) {
          const oob = targetGroups.filter(g => g >= GROUP_LIMIT);
          const ib = targetGroups.filter(g => g < GROUP_LIMIT);
          currentPivotHasOOB = oob.length > 0;
          currentPivotSlot = slot;
          pivotOOBGroups = oob;

          if (currentPivotHasOOB) {
            // Count vertices that WOULD have been included if groups existed
            const ibVertexCount = ib.reduce((sum, g) => sum + (groups[g]?.length ?? 0), 0);
            console.log(`\nPIVOT slot=${slot}: ${ib.length} in-bounds groups (${ibVertexCount} verts), ${oob.length} OOB groups [${oob.join(',')}]`);
            console.log(`  → The animation EXPECTED ~${targetGroups.length} groups worth of vertices for this pivot`);
            console.log(`  → We only have ${ib.length} groups → pivot centroid is WRONG if those missing groups have different positions`);
          }
        } else if (type === 2 && currentPivotHasOOB) {
          const oob = targetGroups.filter(g => g >= GROUP_LIMIT);
          const ib = targetGroups.filter(g => g < GROUP_LIMIT);
          if (ib.length > 0) {
            const ibVertexCount = ib.reduce((sum, g) => sum + (groups[g]?.length ?? 0), 0);
            console.log(`  ROTATE slot=${slot}: applies to in-bounds groups [${ib.join(',')}] (${ibVertexCount} verts) using potentially-wrong pivot from slot ${currentPivotSlot}`);
          }
        }
      }
    }

    // =========================================================================
    // 7. Compare framemap IDs between attack and style-switch
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 7: Framemap Comparison");
    console.log("=".repeat(80));

    const attackArchive = ANIMS.attack_magic.archiveId;
    const switchArchive = ANIMS.style_switch_mage.archiveId;

    const attackFM = archiveFramemaps.get(attackArchive);
    const switchFM = archiveFramemaps.get(switchArchive);

    if (attackFM && switchFM) {
      console.log(`Attack framemap (archive ${attackArchive}): id=${attackFM.id}, ${attackFM.types.length} slots`);
      console.log(`Switch framemap (archive ${switchArchive}): id=${switchFM.id}, ${switchFM.types.length} slots`);

      // Check max group referenced
      let attackMaxGroup = 0;
      let switchMaxGroup = 0;

      for (let s = 0; s < attackFM.types.length; s++) {
        for (const g of (attackFM.frameMaps[s] ?? [])) {
          if (g > attackMaxGroup) attackMaxGroup = g;
        }
      }
      for (let s = 0; s < switchFM.types.length; s++) {
        for (const g of (switchFM.frameMaps[s] ?? [])) {
          if (g > switchMaxGroup) switchMaxGroup = g;
        }
      }

      console.log(`Attack max group index referenced: ${attackMaxGroup}`);
      console.log(`Switch max group index referenced: ${switchMaxGroup}`);
      console.log(`Model group count: ${groups.length} (max valid index: ${groups.length - 1})`);
    }

    // =========================================================================
    // 8. Check all sequences for which framemap/skeleton they use
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 8: All Animation Framemap IDs");
    console.log("=".repeat(80));

    for (const [name, info] of Object.entries(ANIMS)) {
      if (!info.seq) continue;
      const fm = archiveFramemaps.get(info.archiveId);
      if (fm) {
        let maxG = 0;
        let totalOOBSlots = 0;
        for (let s = 0; s < fm.types.length; s++) {
          for (const g of (fm.frameMaps[s] ?? [])) {
            if (g > maxG) maxG = g;
            if (g >= GROUP_LIMIT) totalOOBSlots++;
          }
        }
        console.log(`${name}: framemap=${fm.id} slots=${fm.types.length} maxGroup=${maxG} oobGroupRefs=${totalOOBSlots > 0 ? totalOOBSlots : 'none'}`);
      }
    }

    // =========================================================================
    // 9. Check NPC transforms (multi-form NPCs)
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 9: NPC Transform/Variant Check");
    console.log("=".repeat(80));

    for (const npcId of NPC_IDS) {
      const def = allNpcDefs[npcId];
      if (!def) continue;
      console.log(`NPC ${npcId} "${def.name}": models=[${def.models}]`);
      if (def.transforms) console.log(`  transforms=${JSON.stringify(def.transforms)}`);
      if (def.configs) console.log(`  configs=${JSON.stringify(def.configs)}`);
    }

    // =========================================================================
    // 10. Check SpotAnim definitions used by Hunlef to see if they add models
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 10: SpotAnim Check (model composition)");
    console.log("=".repeat(80));

    const allSpotAnims = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SPOTANIM);
    // Check spot anims in the Hunlef range
    const SPOTANIM_RANGE = [1708, 1710, 1712, 1714, 1716, 1718];
    for (const saId of SPOTANIM_RANGE) {
      const sa = allSpotAnims[saId];
      if (!sa) continue;
      console.log(`SpotAnim ${saId}: modelId=${sa.modelId} animationId=${sa.animationId}`);
    }

    // =========================================================================
    // 11. Full dump of ALL type-0 slots in attack framemap with vertex analysis
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 11: Attack Framemap Full Type-0 Slot Analysis");
    console.log("=".repeat(80));

    if (attackFM) {
      for (let s = 0; s < attackFM.types.length; s++) {
        if (attackFM.types[s] !== 0) continue;
        const fm = attackFM.frameMaps[s] ?? [];
        const ib = fm.filter(g => g < GROUP_LIMIT);
        const oob = fm.filter(g => g >= GROUP_LIMIT);
        const ibVerts = ib.reduce((sum, g) => sum + (groups[g]?.length ?? 0), 0);
        const emptyIB = ib.filter(g => (groups[g]?.length ?? 0) === 0);
        console.log(`Slot ${s}: type=0 groups=[${fm.join(',')}] inBounds=${ib.length}(${ibVerts} verts, ${emptyIB.length} empty) OOB=${oob.length}${oob.length > 0 ? ' ['+oob.join(',')+']' : ''}`);
      }
    }

    // =========================================================================
    // 12. Check if groups 165+ exist in any other model that might compose with 38595
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("SECTION 12: Check Nearby Model IDs for Composition Candidates");
    console.log("=".repeat(80));

    // Check models ±5 around 38595
    for (let mId = 38590; mId <= 38600; mId++) {
      try {
        const mFiles = await cache.getAllFiles(IndexType.MODELS, mId);
        if (mFiles && mFiles[0]?.def) {
          const md = mFiles[0].def;
          console.log(`Model ${mId}: ${md.vertexCount} verts, ${md.faceCount} faces, ${md.vertexGroups?.length ?? 0} groups`);
        }
      } catch (e) {
        // skip
      }
    }

  } finally {
    cache.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
