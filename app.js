import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { generateThreeViewDXF } from './drawing-export.js?v=2.4.1';
import { t, getLanguage } from './i18n.js?v=2.6.0';
import { initVisitorChat } from './visitor-chat.js?v=2.5.6';
import { initViewerFeatures } from './viewer-features.js?v=2.4.1';
import { initRecentFiles, saveRecentFile } from './recent-files.js?v=2.4.1';
import { initModelTabs, captureModelThumbnail } from './model-tabs.js?v=2.6.0';
import { initPartTree, tagPart } from './part-tree.js?v=2.4.1';
import {
  resolveLoadStrategy,
  yieldToMain,
  simplifyGeometryIfNeeded,
  applyLargeModelHints,
  createIndexAttribute,
  throwIfCancelled,
  isLoadCancelled,
} from './large-file-loader.js?v=2.4.1';
import {
  isProprietaryCad,
  getProprietaryCadInfo,
} from './cad-format-guide.js?v=2.4.1';
import {
  getConvertStatus,
  convertFileToStep,
  formatBackendList,
  canConvertExt,
  getConvertBackendsForExt,
} from './cad-step-convert.js?v=2.5.0';
import { isStaticWebDeployment } from './web-config.js?v=2.5.0';
import { createBgPixels } from './bg-pixels.js?v=2.5.6';

let cad2dModule = null;
async function getCad2dModule() {
  if (!cad2dModule) {
    cad2dModule = await import('./cad2d-loader.js?v=2.4.1');
  }
  return cad2dModule;
}

const SUPPORTED_FORMATS = {
  stp: 'STEP', step: 'STEP',
  stl: 'STL',
  stla: 'STL (ASCII)',
  stlb: 'STL (Binary)',
  'stl.gz': 'STL (GZIP)',
  obj: 'OBJ',
  ply: 'PLY',
  glb: 'GLB', gltf: 'GLTF',
  iges: 'IGES', igs: 'IGES',
  brep: 'BREP', brp: 'BREP',
  '3dm': 'Rhino 3DM',
  dxf: 'DXF',
  dwg: 'DWG',
  sldprt: 'SolidWorks', sldasm: 'SolidWorks', slddrw: 'SolidWorks',
  ipt: 'Inventor', iam: 'Inventor', ipn: 'Inventor',
  f3d: 'Fusion 360', f3z: 'Fusion 360',
  prt: 'Creo', asm: 'Creo', drw: 'Creo',
  catpart: 'CATIA', catproduct: 'CATIA', catdrawing: 'CATIA',
  cgr: 'CATIA', model: 'CATIA',
};

const EXPORT_GUIDE_KEYS = {
  solidworks: 'exportGuideSolidworks',
  inventor: 'exportGuideInventor',
  fusion360: 'exportGuideFusion360',
  creo: 'exportGuideCreo',
  catia: 'exportGuideCatia',
};

const CAD_EXTENSIONS = new Set(['stp', 'step', 'iges', 'igs', 'brep', 'brp']);
const CAD2D_EXTENSIONS = new Set(['dxf', 'dwg']);

// ── DOM refs ──
const canvas = document.getElementById('canvas');
const bgPixelsCanvas = document.getElementById('bg-pixels');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const emptyState = document.getElementById('empty-state');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const loadingFilename = document.getElementById('loading-filename');
const loadingPercent = document.getElementById('loading-percent');
const loadingStage = document.getElementById('loading-stage');
const loadingProgressBar = document.getElementById('loading-progress-bar');
const loadingProgressIndeterminate = document.getElementById('loading-progress-indeterminate');
const loadingCancelBtn = document.getElementById('loading-cancel');

let activeLoadController = null;
const loadQualitySelect = document.getElementById('load-quality');
const toastEl = document.getElementById('toast');
let toastTimer = null;
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileFormatEl = document.getElementById('file-format');
const btnSaveAs = document.getElementById('btn-save-as');
const btnExport = document.getElementById('btn-export');
const btnDrawing = document.getElementById('btn-drawing');
const alertModal = document.getElementById('alert-modal');
const alertTitle = document.getElementById('alert-title');
const alertMessage = document.getElementById('alert-message');
const alertOk = document.getElementById('alert-ok');
const convertModal = document.getElementById('convert-modal');
const convertTitle = document.getElementById('convert-title');
const convertMessage = document.getElementById('convert-message');
const convertBackends = document.getElementById('convert-backends');
const convertAutoBtn = document.getElementById('convert-auto');
const convertManualBtn = document.getElementById('convert-manual');
const convertCancelBtn = document.getElementById('convert-cancel');

let convertModalResolve = null;
const saveModal = document.getElementById('save-modal');
const saveFilename = document.getElementById('save-filename');
const saveCancel = document.getElementById('save-cancel');
const saveConfirm = document.getElementById('save-confirm');
const exportModal = document.getElementById('export-modal');
const exportFilename = document.getElementById('export-filename');
const exportFormat = document.getElementById('export-format');
const exportCancel = document.getElementById('export-cancel');
const exportConfirm = document.getElementById('export-confirm');
const drawingModal = document.getElementById('drawing-modal');
const drawingFilename = document.getElementById('drawing-filename');
const drawingFormat = document.getElementById('drawing-format');
const drawingCancel = document.getElementById('drawing-cancel');
const drawingConfirm = document.getElementById('drawing-confirm');
const drawingScale = document.getElementById('drawing-scale');
const drawingLayout = document.getElementById('drawing-layout');
const drawingDimensions = document.getElementById('drawing-dimensions');

const EXPORT_FORMATS = {
  stl: { label: 'STL', desc: '3D Printing Mesh' },
  obj: { label: 'OBJ', desc: 'Universal Mesh' },
  ply: { label: 'PLY', desc: 'Point Cloud / Mesh' },
  glb: { label: 'GLB', desc: 'Web 3D Binary' },
  gltf: { label: 'GLTF', desc: 'Web 3D JSON' },
};

const MIME_TYPES = {
  stl: 'model/stl',
  obj: 'text/plain',
  ply: 'application/octet-stream',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  stp: 'application/step',
  step: 'application/step',
  iges: 'application/iges',
  igs: 'application/iges',
  brep: 'application/octet-stream',
  brp: 'application/octet-stream',
  dxf: 'application/dxf',
  dwg: 'application/acad',
};

