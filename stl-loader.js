/**
 * Multi-variant STL loader: binary, ASCII, colored binary, multi-solid, gzip, BOM.
 */

import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  throwIfCancelled,
  yieldToMain,
  computeSampleStride,
} from './large-file-loader.js?v=2.6.14';

const STL_EXTENSIONS = new Set(['stl', 'stla', 'stlb', 'stl.gz']);

const BINARY_TRIANGLE_SIZE = 50;
const BINARY_HEADER_SIZE = 80;
const BINARY_COUNT_SIZE = 4;

export function isStlExtension(ext) {
  return STL_EXTENSIONS.has((ext || '').toLowerCase());
}

export function isLikelyStlBuffer(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length < 15) return false;
  if (isGzip(u8)) return true;
  const { offset } = stripBom(u8);
  if (looksLikeAsciiStl(u8, offset)) return true;
  return looksLikeBinaryStl(u8, offset);
}

function isGzip(u8) {
  return u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

function stripBom(u8) {
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return { bytes: u8.subarray(3), offset: 3 };
  }
  return { bytes: u8, offset: 0 };
}

function readAsciiPreview(u8, offset, maxLen = 80) {
  const end = Math.min(u8.length, offset + maxLen);
  let text = '';
  for (let i = offset; i < end; i++) {
    const c = u8[i];
    if (c === 0) break;
    text += String.fromCharCode(c);
  }
  return text.trimStart().toLowerCase();
}

function readUInt32LE(u8, offset) {
  return (
    u8[offset]
    | (u8[offset + 1] << 8)
    | (u8[offset + 2] << 16)
    | (u8[offset + 3] << 24)
  ) >>> 0;
}

function looksLikeAsciiStl(u8, offset = 0) {
  const head = readAsciiPreview(u8, offset, 120);
  return head.startsWith('solid') || head.includes('facet');
}

function looksLikeBinaryStl(u8, offset = 0) {
  if (u8.length < offset + BINARY_HEADER_SIZE + BINARY_COUNT_SIZE) return false;
  const triCount = readUInt32LE(u8, offset + BINARY_HEADER_SIZE);
  if (triCount === 0) return false;
  const expected = BINARY_HEADER_SIZE + BINARY_COUNT_SIZE + triCount * BINARY_TRIANGLE_SIZE;
  const actual = u8.length - offset;
  return actual >= expected - BINARY_TRIANGLE_SIZE && actual <= expected + BINARY_TRIANGLE_SIZE * 2;
}

function isBinaryStlDespiteSolidHeader(u8, offset = 0) {
  if (!readAsciiPreview(u8, offset, 6).startsWith('solid')) return false;
  return looksLikeBinaryStl(u8, offset);
}

function detectPreferredFormat(u8, ext = '') {
  const extLower = (ext || '').toLowerCase();
  if (extLower === 'stla') return 'ascii';
  if (extLower === 'stlb') return 'binary';

  const { bytes, offset } = stripBom(u8);
  if (isBinaryStlDespiteSolidHeader(bytes, offset)) return 'binary';
  if (looksLikeAsciiStl(bytes, offset) && !looksLikeBinaryStl(bytes, offset)) return 'ascii';
  if (looksLikeBinaryStl(bytes, offset)) return 'binary';
  if (looksLikeAsciiStl(bytes, offset)) return 'ascii';
  return 'auto';
}

function materialiseColor(attr) {
  if ((attr & 0x8000) === 0) return null;
  const r = ((attr >> 10) & 0x1f) / 31;
  const g = ((attr >> 5) & 0x1f) / 31;
  const b = (attr & 0x1f) / 31;
  return { r, g, b };
}

