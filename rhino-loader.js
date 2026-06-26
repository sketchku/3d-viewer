import { Rhino3dmLoader } from 'three/addons/loaders/3DMLoader.js';
import { throwIfCancelled, LoadCancelledError } from './large-file-loader.js';

const RHINO3DM_LIB = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';

let rhinoLoader = null;

function getLoader() {
  if (!rhinoLoader) {
    rhinoLoader = new Rhino3dmLoader();
    rhinoLoader.setLibraryPath(RHINO3DM_LIB);
  }
  return rhinoLoader;
}

export async function loadRhino3dm(buffer, { signal } = {}) {
  throwIfCancelled(signal);
  const loader = getLoader();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      loader.dispose();
      rhinoLoader = null;
      reject(new LoadCancelledError());
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    loader.parse(
      buffer,
      (object) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(object);
      },
      (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}