// ── Three.js setup ──
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
canvas.style.background = 'transparent';
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
const bgPixels = createBgPixels(bgPixelsCanvas, canvas.parentElement);
const bgColorInput = document.getElementById('bg-color');
if (bgColorInput?.value) bgPixels.setColor(bgColorInput.value);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e7);
camera.up.set(0, 0, 1);
camera.position.set(4, -4, 3.2);
camera.lookAt(0, 0, 0);
const orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 1e7);
orthoCamera.up.set(0, 0, 1);
orthoCamera.position.set(0, 0, 100);
orthoCamera.lookAt(0, 0, 0);

let activeCamera = camera;
let viewMode = '3d';

const controls = new OrbitControls(activeCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
fillLight.position.set(-8, -4, -6);
scene.add(fillLight);

// Helpers
const GRID_PLANE_ROTATIONS = {
  xy: { x: Math.PI / 2, y: 0, z: 0 },       // Z-up (CAD 기본)
  xz: { x: 0, y: 0, z: 0 },                  // Y-up (Three.js 기본)
  yz: { x: 0, y: 0, z: Math.PI / 2 },        // X-up
};

let gridPlane = 'xy';
let gridSize = 20;
let gridHelper = createGrid(gridSize);
scene.add(gridHelper);

function applyGridPlane(helper, plane) {
  const rot = GRID_PLANE_ROTATIONS[plane] || GRID_PLANE_ROTATIONS.xy;
  helper.rotation.set(rot.x, rot.y, rot.z);
}

function createGrid(size) {
  const helper = new THREE.GridHelper(size, 20, 0x3a3f4b, 0x2a2e38);
  applyGridPlane(helper, gridPlane);
  return helper;
}

function rebuildGrid(size = gridSize) {
  const visible = gridHelper.visible;
  scene.remove(gridHelper);
  gridSize = size;
  gridHelper = createGrid(gridSize);
  gridHelper.visible = visible;
  scene.add(gridHelper);
}

const axesHelper = new THREE.AxesHelper(3);
scene.add(axesHelper);

// Model container
const modelGroup = new THREE.Group();
scene.add(modelGroup);

let occt = null;
let defaultMaterial = null;
let autoRotate = false;
const AUTO_ROTATE_SPEED = 1.5;
let initialCameraState = null;
let currentFile = null; // { name, ext, buffer: ArrayBuffer }
let viewerFeatures = null;
let recentFilesMgr = null;
let partTreeMgr = null;
let modelTabsMgr = null;

function getModelTabState() {
  if (!currentFile || modelGroup.children.length === 0) return null;
  return {
    id: modelTabsMgr?.getActiveId() || `${currentFile.name}-${Date.now()}`,
    file: {
      name: currentFile.name,
      ext: currentFile.ext,
      buffer: currentFile.buffer,
    },
    is2d: !!modelGroup.userData.is2d,
    viewMode,
    modelPosition: modelGroup.position.clone(),
    modelRotation: modelGroup.rotation.clone(),
    initialCameraState: initialCameraState ? {
      position: initialCameraState.position.clone(),
      target: initialCameraState.target.clone(),
    } : null,
    gridSize,
    orthoViewSize: orthoCamera.userData.viewSize,
    orthoBounds: viewMode === '2d' ? {
      left: orthoCamera.left,
      right: orthoCamera.right,
      top: orthoCamera.top,
      bottom: orthoCamera.bottom,
    } : null,
    cameraPosition: activeCamera.position.clone(),
    cameraNear: activeCamera.near,
    cameraFar: activeCamera.far,
  };
}

function applyModelTabSession(session) {
  currentFile = {
    name: session.file.name,
    ext: session.file.ext,
    buffer: session.file.buffer,
  };
  modelGroup.position.copy(session.modelPosition);
  modelGroup.rotation.copy(session.modelRotation);
  modelGroup.userData.is2d = session.is2d;

  setViewMode(session.viewMode);

  if (session.gridSize) rebuildGrid(session.gridSize);

  if (session.viewMode === '2d' && session.orthoViewSize) {
    orthoCamera.userData.viewSize = session.orthoViewSize;
    if (session.orthoBounds) {
      orthoCamera.left = session.orthoBounds.left;
      orthoCamera.right = session.orthoBounds.right;
      orthoCamera.top = session.orthoBounds.top;
      orthoCamera.bottom = session.orthoBounds.bottom;
    }
    orthoCamera.near = session.cameraNear ?? 0.01;
    orthoCamera.far = session.cameraFar ?? 10000;
    orthoCamera.position.copy(session.cameraPosition);
    orthoCamera.updateProjectionMatrix();
  } else {
    camera.near = session.cameraNear ?? camera.near;
    camera.far = session.cameraFar ?? camera.far;
    camera.position.copy(session.cameraPosition);
    camera.updateProjectionMatrix();
  }

  if (session.initialCameraState) {
    initialCameraState = {
      position: session.initialCameraState.position.clone(),
      target: session.initialCameraState.target.clone(),
    };
    controls.target.copy(session.initialCameraState.target);
  }
  controls.update();

  const is2d = session.is2d;
  fileNameEl.textContent = currentFile.name;
  fileFormatEl.textContent = SUPPORTED_FORMATS[currentFile.ext] || currentFile.ext.toUpperCase();
  fileInfo.classList.remove('hidden');
  emptyState.classList.add('hidden');
  btnSaveAs.disabled = false;
  btnExport.disabled = is2d;
  btnDrawing.disabled = is2d;

  updateStats();
  partTreeMgr?.refresh(is2d ? 'layers' : 'parts');
  viewerFeatures?.onModelLoaded();
}

function applyDeploymentMode() {
  const notice = document.getElementById('web-deploy-notice');
  const formatsEl = document.getElementById('supported-formats');
  if (isStaticWebDeployment()) {
    notice?.classList.remove('hidden');
    if (formatsEl) formatsEl.textContent = t('supportedFormatsWeb');
  } else {
    notice?.classList.add('hidden');
    if (formatsEl) formatsEl.textContent = t('supportedFormatsLocal');
  }
}

// ── Init ──
async function init() {
  resize();
  window.addEventListener('resize', resize);
  setupUI();
  applyDeploymentMode();
  document.addEventListener('languagechange', applyDeploymentMode);
  recentFilesMgr = initRecentFiles({ onOpenFile: loadFile, t });
  partTreeMgr = initPartTree({ modelGroup, t, THREE });
  modelTabsMgr = initModelTabs({
    t,
    THREE,
    modelGroup,
    maxTabs: 4,
    captureThumbnail: (group) => captureModelThumbnail(THREE, group),
    getState: getModelTabState,
    applyState: applyModelTabSession,
  });
  viewerFeatures = initViewerFeatures({
    scene,
    camera,
    controls,
    renderer,
    canvas,
    modelGroup,
    getViewMode: () => viewMode,
    getActiveCamera: () => activeCamera,
    t,
    showToast,
    downloadBlob,
    getFilenameBase: getBaseFilename,
  });
  initVisitorChat({ t, showToast, getLang: getLanguage });
  animate();

  if (location.protocol === 'file:') {
    showAlert(t('startupGuideTitle'), t('startupGuideMsg'));
  }

  showLoading(t('cadEngineInit'), { stage: 'engine' });
  try {
    const occtPromise = occtimportjs({
      locateFile: (path) =>
        `https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/${path}`,
    });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(t('cadEngineTimeout'))), 20000);
    });
    occt = await Promise.race([occtPromise, timeout]);
  } catch (e) {
    console.warn('occt-import-js init failed:', e);
  } finally {
    hideLoading();
  }

  defaultMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b9bd1,
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });

  btnSaveAs.disabled = true;
  btnExport.disabled = true;
  btnDrawing.disabled = true;

  getConvertStatus();
}

