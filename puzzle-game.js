/** 3D assembly puzzle — scatter parts and snap them back into place. */

import {
  pickSplitCount,
  createSplitSession,
  restoreSplitSession,
  findSplittableMeshes,
} from './puzzle-split.js';

const SNAP_COLOR = 0x34d399;
const PUZZELED_MAX = 24;

function isPuzzlePart(obj) {
  if (!obj || obj.userData?.nonSelectable) return false;
  if (obj.userData?.multiModelEntry) return false;
  if (obj.userData?.puzzleSplitHidden) return false;
  return obj.isMesh || obj.isLine || obj.isLineSegments || obj.isLineLoop;
}

function collectParts(root) {
  const parts = [];
  if (!root) return parts;
  root.traverse((child) => {
    if (isPuzzlePart(child)) parts.push(child);
  });
  return parts;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getModelSpan(root, THREE) {
  if (!root?.children?.length) return 10;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z, 1);
}

function pickPartCount(total, difficulty) {
  if (difficulty === 'easy') return Math.min(4, Math.max(2, Math.ceil(total * 0.35)));
  if (difficulty === 'hard') return Math.min(PUZZELED_MAX, total);
  return Math.min(8, Math.max(3, Math.ceil(total * 0.55)));
}

function scatterOffset(span, difficulty, THREE) {
  const factor = difficulty === 'easy' ? 0.42 : difficulty === 'hard' ? 0.95 : 0.65;
  const r = span * factor;
  return new THREE.Vector3(
    (Math.random() - 0.5) * 2 * r,
    (Math.random() - 0.5) * 2 * r,
    (Math.random() - 0.5) * 2 * r,
  );
}

function backupMaterialVisual(obj) {
  if (!obj.material || obj.userData._puzzleMat) return;
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  obj.userData._puzzleMat = mats.map((m) => ({
    emissive: m.emissive?.clone?.(),
    emissiveIntensity: m.emissiveIntensity ?? 0,
    color: m.color?.clone?.(),
  }));
}

function setPartSnappedVisual(obj, snapped) {
  if (!obj.material) return;
  backupMaterialVisual(obj);
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  const backups = obj.userData._puzzleMat;
  mats.forEach((m, i) => {
    if (!m) return;
    if (snapped) {
      if (m.emissive) {
        m.emissive.set(SNAP_COLOR);
        m.emissiveIntensity = 0.35;
      } else if (m.color) {
        m.color.set(SNAP_COLOR);
      }
    } else if (backups?.[i]) {
      if (m.emissive && backups[i].emissive) {
        m.emissive.copy(backups[i].emissive);
        m.emissiveIntensity = backups[i].emissiveIntensity;
      } else if (m.color && backups[i].color) {
        m.color.copy(backups[i].color);
      }
    }
    m.needsUpdate = true;
  });
}

function clearPartVisual(obj) {
  if (!obj.material || !obj.userData._puzzleMat) return;
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  obj.userData._puzzleMat.forEach((bak, i) => {
    const m = mats[i];
    if (!m) return;
    if (m.emissive && bak.emissive) {
      m.emissive.copy(bak.emissive);
      m.emissiveIntensity = bak.emissiveIntensity;
    } else if (m.color && bak.color) {
      m.color.copy(bak.color);
    }
    m.needsUpdate = true;
  });
  delete obj.userData._puzzleMat;
}

/**
 * @param {{
 *   THREE: typeof import('three'),
 *   container: HTMLElement | null,
 *   getModelRoot: () => import('three').Object3D | null,
 *   getIs2d: () => boolean,
 *   editToolsMgr: () => object | null,
 *   onPartsChanged?: Function,
 *   t: Function,
 *   showToast: Function,
 * }} opts
 */
