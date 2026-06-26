import * as THREE from 'three';

const QUANT = 1000;

/** DXF layer names — 치수선 / 외형연결선 / 모델형상선 / VIEW글자 */
export const DXF_LAYERS = {
  MODEL: 'MODEL_GEOM',
  OUTLINE: 'OUTLINE',
  DIMENSION: 'DIMENSION',
  VIEW_LABEL: 'VIEW_LABEL',
};

const VIEW_DEFS = {
  top: {
    label: 'TOP VIEW',
    project: (p) => [p.x, p.y],
  },
  front: {
    label: 'FRONT VIEW',
    project: (p) => [p.x, p.z],
  },
  side: {
    label: 'SIDE VIEW (RIGHT)',
    project: (p) => [p.y, p.z],
  },
};

// KS B 0401 / ISO 128 3등각 투상 배치 기준
const LAYOUT = {
  padRatio: 0.06,
  dimBelowRatio: 0.13,
  dimRightRatio: 0.11,
  labelRatio: 0.06,
  viewGapRatio: 0.30,
  minGapMm: 30,
};

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _normal = new THREE.Vector3();

const PLANE_DOT_THRESHOLD = 0.985;

function quantize(value) {
  return Math.round(value * QUANT);
}

function edgeKey3D(ax, ay, az, bx, by, bz) {
  const a = `${quantize(ax)},${quantize(ay)},${quantize(az)}`;
  const b = `${quantize(bx)},${quantize(by)},${quantize(bz)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function lineKey2D(x1, y1, x2, y2) {
  const a = `${quantize(x1)},${quantize(y1)}`;
  const b = `${quantize(x2)},${quantize(y2)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function nodeKey(x, y) {
  return `${quantize(x)},${quantize(y)}`;
}

function convexHull2D(points) {
  if (points.length <= 1) return points;
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function snapLineEndpoints(lines, cellSize = 2) {
  const pointCount = lines.length * 2;
  const coords = new Float64Array(pointCount * 2);
  const parent = new Int32Array(pointCount);
  for (let i = 0; i < pointCount; i++) parent[i] = i;

  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let c = i;
    while (parent[c] !== c) { parent[c] = r; c = parent[c]; }
    return r;
  };
  const unite = (i, j) => { parent[find(i)] = find(j); };

  let ci = 0;
  for (const line of lines) {
    coords[ci++] = line.x1;
    coords[ci++] = line.y1;
    coords[ci++] = line.x2;
    coords[ci++] = line.y2;
  }

  const grid = new Map();
  for (let i = 0; i < pointCount; i++) {
    const qx = quantize(coords[i * 2]);
    const qy = quantize(coords[i * 2 + 1]);
    const cx = Math.floor(qx / cellSize);
    const cy = Math.floor(qy / cellSize);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid.get(`${gx},${gy}`);
        if (cell) for (const j of cell) unite(i, j);
      }
    }
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  const sums = new Map();
  for (let i = 0; i < pointCount; i++) {
    const r = find(i);
    if (!sums.has(r)) sums.set(r, { x: 0, y: 0, c: 0 });
    const s = sums.get(r);
    s.x += coords[i * 2];
    s.y += coords[i * 2 + 1];
    s.c++;
  }
  const reps = new Map();
  for (const [r, s] of sums) reps.set(r, { x: s.x / s.c, y: s.y / s.c });

  return lines.map((line, li) => {
    const p1 = reps.get(find(li * 2));
    const p2 = reps.get(find(li * 2 + 1));
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });
}

function getDegrees(lines) {
  const deg = new Map();
  for (const line of lines) {
    const a = nodeKey(line.x1, line.y1);
    const b = nodeKey(line.x2, line.y2);
    if (a === b) continue;
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  }
  return deg;
}

function addLineToSet(active, activeKeys, line) {
  const key = lineKey2D(line.x1, line.y1, line.x2, line.y2);
  if (activeKeys.has(key)) return false;
  if (nodeKey(line.x1, line.y1) === nodeKey(line.x2, line.y2)) return false;
  active.push(line);
  activeKeys.add(key);
  return true;
}

function countOpenEnds(lines) {
  const deg = getDegrees(lines);
  let n = 0;
  for (const d of deg.values()) if (d === 1) n++;
  return n;
}

function repairOpenEnds(active, activeKeys, pool, addOutline) {
  const deg = getDegrees(active);
  const open = [...deg.entries()].filter(([, d]) => d === 1).map(([k]) => k);
  if (!open.length) return false;

  for (const line of pool) {
    const a = nodeKey(line.x1, line.y1);
    const b = nodeKey(line.x2, line.y2);
    if (activeKeys.has(lineKey2D(line.x1, line.y1, line.x2, line.y2))) continue;

    const aOpen = open.includes(a);
    const bOpen = open.includes(b);
    if (aOpen && bOpen && addLineToSet(active, activeKeys, line)) return true;
    if ((aOpen && (deg.get(b) || 0) >= 2) || (bOpen && (deg.get(a) || 0) >= 2)) {
      if (addLineToSet(active, activeKeys, line)) return true;
    }
  }

  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const [ax, ay] = open[i].split(',').map(Number);
      const [bx, by] = open[j].split(',').map(Number);
      const dist = Math.hypot(ax - bx, ay - by);
      if (dist === 0 || dist > 15) continue;

      const bridge = pool.find((line) => {
        const ka = nodeKey(line.x1, line.y1);
        const kb = nodeKey(line.x2, line.y2);
        return (ka === open[i] && kb === open[j]) || (ka === open[j] && kb === open[i]);
      });
      if (bridge && addLineToSet(active, activeKeys, bridge)) return true;

      const synthetic = {
        x1: ax / QUANT, y1: ay / QUANT,
        x2: bx / QUANT, y2: by / QUANT,
      };
      if (addOutline(synthetic)) return true;
    }
  }
  return false;
}

