const LAYER_PALETTE = {
  MODEL_GEOM: '#e8eaed',
  OUTLINE: '#00e5ff',
  DIMENSION: '#ffd54f',
  VIEW_LABEL: '#69f0ae',
  0: '#e8eaed',
};

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

  function buildEntries(mode) {
    const entries = [];
    if (mode === 'layers') {
      modelGroup.traverse((child) => {
        if (child.userData?.layerName && child.isGroup && child.parent === modelGroup) {
          entries.push({
            id: child.uuid,
            label: child.userData.layerName,
            object: child,
            visible: child.visible,
          });
        }
      });
      if (!entries.length) {
        entries.push({
          id: modelGroup.uuid,
          label: '0',
          object: modelGroup,
          visible: modelGroup.visible,
        });
      }
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

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'tree-item';

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