function buildBinaryStlGeometry(THREE, positions, colors, hasColor, computeNormals = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (hasColor) {
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  if (computeNormals) geometry.computeVertexNormals();
  return geometry;
}

function parseBinaryStl(u8, THREE, offset = 0, { sampleStride = 1, computeNormals = true } = {}) {
  const triCount = readUInt32LE(u8, offset + BINARY_HEADER_SIZE);
  const stride = Math.max(1, sampleStride | 0);
  const outCount = Math.ceil(triCount / stride);
  const start = offset + BINARY_HEADER_SIZE + BINARY_COUNT_SIZE;
  const positions = new Float32Array(outCount * 9);
  const colors = new Float32Array(outCount * 9);
  let hasColor = false;
  const data = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let out = 0;

  for (let i = 0; i < triCount; i += stride) {
    const base = start + i * BINARY_TRIANGLE_SIZE;
    if (base + BINARY_TRIANGLE_SIZE > u8.length) break;

    const attr = data.getUint16(base + 48, true);
    const color = materialiseColor(attr);
    if (color) hasColor = true;

    for (let v = 0; v < 3; v++) {
      const posBase = (out * 3 + v) * 3;
      const src = base + 12 + v * 12;
      positions[posBase] = data.getFloat32(src, true);
      positions[posBase + 1] = data.getFloat32(src + 4, true);
      positions[posBase + 2] = data.getFloat32(src + 8, true);
      if (color) {
        colors[posBase] = color.r;
        colors[posBase + 1] = color.g;
        colors[posBase + 2] = color.b;
      }
    }
    out++;
  }

  const geometry = buildBinaryStlGeometry(THREE, positions, colors, hasColor, computeNormals);
  const variant = hasColor ? 'binary-color' : 'binary';
  const note = stride > 1 ? `${variant}+sampled` : variant;
  return [{ name: 'STL', geometry, variant: note, triangleCount: triCount }];
}

async function parseBinaryStlProgressive(u8, THREE, {
  offset = 0,
  sampleStride = 1,
  batchSize = 50000,
  computeNormals = true,
  signal,
  onProgress,
  onBatch,
} = {}) {
  const triCount = readUInt32LE(u8, offset + BINARY_HEADER_SIZE);
  const stride = Math.max(1, sampleStride | 0);
  const start = offset + BINARY_HEADER_SIZE + BINARY_COUNT_SIZE;
  const data = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const batchCap = Math.max(1000, batchSize | 0);

  let batchPositions = [];
  let batchColors = [];
  let batchHasColor = false;
  let batchOut = 0;
  let outTotal = 0;
  let hasColor = false;
  const parts = [];
  let partIdx = 0;

  const flushBatch = async (sourceIndex) => {
    if (batchOut === 0) return;
    const positions = new Float32Array(batchOut * 9);
    const colors = batchHasColor ? new Float32Array(batchOut * 9) : null;
    for (let i = 0; i < batchOut * 9; i++) {
      positions[i] = batchPositions[i];
      if (colors) colors[i] = batchColors[i];
    }
    const geometry = buildBinaryStlGeometry(THREE, positions, colors, batchHasColor, computeNormals);
    const part = {
      name: parts.length > 0 ? `STL chunk ${partIdx + 1}` : 'STL',
      geometry,
      variant: batchHasColor ? 'binary-color' : 'binary',
      triangleCount: triCount,
      sampled: stride > 1,
    };
    parts.push(part);
    await onBatch?.(part, sourceIndex, triCount);
    partIdx++;
    batchPositions = [];
    batchColors = [];
    batchHasColor = false;
    batchOut = 0;
    onProgress?.(sourceIndex, triCount, 'parse');
    await yieldToMain(signal);
  };

  for (let i = 0; i < triCount; i += stride) {
    throwIfCancelled(signal);
    const base = start + i * BINARY_TRIANGLE_SIZE;
    if (base + BINARY_TRIANGLE_SIZE > u8.length) break;

    const attr = data.getUint16(base + 48, true);
    const color = materialiseColor(attr);
    if (color) {
      hasColor = true;
      batchHasColor = true;
    }

    for (let v = 0; v < 3; v++) {
      const src = base + 12 + v * 12;
      batchPositions.push(
        data.getFloat32(src, true),
        data.getFloat32(src + 4, true),
        data.getFloat32(src + 8, true),
      );
      if (color) {
        batchColors.push(color.r, color.g, color.b);
      }
    }
    batchOut++;
    outTotal++;

    if (batchOut >= batchCap) {
      await flushBatch(i);
    }
  }

  await flushBatch(triCount);
  if (parts.length === 0) throw new Error('STL_NO_VERTICES');

  const variant = hasColor ? 'binary-color' : 'binary';
  if (stride > 1) parts[0].variant = `${variant}+sampled`;
  parts[0].triangleCount = triCount;
  return parts;
}

function parseAsciiStl(text, THREE) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const solids = splitAsciiSolids(normalized);
  const parts = [];

  for (const solid of solids) {
    const positions = [];
    const facetRe = /facet\s+normal\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)([\s\S]*?)endfacet/gi;
    let facetMatch;
    while ((facetMatch = facetRe.exec(solid.body)) !== null) {
      const vertexRe = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
      const verts = [];
      let vMatch;
      while ((vMatch = vertexRe.exec(facetMatch[4])) !== null && verts.length < 9) {
        verts.push(parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3]));
      }
      if (verts.length === 9) positions.push(...verts);
    }

    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    parts.push({
      name: solid.name || `Solid ${parts.length + 1}`,
      geometry,
      variant: 'ascii',
    });
  }

  return parts;
}

