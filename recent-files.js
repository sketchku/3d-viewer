const DB_NAME = '3d-viewer-recent';
const DB_VERSION = 1;
const STORE = 'files';
const MAX_FILES = 20;
const MAX_BYTES = 50 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result || []).sort((a, b) => b.openedAt - a.openedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getById(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function removeById(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveRecentFile(name, ext, buffer) {
  if (!buffer || buffer.byteLength > MAX_BYTES) return;
  try {
    const db = await openDb();
    const id = `${name}-${Date.now()}`;
    const entry = {
      id,
      name,
      ext,
      size: buffer.byteLength,
      openedAt: Date.now(),
      buffer,
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const all = await listAll();
    if (all.length > MAX_FILES) {
      const toRemove = all.slice(MAX_FILES);
      for (const item of toRemove) await removeById(item.id);
    }
  } catch (e) {
    console.warn('recent files save failed:', e);
  }
}

export function initRecentFiles({ onOpenFile, t }) {
  const panel = document.getElementById('recent-files-panel');
  const list = document.getElementById('recent-files-list');
  if (!panel || !list) return { refresh: async () => {} };

  async function refresh() {
    let items = [];
    try {
      items = await listAll();
    } catch {
      items = [];
    }

    list.innerHTML = '';
    if (!items.length) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'recent-file-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-file-btn';
      btn.title = item.name;
      const sizeKb = (item.size / 1024).toFixed(0);
      btn.innerHTML = `<span class="recent-file-name">${item.name}</span><span class="recent-file-meta">${item.ext.toUpperCase()} · ${sizeKb} KB</span>`;
      btn.addEventListener('click', async () => {
        const data = await getById(item.id);
        if (!data?.buffer) return;
        const file = new File([data.buffer], data.name, {
          type: 'application/octet-stream',
        });
        onOpenFile(file);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'recent-file-del';
      del.textContent = '×';
      del.title = t('recentRemove');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeById(item.id);
        refresh();
      });

      row.append(btn, del);
      list.appendChild(row);
    }
  }

  refresh();
  return { refresh };
}