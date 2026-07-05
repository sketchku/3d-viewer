/** Left sidebar icon rail + popup panels (mirrors viewport-dock pattern). */

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
 * @param {{ onTreeVisibility?: (visible: boolean) => void }} [opts]
 */
export function initSidebarDock(opts = {}) {
  const app = document.getElementById('app');
  const dock = document.getElementById('sidebar-dock');
  const pairs = [
    { id: 'file', btn: 'sidebar-file-btn', popup: 'sidebar-file-popup' },
    { id: 'view', btn: 'sidebar-view-btn', popup: 'sidebar-view-popup' },
    { id: 'tools', btn: 'sidebar-tools-btn', popup: 'sidebar-tools-popup' },
    { id: 'tree', btn: 'sidebar-tree-btn', popup: 'sidebar-tree-popup' },
    { id: 'info', btn: 'sidebar-info-btn', popup: 'sidebar-info-popup' },
    { id: 'lang', btn: 'sidebar-lang-btn', popup: 'sidebar-lang-popup' },
  ];

  const popups = pairs.map(({ id, btn, popup }) => ({
    id,
    btn: document.getElementById(btn),
    popup: document.getElementById(popup),
  }));

  for (const { popup } of popups) {
    initPopupDrag(popup, app);
  }

  function closeAll(exceptId) {
    for (const { popup, btn, id } of popups) {
      if (id === exceptId) continue;
      closePopup(popup, btn);
    }
  }

  function isAnyOpen() {
    return popups.some(({ popup }) => popup && !popup.classList.contains('hidden'));
  }

  for (const { popup, btn, id } of popups) {
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = popup?.classList.contains('hidden');
      closeAll(open ? id : null);
      if (open) openPopup(popup, btn);
      else closePopup(popup, btn);
    });

    popup?.querySelector('.dock-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAll();
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('.sidebar-dock, .sidebar-popup')) return;
    closeAll();
  });

  for (const { popup } of popups) {
    popup?.addEventListener('pointerdown', (e) => e.stopPropagation());
    popup?.addEventListener('click', (e) => e.stopPropagation());
  }

  dock?.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock?.addEventListener('click', (e) => e.stopPropagation());

  function setTreeButtonVisible(visible) {
    const treeBtn = document.getElementById('sidebar-tree-btn');
    treeBtn?.classList.toggle('hidden', !visible);
    opts.onTreeVisibility?.(visible);
    if (!visible) {
      const entry = popups.find((p) => p.id === 'tree');
      closePopup(entry?.popup, entry?.btn);
    }
  }

  return { closeAll, isAnyOpen, setTreeButtonVisible };
}