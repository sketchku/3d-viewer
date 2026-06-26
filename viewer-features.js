import * as THREE from 'three';

const _vec = new THREE.Vector3();
const _box = new THREE.Box3();

export function initViewerFeatures(ctx) {
  const {
    scene, camera, controls, renderer, canvas, modelGroup,
    getViewMode, getActiveCamera, t, showToast, downloadBlob,
  } = ctx;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const measureGroup = new THREE.Group();
  measureGroup.name = 'measurements';
  scene.add(measureGroup);

  let measureMode = false;
  let measureType = 'direct';
  let measurePoints = [];
  let sectionEnabled = false;
  let sectionAxis = 'z';
  let sectionPos = 0;
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

  renderer.localClippingEnabled = true;

  function getModelSize() {
    if (modelGroup.children.length === 0) return 10;
    _box.setFromObject(modelGroup);
    const size = _box.getSize(_vec);
    return Math.max(size.x, size.y, size.z, 1);
  }

  function getModelCenter() {
    _box.setFromObject(modelGroup);
    return _box.getCenter(new THREE.Vector3());
  }

  function animateCameraTo(position, target, up) {
    if (getViewMode() !== '3d') return;
    const cam = getActiveCamera();
    const startPos = cam.position.clone();
    const startTarget = controls.target.clone();
    const endPos = position.clone();
    const endTarget = target.clone();
    const duration = 400;
    const start = performance.now();

    function step(now) {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - (1 - p) ** 3;
      cam.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      if (up) cam.up.copy(up);
      cam.lookAt(controls.target);
      controls.update();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setStandardView(view) {
    if (getViewMode() !== '3d' || modelGroup.children.length === 0) return;
    const center = getModelCenter();
    const size = getModelSize();
    const dist = size * 2.2;
    const up = new THREE.Vector3(0, 0, 1);

    const positions = {
      top: new THREE.Vector3(center.x, center.y, center.z + dist),
      front: new THREE.Vector3(center.x, center.y - dist, center.z),
      right: new THREE.Vector3(center.x + dist, center.y, center.z),
      iso: new THREE.Vector3(
        center.x + dist * 0.75,
        center.y - dist * 0.75,
        center.z + dist * 0.6,
      ),
    };

    const pos = positions[view];
    if (!pos) return;
    animateCameraTo(pos, center, up);
  }

  function captureScreenshot() {
    renderer.render(scene, getActiveCamera());
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const base = ctx.getFilenameBase?.() || 'screenshot';
    downloadBlob(dataUrlToBlob(dataUrl), `${base}_screenshot.png`);
    showToast(t('screenshotSaved'), 'success');
  }

  function dataUrlToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bytes = atob(data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function clearMeasurements() {
    while (measureGroup.children.length) {
      const child = measureGroup.children[0];
      measureGroup.remove(child);
      child.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    measurePoints = [];
    document.getElementById('measure-result')?.classList.add('hidden');
  }

  const ORTHO_COLORS = { x: 0xff6666, y: 0x66cc66, z: 0x6699ff };

  function getOrthoAxis(type) {
    if (type === 'ortho-x') return 'x';
    if (type === 'ortho-y') return 'y';
    if (type === 'ortho-z' || type === 'vertical') return 'z';
    return null;
  }

  function getOrthoEndPoint(a, b, axis) {
    if (axis === 'x') return new THREE.Vector3(b.x, a.y, a.z);
    if (axis === 'y') return new THREE.Vector3(a.x, b.y, a.z);
    return new THREE.Vector3(a.x, a.y, b.z);
  }

  function computeMeasure(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return {
      dx,
      dy,
      dz,
      orthoX: Math.abs(dx),
      orthoY: Math.abs(dy),
      orthoZ: Math.abs(dz),
      direct: a.distanceTo(b),
    };
  }

  function getPrimaryValue(data, type) {
    const axis = getOrthoAxis(type);
    if (axis === 'x') return data.orthoX;
    if (axis === 'y') return data.orthoY;
    if (axis === 'z') return data.orthoZ;
    return data.direct;
  }

  function getPrimaryLabelKey(type) {
    const axis = getOrthoAxis(type);
    if (axis === 'x') return 'measurePrimaryOrthoX';
    if (axis === 'y') return 'measurePrimaryOrthoY';
    if (axis === 'z') return 'measurePrimaryOrthoZ';
    return 'measurePrimary';
  }

  function formatMm(value) {
    return `${value.toFixed(2)} mm`;
  }

  function updateMeasureResultPanel(data) {
    const panel = document.getElementById('measure-result');
    const primaryEl = document.getElementById('measure-val-primary');
    const dxEl = document.getElementById('measure-val-dx');
    const dyEl = document.getElementById('measure-val-dy');
    const dzEl = document.getElementById('measure-val-dz');
    const primaryLabel = panel?.querySelector('[data-i18n="measurePrimary"]');
    if (!panel || !primaryEl || !dxEl || !dyEl || !dzEl) return;

    if (primaryLabel) {
      primaryLabel.textContent = t(getPrimaryLabelKey(measureType));
    }
    primaryEl.textContent = formatMm(getPrimaryValue(data, measureType));
    dxEl.textContent = formatMm(data.dx);
    dyEl.textContent = formatMm(data.dy);
    dzEl.textContent = formatMm(data.dz);
    panel.classList.remove('hidden');
  }

  function addMarker(point) {
    const geo = new THREE.SphereGeometry(getModelSize() * 0.008, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    mesh.renderOrder = 999;
    measureGroup.add(mesh);
    return mesh;
  }

  function addLine(a, b, color = 0xffcc00, opacity = 1) {
    const positions = [a.x, a.y, a.z, b.x, b.y, b.z];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }),
    );
    line.renderOrder = 998;
    measureGroup.add(line);
    return line;
  }

  function addMeasureLabel(lines, position) {
    const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
    const size = getModelSize() * 0.045;
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d');
    const px = 36;
    const lineHeight = px + 6;
    const rows = text.split('\n');
    ctx2d.font = `bold ${px}px Arial, sans-serif`;
    const w = Math.max(...rows.map((row) => ctx2d.measureText(row).width)) + 20;
    canvas.width = w;
    canvas.height = lineHeight * rows.length + 8;
    ctx2d.font = `bold ${px}px Arial, sans-serif`;
    ctx2d.fillStyle = 'rgba(15,17,23,0.88)';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = '#ffcc00';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    rows.forEach((row, i) => {
      ctx2d.fillText(row, canvas.width / 2, 6 + lineHeight * i + lineHeight / 2);
    });

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.position.copy(position);
    sprite.scale.set(size * (canvas.width / canvas.height), size, 1);
    sprite.renderOrder = 1000;
    measureGroup.add(sprite);
    return sprite;
  }

  function addCoordinateGuides(a, b, data) {
    const pX = new THREE.Vector3(b.x, a.y, a.z);
    const pY = new THREE.Vector3(b.x, b.y, a.z);
    if (Math.abs(data.dx) > 1e-6) addLine(a, pX, 0xff6666, 0.55);
    if (Math.abs(data.dy) > 1e-6) addLine(pX, pY, 0x66cc66, 0.55);
    if (Math.abs(data.dz) > 1e-6) addLine(pY, b, 0x6699ff, 0.55);
  }

  function addOrthoGuide(a, b, axis) {
    const end = getOrthoEndPoint(a, b, axis);
    addLine(a, end, ORTHO_COLORS[axis], 1);
    if (b.distanceTo(end) > 1e-6) {
      addLine(end, b, ORTHO_COLORS[axis], 0.3);
    }
  }

  function buildMeasureLabel(data) {
    const primary = getPrimaryValue(data, measureType);
    const primaryLabel = t(getPrimaryLabelKey(measureType));
    return [
      `${primaryLabel}: ${primary.toFixed(2)} mm`,
      `${t('measureDeltaX')}: ${data.dx.toFixed(2)} mm`,
      `${t('measureDeltaY')}: ${data.dy.toFixed(2)} mm`,
      `${t('measureDeltaZ')}: ${data.dz.toFixed(2)} mm`,
    ];
  }

  function completeMeasurement(a, b) {
    const data = computeMeasure(a, b);
    updateMeasureResultPanel(data);

    const orthoAxis = getOrthoAxis(measureType);
    if (orthoAxis) {
      addOrthoGuide(a, b, orthoAxis);
    } else {
      addLine(a, b, 0xffcc00, 1);
      addCoordinateGuides(a, b, data);
    }

    const mid = a.clone().add(b).multiplyScalar(0.5);
    addMeasureLabel(buildMeasureLabel(data), mid);
  }

  function onMeasureClick(event) {
    if (!measureMode || modelGroup.children.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.params.Line.threshold = getModelSize() * 0.02;
    raycaster.setFromCamera(pointer, getActiveCamera());
    const hits = raycaster.intersectObject(modelGroup, true);
    if (!hits.length) return;

    const point = hits[0].point.clone();
    measurePoints.push(point);
    addMarker(point);

    if (measurePoints.length === 2) {
      completeMeasurement(measurePoints[0], measurePoints[1]);
      measurePoints = [];
    }
  }

  function applySectionClip() {
    const normals = {
      x: new THREE.Vector3(-1, 0, 0),
      y: new THREE.Vector3(0, -1, 0),
      z: new THREE.Vector3(0, 0, -1),
    };
    clipPlane.normal.copy(normals[sectionAxis] || normals.z);
    clipPlane.constant = sectionPos;

    modelGroup.traverse((child) => {
      const drawable = child.isMesh || child.isLine || child.isLineSegments || child.isLineLoop;
      if (!drawable) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.clippingPlanes = sectionEnabled ? [clipPlane] : [];
        mat.clipShadows = sectionEnabled;
        mat.needsUpdate = true;
      }
    });
  }

  function updateSectionRange() {
    _box.setFromObject(modelGroup);
    const min = _box.min;
    const max = _box.max;
    const slider = document.getElementById('section-pos');
    if (!slider) return;

    const ranges = {
      x: [min.x, max.x],
      y: [min.y, max.y],
      z: [min.z, max.z],
    };
    const [lo, hi] = ranges[sectionAxis] || ranges.z;
    slider.min = lo.toFixed(2);
    slider.max = hi.toFixed(2);
    slider.step = ((hi - lo) / 100).toFixed(4);
    sectionPos = (lo + hi) / 2;
    slider.value = sectionPos;
    const label = document.getElementById('section-pos-val');
    if (label) label.textContent = `${sectionPos.toFixed(1)} mm`;
    applySectionClip();
  }

  function setMeasureControlsVisible(visible) {
    document.getElementById('measure-controls')?.classList.toggle('hidden', !visible);
    if (!visible) document.getElementById('measure-result')?.classList.add('hidden');
  }

  function bindUI() {
    document.getElementById('btn-view-top')?.addEventListener('click', () => setStandardView('top'));
    document.getElementById('btn-view-front')?.addEventListener('click', () => setStandardView('front'));
    document.getElementById('btn-view-right')?.addEventListener('click', () => setStandardView('right'));
    document.getElementById('btn-view-iso')?.addEventListener('click', () => setStandardView('iso'));
    document.getElementById('btn-screenshot')?.addEventListener('click', captureScreenshot);

    document.getElementById('toggle-measure')?.addEventListener('change', (e) => {
      measureMode = e.target.checked;
      canvas.style.cursor = measureMode ? 'crosshair' : '';
      setMeasureControlsVisible(measureMode);
      if (!measureMode) clearMeasurements();
    });

    document.getElementById('measure-type')?.addEventListener('change', (e) => {
      measureType = e.target.value;
      clearMeasurements();
    });

    document.getElementById('btn-clear-measure')?.addEventListener('click', clearMeasurements);

    document.getElementById('toggle-section')?.addEventListener('change', (e) => {
      sectionEnabled = e.target.checked;
      document.getElementById('section-controls')?.classList.toggle('hidden', !sectionEnabled);
      if (sectionEnabled && modelGroup.children.length) updateSectionRange();
      else applySectionClip();
    });

    document.getElementById('section-axis')?.addEventListener('change', (e) => {
      sectionAxis = e.target.value;
      if (sectionEnabled) updateSectionRange();
    });

    document.getElementById('section-pos')?.addEventListener('input', (e) => {
      sectionPos = parseFloat(e.target.value);
      const label = document.getElementById('section-pos-val');
      if (label) label.textContent = `${sectionPos.toFixed(1)} mm`;
      applySectionClip();
    });

    canvas.addEventListener('click', onMeasureClick);

    document.addEventListener('languagechange', () => {
      const panel = document.getElementById('measure-result');
      if (!panel || panel.classList.contains('hidden')) return;
      const primaryEl = document.getElementById('measure-val-primary');
      const dxEl = document.getElementById('measure-val-dx');
      const dyEl = document.getElementById('measure-val-dy');
      const dzEl = document.getElementById('measure-val-dz');
      const primaryLabel = panel.querySelector('[data-i18n="measurePrimary"]');
      if (primaryLabel) {
        primaryLabel.textContent = t(getPrimaryLabelKey(measureType));
      }
      if (primaryEl && dxEl && dyEl && dzEl) {
        [dxEl, dyEl, dzEl].forEach((el) => {
          const val = parseFloat(el.textContent);
          if (!Number.isNaN(val)) el.textContent = formatMm(val);
        });
        const primaryVal = parseFloat(primaryEl.textContent);
        if (!Number.isNaN(primaryVal)) primaryEl.textContent = formatMm(primaryVal);
      }
    });
  }

  bindUI();

  return {
    setStandardView,
    captureScreenshot,
    clearMeasurements,
    onModelLoaded() {
      clearMeasurements();
      sectionEnabled = document.getElementById('toggle-section')?.checked ?? false;
      if (sectionEnabled) updateSectionRange();
      else applySectionClip();
    },
    onModelCleared() {
      clearMeasurements();
      sectionEnabled = false;
      const toggle = document.getElementById('toggle-section');
      if (toggle) toggle.checked = false;
      document.getElementById('section-controls')?.classList.add('hidden');
      applySectionClip();
    },
  };
}