const LAYER_PALETTE = {
  MODEL_GEOM: '#e8eaed',
  OUTLINE: '#00e5ff',
  DIMENSION: '#ffd54f',
  VIEW_LABEL: '#69f0ae',
  0: '#e8eaed',
};

function isSketchLayer(name, object) {
  if (object?.userData?.isSketchLayer) return true;
  return /sketch|스케치|profile|refgeom|rough|wire|contour|outline/i.test(String(name || ''));
}

function readLayerColor(object, fallback = '#e8eaed') {
  let hex = null;
  object.traverse((child) => {
    if (hex || !child.material?.color) return;
    hex = `#${child.material.color.getHexString()}`;
  });
  return hex || fallback;
}

export function initPartTree({ modelGroup, t, THREE }) {
  const panel = document.getElementById('tree-panel');
  const title = document.getElementById('tree-panel-title');
  const list = document.getElementById('tree-list');
  if (!panel || !list) return { refresh: () => {}, clear: () => {} };

  const Color = THREE?.Color;

  function setLayerColor(object, hex) {
    if (!Color) return;
    const color = new Color(hex);
    object.traverse((child) => {
      if (!child.material?.color) return;
      child.material.color.copy(color);
      child.material.needsUpdate = true;
    });
  }

  function clear() {
    list.innerHTML = '';
    panel.classList.add('hidden');
  }

  function makeLayerEntry(child) {
    const layerName = child.userData.layerName;
    const label = child.userData?.dwgViewIndex
      ? t('dwgView', { n: child.userData.dwgViewIndex })
      : layerName;
    return {
      id: child.uuid,
      label,
      object: child,
      visible: child.visible,
      sketch: isSketchLayer(layerName, child),
      dwgEntity: !!child.userData?.isDwgEntityGroup,
      dwgViewIndex: child.userData?.dwgViewIndex || 0,
    };
  }

  function collectLayerEntries() {
    const entries = [];
    const seen = new Set();
    for (const child of modelGroup.children) {
      if (child.isGroup && child.userData?.layerName && !seen.has(child.uuid)) {
        seen.add(child.uuid);
        entries.push(makeLayerEntry(child));
      }
      if (!child.isGroup) continue;
      for (const nested of child.children) {
        if (!nested.isGroup || !nested.userData?.layerName || seen.has(nested.uuid)) continue;
        seen.add(nested.uuid);
        entries.push(makeLayerEntry(nested));
      }
    }
    return entries;
  }

  function buildEntries(mode) {
    const entries = [];
    if (mode === 'layers') {
      entries.push(...collectLayerEntries());
      if (!entries.length) {
        entries.push({
          id: modelGroup.uuid,
          label: '0',
          object: modelGroup,
          visible: modelGroup.visible,
          sketch: false,
          dwgEntity: false,
          dwgViewIndex: 0,
        });
      }
      entries.sort((a, b) => {
        if (a.dwgEntity !== b.dwgEntity) return a.dwgEntity ? -1 : 1;
        if (a.dwgEntity && b.dwgEntity) return a.dwgViewIndex - b.dwgViewIndex;
        if (a.sketch !== b.sketch) return a.sketch ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
    } else {
      let idx = 0;
      modelGroup.traverse((child) => {
        if (child.isMesh || child.isLine || child.isLineSegments || child.isLineLoop) {
          const name = child.userData?.partName || child.name || t('partDefault', { n: ++idx });
          entries.push({
            id: child.uuid,
            label: name,
            object: child,
            visible: child.visible,
          });
        }
      });
    }
    return entries;
  }

  function refresh(mode = 'parts') {
    list.innerHTML = '';
    if (modelGroup.children.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    const entries = buildEntries(mode);
    if (!entries.length) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    if (title) {
      title.textContent = mode === 'layers' ? t('layerPanel') : t('partTree');
      title.dataset.i18n = mode === 'layers' ? 'layerPanel' : 'partTree';
    }

    const isLayerMode = mode === 'layers';
    let lastSection = null;

    for (const entry of entries) {
      if (isLayerMode) {
        const section = entry.dwgEntity ? 'dwg' : entry.sketch ? 'sketch' : 'other';
        if (section !== lastSection) {
          const hdr = document.createElement('div');
          hdr.className = `tree-section-title${section === 'sketch' ? ' tree-section-sketch' : ''}`;
          hdr.textContent = section === 'dwg'
            ? t('dwgEntitySection')
            : section === 'sketch'
              ? t('layerSketchSection')
              : t('layerOtherSection');
          list.appendChild(hdr);
          lastSection = section;
        }
      }

      const row = document.createElement('div');
      row.className = `tree-item${entry.sketch ? ' tree-item-sketch' : ''}${entry.dwgEntity ? ' tree-item-dwg' : ''}`;

      const cbLabel = document.createElement('label');
      cbLabel.className = 'tree-item-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = entry.visible;
      cb.addEventListener('change', () => {
        entry.object.visible = cb.checked;
      });
      const span = document.createElement('span');
      span.textContent = entry.label;
      span.title = entry.label;
      cbLabel.append(cb, span);

      row.appendChild(cbLabel);

      if (isLayerMode && Color) {
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.className = 'tree-layer-color';
        swatch.value = readLayerColor(entry.object, LAYER_PALETTE[entry.label] || '#e8eaed');
        swatch.title = t('layerColor');
        swatch.addEventListener('input', (e) => {
          setLayerColor(entry.object, e.target.value);
        });
        row.appendChild(swatch);
      }

      list.appendChild(row);
    }
  }

  return { refresh, clear };
}

export function tagPart(mesh, name, index) {
  mesh.userData.partName = name || `Part ${index + 1}`;
  mesh.name = mesh.userData.partName;
}