const LAYOUT_GAP = 1.25;

function shortName(name, max = 18) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1)}…`;
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

function getEntryBox(THREE, entry) {
  const box = new THREE.Box3().setFromObject(entry.group);
  if (box.isEmpty()) return null;
  return box;
}

export function initMultiModelView({
  t,
  THREE,
  modelGroup,
  onActiveChange,
  onLayoutChange,
}) {
  const panel = document.getElementById('multi-model-panel');
  const list = document.getElementById('multi-model-list');
  if (!panel || !list) return null;

  /** @type {Array<{id:string,name:string,ext:string,group:THREE.Group,buffer:ArrayBuffer,visible:boolean,is2d:boolean}>} */
  const entries = [];
  let activeId = null;

  function findEntry(id) {
    return entries.find((e) => e.id === id) || null;
  }

  function centerEntryContents(entry) {
    const box = getEntryBox(THREE, entry);
    if (!box) return;
    const center = box.getCenter(new THREE.Vector3());
    entry.group.children.forEach((child) => {
      child.position.sub(center);
    });
  }

  function layout() {
    if (entries.length === 0) return;

    let cursor = 0;
    for (const entry of entries) {
      if (!entry.visible) {
        entry.group.visible = false;
        continue;
      }
      entry.group.visible = true;
      const box = getEntryBox(THREE, entry);
      if (!box) continue;
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 0.001);
      entry.group.position.set(cursor + span * 0.5, 0, 0);
      cursor += span * LAYOUT_GAP;
    }
    onLayoutChange?.();
  }

  function renderList() {
    list.innerHTML = '';
    if (!entries.length) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = `multi-model-item${entry.id === activeId ? ' active' : ''}`;
      row.dataset.id = entry.id;

      const visBtn = document.createElement('button');
      visBtn.type = 'button';
      visBtn.className = 'multi-model-vis';
      visBtn.title = entry.visible ? t('multiModelHide') : t('multiModelShow');
      visBtn.setAttribute('aria-label', visBtn.title);
      visBtn.innerHTML = entry.visible
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        entry.visible = !entry.visible;
        layout();
        renderList();
      });

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'multi-model-name';
      label.textContent = shortName(entry.name);
      label.title = entry.name;
      label.addEventListener('click', () => setActive(entry.id));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'multi-model-remove';
      removeBtn.title = t('multiModelRemove');
      removeBtn.setAttribute('aria-label', t('multiModelRemove'));
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeEntry(entry.id);
      });

      row.append(visBtn, label, removeBtn);
      list.appendChild(row);
    }
  }

  function setActive(id) {
    const entry = findEntry(id);
    if (!entry) return;
    activeId = id;
    renderList();
    onActiveChange?.(entry);
  }

  function addEntry(group, meta) {
    const id = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    group.userData.multiModelEntry = true;
    group.userData.multiModelId = id;

    const entry = {
      id,
      name: meta.name,
      ext: meta.ext,
      buffer: meta.buffer,
      group,
      visible: true,
      is2d: !!meta.is2d,
    };

    centerEntryContents(entry);
    modelGroup.add(group);
    entries.push(entry);
    activeId = id;
    layout();
    renderList();
    onActiveChange?.(entry);
    return entry;
  }

  function removeEntry(id) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [removed] = entries.splice(idx, 1);
    modelGroup.remove(removed.group);
    disposeObject3D(removed.group);
    if (activeId === id) {
      activeId = entries.length ? entries[entries.length - 1].id : null;
      const next = activeId ? findEntry(activeId) : null;
      onActiveChange?.(next);
    }
    layout();
    renderList();
    return removed;
  }

  function clear() {
    for (const entry of entries) {
      modelGroup.remove(entry.group);
      disposeObject3D(entry.group);
    }
    entries.length = 0;
    activeId = null;
    renderList();
  }

  function hasMultiple() {
    return entries.length > 1;
  }

  function getActiveEntry() {
    return activeId ? findEntry(activeId) : entries[0] || null;
  }

  function getVisibleEntries() {
    return entries.filter((e) => e.visible);
  }

  function getEntryGroups() {
    return entries.map((e) => e.group);
  }

  return {
    addEntry,
    removeEntry,
    setActive,
    clear,
    layout,
    hasMultiple,
    getActiveEntry,
    getVisibleEntries,
    getEntryGroups,
    getCount: () => entries.length,
    isEmpty: () => entries.length === 0,
  };
}