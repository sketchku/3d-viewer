const HIGHLIGHT = 0xffa726;
const SKIP_NAMES = new Set(['measurements', 'selection-helper']);
const DRAG_THRESHOLD = 4;

function isLayerGroup(obj) {
  return obj?.isGroup && !!obj.userData?.layerName;
}

function isSelectableObject(obj) {
  if (!obj || obj.userData?.nonSelectable) return false;
  if (SKIP_NAMES.has(obj.name)) return false;
  return obj.isMesh || obj.isLine || obj.isLineSegments || obj.isLineLoop || obj.isSprite || isLayerGroup(obj);
}

function forHighlightTargets(obj, fn) {
  if (isLayerGroup(obj)) {
    obj.traverse((child) => {
      if (child !== obj && isSelectableObject(child) && !isLayerGroup(child)) fn(child);
    });
    if (!obj.children.length) fn(obj);
    return;
  }
  fn(obj);
}

function findSelectableRoot(obj) {
  let cur = obj;
  while (cur) {
    if (isSelectableObject(cur)) return cur;
    if (cur.userData?.multiModelEntry) return null;
    cur = cur.parent;
  }
  return null;
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export function initEditTools({
  THREE,
  canvas,
  controls,
  getActiveCamera,
  getViewMode,
  getModelRoot,
  getIs2d,
  t,
  showToast,
  onStructureChange,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const dragAnchor = new THREE.Vector3();
  const moveDelta = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  let editMode = false;
  let selected = new Set();
  let dragging = null;
  let pointerDown = null;
  let lastPointer = null;

  function isMeasureMode() {
    return document.getElementById('toggle-measure')?.checked;
  }

  function root() {
    return getModelRoot?.() || null;
  }

  function getPickRoot() {
    const r = root();
    return r?.parent || r;
  }

  function getModelSpan() {
    const pickRoot = getPickRoot();
    if (!pickRoot) return 10;
    const box = new THREE.Box3().setFromObject(pickRoot);
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 1);
  }

  function backupMaterial(obj) {
    if (!obj.material || obj.userData._selMat) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.userData._selMat = mats.map((m) => ({
      color: m.color?.clone?.(),
      emissive: m.emissive?.clone?.(),
      emissiveIntensity: m.emissiveIntensity,
    }));
  }

  function applyHighlight(obj, on) {
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const backups = obj.userData._selMat;
    mats.forEach((m, i) => {
      if (!m) return;
      if (on) {
        backupMaterial(obj);
        if (m.emissive) {
          m.emissive.setHex(HIGHLIGHT);
          m.emissiveIntensity = 0.45;
        } else if (m.color) {
          m.color.setHex(HIGHLIGHT);
        }
      } else if (backups?.[i]) {
        if (m.emissive && backups[i].emissive) {
          m.emissive.copy(backups[i].emissive);
          m.emissiveIntensity = backups[i].emissiveIntensity ?? 1;
        } else if (m.color && backups[i].color) {
          m.color.copy(backups[i].color);
        }
      }
      m.needsUpdate = true;
    });
    if (!on) delete obj.userData._selMat;
  }

  function highlightObject(obj, on) {
    forHighlightTargets(obj, (target) => applyHighlight(target, on));
  }

  function setSelection(objects, additive = false) {
    if (!additive) {
      for (const obj of selected) highlightObject(obj, false);
      selected.clear();
    }
    for (const obj of objects) {
      if (!obj) continue;
      selected.add(obj);
      highlightObject(obj, true);
    }
    updateSelectionUI();
  }

  function clearSelection() {
    setSelection([]);
  }

  function toggleSelection(obj, additive) {
    if (!obj) return;
    if (!additive) {
      if (selected.size === 1 && selected.has(obj)) return;
      setSelection([obj]);
      return;
    }
    const next = new Set(selected);
    if (next.has(obj)) {
      highlightObject(obj, false);
      next.delete(obj);
    } else {
      next.add(obj);
      highlightObject(obj, true);
    }
    selected = next;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const panel = document.getElementById('edit-selection-panel');
    const label = document.getElementById('edit-selection-label');
    const btnDelete = document.getElementById('btn-delete-selected');
    const count = selected.size;
    if (panel) panel.classList.toggle('hidden', !editMode || count === 0);
    if (btnDelete) btnDelete.disabled = count === 0;
    if (label) {
      if (count === 0) label.textContent = t('editNothingSelected');
      else if (count === 1) {
        const obj = [...selected][0];
        label.textContent = obj.userData?.partName
          || obj.userData?.layerName
          || obj.name
          || t('editSelectedItem');
      } else {
        label.textContent = t('editSelectedCount', { count });
      }
    }
    document.dispatchEvent(new CustomEvent('editselectionchange', {
      detail: { ids: [...selected].map((o) => o.uuid) },
    }));
  }

  function pickObject(event) {
    const pickRoot = getPickRoot();
    if (!pickRoot) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const span = getModelSpan();
    raycaster.params.Line = { threshold: span * 0.015 };
    raycaster.params.Points = { threshold: span * 0.02 };
    raycaster.setFromCamera(pointer, getActiveCamera());
    const hits = raycaster.intersectObject(pickRoot, true);
    for (const hit of hits) {
      const sel = findSelectableRoot(hit.object);
      if (sel) return sel;
    }
    return null;
  }

  function setupDragPlane(refObj) {
    const cam = getActiveCamera();
    cam.getWorldDirection(camDir);
    if (getIs2d?.() || getViewMode() === '2d') {
      dragPlane.set(new THREE.Vector3(0, 0, 1), -refObj.position.z);
    } else {
      const normal = camDir.clone().negate();
      dragPlane.setFromNormalAndCoplanarPoint(normal, refObj.position);
    }
  }

  function worldPointOnPlane(event, target) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, getActiveCamera());
    return raycaster.ray.intersectPlane(dragPlane, target);
  }

  function deleteSelected() {
    if (!selected.size) return;
    const count = selected.size;
    for (const obj of selected) {
      highlightObject(obj, false);
      obj.parent?.remove(obj);
      disposeObject(obj);
    }
    selected.clear();
    updateSelectionUI();
    onStructureChange?.();
    showToast(t('editDeleted', { count }), 'info');
  }

  function setEditMode(on) {
    editMode = on;
    canvas.classList.toggle('edit-mode', on);
    document.getElementById('edit-tools-controls')?.classList.toggle('hidden', !on);
    if (!on) {
      dragging = null;
      controls.enabled = true;
    }
    const toggle = document.getElementById('toggle-edit-mode');
    if (toggle && toggle.checked !== on) toggle.checked = on;
    updateSelectionUI();
  }

  function pickAt(clientX, clientY) {
    return pickObject({ clientX, clientY });
  }

  function handleViewSelection(clientX, clientY, shiftKey) {
    if (isMeasureMode()) return;
    const hit = pickAt(clientX, clientY);
    if (hit) {
      if (shiftKey) toggleSelection(hit, true);
      else setSelection([hit]);
      return;
    }
    if (!shiftKey) clearSelection();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    lastPointer = { x: event.clientX, y: event.clientY };

    if (!editMode) {
      if (!isMeasureMode() && root()?.children.length) {
        pointerDown = { x: event.clientX, y: event.clientY, shift: event.shiftKey, viewPick: true };
      }
      return;
    }

    pointerDown = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    const hit = pickObject(event);
    if (hit) {
      if (!selected.has(hit) && !event.shiftKey) setSelection([hit]);
      else if (event.shiftKey) toggleSelection(hit, true);
      if (selected.has(hit)) {
        const ref = [...selected][0];
        setupDragPlane(ref);
        if (worldPointOnPlane(event, dragAnchor)) {
          dragging = {
            ready: true,
            starts: new Map([...selected].map((o) => [o, o.position.clone()])),
          };
        }
      }
      event.preventDefault();
    } else if (!event.shiftKey) {
      clearSelection();
    }
  }

  function onPointerMove(event) {
    lastPointer = { x: event.clientX, y: event.clientY };

    if (!editMode && !dragging?.active && !isMeasureMode() && root()?.children.length) {
      const hit = pickAt(event.clientX, event.clientY);
      canvas.style.cursor = hit ? 'pointer' : '';
    }

    if (!editMode || !pointerDown) return;
    const dist = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (dragging?.ready && !dragging.active) {
      if (dist < DRAG_THRESHOLD) return;
      dragging.active = true;
      controls.enabled = false;
      worldPointOnPlane(event, dragAnchor);
      dragging.anchor = dragAnchor.clone();
    }
    if (!dragging?.active || !dragging.starts) return;
    if (!worldPointOnPlane(event, planeHit)) return;
    moveDelta.subVectors(planeHit, dragging.anchor);
    for (const [obj, start] of dragging.starts) {
      obj.position.copy(start).add(moveDelta);
    }
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (pointerDown?.viewPick && !editMode) {
      const px = event?.clientX ?? lastPointer?.x ?? pointerDown.x;
      const py = event?.clientY ?? lastPointer?.y ?? pointerDown.y;
      const dist = Math.hypot(px - pointerDown.x, py - pointerDown.y);
      if (dist < DRAG_THRESHOLD) {
        handleViewSelection(pointerDown.x, pointerDown.y, pointerDown.shift);
      }
    }

    if (dragging?.active) {
      showToast(t('editMoved'), 'success');
      onStructureChange?.();
    }
    dragging = null;
    pointerDown = null;
    controls.enabled = true;
    if (!editMode && !isMeasureMode()) canvas.style.cursor = '';
  }

  function bindUI() {
    document.getElementById('toggle-edit-mode')?.addEventListener('change', (e) => {
      setEditMode(e.target.checked);
      if (e.target.checked) {
        const measureToggle = document.getElementById('toggle-measure');
        if (measureToggle?.checked) {
          measureToggle.checked = false;
          measureToggle.dispatchEvent(new Event('change'));
        }
      }
    });

    document.getElementById('btn-delete-selected')?.addEventListener('click', deleteSelected);

    document.addEventListener('keydown', (e) => {
      if (!editMode || selected.size === 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'Escape') clearSelection();
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
  }

  bindUI();

  return {
    setEditMode,
    clearSelection,
    selectByUuid(uuid, additive = false) {
      const r = root();
      if (!r) return;
      let found = null;
      r.traverse((child) => {
        if (child.uuid === uuid && isSelectableObject(child)) found = child;
      });
      if (!found) return;
      if (additive) toggleSelection(found, true);
      else setSelection([found]);
    },
    getSelectedUuids: () => [...selected].map((o) => o.uuid),
    isEditMode: () => editMode,
    onModelLoaded() {
      clearSelection();
    },
    onModelCleared() {
      setEditMode(false);
      clearSelection();
    },
  };
}