function ensureHullContour(active, activeKeys, pool, addOutline) {
  const points = [];
  for (const line of pool) {
    points.push([line.x1, line.y1], [line.x2, line.y2]);
  }
  if (points.length < 3) return;

  const hull = convexHull2D(points);
  if (hull.length < 3) return;

  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const hk = lineKey2D(x1, y1, x2, y2);
    if (activeKeys.has(hk)) continue;

    const exact = pool.find((l) => lineKey2D(l.x1, l.y1, l.x2, l.y2) === hk);
    if (exact) { addLineToSet(active, activeKeys, exact); continue; }

    const partial = pool.find((l) => {
      const la = nodeKey(l.x1, l.y1);
      const lb = nodeKey(l.x2, l.y2);
      const ha = nodeKey(x1, y1);
      const hb = nodeKey(x2, y2);
      return (la === ha && lb === hb) || (la === hb && lb === ha);
    });
    if (partial) { addLineToSet(active, activeKeys, partial); continue; }

    addOutline({ x1, y1, x2, y2 });
  }
}

function dedupeLinesPreserveContour(rawLines) {
  const empty = { modelLines: [], outlineLines: [] };
  if (!rawLines.length) return empty;

  const snapped = snapLineEndpoints(rawLines);
  const groups = new Map();

  for (const line of snapped) {
    if (nodeKey(line.x1, line.y1) === nodeKey(line.x2, line.y2)) continue;
    const key = lineKey2D(line.x1, line.y1, line.x2, line.y2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  const modelLines = [];
  const modelKeys = new Set();
  for (const [, group] of groups) {
    addLineToSet(modelLines, modelKeys, group[0]);
  }

  const outlineLines = [];
  const outlineKeys = new Set();
  const pool = [...snapped];

  const addOutline = (line) => addLineToSet(outlineLines, outlineKeys, line);

  for (let i = 0; i < 64; i++) {
    if (!repairOpenEnds(modelLines, modelKeys, pool, addOutline)) break;
  }

  if (countOpenEnds(modelLines) > 0) {
    ensureHullContour(modelLines, modelKeys, pool, addOutline);
    for (let i = 0; i < 32; i++) {
      if (!repairOpenEnds(modelLines, modelKeys, pool, addOutline)) break;
    }
  }

  return { modelLines, outlineLines };
}

function normalsCoplanar(n1, n2) {
  const dot = n1.dot(n2);
  return dot > PLANE_DOT_THRESHOLD || dot < -PLANE_DOT_THRESHOLD;
}

function isPlanarMeshEdge(edge) {
  const normals = edge.normals;
  if (!normals || normals.length < 2) return false;

  for (let i = 0; i < normals.length; i++) {
    for (let j = i + 1; j < normals.length; j++) {
      if (!normalsCoplanar(normals[i], normals[j])) return false;
    }
  }
  return true;
}

export function filterDrawingEdges(edges) {
  return edges.filter((edge) => !isPlanarMeshEdge(edge));
}

export function collectMeshEdges(object3D) {
  const edges = new Map();

  object3D.updateWorldMatrix(true, true);

  object3D.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;

    const geometry = child.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;

    const vertexAt = (i, target) =>
      target.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);

    const addEdgeNormal = (i1, i2, normal) => {
      vertexAt(i1, _va);
      vertexAt(i2, _vb);
      const key = edgeKey3D(_va.x, _va.y, _va.z, _vb.x, _vb.y, _vb.z);
      if (!edges.has(key)) {
        edges.set(key, {
          ax: _va.x, ay: _va.y, az: _va.z,
          bx: _vb.x, by: _vb.y, bz: _vb.z,
          normals: [],
        });
      }
      edges.get(key).normals.push(normal.clone());
    };

    const processTriangle = (i0, i1, i2) => {
      vertexAt(i0, _va);
      vertexAt(i1, _vb);
      vertexAt(i2, _vc);
      _edge1.subVectors(_vb, _va);
      _edge2.subVectors(_vc, _va);
      _normal.crossVectors(_edge1, _edge2);
      const len = _normal.length();
      if (len < 1e-12) return;
      _normal.multiplyScalar(1 / len);
      addEdgeNormal(i0, i1, _normal);
      addEdgeNormal(i1, i2, _normal);
      addEdgeNormal(i2, i0, _normal);
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        processTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        processTriangle(i, i + 1, i + 2);
      }
    }
  });

  return Array.from(edges.values());
}

