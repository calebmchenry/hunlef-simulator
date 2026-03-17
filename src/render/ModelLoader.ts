/**
 * Loads OSRS model JSON data into Three.js BufferGeometry with per-face vertex colors.
 */
import * as THREE from 'three';
import { osrsHSLtoRGB } from './osrsColor.ts';

export interface OSRSModelJSON {
  vertexCount: number;
  faceCount: number;
  vertexPositionsX: number[];
  vertexPositionsY: number[];
  vertexPositionsZ: number[];
  faceVertexIndices1: number[];
  faceVertexIndices2: number[];
  faceVertexIndices3: number[];
  faceColors: number[];
  faceAlphas?: number[];
}

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  hasTransparency: boolean;
}

/**
 * Convert OSRS model JSON to a Three.js BufferGeometry with vertex colors.
 * Uses flat shading by duplicating vertices per face (3 verts * faceCount).
 * OSRS coordinate system: Y is height (up), which matches Three.js.
 * However OSRS Y increases downward for model data, so we negate Y.
 */
export function loadModelFromJSON(data: OSRSModelJSON): LoadedModel {
  const faceCount = data.faceCount;

  // 3 vertices per face (flat shading - no shared vertices)
  const positions = new Float32Array(faceCount * 3 * 3);
  const colors = new Float32Array(faceCount * 3 * 3);

  let hasTransparency = false;

  for (let f = 0; f < faceCount; f++) {
    const i1 = data.faceVertexIndices1[f];
    const i2 = data.faceVertexIndices2[f];
    const i3 = data.faceVertexIndices3[f];

    // Position: OSRS X → Three.js X, OSRS Y → Three.js -Y (negate), OSRS Z → Three.js Z
    const base = f * 9;
    positions[base + 0] = data.vertexPositionsX[i1];
    positions[base + 1] = -data.vertexPositionsY[i1];
    positions[base + 2] = data.vertexPositionsZ[i1];

    positions[base + 3] = data.vertexPositionsX[i2];
    positions[base + 4] = -data.vertexPositionsY[i2];
    positions[base + 5] = data.vertexPositionsZ[i2];

    positions[base + 6] = data.vertexPositionsX[i3];
    positions[base + 7] = -data.vertexPositionsY[i3];
    positions[base + 8] = data.vertexPositionsZ[i3];

    // Face color (same for all 3 vertices of this face)
    const hsl = data.faceColors[f];
    const [r, g, b] = osrsHSLtoRGB(hsl);

    colors[base + 0] = r; colors[base + 1] = g; colors[base + 2] = b;
    colors[base + 3] = r; colors[base + 4] = g; colors[base + 5] = b;
    colors[base + 6] = r; colors[base + 7] = g; colors[base + 8] = b;

    // Check transparency
    if (data.faceAlphas && data.faceAlphas[f] !== 0) {
      hasTransparency = true;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return { geometry, hasTransparency };
}
