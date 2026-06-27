const THUMB_SIZE = 44;

function moveChildren(from, to) {
  while (from.children.length > 0) {
    to.add(from.children[0]);
  }
}

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

function shortName(name, max = 10) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1)}…`;
}

export function captureModelThumbnail(THREE, modelGroup) {
  if (!modelGroup?.children?.length) return null;

  const thumbRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.setClearColor(0x1a1d23, 1);

  const thumbScene = new THREE.Scene();
  thumbScene.background = new THREE.Color(0x1a1d23);
  thumbScene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(2.5, 3.5, 4);
  thumbScene.add(dir);

  const clone = modelGroup.clone(true);
  thumbScene.add(clone);

  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  clone.position.sub(center);

  const cam = new THREE.PerspectiveCamera(32, 1, maxDim * 0.01, maxDim * 200);
  const dist = maxDim * 1.75;
  cam.position.set(dist * 0.72, -dist * 0.68, dist * 0.58);
  cam.lookAt(0, 0, 0);

  thumbRenderer.render(thumbScene, cam);
  const dataUrl = thumbRenderer.domElement.toDataURL('image/jpeg', 0.84);
  thumbRenderer.dispose();
  disposeObject3D(clone);
  return dataUrl;
}

export function initModelTabs({
  t,
  THREE,
  modelGroup,
  maxTabs = 4,
  captureThumbnail,
  getState,
  applyState,
}) {
  const root = document.getElementById('model-tabs');
  const list = document.getElementById('model-tabs-list');
  if (!root || !list) return null;

  /** @type {Array<any>} */
  const sessions = [];
  let activeId = null;
  let switching = false;

  function findSession(id) {
    return sessions.find((s) => s.id === id) || null;
  }

  function disposeSession(session) {
    if (!session) return;
    disposeObject3D(session.holder);
    while (session.holder.children.length > 0) {
      session.holder.remove(session.holder.children[0]);
    }
  }

  function trimSessions() {
    while (sessions.length > maxTabs) {
      const victim = sessions.find((s) => s.id !== activeId) || sessions[sessions.length - 1];
      if (!victim) break;
      const idx = sessions.indexOf(victim);
      if (idx >= 0) sessions.splice(idx, 1);
      disposeSession(victim);
    }
  }

  function renderTabs() {
    list.innerHTML = '';
    if (!sessions.length) {
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');

    for (const session of sessions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `model-tab${session.id === activeId ? ' active' : ''}`;
      btn.title = session.name;
      btn.setAttribute('aria-label', session.name);
      btn.dataset.id = session.id;

      const label = document.createElement('span');
      label.className = 'model-tab-label';
      label.textContent = shortName(session.name);

      if (session.thumbnail) {
        const img = document.createElement('img');
        img.className = 'model-tab-thumb';
        img.alt = '';
        img.width = THUMB_SIZE;
        img.height = THUMB_SIZE;
        img.src = session.thumbnail;
        img.loading = 'lazy';
        btn.append(img, label);
      } else {
        const ph = document.createElement('span');
        ph.className = 'model-tab-thumb model-tab-thumb-fallback';
        ph.textContent = (session.ext || '3d').slice(0, 3).toUpperCase();
        btn.append(ph, label);
      }
      btn.addEventListener('click', () => {
        if (session.id !== activeId) switchTo(session.id);
      });
      list.appendChild(btn);
    }
  }

  function snapshotFromState(state, holder, thumbnail) {
    return {
      id: state.id,
      name: state.file.name,
      ext: state.file.ext,
      file: {
        name: state.file.name,
        ext: state.file.ext,
        buffer: state.file.buffer,
      },
      thumbnail: thumbnail || state.thumbnail || null,
      holder,
      is2d: state.is2d,
      viewMode: state.viewMode,
      modelPosition: state.modelPosition,
      modelRotation: state.modelRotation,
      initialCameraState: state.initialCameraState,
      gridSize: state.gridSize,
      orthoViewSize: state.orthoViewSize,
      orthoBounds: state.orthoBounds,
      cameraPosition: state.cameraPosition,
      cameraNear: state.cameraNear,
      cameraFar: state.cameraFar,
    };
  }

  function upsertSession(snapshot) {
    const idx = sessions.findIndex((s) => s.id === snapshot.id);
    if (idx >= 0) {
      const prev = sessions[idx];
      if (prev.id !== activeId && prev.holder !== snapshot.holder) {
        disposeSession(prev);
      }
      sessions.splice(idx, 1);
    }
    sessions.unshift(snapshot);
    trimSessions();
    activeId = snapshot.id;
    renderTabs();
  }

  function stashCurrent() {
    if (switching) return;
    const state = getState?.();
    if (!state?.file || modelGroup.children.length === 0) return;

    const existing = activeId ? findSession(activeId) : null;
    const holder = existing?.holder || new THREE.Group();
    moveChildren(modelGroup, holder);

    const thumb = captureThumbnail?.(holder) || existing?.thumbnail || null;
    const snapshot = snapshotFromState(
      { ...state, id: existing?.id || state.id, thumbnail: thumb },
      holder,
      thumb,
    );
    upsertSession(snapshot);
  }

  function registerLoaded() {
    if (switching) return;
    const state = getState?.();
    if (!state?.file || modelGroup.children.length === 0) return;

    const thumb = captureThumbnail?.(modelGroup) || null;
    const holder = new THREE.Group();
    const snapshot = snapshotFromState(
      { ...state, id: `${state.file.name}-${Date.now()}`, thumbnail: thumb },
      holder,
      thumb,
    );
    upsertSession(snapshot);
  }

  async function switchTo(id) {
    if (switching || id === activeId) return;
    const target = findSession(id);
    if (!target) return;

    switching = true;
    try {
      const state = getState?.();
      if (state?.file && modelGroup.children.length > 0 && activeId) {
        const current = findSession(activeId);
        const holder = current?.holder || new THREE.Group();
        moveChildren(modelGroup, holder);
        const thumb = captureThumbnail?.(holder) || current?.thumbnail || null;
        const snapshot = snapshotFromState(
          { ...state, id: activeId, thumbnail: thumb },
          holder,
          thumb,
        );
        const idx = sessions.findIndex((s) => s.id === activeId);
        if (idx >= 0) sessions[idx] = snapshot;
      }

      moveChildren(target.holder, modelGroup);
      activeId = id;
      applyState?.(target);
      renderTabs();
    } finally {
      switching = false;
    }
  }

  function clearAll() {
    for (const session of sessions) disposeSession(session);
    sessions.length = 0;
    activeId = null;
    renderTabs();
  }

  function removeActive() {
    if (!activeId) return;
    const idx = sessions.findIndex((s) => s.id === activeId);
    if (idx < 0) return;
    const [removed] = sessions.splice(idx, 1);
    disposeSession(removed);
    activeId = null;
    renderTabs();
  }

  root.setAttribute('aria-label', t('modelTabsAria'));
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => e.stopPropagation());

  return {
    stashCurrent,
    registerLoaded,
    switchTo,
    clearAll,
    removeActive,
    getActiveId: () => activeId,
    hasSessions: () => sessions.length > 0,
  };
}