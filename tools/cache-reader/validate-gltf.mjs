#!/usr/bin/env node
/**
 * Validate exported GLTF files used by the simulator.
 *
 * Checks:
 * - Morph target POSITION deltas have non-zero data (decoded from buffers)
 * - Keyframe times are float32, finite, monotonic, and in [0, 60] seconds
 * - Weight output samples are finite and in [0, 1]
 * - Animation count and clip names match expected model contracts
 */

import { readFileSync, readdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";

const MODELS_DIR = join(import.meta.dirname, "../../public/models");

const BOSS_MODEL = "corrupted_hunlef.gltf";
const BOSS_CLIPS = [
  "idle",
  "attack_magic",
  "attack_ranged",
  "stomp",
  "prayer_disable",
  "death",
  "style_switch_mage",
  "style_switch_range",
];

const PLAYER_BODY_MODELS = new Set([
  "player_body_bow.gltf",
  "player_body_staff.gltf",
  "player_body_halberd.gltf",
]);
const PLAYER_BODY_CLIPS = ["idle", "attack", "eat"];

const COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const COMPONENT_SIZE = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const FLOAT32_COMPONENT_TYPE = 5126;
const EPSILON = 1e-8;

function decodeDataUri(uri) {
  const commaIndex = uri.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URI: missing comma separator");
  }

  const header = uri.slice(0, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    return Buffer.from(payload, "base64");
  }

  return Buffer.from(decodeURIComponent(payload), "utf8");
}

function loadBufferData(filePath, gltf, bufferIndex) {
  const bufferDef = gltf.buffers?.[bufferIndex];
  if (!bufferDef) {
    throw new Error(`Missing buffer[${bufferIndex}]`);
  }
  if (!bufferDef.uri) {
    throw new Error(`buffer[${bufferIndex}] has no URI`);
  }

  const data = bufferDef.uri.startsWith("data:")
    ? decodeDataUri(bufferDef.uri)
    : readFileSync(resolve(dirname(filePath), bufferDef.uri));

  if (typeof bufferDef.byteLength === "number" && data.byteLength < bufferDef.byteLength) {
    throw new Error(
      `buffer[${bufferIndex}] shorter than declared byteLength (${data.byteLength} < ${bufferDef.byteLength})`
    );
  }

  return data;
}

function readComponent(dataView, byteOffset, componentType, normalized) {
  switch (componentType) {
    case 5120: { // BYTE
      const value = dataView.getInt8(byteOffset);
      if (!normalized) return value;
      return Math.max(value / 127, -1);
    }
    case 5121: { // UNSIGNED_BYTE
      const value = dataView.getUint8(byteOffset);
      if (!normalized) return value;
      return value / 255;
    }
    case 5122: { // SHORT
      const value = dataView.getInt16(byteOffset, true);
      if (!normalized) return value;
      return Math.max(value / 32767, -1);
    }
    case 5123: { // UNSIGNED_SHORT
      const value = dataView.getUint16(byteOffset, true);
      if (!normalized) return value;
      return value / 65535;
    }
    case 5125: { // UNSIGNED_INT
      const value = dataView.getUint32(byteOffset, true);
      if (!normalized) return value;
      return value / 4294967295;
    }
    case 5126: // FLOAT
      return dataView.getFloat32(byteOffset, true);
    default:
      throw new Error(`Unsupported componentType: ${componentType}`);
  }
}

