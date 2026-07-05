/** Gargantua-inspired dot background with live-tunable parameters. */

export const DEFAULT_BG_PARAMS = {
  global: { dotScale: 5 / 3, holeRadius: 0.065, diskTilt: 0.38 },
  disk: { count: 80, orbitScale: 3, flatness: 0.26, spin: 1, dotSize: 1, alpha: 0.85 },
  photon: { count: 16, orbitScale: 1, flatness: 0.22, spin: 1, dotSize: 1 },
  boundary: { count: 34, speed: 1, dotSize: 1 },
  inflow: { count: 18, dotSize: 1 },
  field: { count: 14, dotSize: 1 },
  arc: { count: 20, radiusScale: 1, drift: 1, dotSize: 1 },
  blackHole: { radiusScale: 1 },
};

const STAR_RGB = [145, 158, 185];
const PHOTON_RGB = [255, 228, 175];
const DISK_HOT = [255, 205, 130];
const DISK_WARM = [255, 155, 65];
const DISK_COOL = [175, 85, 40];

const HOLE_EDGE = 1.0;
const HOLE_EDGE_OUTER = 1.07;
const ARC_ANGLE_START = -Math.PI * 0.8;
const ARC_ANGLE_END = -Math.PI * 0.2;

const DISK_SPIN_BASE = 0.0055;
const PHOTON_SPIN_BASE = 0.014;

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    out[key] = val && typeof val === 'object' && !Array.isArray(val)
      ? deepMerge(target[key] || {}, val)
      : val;
  }
  return out;
}

function cloneParams(params) {
  return deepMerge(params, {});
}

function dopplerAlpha(angle) {
  const phase = Math.cos(angle - Math.PI * 0.3);
  return 0.32 + (phase + 1) * 0.34;
}

function diskRgb(angle) {
  const phase = Math.cos(angle - Math.PI * 0.3);
  if (phase > 0.35) return DISK_HOT;
  if (phase > -0.2) return DISK_WARM;
  return DISK_COOL;
}

function dotSize(sizeBase, params, groupSize) {
  return sizeBase * params.global.dotScale * groupSize;
}

function boundaryRadius(holeR, star, time, p) {
  const wobble = Math.sin(time * 0.045 + star.wobblePhase) * star.wobbleAmp;
  return holeR * p.blackHole.radiusScale * (HOLE_EDGE + star.edgeOffset + wobble);
}

function spawnBoundaryStar(holeR, i, count) {
  return {
    kind: 'boundary',
    angle: (i / count) * Math.PI * 2 + Math.random() * 0.35,
    edgeOffset: Math.random() * (HOLE_EDGE_OUTER - HOLE_EDGE),
    baseSpeed: (0.004 + Math.random() * 0.007) * (Math.random() > 0.5 ? 1 : -1),
    sizeBase: Math.random() > 0.65 ? 2 : 1.5,
    twinkle: Math.random() * Math.PI * 2,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 0.008 + Math.random() * 0.018,
  };
}

function spawnInflowStar(holeR) {
  const angle = Math.random() * Math.PI * 2;
  const direction = Math.random() > 0.5 ? 1 : -1;
  return {
    kind: 'inflow',
    state: 'approach',
    angle,
    dist: holeR * (2.2 + Math.random() * 2.8),
    direction,
    approachSpeed: 0.006 + Math.random() * 0.01,
    slideSpeed: 0.009 + Math.random() * 0.012,
    slideSpan: Math.PI * (0.55 + Math.random() * 1.4),
    slideProgress: 0,
    edgeOffset: Math.random() * (HOLE_EDGE_OUTER - HOLE_EDGE),
    sizeBase: Math.random() > 0.5 ? 2 : 1.5,
    twinkle: Math.random() * Math.PI * 2,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 0.006 + Math.random() * 0.014,
  };
}

function spawnFieldStar(holeR) {
  const angle = Math.random() * Math.PI * 2;
  return {
    kind: 'field',
    angle,
    dist: holeR * (1.35 + Math.random() * 2.2),
    direction: Math.random() > 0.5 ? 1 : -1,
    speed: 0.0012 + Math.random() * 0.0025,
    sizeBase: 1,
    twinkle: Math.random() * Math.PI * 2,
    edgeOffset: Math.random() * (HOLE_EDGE_OUTER - HOLE_EDGE),
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 0.005 + Math.random() * 0.01,
  };
}

