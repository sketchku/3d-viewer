/** Left sidebar icon rail + popup panels. */

import { initLabFeatures } from './viewport-dock.js';

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

function initPopupDrag(popup, container) {
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

  let labApi = null;
  if (bgPixels) {
    labApi = initLabFeatures({ bgPixels, t, showToast, onSpaceTravelChange });
  }

  for (const { popup } of popups) {
    initPopupDrag(popup, app);
  }

  function closeAll(exceptId) {
    for (const { popup, btn, id } of popups) {
      if (id === exceptId) continue;
      closePopup(popup, btn);
      if (id === 'lab' && chatApi?.setExpanded) chatApi.setExpanded(false);
    }
  }

  function isAnyOpen() {
    return popups.some(({ popup }) => popup && !popup.classList.contains('hidden'));
  }

  function openById(id) {
    const entry = popups.find((p) => p.id === id);
    if (!entry?.popup || !entry.btn) return;
    closeAll(id);
    openPopup(entry.popup, entry.btn);
    if (id === 'lab') {
      labApi?.syncSettings?.();
      chatApi?.setExpanded?.(true);
    }
  }

  for (const { popup, btn, id } of popups) {
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (id === 'lab') {
        const isOpen = chatApi?.getExpanded?.() ?? !popup?.classList.contains('hidden');
        const willOpen = !isOpen;
        closeAll(willOpen ? 'lab' : null);
        if (chatApi?.setExpanded) {
          chatApi.setExpanded(willOpen);
        } else if (willOpen) {
          openPopup(popup, btn);
          labApi?.syncSettings?.();
        } else {
          closePopup(popup, btn);
        }
        return;
      }
      const open = popup?.classList.contains('hidden');
      closeAll(open ? id : null);
      if (open) openPopup(popup, btn);
      else closePopup(popup, btn);
    });

    popup?.querySelector('.dock-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAll();
      chatApi?.setExpanded?.(false);
    });
  }

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof Element && target.closest('.sidebar-dock, .sidebar-popup, .space-travel-exit')) return;
    closeAll();
    chatApi?.setExpanded?.(false);
  });

  for (const { popup } of popups) {
    popup?.addEventListener('pointerdown', (e) => e.stopPropagation());
    popup?.addEventListener('click', (e) => e.stopPropagation());
  }

  dock?.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock?.addEventListener('click', (e) => e.stopPropagation());

  function setTreeSectionVisible(visible) {
    const section = document.getElementById('model-tree-section');
    section?.classList.toggle('hidden', !visible);
    if (!visible) {
      const entry = popups.find((p) => p.id === 'model');
      if (entry?.popup && !entry.popup.classList.contains('hidden')) {
        // keep model popup open, just hide tree section
      }
    }
  }

  return { closeAll, isAnyOpen, openById, setTreeButtonVisible: setTreeSectionVisible, syncLabSettings: () => labApi?.syncSettings?.() };
}