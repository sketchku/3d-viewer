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
  const chatBtn = document.getElementById('dock-chat-btn');
  const bgBtn = document.getElementById('dock-bg-btn');
  const settingsBtn = document.getElementById('dock-settings-btn');
  const gridBtn = document.getElementById('dock-grid-btn');
  const miscBtn = document.getElementById('dock-misc-btn');
  const chatPopup = document.getElementById('dock-chat-popup');
  const bgPopup = document.getElementById('dock-bg-popup');
  const settingsPopup = document.getElementById('dock-settings-popup');
  const gridPopup = document.getElementById('dock-grid-popup');
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
    { popup: miscPopup, btn: miscBtn, id: 'misc' },
  ];

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
    if (t instanceof Element && t.closest('.viewport-dock, .dock-popup, .space-travel-exit')) return;
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