/** Runtime config: GitHub Pages (static) vs local Python server. */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const STATIC_HOST_SUFFIXES = [
  '.github.io',
  '.vercel.app',
  '.netlify.app',
  '.pages.dev',
];

export function isStaticWebDeployment() {
  if (location.protocol === 'file:') return true;
  if (LOCAL_HOSTS.has(location.hostname)) return false;
  if (STATIC_HOST_SUFFIXES.some((suffix) => location.hostname.endsWith(suffix))) {
    return true;
  }
  return document.documentElement.dataset.deployment === 'web';
}

export function getApiBase() {
  if (isStaticWebDeployment()) return '';
  return '';
}