function readAccessorValues(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    throw new Error(`Missing accessor[${accessorIndex}]`);
  }
  if (accessor.bufferView === undefined) {
    throw new Error(`accessor[${accessorIndex}] has no bufferView`);
  }
  if (accessor.sparse) {
    throw new Error(`accessor[${accessorIndex}] uses sparse data (unsupported in validator)`);
  }

  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    throw new Error(`Missing bufferView[${accessor.bufferView}]`);
  }

  const componentCount = COMPONENT_COUNT[accessor.type];
  if (!componentCount) {
    throw new Error(`accessor[${accessorIndex}] has unsupported type "${accessor.type}"`);
  }

  const componentSize = COMPONENT_SIZE[accessor.componentType];
  if (!componentSize) {
    throw new Error(`accessor[${accessorIndex}] has unsupported componentType ${accessor.componentType}`);
  }

  const bufferData = buffers[bufferView.buffer];
  if (!bufferData) {
    throw new Error(`Missing decoded buffer[${bufferView.buffer}] for accessor[${accessorIndex}]`);
  }

  const stride = bufferView.byteStride ?? componentCount * componentSize;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count ?? 0;

  const values = new Float64Array(count * componentCount);
  const dataView = new DataView(bufferData.buffer, bufferData.byteOffset, bufferData.byteLength);

  let out = 0;
  for (let i = 0; i < count; i++) {
    const elementOffset = baseOffset + i * stride;
    for (let c = 0; c < componentCount; c++) {
      const byteOffset = elementOffset + c * componentSize;
      values[out++] = readComponent(dataView, byteOffset, accessor.componentType, accessor.normalized === true);
    }
  }

  return {
    accessor,
    values,
    componentCount,
  };
}

function expectedAnimationsForFile(fileName) {
  if (fileName === BOSS_MODEL) {
    return {
      count: BOSS_CLIPS.length,
      names: BOSS_CLIPS,
      requiresMorphValidation: true,
    };
  }

  if (PLAYER_BODY_MODELS.has(fileName)) {
    return {
      count: PLAYER_BODY_CLIPS.length,
      names: PLAYER_BODY_CLIPS,
      requiresMorphValidation: true,
    };
  }

  return {
    count: 0,
    names: [],
    requiresMorphValidation: false,
  };
}

function validateMorphTargets(gltf, buffers, requiresMorphValidation, errors) {
  let morphAccessorCount = 0;
  let nonZeroCount = 0;
  let totalCount = 0;
  let maxMagnitude = 0;

  const meshes = gltf.meshes ?? [];
  for (const mesh of meshes) {
    const primitives = mesh.primitives ?? [];
    for (const primitive of primitives) {
      const targets = primitive.targets ?? [];
      for (const target of targets) {
        if (target.POSITION === undefined) continue;

        morphAccessorCount++;
        const { values } = readAccessorValues(gltf, buffers, target.POSITION);
        for (const value of values) {
          totalCount++;
          const magnitude = Math.abs(value);
          if (magnitude > EPSILON) {
            nonZeroCount++;
          }
          if (magnitude > maxMagnitude) {
            maxMagnitude = magnitude;
          }
        }
      }
    }
  }

  if (requiresMorphValidation && morphAccessorCount === 0) {
    errors.push("Expected morph targets but found none");
  }

  if (morphAccessorCount > 0 && (nonZeroCount === 0 || maxMagnitude <= EPSILON)) {
    errors.push("Morph target POSITION deltas are all zero");
  }

  return { morphAccessorCount, nonZeroCount, totalCount, maxMagnitude };
}

function validateAnimationContracts(fileName, gltf, expected, errors) {
  const animations = gltf.animations ?? [];
  if (animations.length !== expected.count) {
    errors.push(`Expected ${expected.count} animations, found ${animations.length}`);
  }

  if (expected.names.length === 0) return;

  const actualNames = animations.map((anim) => String(anim.name ?? ""));
  const actualNameSet = new Set(actualNames);
  const expectedNameSet = new Set(expected.names);

  const missing = expected.names.filter((name) => !actualNameSet.has(name));
  const extra = actualNames.filter((name) => !expectedNameSet.has(name));

  if (missing.length > 0 || extra.length > 0) {
    errors.push(
      `${fileName} clip names mismatch (missing: ${missing.join(", ") || "none"}; ` +
      `extra: ${extra.join(", ") || "none"})`
    );
  }
}

