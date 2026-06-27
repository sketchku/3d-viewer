import { t } from './i18n.js';
import { throwIfCancelled, yieldToMain } from './large-file-loader.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';

let pdfjsLib = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return pdfjsLib;
}

export function slicePdfBuffer(buffer) {
  const sample = buffer.slice(0, Math.min(buffer.length, 16384));
  const head = new TextDecoder('ascii', { fatal: false }).decode(sample);
  const idx = head.indexOf('%PDF');
  if (idx > 0) return buffer.slice(idx);
  return buffer;
}

export function detectAiFormat(buffer) {
  const sample = buffer.slice(0, Math.min(buffer.length, 4096));
  const head = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  if (head.startsWith('%PDF') || head.includes('%PDF-')) return 'pdf';
  if (head.indexOf('%PDF') > 0) return 'pdf';
  if (head.startsWith('%!PS') || head.includes('EPSF')) return 'eps';
  if (/<svg[\s>]/i.test(head)) return 'svg';
  if (head.trimStart().startsWith('<?xml') && head.includes('<svg')) return 'svg';
  return 'unknown';
}

function extractEmbeddedSvg(text) {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  return match ? match[0] : null;
}

function parseEpsBoundingBox(text) {
  const match = text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) return { x: 0, y: 0, width: 612, height: 792 };
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1) || 612,
    height: Math.abs(y2 - y1) || 792,
  };
}

function epsToSvg(text) {
  const bbox = parseEpsBoundingBox(text);
  const height = bbox.height;
  const flipY = (y) => height - (y - bbox.y);

  let pathData = '';
  let cx = 0;
  let cy = 0;
  let started = false;

  const pushMove = (x, y) => {
    cx = x;
    cy = y;
    pathData += `${started ? ' ' : ''}M ${x} ${flipY(y)}`;
    started = true;
  };
  const pushLine = (x, y) => {
    cx = x;
    cy = y;
    pathData += ` L ${x} ${flipY(y)}`;
  };

  const tokens = text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?|[a-zA-Z*]+/g) || [];
  const stack = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^-?\d/.test(token)) {
      stack.push(Number(token));
      i += 1;
      continue;
    }

    const cmd = token.toLowerCase();
    i += 1;

    if (cmd === 'moveto' || cmd === 'm') {
      const y = stack.pop() ?? 0;
      const x = stack.pop() ?? 0;
      pushMove(x, y);
    } else if (cmd === 'lineto' || cmd === 'l') {
      const y = stack.pop() ?? 0;
      const x = stack.pop() ?? 0;
      pushLine(x, y);
    } else if (cmd === 'rlineto' || cmd === 'r') {
      const dy = stack.pop() ?? 0;
      const dx = stack.pop() ?? 0;
      pushLine(cx + dx, cy + dy);
    } else if (cmd === 'curveto' || cmd === 'c') {
      const y3 = stack.pop() ?? 0;
      const x3 = stack.pop() ?? 0;
      const y2 = stack.pop() ?? 0;
      const x2 = stack.pop() ?? 0;
      const y1 = stack.pop() ?? 0;
      const x1 = stack.pop() ?? 0;
      pathData += ` C ${x1} ${flipY(y1)} ${x2} ${flipY(y2)} ${x3} ${flipY(y3)}`;
      cx = x3;
      cy = y3;
      started = true;
    } else if (cmd === 'closepath' || cmd === 'h') {
      pathData += ' Z';
    } else if (cmd === 'rect' || cmd === 're') {
      const h = stack.pop() ?? 0;
      const w = stack.pop() ?? 0;
      const y = stack.pop() ?? 0;
      const x = stack.pop() ?? 0;
      pushMove(x, y);
      pushLine(x + w, y);
      pushLine(x + w, y + h);
      pushLine(x, y + h);
      pathData += ' Z';
    } else if (cmd === 'gsave' || cmd === 'grestore' || cmd === 'newpath' || cmd === 'n') {
      // skip
    } else if (cmd === 'stroke' || cmd === 's' || cmd === 'fill' || cmd === 'f' || cmd === 'f*') {
      // end of path segment
    }
  }

  if (!pathData.trim()) return null;

  const width = bbox.width;
  const svgHeight = bbox.height;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${svgHeight}" width="${width}" height="${svgHeight}">
  <g data-layer="0">
    <path d="${pathData.trim()}" fill="none" stroke="#e8eaed" stroke-width="0.5"/>
  </g>
