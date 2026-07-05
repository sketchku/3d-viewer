/** Bottom dock icon buttons + popup panels for chat and black-hole background. */

import { initBgPixelsUI } from './bg-pixels-ui.js';

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
 * @param {{ bgPixels: object, chatApi?: { setExpanded: Function, getExpanded: Function } | null }} opts
 */
export function initViewportDock({ bgPixels, chatApi = null }) {
  const chatBtn = document.getElementById('dock-chat-btn');
  const bgBtn = document.getElementById('dock-bg-btn');
  const chatPopup = document.getElementById('dock-chat-popup');
  const bgPopup = document.getElementById('dock-bg-popup');

  const bgMount = document.getElementById('bg-pixels-controls');
  if (bgMount && bgPixels?.getParams) {
    initBgPixelsUI(bgMount, bgPixels);
  }

  const popups = [
    { popup: chatPopup, btn: chatBtn, id: 'chat' },
    { popup: bgPopup, btn: bgBtn, id: 'bg' },
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

  for (const { popup } of popups) {
    popup?.querySelector('.dock-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAll();
      chatApi?.setExpanded?.(false);
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('.viewport-dock, .dock-popup')) return;
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

  return { closeAll };
}