function validateAnimationSamplers(gltf, buffers, errors) {
  const animations = gltf.animations ?? [];

  for (let animIndex = 0; animIndex < animations.length; animIndex++) {
    const animation = animations[animIndex];
    const samplers = animation.samplers ?? [];
    const channels = animation.channels ?? [];

    for (let samplerIndex = 0; samplerIndex < samplers.length; samplerIndex++) {
      const sampler = samplers[samplerIndex];
      const { accessor, values, componentCount } = readAccessorValues(gltf, buffers, sampler.input);

      if (accessor.componentType !== FLOAT32_COMPONENT_TYPE || accessor.type !== "SCALAR") {
        errors.push(
          `Animation[${animIndex}] sampler[${samplerIndex}] input accessor must be float32 scalar`
        );
      }

      let previous = -Infinity;
      for (const time of values) {
        if (!Number.isFinite(time)) {
          errors.push(`Animation[${animIndex}] sampler[${samplerIndex}] has non-finite keyframe time`);
          break;
        }

        if (time < previous) {
          errors.push(`Animation[${animIndex}] sampler[${samplerIndex}] keyframe times are not monotonic`);
          break;
        }
        previous = time;

        if (time < 0 || time > 60) {
          errors.push(`Animation[${animIndex}] sampler[${samplerIndex}] time ${time} out of range [0, 60]`);
          break;
        }
      }

      if (componentCount !== 1) {
        errors.push(`Animation[${animIndex}] sampler[${samplerIndex}] input accessor is not scalar`);
      }
    }

    const weightSamplerIndexes = new Set(
      channels
        .filter((channel) => channel.target?.path === "weights")
        .map((channel) => channel.sampler)
    );

    for (const samplerIndex of weightSamplerIndexes) {
      const sampler = samplers[samplerIndex];
      if (!sampler) {
        errors.push(`Animation[${animIndex}] references missing sampler[${samplerIndex}]`);
        continue;
      }

      const { values } = readAccessorValues(gltf, buffers, sampler.output);
      for (const value of values) {
        if (!Number.isFinite(value)) {
          errors.push(`Animation[${animIndex}] sampler[${samplerIndex}] has non-finite weight output`);
          break;
        }

        if (value < 0 || value > 1) {
          errors.push(
            `Animation[${animIndex}] sampler[${samplerIndex}] has weight output ${value} outside [0, 1]`
          );
          break;
        }
      }
    }
  }
}

function validateFile(filePath) {
  const fileName = basename(filePath);
  const expected = expectedAnimationsForFile(fileName);
  const errors = [];

  const raw = readFileSync(filePath, "utf8");
  const gltf = JSON.parse(raw);
  const buffers = (gltf.buffers ?? []).map((_, index) => loadBufferData(filePath, gltf, index));

  const morphStats = validateMorphTargets(gltf, buffers, expected.requiresMorphValidation, errors);
  validateAnimationContracts(fileName, gltf, expected, errors);
  validateAnimationSamplers(gltf, buffers, errors);

  if (errors.length > 0) {
    console.log(`FAIL ${fileName}`);
    for (const error of errors) {
      console.log(`  - ${error}`);
    }
    return false;
  }

  console.log(
    `PASS ${fileName} | animations=${(gltf.animations ?? []).length} ` +
    `| morphTargets=${morphStats.morphAccessorCount} ` +
    `| nonZeroMorphValues=${morphStats.nonZeroCount}/${morphStats.totalCount} ` +
    `| maxMorphMagnitude=${morphStats.maxMagnitude.toFixed(6)}`
  );
  return true;
}

function main() {
  const fileNames = readdirSync(MODELS_DIR)
    .filter((name) => name.endsWith(".gltf"))
    .sort();

  if (fileNames.length === 0) {
    console.error(`No .gltf files found under ${MODELS_DIR}`);
    process.exit(1);
  }

  console.log(`Validating ${fileNames.length} GLTF file(s) in ${MODELS_DIR}`);

  let failed = 0;
  for (const fileName of fileNames) {
    const filePath = join(MODELS_DIR, fileName);
    try {
      const ok = validateFile(filePath);
      if (!ok) failed++;
    } catch (error) {
      failed++;
      console.log(`FAIL ${fileName}`);
      console.log(`  - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed > 0) {
    console.error(`\nValidation failed: ${failed} file(s) did not pass`);
    process.exit(1);
  }

  console.log("\nAll GLTF validations passed.");
  process.exit(0);
}

main();
