/** Bottom dock icon buttons + popup panels for chat and black-hole background. */

import { initBgPixelsUI } from './bg-pixels-ui.js';

const CHAT_ICON = `<svg class="dock-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
</svg>`;

const BLACKHOLE_ICON = `<svg class="dock-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="3.5" fill="currentColor"/>
  <ellipse cx="12" cy="12" rx="9.5" ry="2.8" stroke="currentColor" stroke-width="1.6" transform="rotate(-22 12 12)"/>
  <ellipse cx="12" cy="12" rx="8.5" ry="2.2" stroke="currentColor" stroke-width="1" opacity="0.45" transform="rotate(24 12 12)"/>
  <path d="M5.5 9.5 Q12 6.5 18.5 9.5" stroke="currentColor" stroke-width="1" opacity="0.35" fill="none"/>
</svg>`;

function closePopup(popup, btn) {
  popup?.classList.add('hidden');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.classList.remove('dock-icon-btn-active');
}

function openPopup(popup, btn) {
  popup?.classList.remove('hidden');
  btn?.setAttribute('aria-expanded', 'true');
  btn?.classList.add('dock-icon-btn-active');
}

/**
 * @param {{ bgPixels: object, chatApi?: { setExpanded: Function, getExpanded: Function } | null }} opts
 */
export function initViewportDock({ bgPixels, chatApi = null }) {
  const chatBtn = document.getElementById('dock-chat-btn');
  const bgBtn = document.getElementById('dock-bg-btn');
  const chatPopup = document.getElementById('dock-chat-popup');
  const bgPopup = document.getElementById('dock-bg-popup');

  if (chatBtn && !chatBtn.querySelector('.dock-icon')) {
    chatBtn.insertAdjacentHTML('afterbegin', CHAT_ICON);
  }
  if (bgBtn && !bgBtn.querySelector('.dock-icon')) {
    bgBtn.insertAdjacentHTML('afterbegin', BLACKHOLE_ICON);
  }

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