function resize() {
  const viewport = canvas.parentElement;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  bgPixels.resize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (viewMode === '2d' && orthoCamera.userData.viewSize) {
    const { viewSize } = orthoCamera.userData;
    const aspect = w / h;
    orthoCamera.left = -viewSize * aspect / 2;
    orthoCamera.right = viewSize * aspect / 2;
    orthoCamera.top = viewSize / 2;
    orthoCamera.bottom = -viewSize / 2;
    orthoCamera.updateProjectionMatrix();
  }
  renderer.setSize(w, h, false);
}

function animate() {
  requestAnimationFrame(animate);
  bgPixels.tick();
  controls.update();
  renderer.render(scene, activeCamera);
}

function setViewMode(mode) {
  viewMode = mode;
  if (mode === '2d') {
    activeCamera = orthoCamera;
    controls.object = orthoCamera;
    controls.enableRotate = false;
    autoRotate = false;
    controls.autoRotate = false;
    const autoRotateEl = document.getElementById('toggle-auto-rotate');
    if (autoRotateEl) autoRotateEl.checked = false;
    document.getElementById('grid-plane').value = 'xy';
    gridPlane = 'xy';
    rebuildGrid(gridSize);
  } else {
    activeCamera = camera;
    controls.object = camera;
    controls.enableRotate = true;
  }
  controls.update();
}

// ── UI events ──
function openFilePicker() {
  if (!fileInput) return;
  fileInput.click();
}

function setupUI() {
  if (!fileInput || !dropZone) {
    showAlert(t('initErrorTitle'), t('initErrorUINotFound'));
    return;
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btn-open-file')?.addEventListener('click', (e) => {
    e.preventDefault();
    openFilePicker();
  });

  emptyState?.querySelectorAll('.empty-open-trigger').forEach((el) => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFilePicker();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    });
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  document.getElementById('toggle-grid').addEventListener('change', (e) => {
    gridHelper.visible = e.target.checked;
  });
  document.getElementById('grid-plane').addEventListener('change', (e) => {
    gridPlane = e.target.value;
    rebuildGrid(gridSize);
  });
  document.getElementById('toggle-axes').addEventListener('change', (e) => {
    axesHelper.visible = e.target.checked;
  });
  document.getElementById('toggle-wireframe').addEventListener('change', (e) => {
    modelGroup.traverse((child) => {
      if (child.isMesh) child.material.wireframe = e.target.checked;
    });
  });
  document.getElementById('toggle-auto-rotate').addEventListener('change', (e) => {
    autoRotate = e.target.checked;
    if (autoRotate) {
      gridPlane = 'xy';
      const gridPlaneEl = document.getElementById('grid-plane');
      if (gridPlaneEl) gridPlaneEl.value = 'xy';
      rebuildGrid(gridSize);
      if (viewMode === '3d') {
        camera.up.set(0, 0, 1);
        modelGroup.rotation.set(0, 0, 0);
        controls.autoRotate = true;
        controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
      }
    } else {
      controls.autoRotate = false;
    }
  });
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-fit').addEventListener('click', fitToView);
  document.getElementById('bg-color').addEventListener('input', (e) => {
    bgPixels.setColor(e.target.value);
  });
  document.getElementById('model-color').addEventListener('input', (e) => {
    const color = new THREE.Color(e.target.value);
    modelGroup.traverse((child) => {
      if (child.material?.color) child.material.color.copy(color);
    });
  });

  btnSaveAs.addEventListener('click', saveAs);
  btnExport.addEventListener('click', openExportModal);
  btnDrawing.addEventListener('click', openDrawingModal);
  saveCancel.addEventListener('click', closeSaveModal);
  saveConfirm.addEventListener('click', confirmSaveAs);
  saveModal.querySelector('.modal-backdrop').addEventListener('click', closeSaveModal);
  saveFilename.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSaveAs();
    if (e.key === 'Escape') closeSaveModal();
  });

  exportCancel.addEventListener('click', closeExportModal);
  exportConfirm.addEventListener('click', confirmExport);
  exportModal.querySelector('.modal-backdrop').addEventListener('click', closeExportModal);
  exportFormat.addEventListener('change', updateExportFilenameExt);
  exportFilename.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmExport();
    if (e.key === 'Escape') closeExportModal();
  });

  drawingCancel.addEventListener('click', closeDrawingModal);
  drawingConfirm.addEventListener('click', confirmDrawingExport);
  drawingModal.querySelector('.modal-backdrop').addEventListener('click', closeDrawingModal);
  drawingFilename.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmDrawingExport();
    if (e.key === 'Escape') closeDrawingModal();
  });

  alertOk.addEventListener('click', closeAlert);
  alertModal.querySelector('.modal-backdrop').addEventListener('click', closeAlert);

  convertAutoBtn?.addEventListener('click', () => closeConvertModal('auto'));
  convertManualBtn?.addEventListener('click', () => closeConvertModal('manual'));
  convertCancelBtn?.addEventListener('click', () => closeConvertModal('cancel'));
  convertModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeConvertModal('cancel'));
  document.addEventListener('languagechange', () => {
    if (loadingEl.classList.contains('hidden')) {
      loadingText.textContent = t('loadingFile');
    }
    if (modelGroup.children.length > 0) {
      const is2d = modelGroup.userData.is2d;
      partTreeMgr?.refresh(is2d ? 'layers' : 'parts');
    }
  });
  loadingCancelBtn?.addEventListener('click', cancelLoading);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!loadingEl.classList.contains('hidden') && activeLoadController?.cancellable) {
        e.preventDefault();
        cancelLoading();
        return;
      }
      if (!alertModal.classList.contains('hidden')) closeAlert();
      if (!saveModal.classList.contains('hidden')) closeSaveModal();
      if (!exportModal.classList.contains('hidden')) closeExportModal();
      if (!drawingModal.classList.contains('hidden')) closeDrawingModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        if (!btnExport.disabled) openExportModal();
      } else if (!btnSaveAs.disabled) {
        saveAs();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (!btnDrawing.disabled) openDrawingModal();
    }
  });
}

