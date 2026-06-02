import { useState } from 'react';
import { getUserLanguage, setUserLanguage } from '@/lib/user-language';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ar', label: 'العربية' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pl', label: 'Polski' },
  { code: 'es', label: 'Español' },
  { code: 'am', label: 'አማርኛ' },
  { code: 'din', label: 'Thuɔŋjäŋ' },
  { code: 'ha', label: 'Hausa' },
  { code: 'kri', label: 'Krio' },
  { code: 'pcm', label: 'Naijá' },
  { code: 'sn', label: 'ChiShona' },
  { code: 'so', label: 'Soomaali' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ti', label: 'ትግርኛ' },
];

export function LanguageSelector() {
  const [current, setCurrent] = useState<string>(() =>
    typeof window !== 'undefined' ? getUserLanguage() : 'en'
  );

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const lang = e.target.value;
    setCurrent(lang);
    setUserLanguage(lang);
    // Reload so all WS connections re-open with the new language param
    window.location.reload();
  }

  return (
    <div className="language-selector">
      <label htmlFor="lang-select" className="language-selector-label">
        Language
      </label>
      <select
        id="lang-select"
        value={current}
        onChange={handleChange}
        className="language-selector-select"
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
