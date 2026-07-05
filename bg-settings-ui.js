/** Background settings: layer visibility, space travel, presets. */

import { DEFAULT_BG_PARAMS, DEFAULT_BG_SETTINGS } from './bg-pixels.js';

const LAYER_SPECS = [
  { key: 'disk', labelKey: 'bgLayerDisk' },
  { key: 'photon', labelKey: 'bgLayerPhoton' },
  { key: 'boundary', labelKey: 'bgLayerBoundary' },
  { key: 'inflow', labelKey: 'bgLayerInflow' },
  { key: 'field', labelKey: 'bgLayerField' },
  { key: 'arc', labelKey: 'bgLayerArc' },
  { key: 'blackHole', labelKey: 'bgLayerBlackHole' },
  { key: 'warp', labelKey: 'bgLayerWarp' },
];

const PRESETS = [
  {
    id: 'cinema',
    labelKey: 'bgPresetCinema',
    params: null,
    settings: { visibility: { ...DEFAULT_BG_SETTINGS.visibility }, spaceTravel: false, globalSpeed: 1, warpIntensity: 1 },
  },
  {
    id: 'minimal',
    labelKey: 'bgPresetMinimal',
    params: {
      disk: { count: 0 },
      photon: { count: 0 },
      inflow: { count: 0 },
      field: { count: 8 },
      arc: { count: 0 },
    },
    settings: {
      visibility: { disk: false, photon: false, boundary: true, inflow: false, field: true, arc: false, blackHole: true, warp: true },
      spaceTravel: false,
    },
  },
  {
    id: 'power',
    labelKey: 'bgPresetPower',
    params: {
      disk: { count: 40 },
      photon: { count: 8 },
      boundary: { count: 20 },
      inflow: { count: 10 },
      field: { count: 8 },
      arc: { count: 10 },
    },
    settings: { globalSpeed: 0.7, warpIntensity: 0.8, spaceTravel: false },
  },
  {
    id: 'travel',
    labelKey: 'bgPresetTravel',
    params: {
      disk: { count: 24 },
      photon: { count: 0 },
      boundary: { count: 0 },
      inflow: { count: 0 },
      field: { count: 6 },
      arc: { count: 0 },
      blackHole: { radiusScale: 0.7 },
    },
    settings: {
      visibility: { disk: false, photon: false, boundary: false, inflow: false, field: true, arc: false, blackHole: true, warp: true },
      spaceTravel: true,
      warpIntensity: 1.4,
      globalSpeed: 1.2,
    },
  },
];

/**
 * @param {HTMLElement} container
 * @param {{ getSettings: Function, setSettings: Function, setParams: Function, saveAll: Function }} bgPixels
 * @param {{ t?: Function, onSpaceTravelToggle?: Function, onSettingsChange?: Function }} opts
 */