function parseFileExtension(filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.stl.gz')) return 'stl.gz';
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts.pop().toLowerCase();
}

// ── File loading ──
async function loadFile(file, options = {}) {
  if (!file || file.size === 0) {
    showAlert(t('fileError'), t('fileErrorEmpty'));
    return;
  }

  const ext = parseFileExtension(file.name);
  if (!ext) {
    showAlert(t('fileError'), t('fileErrorNoExt'));
    return;
  }
  if (!SUPPORTED_FORMATS[ext]) {
    showAlert(t('unsupportedFormat'), t('unsupportedFormatMsg', { ext }));
    return;
  }

  if (isProprietaryCad(ext) && !options.converted) {
    await handleProprietaryCad(file, ext);
    return;
  }

  const strategy = resolveLoadStrategy(
    file.size,
    ext,
    loadQualitySelect?.value || 'auto',
  );

  showLoading(t('loadingFileNamed', { name: file.name }), {
    filename: file.name,
    stage: 'parse',
    cancellable: true,
  });
  if (!options.fromTab) {
    modelTabsMgr?.stashCurrent();
  }
  clearModel();

  try {
    throwIfCancelled(getLoadSignal());
    const buffer = await file.arrayBuffer();
    throwIfCancelled(getLoadSignal());
    if (buffer.byteLength === 0) {
      throw new Error(t('fileEmptyContent'));
    }

    const uint8 = new Uint8Array(buffer);
    const loadOpts = {
      strategy,
      signal: getLoadSignal(),
      onProgress: (current, total, phase) => updateLoadProgress(current, total, phase),
    };

    modelGroup.userData.is2d = false;
    if (CAD2D_EXTENSIONS.has(ext)) {
      setViewMode('2d');
      await loadCAD2D(uint8, ext, loadOpts);
    } else if (CAD_EXTENSIONS.has(ext)) {
      setViewMode('3d');
      await loadCAD(uint8, ext, loadOpts);
    } else if (ext === '3dm') {
      setViewMode('3d');
      await loadRhino3dmFile(uint8, loadOpts);
    } else {
      setViewMode('3d');
      await loadMesh(uint8, ext, file.name, loadOpts);
    }

    applyLargeModelHints(modelGroup, strategy);
    if (strategy.fastPreview) {
      showToast(t('largeFileFastMode'), 'info');
    }

    if (modelGroup.children.length === 0) {
      throw new Error(t('noModelData'));
    }

    currentFile = { name: file.name, ext, buffer };
    const is2d = CAD2D_EXTENSIONS.has(ext);
    btnSaveAs.disabled = false;
    btnExport.disabled = is2d;
    btnDrawing.disabled = is2d;

    fileNameEl.textContent = options.originalName || file.name;
    fileFormatEl.textContent = options.converted && options.originalExt
      ? t('convertedFromFormat', { format: 'STEP', ext: options.originalExt })
      : SUPPORTED_FORMATS[ext];
    fileInfo.classList.remove('hidden');
    emptyState.classList.add('hidden');

    fitToView();
    updateStats();
    saveRecentFile(file.name, ext, buffer);
    recentFilesMgr?.refresh();
    modelTabsMgr?.registerLoaded();
    viewerFeatures?.onModelLoaded();
    partTreeMgr?.refresh(CAD2D_EXTENSIONS.has(ext) ? 'layers' : 'parts');
  } catch (err) {
    if (isLoadCancelled(err)) {
      clearModel();
      setViewMode('3d');
      currentFile = null;
      btnSaveAs.disabled = true;
      btnExport.disabled = true;
      btnDrawing.disabled = true;
      fileInfo.classList.add('hidden');
      emptyState.classList.remove('hidden');
      showToast(t('loadingCancelled'), 'info');
      return;
    }
    console.error(err);
    clearModel();
    setViewMode('3d');
    currentFile = null;
    btnSaveAs.disabled = true;
    btnExport.disabled = true;
    btnDrawing.disabled = true;
    fileInfo.classList.add('hidden');
    emptyState.classList.remove('hidden');
    showAlert(t('loadFailed'), err.message || t('unknownError'));
  } finally {
    hideLoading();
  }
}

async function loadRhino3dmFile(buffer, { signal, onProgress } = {}) {
  throwIfCancelled(signal);
  onProgress?.(0, 1, 'parse');
  const { loadRhino3dm } = await import('./rhino-loader.js?v=2.4.1');
  let obj;
  try {
    obj = await loadRhino3dm(buffer, { signal });
  } catch (err) {
    if (isLoadCancelled(err)) throw err;
    console.error(err);
    throw new Error(t('rhino3dmLoadFailed'));
  }
  throwIfCancelled(signal);
  let partIdx = 0;
  obj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      tagPart(child, child.name || `Part ${partIdx + 1}`, partIdx++);
    }
  });
  modelGroup.add(obj);
}

