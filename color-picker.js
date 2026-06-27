export const COLOR_PRESETS = [
  '#6b9bd1', '#e8eaed', '#00e5ff', '#ffd54f', '#69f0ae',
  '#ff8a80', '#b388ff', '#ffffff', '#ff9800', '#f48fb1',
];

export function initColorPicker({ t }) {
  const modal = document.getElementById('color-picker-modal');
  const titleEl = document.getElementById('color-picker-title');
  const customInput = document.getElementById('color-picker-custom');
  const hexEl = document.getElementById('color-picker-hex');
  const presetsEl = document.getElementById('color-picker-presets');
  const cancelBtn = document.getElementById('color-picker-cancel');
  const confirmBtn = document.getElementById('color-picker-confirm');
  const backdrop = modal?.querySelector('.modal-backdrop');

  if (!modal || !titleEl || !customInput || !presetsEl) {
    return { open: () => {}, close: () => {} };
  }

  let pendingColor = '#6b9bd1';
  let onConfirm = null;

  function updateActivePreset(hex) {
    const normalized = String(hex).toLowerCase();
    presetsEl.querySelectorAll('.color-preset-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color?.toLowerCase() === normalized);
    });
  }

  function selectColor(hex) {
    pendingColor = hex;
    customInput.value = hex;
    if (hexEl) hexEl.textContent = hex;
    updateActivePreset(hex);
  }

  function renderPresets() {
    presetsEl.replaceChildren();
    for (const hex of COLOR_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-preset-btn';
      btn.style.backgroundColor = hex;
      btn.title = hex;
      btn.dataset.color = hex;
      btn.setAttribute('aria-label', hex);
      btn.addEventListener('click', () => selectColor(hex));
      presetsEl.appendChild(btn);
    }
  }

  function close() {
    modal.classList.add('hidden');
    onConfirm = null;
  }

  function open({ color = '#6b9bd1', title, onConfirm: confirmCb }) {
    onConfirm = confirmCb;
    titleEl.textContent = title || t('modelColor');
    selectColor(color);
    renderPresets();
    updateActivePreset(color);
    modal.classList.remove('hidden');
    customInput.focus({ preventScroll: true });
  }

  cancelBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  confirmBtn?.addEventListener('click', () => {
    onConfirm?.(pendingColor);
    close();
  });
  customInput.addEventListener('input', (e) => selectColor(e.target.value));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  return { open, close };
}