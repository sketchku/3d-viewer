import { initI18n } from './i18n.js?v=2.6.10';
import { APP_VERSION } from './version.js?v=2.6.10';

initI18n();

const verEl = document.getElementById('app-version');
if (verEl) verEl.textContent = `v${APP_VERSION}`;