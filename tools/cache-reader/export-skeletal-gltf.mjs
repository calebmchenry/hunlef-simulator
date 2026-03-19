#!/usr/bin/env node

import { RSCache, IndexType, ConfigType } from "osrscachereader";
import { createCanvas } from "canvas";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(import.meta.dirname, "../../public/models");
const OUTPUT_FILE = join(OUTPUT_DIR, "corrupted_hunlef.gltf");

const CACHE_VERSION = 232;
const BOSS_MODEL_ID = 38595;

const CLIPS = [
  ["idle", 8417],
  ["attack_magic", 8430],
  ["attack_ranged", 8431],
  ["stomp", 8432],
  ["prayer_disable", 8433],
  ["death", 8436],
  ["style_switch_mage", 8754],
  ["style_switch_range", 8755],
];

const COMPONENT_TYPE = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
};

const TYPE_COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;

const BRIGHTNESS_MAX = 0.6;
const HUE_OFFSET = 0.5 / 64;
const SATURATION_OFFSET = 0.5 / 8;

const EPSILON = 1e-8;
const IDENTITY_TOLERANCE = 1e-5;
const PARITY_MAX_ERROR_THRESHOLD = 5;

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function cleanupLegacyBossBuffers(outDir) {
  const files = readdirSync(outDir);
  let removed = 0;

  for (const file of files) {
    if (/^corrupted_hunlef_buf\d+\.bin$/u.test(file)) {
      rmSync(join(outDir, file));
      removed++;
    }
  }

  console.log(`[export-skeletal] Removed ${removed} legacy boss morph buffer(s)`);
}

function unpackHue(hsl) {
  return (hsl >> 10) & 63;
}

function unpackSaturation(hsl) {
  return (hsl >> 7) & 7;
}

function unpackLuminance(hsl) {
  return hsl & 127;
}

function adjustForBrightness(rgb, brightness) {
  let r = (rgb >> 16) / 256.0;
  let g = ((rgb >> 8) & 255) / 256.0;
  let b = (rgb & 255) / 256.0;

  r = Math.pow(r, brightness);
  g = Math.pow(g, brightness);
  b = Math.pow(b, brightness);

  return (Math.trunc(r * 256.0) << 16) | (Math.trunc(g * 256.0) << 8) | Math.trunc(b * 256.0);
}

function hslToRgb(hsl, brightness) {
  const hue = unpackHue(hsl) / 64 + HUE_OFFSET;
  const saturation = unpackSaturation(hsl) / 8 + SATURATION_OFFSET;
  const luminance = unpackLuminance(hsl) / 128;

  const chroma = (1 - Math.abs(2 * luminance - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const lightness = luminance - chroma / 2;

  let r = lightness;
  let g = lightness;
  let b = lightness;

  switch (Math.trunc(hue * 6)) {
    case 0:
      r += chroma;
      g += x;
      break;
    case 1:
      g += chroma;
      r += x;
      break;
    case 2:
      g += chroma;
      b += x;
      break;
    case 3:
      b += chroma;
      g += x;
      break;
    case 4:
      b += chroma;
      r += x;
      break;
    default:
      r += chroma;
      b += x;
      break;
  }

  let rgb = (Math.trunc(r * 256.0) << 16) | (Math.trunc(g * 256.0) << 8) | Math.trunc(b * 256.0);
  rgb = adjustForBrightness(rgb, brightness);

  if (rgb === 0) {
    rgb = 1;
  }

  return rgb;
}

function combineColorAndAlpha(color, alpha) {
  return (color & 0xffffff) | ((alpha & 0xff) << 24);
}

function toGltfPosition(x, y, z) {
  return [x, -y, -z];
}

function mat4Identity() {
  const out = new Float64Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

function mat4Multiply(a, b) {
  const out = new Float64Array(16);

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }

  return out;
}

function mat4Translation(x, y, z) {
  const out = mat4Identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

function mat4Scale(x, y, z) {
  const out = mat4Identity();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

function mat4RotationX(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out = mat4Identity();

  out[5] = c;
  out[9] = -s;
  out[6] = s;
  out[10] = c;

  return out;
}

function mat4RotationY(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out = mat4Identity();

  out[0] = c;
  out[8] = s;
  out[2] = -s;
  out[10] = c;

  return out;
}

function mat4RotationZNegative(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out = mat4Identity();

  out[0] = c;
  out[4] = s;
  out[1] = -s;
  out[5] = c;

  return out;
}

function mat4TransformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function decomposeMat4(m) {
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];

  let sx = Math.hypot(m[0], m[1], m[2]);
  let sy = Math.hypot(m[4], m[5], m[6]);
  let sz = Math.hypot(m[8], m[9], m[10]);

  if (sx < EPSILON) sx = 0;
  if (sy < EPSILON) sy = 0;
  if (sz < EPSILON) sz = 0;

  const invSx = sx > EPSILON ? 1 / sx : 0;
  const invSy = sy > EPSILON ? 1 / sy : 0;
  const invSz = sz > EPSILON ? 1 / sz : 0;

  let r00 = m[0] * invSx;
  let r01 = m[4] * invSy;
  let r02 = m[8] * invSz;
  let r10 = m[1] * invSx;
  let r11 = m[5] * invSy;
  let r12 = m[9] * invSz;
  let r20 = m[2] * invSx;
  let r21 = m[6] * invSy;
  let r22 = m[10] * invSz;

  const det =
    r00 * (r11 * r22 - r12 * r21) -
    r01 * (r10 * r22 - r12 * r20) +
    r02 * (r10 * r21 - r11 * r20);

  if (det < 0) {
    sx = -sx;
    r00 = -r00;
    r10 = -r10;
    r20 = -r20;
  }

  let qx;
  let qy;
  let qz;
  let qw;

  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    qw = 0.25 * s;
    qx = (r21 - r12) / s;
    qy = (r02 - r20) / s;
    qz = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1.0 + r00 - r11 - r22) * 2;
    qw = (r21 - r12) / s;
    qx = 0.25 * s;
    qy = (r01 + r10) / s;
    qz = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1.0 + r11 - r00 - r22) * 2;
    qw = (r02 - r20) / s;
    qx = (r01 + r10) / s;
    qy = 0.25 * s;
    qz = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1.0 + r22 - r00 - r11) * 2;
    qw = (r10 - r01) / s;
    qx = (r02 + r20) / s;
    qy = (r12 + r21) / s;
    qz = 0.25 * s;
  }

  const qLen = Math.hypot(qx, qy, qz, qw);
  if (qLen > EPSILON) {
    qx /= qLen;
    qy /= qLen;
    qz /= qLen;
    qw /= qLen;
  } else {
    qx = 0;
    qy = 0;
    qz = 0;
    qw = 1;
  }

  return {
    translation: [tx, ty, tz],
    rotation: [qx, qy, qz, qw],
    scale: [sx, sy, sz],
  };
}

