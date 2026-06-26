/** Server-side proprietary CAD → STEP conversion API client. */

import { getProprietaryCadInfo } from './cad-format-guide.js?v=2.5.0';
import { isStaticWebDeployment } from './web-config.js?v=2.5.0';

const NATIVE_BACKEND = {
  solidworks: 'solidworks',
  inventor: 'inventor',
  catia: 'catia',
};

let cachedStatus = null;

function emptyStatus(ext = '') {
  const status = { available: false, backends: [] };
  if (ext) {
    status.ext = ext;
    status.canConvert = false;
    status.convertBackends = [];
  }
  return status;
}

export function getConvertBackendsForExt(ext, status) {
  const info = getProprietaryCadInfo(ext);
  if (!info) return [];

  const installed = new Set(status?.backends || []);
  const result = [];

  const native = NATIVE_BACKEND[info.appKey];
  if (native && installed.has(native)) {
    result.push(native);
  }
  if (installed.has('freecad')) {
    result.push('freecad');
  }
  return result;
}

export function canConvertExt(ext, status) {
  return getConvertBackendsForExt(ext, status).length > 0;
}

export async function getConvertStatus(force = false, ext = '') {
  if (cachedStatus && !force && !ext) return cachedStatus;
  if (isStaticWebDeployment()) {
    const empty = emptyStatus(ext);
    if (!ext) cachedStatus = empty;
    return empty;
  }
  try {
    const query = ext ? `?ext=${encodeURIComponent(ext)}` : '';
    const res = await fetch(`/api/convert-step/status${query}`);
    if (!res.ok) throw new Error('status failed');
    const data = await res.json();
    if (!ext) cachedStatus = data;
    return data;
  } catch {
    const fallback = emptyStatus(ext);
    if (ext) {
      fallback.canConvert = canConvertExt(ext, fallback);
      fallback.convertBackends = getConvertBackendsForExt(ext, fallback);
    } else {
      cachedStatus = fallback;
    }
    return fallback;
  }
}

export async function convertFileToStep(file, ext, signal) {
  if (isStaticWebDeployment()) {
    throw new Error('Server-side CAD conversion is not available on static web hosting');
  }

  const form = new FormData();
  form.append('file', file, file.name);
  form.append('ext', ext);

  const res = await fetch('/api/convert-step', {
    method: 'POST',
    body: form,
    signal,
  });

  if (!res.ok) {
    let message = 'Conversion failed';
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const stem = file.name.replace(/\.[^.]+$/, '') || 'converted';
  return new File([blob], `${stem}.stp`, { type: 'application/step' });
}

export function formatBackendList(backends, t) {
  if (!backends?.length) return '';
  const labels = backends.map((key) => t(`backend${key.charAt(0).toUpperCase()}${key.slice(1)}`) || key);
  return labels.join(', ');
}