function boundsFromLines(...lineGroups) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lines of lineGroups) {
    for (const line of lines) {
      minX = Math.min(minX, line.x1, line.x2);
      minY = Math.min(minY, line.y1, line.y2);
      maxX = Math.max(maxX, line.x1, line.x2);
      maxY = Math.max(maxY, line.y1, line.y2);
    }
  }
  return {
    minX: minX === Infinity ? 0 : minX,
    minY: minY === Infinity ? 0 : minY,
    maxX: maxX === -Infinity ? 0 : maxX,
    maxY: maxY === -Infinity ? 0 : maxY,
  };
}

function projectEdges(edges, projectFn) {
  const rawLines = [];

  for (const edge of edges) {
    const [x1, y1] = projectFn({ x: edge.ax, y: edge.ay, z: edge.az });
    const [x2, y2] = projectFn({ x: edge.bx, y: edge.by, z: edge.bz });
    if (quantize(x1) === quantize(x2) && quantize(y1) === quantize(y2)) continue;
    rawLines.push({ x1, y1, x2, y2 });
  }

  const { modelLines, outlineLines } = dedupeLinesPreserveContour(rawLines);

  return {
    modelLines,
    outlineLines,
    bounds: boundsFromLines(modelLines, outlineLines),
  };
}

function offsetLines(lines, dx, dy) {
  return lines.map((line) => ({
    x1: line.x1 + dx,
    y1: line.y1 + dy,
    x2: line.x2 + dx,
    y2: line.y2 + dy,
  }));
}

function computeMargins(w, h) {
  const mw = Math.max(w, 1);
  const mh = Math.max(h, 1);
  return {
    padX: mw * LAYOUT.padRatio,
    padY: mh * LAYOUT.padRatio,
    dimBelow: mh * LAYOUT.dimBelowRatio,
    dimRight: mw * LAYOUT.dimRightRatio,
    labelBelow: mh * LAYOUT.labelRatio,
    labelAbove: mh * LAYOUT.labelRatio * 0.5,
  };
}

function packView(projected, label) {
  const w = projected.bounds.maxX - projected.bounds.minX;
  const h = projected.bounds.maxY - projected.bounds.minY;
  const m = computeMargins(w, h);

  const originX = m.padX;
  const originY = m.padY + m.dimBelow + m.labelBelow;
  const dx = originX - projected.bounds.minX;
  const dy = originY - projected.bounds.minY;

  const frameW = m.padX + w + m.padX + m.dimRight;
  const frameH = m.labelAbove + m.padY + h + m.padY + m.dimBelow + m.labelBelow;

  return {
    modelLines: offsetLines(projected.modelLines, dx, dy),
    outlineLines: offsetLines(projected.outlineLines, dx, dy),
    bounds: {
      minX: originX,
      minY: originY,
      maxX: originX + w,
      maxY: originY + h,
    },
    frame: { w: frameW, h: frameH },
    margins: m,
    label,
    labelPos: {
      x: originX + w / 2,
      y: originY + h + m.padY + m.labelAbove * 0.45,
    },
  };
}

