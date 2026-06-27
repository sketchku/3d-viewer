/** Client-side chat translation (Google Translate gtx, auto-detect source). */

const TARGET_CODES = {
  ko: 'ko',
  en: 'en',
  zh: 'zh-CN',
  es: 'es',
  ar: 'ar',
  hi: 'hi',
};
const cache = new Map();

function normalizeLang(code) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  if (c === 'ko' || c.startsWith('ko')) return 'ko';
  if (c === 'en' || c.startsWith('en')) return 'en';
  if (c === 'zh' || c.startsWith('zh')) return 'zh';
  if (c === 'es' || c.startsWith('es')) return 'es';
  if (c === 'ar' || c.startsWith('ar')) return 'ar';
  if (c === 'hi' || c.startsWith('hi')) return 'hi';
  return c.split('-')[0];
}

function cacheKey(text, targetLang) {
  return `${targetLang}::${text}`;
}

export function isSameLanguage(a, b) {
  return normalizeLang(a) === normalizeLang(b);
}

export async function translateText(text, targetLang) {
  const trimmed = String(text || '').trim();
  const tl = TARGET_CODES[targetLang] || TARGET_CODES.en;
  if (!trimmed) return { text: '', detectedLang: null };

  const hit = cache.get(cacheKey(trimmed, tl));
  if (hit) return hit;

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation HTTP ${res.status}`);

  const data = await res.json();
  const translated = (data[0] || []).map((part) => part[0]).join('') || trimmed;
  const result = {
    text: translated,
    detectedLang: normalizeLang(data[2]),
  };
  cache.set(cacheKey(trimmed, tl), result);
  return result;
}

export async function textForViewer(msg, viewerLang) {
  const stored = String(msg?.text || '').trim();
  if (!stored) return '';

  const storedLang = normalizeLang(msg?.lang);
  if (storedLang && isSameLanguage(storedLang, viewerLang)) return stored;

  const idKey = msg?.id ? `${msg.id}:${viewerLang}` : null;
  if (idKey && cache.has(idKey)) return cache.get(idKey);

  const { text, detectedLang } = await translateText(stored, viewerLang);
  if (storedLang && isSameLanguage(detectedLang, viewerLang)) {
    if (idKey) cache.set(idKey, stored);
    return stored;
  }

  if (idKey) cache.set(idKey, text);
  return text;
}

export async function textForUpload(rawText, userLang) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return { text: '', lang: userLang, originalText: null };

  const { text, detectedLang } = await translateText(trimmed, userLang);
  const translated = String(text || trimmed).trim();
  const needsOriginal = detectedLang && !isSameLanguage(detectedLang, userLang) && translated !== trimmed;

  return {
    text: translated.slice(0, 500),
    lang: userLang,
    originalText: needsOriginal ? trimmed.slice(0, 500) : null,
  };
}