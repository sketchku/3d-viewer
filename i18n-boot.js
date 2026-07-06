import { initI18n } from './i18n.js?v=2.10.5';
import { APP_VERSION } from './version.js?v=2.10.5';

initI18n();

const verEl = document.getElementById('app-version');
if (verEl) verEl.textContent = `v${APP_VERSION}`;