function translateView(view, tx, ty) {
  return {
    ...view,
    modelLines: offsetLines(view.modelLines, tx, ty),
    outlineLines: offsetLines(view.outlineLines, tx, ty),
    bounds: {
      minX: view.bounds.minX + tx,
      minY: view.bounds.minY + ty,
      maxX: view.bounds.maxX + tx,
      maxY: view.bounds.maxY + ty,
    },
    frame: view.frame,
    margins: view.margins,
    label: view.label,
    labelPos: { x: view.labelPos.x + tx, y: view.labelPos.y + ty },
    frameOrigin: { x: tx, y: ty },
  };
}

function layoutThreeViews(projected, layoutMode = 'third-angle') {
  const front = packView(projected.front, VIEW_DEFS.front.label);
  const top = packView(projected.top, VIEW_DEFS.top.label);
  const side = packView(projected.side, VIEW_DEFS.side.label);

  const refSpan = Math.max(
    front.frame.w, top.frame.w, side.frame.w,
    front.frame.h, top.frame.h, side.frame.h,
  );
  const gapX = Math.max(refSpan * LAYOUT.viewGapRatio, LAYOUT.minGapMm);
  const gapY = Math.max(refSpan * LAYOUT.viewGapRatio, LAYOUT.minGapMm);

  const frontX = 0;
  const frontY = 0;
  const topX = frontX + front.bounds.minX - top.bounds.minX;
  const topY = layoutMode === 'first-angle'
    ? frontY - top.frame.h - gapY
    : frontY + front.frame.h + gapY;
  const sideX = frontX + front.frame.w + gapX;
  const sideY = frontY + front.bounds.minY - side.bounds.minY;

  return {
    front: translateView(front, frontX, frontY),
    top: translateView(top, topX, topY),
    side: translateView(side, sideX, sideY),
    gapX,
    gapY,
  };
}

function scaleProjected(projected, factor) {
  if (!factor || factor === 1) return projected;
  const scaled = {};
  for (const [key, data] of Object.entries(projected)) {
    const scaleLines = (lines) => lines.map((line) => ({
      x1: line.x1 * factor,
      y1: line.y1 * factor,
      x2: line.x2 * factor,
      y2: line.y2 * factor,
    }));
    scaled[key] = {
      ...data,
      modelLines: scaleLines(data.modelLines),
      outlineLines: scaleLines(data.outlineLines),
      bounds: {
        minX: data.bounds.minX * factor,
        minY: data.bounds.minY * factor,
        maxX: data.bounds.maxX * factor,
        maxY: data.bounds.maxY * factor,
      },
    };
  }
  return scaled;
}

class DxfWriter {
  constructor() {
    this.layers = [
      { name: '0', color: 7 },
      { name: DXF_LAYERS.MODEL, color: 7 },
      { name: DXF_LAYERS.OUTLINE, color: 4 },
      { name: DXF_LAYERS.DIMENSION, color: 2 },
      { name: DXF_LAYERS.VIEW_LABEL, color: 3 },
    ];
    this.entities = [];
  }

  addLine(x1, y1, x2, y2, layer = '0') {
    this.entities.push({ type: 'LINE', layer, x1, y1, x2, y2 });
  }

  addText(x, y, text, height, layer = DXF_LAYERS.VIEW_LABEL, options = {}) {
    this.entities.push({
      type: 'TEXT',
      layer,
      x,
      y,
      text,
      height,
      rotation: options.rotation ?? 0,
      halign: options.halign ?? 1,
    });
  }