function isIdentityTranslation(v) {
  return Math.abs(v[0]) <= IDENTITY_TOLERANCE && Math.abs(v[1]) <= IDENTITY_TOLERANCE && Math.abs(v[2]) <= IDENTITY_TOLERANCE;
}

function isIdentityScale(v) {
  return (
    Math.abs(v[0] - 1) <= IDENTITY_TOLERANCE &&
    Math.abs(v[1] - 1) <= IDENTITY_TOLERANCE &&
    Math.abs(v[2] - 1) <= IDENTITY_TOLERANCE
  );
}

function isIdentityRotation(q) {
  return (
    Math.abs(q[0]) <= IDENTITY_TOLERANCE &&
    Math.abs(q[1]) <= IDENTITY_TOLERANCE &&
    Math.abs(q[2]) <= IDENTITY_TOLERANCE &&
    Math.abs(q[3] - 1) <= IDENTITY_TOLERANCE
  );
}

function buildVertexToGroup(modelDef) {
  const vertexCount = modelDef.vertexCount;
  const vertexGroups = modelDef.vertexGroups ?? [];
  const vertexToGroup = new Int32Array(vertexCount);
  vertexToGroup.fill(-1);

  for (let groupIndex = 0; groupIndex < vertexGroups.length; groupIndex++) {
    const group = vertexGroups[groupIndex] ?? [];
    for (const vertexIndex of group) {
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
        throw new Error(`vertexGroups[${groupIndex}] contains invalid vertex index ${vertexIndex}`);
      }
      if (vertexToGroup[vertexIndex] !== -1) {
        throw new Error(
          `Vertex ${vertexIndex} appears in multiple groups (${vertexToGroup[vertexIndex]} and ${groupIndex})`
        );
      }
      vertexToGroup[vertexIndex] = groupIndex;
    }
  }

  for (let i = 0; i < vertexCount; i++) {
    if (vertexToGroup[i] === -1) {
      throw new Error(`Vertex ${i} is not assigned to any vertex group`);
    }
  }

  return vertexToGroup;
}

function buildGroupCentroids(modelDef) {
  const groups = modelDef.vertexGroups ?? [];
  const counts = new Int32Array(groups.length);
  const centroids = new Array(groups.length);

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] ?? [];
    const count = group.length;
    counts[g] = count;

    if (count === 0) {
      centroids[g] = [0, 0, 0];
      continue;
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;

    for (const vertexIndex of group) {
      sx += modelDef.vertexPositionsX[vertexIndex];
      sy += modelDef.vertexPositionsY[vertexIndex];
      sz += modelDef.vertexPositionsZ[vertexIndex];
    }

    centroids[g] = [sx / count, sy / count, sz / count];
  }

  return { counts, centroids };
}

