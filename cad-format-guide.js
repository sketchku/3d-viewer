/** Native vs proprietary CAD format metadata and export guides. */

export class ProprietaryCadError extends Error {
  constructor(ext, appKey) {
    super(`Proprietary CAD format: ${ext}`);
    this.name = 'ProprietaryCadError';
    this.ext = ext;
    this.appKey = appKey;
  }
}

export const PROPRIETARY_CAD = {
  sldprt: { appKey: 'solidworks', label: 'SolidWorks Part' },
  sldasm: { appKey: 'solidworks', label: 'SolidWorks Assembly' },
  slddrw: { appKey: 'solidworks', label: 'SolidWorks Drawing' },
  ipt: { appKey: 'inventor', label: 'Inventor Part' },
  iam: { appKey: 'inventor', label: 'Inventor Assembly' },
  ipn: { appKey: 'inventor', label: 'Inventor Presentation' },
  f3d: { appKey: 'fusion360', label: 'Fusion 360 Design' },
  f3z: { appKey: 'fusion360', label: 'Fusion 360 Archive' },
  prt: { appKey: 'creo', label: 'Creo / ProE Part' },
  asm: { appKey: 'creo', label: 'Creo / ProE Assembly' },
  drw: { appKey: 'creo', label: 'Creo / ProE Drawing' },
  catpart: { appKey: 'catia', label: 'CATIA Part' },
  catproduct: { appKey: 'catia', label: 'CATIA Product' },
  catdrawing: { appKey: 'catia', label: 'CATIA Drawing' },
  cgr: { appKey: 'catia', label: 'CATIA CGR' },
  model: { appKey: 'catia', label: 'CATIA V4 Model' },
};

export function isProprietaryCad(ext) {
  return Object.hasOwn(PROPRIETARY_CAD, ext);
}

export function getProprietaryCadInfo(ext) {
  return PROPRIETARY_CAD[ext] ?? null;
}

export function createProprietaryCadError(ext) {
  const info = getProprietaryCadInfo(ext);
  return new ProprietaryCadError(ext, info?.appKey ?? 'unknown');
}