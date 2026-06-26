import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { t } from './i18n.js';
import { throwIfCancelled, yieldToMain } from './large-file-loader.js';

const LIBREDWG_WASM = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.7/wasm';
const DXF_PARSER_URL = 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/+esm';
const LIBREDWG_URL = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.7/dist/libredwg-web.js';

const ENTITY_TYPES = new Set([
  'LINE', 'TEXT', 'MTEXT', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE',
  'SPLINE', 'POINT', 'INSERT', '3DFACE', 'SOLID', 'HATCH', 'DIMENSION', 'VERTEX',
]);

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

function decodeDxfText(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!utf8.includes('\uFFFD') && (utf8.includes('SECTION') || utf8.includes('ENTITIES'))) {
    return utf8;
  }
  try {
    const latin1 = new TextDecoder('iso-8859-1').decode(buffer);
    if (latin1.includes('SECTION') || latin1.includes('ENTITIES')) return latin1;
  } catch { /* ignore */ }
  return utf8;
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
  let i = startIndex + 2;
  while (i < lines.length - 1) {
    const c = lines[i].trim();
    const v = lines[i + 1];
    if (c === '0') break;
    if (c === '8') entity.layer = v;
    else if (c === '10') {
      if (type === 'TEXT') entity.startPoint = { ...(entity.startPoint || {}), x: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), x: parseFloat(v) };
    } else if (c === '20') {
      if (type === 'TEXT') entity.startPoint = { ...(entity.startPoint || {}), y: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), y: parseFloat(v) };
    } else if (c === '30') {
      if (type === 'TEXT') entity.startPoint = { ...(entity.startPoint || {}), z: parseFloat(v) };
      else entity.start = { ...(entity.start || {}), z: parseFloat(v) };
    } else if (c === '11') entity.end = { ...(entity.end || {}), x: parseFloat(v) };
    else if (c === '21') entity.end = { ...(entity.end || {}), y: parseFloat(v) };
    else if (c === '31') entity.end = { ...(entity.end || {}), z: parseFloat(v) };
    else if (c === '40') entity.textHeight = parseFloat(v);
    else if (c === '1') entity.text = v;
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
    if (code === '0' && (value === 'LINE' || value === 'TEXT')) {
      const { entity, nextIndex } = parseSimpleEntity(lines, i, value);
      i = nextIndex;
      if (value === 'LINE') {
        if (entity.start?.x != null && entity.start?.y != null && entity.end?.x != null && entity.end?.y != null) {
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
  const DxfParser = await getDxfParser();
  const text = decodeDxfText(buffer);
  const dxf = parseDxfWithFallback(DxfParser, text);
  if (!dxf?.entities?.length) {
    throw new Error(t('dxfNoEntities'));
  }
  const group = new THREE.Group();
  group.userData.is2d = true;
  const builder = new DxfSceneBuilder(THREE, dxf);
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
  return group;
}

export async function loadDwg(buffer, THREE, { signal, onProgress } = {}) {
  const report = (current, total) => onProgress?.(current, total);

  throwIfCancelled(signal);
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

  const group = svgToGroup(svg, THREE);
  group.userData.is2d = true;
  if (group.children.length === 0) {
    throw new Error(t('dwgNoShapes'));
  }
  report(5, 5);
  return group;
}

function svgToGroup(svgString, THREE) {
  const loader = new SVGLoader();
  const { paths } = loader.parse(svgString);
  const group = new THREE.Group();

  for (const path of paths) {
    const color = path.color || 0xffffff;
    const material = new THREE.LineBasicMaterial({ color });

    for (const subPath of path.subPaths) {
      const pts2d = subPath.getPoints(32);
      if (pts2d.length < 2) continue;
      const positions = [];
      for (const p of pts2d) positions.push(p.x, -p.y, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      group.add(new THREE.Line(geometry, material));
    }

    for (const shape of SVGLoader.createShapes(path)) {
      const pts = shape.getPoints(24);
      if (pts.length < 2) continue;
      const positions = [];
      for (const p of pts) positions.push(p.x, -p.y, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      group.add(new THREE.LineLoop(geometry, material));
    }
  }
  return group;
}

class DxfSceneBuilder {
  constructor(THREE, dxf) {
    this.THREE = THREE;
    this.dxf = dxf;
    this.defaultColor = 0xe8eaed;
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

      for (const [color, segments] of batches.lineBatches) {
        if (!segments.length) continue;
        const positions = [];
        for (const [a, b] of segments) {
          positions.push(a.x, a.y, a.z ?? 0, b.x, b.y, b.z ?? 0);
        }
        const geometry = new this.THREE.BufferGeometry();
        geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
        const material = new this.THREE.LineBasicMaterial({ color });
        layerGroup.add(new this.THREE.LineSegments(geometry, material));
      }
      for (const [color, loops] of batches.loopBatches) {
        for (const points of loops) {
          if (points.length < 2) continue;
          const positions = [];
          for (const p of points) positions.push(p.x, p.y, p.z ?? 0);
          const geometry = new this.THREE.BufferGeometry();
          geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
          const material = new this.THREE.LineBasicMaterial({ color });
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

  getColor(entity) {
    const cn = entity.colorNumber;
    if (cn === 0 || cn === 256) return this.getLayerColor(entity.layer);
    if (cn != null && cn > 0 && cn < ACI_COLORS.length) return ACI_COLORS[cn];
    if (entity.color != null) return entity.color;
    return this.getLayerColor(entity.layer);
  }

  createTextSprite(text, height, color) {
    const label = String(text || '');
    const px = 64;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${px}px Arial, sans-serif`;
    const metrics = ctx.measureText(label);
    const pad = 8;
    canvas.width = Math.ceil(metrics.width) + pad * 2;
    canvas.height = px + pad * 2;
    ctx.font = `bold ${px}px Arial, sans-serif`;
    ctx.fillStyle = `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);

    const texture = new this.THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new this.THREE.Sprite(material);
    const scale = height / px;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    sprite.center.set(0.5, 0.5);
    return sprite;
  }

  addTextMarker(_group, entity, color, layer) {
    const text = entity.text ?? entity.string ?? '';
    if (!text) return;
    const pos = entity.startPoint || entity.position || entity;
    const x = pos.x ?? entity.x;
    const y = pos.y ?? entity.y;
    if (x == null || y == null) return;
    const height = Math.max(entity.textHeight ?? entity.height ?? 2.5, 1);
    const rotation = (entity.rotation ?? 0) * (Math.PI / 180);
    const layerName = layer || entity.layer || '0';
    const sprite = this.createTextSprite(text, height, color);
    sprite.position.set(x, y, 0.5);
    sprite.material.rotation = rotation;
    sprite.userData.layerName = layerName;
    this.getLayerBatches(layerName).textMarkers.push(sprite);
  }

  queueLine(points, color, layer, closed = false) {
    const valid = points.filter(hasValidCoord);
    if (valid.length < 2) return;
    const { lineBatches, loopBatches } = this.getLayerBatches(layer);
    if (closed) {
      if (!loopBatches.has(color)) loopBatches.set(color, []);
      loopBatches.get(color).push(valid);
      return;
    }
    if (!lineBatches.has(color)) lineBatches.set(color, []);
    const batch = lineBatches.get(color);
    for (let i = 0; i < valid.length - 1; i++) {
      batch.push([valid[i], valid[i + 1]]);
    }
  }

  addLine(group, points, color, layer, closed = false) {
    this.queueLine(points, color, layer, closed);
  }

  addEntity(group, entity, depth = 0) {
    if (depth > 20 || !entity?.type) return;
    const color = this.getColor(entity);
    const layer = entity.layer || '0';

    switch (entity.type) {
      case 'LINE': {
        const endpoints = getLineEndpoints(entity);
        if (!endpoints) break;
        this.addLine(group, [endpoints.start, endpoints.end], color, layer);
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
        this.addLine(group, points, color, layer, closed);
        break;
      }

      case 'CIRCLE': {
        if (!hasValidCoord(entity.center) || !Number.isFinite(entity.radius)) break;
        this.addLine(group, circlePoints(entity.center, entity.radius, 64), color, layer, true);
        break;
      }

      case 'ARC': {
        if (!hasValidCoord(entity.center) || !Number.isFinite(entity.radius)) break;
        this.addLine(group, arcPoints(entity.center, entity.radius, entity.startAngle, entity.endAngle, 48), color, layer);
        break;
      }

      case 'ELLIPSE': {
        const major = entity.majorAxisEndPoint || entity.majorAxis;
        if (!hasValidCoord(entity.center) || !major || !Number.isFinite(major.x) || !Number.isFinite(major.y)) break;
        const rx = Math.hypot(major.x, major.y);
        const ry = rx * (entity.axisRatio ?? entity.minorAxisRatio ?? 1);
        const rot = Math.atan2(major.y, major.x);
        this.addLine(group, ellipsePoints(entity.center, rx, ry, rot, 64), color, layer, true);
        break;
      }

      case 'SPLINE': {
        const cps = (entity.controlPoints || entity.fitPoints || []).filter(hasValidCoord);
        if (cps.length >= 2) {
          this.addLine(group, cps.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })), color, layer);
        }
        break;
      }

      case 'POINT':
        if (entity.position) {
          const s = 0.5;
          const p = entity.position;
          this.addLine(group, [{ x: p.x - s, y: p.y, z: p.z ?? 0 }, { x: p.x + s, y: p.y, z: p.z ?? 0 }], color, layer);
          this.addLine(group, [{ x: p.x, y: p.y - s, z: p.z ?? 0 }, { x: p.x, y: p.y + s, z: p.z ?? 0 }], color, layer);
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
        this.addTextMarker(group, entity, color, layer);
        break;

      case '3DFACE':
      case 'SOLID': {
        const verts = [entity.first, entity.second, entity.third, entity.fourth].filter(hasValidCoord);
        if (verts.length >= 3) {
          this.addLine(group, verts.map((v) => ({ x: v.x, y: v.y, z: v.z ?? 0 })), color, layer, true);
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