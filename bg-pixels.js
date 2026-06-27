/** Lightweight viewport background pixels: radial drift + elliptical orbits. */

const COUNT = 30;
const ORBIT_COUNT = 2;
const LARGE_ORBIT_COUNT = 2;
const SCREEN_REACH = 0.9;
const DRIFT_RGB = [130, 148, 175];
const ORBIT_COLORS_RGB = [
  [107, 155, 209],
  [210, 140, 190],
  [115, 215, 175],
];
const ORBIT_COLORS = ORBIT_COLORS_RGB.map(
  ([r, g, b]) => `rgba(${r}, ${g}, ${b}, 0.75)`,
);
const DEBRIS_PER_HIT = 2;
const MAX_DEBRIS = 120;
const PIXEL_SIZE_SCALE = 5 / 3;
const SLOW_AFTER_MS = 10_000;
const MIN_SPEED_FACTOR = 0.12;
const SLOW_RATE = 0.06;

function survivalSpeedFactor(bornAt, now = performance.now()) {
  const age = now - bornAt;
  if (age <= SLOW_AFTER_MS) return 1;
  const extraSec = (age - SLOW_AFTER_MS) / 1000;
  return Math.max(MIN_SPEED_FACTOR, 1 - extraSec * SLOW_RATE);
}

function spawnParticle() {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: (Math.random() - 0.5) * 8,
    y: (Math.random() - 0.5) * 8,
    vx: Math.cos(angle),
    vy: Math.sin(angle),
    baseSpeed: (0.22 + Math.random() * 0.38) * 1,
    bornAt: performance.now(),
    life: 0,
    maxLife: 1920 + Math.random() * 2400,
    baseSize: (Math.random() > 0.65 ? 2 : 1) * PIXEL_SIZE_SCALE,
  };
}

function circlesOverlap(ax, ay, as, bx, by, bs) {
  const r = as * 0.5 + bs * 0.5;
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < r * r;
}

function orbitPosition(o) {
  const cosA = Math.cos(o.angle);
  const sinA = Math.sin(o.angle);
  const ex = o.rx * cosA;
  const ey = o.ry * sinA;
  const cosR = Math.cos(o.rotation);
  const sinR = Math.sin(o.rotation);
  return {
    x: ex * cosR - ey * sinR,
    y: ex * sinR + ey * cosR,
  };
}

function orbitVelocity(o, speed) {
  const cosA = Math.cos(o.angle);
  const sinA = Math.sin(o.angle);
  const cosR = Math.cos(o.rotation);
  const sinR = Math.sin(o.rotation);
  return {
    vx: (-o.rx * sinA * cosR - o.ry * cosA * sinR) * speed,
    vy: (-o.rx * sinA * sinR + o.ry * cosA * cosR) * speed,
  };
}

