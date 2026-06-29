/** Adaptive loading strategy and helpers for large 3D/CAD files. */

export const LOAD_QUALITY = {
  AUTO: 'auto',
  FAST: 'fast',
  FULL: 'full',
};

const MB = 1024 * 1024;

const CAD_TESS = {
  small: { linearDeflection: 0.01, angularDeflection: 0.5 },
  medium: { linearDeflection: 0.025, angularDeflection: 0.8 },
  large: { linearDeflection: 0.05, angularDeflection: 1.0 },
  huge: { linearDeflection: 0.1, angularDeflection: 1.5 },
};

const MAX_TRIANGLES = {
  small: Infinity,
  medium: 600_000,
  large: 350_000,
  huge: 180_000,
};

const BATCH_SIZE = {
  small: 20,
  medium: 10,
  large: 6,
  huge: 3,
};

const DXF_BATCH = {
  small: 4000,
  medium: 1500,
  large: 600,
  huge: 250,
};

export class LoadCancelledError extends Error {
  constructor() {
    super('Load cancelled');
    this.name = 'LoadCancelledError';
  }
}

export function isLoadCancelled(err) {
  return err?.name === 'LoadCancelledError' || err?.name === 'AbortError';
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new LoadCancelledError();
}

export async function yieldToMain(signal) {
  throwIfCancelled(signal);
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  throwIfCancelled(signal);
}

function sizeTier(fileSize) {
  if (fileSize > 100 * MB) return 'huge';
  if (fileSize > 30 * MB) return 'large';
  if (fileSize > 5 * MB) return 'medium';
  return 'small';
}

function bumpTier(tier) {
  if (tier === 'small') return 'medium';
  if (tier === 'medium') return 'large';
  if (tier === 'large') return 'huge';
  return 'huge';
}

export function resolveLoadStrategy(fileSize, ext, qualityMode = LOAD_QUALITY.AUTO) {
  const isCad = ['stp', 'step', 'iges', 'igs', 'brep', 'brp'].includes(ext);
  const isMesh = ['stl', 'stla', 'stlb', 'stl.gz', 'obj', 'ply', '3mf'].includes(ext);
  const is2d = ['dxf', 'dwg', 'ai'].includes(ext);

  let tier = sizeTier(fileSize);
  if (qualityMode === LOAD_QUALITY.FAST) tier = bumpTier(tier);
  if (qualityMode === LOAD_QUALITY.FULL) tier = 'small';

  return {
    tier,
    fileSize,
    isCad,
    isMesh,
    is2d,
    cadParams: isCad ? {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      ...CAD_TESS[tier],
    } : null,
    maxTriangles: isMesh ? MAX_TRIANGLES[tier] : Infinity,
    disableShadows: tier !== 'small',
    progressive: tier !== 'small' || fileSize > 2 * MB,
    meshBatchSize: BATCH_SIZE[tier],
    dxfBatchSize: DXF_BATCH[tier],
    fastPreview: tier !== 'small',
  };
}

export function countTriangles(geometry) {
  const idx = geometry?.index;
  if (idx) return Math.floor(idx.count / 3);
  const pos = geometry?.attributes?.position;
  return pos ? Math.floor(pos.count / 3) : 0;
}

export async function simplifyGeometryIfNeeded(THREE, SimplifyModifier, geometry, maxTriangles, signal) {
  const triCount = countTriangles(geometry);
  if (!Number.isFinite(maxTriangles) || triCount <= maxTriangles) return geometry;

  await yieldToMain(signal);
  throwIfCancelled(signal);
  const mod = new SimplifyModifier();
  const targetVerts = Math.max(3000, Math.floor(maxTriangles * 2));
  const currentVerts = geometry.attributes.position.count;
  if (currentVerts <= targetVerts) return geometry;

  try {
    const simplified = mod.modify(geometry.clone(), Math.min(targetVerts, currentVerts));
    geometry.dispose();
    return simplified;
  } catch (err) {
    console.warn('mesh simplify failed:', err);
    return geometry;
  }
}

export function applyLargeModelHints(object3d, strategy) {
  if (!strategy?.disableShadows) return;
  object3d.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
}

export function createIndexAttribute(THREE, indexArray) {
  const data = indexArray instanceof Uint32Array
    ? indexArray
    : new Uint32Array(indexArray);
  return new THREE.BufferAttribute(data, 1);
}