function buildGeometry(modelDef, vertexToGroup) {
  const opaquePositions = [];
  const alphaPositions = [];
  const opaqueIndices = [];
  const alphaIndices = [];
  const opaqueFaceIds = [];
  const alphaFaceIds = [];

  const opaquePairToIndex = new Map();
  const alphaPairToIndex = new Map();

  const remappedVertices = new Array(modelDef.vertexCount);
  for (let i = 0; i < remappedVertices.length; i++) {
    remappedVertices[i] = new Map();
  }

  for (let faceId = 0; faceId < modelDef.faceCount; faceId++) {
    const alpha = modelDef.faceAlphas?.[faceId] ?? 0;
    const isAlpha = alpha !== 0;

    const destPositions = isAlpha ? alphaPositions : opaquePositions;
    const destIndices = isAlpha ? alphaIndices : opaqueIndices;
    const pairToIndex = isAlpha ? alphaPairToIndex : opaquePairToIndex;
    const destFaceIds = isAlpha ? alphaFaceIds : opaqueFaceIds;

    destFaceIds.push(faceId);

    const faceColor = modelDef.faceColors[faceId];
    const pairKey = combineColorAndAlpha(faceColor, alpha);

    const faceVertices = [
      modelDef.faceVertexIndices1[faceId],
      modelDef.faceVertexIndices2[faceId],
      modelDef.faceVertexIndices3[faceId],
    ];

    for (const vertexIndex of faceVertices) {
      const dedupeKey = `${vertexIndex}:${pairKey}`;
      let remappedIndex = pairToIndex.get(dedupeKey);

      if (remappedIndex === undefined) {
        remappedIndex = destPositions.length;
        const x = modelDef.vertexPositionsX[vertexIndex];
        const y = modelDef.vertexPositionsY[vertexIndex];
        const z = modelDef.vertexPositionsZ[vertexIndex];
        destPositions.push(toGltfPosition(x, y, z));
        pairToIndex.set(dedupeKey, remappedIndex);

        remappedVertices[vertexIndex].set(pairKey, {
          idx: remappedIndex,
          alpha: isAlpha,
          pairKey,
        });
      }

      destIndices.push(remappedIndex);
    }
  }

  const opaqueUVs = new Array(opaquePositions.length);
  const alphaUVs = new Array(alphaPositions.length);

  const seenColors = new Set();
  const colorToPaletteIndex = new Map();
  const paletteOrder = [];

  for (let faceId = 0; faceId < modelDef.faceCount; faceId++) {
    const faceColor = modelDef.faceColors[faceId];
    const faceAlpha = modelDef.faceAlphas?.[faceId] ?? 0;
    const lookupKey = combineColorAndAlpha(faceColor, faceAlpha);

    if (seenColors.has(lookupKey)) {
      continue;
    }

    seenColors.add(lookupKey);

    const rgb = hslToRgb(faceColor, BRIGHTNESS_MAX);
    const rgba = combineColorAndAlpha(rgb, faceAlpha);

    colorToPaletteIndex.set(lookupKey, paletteOrder.length);
    paletteOrder.push(rgba);
  }

  if (paletteOrder.length === 0) {
    colorToPaletteIndex.set(0, 0);
    paletteOrder.push(combineColorAndAlpha(0xffffff, 0));
  }

  const pSize = 4;
  const canvas = createCanvas(paletteOrder.length * pSize, pSize, "png");
  const ctx = canvas.getContext("2d");

  let xx = 0;
  for (const value of paletteOrder) {
    const a = (value >> 24) & 0xff;
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    const alpha = 1 - a / 255;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillRect(xx, 0, pSize, pSize);
    xx += pSize;
  }

  const palettePngBuffer = canvas.toBuffer("image/png");
  const paletteFileName = "corrupted_hunlef_palette.png";
  const paletteHalfStep = 1 / paletteOrder.length / 2;

  for (const faceId of opaqueFaceIds) {
    const faceColor = modelDef.faceColors[faceId];
    const faceAlpha = modelDef.faceAlphas?.[faceId] ?? 0;
    const lookupKey = combineColorAndAlpha(faceColor, faceAlpha);
    const paletteIndex = colorToPaletteIndex.get(lookupKey);
    if (paletteIndex === undefined) {
      throw new Error(`Missing opaque palette index for face ${faceId}`);
    }

    const uvU = paletteIndex / paletteOrder.length + paletteHalfStep;

    const v1 = remappedVertices[modelDef.faceVertexIndices1[faceId]].get(lookupKey);
    const v2 = remappedVertices[modelDef.faceVertexIndices2[faceId]].get(lookupKey);
    const v3 = remappedVertices[modelDef.faceVertexIndices3[faceId]].get(lookupKey);

    if (!v1 || !v2 || !v3) {
      throw new Error(`Opaque remap missing for face ${faceId}`);
    }

    opaqueUVs[v1.idx] = [uvU, 0.33];
    opaqueUVs[v2.idx] = [uvU, 0.5];
    opaqueUVs[v3.idx] = [uvU, 0.66];
  }

  for (const faceId of alphaFaceIds) {
    const faceColor = modelDef.faceColors[faceId];
    const faceAlpha = modelDef.faceAlphas?.[faceId] ?? 0;
    const lookupKey = combineColorAndAlpha(faceColor, faceAlpha);
    const paletteIndex = colorToPaletteIndex.get(lookupKey);
    if (paletteIndex === undefined) {
      throw new Error(`Missing alpha palette index for face ${faceId}`);
    }

    const uvU = paletteIndex / paletteOrder.length + paletteHalfStep;

    const v1 = remappedVertices[modelDef.faceVertexIndices1[faceId]].get(lookupKey);
    const v2 = remappedVertices[modelDef.faceVertexIndices2[faceId]].get(lookupKey);
    const v3 = remappedVertices[modelDef.faceVertexIndices3[faceId]].get(lookupKey);

    if (!v1 || !v2 || !v3) {
      throw new Error(`Alpha remap missing for face ${faceId}`);
    }

    alphaUVs[v1.idx] = [uvU, 0.33];
    alphaUVs[v2.idx] = [uvU, 0.5];
    alphaUVs[v3.idx] = [uvU, 0.66];
  }

  for (let i = 0; i < opaqueUVs.length; i++) {
    if (!opaqueUVs[i]) opaqueUVs[i] = [0, 0];
  }

  for (let i = 0; i < alphaUVs.length; i++) {
    if (!alphaUVs[i]) alphaUVs[i] = [0, 0];
  }

  const opaqueJoints = new Uint16Array(opaquePositions.length * 4);
  const alphaJoints = new Uint16Array(alphaPositions.length * 4);
  const opaqueWeights = new Float32Array(opaquePositions.length * 4);
  const alphaWeights = new Float32Array(alphaPositions.length * 4);

  for (let originalVertex = 0; originalVertex < remappedVertices.length; originalVertex++) {
    const group = vertexToGroup[originalVertex];
    const jointIndex = group + 1;

    for (const remap of remappedVertices[originalVertex].values()) {
      const baseOffset = remap.idx * 4;
      if (remap.alpha) {
        alphaJoints[baseOffset] = jointIndex;
        alphaWeights[baseOffset] = 1;
      } else {
        opaqueJoints[baseOffset] = jointIndex;
        opaqueWeights[baseOffset] = 1;
      }
    }
  }

  return {
    palettePngBuffer,
    paletteFileName,
    opaque: {
      positions: opaquePositions,
      indices: opaqueIndices,
      uvs: opaqueUVs,
      joints: opaqueJoints,
      weights: opaqueWeights,
    },
    alpha: {
      positions: alphaPositions,
      indices: alphaIndices,
      uvs: alphaUVs,
      joints: alphaJoints,
      weights: alphaWeights,
    },
  };
}

function buildOobSlotSkipSet(framemap, groupCount) {
  // Pre-compute which framemap slots reference ANY out-of-bounds groups.
  // These slots belong to a composite-model skeleton (weapon/attachment bones)
  // that we don't have.  Applying them to our single body model produces
  // wrong pivots and exploded geometry.  Skip them entirely.
  const skipSlots = new Set();
  for (let s = 0; s < framemap.types.length; s++) {
    const groups = framemap.frameMaps[s] ?? [];
    if (groups.some((g) => g >= groupCount)) {
      skipSlots.add(s);
    }
  }
  return skipSlots;
}

