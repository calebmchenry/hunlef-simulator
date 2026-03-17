/**
 * OSRS HSL-to-RGB color conversion.
 * Ported from osrscachereader GLTFExporter.js
 */

const BRIGHTNESS = 0.6;
const HUE_OFFSET = 0.5 / 64;
const SATURATION_OFFSET = 0.5 / 8;

/**
 * Convert a packed OSRS HSL color value to RGB [0-1, 0-1, 0-1].
 */
export function osrsHSLtoRGB(hsl: number): [number, number, number] {
  const hue = ((hsl >> 10) & 63) / 64 + HUE_OFFSET;
  const saturation = ((hsl >> 7) & 7) / 8 + SATURATION_OFFSET;
  const luminance = (hsl & 127) / 128;

  // HSL to RGB using chroma method
  const chroma = (1 - Math.abs(2 * luminance - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const lightness = luminance - chroma / 2;

  let r = lightness;
  let g = lightness;
  let b = lightness;

  const sector = Math.trunc(hue * 6);
  switch (sector) {
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

  // Pack to int, apply brightness, unpack back to [0,1]
  let ri = Math.trunc(r * 256.0);
  let gi = Math.trunc(g * 256.0);
  let bi = Math.trunc(b * 256.0);

  // Brightness adjustment: pow(channel, BRIGHTNESS)
  let rf = Math.pow(ri / 256.0, BRIGHTNESS);
  let gf = Math.pow(gi / 256.0, BRIGHTNESS);
  let bf = Math.pow(bi / 256.0, BRIGHTNESS);

  // Ensure not pure black (OSRS convention)
  ri = Math.trunc(rf * 256.0);
  gi = Math.trunc(gf * 256.0);
  bi = Math.trunc(bf * 256.0);
  let rgb = (ri << 16) | (gi << 8) | bi;
  if (rgb === 0) rgb = 1;

  rf = ((rgb >> 16) & 255) / 255;
  gf = ((rgb >> 8) & 255) / 255;
  bf = (rgb & 255) / 255;

  return [rf, gf, bf];
}