function spawnDiskDot(i, count) {
  const band = i % 3;
  const t = i / count;
  return {
    rxBase: 0.11 + band * 0.045 + (t % 0.15) * 0.04,
    band,
    angle: t * Math.PI * 2 + band * 0.4,
    spinBand: 1.1 + band * 0.35,
    sizeBase: band === 0 ? 2.5 : band === 1 ? 2 : 1.5,
  };
}

function spawnPhotonDot(i, count) {
  return {
    rxBase: 0.075 + (i % 3) * 0.008,
    angle: (i / count) * Math.PI * 2,
    spinDir: i % 2 === 0 ? 1 : -1,
    sizeBase: i % 4 === 0 ? 3 : 2,
  };
}

function spawnArcStar(holeR, i, count) {
  const t = i / Math.max(1, count - 1);
  return {
    angle: ARC_ANGLE_START + t * (ARC_ANGLE_END - ARC_ANGLE_START),
    radiusBase: 1.75 + Math.random() * 0.45,
    driftBase: (Math.random() - 0.5) * 0.0012,
    phase: Math.random() * Math.PI * 2,
    sizeBase: Math.random() > 0.55 ? 2 : 1.5,
  };
}

function starOnBoundary(cx, cy, holeR, star, time, p) {
  const r = boundaryRadius(holeR, star, time, p);
  return { x: cx + Math.cos(star.angle) * r, y: cy + Math.sin(star.angle) * r };
}

function updateInflowStar(star, holeR, time, p) {
  const edgeLimit = holeR * p.blackHole.radiusScale * HOLE_EDGE_OUTER;

  if (star.state === 'approach') {
    star.dist -= star.approachSpeed * holeR * 1.8;
    star.angle += star.approachSpeed * star.direction * 2.4;
    if (star.dist <= edgeLimit) {
      star.state = 'slide';
      star.dist = holeR * p.blackHole.radiusScale * (HOLE_EDGE + star.edgeOffset);
      star.slideProgress = 0;
    }
    return;
  }

  if (star.state === 'slide') {
    star.angle += star.slideSpeed * star.direction;
    star.slideProgress += star.slideSpeed;
    star.dist = boundaryRadius(holeR, star, time, p);
    if (star.slideProgress >= star.slideSpan) star.state = 'depart';
    return;
  }

  star.dist += star.approachSpeed * holeR * 1.4;
  star.angle += star.approachSpeed * star.direction * 0.8;
  if (star.dist >= holeR * 4.5) Object.assign(star, spawnInflowStar(holeR));
}

function updateFieldStar(star, holeR, p) {
  const edgeR = holeR * p.blackHole.radiusScale * HOLE_EDGE_OUTER;
  const outerR = holeR * 3.8;

  if (star.dist > edgeR * 1.08) {
    star.dist -= star.speed * holeR * 0.9;
    star.angle += star.speed * star.direction * 1.6;
    if (star.dist <= edgeR * 1.08) {
      star.dist = holeR * p.blackHole.radiusScale * (HOLE_EDGE + star.edgeOffset);
    }
    return;
  }

  star.angle += star.speed * star.direction * 2.8;
  star.dist = holeR * p.blackHole.radiusScale * (HOLE_EDGE + star.edgeOffset);
  if (Math.random() < 0.0008) {
    star.dist = outerR * (0.7 + Math.random() * 0.3);
    star.angle = Math.random() * Math.PI * 2;
  }
}

/** Near side of tilted ellipse faces the viewer (drawn in front of the black hole). */
function isOrbitFront(angle, tilt) {
  return Math.sin(angle) * Math.cos(tilt) > 0;
}

function orbitOnEllipse(dot, cx, cy, base, p, group) {
  const g = p[group];
  const rx = base * dot.rxBase * g.orbitScale;
  const ry = rx * g.flatness;
  const cosA = Math.cos(dot.angle);
  const sinA = Math.sin(dot.angle);
  const ex = rx * cosA;
  const ey = ry * sinA;
  const tilt = p.global.diskTilt;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  return {
    x: cx + ex * cosT - ey * sinT,
    y: cy + ex * sinT + ey * cosT,
  };
}

function drawDot(ctx, x, y, size, rgb, alpha) {
  const half = size * 0.5;
  const [r, g, b] = rgb;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.fillRect((x - half) | 0, (y - half) | 0, size, size);
}