async function loadCAD2D(buffer, ext, { strategy, onProgress, signal } = {}) {
  throwIfCancelled(signal);
  let cad2d;
  try {
    cad2d = await getCad2dModule();
  } catch (e) {
    console.error(e);
    throw new Error(t('cad2dModuleError'));
  }
  throwIfCancelled(signal);

  let cadGroup;
  try {
    if (ext === 'dxf') {
      cadGroup = await cad2d.loadDxf(buffer, THREE, {
        progressive: strategy?.progressive,
        dxfBatchSize: strategy?.dxfBatchSize,
        yieldFn: () => yieldToMain(signal),
        signal,
        onProgress: (current, total) => onProgress?.(current, total, 'entities'),
      });
    } else {
      cadGroup = await cad2d.loadDwg(buffer, THREE, {
        signal,
        onProgress: (current, total) => onProgress?.(current, total, 'entities'),
      });
    }
  throwIfCancelled(signal);
  } catch (e) {
    console.error(e);
    throw e;
  }
  modelGroup.add(cadGroup);
  modelGroup.userData.is2d = true;
}

async function addCadMesh(meshData, index, strategy, onProgress, total) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3),
  );
  if (meshData.attributes.normal) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3),
    );
  } else if (!strategy?.fastPreview) {
    geometry.computeVertexNormals();
  }
  if (meshData.index?.array) {
    geometry.setIndex(createIndexAttribute(THREE, meshData.index.array));
  }

  let material;
  if (meshData.color) {
    material = defaultMaterial.clone();
    material.color.setRGB(meshData.color[0], meshData.color[1], meshData.color[2]);
  } else {
    material = defaultMaterial.clone();
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = !strategy?.disableShadows;
  mesh.receiveShadow = !strategy?.disableShadows;
  tagPart(mesh, meshData.name, index);
  modelGroup.add(mesh);
  onProgress?.(index + 1, total, 'meshes');
}

async function loadCAD(buffer, ext, { strategy, onProgress, signal } = {}) {
  if (!occt) {
    throw new Error(t('stepEngineNotReady'));
  }

  throwIfCancelled(signal);
  onProgress?.(0, 1, 'parse');
  await yieldToMain(signal);

  const params = strategy?.cadParams || {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.01,
    angularDeflection: 0.5,
  };

  if (strategy?.tier === 'large' || strategy?.tier === 'huge') {
    loadingText.textContent = t('cadParseBlocking');
    setLoadingStage('parse');
    showToast(t('cadParseBlocking'), 'info');
  }

  let result;
  if (ext === 'stp' || ext === 'step') {
    result = occt.ReadStepFile(buffer, params);
  } else if (ext === 'iges' || ext === 'igs') {
    result = occt.ReadIgesFile(buffer, params);
  } else {
    result = occt.ReadBrepFile(buffer, params);
  }
  throwIfCancelled(signal);
  throwIfCancelled(signal);

  if (!result.success) {
    throw new Error(t('cadParseFailed'));
  }

  if (!result.meshes || result.meshes.length === 0) {
    throw new Error(t('cadNoGeometry'));
  }

  const total = result.meshes.length;
  const batch = strategy?.meshBatchSize || 20;
  for (let i = 0; i < total; i++) {
    throwIfCancelled(signal);
    await addCadMesh(result.meshes[i], i, strategy, onProgress, total);
    if (strategy?.progressive && (i + 1) % batch === 0) {
      await yieldToMain(signal);
    }
  }
}

async function finalizeMeshGeometry(geometry, strategy, onProgress, signal) {
  throwIfCancelled(signal);
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  if (!Number.isFinite(strategy?.maxTriangles)) return geometry;
  onProgress?.(0, 1, 'simplify');
  return simplifyGeometryIfNeeded(THREE, SimplifyModifier, geometry, strategy.maxTriangles, signal);
}

async function loadMesh(buffer, ext, filename, { strategy, onProgress, signal } = {}) {
  throwIfCancelled(signal);
  const { isStlExtension, loadStl } = await import('./stl-loader.js?v=2.5.1');
  if (isStlExtension(ext)) {
    let parts;
    try {
      parts = await loadStl(buffer, THREE, { ext, signal, onProgress });
    } catch (err) {
      if (err?.message === 'GZIP_STL_UNSUPPORTED') throw new Error(t('stlGzipUnsupported'));
      if (err?.message === 'STL_PARSE_FAILED') throw new Error(t('stlInvalid'));
      if (err?.message === 'STL_NO_VERTICES') throw new Error(t('stlNoVertices'));
      throw err;
    }

    const stem = filename.replace(/\.(stl\.gz|stla|stlb|stl)$/i, '');
    for (let i = 0; i < parts.length; i++) {
      throwIfCancelled(signal);
      const part = parts[i];
      let geometry = part.geometry;
      geometry = await finalizeMeshGeometry(geometry, strategy, onProgress, signal);
      throwIfCancelled(signal);
      const material = defaultMaterial.clone();
      if (geometry.attributes.color) material.vertexColors = true;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = !strategy?.disableShadows;
      tagPart(mesh, parts.length > 1 ? part.name : stem, i);
      modelGroup.add(mesh);
      if (strategy?.progressive) await yieldToMain(signal);
    }
    return;
  }

  if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    let obj;
    try {
      obj = new OBJLoader().parse(text);
    } catch {
      throw new Error(t('objInvalid'));
    }
    const meshes = [];
    obj.traverse((child) => { if (child.isMesh) meshes.push(child); });
    let partIdx = 0;
    for (const child of meshes) {
      throwIfCancelled(signal);
      if (child.geometry) {
        child.geometry = await finalizeMeshGeometry(child.geometry, strategy, onProgress, signal);
      }
      child.material = defaultMaterial.clone();
      child.castShadow = !strategy?.disableShadows;
      child.receiveShadow = !strategy?.disableShadows;
      tagPart(child, child.name, partIdx++);
      if (strategy?.progressive) await yieldToMain(signal);
    }
    modelGroup.add(obj);
    return;
  }

  if (ext === 'ply') {
    let geometry;
    try {
      geometry = new PLYLoader().parse(buffer);
    } catch {
      throw new Error(t('plyInvalid'));
    }
    geometry = await finalizeMeshGeometry(geometry, strategy, onProgress, signal);
    throwIfCancelled(signal);
    const mesh = new THREE.Mesh(geometry, defaultMaterial.clone());
    mesh.castShadow = !strategy?.disableShadows;
    tagPart(mesh, filename.replace(/\.[^.]+$/, ''), 0);
    modelGroup.add(mesh);
    return;
  }

  if (ext === 'glb' || ext === 'gltf') {
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    try {
      throwIfCancelled(signal);
      const gltf = await new GLTFLoader().loadAsync(url);
      throwIfCancelled(signal);
      let partIdx = 0;
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = !strategy?.disableShadows;
          child.receiveShadow = !strategy?.disableShadows;
          tagPart(child, child.name, partIdx++);
        }
      });
      modelGroup.add(gltf.scene);
    } catch {
      throw new Error(t('gltfInvalid'));
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }

  throw new Error(t('formatNotImplemented', { ext }));
}