</svg>`;
}

async function pdfPageToSvg(page, pdfjs) {
  const viewport = page.getViewport({ scale: 1 });
  const { fnArray, argsArray } = await page.getOperatorList();
  const { OPS } = pdfjs;
  const height = viewport.height;
  const flipY = (y) => height - y;

  const paths = [];
  let current = [];
  let cx = 0;
  let cy = 0;
  let strokeColor = '#e8eaed';
  let lineWidth = 0.5;

  const flush = () => {
    if (current.length < 2) {
      current = [];
      return;
    }
    paths.push({
      d: current.join(' '),
      stroke: strokeColor,
      fill: 'none',
      strokeWidth: lineWidth,
    });
    current = [];
  };

  const moveTo = (x, y) => {
    cx = x;
    cy = y;
    current.push(`M ${x} ${flipY(y)}`);
  };
  const lineTo = (x, y) => {
    cx = x;
    cy = y;
    current.push(`L ${x} ${flipY(y)}`);
  };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    cx = x3;
    cy = y3;
    current.push(`C ${x1} ${flipY(y1)} ${x2} ${flipY(y2)} ${x3} ${flipY(y3)}`);
  };
  const closePath = () => current.push('Z');

  const parseConstructPath = (args) => {
    if (!args?.length) return;
    const ops = Array.from(args[0] || []);
    const coords = args[1] || [];
    let ci = 0;
    for (const op of ops) {
      if (op === 0) {
        moveTo(coords[ci], coords[ci + 1]);
        ci += 2;
      } else if (op === 1) {
        lineTo(coords[ci], coords[ci + 1]);
        ci += 2;
      } else if (op === 2) {
        curveTo(coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3], coords[ci + 4], coords[ci + 5]);
        ci += 6;
      } else if (op === 3) {
        curveTo(coords[ci], coords[ci + 1], coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]);
        ci += 4;
      } else if (op === 4) {
        closePath();
      }
    }
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.constructPath) {
      parseConstructPath(args);
    } else if (fn === OPS.moveTo) {
      moveTo(args[0], args[1]);
    } else if (fn === OPS.lineTo) {
      lineTo(args[0], args[1]);
    } else if (fn === OPS.curveTo) {
      curveTo(args[0], args[1], args[2], args[3], args[4], args[5]);
    } else if (fn === OPS.closePath) {
      closePath();
    } else if (fn === OPS.rectangle) {
      const [x, y, w, h] = args;
      moveTo(x, y);
      lineTo(x + w, y);
      lineTo(x + w, y + h);
      lineTo(x, y + h);
      closePath();
    } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
      flush();
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      if (current.length) {
        paths.push({
          d: current.join(' '),
          stroke: 'none',
          fill: strokeColor,
          strokeWidth: 0,
        });
        current = [];
      }
    } else if (fn === OPS.setStrokeRGBColor) {
      const [r, g, b] = args;
      strokeColor = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    } else if (fn === OPS.setFillRGBColor) {
      const [r, g, b] = args;
      strokeColor = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    } else if (fn === OPS.setLineWidth) {
      lineWidth = Math.max(args[0] || 0.5, 0.1);
    } else if (fn === OPS.save || fn === OPS.restore) {
      flush();
    }
  }
  flush();

  if (!paths.length) {
    const canvas = document.createElement('canvas');
    const scale = 2;
    const scaled = page.getViewport({ scale });
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" width="${viewport.width}" height="${viewport.height}">
  <g data-layer="0">
    <image href="${dataUrl}" x="0" y="0" width="${viewport.width}" height="${viewport.height}" />
  </g>
</svg>`;
  }

  const pathEls = paths.map((p) => {
    const attrs = [`d="${p.d}"`];
    if (p.fill && p.fill !== 'none') attrs.push(`fill="${p.fill}"`);
    else attrs.push('fill="none"');
    if (p.stroke && p.stroke !== 'none') attrs.push(`stroke="${p.stroke}"`);
    if (p.strokeWidth) attrs.push(`stroke-width="${p.strokeWidth}"`);
    return `<path ${attrs.join(' ')} />`;
  }).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" width="${viewport.width}" height="${viewport.height}">
  <g data-layer="0">
    ${pathEls}
  </g>
</svg>`;
}

async function pdfToSvg(buffer, { signal, onProgress } = {}) {
  const pdfjs = await getPdfJs();
  throwIfCancelled(signal);
  const pdfData = slicePdfBuffer(buffer);
  const pdf = await pdfjs.getDocument({ data: pdfData }).promise;
  const pages = [];
  const total = pdf.numPages;

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    throwIfCancelled(signal);
    const page = await pdf.getPage(pageNum);
    const svg = await pdfPageToSvg(page, pdfjs);
    pages.push(svg);
    onProgress?.(pageNum, total);
    if (pageNum < total) await yieldToMain(signal);
  }

  return pages[0];
}

export async function aiToSvg(buffer, { signal, onProgress } = {}) {
  throwIfCancelled(signal);
  const format = detectAiFormat(buffer);

  if (format === 'pdf') {
    return pdfToSvg(buffer, { signal, onProgress });
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  if (format === 'svg') {
    const svg = extractEmbeddedSvg(text);
    if (svg) return svg;
  }

  if (format === 'eps' || format === 'unknown') {
    const epsSvg = epsToSvg(text);
    if (epsSvg) return epsSvg;
    const embedded = extractEmbeddedSvg(text);
    if (embedded) return embedded;
  }

  throw new Error(t('aiParseFailed'));
}