function drawBlackHole(ctx, cx, cy, holeR, bgColor) {
  const layers = Math.max(3, (holeR * 0.5) | 0);
  for (let i = layers; i >= 0; i--) {
    const t = i / layers;
    const r = holeR * (0.55 + t * 0.45);
    const alpha = 0.55 + t * 0.45;
    ctx.fillStyle = i === 0 ? '#000000' : `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = bgColor;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, holeR * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function createBgPixels(canvas, viewport, initialParams = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let params = deepMerge(DEFAULT_BG_PARAMS, initialParams);
  let w = 0;
  let h = 0;
  let base = 1;
  let holeR = 1;
  let bgColor = '#1a1d23';
  let enabled = true;
  let visible = document.visibilityState === 'visible';
  let time = 0;

  let boundaryStars = [];
  let inflowStars = [];
  let fieldStars = [];
  let diskDots = [];
  let photonDots = [];
  let arcStars = [];

  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
  });

  function rebuildGroup(name) {
    const p = params;
    const hr = holeR;
    switch (name) {
      case 'boundary':
        boundaryStars = Array.from({ length: p.boundary.count }, (_, i) =>
          spawnBoundaryStar(hr, i, p.boundary.count));
        break;
      case 'inflow':
        inflowStars = Array.from({ length: p.inflow.count }, () => spawnInflowStar(hr));
        break;
      case 'field':
        fieldStars = Array.from({ length: p.field.count }, () => spawnFieldStar(hr));
        break;
      case 'disk':
        diskDots = Array.from({ length: p.disk.count }, (_, i) =>
          spawnDiskDot(i, p.disk.count));
        break;
      case 'photon':
        photonDots = Array.from({ length: p.photon.count }, (_, i) =>
          spawnPhotonDot(i, p.photon.count));
        break;
      case 'arc':
        arcStars = Array.from({ length: p.arc.count }, (_, i) =>
          spawnArcStar(hr, i, p.arc.count));
        break;
      default:
        break;
    }
  }

  function initParticles() {
    rebuildGroup('boundary');
    rebuildGroup('inflow');
    rebuildGroup('field');
    rebuildGroup('disk');
    rebuildGroup('photon');
    rebuildGroup('arc');
  }

  function resize() {
    w = viewport.clientWidth;
    h = viewport.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    base = Math.min(w, h);
    holeR = base * params.global.holeRadius;
    initParticles();
  }

  function paintSolid() {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
  }

  function setColor(hex) {
    bgColor = hex;
    if (!enabled) paintSolid();
  }

  function setEnabled(on) {
    enabled = !!on;
    canvas.style.display = enabled ? '' : 'none';
    if (enabled) return;
    paintSolid();
  }

  function getParams() {
    return cloneParams(params);
  }

  function setParams(partial, { replace = false } = {}) {
    const prev = cloneParams(params);
    params = replace ? cloneParams(deepMerge(DEFAULT_BG_PARAMS, partial)) : deepMerge(params, partial);
    holeR = base * params.global.holeRadius;

    if (prev.global.holeRadius !== params.global.holeRadius) {
      initParticles();
      return;
    }

    const countKeys = ['boundary', 'inflow', 'field', 'disk', 'photon', 'arc'];
    for (const key of countKeys) {
      if (prev[key].count !== params[key].count) rebuildGroup(key);
    }
  }

  function tick() {
    if (!enabled || !visible || w <= 0 || h <= 0) return;

    time += 1;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const p = params;
    const bhR = holeR * p.blackHole.radiusScale;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const tilt = p.global.diskTilt;

    for (const dot of diskDots) {
      dot.angle += DISK_SPIN_BASE * dot.spinBand * p.disk.spin;
    }
    for (const dot of photonDots) {
      dot.angle += PHOTON_SPIN_BASE * dot.spinDir * p.photon.spin;
    }

    const drawOrbitDots = (dots, group, frontPass, colorFn, alphaFn) => {
      for (const dot of dots) {
        if (isOrbitFront(dot.angle, tilt) !== frontPass) continue;
        const { x, y } = orbitOnEllipse(dot, cx, cy, base, p, group);
        const alpha = alphaFn(dot);
        if (alpha < 0.06) continue;
        drawDot(ctx, x, y, dotSize(dot.sizeBase, p, p[group].dotSize), colorFn(dot), alpha);
      }
    };

    drawOrbitDots(diskDots, 'disk', false, (d) => diskRgb(d.angle),
      (d) => dopplerAlpha(d.angle) * p.disk.alpha);
    drawOrbitDots(photonDots, 'photon', false, () => PHOTON_RGB,
      (d) => 0.65 + (Math.sin(time * 0.08 + d.angle * 2) + 1) * 0.2);

    for (const star of fieldStars) {
      updateFieldStar(star, holeR, p);
      const edgeR = holeR * p.blackHole.radiusScale * HOLE_EDGE_OUTER;
      let x;
      let y;
      let alpha;
      if (star.dist > edgeR * 1.08) {
        x = cx + Math.cos(star.angle) * star.dist;
        y = cy + Math.sin(star.angle) * star.dist;
        const t = 1 - Math.min(1, (star.dist - edgeR) / (holeR * 2.2));
        alpha = 0.1 + t * 0.22;
      } else {
        ({ x, y } = starOnBoundary(cx, cy, holeR, star, time, p));
        alpha = 0.2 + (Math.sin(time * 0.035 + star.twinkle) + 1) * 0.14;
      }
      if (alpha < 0.06) continue;
      drawDot(ctx, x, y, dotSize(star.sizeBase, p, p.field.dotSize), STAR_RGB, alpha);
    }

    for (const arc of arcStars) {
      arc.angle += arc.driftBase * p.arc.drift;
      const wobble = Math.sin(time * 0.045 + arc.phase) * holeR * 0.035;
      const r = holeR * p.blackHole.radiusScale * arc.radiusBase * p.arc.radiusScale + wobble;
      const x = cx + Math.cos(arc.angle) * r;
      const y = cy + Math.sin(arc.angle) * r;
      const alpha = 0.24 + (Math.sin(time * 0.05 + arc.phase) + 1) * 0.14;
      drawDot(ctx, x, y, dotSize(arc.sizeBase, p, p.arc.dotSize), STAR_RGB, alpha);
    }

    for (const star of inflowStars) {
      updateInflowStar(star, holeR, time, p);
      let x;
      let y;
      let alpha;
      let rgb = STAR_RGB;
      if (star.state === 'approach') {
        x = cx + Math.cos(star.angle) * star.dist;
        y = cy + Math.sin(star.angle) * star.dist;
        const t = 1 - Math.min(1, (star.dist - holeR) / (holeR * 2.5));
        alpha = 0.12 + t * 0.35;
      } else if (star.state === 'slide') {
        ({ x, y } = starOnBoundary(cx, cy, holeR, star, time, p));
        rgb = diskRgb(star.angle);
        alpha = dopplerAlpha(star.angle) * (0.9 + (Math.sin(time * 0.06 + star.twinkle) + 1) * 0.1);
      } else {
        x = cx + Math.cos(star.angle) * star.dist;
        y = cy + Math.sin(star.angle) * star.dist;
        const t = Math.min(1, (star.dist - holeR * p.blackHole.radiusScale * HOLE_EDGE_OUTER) / (holeR * 2));
        alpha = 0.5 * (1 - t * 0.85);
      }
      if (alpha < 0.06) continue;
      drawDot(ctx, x, y, dotSize(star.sizeBase, p, p.inflow.dotSize), rgb, alpha);
    }

    for (const star of boundaryStars) {
      star.angle += star.baseSpeed * p.boundary.speed;
      const { x, y } = starOnBoundary(cx, cy, holeR, star, time, p);
      const twinkle = 0.85 + (Math.sin(time * 0.04 + star.twinkle) + 1) * 0.1;
      const alpha = dopplerAlpha(star.angle) * twinkle;
      drawDot(ctx, x, y, dotSize(star.sizeBase, p, p.boundary.dotSize), diskRgb(star.angle), alpha);
    }

    drawBlackHole(ctx, cx, cy, bhR, bgColor);

    drawOrbitDots(diskDots, 'disk', true, (d) => diskRgb(d.angle),
      (d) => dopplerAlpha(d.angle) * p.disk.alpha);
    drawOrbitDots(photonDots, 'photon', true, () => PHOTON_RGB,
      (d) => 0.65 + (Math.sin(time * 0.08 + d.angle * 2) + 1) * 0.2);
  }

  resize();

  return { tick, resize, setColor, setEnabled, getParams, setParams };
}