/** Space-travel mode toolbar: background menus left of the wormhole exit button. */

const MENU_ENTRIES = [
  {
    id: 'bg-params',
    btn: 'st-btn-bg-params',
    popup: 'st-popup-bg-params',
    slot: 'bg-pixels-slot',
  },
  {
    id: 'bg-settings',
    btn: 'st-btn-bg-settings',
    popup: 'st-popup-bg-settings',
    slot: 'bg-settings-slot',
  },
];

/**
 * @param {{ t?: Function }} [opts]
 */
export function initSpaceTravelUI(opts = {}) {
  const t = opts.t ?? ((key) => key);

  const bar = document.getElementById('space-travel-bar');
  const anchor = document.getElementById('lab-bg-slots-anchor');
  const entries = MENU_ENTRIES.map((spec) => ({
    ...spec,
    btn: document.getElementById(spec.btn),
    popup: document.getElementById(spec.popup),
    slot: document.getElementById(spec.slot),
    host: document.querySelector(`[data-slot-host="${spec.slot}"]`),
  }));

  /** @type {string[]} */
  const openOrder = [];
  let active = false;

  function isOpen(entry) {
    return entry?.popup && !entry.popup.classList.contains('hidden');
  }

  function getOpenEntries() {
    return openOrder
      .map((id) => entries.find((e) => e.id === id))
      .filter((entry) => entry && isOpen(entry));
  }

  function layoutPopups() {
    const openEntries = getOpenEntries();
    openEntries.forEach((entry, index) => {
      entry.popup.style.setProperty('--st-cascade', String(index));
      entry.popup.dataset.cascade = String(index);
    });
  }

  function openEntry(entry) {
    if (!entry?.popup || !entry.btn) return;
    entry.popup.classList.remove('hidden');
    entry.btn.setAttribute('aria-expanded', 'true');
    entry.btn.classList.add('active');
    if (!openOrder.includes(entry.id)) openOrder.push(entry.id);
    if (entry.host && entry.slot && !entry.host.contains(entry.slot)) {
      entry.host.appendChild(entry.slot);
    }
    layoutPopups();
  }

  function closeEntry(entry) {
    if (!entry?.popup || !entry.btn) return;
    entry.popup.classList.add('hidden');
    entry.btn.setAttribute('aria-expanded', 'false');
    entry.btn.classList.remove('active');
    const idx = openOrder.indexOf(entry.id);
    if (idx >= 0) openOrder.splice(idx, 1);
    layoutPopups();
  }

  function toggleEntry(entry) {
    if (isOpen(entry)) closeEntry(entry);
    else openEntry(entry);
  }

  function closeAllMenus() {
    for (const entry of entries) closeEntry(entry);
  }

  function closeLast() {
    const openEntries = getOpenEntries();
    if (!openEntries.length) return false;
    closeEntry(openEntries[openEntries.length - 1]);
    return true;
  }

  function isAnyMenuOpen() {
    return entries.some((entry) => isOpen(entry));
  }

  function mountSlotsToTravel(on) {
    for (const entry of entries) {
      if (!entry.slot) continue;
      if (on) {
        if (entry.host && !entry.host.contains(entry.slot)) {
          entry.host.appendChild(entry.slot);
        }
        continue;
      }
      if (anchor && !anchor.contains(entry.slot)) {
        anchor.appendChild(entry.slot);
      }
    }
  }

  function setActive(on) {
    active = !!on;
    bar?.classList.toggle('hidden', !active);
    mountSlotsToTravel(active);
    if (!active) closeAllMenus();
    else openEntry(entries.find((e) => e.id === 'bg-settings'));
  }

  for (const entry of entries) {
    entry.btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEntry(entry);
    });

    entry.popup?.querySelector('.st-menu-popup-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeEntry(entry);
    });

    entry.popup?.addEventListener('pointerdown', (e) => e.stopPropagation());
    entry.popup?.addEventListener('click', (e) => e.stopPropagation());
  }

  bar?.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar?.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', (e) => {
    if (!active) return;
    const target = e.target;
    if (target instanceof Element && target.closest('#space-travel-bar')) return;
    closeAllMenus();
  });

  return {
    setActive,
    closeAllMenus,
    closeLast,
    isAnyMenuOpen,
    openById: (id) => {
      const entry = entries.find((e) => e.id === id);
      if (entry && !isOpen(entry)) openEntry(entry);
    },
  };
}