function splitAsciiSolids(text) {
  const solids = [];
  const re = /solid\s+([^\n]*)\n([\s\S]*?)\nendsolid[^\n]*/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    solids.push({ name: (match[1] || '').trim(), body: match[2] || '' });
  }

  if (solids.length > 0) return solids;

  if (/facet/i.test(text)) {
    return [{ name: 'STL', body: text }];
  }
  return [];
}

async function decompressGzip(buffer, signal) {
  throwIfCancelled(signal);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('GZIP_STL_UNSUPPORTED');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressed = await new Response(stream).arrayBuffer();
  throwIfCancelled(signal);
  return new Uint8Array(decompressed);
}

function parseWithThreeLoader(buffer, THREE) {
  const geometry = new STLLoader().parse(buffer);
  return [{ name: 'STL', geometry, variant: 'three-fallback' }];
}

/**
 * @returns {Promise<Array<{ name: string, geometry: THREE.BufferGeometry, variant: string }>>}
 */
export async function loadStl(buffer, THREE, {
  ext = 'stl',
  signal,
  onProgress,
  onBatch,
  progressive = false,
  fastPreview = false,
  maxTriangles = Infinity,
  meshBatchSize = 50000,
} = {}) {
  throwIfCancelled(signal);
  onProgress?.(0, 1, 'parse');

  let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let variantNote = '';

  if (isGzip(bytes)) {
    bytes = await decompressGzip(bytes, signal);
    variantNote = 'gzip';
  }

  const { bytes: stripped, offset } = stripBom(bytes);
  const work = offset > 0 ? stripped : bytes;
  const format = detectPreferredFormat(work, ext);
  const computeNormals = !fastPreview;
  const useProgressive = progressive && onBatch && looksLikeBinaryStl(work);

  let parts = [];
  const attempts = format === 'auto' ? ['binary', 'ascii'] : [format, format === 'binary' ? 'ascii' : 'binary'];

  for (const attempt of attempts) {
    try {
      if (attempt === 'binary' && looksLikeBinaryStl(work)) {
        const triCount = readUInt32LE(work, 0);
        const sampleStride = fastPreview
          ? computeSampleStride(triCount, maxTriangles)
          : 1;

        if (useProgressive && triCount > meshBatchSize) {
          parts = await parseBinaryStlProgressive(work, THREE, {
            offset: 0,
            sampleStride,
            batchSize: meshBatchSize,
            computeNormals,
            signal,
            onProgress,
            onBatch,
          });
        } else {
          parts = parseBinaryStl(work, THREE, 0, { sampleStride, computeNormals });
        }
        break;
      }
      if (attempt === 'ascii' && looksLikeAsciiStl(work) && !isBinaryStlDespiteSolidHeader(work)) {
        const text = new TextDecoder().decode(work);
        parts = parseAsciiStl(text, THREE);
        if (parts.length > 0) break;
      }
    } catch (err) {
      if (err?.message === 'STL_NO_VERTICES') throw err;
      // try next strategy
    }
  }

  if (parts.length === 0) {
    try {
      parts = parseWithThreeLoader(work.buffer.slice(work.byteOffset, work.byteOffset + work.byteLength), THREE);
    } catch {
      throw new Error('STL_PARSE_FAILED');
    }
  }

  if (variantNote && parts[0]) {
    parts[0].variant = `${parts[0].variant}+${variantNote}`;
  }

  for (const part of parts) {
    if (!part.geometry?.attributes?.position || part.geometry.attributes.position.count === 0) {
      throw new Error('STL_NO_VERTICES');
    }
  }

  await yieldToMain(signal);
  return parts;
}