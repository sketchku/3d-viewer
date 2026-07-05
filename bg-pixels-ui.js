/** Real-time gauge panel for Gargantua background parameters. */

import { DEFAULT_BG_PARAMS } from './bg-pixels.js';

export const BG_PARAM_SPECS = [
  {
    group: 'disk',
    title: '강착 원반',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 200, step: 1 },
      { key: 'orbitScale', label: '궤도 크기', min: 0.5, max: 8, step: 0.1 },
      { key: 'flatness', label: '타원 납작함', min: 0.1, max: 0.6, step: 0.01 },
      { key: 'spin', label: '회전 속도', min: 0, max: 3, step: 0.05 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
      { key: 'alpha', label: '밝기', min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    group: 'photon',
    title: '광자 링',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 64, step: 1 },
      { key: 'orbitScale', label: '궤도 크기', min: 0.5, max: 5, step: 0.1 },
      { key: 'spin', label: '회전 속도', min: 0, max: 3, step: 0.05 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  {
    group: 'boundary',
    title: '경계 순환별',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 120, step: 1 },
      { key: 'speed', label: '순환 속도', min: 0, max: 3, step: 0.05 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  {
    group: 'inflow',
    title: '유입별',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 80, step: 1 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  {
    group: 'field',
    title: '원거리별',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 80, step: 1 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  {
    group: 'arc',
    title: '상단 렌즈 호',
    fields: [
      { key: 'count', label: '도트 수', min: 0, max: 60, step: 1 },
      { key: 'radiusScale', label: '호 반경', min: 0.5, max: 3, step: 0.05 },
      { key: 'drift', label: '호 이동', min: 0, max: 3, step: 0.05 },
      { key: 'dotSize', label: '도트 크기', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  {
    group: 'blackHole',
    title: '블랙홀',
    fields: [
      { key: 'radiusScale', label: '크기', min: 0.3, max: 2.5, step: 0.05 },
    ],
  },
  {
    group: 'global',
    title: '전역',
    fields: [
      { key: 'holeRadius', label: '기준 반경', min: 0.03, max: 0.12, step: 0.005 },
      { key: 'diskTilt', label: '원반 기울기', min: 0, max: 1.2, step: 0.02 },
      { key: 'dotScale', label: '기본 도트 배율', min: 0.5, max: 4, step: 0.1 },
    ],
  },
];

function formatValue(value, step) {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(value).toFixed(decimals);
}

/**
 * @param {HTMLElement} container
 * @param {{ getParams: Function, setParams: Function }} bgPixels
 */
/**
 * @param {HTMLElement} container
 * @param {{ getParams: Function, setParams: Function, saveAll?: Function }} bgPixels
 * @param {{ onSave?: Function, t?: Function }} opts
 */
export function initBgPixelsUI(container, bgPixels, opts = {}) {
  const t = opts.t ?? ((key) => key);
  container.innerHTML = '';
  container.classList.add('bg-pixels-panel');

  const header = document.createElement('div');
  header.className = 'bg-pixels-panel-head';
  header.innerHTML = `
    <h2 data-i18n="bgParamsTitle">배경 파티클</h2>
    <div class="bg-pixels-actions">
      <button type="button" class="bg-pixels-save" data-i18n="bgSave">저장</button>
      <button type="button" class="bg-pixels-reset" data-i18n="bgReset">기본값</button>
    </div>
  `;
  container.appendChild(header);

  const sliders = new Map();

  for (const spec of BG_PARAM_SPECS) {
    const section = document.createElement('section');
    section.className = 'bg-pixels-group';
    section.innerHTML = `<h3>${spec.title}</h3>`;
    container.appendChild(section);

    for (const field of spec.fields) {
      const id = `bg-param-${spec.group}-${field.key}`;
      const row = document.createElement('div');
      row.className = 'bg-pixels-row';

      const label = document.createElement('label');
      label.htmlFor = id;
      label.innerHTML = `${field.label} <span class="bg-pixels-val" data-for="${id}"></span>`;

      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.dataset.group = spec.group;
      input.dataset.key = field.key;

      row.append(label, input);
      section.appendChild(row);
      sliders.set(id, { input, field });
    }
  }

  function syncFromParams() {
    const params = bgPixels.getParams();
    for (const [id, { input, field }] of sliders) {
      const group = input.dataset.group;
      const key = input.dataset.key;
      const value = params[group][key];
      input.value = String(value);
      const valEl = container.querySelector(`[data-for="${id}"]`);
      if (valEl) valEl.textContent = formatValue(value, field.step);
    }
  }

  function onInput(e) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
    const group = input.dataset.group;
    const key = input.dataset.key;
    const value = fieldValue(input);
    const valEl = container.querySelector(`[data-for="${input.id}"]`);
    const spec = sliders.get(input.id);
    if (valEl && spec) valEl.textContent = formatValue(value, spec.field.step);
    bgPixels.setParams({ [group]: { [key]: value } });
  }

  function fieldValue(input) {
    const step = Number(input.step);
    const raw = Number(input.value);
    return step < 1 ? raw : Math.round(raw);
  }

  container.addEventListener('input', onInput);

  header.querySelector('.bg-pixels-save')?.addEventListener('click', () => {
    const ok = bgPixels.saveAll?.() ?? false;
    opts.onSave?.(ok);
  });

  header.querySelector('.bg-pixels-reset')?.addEventListener('click', () => {
    bgPixels.setParams(DEFAULT_BG_PARAMS, { replace: true });
    syncFromParams();
  });

  syncFromParams();

  return { syncFromParams };
}