export function initBgSettingsUI(container, bgPixels, opts = {}) {
  const t = opts.t ?? ((key) => key);
  container.innerHTML = '';
  container.classList.add('bg-settings-panel');

  const header = document.createElement('div');
  header.className = 'bg-pixels-panel-head';
  header.innerHTML = `<h2 data-i18n="bgSettingsTitle">${t('bgSettingsTitle')}</h2>`;
  container.appendChild(header);

  const travelSection = document.createElement('section');
  travelSection.className = 'bg-settings-group';
  travelSection.innerHTML = `<h3 data-i18n="bgSpaceTravel">${t('bgSpaceTravel')}</h3>`;
  const travelRow = document.createElement('label');
  travelRow.className = 'bg-settings-toggle';
  travelRow.innerHTML = `
    <input type="checkbox" id="bg-space-travel" />
    <span data-i18n="bgSpaceTravelDesc">${t('bgSpaceTravelDesc')}</span>
  `;
  travelSection.appendChild(travelRow);
  container.appendChild(travelSection);

  const layerSection = document.createElement('section');
  layerSection.className = 'bg-settings-group';
  layerSection.innerHTML = `<h3 data-i18n="bgLayerVisibility">${t('bgLayerVisibility')}</h3>`;
  const layerGrid = document.createElement('div');
  layerGrid.className = 'bg-settings-layer-grid';
  for (const spec of LAYER_SPECS) {
    const label = document.createElement('label');
    label.className = 'bg-settings-toggle';
    label.innerHTML = `
      <input type="checkbox" data-layer="${spec.key}" />
      <span data-i18n="${spec.labelKey}">${t(spec.labelKey)}</span>
    `;
    layerGrid.appendChild(label);
  }
  layerSection.appendChild(layerGrid);
  container.appendChild(layerSection);

  const sliderSection = document.createElement('section');
  sliderSection.className = 'bg-settings-group';
  sliderSection.innerHTML = `<h3 data-i18n="bgEffects">${t('bgEffects')}</h3>`;

  const warpRow = document.createElement('div');
  warpRow.className = 'bg-pixels-row';
  warpRow.innerHTML = `
    <label for="bg-warp-intensity">
      <span data-i18n="bgWarpIntensity">${t('bgWarpIntensity')}</span>
      <span class="bg-pixels-val" data-for="bg-warp-intensity"></span>
    </label>
    <input type="range" id="bg-warp-intensity" min="0.2" max="2" step="0.1" />
  `;
  sliderSection.appendChild(warpRow);

  const speedRow = document.createElement('div');
  speedRow.className = 'bg-pixels-row';
  speedRow.innerHTML = `
    <label for="bg-global-speed">
      <span data-i18n="bgGlobalSpeed">${t('bgGlobalSpeed')}</span>
      <span class="bg-pixels-val" data-for="bg-global-speed"></span>
    </label>
    <input type="range" id="bg-global-speed" min="0.3" max="2" step="0.1" />
  `;
  sliderSection.appendChild(speedRow);

  const autoSaveRow = document.createElement('label');
  autoSaveRow.className = 'bg-settings-toggle';
  autoSaveRow.innerHTML = `
    <input type="checkbox" id="bg-auto-save" />
    <span data-i18n="bgAutoSave">${t('bgAutoSave')}</span>
  `;
  sliderSection.appendChild(autoSaveRow);
  container.appendChild(sliderSection);

  const presetSection = document.createElement('section');
  presetSection.className = 'bg-settings-group';
  presetSection.innerHTML = `<h3 data-i18n="bgPresets">${t('bgPresets')}</h3>`;
  const presetRow = document.createElement('div');
  presetRow.className = 'bg-settings-presets';
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-settings-preset-btn';
    btn.dataset.preset = preset.id;
    btn.setAttribute('data-i18n', preset.labelKey);
    btn.textContent = t(preset.labelKey);
    presetRow.appendChild(btn);
  }
  presetSection.appendChild(presetRow);
  container.appendChild(presetSection);

  const travelInput = container.querySelector('#bg-space-travel');
  const warpInput = container.querySelector('#bg-warp-intensity');
  const speedInput = container.querySelector('#bg-global-speed');
  const autoSaveInput = container.querySelector('#bg-auto-save');
  const layerInputs = container.querySelectorAll('[data-layer]');

  function formatVal(id, value) {
    const el = container.querySelector(`[data-for="${id}"]`);
    if (el) el.textContent = Number(value).toFixed(1);
  }

  function syncFromSettings() {
    const s = bgPixels.getSettings();
    if (travelInput) travelInput.checked = s.spaceTravel;
    if (warpInput) {
      warpInput.value = String(s.warpIntensity);
      formatVal('bg-warp-intensity', s.warpIntensity);
    }
    if (speedInput) {
      speedInput.value = String(s.globalSpeed);
      formatVal('bg-global-speed', s.globalSpeed);
    }
    if (autoSaveInput) autoSaveInput.checked = s.autoSave;
    for (const input of layerInputs) {
      const key = input.dataset.layer;
      if (key && s.visibility) input.checked = !!s.visibility[key];
    }
  }

  function emitChange() {
    opts.onSettingsChange?.();
  }

  travelInput?.addEventListener('change', () => {
    bgPixels.setSettings({ spaceTravel: travelInput.checked });
    emitChange();
  });

  for (const input of layerInputs) {
    input.addEventListener('change', () => {
      const key = input.dataset.layer;
      if (!key) return;
      bgPixels.setSettings({ visibility: { [key]: input.checked } });
      emitChange();
    });
  }

  warpInput?.addEventListener('input', () => {
    const v = Number(warpInput.value);
    formatVal('bg-warp-intensity', v);
    bgPixels.setSettings({ warpIntensity: v });
    emitChange();
  });

  speedInput?.addEventListener('input', () => {
    const v = Number(speedInput.value);
    formatVal('bg-global-speed', v);
    bgPixels.setSettings({ globalSpeed: v });
    emitChange();
  });

  autoSaveInput?.addEventListener('change', () => {
    bgPixels.setSettings({ autoSave: autoSaveInput.checked });
    emitChange();
  });

  presetRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.bg-settings-preset-btn');
    if (!btn) return;
    const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
    if (!preset) return;

    if (preset.params) bgPixels.setParams(preset.params);
    bgPixels.setSettings({
      ...preset.settings,
      visibility: preset.settings.visibility
        ? { ...DEFAULT_BG_SETTINGS.visibility, ...preset.settings.visibility }
        : undefined,
    });

    syncFromSettings();
    opts.onParamsSync?.();
    emitChange();
  });

  syncFromSettings();

  return { syncFromSettings };
}