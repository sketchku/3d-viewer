/** Lab / background feature UI (black hole, bg settings). */

import { initBgPixelsUI } from './bg-pixels-ui.js';
import { initBgSettingsUI } from './bg-settings-ui.js';
import { initPuzzleGame } from './puzzle-game.js';

/**
 * @param {{
 *   bgPixels: object,
 *   t?: Function,
 *   showToast?: Function,
 *   onSpaceTravelChange?: Function,
 *   THREE?: object,
 *   getModelRoot?: Function,
 *   getIs2d?: Function,
 *   editToolsMgr?: Function,
 * }} opts
 */
export function initLabFeatures({
  bgPixels,
  t = (key) => key,
  showToast = () => {},
  onSpaceTravelChange = () => {},
  THREE = null,
  getModelRoot = () => null,
  getIs2d = () => false,
  editToolsMgr = () => null,
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

  const puzzleGame = initPuzzleGame({
    THREE,
    container: document.getElementById('puzzle-game-controls'),
    getModelRoot,
    getIs2d,
    editToolsMgr,
    t,
    showToast,
  });

  return {
    syncSettings: () => settingsUi?.syncFromSettings?.(),
    puzzleGame,
  };
}

/** @deprecated Use initLabFeatures */
export function initViewportDock(opts) {
  return initLabFeatures(opts);
}