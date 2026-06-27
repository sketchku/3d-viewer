import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { aiToSvg } from './ai-loader.js';
import { t } from './i18n.js';
import { throwIfCancelled, yieldToMain } from './large-file-loader.js';

const LIBREDWG_WASM = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.7/wasm';
const DXF_PARSER_URL = 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/+esm';
const LIBREDWG_URL = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.7/dist/libredwg-web.js';

const ENTITY_TYPES = new Set([
  'LINE', 'TEXT', 'MTEXT', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE',
  'SPLINE', 'POINT', 'INSERT', '3DFACE', 'SOLID', 'HATCH', 'DIMENSION', 'VERTEX',
  'ATTRIB',
]);

const CAD_FONT_FAMILY = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", Arial, sans-serif';
let cadFontsReady = null;

function ensureCadFonts() {
  if (!cadFontsReady) {
    cadFontsReady = (async () => {
      try {
        await Promise.all([
          document.fonts.load(`700 48px ${CAD_FONT_FAMILY}`),
          document.fonts.load(`400 48px ${CAD_FONT_FAMILY}`),
        ]);
        await document.fonts.ready;
      } catch {
        // System fonts still usable
      }
    })();
  }
  return cadFontsReady;
}

const ACI_COLORS = [
  0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff,
  0x808080, 0xc0c0c0, 0xff0000, 0xff7f7f, 0xa50000, 0xa55252, 0x7f0000, 0x7f3f3f,
  0xff3f00, 0xff9f7f, 0xa52900, 0xa56752, 0x7f1f00, 0x7f4f3f, 0xff7f00, 0xffbf7f,
  0xa55200, 0xa57c52, 0x7f3f00, 0x7f5f3f, 0xffbf00, 0xffdf7f, 0xa57c00, 0xa59152,
  0x7f5f00, 0x7f6f3f, 0xffff00, 0xffff7f, 0xa5a500, 0xa5a552, 0x7f7f00, 0x7f7f3f,
  0xbfff00, 0xdfff7f, 0x7ca500, 0x91a552, 0x5f7f00, 0x6f7f3f, 0x7fff00, 0xbfff7f,
  0x52a500, 0x7ca552, 0x3f7f00, 0x5f7f3f, 0x3fff00, 0x9fff7f, 0x29a500, 0x67a552,
  0x1f7f00, 0x4f7f3f, 0x00ff00, 0x7fff7f, 0x00a500, 0x52a552, 0x007f00, 0x3f7f3f,
  0x00ff3f, 0x7fff9f, 0x00a529, 0x52a567, 0x007f1f, 0x3f7f4f, 0x00ff7f, 0x7fffbf,
  0x00a552, 0x52a57c, 0x007f3f, 0x3f7f5f, 0x00ffbf, 0x7fffdf, 0x00a57c, 0x52a591,
  0x007f5f, 0x3f7f6f, 0x00ffff, 0x7fffff, 0x00a5a5, 0x52a5a5, 0x007f7f, 0x3f7f7f,
  0x00bfff, 0x7fdfff, 0x007ca5, 0x5291a5, 0x005f7f, 0x3f6f7f, 0x007fff, 0x7fbfff,
  0x0052a5, 0x527ca5, 0x003f7f, 0x3f5f7f, 0x003fff, 0x7f9fff, 0x0029a5, 0x5267a5,
  0x001f7f, 0x3f4f7f, 0x0000ff, 0x7f7fff, 0x0000a5, 0x5252a5, 0x00007f, 0x3f3f7f,
  0x3f00ff, 0x9f7fff, 0x2900a5, 0x6752a5, 0x1f007f, 0x4f3f7f, 0x7f00ff, 0xbf7fff,
  0x5200a5, 0x7c52a5, 0x3f007f, 0x5f3f7f, 0xbf00ff, 0xdf7fff, 0x7c00a5, 0x9152a5,
  0x5f007f, 0x6f3f7f, 0xff00ff, 0xff7fff, 0xa500a5, 0xa552a5, 0x7f007f, 0x7f3f7f,
  0xff00bf, 0xff7fdf, 0xa5007c, 0xa55291, 0x7f005f, 0x7f3f6f, 0xff007f, 0xff7fbf,
  0xa50052, 0xa5527c, 0x7f003f, 0x7f3f5f, 0xff003f, 0xff7f9f, 0xa50029, 0xa55267,
  0x7f001f, 0x7f3f4f, 0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff,
];

let libredwg = null;
let dxfParserCtor = null;

async function getDxfParser() {
  if (!dxfParserCtor) {
    const mod = await import(DXF_PARSER_URL);
    dxfParserCtor = mod.default;
    if (!dxfParserCtor) throw new Error(t('dxfParserError'));
  }
  return dxfParserCtor;
}

export async function initCad2dEngine() {
  if (!libredwg) {
    const mod = await import(LIBREDWG_URL);
    libredwg = await mod.LibreDwg.create(LIBREDWG_WASM);
  }
  return libredwg;
}

function looksLikeDxf(text) {
  return text.includes('SECTION') || text.includes('ENTITIES') || text.includes('HEADER');
}

function decodeDxfText(buffer) {
  const encodings = ['utf-8', 'euc-kr', 'iso-8859-1'];
  let best = '';
  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      if (!looksLikeDxf(text)) continue;
      const bad = (text.match(/\uFFFD/g) || []).length;
      if (!best || bad < (best.match(/\uFFFD/g) || []).length) best = text;
      if (bad === 0) return text;
    } catch {
      // try next encoding
    }
  }
  return best || new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

function normalizeCadText(input) {
  if (input == null) return '';
  let text = String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/\\M\+n[0-9A-Fa-f]+;/g, '');
  text = text.replace(/\\P/g, '\n');
  text = text.replace(/\\~ /g, ' ');
  text = text.replace(/\\S([^;^]+)\^([^;]+);/g, '$1$2');
  text = text.replace(/\\[LlOoKkHhQqWwTtFfSpC^%].*?;/g, '');
  text = text.replace(/\{([^{}]*);([^{}]*)\}/g, '$2');
  text = text.replace(/\{|\}/g, '');
  text = text.replace(/\\([\\{}])/g, '$1');
  text = text.replace(/[ \t]+\n/g, '\n').trim();

  return text;
}

function extractEntityText(entity) {
  let raw = entity?.text ?? entity?.string ?? entity?.textString ?? '';
  if ((!raw || raw === '<>') && entity?.actualMeasurement != null) {
    raw = formatMeasurement(entity.actualMeasurement);
  } else if (raw.includes('<>') && entity?.actualMeasurement != null) {
    raw = raw.replace(/<>/g, formatMeasurement(entity.actualMeasurement));
  }
  return normalizeCadText(raw);
}

