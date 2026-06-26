import { CHAT_CONFIG } from './chat-config.js?v=2.5.4';

const STORAGE_KEY = '3d-viewer-visitor-chat';
const NAME_KEY = '3d-viewer-visitor-name';

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(ts, lang) {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  return new Date(ts).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createLocalStore() {
  return {
    mode: 'local',
    async load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
    async save(messages) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    },
    subscribe(callback) {
      const handler = (event) => {
        if (event.key !== STORAGE_KEY) return;
        try {
          callback(event.newValue ? JSON.parse(event.newValue) : []);
        } catch {
          callback([]);
        }
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}

async function createFirebaseStore(config) {
  const [{ initializeApp }, { getDatabase, ref, onValue, push, query, limitToLast, set, get, remove }] =
    await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js'),
    ]);

  const app = initializeApp(config);
  const db = getDatabase(app);
  const messagesRef = query(ref(db, 'messages'), limitToLast(CHAT_CONFIG.maxMessages || 300));

  return {
    mode: 'firebase',
    async load() {
      const snap = await get(messagesRef);
      if (!snap.exists()) return [];
      const rows = [];
      snap.forEach((child) => {
        rows.push({ id: child.key, ...child.val() });
      });
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
    async save() {
      // Firebase uses push per message; bulk save not used.
    },
    async add(message) {
      const newRef = push(ref(db, 'messages'));
      await set(newRef, message);
      return { id: newRef.key, ...message };
    },
    async clear() {
      await remove(ref(db, 'messages'));
    },
    subscribe(callback) {
      const unsub = onValue(messagesRef, (snap) => {
        const rows = [];
        snap.forEach((child) => rows.push({ id: child.key, ...child.val() }));
        callback(rows.sort((a, b) => a.createdAt - b.createdAt));
      });
      return unsub;
    },
  };
}

function parseTelegraphMessages(page) {
  const pre = page?.content?.find((node) => node.tag === 'pre');
  const raw = pre?.children?.[0] || '[]';
  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function telegraphContentFromMessages(messages) {
  return JSON.stringify([{ tag: 'pre', children: [JSON.stringify(messages)] }]);
}

function createTelegraphStore(config) {
  const { accessToken, pagePath } = config;
  let cachedTitle = '3D Viewer Visitor Chat';
  let pollTimer = null;

  async function fetchPage() {
    const res = await fetch(`https://api.telegra.ph/getPage/${pagePath}?return_content=true`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Telegraph read failed');
    cachedTitle = data.result.title || cachedTitle;
    return parseTelegraphMessages(data.result);
  }

  async function saveMessages(messages) {
    const body = new URLSearchParams({
      access_token: accessToken,
      path: pagePath,
      title: cachedTitle,
      content: telegraphContentFromMessages(messages),
      author_name: '3D Viewer',
    });
    const res = await fetch('https://api.telegra.ph/editPage', {
      method: 'POST',
      body,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Telegraph write failed');
  }

  return {
    mode: 'telegraph',
    async load() {
      return fetchPage();
    },
    async save(messages) {
      await saveMessages(messages);
    },
    async add(message) {
      const rows = await fetchPage();
      const entry = { id: createId(), ...message };
      const next = [...rows, entry].slice(-(CHAT_CONFIG.maxMessages || 300));
      await saveMessages(next);
      return entry;
    },
    async clear() {
      await saveMessages([]);
    },
    subscribe(callback) {
      const poll = async () => {
        try {
          callback(await fetchPage());
        } catch (err) {
          console.warn('Telegraph poll failed:', err);
        }
      };
      poll();
      pollTimer = window.setInterval(poll, 12000);
      return () => {
        if (pollTimer) window.clearInterval(pollTimer);
      };
    },
  };
}

async function createStore() {
  const tg = CHAT_CONFIG.telegraph;
  if (CHAT_CONFIG.storage === 'telegraph' && tg?.accessToken && tg?.pagePath) {
    try {
      return createTelegraphStore(tg);
    } catch (err) {
      console.warn('Telegraph chat init failed:', err);
    }
  }

  const fb = CHAT_CONFIG.firebase;
  if (
    CHAT_CONFIG.storage === 'firebase'
    && fb?.apiKey
    && fb?.databaseURL
    && fb?.projectId
  ) {
    try {
      return await createFirebaseStore(fb);
    } catch (err) {
      console.warn('Firebase chat init failed, falling back to local storage:', err);
    }
  }
  return createLocalStore();
}

export async function initVisitorChat({ t, showToast, getLang }) {
  const root = document.getElementById('visitor-chat');
  const panel = document.getElementById('visitor-chat-panel');
  const toggleBtn = document.getElementById('visitor-chat-toggle');
  const clearBtn = document.getElementById('visitor-chat-clear');
  const messagesEl = document.getElementById('visitor-chat-messages');
  const form = document.getElementById('visitor-chat-form');
  const nameInput = document.getElementById('visitor-chat-name');
  const textInput = document.getElementById('visitor-chat-input');
  const countEl = document.getElementById('visitor-chat-count');
  const hintEl = document.getElementById('visitor-chat-hint');

  if (!root || !panel || !messagesEl || !form || !textInput) return null;

  let store;
  try {
    store = await createStore();
  } catch (err) {
    console.error(err);
    showToast?.(t('chatFirebaseError'), 'error');
    store = createLocalStore();
  }

  let messages = [];
  let expanded = false;
  let lastSentAt = 0;

  function updateHint() {
    if (!hintEl) return;
    hintEl.textContent = (store.mode === 'firebase' || store.mode === 'telegraph')
      ? t('chatHintShared')
      : t('chatHintLocal');
  }

  function renderMessages() {
    messagesEl.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'visitor-chat-empty';
      empty.textContent = t('chatEmpty');
      messagesEl.appendChild(empty);
    } else {
      const lang = getLang?.() || 'ko';
      for (const msg of messages) {
        const item = document.createElement('article');
        item.className = 'visitor-chat-message';
        item.innerHTML = `
          <header class="visitor-chat-message-head">
            <strong class="visitor-chat-author">${escapeHtml(msg.name || t('chatAnonymous'))}</strong>
            <time class="visitor-chat-time">${formatTime(msg.createdAt, lang)}</time>
          </header>
          <p class="visitor-chat-text">${escapeHtml(msg.text)}</p>
        `;
        messagesEl.appendChild(item);
      }
    }
    if (countEl) countEl.textContent = String(messages.length);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadMessages() {
    messages = await store.load();
    renderMessages();
  }

  function setExpanded(open) {
    expanded = open;
    panel.classList.toggle('hidden', !open);
    toggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function addMessage(text, name) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (now - lastSentAt < 2000) {
      showToast?.(t('chatRateLimit'), 'info');
      return;
    }
    const payload = {
      name: (name || '').trim().slice(0, 24) || t('chatAnonymous'),
      text: trimmed.slice(0, 500),
      createdAt: now,
    };

    if ((store.mode === 'firebase' || store.mode === 'telegraph') && store.add) {
      try {
        await store.add(payload);
        lastSentAt = now;
      } catch (err) {
        console.error(err);
        showToast?.(t('chatFirebaseError'), 'error');
      }
      return;
    }

    const entry = { id: createId(), ...payload };
    messages = [...messages, entry].slice(-(CHAT_CONFIG.maxMessages || 300));
    await store.save(messages);
    renderMessages();
  }

  async function clearMessages() {
    if (store.mode === 'firebase' && store.clear) {
      await store.clear();
      messages = [];
      renderMessages();
      return;
    }
    messages = [];
    await store.save(messages);
    renderMessages();
  }

  try {
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName && nameInput) nameInput.value = savedName;
  } catch {
    // ignore
  }

  updateHint();
  if (store.mode === 'firebase' || store.mode === 'telegraph') {
    clearBtn?.classList.add('hidden');
  }
  await loadMessages();

  if (store.subscribe) {
    store.subscribe((rows) => {
      messages = rows;
      renderMessages();
    });
  }

  toggleBtn?.addEventListener('click', () => setExpanded(!expanded));

  clearBtn?.addEventListener('click', async () => {
    if (!window.confirm(t('chatClearConfirm'))) return;
    await clearMessages();
    showToast?.(t('chatCleared'), 'info');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput?.value || '';
    const text = textInput.value;
    try {
      localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
    } catch {
      // ignore
    }
    await addMessage(text, name);
    textInput.value = '';
    textInput.focus();
    if (!expanded) setExpanded(true);
  });

  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  root.addEventListener('click', (event) => event.stopPropagation());

  document.addEventListener('languagechange', () => {
    updateHint();
    renderMessages();
  });

  return { reload: loadMessages };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}