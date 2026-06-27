#!/usr/bin/env python3
"""Generate locale blocks and patch i18n.js."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / 'i18n.js'
LOCALES_DIR = Path(__file__).resolve().parent / 'locales'

def js_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)

def block(code: str, data: dict) -> str:
    lines = [f'  {code}: {{']
    for k, v in data.items():
        lines.append(f'    {k}: {js_str(v)},')
    lines.append('  },')
    return '\n'.join(lines)

def extract_en_key_order(content: str) -> list[str]:
    m = re.search(r'  en: \{([\s\S]*?)\n  \},\n\};', content)
    return re.findall(r'^\s+(\w+):', m.group(1), re.M)

def main():
    content = I18N.read_text(encoding='utf-8')
    en_keys = extract_en_key_order(content)
    print(f'en keys: {len(en_keys)}')

    all_locales = {}
    for code in ('zh', 'es', 'ar', 'hi'):
        path = LOCALES_DIR / f'{code}.json'
        data = json.loads(path.read_text(encoding='utf-8'))
        missing = [k for k in en_keys if k not in data]
        extra = [k for k in data if k not in en_keys]
        if missing:
            raise SystemExit(f'{code} missing keys: {missing[:10]}... ({len(missing)} total)')
        if extra:
            raise SystemExit(f'{code} extra keys: {extra[:10]}')
        all_locales[code] = {k: data[k] for k in en_keys}

    # Build new LANGUAGES
    langs = """export const LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
];"""
    content = re.sub(
        r'export const LANGUAGES = \[[\s\S]*?\];',
        langs,
        content,
        count=1,
    )

    # Insert locale blocks before closing };
    locale_blocks = '\n'.join(block(c, d) for c, d in all_locales.items())
    content = content.replace('  },\n};', '  },\n' + locale_blocks + '\n};')

    # detectLanguage
    detect = """function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch (_) { /* file:// or private mode */ }
  const browser = (navigator.language || 'en').toLowerCase();
  if (browser.startsWith('ko')) return 'ko';
  if (browser.startsWith('zh')) return 'zh';
  if (browser.startsWith('es')) return 'es';
  if (browser.startsWith('ar')) return 'ar';
  if (browser.startsWith('hi')) return 'hi';
  return 'en';
}"""
    content = re.sub(
        r'function detectLanguage\(\) \{[\s\S]*?\n\}',
        detect,
        content,
        count=1,
    )

    # RTL in applyTranslations
    if "document.documentElement.dir" not in content:
        content = content.replace(
            "  document.documentElement.setAttribute('translate', 'no');\n",
            "  document.documentElement.setAttribute('translate', 'no');\n  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';\n",
        )

    # populate lang select
    populate_fn = """
function populateLanguageSelect() {
  const select = document.getElementById('lang-select');
  if (!select) return;
  const current = select.value || currentLang;
  select.innerHTML = LANGUAGES.map(({ code, label }) =>
    `<option value="${code}">${label}</option>`
  ).join('');
  select.value = current;
}
"""
    if 'populateLanguageSelect' not in content:
        content = content.replace(
            'function bindLanguageSelect() {',
            populate_fn + '\nfunction bindLanguageSelect() {',
        )
        content = content.replace(
            '  applyTranslations();\n  bindLanguageSelect();',
            '  applyTranslations();\n  populateLanguageSelect();\n  bindLanguageSelect();',
        )

    I18N.write_text(content, encoding='utf-8')
    print('Patched i18n.js OK')

if __name__ == '__main__':
    main()