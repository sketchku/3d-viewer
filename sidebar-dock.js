/** Left sidebar icon rail + popup panels. */

import { initLabFeatures } from './viewport-dock.js';

const CASCADE_OFFSET_X = 28;
const CASCADE_OFFSET_Y = 32;

function closePopup(popup, btn) {
  popup?.classList.add('hidden');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.classList.remove('active');
}

function openPopup(popup, btn) {
  popup?.classList.remove('hidden');
  btn?.setAttribute('aria-expanded', 'true');
  btn?.classList.add('active');
}

function resetPopupPosition(popup) {
  if (!popup) return;
  popup.classList.remove('sidebar-popup-positioned');
  popup.style.left = '';
  popup.style.top = '';
  popup.style.transform = '';
  popup.style.zIndex = '';
  delete popup.dataset.userPositioned;
}

function initPopupDrag(popup, container, onUserPositioned) {
  const handle = popup?.querySelector('.dock-popup-drag-handle');
  if (!handle || !popup || !container) return;

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function clampPosition(left, top) {
    const bounds = container.getBoundingClientRect();
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    return {
      left: Math.max(8, Math.min(left, bounds.width - w - 8)),
      top: Math.max(8, Math.min(top, bounds.height - h - 8)),
    };
  }

  function applyPosition(left, top) {
    const pos = clampPosition(left, top);
    popup.classList.add('sidebar-popup-positioned');
    popup.style.left = `${pos.left}px`;
    popup.style.top = `${pos.top}px`;
    popup.style.transform = 'none';
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, a, label, .dock-text-btn')) return;

    const bounds = container.getBoundingClientRect();
    const rect = popup.getBoundingClientRect();

    if (!popup.classList.contains('sidebar-popup-positioned')) {
      applyPosition(rect.left - bounds.left, rect.top - bounds.top);
    }

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(popup.style.left) || 0;
    startTop = parseFloat(popup.style.top) || 0;

    handle.setPointerCapture(pointerId);
    handle.classList.add('dock-dragging');
    e.preventDefault();
    e.stopPropagation();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    applyPosition(startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
    e.preventDefault();
  });

  function endDrag(e) {
    if (!dragging || (e.pointerId !== undefined && e.pointerId !== pointerId)) return;
    dragging = false;
    if (pointerId != null) {
      handle.releasePointerCapture(pointerId);
      pointerId = null;
    }
    handle.classList.remove('dock-dragging');
    if (popup.classList.contains('sidebar-popup-positioned')) {
      popup.dataset.userPositioned = 'true';
      onUserPositioned?.();
    }
  }

  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

/**
 * @param {{
 *   bgPixels?: object,
 *   chatApi?: { setExpanded: Function, getExpanded: Function } | null,
 *   t?: Function,
 *   showToast?: Function,
 *   onSpaceTravelChange?: Function,
 * }} [opts]
 */
export function initSidebarDock(opts = {}) {
  const {
    bgPixels = null,
    chatApi = null,
    t = (key) => key,
    showToast = () => {},
    onSpaceTravelChange = () => {},
    THREE = null,
    getModelRoot = () => null,
    getIs2d = () => false,
    editToolsMgr = () => null,
    onPuzzlePartsChanged = () => {},
  } = opts;

  const app = document.getElementById('app');
  const dock = document.getElementById('sidebar-dock');
  const pairs = [
    { id: 'file', btn: 'sidebar-file-btn', popup: 'sidebar-file-popup' },
    { id: 'display', btn: 'sidebar-display-btn', popup: 'sidebar-display-popup' },
    { id: 'analyze', btn: 'sidebar-analyze-btn', popup: 'sidebar-analyze-popup' },
    { id: 'model', btn: 'sidebar-model-btn', popup: 'sidebar-model-popup' },
    { id: 'settings', btn: 'sidebar-settings-btn', popup: 'sidebar-settings-popup' },
    { id: 'lab', btn: 'sidebar-lab-btn', popup: 'sidebar-lab-popup' },
  ];

  const popups = pairs.map(({ id, btn, popup }) => ({
    id,
    btn: document.getElementById(btn),
    popup: document.getElementById(popup),
  }));

  /** @type {string[]} */
  const openOrder = [];

  const labApi = initLabFeatures({
    bgPixels,
    t,
    showToast,
    onSpaceTravelChange,
    THREE,
    getModelRoot,
    getIs2d,
      editToolsMgr,
      onPuzzlePartsChanged,
    });

  function isEntryOpen(entry) {
    return entry?.popup && !entry.popup.classList.contains('hidden');
  }

  function getOpenEntries() {
    return openOrder
      .map((id) => popups.find((p) => p.id === id))
      .filter((entry) => entry && isEntryOpen(entry));
  }

  function getSidebarWidth() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 72;
  }

  function layoutCascade() {
    if (!app) return;
    const bounds = app.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const sidebarW = getSidebarWidth();
    const openEntries = getOpenEntries();

    openEntries.forEach((entry, index) => {
      const popup = entry.popup;
      if (popup.dataset.userPositioned === 'true') return;

      const w = popup.offsetWidth || 320;
      const h = popup.offsetHeight || 320;
      const baseTop = Math.max(8, (bounds.height - h) / 2);
      const left = rtl
        ? bounds.width - sidebarW - 10 - w - index * CASCADE_OFFSET_X
        : sidebarW + 10 + index * CASCADE_OFFSET_X;
      const top = baseTop + index * CASCADE_OFFSET_Y;

      popup.classList.add('sidebar-popup-positioned');
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.right = 'auto';
      popup.style.transform = 'none';
      popup.style.zIndex = `${14 + index}`;
    });
  }

  function showEntry(entry) {
    if (!entry?.popup || !entry.btn) return;
    openPopup(entry.popup, entry.btn);
    if (!openOrder.includes(entry.id)) openOrder.push(entry.id);
    requestAnimationFrame(() => layoutCascade());
  }

  function hideEntry(entry) {
    if (!entry?.popup || !entry.btn) return;
    closePopup(entry.popup, entry.btn);
    const idx = openOrder.indexOf(entry.id);
    if (idx >= 0) openOrder.splice(idx, 1);
    resetPopupPosition(entry.popup);
    requestAnimationFrame(() => layoutCascade());
  }

  for (const { popup } of popups) {
    initPopupDrag(popup, app, layoutCascade);
  }

  function closeAll() {
    for (const entry of popups) {
      if (!isEntryOpen(entry)) continue;
      closePopup(entry.popup, entry.btn);
      resetPopupPosition(entry.popup);
    }
    openOrder.length = 0;
    chatApi?.setExpanded?.(false);
  }

  function closeLast() {
    const openEntries = getOpenEntries();
    if (!openEntries.length) return false;
    const last = openEntries[openEntries.length - 1];
    hideEntry(last);
    if (last.id === 'lab') chatApi?.setExpanded?.(false);
    return true;
  }

  function isAnyOpen() {
    return popups.some(({ popup }) => popup && !popup.classList.contains('hidden'));
  }

  function openById(id) {
    const entry = popups.find((p) => p.id === id);
    if (!entry?.popup || !entry.btn || isEntryOpen(entry)) return;
    showEntry(entry);
    if (id === 'lab') {
      labApi?.syncSettings?.();
      chatApi?.setExpanded?.(true);
    }
  }

  function toggleEntry(entry) {
    if (isEntryOpen(entry)) {
      hideEntry(entry);
      if (entry.id === 'lab') chatApi?.setExpanded?.(false);
      return;
    }
    showEntry(entry);
    if (entry.id === 'lab') {
      labApi?.syncSettings?.();
      chatApi?.setExpanded?.(true);
    }
  }

  for (const entry of popups) {
    const { popup, btn, id } = entry;
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (id === 'lab' && chatApi?.getExpanded && chatApi?.setExpanded) {
        const willOpen = !chatApi.getExpanded();
        if (willOpen) {
          showEntry(entry);
          labApi?.syncSettings?.();
          chatApi.setExpanded(true);
        } else {
          hideEntry(entry);
          chatApi.setExpanded(false);
        }
        return;
      }
      toggleEntry(entry);
    });

    popup?.querySelector('.dock-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideEntry(entry);
      if (id === 'lab') chatApi?.setExpanded?.(false);
    });
  }

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest('.sidebar-dock, .sidebar-popup, #space-travel-bar')) return;
    closeAll();
  });

  for (const { popup } of popups) {
    popup?.addEventListener('pointerdown', (e) => e.stopPropagation());
    popup?.addEventListener('click', (e) => e.stopPropagation());
  }

  dock?.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock?.addEventListener('click', (e) => e.stopPropagation());

  const brandBtn = document.getElementById('sidebar-brand-btn');
  const brandIcon = brandBtn?.querySelector('.brand-app-mark');
  brandBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAll();
    brandIcon?.classList.add('spin-once');
    brandBtn.disabled = true;
    window.setTimeout(() => window.location.reload(), 320);
  });

  function setTreeSectionVisible(visible) {
    const section = document.getElementById('model-tree-section');
    section?.classList.toggle('hidden', !visible);
  }

  document.addEventListener('sidebar-lab-toggle', (e) => {
    const open = !!e.detail?.open;
    const labEntry = popups.find((p) => p.id === 'lab');
    if (!labEntry) return;
    if (open) {
      if (!openOrder.includes('lab')) openOrder.push('lab');
      requestAnimationFrame(() => layoutCascade());
      return;
    }
    const idx = openOrder.indexOf('lab');
    if (idx >= 0) openOrder.splice(idx, 1);
    resetPopupPosition(labEntry.popup);
    requestAnimationFrame(() => layoutCascade());
  });

  return {
    closeAll,
    closeLast,
    isAnyOpen,
    openById,
    setTreeButtonVisible: setTreeSectionVisible,
    syncLabSettings: () => labApi?.syncSettings?.(),
    puzzleGame: () => labApi?.puzzleGame,
  };
}