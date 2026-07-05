/** Lab / background feature UI (black hole, bg settings). */

import { initBgPixelsUI } from './bg-pixels-ui.js';
import { initBgSettingsUI } from './bg-settings-ui.js';

/**
 * @param {{
 *   bgPixels: object,
 *   t?: Function,
 *   showToast?: Function,
 *   onSpaceTravelChange?: Function,
 * }} opts
 */
export function initLabFeatures({
  bgPixels,
  t = (key) => key,
  showToast = () => {},
  onSpaceTravelChange = () => {},
}) {
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

  return { syncSettings: () => settingsUi?.syncFromSettings?.() };
}

/** @deprecated Use initLabFeatures */
export function initViewportDock(opts) {
  return initLabFeatures(opts);
}