// ── View helpers ──
function clearModel({ dispose = true } = {}) {
  while (modelGroup.children.length > 0) {
    const child = modelGroup.children[0];
    modelGroup.remove(child);
    if (dispose) {
      child.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
  }
  modelGroup.position.set(0, 0, 0);
  modelGroup.rotation.set(0, 0, 0);
  modelGroup.userData.is2d = false;
  viewerFeatures?.onModelCleared();
  partTreeMgr?.clear();
}

function fitToView() {
  if (modelGroup.children.length === 0) return;

  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);

  modelGroup.position.sub(center);

  if (viewMode === '2d') {
    const padding = 1.15;
    const viewW = Math.max(size.x, 1);
    const viewH = Math.max(size.y, 1);
    const viewSize = Math.max(viewW, viewH) * padding;
    orthoCamera.userData.viewSize = viewSize;
    const viewport = canvas.parentElement;
    const aspect = viewport.clientWidth / viewport.clientHeight;
    orthoCamera.left = -viewSize * aspect / 2;
    orthoCamera.right = viewSize * aspect / 2;
    orthoCamera.top = viewSize / 2;
    orthoCamera.bottom = -viewSize / 2;
    orthoCamera.position.set(0, 0, 100);
    orthoCamera.near = 0.01;
    orthoCamera.far = 10000;
    orthoCamera.lookAt(0, 0, 0);
    orthoCamera.updateProjectionMatrix();
    rebuildGrid(Math.ceil(viewSize * 2));
  } else {
    const fov = camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.6;
    camera.up.set(0, 0, 1);
    camera.position.set(dist * 0.75, -dist * 0.75, dist * 0.6);
    camera.lookAt(0, 0, 0);
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    rebuildGrid(Math.ceil(maxDim * 2));
  }

  controls.target.set(0, 0, 0);
  controls.update();

  initialCameraState = {
    position: activeCamera.position.clone(),
    target: controls.target.clone(),
  };
}

function resetView() {
  if (initialCameraState) {
    activeCamera.position.copy(initialCameraState.position);
    controls.target.copy(initialCameraState.target);
    controls.update();
  } else {
    fitToView();
  }
  modelGroup.rotation.set(0, 0, 0);
}

function updateStats() {
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;

  modelGroup.traverse((child) => {
    if ((child.isMesh || child.isLine || child.isLineSegments || child.isLineLoop) && child.geometry) {
      meshes++;
      const pos = child.geometry.attributes.position;
      if (pos) vertices += pos.count;
      const idx = child.geometry.index;
      if (idx) triangles += idx.count / 3;
      else if (pos) triangles += Math.max(0, pos.count - (child.isLineLoop ? 0 : 1));
    }
  });

  const box = new THREE.Box3().setFromObject(modelGroup);
  const size = box.getSize(new THREE.Vector3());

  document.getElementById('stat-vertices').textContent = vertices.toLocaleString();
  document.getElementById('stat-triangles').textContent = Math.floor(triangles).toLocaleString();
  document.getElementById('stat-meshes').textContent = meshes.toLocaleString();
  document.getElementById('stat-size').textContent =
    `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`;
}

const LOADING_STAGE_KEYS = {
  parse: 'loadingStageParse',
  meshes: 'loadingStageMeshes',
  entities: 'loadingStageEntities',
  simplify: 'loadingStageSimplify',
  convert: 'loadingStageConvert',
  drawing: 'loadingStageDrawing',
  engine: 'loadingStageEngine',
};

function setLoadingStage(stage) {
  if (!loadingStage) return;
  const key = stage && LOADING_STAGE_KEYS[stage];
  loadingStage.textContent = key ? t(key) : '';
}

function setLoadingProgress(ratio, indeterminate = false) {
  const pct = Math.round(Math.max(0, Math.min(100, ratio * 100)));
  const showIndeterminate = indeterminate && pct === 0;

  if (loadingPercent) {
    loadingPercent.textContent = showIndeterminate ? '...' : `${pct}%`;
  }
  if (loadingProgressIndeterminate) {
    loadingProgressIndeterminate.classList.toggle('hidden', !showIndeterminate);
  }
  if (loadingProgressBar) {
    loadingProgressBar.classList.toggle('hidden', showIndeterminate);
    loadingProgressBar.style.width = `${pct}%`;
  }
}

function updateLoadProgress(current, total, phase) {
  const ratio = total > 0 ? current / total : 0;
  setLoadingProgress(ratio, false);
  setLoadingStage(phase);
  if (phase === 'meshes') {
    loadingText.textContent = t('loadingMeshes', { current, total });
  } else if (phase === 'entities') {
    loadingText.textContent = t('loadingEntities', { current, total });
  } else if (phase === 'simplify') {
    loadingText.textContent = t('loadingSimplify');
  } else if (phase === 'parse') {
    loadingText.textContent = t('loadingParse');
  }
}

function getLoadSignal() {
  return activeLoadController?.controller?.signal ?? null;
}

function cancelLoading() {
  if (!activeLoadController?.cancellable) return;
  activeLoadController.controller.abort();
  if (loadingCancelBtn) loadingCancelBtn.disabled = true;
  loadingText.textContent = t('loadingCancelling');
}