export function initPuzzleGame({
  THREE,
  container,
  getModelRoot,
  getIs2d,
  editToolsMgr,
  onPartsChanged = () => {},
  t,
  showToast,
}) {
  if (!container) {
    return {
      onStructureChange: () => {},
      onModelLoaded: () => {},
      onModelCleared: () => {},
      isActive: () => false,
    };
  }

  let active = false;
  let difficulty = 'normal';
  let puzzleParts = [];
  /** @type {Map<string, import('three').Vector3>} */
  const solvedPositions = new Map();
  const snapped = new Set();
  let snapThreshold = 1;
  let timerStart = 0;
  let timerId = null;
  /** @type {ReturnType<typeof createSplitSession> | null} */
  let splitSession = null;

  const hud = document.createElement('div');
  hud.id = 'puzzle-hud';
  hud.className = 'puzzle-hud hidden';
  hud.innerHTML = `
    <div class="puzzle-hud-inner">
      <span class="puzzle-hud-title" data-puzzle-hud="title"></span>
      <span class="puzzle-hud-progress" data-puzzle-hud="progress"></span>
      <span class="puzzle-hud-time" data-puzzle-hud="time"></span>
      <button type="button" class="btn btn-sm puzzle-hud-stop" data-puzzle-hud="stop"></button>
    </div>
  `;

  const viewport = document.querySelector('.viewport');
  viewport?.appendChild(hud);

  const hudStop = hud.querySelector('[data-puzzle-hud="stop"]');

  const els = {
    title: hud.querySelector('[data-puzzle-hud="title"]'),
    progress: hud.querySelector('[data-puzzle-hud="progress"]'),
    time: hud.querySelector('[data-puzzle-hud="time"]'),
    status: null,
    start: null,
    reshuffle: null,
    stop: null,
    diff: null,
  };

  container.innerHTML = `
    <p class="dock-popup-lab-note puzzle-desc" data-i18n="puzzleDesc"></p>
    <div class="dock-panel-form puzzle-panel-form">
      <div class="select-group">
        <label for="puzzle-difficulty" data-i18n="puzzleDifficulty">난이도</label>
        <select id="puzzle-difficulty" class="select-input">
          <option value="easy" data-i18n="puzzleDiffEasy">쉬움</option>
          <option value="normal" selected data-i18n="puzzleDiffNormal">보통</option>
          <option value="hard" data-i18n="puzzleDiffHard">어려움</option>
        </select>
      </div>
      <p id="puzzle-status" class="puzzle-status"></p>
      <div class="btn-row puzzle-btn-row">
        <button type="button" id="btn-puzzle-start" class="btn btn-primary" data-i18n="puzzleStart">퍼즐 시작</button>
        <button type="button" id="btn-puzzle-reshuffle" class="btn hidden" data-i18n="puzzleReset">다시 섞기</button>
      </div>
      <button type="button" id="btn-puzzle-stop" class="btn btn-block hidden" data-i18n="puzzleStop">종료</button>
      <p class="dock-popup-lab-note puzzle-hint" data-i18n="puzzleHint"></p>
    </div>
  `;

  els.status = container.querySelector('#puzzle-status');
  els.start = container.querySelector('#btn-puzzle-start');
  els.reshuffle = container.querySelector('#btn-puzzle-reshuffle');
  els.stop = container.querySelector('#btn-puzzle-stop');
  els.diff = container.querySelector('#puzzle-difficulty');

  function localizePuzzleUi() {
    container.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const text = t(key);
      if (el.tagName === 'OPTION') el.text = text;
      else el.textContent = text;
    });
  }
  localizePuzzleUi();

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function updateHud() {
    if (!active) return;
    const placed = snapped.size;
    const total = puzzleParts.length;
    els.title.textContent = t('puzzleActive');
    els.progress.textContent = t('puzzleProgress', { placed, total });
    els.time.textContent = t('puzzleTime', { time: formatTime(Date.now() - timerStart) });
    hudStop.textContent = t('puzzleStop');
  }

  function startTimer() {
    stopTimer();
    timerStart = Date.now();
    timerId = window.setInterval(updateHud, 1000);
    updateHud();
  }

  function stopTimer() {
    if (timerId != null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function setUiPlaying(on) {
    els.start?.classList.toggle('hidden', on);
    els.reshuffle?.classList.toggle('hidden', !on);
    els.stop?.classList.toggle('hidden', !on);
    els.diff.disabled = on;
    hud.classList.toggle('hidden', !on);
  }

  function unlockPart(obj) {
    if (obj.userData.puzzleLocked) {
      delete obj.userData.puzzleLocked;
      delete obj.userData.nonSelectable;
    }
    clearPartVisual(obj);
  }

  function releaseAllParts({ restorePositions = true } = {}) {
    for (const obj of puzzleParts) {
      if (restorePositions) {
        const solved = solvedPositions.get(obj.uuid);
        if (solved) obj.position.copy(solved);
      }
      unlockPart(obj);
    }
    snapped.clear();
  }

  function disableEditMode() {
    const mgr = editToolsMgr?.();
    mgr?.setEditMode(false);
    mgr?.clearSelection?.();
    const toggle = document.getElementById('toggle-edit-mode');
    if (toggle) toggle.checked = false;
  }

  function clearSplitSession() {
    if (!splitSession) return;
    restoreSplitSession(splitSession.sessions);
    splitSession = null;
    onPartsChanged();
  }

  function stopPuzzle(silent = false) {
    const wasActive = active || puzzleParts.length > 0 || splitSession;
    active = false;
    stopTimer();
    releaseAllParts({ restorePositions: true });
    puzzleParts = [];
    solvedPositions.clear();
    clearSplitSession();
    setUiPlaying(false);
    els.status.textContent = '';
    disableEditMode();
    if (wasActive && !silent) showToast(t('puzzleStopped'), 'info');
  }

  function lockPart(obj) {
    obj.userData.puzzleLocked = true;
    obj.userData.nonSelectable = true;
    setPartSnappedVisual(obj, true);
    snapped.add(obj.uuid);
  }

  function trySnapPart(obj) {
    if (!active || snapped.has(obj.uuid)) return false;
    const solved = solvedPositions.get(obj.uuid);
    if (!solved) return false;
    const dist = obj.position.distanceTo(solved);
    if (dist > snapThreshold) return false;
    obj.position.copy(solved);
    lockPart(obj);
    showToast(t('puzzleSnap'), 'success');
    return true;
  }

  function checkAllSnapped() {
    for (const obj of puzzleParts) {
      if (!snapped.has(obj.uuid)) {
        const solved = solvedPositions.get(obj.uuid);
        if (!solved || obj.position.distanceTo(solved) > snapThreshold * 0.5) return false;
        lockPart(obj);
      }
    }
    return snapped.size === puzzleParts.length;
  }

  function onWin() {
    stopTimer();
    const elapsed = formatTime(Date.now() - timerStart);
    active = false;
    releaseAllParts({ restorePositions: false });
    puzzleParts = [];
    solvedPositions.clear();
    clearSplitSession();
    setUiPlaying(false);
    els.status.textContent = t('puzzleWinTime', { time: elapsed });
    showToast(t('puzzleWin'), 'success');
    disableEditMode();
  }

  function preparePuzzleParts(root) {
    const splitCount = pickSplitCount(difficulty);
    const targets = findSplittableMeshes(root);
    if (!targets.length) return { parts: [], split: false };

    showToast(t('puzzleSplitting', { count: splitCount }), 'info');
    splitSession = createSplitSession({
      THREE,
      root,
      meshes: [targets[0]],
      partCount: splitCount,
      label: t,
      hideOthers: targets.slice(1),
    });

    if (splitSession) {
      const splitParts = collectParts(root).filter((p) => p.userData?.puzzleSplitPart);
      if (splitParts.length >= 2) {
        onPartsChanged();
        return { parts: splitParts, split: true };
      }
      clearSplitSession();
    }

    const allParts = collectParts(root);
    if (allParts.length >= 2) {
      const count = Math.min(pickPartCount(allParts.length, difficulty), allParts.length);
      return { parts: shuffle(allParts).slice(0, count), split: false };
    }

    return { parts: [], split: false };
  }

  function scatterPartsFromSolved(parts) {
    const span = getModelSpan(getModelRoot(), THREE);
    snapThreshold = Math.max(span * 0.07, 0.4);
    for (const obj of parts) {
      const solved = solvedPositions.get(obj.uuid);
      if (!solved) continue;
      snapped.delete(obj.uuid);
      unlockPart(obj);
      obj.position.copy(solved).add(scatterOffset(span, difficulty, THREE));
    }
  }

  function captureSolvedPositions(parts) {
    for (const obj of parts) {
      solvedPositions.set(obj.uuid, obj.position.clone());
    }
  }

  function beginPuzzle(reshuffleOnly = false) {
    const root = getModelRoot();
    if (!root?.children?.length) {
      showToast(t('puzzleNeedModel'), 'error');
      return;
    }
    if (getIs2d?.()) {
      showToast(t('puzzleNeed3d'), 'error');
      return;
    }

    if (active && reshuffleOnly) {
      snapped.clear();
      scatterPartsFromSolved(puzzleParts);
      startTimer();
      updateHud();
      return;
    }

    if (active) stopPuzzle(true);

    difficulty = els.diff?.value || 'normal';
    const { parts, split } = preparePuzzleParts(root);
    if (parts.length < 2) {
      clearSplitSession();
      showToast(t('puzzleNeedParts'), 'error');
      return;
    }

    puzzleParts = parts;
    solvedPositions.clear();
    snapped.clear();

    captureSolvedPositions(puzzleParts);
    scatterPartsFromSolved(puzzleParts);

    active = true;
    setUiPlaying(true);
    els.status.textContent = t('puzzleHint');

    const mgr = editToolsMgr?.();
    mgr?.setEditMode(true);
    mgr?.clearSelection?.();
    const toggle = document.getElementById('toggle-edit-mode');
    if (toggle) toggle.checked = true;

    startTimer();
    if (split) {
      showToast(t('puzzleSplitDone', { count: puzzleParts.length }), 'success');
    }
    showToast(t('puzzleStarted', { count: puzzleParts.length }), 'info');
  }

  function onStructureChange() {
    if (!active) return;
    let changed = false;
    for (const obj of puzzleParts) {
      if (!snapped.has(obj.uuid) && trySnapPart(obj)) changed = true;
    }
    updateHud();
    if (changed && checkAllSnapped()) onWin();
  }

  els.start?.addEventListener('click', () => beginPuzzle(false));
  els.reshuffle?.addEventListener('click', () => beginPuzzle(true));
  els.stop?.addEventListener('click', () => stopPuzzle(false));
  hudStop?.addEventListener('click', () => stopPuzzle(false));

  document.addEventListener('languagechange', () => {
    localizePuzzleUi();
    if (active) updateHud();
  });

  return {
    onStructureChange,
    onModelLoaded() {
      if (active) stopPuzzle(true);
    },
    onModelCleared() {
      stopPuzzle(true);
    },
    isActive: () => active,
  };
}