function spawnOrbit(base, index, large = false) {
  const reach = base * 0.5 * SCREEN_REACH;
  const rMin = large ? base * 0.18 : base * 0.06;
  const rMax = large ? reach : base * 0.2;
  const rgb = large
    ? DRIFT_RGB
    : ORBIT_COLORS_RGB[index % ORBIT_COLORS_RGB.length];

  let rx = rMin + Math.random() * (rMax - rMin);
  let ry = rMin + Math.random() * (rMax - rMin);
  if (large) {
    ry = rx / 3;
  }

  const angular = (0.004 + Math.random() * 0.005) * 1.5;
  const baseSpeed = (large ? angular / 5 : angular / 2) * (Math.random() > 0.5 ? 1 : -1);

  return {
    rx,
    ry,
    rotation: Math.random() * Math.PI,
    angle: Math.random() * Math.PI * 2,
    baseSpeed,
    bornAt: performance.now(),
    size: 6 * PIXEL_SIZE_SCALE,
    large,
    color: large
      ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.5)`
      : ORBIT_COLORS[index % ORBIT_COLORS.length],
    rgb,
  };
}

function initOrbits(base) {
  const list = Array.from({ length: ORBIT_COUNT }, (_, i) => spawnOrbit(base, i, false));
  for (let i = 0; i < LARGE_ORBIT_COUNT; i++) {
    list.push(spawnOrbit(base, i, true));
  }
  return list;
}

function respawnOrbit(base, index) {
  return index < ORBIT_COUNT
    ? spawnOrbit(base, index, false)
    : spawnOrbit(base, index - ORBIT_COUNT, true);
}

function burstDebris(debris, x, y, vx, vy, rgb) {
  const speed = Math.hypot(vx, vy) || 1;
  const nx = vx / speed;
  const ny = vy / speed;

  for (let i = 0; i < DEBRIS_PER_HIT; i++) {
    if (debris.length >= MAX_DEBRIS) debris.shift();

    const spread = (Math.random() - 0.5) * 0.7;
    let px = nx - ny * spread;
    let py = ny + nx * spread;
    const len = Math.hypot(px, py) || 1;
    px /= len;
    py /= len;

    const mag = (speed * (0.35 + Math.random() * 0.85) + 0.4) * 0.5;
    debris.push({
      x,
      y,
      vx: px * mag,
      vy: py * mag,
      life: 0,
      maxLife: 48 + ((Math.random() * 54) | 0),
      size: 3 * PIXEL_SIZE_SCALE,
      rgb,
    });
  }
}

export function createBgPixels(canvas, viewport) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let w = 0;
  let h = 0;
  let maxDist = 1;
  let bgColor = '#1a1d23';
  let enabled = true;
  let visible = document.visibilityState === 'visible';
  const particles = Array.from({ length: COUNT }, spawnParticle);
  const debris = [];
  let orbits = [];

  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
  });

  function resize() {
    w = viewport.clientWidth;
    h = viewport.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    maxDist = Math.hypot(w, h) * 0.52;
    orbits = initOrbits(Math.min(w, h));
    debris.length = 0;
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

  function tick() {
    if (!enabled || !visible || w <= 0 || h <= 0) return;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const base = Math.min(w, h);
    const bodies = [];
    const drifts = [];
    const orbitViews = [];
    const deadDrift = new Set();
    const deadOrbit = new Set();
    const bursted = new Set();
    const now = performance.now();

    for (let i = 0; i < COUNT; i++) {
      const p = particles[i];
      p.life += 1;
      const speed = p.baseSpeed * survivalSpeedFactor(p.bornAt, now);
      p.x += p.vx * speed;
      p.y += p.vy * speed;

      const dist = Math.hypot(p.x, p.y);
      const fade = 1 - (dist / maxDist) ** 1.2;

      if (p.life >= p.maxLife || fade <= 0.03) {
        particles[i] = spawnParticle();
        continue;
      }

      const progress = Math.min(1, dist / maxDist);
      const size = p.baseSize * (1 + progress * 4);
      const sx = cx + p.x;
      const sy = cy + p.y;
      const vx = p.vx * speed;
      const vy = p.vy * speed;

      bodies.push({ kind: 'drift', index: i, x: sx, y: sy, size, vx, vy, rgb: DRIFT_RGB });
      drifts.push({ index: i, sx, sy, size, fade });
    }

    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i];
      if (!o) continue;

      const speed = o.baseSpeed * survivalSpeedFactor(o.bornAt, now);
      o.angle += speed;
      const pos = orbitPosition(o);
      const vel = orbitVelocity(o, speed);
      const sx = cx + pos.x;
      const sy = cy + pos.y;

      bodies.push({
        kind: 'orbit',
        index: i,
        x: sx,
        y: sy,
        size: o.size,
        vx: vel.vx,
        vy: vel.vy,
        rgb: o.rgb,
      });
      orbitViews.push({ index: i, o, sx, sy });
    }

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.kind === 'drift' && deadDrift.has(a.index)) continue;
      if (a.kind === 'orbit' && deadOrbit.has(a.index)) continue;

      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.kind === 'drift' && deadDrift.has(b.index)) continue;
        if (b.kind === 'orbit' && deadOrbit.has(b.index)) continue;

        if (!circlesOverlap(a.x, a.y, a.size, b.x, b.y, b.size)) continue;

        for (const body of [a, b]) {
          const key = `${body.kind}:${body.index}`;
          if (bursted.has(key)) continue;
          bursted.add(key);
          burstDebris(debris, body.x, body.y, body.vx, body.vy, body.rgb);
        }

        if (a.kind === 'drift') deadDrift.add(a.index);
        else deadOrbit.add(a.index);
        if (b.kind === 'drift') deadDrift.add(b.index);
        else deadOrbit.add(b.index);
      }
    }

    for (const i of deadDrift) particles[i] = spawnParticle();
    for (const i of deadOrbit) orbits[i] = respawnOrbit(base, i);

    for (const d of drifts) {
      if (deadDrift.has(d.index)) continue;
      const half = d.size * 0.5;
      ctx.fillStyle = `rgba(130, 148, 175, ${d.fade * 0.58})`;
      ctx.fillRect((d.sx - half) | 0, (d.sy - half) | 0, d.size, d.size);
    }

    for (const v of orbitViews) {
      if (deadOrbit.has(v.index)) continue;
      const half = v.o.size * 0.5;
      ctx.fillStyle = v.o.color;
      ctx.fillRect((v.sx - half) | 0, (v.sy - half) | 0, v.o.size, v.o.size);
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const f = debris[i];
      f.x += f.vx;
      f.y += f.vy;
      f.vx *= 0.94;
      f.vy *= 0.94;
      f.life += 1;

      if (f.life >= f.maxLife) {
        debris.splice(i, 1);
        continue;
      }

      const alpha = (1 - f.life / f.maxLife) * 0.75;
      const half = f.size * 0.5;
      const [r, g, b] = f.rgb;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect((f.x - half) | 0, (f.y - half) | 0, f.size, f.size);
    }
  }

  resize();

  return { tick, resize, setColor, setEnabled };
}