function showLoading(msg, options = {}) {
  activeLoadController?.controller?.abort();

  const cancellable = !!options.cancellable;
  activeLoadController = cancellable
    ? { controller: new AbortController(), cancellable: true }
    : null;

  loadingText.textContent = msg;
  if (loadingFilename) {
    if (options.filename) {
      loadingFilename.textContent = options.filename;
      loadingFilename.classList.remove('hidden');
    } else {
      loadingFilename.textContent = '';
      loadingFilename.classList.add('hidden');
    }
  }
  setLoadingStage(options.stage);
  setLoadingProgress(0, true);
  loadingEl.classList.remove('hidden');
  loadingEl.setAttribute('aria-busy', 'true');
  document.body.classList.add('is-loading');
  if (loadingCancelBtn) {
    loadingCancelBtn.classList.toggle('hidden', !cancellable);
    loadingCancelBtn.disabled = false;
    loadingCancelBtn.textContent = t('loadingCancel');
  }
}

function hideLoading() {
  activeLoadController = null;
  loadingEl.classList.add('hidden');
  loadingEl.setAttribute('aria-busy', 'false');
  document.body.classList.remove('is-loading');
  setLoadingProgress(0, false);
  setLoadingStage(null);
  if (loadingFilename) loadingFilename.classList.add('hidden');
  if (loadingCancelBtn) {
    loadingCancelBtn.classList.add('hidden');
    loadingCancelBtn.disabled = false;
  }
}

function showAlert(title, message) {
  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alertModal.classList.remove('hidden');
  alertOk.focus();
}

function closeAlert() {
  alertModal.classList.add('hidden');
}

function showConvertModal(file, ext, status, canAuto) {
  if (!convertModal) return Promise.resolve('manual');

  const info = getProprietaryCadInfo(ext);
  const label = info?.label || `.${ext}`;
  const relevant = getConvertBackendsForExt(ext, status);

  convertTitle.textContent = t('autoConvertTitle');
  convertMessage.textContent = canAuto
    ? t('autoConvertConfirm', { name: file.name, label })
    : t('autoConvertConfirmManualOnly', { name: file.name, label });

  if (convertAutoBtn) {
    convertAutoBtn.disabled = !canAuto;
    convertAutoBtn.classList.toggle('hidden', !canAuto);
  }

  if (convertBackends) {
    if (canAuto && relevant.length) {
      convertBackends.textContent = t('convertBackendsAvailable', {
        list: formatBackendList(relevant, t),
      });
      convertBackends.classList.remove('hidden');
    } else if (!canAuto) {
      const needsFreecad = info?.appKey === 'fusion360' || info?.appKey === 'creo';
      convertBackends.textContent = needsFreecad
        ? t('autoConvertNeedsFreecad', { ext })
        : t('autoConvertNeedsApp', { ext });
      convertBackends.classList.remove('hidden');
    } else {
      convertBackends.classList.add('hidden');
    }
  }

  convertModal.classList.remove('hidden');
  (canAuto ? convertAutoBtn : convertManualBtn)?.focus();

  return new Promise((resolve) => {
    convertModalResolve = resolve;
  });
}

function closeConvertModal(choice) {
  if (!convertModal) return;
  convertModal.classList.add('hidden');
  if (convertModalResolve) {
    convertModalResolve(choice);
    convertModalResolve = null;
  }
}

function showManualCadGuide(ext) {
  const info = getProprietaryCadInfo(ext);
  const guideKey = EXPORT_GUIDE_KEYS[info?.appKey];
  showAlert(
    t('proprietaryCadTitle'),
    guideKey ? t(guideKey, { ext }) : t('unsupportedFormatMsg', { ext }),
  );
}

async function handleProprietaryCad(file, ext) {
  const status = await getConvertStatus(false, ext);
  const canAuto = status.canConvert ?? canConvertExt(ext, status);

  if (status.available) {
    const choice = await showConvertModal(file, ext, status, canAuto);
    if (choice === 'auto' && canAuto) {
      await runAutoConvert(file, ext);
      return;
    }
    if (choice === 'manual') {
      showManualCadGuide(ext);
    }
    return;
  }

  const info = getProprietaryCadInfo(ext);
  const guideKey = EXPORT_GUIDE_KEYS[info?.appKey];
  const guide = guideKey ? t(guideKey, { ext }) : t('unsupportedFormatMsg', { ext });
  const unavailableMsg = isStaticWebDeployment()
    ? t('autoConvertUnavailableWeb', { ext })
    : t('autoConvertUnavailable', { ext });
  showAlert(
    t('autoConvertUnavailableTitle'),
    `${unavailableMsg}\n\n${guide}`,
  );
}

async function runAutoConvert(file, ext) {
  showLoading(t('convertingToStep', { name: file.name }), {
    filename: file.name,
    stage: 'convert',
    cancellable: true,
  });

  try {
    const stepFile = await convertFileToStep(file, ext, getLoadSignal());
    hideLoading();
    showToast(t('autoConvertSuccess', { name: stepFile.name }), 'success');
    await loadFile(stepFile, {
      converted: true,
      originalName: file.name,
      originalExt: ext,
    });
  } catch (err) {
    hideLoading();
    if (isLoadCancelled(err)) return;
    showAlert(t('autoConvertFailed'), err.message || t('unknownError'));
  }
}

function getFileBlob() {
  if (!currentFile) return null;
  return new Blob([currentFile.buffer], {
    type: MIME_TYPES[currentFile.ext] || 'application/octet-stream',
  });
}

function getSavePickerTypes(ext) {
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  return [{
    description: SUPPORTED_FORMATS[ext] || ext.toUpperCase(),
    accept: { [mime]: [`.${ext}`] },
  }];
}

function normalizeFilename(name, ext) {
  let safe = sanitizeFilename(name);
  if (!safe) return null;
  if (!safe.toLowerCase().endsWith(`.${ext}`)) {
    safe += `.${ext}`;
  }
  return safe;
}

async function saveAs() {
  if (!currentFile) {
    showAlert(t('saveUnavailable'), t('saveNoFile'));
    return;
  }

  const blob = getFileBlob();
  if (!blob) return;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: currentFile.name,
        types: getSavePickerTypes(currentFile.ext),
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast(t('savedToast', { name: handle.name }), 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        showAlert(t('saveFailed'), err.message || t('saveError'));
      }
    }
    return;
  }

  openSaveModal();
}

