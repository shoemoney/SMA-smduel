#!/usr/bin/env node
// Minimal pure-Node PNG decoder + corner background sampler.
// No image libs are installed in this project, so we parse PNG chunks by hand:
// signature -> IHDR -> concatenated IDAT -> zlib inflate -> per-scanline unfilter.
//
// Usage: node tools/sample-bg.mjs <file1.png> [file2.png ...]
// Or with no args: samples every *.png in assets/raw/ (excluding nothing special).
//
// Outputs JSON to stdout: { file: { width, height, bitDepth, colorType, interlace,
//   corners: {tl,tr,bl,br}, medianRGB: [r,g,b], maxDeviation: n, error: "..." } }

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readChunks(buf) {
  const sig = buf.subarray(0, 8);
  const expectedSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!sig.equals(expectedSig)) {
    throw new Error('Not a PNG (bad signature)');
  }
  let offset = 8;
  const chunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    // skip 4-byte CRC
    chunks.push({ type, data });
    offset += 8 + length + 4;
  }
  return chunks;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bpp, bytesPerScanline) {
  // raw: inflated data, scanlines are (1 filter byte + bytesPerScanline) each
  const out = Buffer.alloc(height * bytesPerScanline);
  let rawOffset = 0;
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * bytesPerScanline;
    for (let i = 0; i < bytesPerScanline; i++) {
      const x = raw[rawOffset + i];
      const a = i >= bpp ? out[rowStart + i - bpp] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + i] : 0;
      const c = (prevRowStart >= 0 && i >= bpp) ? out[prevRowStart + i - bpp] : 0;
      let val;
      switch (filterType) {
        case 0: val = x; break;
        case 1: val = (x + a) & 0xff; break;
        case 2: val = (x + b) & 0xff; break;
        case 3: val = (x + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: val = (x + paethPredictor(a, b, c)) & 0xff; break;
        default: throw new Error(`Unknown filter type ${filterType} at row ${y}`);
      }
      out[rowStart + i] = val;
    }
    rawOffset += bytesPerScanline;
    prevRowStart = rowStart;
  }
  return out;
}

function decodePNG(buf) {
  const chunks = readChunks(buf);
  const ihdrChunk = chunks.find(c => c.type === 'IHDR');
  if (!ihdrChunk) throw new Error('No IHDR chunk');
  const ihdr = ihdrChunk.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  const compression = ihdr.readUInt8(10);
  const filterMethod = ihdr.readUInt8(11);
  const interlace = ihdr.readUInt8(12);

  if (interlace !== 0) {
    throw new Error(`Interlaced PNG (Adam7) not supported`);
  }
  if (compression !== 0 || filterMethod !== 0) {
    throw new Error(`Unsupported compression/filter method`);
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported bit depth ${bitDepth} (only 8-bit supported)`);
  }

  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (channels === undefined) {
    throw new Error(`Unsupported color type ${colorType}`);
  }
  if (colorType === 3) {
    throw new Error(`Palette color type not supported`);
  }

  const idatChunks = chunks.filter(c => c.type === 'IDAT').map(c => c.data);
  const idat = Buffer.concat(idatChunks);
  const inflated = zlib.inflateSync(idat);

  const bpp = Math.ceil((bitDepth * channels) / 8); // bytes per pixel, 8-bit => = channels
  const bytesPerScanline = Math.ceil((bitDepth * channels * width) / 8);
  const expectedLen = (bytesPerScanline + 1) * height;
  if (inflated.length < expectedLen) {
    throw new Error(`Inflated data too short: got ${inflated.length}, expected ${expectedLen}`);
  }

  const pixels = unfilter(inflated, width, height, bpp, bytesPerScanline);

  return { width, height, bitDepth, colorType, channels, bpp, bytesPerScanline, pixels };
}

function getPixel(decoded, x, y) {
  const { pixels, bytesPerScanline, channels } = decoded;
  const rowStart = y * bytesPerScanline;
  const idx = rowStart + x * channels;
  if (channels >= 3) {
    return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
  } else {
    // grayscale
    const g = pixels[idx];
    return [g, g, g];
  }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function samplePatch(decoded, x0, y0, size) {
  const rs = [], gs = [], bs = [];
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const [r, g, b] = getPixel(decoded, x, y);
      rs.push(r); gs.push(g); bs.push(b);
    }
  }
  return [median(rs), median(gs), median(bs)];
}

function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function sampleFile(filePath) {
  const buf = fs.readFileSync(filePath);
  let decoded;
  try {
    decoded = decodePNG(buf);
  } catch (e) {
    return { error: e.message };
  }
  const { width, height, bitDepth, colorType } = decoded;
  const patch = 24;
  const corners = {
    tl: samplePatch(decoded, 0, 0, patch),
    tr: samplePatch(decoded, width - patch, 0, patch),
    bl: samplePatch(decoded, 0, height - patch, patch),
    br: samplePatch(decoded, width - patch, height - patch, patch),
  };
  const allR = Object.values(corners).map(c => c[0]);
  const allG = Object.values(corners).map(c => c[1]);
  const allB = Object.values(corners).map(c => c[2]);
  const medianRGB = [median(allR), median(allG), median(allB)];
  const maxDeviation = Math.max(
    Math.max(...allR) - Math.min(...allR),
    Math.max(...allG) - Math.min(...allG),
    Math.max(...allB) - Math.min(...allB),
  );
  return {
    width, height, bitDepth, colorType,
    corners: Object.fromEntries(Object.entries(corners).map(([k, v]) => [k, toHex(v)])),
    medianRGB,
    keyColorHex: toHex(medianRGB),
    maxDeviation: Math.round(maxDeviation * 10) / 10,
  };
}

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length > 0) {
    files = args;
  } else {
    const rawDir = path.resolve(__dirname, '..', 'assets', 'raw');
    files = fs.readdirSync(rawDir)
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(rawDir, f));
  }
  const results = {};
  for (const f of files) {
    const key = path.basename(f, '.png');
    try {
      results[key] = sampleFile(f);
    } catch (e) {
      results[key] = { error: e.message };
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main();