  entityToDxf(entity) {
    if (entity.type === 'LINE') {
      return [
        '0', 'LINE',
        '8', entity.layer,
        '10', fmt(entity.x1),
        '20', fmt(entity.y1),
        '30', '0.0',
        '11', fmt(entity.x2),
        '21', fmt(entity.y2),
        '31', '0.0',
      ].join('\n') + '\n';
    }

    if (entity.type === 'TEXT') {
      const parts = [
        '0', 'TEXT',
        '8', entity.layer,
        '10', fmt(entity.x),
        '20', fmt(entity.y),
        '30', '0.0',
        '40', fmt(entity.height),
        '1', entity.text,
        '7', 'STANDARD',
        '72', String(entity.halign ?? 1),
        '11', fmt(entity.x),
        '21', fmt(entity.y),
        '31', '0.0',
      ];
      if (entity.rotation) parts.push('50', fmt(entity.rotation));
      return parts.join('\n') + '\n';
    }

    return '';
  }

  toString() {
    const header = [
      dxfPair(9, '$ACADVER') + dxfPair(1, 'AC1015'),
      dxfPair(9, '$INSUNITS') + dxfPair(70, '4'),
      dxfPair(9, '$MEASUREMENT') + dxfPair(70, '1'),
      dxfPair(9, '$DWGCODEPAGE') + dxfPair(3, 'ANSI_949'),
    ].join('');

    const parts = [
      dxfSection('HEADER', header),
      dxfTables(this.layers),
      dxfBlocks(),
      dxfSection('ENTITIES', this.entities.map((e) => this.entityToDxf(e)).join('')),
      '0\nEOF\n',
    ];
    return parts.join('');
  }
}

function fmt(n) {
  return Number(n).toFixed(4);
}