function openSaveModal() {
  if (!currentFile) return;
  const baseName = currentFile.name.replace(/\.[^.]+$/, '');
  saveFilename.value = baseName;
  saveModal.classList.remove('hidden');
  saveFilename.focus();
  saveFilename.select();
}

function closeSaveModal() {
  saveModal.classList.add('hidden');
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

async function confirmSaveAs() {
  if (!currentFile) return;

  const filename = normalizeFilename(saveFilename.value, currentFile.ext);
  if (!filename) {
    showAlert(t('inputError'), t('enterFilename'));
    return;
  }

  const blob = getFileBlob();
  if (!blob) return;

  try {
    downloadBlob(blob, filename);
    closeSaveModal();
    showToast(t('savedToast', { name: filename }), 'success');
  } catch (err) {
    showAlert(t('saveFailed'), err.message || t('saveError'));
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
}

function hasExportableModel() {
  let found = false;
  modelGroup.traverse((child) => {
    if (child.isMesh && child.geometry?.attributes?.position?.count > 0) {
      found = true;
    }
  });
  return found;
}

function getBaseFilename() {
  if (currentFile) {
    return currentFile.name.replace(/\.[^.]+$/, '');
  }
  return 'model';
}

function updateExportFilenameExt() {
  const ext = exportFormat.value;
  const base = exportFilename.value.replace(/\.[^.]+$/, '') || getBaseFilename();
  exportFilename.value = base;
}

async function exportToFormat(format) {
  if (!hasExportableModel()) {
    throw new Error(t('noExportData'));
  }

  switch (format) {
    case 'stl': {
      const data = new STLExporter().parse(modelGroup, { binary: true });
      return new Blob([data], { type: MIME_TYPES.stl });
    }
    case 'obj': {
      const text = new OBJExporter().parse(modelGroup);
      return new Blob([text], { type: MIME_TYPES.obj });
    }
    case 'ply': {
      const data = new PLYExporter().parse(modelGroup);
      return new Blob([data], { type: MIME_TYPES.ply });
    }
    case 'glb':
    case 'gltf': {
      const binary = format === 'glb';
      const result = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
          modelGroup,
          resolve,
          reject,
          { binary }
        );
      });
      if (binary) {
        return new Blob([result], { type: MIME_TYPES.glb });
      }
      return new Blob([JSON.stringify(result, null, 2)], { type: MIME_TYPES.gltf });
    }
    default:
      throw new Error(t('unsupportedExportFormat', { ext: format }));
  }
}

function openExportModal() {
  if (!hasExportableModel()) {
    showAlert(t('exportUnavailable'), t('exportNoModel'));
    return;
  }

  exportFilename.value = getBaseFilename();
  if (currentFile?.ext && EXPORT_FORMATS[currentFile.ext]) {
    exportFormat.value = currentFile.ext === 'step' ? 'stl' : currentFile.ext;
  } else if (CAD_EXTENSIONS.has(currentFile?.ext)) {
    exportFormat.value = 'stl';
  }
  exportModal.classList.remove('hidden');
  exportFilename.focus();
  exportFilename.select();
}

function closeExportModal() {
  exportModal.classList.add('hidden');
}

async function confirmExport() {
  const format = exportFormat.value;
  const filename = normalizeFilename(exportFilename.value, format);
  if (!filename) {
    showAlert(t('inputError'), t('enterFilename'));
    return;
  }

  showLoading(t('convertingFormat', { format: EXPORT_FORMATS[format].label }), {
    stage: 'convert',
    cancellable: true,
  });
  try {
    throwIfCancelled(getLoadSignal());
    const blob = await exportToFormat(format);
    throwIfCancelled(getLoadSignal());

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: getSavePickerTypes(format),
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        closeExportModal();
        showToast(t('exportSavedToast', { name: handle.name }), 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    }

    downloadBlob(blob, filename);
    closeExportModal();
    showToast(t('exportSavedToast', { name: filename }), 'success');
  } catch (err) {
    if (isLoadCancelled(err)) {
      showToast(t('loadingCancelled'), 'info');
      return;
    }
    console.error(err);
    showAlert(t('exportFailed'), err.message || t('exportError'));
  } finally {
    hideLoading();
  }
}

function openDrawingModal() {
  if (!hasExportableModel()) {
    showAlert(t('drawingUnavailable'), t('exportNoModel'));
    return;
  }

  drawingFilename.value = `${getBaseFilename()}_3view`;
  drawingModal.classList.remove('hidden');
  drawingFilename.focus();
  drawingFilename.select();
}

function closeDrawingModal() {
  drawingModal.classList.add('hidden');
}

async function confirmDrawingExport() {
  const format = drawingFormat.value;
  const filename = normalizeFilename(drawingFilename.value, format);
  if (!filename) {
    showAlert(t('inputError'), t('enterFilename'));
    return;
  }

  showLoading(t('generatingDrawing'), { stage: 'drawing', cancellable: true });
  try {
    throwIfCancelled(getLoadSignal());
    const dxfText = generateThreeViewDXF(modelGroup, {
      includeDimensions: drawingDimensions?.checked ?? true,
      scale: drawingScale?.value ?? 'auto',
      layout: drawingLayout?.value ?? 'third-angle',
    });
    throwIfCancelled(getLoadSignal());
    const blob = new Blob([dxfText], { type: MIME_TYPES.dxf });

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'DXF Drawing',
            accept: { [MIME_TYPES.dxf]: ['.dxf'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        closeDrawingModal();
        showToast(t('drawingSavedToast', { name: handle.name }), 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    }

    downloadBlob(blob, filename);
    closeDrawingModal();
    showToast(t('drawingSavedToast', { name: filename }), 'success');
  } catch (err) {
    if (isLoadCancelled(err)) {
      showToast(t('loadingCancelled'), 'info');
      return;
    }
    console.error(err);
    showAlert(t('drawingFailed'), err.message || t('drawingError'));
  } finally {
    hideLoading();
  }
}

init().catch((err) => {
  console.error('init failed:', err);
  hideLoading();
  showAlert(t('initErrorTitle'), t('initFailed'));
});