function formatMeasurement(value) {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const fixed = abs >= 1000 ? value.toFixed(1) : abs >= 1 ? value.toFixed(2) : value.toFixed(3);
  return fixed.replace(/\.?0+$/, '');
}

function getTextPosition(entity) {
  return entity.startPoint
    || entity.position
    || entity.middleOfText
    || entity.insertionPoint
    || entity.anchorPoint
    || null;
}

function getTextHeight(entity) {
  const h = entity.textHeight ?? entity.height ?? entity.dimTextHeight;
  return Number.isFinite(h) && h > 0 ? h : 2.5;
}

export function isSketchLayerName(name) {
  return /sketch|스케치|profile|refgeom|rough|wire|contour|outline/i.test(String(name || ''));
}

export function isFrameLayerName(name) {
  return /border|frame|title|sheet|도곽|틀/i.test(String(name || ''));
}

const FRAME_ACCENT = 0x00e5ff;
const MIN_LINE_CONTRAST = 2.8;

function normalizeHexColor(value, fallback = 0xe8eaed) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value >>> 0;
  const hex = String(value).trim();
  if (!hex.startsWith('#')) return fallback;
  const parsed = Number.parseInt(hex.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorToRgb(hex) {
  const value = normalizeHexColor(hex);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function relativeLuminance(hex) {
  const { r, g, b } = colorToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(colorA, colorB) {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function ensureVisibleLineColor(rawColor, bgColor, lineColor, { isFrame = false } = {}) {
  const bg = normalizeHexColor(bgColor, 0x1a1d23);
  const fallback = normalizeHexColor(lineColor, 0xe8eaed);
  const raw = normalizeHexColor(rawColor, fallback);

  if (isFrame) {
    if (contrastRatio(FRAME_ACCENT, bg) >= MIN_LINE_CONTRAST) return FRAME_ACCENT;
    return relativeLuminance(bg) > 0.5 ? 0x1565c0 : 0xff6d00;
  }

  if (contrastRatio(raw, bg) >= MIN_LINE_CONTRAST) return raw;
  if (contrastRatio(fallback, bg) >= MIN_LINE_CONTRAST) return fallback;
  return relativeLuminance(bg) > 0.5 ? 0x1a1d23 : 0xe8eaed;
}

function tagCadMaterial(material, rawColor, layerName) {
  material.userData.cadRawColor = normalizeHexColor(rawColor);
  material.userData.cadIsFrame = isFrameLayerName(layerName);
}

export function applyCadDisplayColors(group, { bgColor, lineColor } = {}) {
  if (!group) return;
  const bg = bgColor || '#1a1d23';
  const line = lineColor || '#e8eaed';

  group.traverse((child) => {
    const material = child.material;
    if (!material?.color) return;

    const layerName = child.userData?.layerName
      || child.parent?.userData?.layerName
      || child.parent?.name
      || '';
    const rawColor = material.userData?.cadRawColor ?? material.color.getHex();
    const isFrame = material.userData?.cadIsFrame ?? isFrameLayerName(layerName);
    const nextColor = ensureVisibleLineColor(rawColor, bg, line, { isFrame });
    material.color.setHex(nextColor);
  });
}

function isCadLineObject(obj) {
  return obj?.isLine || obj?.isLineSegments || obj?.isLineLoop;
}

function getLayerNameFromObject(obj) {
  return obj?.userData?.layerName
    || obj?.parent?.userData?.layerName
    || obj?.name
    || '';
}

export function getCadFrameBounds(root, THREE) {
  if (!root || !THREE) return null;
  const box = new THREE.Box3();
  let hasFrame = false;

  root.traverse((child) => {
    const layerName = getLayerNameFromObject(child);
    if (!isFrameLayerName(layerName)) return;
    if (child.isGroup && child.children.length) {
      const layerBox = new THREE.Box3().setFromObject(child);
      if (!layerBox.isEmpty()) {
        box.union(layerBox);
        hasFrame = true;
      }
      return;
    }
    if (!isCadLineObject(child) || !child.geometry) return;
    child.geometry.computeBoundingBox?.();
    if (!child.geometry.boundingBox) return;
    const geomBox = child.geometry.boundingBox.clone();
    geomBox.applyMatrix4(child.matrixWorld);
    box.union(geomBox);
    hasFrame = true;
  });

  return hasFrame && !box.isEmpty() ? box : null;
}

function collectCadTextSprites(root) {
  const texts = [];
  root.traverse((child) => {
    if (!child.isSprite || !child.material) return;
    texts.push({
      x: child.position.x,
      y: child.position.y,
      rotation: child.userData?.cadTextRotation ?? child.material.rotation ?? 0,
    });
  });
  return texts;
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function isTextUpright(angle) {
  const rot = normalizeAngle(angle);
  return rot <= Math.PI * 0.28 || rot >= Math.PI * 1.72;
}

function transformCadPoint(point, center, { flipY = false, rot180 = false } = {}) {
  let x = point.x - center.x;
  let y = point.y - center.y;
  if (rot180) {
    x = -x;
    y = -y;
  }
  if (flipY) y = -y;
  return { x: x + center.x, y: y + center.y };
}

function transformCadTextRotation(angle, { flipY = false, rot180 = false } = {}) {
  let rot = angle;
  if (rot180) rot += Math.PI;
  if (flipY) rot = -rot;
  return normalizeAngle(rot);
}

function scoreCadOrientation(texts, frameBox, center, orientation) {
  if (!texts.length) return 0;
  let score = 0;
  const frame = frameBox
    ? {
      minX: frameBox.min.x,
      minY: frameBox.min.y,
      maxX: frameBox.max.x,
      maxY: frameBox.max.y,
    }
    : null;

  for (const text of texts) {
    const rot = transformCadTextRotation(text.rotation, orientation);
    if (isTextUpright(rot)) score += 2;
    else if (Math.abs(rot - Math.PI) < Math.PI * 0.28) score -= 2;

    if (!frame) continue;
    const pos = transformCadPoint(text, center, orientation);
    const width = Math.max(frame.maxX - frame.minX, 1e-6);
    const height = Math.max(frame.maxY - frame.minY, 1e-6);
    const relX = (pos.x - frame.minX) / width;
    const relY = (pos.y - frame.minY) / height;
    const inTitleBlock = relX > 0.55 && relY < 0.4;
    if (inTitleBlock && isTextUpright(rot)) score += 4;
    else if (inTitleBlock && !isTextUpright(rot)) score -= 3;
  }
  return score;
}

function applyCadOrientation(group, THREE, pivot, orientation) {
  if (!orientation.flipY && !orientation.rot180) return;

  const wrapper = new THREE.Group();
  wrapper.name = '__cad_orientation__';
  wrapper.position.copy(pivot);
  if (orientation.flipY) wrapper.scale.y = -1;
  if (orientation.rot180) wrapper.rotation.z = Math.PI;

  const children = [...group.children];
  for (const child of children) {
    group.remove(child);
    child.position.sub(pivot);
    wrapper.add(child);
  }
  group.add(wrapper);

  if (orientation.flipY) {
    wrapper.traverse((child) => {
      if (!child.isSprite || !child.material) return;
      child.material.rotation = -child.material.rotation;
      if (Number.isFinite(child.userData.cadTextRotation)) {
        child.userData.cadTextRotation = -child.userData.cadTextRotation;
      }
    });
  }
}

function storeCadFrameBox(group, frameBox) {
  if (!frameBox || frameBox.isEmpty()) {
    group.userData.cadFrameBox = null;
    return;
  }
  group.userData.cadFrameBox = {
    min: { x: frameBox.min.x, y: frameBox.min.y, z: frameBox.min.z },
    max: { x: frameBox.max.x, y: frameBox.max.y, z: frameBox.max.z },
  };
}

export function normalizeCadFrontView(cadGroup, THREE) {
  if (!cadGroup || !THREE) return null;

  const frameBox = getCadFrameBounds(cadGroup, THREE);
  const fullBox = new THREE.Box3().setFromObject(cadGroup);
  const fitBox = frameBox && !frameBox.isEmpty() ? frameBox : fullBox;
  const center = fitBox.getCenter(new THREE.Vector3());
  const texts = collectCadTextSprites(cadGroup);

  const orientations = [
    { flipY: false, rot180: false },
    { flipY: true, rot180: false },
    { flipY: false, rot180: true },
    { flipY: true, rot180: true },
  ];

  let best = orientations[0];
  let bestScore = -Infinity;
  for (const orientation of orientations) {
    const score = scoreCadOrientation(texts, frameBox, center, orientation);
    if (score > bestScore) {
      bestScore = score;
      best = orientation;
    }
  }

  if (best.flipY || best.rot180) {
    applyCadOrientation(cadGroup, THREE, center, best);
  }

  cadGroup.userData.cadOrientation = best;
  const orientedFrameBox = getCadFrameBounds(cadGroup, THREE)
    || new THREE.Box3().setFromObject(cadGroup);
  storeCadFrameBox(cadGroup, orientedFrameBox);
  return orientedFrameBox;
}

function findCadContentRoot(cadGroup) {
  const orient = cadGroup.children.find((child) => child.name === '__cad_orientation__');
  return orient || cadGroup;
}

function expandSpriteBounds(box, sprite, THREE) {
  const cx = sprite.center?.x ?? 0.5;
  const cy = sprite.center?.y ?? 0.5;
  const w = sprite.scale.x;
  const h = sprite.scale.y;
  box.set(
    new THREE.Vector3(sprite.position.x - w * cx, sprite.position.y - h * cy, sprite.position.z),
    new THREE.Vector3(sprite.position.x + w * (1 - cx), sprite.position.y + h * (1 - cy), sprite.position.z),
  );
}

function getRenderableBounds(obj, THREE) {
  const box = new THREE.Box3();
  if (obj.isSprite) {
    expandSpriteBounds(box, obj, THREE);
    return box;
  }
  if (!obj.geometry) return null;
  obj.geometry.computeBoundingBox?.();
  if (!obj.geometry.boundingBox) return null;
  box.copy(obj.geometry.boundingBox);
  box.applyMatrix4(obj.matrixWorld);
  return box;
}

function collectRenderableItems(root, THREE) {
  const items = [];
  root.traverse((child) => {
    if (!child.isLine && !child.isLineSegments && !child.isLineLoop && !child.isSprite) return;
    const box = getRenderableBounds(child, THREE);
    if (!box || box.isEmpty()) return;
    items.push({ object: child, box });
  });
  return items;
}

function boxSeparation(a, b) {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  return Math.hypot(dx, dy);
}

function clusterRenderableItems(items, minGap) {
  const parents = items.map((_, index) => index);
  const find = (index) => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (boxSeparation(items[i].box, items[j].box) <= minGap) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }
  return [...groups.values()];
}

function markDwgEntityGroups(groups) {
  groups.forEach((group, index) => {
    group.userData.isDwgEntityGroup = true;
    group.userData.dwgViewIndex = index + 1;
    if (!group.userData.layerName || group.userData.layerName === '0') {
      group.userData.layerName = `View ${index + 1}`;
    }
  });
}

function splitDwgEntityGroups(cadGroup, THREE) {
  const contentRoot = findCadContentRoot(cadGroup);
  const layerGroups = contentRoot.children.filter(
    (child) => child.isGroup && child.userData?.layerName && child.children.length > 0,
  );

  if (layerGroups.length > 1) {
    markDwgEntityGroups(layerGroups);
    cadGroup.userData.dwgEntityCount = layerGroups.length;
    return layerGroups.length;
  }

  const items = collectRenderableItems(contentRoot, THREE);
  if (items.length < 2) return 0;

  const globalBox = new THREE.Box3();
  for (const item of items) globalBox.union(item.box);
  const size = globalBox.getSize(new THREE.Vector3());
  const minGap = Math.max(size.x, size.y, 1) * 0.06;
  const clusters = clusterRenderableItems(items, minGap);
  if (clusters.length <= 1) {
    if (layerGroups[0]) markDwgEntityGroups(layerGroups);
    return layerGroups.length;
  }

  const clusterGroups = clusters.map((cluster, index) => {
    const group = new THREE.Group();
    group.name = `dwg-view-${index + 1}`;
    group.userData.layerName = `View ${index + 1}`;
    group.userData.isDwgEntityGroup = true;
    group.userData.dwgViewIndex = index + 1;
    for (const item of cluster) {
      item.object.parent?.remove(item.object);
      group.add(item.object);
    }
    return group;
  });

  for (const layerGroup of layerGroups) {
    if (layerGroup.children.length === 0) contentRoot.remove(layerGroup);
  }
  for (const group of clusterGroups) contentRoot.add(group);

  cadGroup.userData.dwgEntityCount = clusterGroups.length;
  return clusterGroups.length;
}

function getSpriteAnchor(entity) {
  if (entity.attachmentPoint != null) {
    const ap = Number(entity.attachmentPoint);
    const col = (ap - 1) % 3;
    const row = Math.floor((ap - 1) / 3);
    return {
      x: col === 0 ? 0 : col === 1 ? 0.5 : 1,
      y: row === 0 ? 1 : row === 1 ? 0.5 : 0,
    };
  }
  const h = entity.halign ?? 0;
  const v = entity.valign ?? 0;
  return {
    x: h === 1 ? 0.5 : h === 2 ? 1 : 0,
    y: v === 3 ? 1 : v === 2 ? 0.5 : 0,
  };
}

function hexColorFromCss(value, fallback = 0xe8eaed) {
  if (!value || value === 'none') return fallback;
  const named = String(value).trim();
  if (named.startsWith('#')) {
    const hex = named.length === 4
      ? `#${named[1]}${named[1]}${named[2]}${named[2]}${named[3]}${named[3]}`
      : named;
    return Number.parseInt(hex.slice(1), 16);
  }
  const rgb = named.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  }
  return fallback;
}

function createTextSprite(THREE, text, height, color, anchor = { x: 0, y: 0 }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const lineHeight = Math.max(height, 0.05);
  const fontPx = Math.max(12, Math.min(96, Math.round(lineHeight * 4)));
  const lineGap = Math.max(1, Math.round(fontPx * 0.12));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `700 ${fontPx}px ${CAD_FONT_FAMILY}`;
  ctx.font = font;

  let maxW = 0;
  let totalH = 0;
  const metrics = lines.map((line) => {
    const m = ctx.measureText(line);
    maxW = Math.max(maxW, m.width);
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || fontPx;
    totalH += h;
    return { line, w: m.width, h };
  });
  totalH += lineGap * Math.max(0, lines.length - 1);

  const pad = Math.max(2, Math.round(fontPx * 0.08));
  canvas.width = Math.max(1, Math.ceil(maxW + pad * 2));
  canvas.height = Math.max(1, Math.ceil(totalH + pad * 2));

  ctx.font = font;
  ctx.fillStyle = `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  let y = pad;
  for (const item of metrics) {
    y += item.h;
    ctx.fillText(item.line, pad, y);
    y += lineGap;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(material);
  const unitScale = lineHeight / fontPx;
  sprite.scale.set(canvas.width * unitScale, canvas.height * unitScale, 1);
  sprite.center.set(anchor.x, anchor.y);
  return sprite;
}

function repairDxfText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ENTITY_TYPES.has(line) && i > 0 && lines[i - 1] !== '0') {
      out.push('0');
    }
    out.push(line);
  }
  return out.join('\n');
}

function parseLayerColors(dxf) {
  const map = new Map();
  const layers = dxf?.tables?.layer?.layers;
  if (!layers) return map;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer?.name != null && layer.color != null) map.set(layer.name, layer.color);
    }
  } else {
    for (const [name, layer] of Object.entries(layers)) {
      const color = layer?.color ?? layer?.colorIndex;
      if (color != null) map.set(name, color);
    }
  }
  return map;
}

function hasValidCoord(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function getLineEndpoints(entity) {
  if (hasValidCoord(entity.start) && hasValidCoord(entity.end)) {
    return {
      start: { x: entity.start.x, y: entity.start.y, z: entity.start.z ?? 0 },
      end: { x: entity.end.x, y: entity.end.y, z: entity.end.z ?? 0 },
    };
  }
  const verts = entity.vertices;
  if (Array.isArray(verts) && verts.length >= 2 && hasValidCoord(verts[0]) && hasValidCoord(verts[1])) {
    return {
      start: { x: verts[0].x, y: verts[0].y, z: verts[0].z ?? 0 },
      end: { x: verts[1].x, y: verts[1].y, z: verts[1].z ?? 0 },
    };
  }
  return null;
}

function normalizeDxfEntities(dxf) {
  if (!dxf?.entities?.length) return dxf;
  for (const entity of dxf.entities) {
    if (entity.type !== 'LINE') continue;
    const endpoints = getLineEndpoints(entity);
    if (!endpoints) continue;
    entity.start = endpoints.start;
    entity.end = endpoints.end;
  }
  return dxf;
}

function isBrokenLineParse(dxf) {
  if (!dxf?.entities?.length) return true;
  let lineCount = 0;
  let broken = 0;
  for (const entity of dxf.entities) {
    if (entity.type !== 'LINE') continue;
    lineCount++;
    if (!getLineEndpoints(entity)) broken++;
    if (lineCount >= 32) break;
  }
  return lineCount > 0 && broken > 0;
}

function parseDxfWithFallback(DxfParser, text) {
  const attempts = [text, repairDxfText(text)];
  let lastErr;
  let parsed = null;
  for (const candidate of attempts) {
    try {
      const result = new DxfParser().parseSync(candidate);
      if (result?.entities?.length) {
        parsed = result;
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (parsed && !isBrokenLineParse(parsed)) {
    return normalizeDxfEntities(parsed);
  }
  const simple = parseSimpleDxf(text);
  if (simple?.entities?.length) return simple;
  if (parsed?.entities?.length) return normalizeDxfEntities(parsed);
  throw new Error(t('dxfParseFailed', { msg: lastErr?.message || t('invalidFormat') }));
}

function parseSimpleLayerTable(lines) {
  const layerMap = { 0: { name: '0', color: 7 } };
  let inLayerTable = false;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === '0' && lines[i + 1] === 'TABLE' && lines[i + 3] === 'LAYER') {
      inLayerTable = true;
      i += 3;
      continue;
    }
    if (inLayerTable && lines[i].trim() === '0' && lines[i + 1] === 'ENDTAB') {
      break;
    }
    if (inLayerTable && lines[i].trim() === '0' && lines[i + 1] === 'LAYER') {
      let name = '0';
      let color = 7;
      i += 2;
      while (i < lines.length - 1) {
        const c = lines[i].trim();
        const v = lines[i + 1];
        if (c === '0') { i -= 2; break; }
        if (c === '2') name = v;
        else if (c === '62') color = parseInt(v, 10);
        i += 2;
      }
      layerMap[name] = { name, color };
    }
  }
  return layerMap;
}

function parseSimpleEntity(lines, startIndex, type) {
  const entity = { type, layer: '0' };
  const isTextLike = type === 'TEXT' || type === 'MTEXT' || type === 'ATTRIB' || type === 'DIMENSION';
  let i = startIndex + 2;
  while (i < lines.length - 1) {
    const c = lines[i].trim();
    const v = lines[i + 1];
    if (c === '0') break;
    if (c === '8') entity.layer = v;
    else if (c === '10') {
      if (isTextLike) entity.startPoint = { ...(entity.startPoint || {}), x: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), x: parseFloat(v) };
    } else if (c === '20') {
      if (isTextLike) entity.startPoint = { ...(entity.startPoint || {}), y: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), y: parseFloat(v) };
    } else if (c === '30') {
      if (isTextLike) entity.startPoint = { ...(entity.startPoint || {}), z: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), z: parseFloat(v) };
    } else if (c === '11') {
      if (type === 'DIMENSION') entity.middleOfText = { ...(entity.middleOfText || {}), x: parseFloat(v) };
      else entity.end = { ...(entity.end || {}), x: parseFloat(v) };
    } else if (c === '21') {
      if (type === 'DIMENSION') entity.middleOfText = { ...(entity.middleOfText || {}), y: parseFloat(v) };
      else entity.end = { ...(entity.end || {}), y: parseFloat(v) };
    } else if (c === '31') {
      if (type === 'DIMENSION') entity.middleOfText = { ...(entity.middleOfText || {}), z: parseFloat(v) };
      else entity.end = { ...(entity.end || {}), z: parseFloat(v) };
    } else if (c === '40') {
      if (type === 'MTEXT') entity.height = parseFloat(v);
      else entity.textHeight = parseFloat(v);
    } else if (c === '1' || c === '3') entity.text = (entity.text || '') + v;
    else if (c === '42') entity.actualMeasurement = parseFloat(v);
    else if (c === '50') entity.rotation = parseFloat(v);
    else if (c === '62') entity.colorNumber = parseInt(v, 10);
    i += 2;
  }
  return { entity, nextIndex: i };
}

function parseSimpleDxf(text) {
  const repaired = repairDxfText(text);
  const lines = repaired.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const layerMap = parseSimpleLayerTable(lines);
  const entities = [];
  let i = 0;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const value = lines[i + 1];
    if (code === '0' && (value === 'LINE' || value === 'TEXT' || value === 'MTEXT' || value === 'DIMENSION' || value === 'ATTRIB')) {
      const { entity, nextIndex } = parseSimpleEntity(lines, i, value);
      i = nextIndex;
      if (value === 'LINE') {
        if (entity.start?.x != null && entity.start?.y != null && entity.end?.x != null && entity.end?.y != null) {
          entities.push(entity);
        }
      } else if (value === 'DIMENSION') {
        const pos = entity.middleOfText || entity.startPoint;
        if (pos?.x != null && pos?.y != null && (entity.text || entity.actualMeasurement != null)) {
          entities.push(entity);
        }
      } else if (entity.text && entity.startPoint?.x != null && entity.startPoint?.y != null) {
        entities.push(entity);
      }
      continue;
    }
    i += 2;
  }
  if (!entities.length) return null;
  return { entities, tables: { layer: { layers: layerMap } } };
}

export async function loadDxf(buffer, THREE, options = {}) {
  await ensureCadFonts();
  const DxfParser = await getDxfParser();
  const text = decodeDxfText(buffer);
  const dxf = parseDxfWithFallback(DxfParser, text);
  if (!dxf?.entities?.length) {
    throw new Error(t('dxfNoEntities'));
  }
  const group = new THREE.Group();
  group.userData.is2d = true;
  const builder = new DxfSceneBuilder(THREE, dxf, {
    bgColor: options.bgColor,
    lineColor: options.lineColor,
  });
  if (options.progressive) {
    await builder.buildAsync(group, {
      batchSize: options.dxfBatchSize,
      onProgress: options.onProgress,
      yieldFn: options.yieldFn,
      signal: options.signal,
    });
  } else {
    builder.build(group);
  }
  if (group.children.length === 0) {
    throw new Error(t('dxfNoShapes'));
  }
  normalizeCadFrontView(group, THREE);
  return group;
}

export async function loadDwg(buffer, THREE, { signal, onProgress, bgColor, lineColor } = {}) {
  const report = (current, total) => onProgress?.(current, total);

  throwIfCancelled(signal);
  await ensureCadFonts();
  report(0, 5);
  await yieldToMain(signal);

  const engine = await initCad2dEngine();
  throwIfCancelled(signal);
  report(1, 5);

  const dwgPtr = engine.dwg_read_data(buffer, 0);
  if (!dwgPtr) {
    throw new Error(t('dwgReadFailed'));
  }
  throwIfCancelled(signal);
  report(2, 5);

  let database;
  try {
    database = engine.convert(dwgPtr);
  } finally {
    engine.dwg_free(dwgPtr);
  }
  throwIfCancelled(signal);
  report(3, 5);
  await yieldToMain(signal);

  const svg = engine.dwg_to_svg(database);
  if (!svg || svg.length < 50) {
    throw new Error(t('dwgExtractFailed'));
  }
  throwIfCancelled(signal);
  report(4, 5);

  const group = svgToGroup(svg, THREE, { bgColor, lineColor, partitionGroups: true });
  group.userData.is2d = true;
  if (group.children.length === 0) {
    throw new Error(t('dwgNoShapes'));
  }
  group.userData.cadSource = 'dwg';
  normalizeCadFrontView(group, THREE);
  splitDwgEntityGroups(group, THREE);
  report(5, 5);
  return group;
}

export async function loadAi(buffer, THREE, { signal, onProgress, bgColor, lineColor } = {}) {
  const report = (current, total) => onProgress?.(current, total);

  throwIfCancelled(signal);
  await ensureCadFonts();
  report(0, 3);
  await yieldToMain(signal);

  let svg;
  try {
    svg = await aiToSvg(buffer, {
      signal,
      onProgress: (page, total) => report(1 + Math.floor((page / total) * 1), 3),
    });
  } catch (e) {
    if (e?.message === t('aiParseFailed')) throw e;
    throw new Error(t('aiParseFailed'));
  }
  throwIfCancelled(signal);
  report(2, 3);

  const group = svgToGroup(svg, THREE, { bgColor, lineColor, partitionGroups: true });
  group.userData.is2d = true;
  if (group.children.length === 0) {
    throw new Error(t('aiNoShapes'));
  }
  group.userData.cadSource = 'ai';
  normalizeCadFrontView(group, THREE);
  report(3, 3);
  return group;
}

function collectSvgTextContent(node) {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent || '';
    else if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() !== 'title') {
      text += collectSvgTextContent(child);
    }
  }
  return text;
}

function parseSvgTransform(node) {
  const raw = node.getAttribute?.('transform') || '';
  const translate = raw.match(/translate\(([^)]+)\)/i);
  if (!translate) return { x: 0, y: 0 };
  const parts = translate[1].split(/[ ,]+/).map(Number);
  return { x: parts[0] || 0, y: parts[1] || 0 };
}

function sanitizeSvgGroupName(value) {
  return String(value || '')
    .trim()
    .replace(/^#/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 48) || null;
}

function resolveSvgBlockGroup(el, doc) {
  let node = el.parentElement;
  while (node && node !== doc.documentElement) {
    if (node.tagName?.toLowerCase() !== 'g') {
      node = node.parentElement;
      continue;
    }
    const candidates = [
      node.getAttribute('lc:blockname'),
      node.getAttribute('data-name'),
      node.getAttribute('inkscape:label'),
      node.getAttribute('id'),
    ];
    for (const raw of candidates) {
      const name = sanitizeSvgGroupName(raw);
      if (!name) continue;
      if (/^(svg|defs|viewport|page|root)$/i.test(name)) continue;
      if (/^layer[-_:]/i.test(name)) continue;
      return name;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveSvgLayerName(el, doc) {
  let node = el;
  while (node && node !== doc.documentElement) {
    const candidates = [
      node.getAttribute('lc:layername'),
      node.getAttribute('data-layer'),
      node.getAttribute('layer'),
      node.getAttribute('inkscape:label'),
    ];
    for (const name of candidates) {
      if (name) return String(name).trim();
    }
    const id = node.getAttribute('id');
    if (id && /^layer[-_:]/i.test(id)) return id.replace(/^layer[-_:]/i, '');
    node = node.parentElement;
  }
  return '0';
}

function resolveSvgPartitionName(el, doc, partitionGroups = false) {
  const layerName = resolveSvgLayerName(el, doc);
  if (!partitionGroups) return layerName;
  const blockName = resolveSvgBlockGroup(el, doc);
  if (!blockName || blockName === layerName) return layerName;
  return `${layerName} · ${blockName}`;
}

function ensureSvgLayerGroup(layerMap, THREE, layerName) {
  if (!layerMap.has(layerName)) {
    const layerGroup = new THREE.Group();
    layerGroup.name = layerName;
    layerGroup.userData.layerName = layerName;
    layerGroup.userData.isSketchLayer = isSketchLayerName(layerName);
    layerGroup.userData.isFrameLayer = isFrameLayerName(layerName);
    layerMap.set(layerName, layerGroup);
  }
  return layerMap.get(layerName);
}

function addSvgPathsToGroup(paths, THREE, targetGroup, displayOptions = {}) {
  const layerName = targetGroup.userData?.layerName || targetGroup.name || '0';
  const bgColor = displayOptions.bgColor || '#1a1d23';
  const lineColor = displayOptions.lineColor || '#e8eaed';

  for (const path of paths) {
    const rawColor = path.color || 0xffffff;
    const color = ensureVisibleLineColor(rawColor, bgColor, lineColor, {
      isFrame: isFrameLayerName(layerName),
    });
    const material = new THREE.LineBasicMaterial({ color });
    tagCadMaterial(material, rawColor, layerName);

    for (const subPath of path.subPaths) {
      const pts2d = subPath.getPoints(32);
      if (pts2d.length < 2) continue;
      const positions = [];
      for (const p of pts2d) positions.push(p.x, -p.y, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      targetGroup.add(new THREE.Line(geometry, material));
    }

    for (const shape of SVGLoader.createShapes(path)) {
      const pts = shape.getPoints(24);
      if (pts.length < 2) continue;
      const positions = [];
      for (const p of pts) positions.push(p.x, -p.y, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      targetGroup.add(new THREE.LineLoop(geometry, material));
    }
  }
}

function addSvgTextElement(el, doc, THREE, layerGroup, displayOptions = {}) {
  const content = extractEntityText({ text: collectSvgTextContent(el) });
  if (!content) return;

  const parentT = parseSvgTransform(el.parentElement);
  const selfT = parseSvgTransform(el);
  const x = parseFloat(el.getAttribute('x') || '0') + parentT.x + selfT.x;
  const y = parseFloat(el.getAttribute('y') || '0') + parentT.y + selfT.y;
  const fontSize = parseFloat(el.getAttribute('font-size') || '12');
  const layerName = layerGroup.userData?.layerName || layerGroup.name || '0';
  const rawColor = hexColorFromCss(el.getAttribute('fill') || el.style?.fill, 0xe8eaed);
  const color = ensureVisibleLineColor(rawColor, displayOptions.bgColor, displayOptions.lineColor, {
    isFrame: isFrameLayerName(layerName),
  });
  const sprite = createTextSprite(THREE, content, Math.max(fontSize, 0.05), color, { x: 0, y: 0 });
  if (!sprite) return;
  sprite.position.set(x, -y, 0.5);
  const rotate = (el.getAttribute('transform') || '').match(/rotate\((-?\d+(?:\.\d+)?)/i);
  if (rotate) {
    const radians = -Number(rotate[1]) * (Math.PI / 180);
    sprite.material.rotation = radians;
    sprite.userData.cadTextRotation = radians;
  }
  layerGroup.add(sprite);
}

function addSvgImageElement(el, doc, THREE, layerGroup) {
  const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (!href) return;
  const x = parseFloat(el.getAttribute('x') || '0');
  const y = parseFloat(el.getAttribute('y') || '0');
  const w = parseFloat(el.getAttribute('width') || '0');
  const h = parseFloat(el.getAttribute('height') || '0');
  if (w <= 0 || h <= 0) return;

  const layerName = layerGroup.userData?.layerName || layerGroup.name || '0';
  const texture = new THREE.TextureLoader().load(href);
  if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x + w / 2, -(y + h / 2), 0);
  mesh.userData.layerName = layerName;
  layerGroup.add(mesh);
}

function svgToGroup(svgString, THREE, displayOptions = {}) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const loader = new SVGLoader();
  const layerMap = new Map();
  const shapeSelector = 'path,line,polyline,polygon,circle,ellipse';
  const shapeEls = [...doc.querySelectorAll(shapeSelector)];
  const partitionGroups = !!displayOptions.partitionGroups;

  for (const el of shapeEls) {
    ensureSvgLayerGroup(layerMap, THREE, resolveSvgPartitionName(el, doc, partitionGroups));
  }

  const byLayer = new Map();
  for (const el of shapeEls) {
    const layerName = resolveSvgPartitionName(el, doc, partitionGroups);
    if (!byLayer.has(layerName)) byLayer.set(layerName, []);
    byLayer.get(layerName).push(el);
  }

  const serializer = new XMLSerializer();
  for (const [layerName, elements] of byLayer) {
    const layerGroup = ensureSvgLayerGroup(layerMap, THREE, layerName);
    const fragment = `<svg xmlns="http://www.w3.org/2000/svg">${elements.map((el) => serializer.serializeToString(el)).join('')}</svg>`;
    try {
      const { paths } = loader.parse(fragment);
      addSvgPathsToGroup(paths, THREE, layerGroup, displayOptions);
    } catch {
      // skip broken layer fragment
    }
  }

  for (const el of doc.querySelectorAll('text')) {
    const layerName = resolveSvgPartitionName(el, doc, partitionGroups);
    const layerGroup = ensureSvgLayerGroup(layerMap, THREE, layerName);
    addSvgTextElement(el, doc, THREE, layerGroup, displayOptions);
  }

  for (const el of doc.querySelectorAll('image')) {
    const layerName = resolveSvgPartitionName(el, doc, partitionGroups);
    const layerGroup = ensureSvgLayerGroup(layerMap, THREE, layerName);
    addSvgImageElement(el, doc, THREE, layerGroup);
  }

  const group = new THREE.Group();
  const sortedLayers = [...layerMap.entries()].sort((a, b) => {
    const aSketch = a[1].userData.isSketchLayer ? 0 : 1;
    const bSketch = b[1].userData.isSketchLayer ? 0 : 1;
    if (aSketch !== bSketch) return aSketch - bSketch;
    return a[0].localeCompare(b[0]);
  });
  for (const [, layerGroup] of sortedLayers) {
    if (layerGroup.children.length) group.add(layerGroup);
  }

  if (!group.children.length) {
    const { paths } = loader.parse(svgString);
    const fallback = new THREE.Group();
    fallback.name = '0';
    fallback.userData.layerName = '0';
    addSvgPathsToGroup(paths, THREE, fallback, displayOptions);
    if (fallback.children.length) group.add(fallback);
  }

  return group;
}

class DxfSceneBuilder {
  constructor(THREE, dxf, options = {}) {
    this.THREE = THREE;
    this.dxf = dxf;
    this.bgColor = options.bgColor || '#1a1d23';
    this.lineColor = options.lineColor || '#e8eaed';
    this.defaultColor = normalizeHexColor(this.lineColor, 0xe8eaed);
    this.layerColors = parseLayerColors(dxf);
    this.layerData = new Map();
    this.currentLayer = '0';
  }

  getLayerBatches(layerName) {
    const key = layerName || '0';
    if (!this.layerData.has(key)) {
      this.layerData.set(key, { lineBatches: new Map(), loopBatches: new Map(), textMarkers: [] });
    }
    return this.layerData.get(key);
  }

  build(group) {
    for (const entity of this.dxf.entities) {
      this.addEntity(group, entity);
    }
    this.flushBatches(group);
  }

  async buildAsync(group, options = {}) {
    const {
      batchSize = 2000,
      onProgress,
      yieldFn = () => new Promise((r) => requestAnimationFrame(r)),
    } = options;
    const entities = this.dxf.entities || [];
    const total = entities.length;
    const partialGroup = new this.THREE.Group();

    for (let i = 0; i < total; i++) {
      if (options.signal?.aborted) {
        const err = new Error('Load cancelled');
        err.name = 'LoadCancelledError';
        throw err;
      }
      this.addEntity(partialGroup, entities[i]);
      if ((i + 1) % batchSize === 0 || i === total - 1) {
        this.flushBatches(partialGroup);
        while (partialGroup.children.length) {
          group.add(partialGroup.children[0]);
        }
        onProgress?.(i + 1, total);
        if (i < total - 1) await yieldFn();
      }
    }
  }

  flushBatches(group) {
    for (const [layerName, batches] of this.layerData) {
      const layerGroup = new this.THREE.Group();
      layerGroup.name = layerName;
      layerGroup.userData.layerName = layerName;
      layerGroup.userData.isSketchLayer = isSketchLayerName(layerName);
      layerGroup.userData.isFrameLayer = isFrameLayerName(layerName);

      for (const [color, batch] of batches.lineBatches) {
        if (!batch.segments.length) continue;
        const positions = [];
        for (const [a, b] of batch.segments) {
          positions.push(a.x, a.y, a.z ?? 0, b.x, b.y, b.z ?? 0);
        }
        const geometry = new this.THREE.BufferGeometry();
        geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
        const material = new this.THREE.LineBasicMaterial({ color });
        tagCadMaterial(material, batch.rawColor, layerName);
        layerGroup.add(new this.THREE.LineSegments(geometry, material));
      }
      for (const [color, batch] of batches.loopBatches) {
        for (const points of batch.loops) {
          if (points.length < 2) continue;
          const positions = [];
          for (const p of points) positions.push(p.x, p.y, p.z ?? 0);
          const geometry = new this.THREE.BufferGeometry();
          geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
          const material = new this.THREE.LineBasicMaterial({ color });
          tagCadMaterial(material, batch.rawColor, layerName);
          layerGroup.add(new this.THREE.LineLoop(geometry, material));
        }
      }
      for (const sprite of batches.textMarkers) {
        layerGroup.add(sprite);
      }
      if (layerGroup.children.length) group.add(layerGroup);
    }
    this.layerData.clear();
  }

  aciToHex(index) {
    if (index == null || index < 0) return this.defaultColor;
    if (index >= 1 && index < ACI_COLORS.length) return ACI_COLORS[index];
    return this.defaultColor;
  }

  getLayerColor(layerName) {
    if (!layerName) return this.defaultColor;
    const layerColor = this.layerColors.get(layerName);
    return this.aciToHex(layerColor);
  }

  getRawColor(entity) {
    const cn = entity.colorNumber;
    if (cn === 0 || cn === 256) return this.getLayerColor(entity.layer);
    if (cn != null && cn > 0 && cn < ACI_COLORS.length) return ACI_COLORS[cn];
    if (entity.color != null) return entity.color;
    return this.getLayerColor(entity.layer);
  }

  getColor(entity) {
    const layer = entity.layer || '0';
    const raw = this.getRawColor(entity);
    return ensureVisibleLineColor(raw, this.bgColor, this.lineColor, {
      isFrame: isFrameLayerName(layer),
    });
  }

  addTextMarker(_group, entity, color, layer) {
    const text = extractEntityText(entity);
    if (!text) return;
    const pos = getTextPosition(entity);
    if (!pos || pos.x == null || pos.y == null) return;
    const height = getTextHeight(entity);
    const rawDegrees = entity.rotation ?? entity.angle ?? 0;
    const rotation = rawDegrees * (Math.PI / 180);
    const layerName = layer || entity.layer || '0';
    const sprite = createTextSprite(this.THREE, text, height, color, getSpriteAnchor(entity));
    if (!sprite) return;
    sprite.position.set(pos.x, pos.y, 0.5);
    sprite.material.rotation = rotation;
    sprite.userData.layerName = layerName;
    sprite.userData.cadTextRotation = rotation;
    sprite.userData.cadTextDegrees = rawDegrees;
    this.getLayerBatches(layerName).textMarkers.push(sprite);
  }

  queueLine(points, color, layer, closed = false, rawColor = color) {
    const valid = points.filter(hasValidCoord);
    if (valid.length < 2) return;
    const { lineBatches, loopBatches } = this.getLayerBatches(layer);
    if (closed) {
      if (!loopBatches.has(color)) loopBatches.set(color, { rawColor, loops: [] });
      loopBatches.get(color).loops.push(valid);
      return;
    }
    if (!lineBatches.has(color)) lineBatches.set(color, { rawColor, segments: [] });
    const batch = lineBatches.get(color);
    for (let i = 0; i < valid.length - 1; i++) {
      batch.segments.push([valid[i], valid[i + 1]]);
    }
  }

  addLine(group, points, color, layer, closed = false, rawColor = color) {
    this.queueLine(points, color, layer, closed, rawColor);
  }

  addEntity(group, entity, depth = 0) {
    if (depth > 20 || !entity?.type) return;
    const layer = entity.layer || '0';
    const rawColor = this.getRawColor(entity);
    const color = ensureVisibleLineColor(rawColor, this.bgColor, this.lineColor, {
      isFrame: isFrameLayerName(layer),
    });

    switch (entity.type) {
      case 'LINE': {
        const endpoints = getLineEndpoints(entity);
        if (!endpoints) break;
        this.addLine(group, [endpoints.start, endpoints.end], color, layer, false, rawColor);
        break;
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = (entity.vertices || []).filter(hasValidCoord);
        if (verts.length < 2) break;
        const points = [];
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i];
          const next = verts[(i + 1) % verts.length];
          const bulge = v.bulge ?? 0;
          points.push({ x: v.x, y: v.y, z: v.z ?? 0 });
          if (bulge && i < verts.length - 1 && hasValidCoord(next)) {
            const arcPts = bulgeArcPoints(v, next, bulge, 16);
            for (let j = 1; j < arcPts.length - 1; j++) points.push(arcPts[j]);
          }
        }
        const closed = entity.closed || (entity.flag & 1) === 1;
        this.addLine(group, points, color, layer, closed, rawColor);
        break;
      }

      case 'CIRCLE': {
        if (!hasValidCoord(entity.center) || !Number.isFinite(entity.radius)) break;
        this.addLine(group, circlePoints(entity.center, entity.radius, 64), color, layer, true, rawColor);
        break;
      }

      case 'ARC': {
        if (!hasValidCoord(entity.center) || !Number.isFinite(entity.radius)) break;
        this.addLine(group, arcPoints(entity.center, entity.radius, entity.startAngle, entity.endAngle, 48), color, layer, false, rawColor);
        break;
      }

      case 'ELLIPSE': {
        const major = entity.majorAxisEndPoint || entity.majorAxis;
        if (!hasValidCoord(entity.center) || !major || !Number.isFinite(major.x) || !Number.isFinite(major.y)) break;
        const rx = Math.hypot(major.x, major.y);
        const ry = rx * (entity.axisRatio ?? entity.minorAxisRatio ?? 1);
        const rot = Math.atan2(major.y, major.x);
        this.addLine(group, ellipsePoints(entity.center, rx, ry, rot, 64), color, layer, true, rawColor);
        break;
      }

      case 'SPLINE': {
        const cps = (entity.controlPoints || entity.fitPoints || []).filter(hasValidCoord);
        if (cps.length >= 2) {
          this.addLine(group, cps.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })), color, layer, false, rawColor);
        }
        break;
      }

      case 'POINT':
        if (entity.position) {
          const s = 0.5;
          const p = entity.position;
          this.addLine(group, [{ x: p.x - s, y: p.y, z: p.z ?? 0 }, { x: p.x + s, y: p.y, z: p.z ?? 0 }], color, layer, false, rawColor);
          this.addLine(group, [{ x: p.x, y: p.y - s, z: p.z ?? 0 }, { x: p.x, y: p.y + s, z: p.z ?? 0 }], color, layer, false, rawColor);
        }
        break;

      case 'INSERT': {
        const block = this.dxf.blocks?.[entity.name];
        if (!block?.entities) break;
        const savedLayers = this.layerData;
        this.layerData = new Map();
        for (const child of block.entities) {
          this.addEntity(group, { ...child, layer }, depth + 1);
        }
        const blockLayers = this.layerData;
        this.layerData = savedLayers;
        const sub = new this.THREE.Group();
        sub.position.set(entity.position?.x ?? 0, entity.position?.y ?? 0, entity.position?.z ?? 0);
        sub.scale.set(entity.xScale ?? 1, entity.yScale ?? 1, 1);
        sub.rotation.z = (entity.rotation ?? 0) * (Math.PI / 180);
        this.layerData = blockLayers;
        this.flushBatches(sub);
        this.layerData = savedLayers;
        group.add(sub);
        break;
      }

      case 'TEXT':
      case 'MTEXT':
      case 'ATTRIB':
        this.addTextMarker(group, entity, color, layer);
        break;

      case 'DIMENSION': {
        const dimText = extractEntityText(entity);
        if (!dimText) break;
        this.addTextMarker(group, {
          ...entity,
          text: dimText,
          startPoint: entity.middleOfText || entity.anchorPoint || entity.insertionPoint,
          textHeight: getTextHeight(entity),
          rotation: entity.angle ?? 0,
        }, color, layer);
        break;
      }

      case '3DFACE':
      case 'SOLID': {
        const verts = [entity.first, entity.second, entity.third, entity.fourth].filter(hasValidCoord);
        if (verts.length >= 3) {
          this.addLine(group, verts.map((v) => ({ x: v.x, y: v.y, z: v.z ?? 0 })), color, layer, true, rawColor);
        }
        break;
      }
      default:
        break;
    }
  }
}

function circlePoints(center, radius, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius, z: center.z ?? 0 });
  }
  return pts;
}

function arcPoints(center, radius, startDeg, endDeg, segments) {
  let start = startDeg * (Math.PI / 180);
  let end = endDeg * (Math.PI / 180);
  if (end < start) end += Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius, z: center.z ?? 0 });
  }
  return pts;
}

function ellipsePoints(center, rx, ry, rotation, segments) {
  const pts = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const ly = Math.sin(a) * ry;
    pts.push({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos, z: center.z ?? 0 });
  }
  return pts;
}

function bulgeArcPoints(p1, p2, bulge, segments) {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (chord < 1e-9) return [p1, p2];
  const radius = (chord / 2) / Math.sin(theta / 2);
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const perpLen = Math.hypot(dx, dy);
  const nx = -dy / perpLen;
  const ny = dx / perpLen;
  const sagitta = Math.abs(radius) * (1 - Math.cos(theta / 2));
  const sign = bulge >= 0 ? 1 : -1;
  const cx = mid.x + nx * sagitta * sign;
  const cy = mid.y + ny * sagitta * sign;
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  let a2 = Math.atan2(p2.y - cy, p2.x - cx);
  if (bulge > 0 && a2 < a1) a2 += Math.PI * 2;
  if (bulge < 0 && a2 > a1) a2 -= Math.PI * 2;
  const pts = [{ x: p1.x, y: p1.y, z: p1.z ?? 0 }];
  for (let i = 1; i < segments; i++) {
    const a = a1 + (a2 - a1) * (i / segments);
    pts.push({ x: cx + Math.cos(a) * Math.abs(radius), y: cy + Math.sin(a) * Math.abs(radius), z: p1.z ?? 0 });
  }
  pts.push({ x: p2.x, y: p2.y, z: p2.z ?? 0 });
  return pts;
}