function fmtDim(n) {
  const v = Number(n);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function dxfPair(code, value) {
  return `${code}\n${value}\n`;
}

function dxfSection(name, content) {
  const body = Array.isArray(content) ? content.join('') : content;
  return `0\nSECTION\n2\n${name}\n${body}0\nENDSEC\n`;
}

function dxfLtypeTable() {
  let table = '0\nTABLE\n2\nLTYPE\n';
  table += dxfPair(70, '1');
  table += '0\nLTYPE\n';
  table += dxfPair(2, 'CONTINUOUS');
  table += dxfPair(70, '0');
  table += dxfPair(3, 'Solid line');
  table += dxfPair(72, '65');
  table += dxfPair(73, '0');
  table += dxfPair(40, '0.0');
  table += '0\nENDTAB\n';
  return table;
}

function dxfBlocks() {
  const blocks = [
    '0\nBLOCK\n2\n*MODEL_SPACE\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*MODEL_SPACE\n1\n\n',
    '0\nENDBLK\n',
    '0\nBLOCK\n2\n*PAPER_SPACE\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n*PAPER_SPACE\n1\n\n',
    '0\nENDBLK\n',
  ].join('');
  return dxfSection('BLOCKS', blocks);
}

function dxfTables(layers) {
  let table = dxfLtypeTable();
  table += '0\nTABLE\n2\nLAYER\n';
  table += dxfPair(70, String(layers.length));
  for (const layer of layers) {
    table += '0\nLAYER\n';
    table += dxfPair(2, layer.name);
    table += dxfPair(70, '0');
    table += dxfPair(62, String(layer.color));
    table += dxfPair(6, 'CONTINUOUS');
    table += dxfPair(370, '-3');
  }
  table += '0\nENDTAB\n';
  table += '0\nTABLE\n2\nSTYLE\n';
  table += dxfPair(70, '1');
  table += '0\nSTYLE\n';
  table += dxfPair(2, 'STANDARD');
  table += dxfPair(70, '0');
  table += dxfPair(40, '0');
  table += dxfPair(41, '1.0');
  table += dxfPair(50, '0.0');
  table += dxfPair(71, '0');
  table += dxfPair(42, '2.5');
  table += dxfPair(3, 'txt');
  table += dxfPair(4, '');
  table += '0\nENDTAB\n';
  return dxfSection('TABLES', table);
}

function getFrameRect(view) {
  const { bounds, margins, frameOrigin } = view;
  return {
    x1: frameOrigin.x,
    y1: frameOrigin.y,
    x2: frameOrigin.x + view.frame.w,
    y2: frameOrigin.y + view.frame.h,
    model: bounds,
    margins,
  };
}

function addDimensions(dxf, view) {
  const { model, margins } = getFrameRect(view);
  const mx1 = model.minX;
  const my1 = model.minY;
  const mx2 = model.maxX;
  const my2 = model.maxY;
  const width = mx2 - mx1;
  const height = my2 - my1;
  const textH = Math.max(Math.min(width, height) * 0.045, 2.5);
  const tick = textH * 0.2;
  const dimLayer = DXF_LAYERS.DIMENSION;

  const dimY = my1 - margins.dimBelow * 0.5;
  dxf.addLine(mx1, my1, mx1, dimY, dimLayer);
  dxf.addLine(mx2, my2, mx2, dimY, dimLayer);
  dxf.addLine(mx1, dimY, mx2, dimY, dimLayer);
  dxf.addLine(mx1, dimY - tick, mx1, dimY + tick, dimLayer);
  dxf.addLine(mx2, dimY - tick, mx2, dimY + tick, dimLayer);
  dxf.addText((mx1 + mx2) / 2, dimY - textH * 0.85, fmtDim(width), textH, dimLayer, { halign: 1 });

  const dimX = mx2 + margins.dimRight * 0.5;
  dxf.addLine(mx1, my1, dimX, my1, dimLayer);
  dxf.addLine(mx2, my2, dimX, my2, dimLayer);
  dxf.addLine(dimX, my1, dimX, my2, dimLayer);
  dxf.addLine(dimX - tick, my1, dimX + tick, my1, dimLayer);
  dxf.addLine(dimX - tick, my2, dimX + tick, my2, dimLayer);
  dxf.addText(dimX + textH * 0.55, (my1 + my2) / 2, fmtDim(height), textH, dimLayer, { rotation: 90, halign: 1 });
}

function addViewFrameBorder(dxf, viewData) {
  const { x1, y1, x2, y2 } = getFrameRect(viewData);
  const layer = DXF_LAYERS.OUTLINE;
  dxf.addLine(x1, y1, x2, y1, layer);
  dxf.addLine(x2, y1, x2, y2, layer);
  dxf.addLine(x2, y2, x1, y2, layer);
  dxf.addLine(x1, y2, x1, y1, layer);
}

function addViewToDxf(dxf, viewData, includeDimensions = true) {
  const frame = getFrameRect(viewData);

  for (const line of viewData.modelLines) {
    dxf.addLine(line.x1, line.y1, line.x2, line.y2, DXF_LAYERS.MODEL);
  }

  for (const line of viewData.outlineLines) {
    dxf.addLine(line.x1, line.y1, line.x2, line.y2, DXF_LAYERS.OUTLINE);
  }

  addViewFrameBorder(dxf, viewData);

  if (includeDimensions) addDimensions(dxf, viewData);

  const textHeight = Math.max(
    (frame.model.maxX - frame.model.minX + frame.model.maxY - frame.model.minY) * 0.025,
    3,
  );
  dxf.addText(
    viewData.labelPos.x,
    viewData.labelPos.y,
    viewData.label,
    textHeight,
    DXF_LAYERS.VIEW_LABEL,
    { halign: 1 },
  );
}

const SCALE_FACTORS = {
  auto: 1,
  '1:1': 1,
  '1:2': 0.5,
  '2:1': 2,
};

export function generateThreeViewDXF(modelGroup, options = {}) {
  const {
    includeDimensions = true,
    scale = 'auto',
    layout = 'third-angle',
  } = options;

  const allEdges = filterDrawingEdges(collectMeshEdges(modelGroup));
  if (allEdges.length === 0) {
    throw new Error('도면으로 변환할 모델 데이터가 없습니다.');
  }

  let projected = {};
  for (const [key, def] of Object.entries(VIEW_DEFS)) {
    projected[key] = projectEdges(allEdges, def.project);
    if (projected[key].modelLines.length === 0 && projected[key].outlineLines.length === 0) {
      throw new Error(`${def.label}에 표시할 선이 없습니다.`);
    }
  }

  const scaleFactor = SCALE_FACTORS[scale] ?? 1;
  projected = scaleProjected(projected, scaleFactor);

  const layoutResult = layoutThreeViews(projected, layout);
  const dxf = new DxfWriter();

  addViewToDxf(dxf, layoutResult.front, includeDimensions);
  addViewToDxf(dxf, layoutResult.top, includeDimensions);
  addViewToDxf(dxf, layoutResult.side, includeDimensions);

  return dxf.toString();
}