function buildFrameGroupMatrices(frame, modelDef, oobSkipSlots, frozenGroups) {
  const groups = modelDef.vertexGroups ?? [];
  const groupCount = groups.length;
  const groupMatrices = new Array(groupCount);
  for (let i = 0; i < groupCount; i++) {
    groupMatrices[i] = mat4Identity();
  }

  // Track actual vertex positions using the same integer arithmetic as the
  // reference animate() so the type-0 pivot computation is accurate.
  const vx = Float64Array.from(modelDef.vertexPositionsX);
  const vy = Float64Array.from(modelDef.vertexPositionsY);
  const vz = Float64Array.from(modelDef.vertexPositionsZ);

  const animOffsets = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < frame.translator_x.length; i++) {
    const slot = frame.indexFrameIds[i];

    // Skip transforms from framemap slots that reference ANY out-of-bounds
    // groups.  These belong to the composite-model weapon/attachment bone
    // chain and produce wrong pivots, rotations, scales, and translations
    // when applied to the body-only model.
    if (oobSkipSlots && oobSkipSlots.has(slot)) continue;

    const type = frame.framemap.types[slot];
    const allTargetGroups = frame.framemap.frameMaps[slot] ?? [];
    const dx = frame.translator_x[i];
    const dy = frame.translator_y[i];
    const dz = frame.translator_z[i];

    // For type 0 (PIVOT), use all in-bounds groups (including frozen) so the
    // pivot centroid is correct for non-frozen groups that share this pivot.
    // For other types, filter out frozen groups from the targets.
    const targetGroups = allTargetGroups;

    if (type === 0) {
      // Compute pivot from actual (integer-truncated) vertex positions,
      // matching the reference animate() exactly.
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let count = 0;

      for (const groupIndex of targetGroups) {
        if (groupIndex < 0 || groupIndex >= groupCount) continue;
        const grp = groups[groupIndex] ?? [];
        for (const vi of grp) {
          sumX += vx[vi];
          sumY += vy[vi];
          sumZ += vz[vi];
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
      continue;
    }

    if (type === 1) {
      const t = mat4Translation(dx, dy, dz);
      for (const groupIndex of targetGroups) {
        if (groupIndex < 0 || groupIndex >= groupCount) continue;
        if (frozenGroups && frozenGroups.has(groupIndex)) continue;
        groupMatrices[groupIndex] = mat4Multiply(t, groupMatrices[groupIndex]);
        // Mirror vertex update from reference animate()
        for (const vi of (groups[groupIndex] ?? [])) {
          vx[vi] += dx;
          vy[vi] += dy;
          vz[vi] += dz;
        }
      }
      continue;
    }

    if (type === 2) {
      const angleX = (((dx & 255) * 8) * Math.PI) / 1024;
      const angleY = (((dy & 255) * 8) * Math.PI) / 1024;
      const angleZ = (((dz & 255) * 8) * Math.PI) / 1024;

      let rotation = mat4Identity();

      if (Math.abs(angleZ) > EPSILON) {
        rotation = mat4Multiply(mat4RotationZNegative(angleZ), rotation);
      }
      if (Math.abs(angleX) > EPSILON) {
        rotation = mat4Multiply(mat4RotationX(angleX), rotation);
      }
      if (Math.abs(angleY) > EPSILON) {
        rotation = mat4Multiply(mat4RotationY(angleY), rotation);
      }

      const toOrigin = mat4Translation(-animOffsets.x, -animOffsets.y, -animOffsets.z);
      const back = mat4Translation(animOffsets.x, animOffsets.y, animOffsets.z);
      const step = mat4Multiply(back, mat4Multiply(rotation, toOrigin));

      for (const groupIndex of targetGroups) {
        if (groupIndex < 0 || groupIndex >= groupCount) continue;
        if (frozenGroups && frozenGroups.has(groupIndex)) continue;
        groupMatrices[groupIndex] = mat4Multiply(step, groupMatrices[groupIndex]);
        // Mirror vertex update using reference fixed-point integer arithmetic
        const var12 = (dx & 255) * 8;
        const var13 = (dy & 255) * 8;
        const var14 = (dz & 255) * 8;
        for (const vi of (groups[groupIndex] ?? [])) {
          vx[vi] -= animOffsets.x;
          vy[vi] -= animOffsets.y;
          vz[vi] -= animOffsets.z;
          if (var14 !== 0) {
            const s = Math.floor(65536 * Math.sin((var14 * Math.PI) / 1024));
            const c = Math.floor(65536 * Math.cos((var14 * Math.PI) / 1024));
            const tmp = (s * vy[vi] + c * vx[vi]) >> 16;
            vy[vi] = (c * vy[vi] - s * vx[vi]) >> 16;
            vx[vi] = tmp;
          }
          if (var12 !== 0) {
            const s = Math.floor(65536 * Math.sin((var12 * Math.PI) / 1024));
            const c = Math.floor(65536 * Math.cos((var12 * Math.PI) / 1024));
            const tmp = (c * vy[vi] - s * vz[vi]) >> 16;
            vz[vi] = (s * vy[vi] + c * vz[vi]) >> 16;
            vy[vi] = tmp;
          }
          if (var13 !== 0) {
            const s = Math.floor(65536 * Math.sin((var13 * Math.PI) / 1024));
            const c = Math.floor(65536 * Math.cos((var13 * Math.PI) / 1024));
            const tmp = (s * vz[vi] + c * vx[vi]) >> 16;
            vz[vi] = (c * vz[vi] - s * vx[vi]) >> 16;
            vx[vi] = tmp;
          }
          vx[vi] += animOffsets.x;
          vy[vi] += animOffsets.y;
          vz[vi] += animOffsets.z;
        }
      }
      continue;
    }

    if (type === 3) {
      const sx = dx / 128;
      const sy = dy / 128;
      const sz = dz / 128;
      const toOrigin = mat4Translation(-animOffsets.x, -animOffsets.y, -animOffsets.z);
      const back = mat4Translation(animOffsets.x, animOffsets.y, animOffsets.z);
      const scale = mat4Scale(sx, sy, sz);
      const step = mat4Multiply(back, mat4Multiply(scale, toOrigin));

      for (const groupIndex of targetGroups) {
        if (groupIndex < 0 || groupIndex >= groupCount) continue;
        if (frozenGroups && frozenGroups.has(groupIndex)) continue;
        groupMatrices[groupIndex] = mat4Multiply(step, groupMatrices[groupIndex]);
        // Mirror vertex update from reference animate()
        for (const vi of (groups[groupIndex] ?? [])) {
          vx[vi] -= animOffsets.x;
          vy[vi] -= animOffsets.y;
          vz[vi] -= animOffsets.z;
          vx[vi] = (dx * vx[vi]) / 128;
          vy[vi] = (dy * vy[vi]) / 128;
          vz[vi] = (dz * vz[vi]) / 128;
          vx[vi] += animOffsets.x;
          vy[vi] += animOffsets.y;
          vz[vi] += animOffsets.z;
        }
      }
      continue;
    }
  }

  return { groupMatrices, posedX: vx, posedY: vy, posedZ: vz };
}

function correctGroupTranslations(groupMatrices, modelDef, posedX, posedY, posedZ) {
  const groups = modelDef.vertexGroups ?? [];
  const result = new Array(groups.length);

  for (let g = 0; g < groups.length; g++) {
    const mat = groupMatrices[g];
    const grp = groups[g] ?? [];

    if (grp.length === 0) {
      result[g] = mat;
      continue;
    }

    // Compute mean of (matrix * base) and mean of (ground-truth posed) for this group,
    // then shift translation so the centroids match.  This compensates for the
    // per-vertex integer truncation that the single matrix cannot reproduce.
    let matMeanX = 0;
    let matMeanY = 0;
    let matMeanZ = 0;
    let posedMeanX = 0;
    let posedMeanY = 0;
    let posedMeanZ = 0;

    for (const v of grp) {
      const tp = mat4TransformPoint(
        mat,
        modelDef.vertexPositionsX[v],
        modelDef.vertexPositionsY[v],
        modelDef.vertexPositionsZ[v]
      );
      matMeanX += tp[0];
      matMeanY += tp[1];
      matMeanZ += tp[2];
      posedMeanX += posedX[v];
      posedMeanY += posedY[v];
      posedMeanZ += posedZ[v];
    }

    const n = grp.length;
    const corrX = posedMeanX / n - matMeanX / n;
    const corrY = posedMeanY / n - matMeanY / n;
    const corrZ = posedMeanZ / n - matMeanZ / n;

    const out = Float64Array.from(mat);
    out[12] += corrX;
    out[13] += corrY;
    out[14] += corrZ;
    result[g] = out;
  }

  return result;
}

// Identify "frozen groups": in-bounds groups that appear as the SOLE target
// of a per-bone setup slot (group count <= 5) AND whose per-bone slot group
// list consists entirely of groups that also appear in OOB slots.  These are
// weapon-attachment bones positioned by the composite-model skeleton.  We
// freeze them (keep at identity) so they don't fly off the body.
function buildFrozenGroups(framemap, groupCount) {
  // Identify in-bounds groups that are weapon-attachment bones by detecting
  // groups that are the SOLE in-bounds target of a type-1 (translate) slot.
  // In the composite framemap, the first ~60 slots set up individual bone
  // positions for groups 0-9 (weapon attachments), each with their own
  // dedicated pivot(0) + translate(1) + rotate(2) sequence.
  // These groups get large translations meant for the weapon model and
  // should be frozen (kept at identity) when the weapon model isn't present.
  const frozen = new Set();
  for (let s = 0; s < framemap.types.length; s++) {
    if (framemap.types[s] !== 1) continue; // only type 1 (translate)
    const groups = framemap.frameMaps[s] ?? [];
    // Must be a dedicated per-bone slot (small number of targets)
    const inBounds = groups.filter((g) => g >= 0 && g < groupCount);
    if (inBounds.length === 1 && groups.length <= 3) {
      // This is a dedicated translate for a single in-bounds group.
      // If the same group also has a dedicated type-0 pivot slot, it's
      // a per-bone setup chain → weapon attachment bone.
      frozen.add(inBounds[0]);
    }
  }
  return frozen;
}

function toGltfMatrix(mOsrs) {
  // C * M * C, where C = diag(1, -1, -1, 1)
  const c = mat4Scale(1, -1, -1);
  return mat4Multiply(c, mat4Multiply(mOsrs, c));
}

class AccessorPacker {
  constructor() {
    this._chunks = [];
    this._byteLength = 0;
    this.bufferViews = [];
    this.accessors = [];
  }

  align4() {
    const pad = (4 - (this._byteLength % 4)) % 4;
    if (pad > 0) {
      this._chunks.push(Buffer.alloc(pad));
      this._byteLength += pad;
    }
  }

  addView(bytes, target) {
    this.align4();

    const offset = this._byteLength;
    const copy = Buffer.from(bytes);
    this._chunks.push(copy);
    this._byteLength += copy.byteLength;

    const view = {
      buffer: 0,
      byteOffset: offset,
      byteLength: copy.byteLength,
    };
    if (target !== undefined) {
      view.target = target;
    }

    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  addAccessorFromTypedArray(typedArray, options) {
    const {
      type,
      componentType,
      normalized = false,
      target,
      includeMinMax = true,
    } = options;

    const componentCount = TYPE_COMPONENT_COUNT[type];
    if (!componentCount) {
      throw new Error(`Unsupported accessor type: ${type}`);
    }

    if (typedArray.length % componentCount !== 0) {
      throw new Error(`Typed array length ${typedArray.length} is not divisible by ${type}`);
    }

    const bytes = new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength
    );

    const bufferView = this.addView(bytes, target);

    const accessor = {
      bufferView,
      byteOffset: 0,
      componentType,
      count: typedArray.length / componentCount,
      type,
    };

    if (normalized) {
      accessor.normalized = true;
    }

    if (includeMinMax) {
      const min = new Array(componentCount).fill(Number.POSITIVE_INFINITY);
      const max = new Array(componentCount).fill(Number.NEGATIVE_INFINITY);

      for (let i = 0; i < typedArray.length; i += componentCount) {
        for (let c = 0; c < componentCount; c++) {
          const v = typedArray[i + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }

      accessor.min = min;
      accessor.max = max;
    }

    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  buildBuffer() {
    return Buffer.concat(this._chunks, this._byteLength);
  }
}

class FrameStore {
  constructor(cache) {
    this.cache = cache;
    this.archives = new Map();
  }

  async getFrame(frameId) {
    const archiveId = frameId >> 16;
    const frameIndex = frameId & 0xffff;

    if (!this.archives.has(archiveId)) {
      const files = await this.cache.getAllFiles(IndexType.FRAMES, archiveId);
      const frameMap = new Map();
      for (const file of files) {
        if (!file || file.id === undefined || !file.def) continue;
        frameMap.set(file.id, file.def);
      }
      this.archives.set(archiveId, frameMap);
    }

    const archive = this.archives.get(archiveId);
    const frame = archive.get(frameIndex);
    if (!frame) {
      throw new Error(`Missing frame ${frameIndex} in archive ${archiveId}`);
    }

    return frame;
  }
}

async function buildAnimations({ cache, modelDef, sequences, vertexToGroup, jointNodeStart }) {
  const frameStore = new FrameStore(cache);
  const groupCount = (modelDef.vertexGroups ?? []).length;

  const clips = [];
  const replayCache = new Map();
  // Cache the OOB skip set per framemap ID so we only compute it once.
  const oobSkipSetCache = new Map();

  for (const [clipName, sequenceDef] of sequences) {
    if (!Array.isArray(sequenceDef.frameIDs) || sequenceDef.frameIDs.length === 0) {
      throw new Error(`Sequence ${sequenceDef.id} (${clipName}) has no frameIDs`);
    }

    if (!Array.isArray(sequenceDef.frameLengths) || sequenceDef.frameLengths.length !== sequenceDef.frameIDs.length) {
      throw new Error(`Sequence ${sequenceDef.id} (${clipName}) frameLengths mismatch`);
    }

    const times = new Float32Array(sequenceDef.frameLengths.length);
    let t = 0;
    for (let i = 0; i < sequenceDef.frameLengths.length; i++) {
      times[i] = t;
      t += sequenceDef.frameLengths[i] / 50;
    }

    const frameGroupMatrices = [];

    for (let frameIndex = 0; frameIndex < sequenceDef.frameIDs.length; frameIndex++) {
      const frameId = sequenceDef.frameIDs[frameIndex];
      const frame = await frameStore.getFrame(frameId);

      // Get or build the combined skip set for this framemap.
      const fmId = frame.framemap.id;
      if (!oobSkipSetCache.has(fmId)) {
        const oobSkipSet = buildOobSlotSkipSet(frame.framemap, groupCount);
        const frozen = oobSkipSet.size > 0
          ? buildFrozenGroups(frame.framemap, groupCount)
          : new Set();
        oobSkipSetCache.set(fmId, { oobSkipSet, frozenGroups: frozen });
        if (oobSkipSet.size > 0) {
          console.log(
            `[export-skeletal] Framemap ${fmId}: skipping ${oobSkipSet.size} OOB slots, ` +
            `freezing ${frozen.size} attachment groups [${[...frozen].join(",")}]`
          );
        }
      }
      const { oobSkipSet: oobSkipSlots, frozenGroups: frameFrozenGroups } = oobSkipSetCache.get(fmId);

      // Build clean TRS-safe matrices by replaying the OSRS transform pipeline
      // at the bone level, with per-vertex tracking for accurate type-0 pivots.
      // OOB slots are skipped to avoid composite-model distortion.
      let cached = replayCache.get(frameId);
      if (!cached) {
        const replay = buildFrameGroupMatrices(frame, modelDef, oobSkipSlots, frameFrozenGroups);

        // Correct translation to minimize per-vertex truncation error from
        // the reference fixed-point integer arithmetic.  We use our own
        // replayed vertex positions (which respect the OOB skip set) as the
        // ground truth, rather than osrscachereader's loadFrame() which
        // doesn't filter OOB slots and produces exploded geometry.
        const correctedMatrices = correctGroupTranslations(
          replay.groupMatrices,
          modelDef,
          replay.posedX,
          replay.posedY,
          replay.posedZ
        );

        // For composite-model framemaps, clamp groups that fly off the body.
        // These are weapon-attachment groups positioned for the missing weapon.
        // A displacement > 400 from rest clearly indicates a runaway group
        // (the style_switch max displacement is ~473 but those use framemap 1879
        // which has no OOB slots, so this code path is never reached for them).
        let matrices = correctedMatrices;
        if (oobSkipSlots.size > 0) {
          const groups = modelDef.vertexGroups ?? [];
          let clampedCount = 0;
          for (let g = 0; g < groups.length; g++) {
            const grp = groups[g] ?? [];
            if (grp.length === 0) continue;
            let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0;
            for (const v of grp) {
              rx += modelDef.vertexPositionsX[v];
              ry += modelDef.vertexPositionsY[v];
              rz += modelDef.vertexPositionsZ[v];
              const tp = mat4TransformPoint(matrices[g],
                modelDef.vertexPositionsX[v],
                modelDef.vertexPositionsY[v],
                modelDef.vertexPositionsZ[v]);
              px += tp[0]; py += tp[1]; pz += tp[2];
            }
            const n = grp.length;
            const disp = Math.hypot(px/n - rx/n, py/n - ry/n, pz/n - rz/n);
            if (disp > 400) {
              matrices[g] = mat4Identity();
              clampedCount++;
            }
          }
          if (clampedCount > 0) {
            console.log(`[export-skeletal] Clamped ${clampedCount} runaway groups (displacement > 400)`);
          }
        }

        // Parity check against our own replayed positions (not loadFrame)
        let sumError = 0;
        let maxError = 0;

        for (let v = 0; v < modelDef.vertexCount; v++) {
          const groupIdx = vertexToGroup[v];
          const mat = matrices[groupIdx];
          const posedOsrs = mat4TransformPoint(
            mat,
            modelDef.vertexPositionsX[v],
            modelDef.vertexPositionsY[v],
            modelDef.vertexPositionsZ[v]
          );

          const dx2 = posedOsrs[0] - replay.posedX[v];
          const dy2 = posedOsrs[1] - replay.posedY[v];
          const dz2 = posedOsrs[2] - replay.posedZ[v];
          const err = Math.hypot(dx2, dy2, dz2);

          sumError += err;
          if (err > maxError) {
            maxError = err;
          }
        }

        const meanError = sumError / modelDef.vertexCount;
        console.log(
          `[parity] ${clipName} frame ${frameIndex + 1}/${sequenceDef.frameIDs.length} ` +
          `max=${maxError.toFixed(6)} mean=${meanError.toFixed(6)}`
        );

        if (maxError > PARITY_MAX_ERROR_THRESHOLD) {
          console.warn(
            `[parity] ${clipName} frame ${frameIndex + 1}: max error ${maxError.toFixed(6)} > ${PARITY_MAX_ERROR_THRESHOLD}`
          );
        }

        cached = matrices;
        replayCache.set(frameId, cached);
      } else {
        console.log(
          `[parity] ${clipName} frame ${frameIndex + 1}/${sequenceDef.frameIDs.length} (cached)`
        );
      }

      frameGroupMatrices.push(cached);
    }

    const joints = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const positions = [];
      const rotations = [];
      const scales = [];

      let allIdentityTranslation = true;
      let allIdentityRotation = true;
      let allIdentityScale = true;

      for (let frameIndex = 0; frameIndex < frameGroupMatrices.length; frameIndex++) {
        const osrsMatrix = frameGroupMatrices[frameIndex][groupIndex];
        const gltfMatrix = toGltfMatrix(osrsMatrix);
        const { translation, rotation, scale } = decomposeMat4(gltfMatrix);

        if (!isIdentityTranslation(translation)) {
          allIdentityTranslation = false;
        }
        if (!isIdentityRotation(rotation)) {
          allIdentityRotation = false;
        }
        if (!isIdentityScale(scale)) {
          allIdentityScale = false;
        }

        positions.push(...translation);
        rotations.push(...rotation);
        scales.push(...scale);
      }

      if (allIdentityTranslation && allIdentityRotation && allIdentityScale) {
        continue;
      }

      joints.push({
        node: jointNodeStart + groupIndex,
        positions: new Float32Array(positions),
        rotations: new Float32Array(rotations),
        scales: new Float32Array(scales),
      });
    }

    if (joints.length === 0) {
      joints.push({
        node: 1,
        positions: new Float32Array([0, 0, 0]),
        rotations: new Float32Array([0, 0, 0, 1]),
        scales: new Float32Array([1, 1, 1]),
        overrideTimes: new Float32Array([0]),
      });
    }

    clips.push({
      name: clipName,
      times,
      joints,
    });
  }

  return clips;
}

function flattenVecArray(arr, width) {
  const out = new Float32Array(arr.length * width);
  for (let i = 0; i < arr.length; i++) {
    const src = arr[i];
    for (let j = 0; j < width; j++) {
      out[i * width + j] = src[j];
    }
  }
  return out;
}

function buildGltf({ modelDef, geometry, clips, groupCount }) {
  const packer = new AccessorPacker();

  const primitives = [];

  function addPrimitive(section, materialIndex) {
    if (section.positions.length === 0 || section.indices.length === 0) {
      return;
    }

    const positions = flattenVecArray(section.positions, 3);
    const uvs = flattenVecArray(section.uvs, 2);
    const indices = new Uint16Array(section.indices);

    const positionAccessor = packer.addAccessorFromTypedArray(positions, {
      type: "VEC3",
      componentType: COMPONENT_TYPE.FLOAT,
      target: GL_ARRAY_BUFFER,
    });

    const uvAccessor = packer.addAccessorFromTypedArray(uvs, {
      type: "VEC2",
      componentType: COMPONENT_TYPE.FLOAT,
      target: GL_ARRAY_BUFFER,
    });

    const jointAccessor = packer.addAccessorFromTypedArray(section.joints, {
      type: "VEC4",
      componentType: COMPONENT_TYPE.UNSIGNED_SHORT,
      target: GL_ARRAY_BUFFER,
      includeMinMax: false,
    });

    const weightAccessor = packer.addAccessorFromTypedArray(section.weights, {
      type: "VEC4",
      componentType: COMPONENT_TYPE.FLOAT,
      target: GL_ARRAY_BUFFER,
      includeMinMax: false,
    });

    const indexAccessor = packer.addAccessorFromTypedArray(indices, {
      type: "SCALAR",
      componentType: COMPONENT_TYPE.UNSIGNED_SHORT,
      target: GL_ELEMENT_ARRAY_BUFFER,
    });

    primitives.push({
      attributes: {
        POSITION: positionAccessor,
        TEXCOORD_0: uvAccessor,
        JOINTS_0: jointAccessor,
        WEIGHTS_0: weightAccessor,
      },
      indices: indexAccessor,
      material: materialIndex,
    });
  }

  addPrimitive(geometry.opaque, 0);
  addPrimitive(geometry.alpha, 1);

  if (primitives.length === 0) {
    throw new Error("No mesh primitives generated for boss model");
  }

  const joints = [1];
  for (let g = 0; g < groupCount; g++) {
    joints.push(2 + g);
  }

  const inverseBind = new Float32Array(joints.length * 16);
  for (let i = 0; i < joints.length; i++) {
    const base = i * 16;
    inverseBind[base + 0] = 1;
    inverseBind[base + 5] = 1;
    inverseBind[base + 10] = 1;
    inverseBind[base + 15] = 1;
  }

  const inverseBindAccessor = packer.addAccessorFromTypedArray(inverseBind, {
    type: "MAT4",
    componentType: COMPONENT_TYPE.FLOAT,
    includeMinMax: false,
  });

  const animations = [];

  for (const clip of clips) {
    const samplers = [];
    const channels = [];

    const defaultTimeAccessor = packer.addAccessorFromTypedArray(clip.times, {
      type: "SCALAR",
      componentType: COMPONENT_TYPE.FLOAT,
    });

    for (const jointTrack of clip.joints) {
      const timeAccessor = jointTrack.overrideTimes
        ? packer.addAccessorFromTypedArray(jointTrack.overrideTimes, {
          type: "SCALAR",
          componentType: COMPONENT_TYPE.FLOAT,
        })
        : defaultTimeAccessor;

      const translationAccessor = packer.addAccessorFromTypedArray(jointTrack.positions, {
        type: "VEC3",
        componentType: COMPONENT_TYPE.FLOAT,
      });

      const rotationAccessor = packer.addAccessorFromTypedArray(jointTrack.rotations, {
        type: "VEC4",
        componentType: COMPONENT_TYPE.FLOAT,
      });

      const scaleAccessor = packer.addAccessorFromTypedArray(jointTrack.scales, {
        type: "VEC3",
        componentType: COMPONENT_TYPE.FLOAT,
      });

      const tSampler = samplers.length;
      samplers.push({ input: timeAccessor, output: translationAccessor, interpolation: "STEP" });
      channels.push({ sampler: tSampler, target: { node: jointTrack.node, path: "translation" } });

      const rSampler = samplers.length;
      samplers.push({ input: timeAccessor, output: rotationAccessor, interpolation: "STEP" });
      channels.push({ sampler: rSampler, target: { node: jointTrack.node, path: "rotation" } });

      const sSampler = samplers.length;
      samplers.push({ input: timeAccessor, output: scaleAccessor, interpolation: "STEP" });
      channels.push({ sampler: sSampler, target: { node: jointTrack.node, path: "scale" } });
    }

    animations.push({
      name: clip.name,
      samplers,
      channels,
    });
  }

  const nodes = [
    {
      name: "boss_root",
      mesh: 0,
      skin: 0,
      children: [1],
    },
    {
      name: "joint_root",
      children: Array.from({ length: groupCount }, (_, i) => i + 2),
    },
  ];

  for (let g = 0; g < groupCount; g++) {
    nodes.push({
      name: `joint_vg_${String(g).padStart(3, "0")}`,
    });
  }

  const buffer = packer.buildBuffer();

  const gltfJson = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{ primitives }],
    skins: [
      {
        skeleton: 1,
        joints,
        inverseBindMatrices: inverseBindAccessor,
      },
    ],
    animations,
    samplers: [
      {
        magFilter: 9728,
        minFilter: 9987,
        wrapS: 33648,
        wrapT: 33648,
      },
    ],
    images: [{ uri: geometry.paletteFileName }],
    textures: [{ source: 0, sampler: 0 }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
      {
        alphaMode: "BLEND",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    buffers: [
      {
        uri: "corrupted_hunlef.bin",
        byteLength: buffer.byteLength,
      },
    ],
    bufferViews: packer.bufferViews,
    accessors: packer.accessors,
  };

  return { gltfJson, buffer };
}

async function main() {
  console.log("[export-skeletal] Exporting Corrupted Hunlef skeletal GLTF");
  console.log(`[export-skeletal] Cache version: ${CACHE_VERSION}`);

  ensureDir(OUTPUT_DIR);

  const cache = new RSCache(CACHE_VERSION);
  await cache.onload;

  try {
    const modelFiles = await cache.getAllFiles(IndexType.MODELS, BOSS_MODEL_ID);
    if (!modelFiles || modelFiles.length === 0 || !modelFiles[0].def) {
      throw new Error(`Model ${BOSS_MODEL_ID} not found`);
    }

    const modelDef = modelFiles[0].def;
    const allSequences = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.SEQUENCE);

    const resolvedSequences = [];
    for (const [name, sequenceId] of CLIPS) {
      const seqDef = allSequences[sequenceId];
      if (!seqDef) {
        throw new Error(`Missing sequence ${name} (${sequenceId})`);
      }
      if (seqDef.animMayaID !== -1) {
        throw new Error(`Sequence ${name} (${sequenceId}) has animMayaID=${seqDef.animMayaID}, expected -1`);
      }
      resolvedSequences.push([name, seqDef]);
    }

    const vertexToGroup = buildVertexToGroup(modelDef);
    const { counts: groupVertexCounts } = buildGroupCentroids(modelDef);

    const nonEmptyGroups = Array.from(groupVertexCounts).filter((count) => count > 0).length;

    console.log(
      `[export-skeletal] Model ${BOSS_MODEL_ID}: ` +
      `${modelDef.vertexCount} vertices, ${modelDef.faceCount} faces, ` +
      `${modelDef.vertexGroups.length} groups (${nonEmptyGroups} non-empty)`
    );

    const geometry = buildGeometry(modelDef, vertexToGroup);

    const clips = await buildAnimations({
      cache,
      modelDef,
      sequences: resolvedSequences,
      vertexToGroup,
      jointNodeStart: 2,
    });

    const { gltfJson, buffer } = buildGltf({
      modelDef,
      geometry,
      clips,
      groupCount: modelDef.vertexGroups.length,
    });

    writeFileSync(OUTPUT_FILE, JSON.stringify(gltfJson));
    writeFileSync(join(OUTPUT_DIR, "corrupted_hunlef.bin"), buffer);
    writeFileSync(join(OUTPUT_DIR, geometry.paletteFileName), geometry.palettePngBuffer);
    cleanupLegacyBossBuffers(OUTPUT_DIR);

    console.log(`[export-skeletal] Wrote ${OUTPUT_FILE}`);
    console.log(`[export-skeletal] File size ${(Buffer.byteLength(JSON.stringify(gltfJson)) / 1024).toFixed(1)} KB`);
  } finally {
    cache.close();
  }
}

main().catch((error) => {
  console.error(`[export-skeletal] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
