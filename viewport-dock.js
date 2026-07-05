/** Bottom dock icon buttons + popup panels for chat, background, and settings. */

import { initBgPixelsUI } from './bg-pixels-ui.js';
import { initBgSettingsUI } from './bg-settings-ui.js';

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

function initPopupDrag(popup, viewport) {
  const handle = popup?.querySelector('.dock-popup-drag-handle');
  if (!handle || !popup || !viewport) return;

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function clampPosition(left, top) {
    const vp = viewport.getBoundingClientRect();
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    return {
      left: Math.max(8, Math.min(left, vp.width - w - 8)),
      top: Math.max(8, Math.min(top, vp.height - h - 8)),
    };
  }

  function applyPosition(left, top) {
    const pos = clampPosition(left, top);
    popup.classList.add('dock-popup-positioned');
    popup.style.left = `${pos.left}px`;
    popup.style.top = `${pos.top}px`;
    popup.style.bottom = 'auto';
    popup.style.transform = 'none';
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, a, label, .dock-text-btn')) return;

    const vp = viewport.getBoundingClientRect();
    const rect = popup.getBoundingClientRect();

    if (!popup.classList.contains('dock-popup-positioned')) {
      applyPosition(rect.left - vp.left, rect.top - vp.top);
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
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    applyPosition(startLeft + dx, startTop + dy);
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
 *   bgPixels: object,
 *   chatApi?: { setExpanded: Function, getExpanded: Function } | null,
 *   t?: Function,
 *   showToast?: Function,
 *   onSpaceTravelChange?: Function,
 * }} opts
 */
export function initViewportDock({
  bgPixels,
  chatApi = null,
  t = (key) => key,
  showToast = () => {},
  onSpaceTravelChange = () => {},
}) {
  const viewport = document.querySelector('main.viewport');
  const chatBtn = document.getElementById('dock-chat-btn');
  const bgBtn = document.getElementById('dock-bg-btn');
  const settingsBtn = document.getElementById('dock-settings-btn');
  const gridBtn = document.getElementById('dock-grid-btn');
  const viewBtn = document.getElementById('dock-view-btn');
  const miscBtn = document.getElementById('dock-misc-btn');
  const chatPopup = document.getElementById('dock-chat-popup');
  const bgPopup = document.getElementById('dock-bg-popup');
  const settingsPopup = document.getElementById('dock-settings-popup');
  const gridPopup = document.getElementById('dock-grid-popup');
  const viewPopup = document.getElementById('dock-view-popup');
  const miscPopup = document.getElementById('dock-misc-popup');

  const bgMount = document.getElementById('bg-pixels-controls');
  const settingsMount = document.getElementById('bg-settings-controls');

  let bgUi = null;
  let settingsUi = null;

  if (bgMount && bgPixels?.getParams) {
    bgUi = initBgPixelsUI(bgMount, bgPixels, {
      t,
      onSave: (ok) => {
        showToast(ok ? t('bgSaveOk') : t('bgSaveFail'), ok ? 'success' : 'error');
      },
    });
  }

  if (settingsMount && bgPixels?.getSettings) {
    settingsUi = initBgSettingsUI(settingsMount, bgPixels, {
      t,
      onSpaceTravelToggle: onSpaceTravelChange,
      onParamsSync: () => bgUi?.syncFromParams?.(),
    });
  }

  bgPixels?.setOnSpaceTravelChange?.((on) => {
    onSpaceTravelChange(on);
    settingsUi?.syncFromSettings?.();
  });

  const popups = [
    { popup: chatPopup, btn: chatBtn, id: 'chat' },
    { popup: bgPopup, btn: bgBtn, id: 'bg' },
    { popup: settingsPopup, btn: settingsBtn, id: 'settings' },
    { popup: gridPopup, btn: gridBtn, id: 'grid' },
    { popup: viewPopup, btn: viewBtn, id: 'view' },
    { popup: miscPopup, btn: miscBtn, id: 'misc' },
  ];

  for (const { popup } of popups) {
    initPopupDrag(popup, viewport);
  }

  function closeAll(exceptId) {
    for (const { popup, btn, id } of popups) {
      if (id === exceptId) continue;
      closePopup(popup, btn);
      if (id === 'chat' && chatApi?.setExpanded) chatApi.setExpanded(false);
    }
  }

  chatBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = chatApi?.getExpanded?.() ?? !chatPopup?.classList.contains('hidden');
    const willOpen = !isOpen;
    closeAll(willOpen ? 'chat' : null);
    if (chatApi?.setExpanded) {
      chatApi.setExpanded(willOpen);
    } else if (willOpen) {
      openPopup(chatPopup, chatBtn);
    } else {
      closePopup(chatPopup, chatBtn);
    }
  });

  bgBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = bgPopup?.classList.contains('hidden');
    closeAll(open ? 'bg' : null);
    if (open) openPopup(bgPopup, bgBtn);
    else closePopup(bgPopup, bgBtn);
  });

  settingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = settingsPopup?.classList.contains('hidden');
    closeAll(open ? 'settings' : null);
    if (open) {
      openPopup(settingsPopup, settingsBtn);
      settingsUi?.syncFromSettings?.();
    } else {
      closePopup(settingsPopup, settingsBtn);
    }
  });

  gridBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = gridPopup?.classList.contains('hidden');
    closeAll(open ? 'grid' : null);
    if (open) openPopup(gridPopup, gridBtn);
    else closePopup(gridPopup, gridBtn);
  });

  viewBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = viewPopup?.classList.contains('hidden');
    closeAll(open ? 'view' : null);
    if (open) openPopup(viewPopup, viewBtn);
    else closePopup(viewPopup, viewBtn);
  });

  miscBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = miscPopup?.classList.contains('hidden');
    closeAll(open ? 'misc' : null);
    if (open) openPopup(miscPopup, miscBtn);
    else closePopup(miscPopup, miscBtn);
  });

  for (const { popup } of popups) {
    popup?.querySelector('.dock-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAll();
      chatApi?.setExpanded?.(false);
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('.viewport-dock, .dock-popup, .space-travel-exit, .sidebar-dock, .sidebar-popup')) return;
    closeAll();
    chatApi?.setExpanded?.(false);
  });

  for (const { popup } of popups) {
    popup?.addEventListener('pointerdown', (e) => e.stopPropagation());
    popup?.addEventListener('click', (e) => e.stopPropagation());
  }

  const dock = document.getElementById('viewport-dock');
  dock?.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock?.addEventListener('click', (e) => e.stopPropagation());

  return { closeAll, syncSettings: () => settingsUi?.syncFromSettings?.() };
}