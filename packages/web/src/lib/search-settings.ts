// Search provider settings for the Winnow desktop/web UI.
//
// API keys live in sessionStorage and are sent only with a search request to
// the local server. They are never written to the project database, exports,
// or long-lived storage. Non-secret preferences live in localStorage.

export interface SearchSettings {
  braveApiKey: string;
  serperApiKey: string;
  searxngUrl: string;
  fallbackEnabled: boolean;
  fallbackOrder: string;
}

const SETTINGS_KEY = 'winnow-search-settings';
const SECRETS_KEY = 'winnow-search-secrets';
const SECRET_KEYS = ['braveApiKey', 'serperApiKey'] as const;

export const EMPTY_SEARCH_SETTINGS: SearchSettings = {
  braveApiKey: '',
  serperApiKey: '',
  searxngUrl: '',
  fallbackEnabled: true,
  fallbackOrder: 'brave,serper,searxng',
};

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadSearchSettings(): SearchSettings {
  const stored = readJson<Partial<SearchSettings>>(localStorage, SETTINGS_KEY) ?? {};
  const secrets = readJson<Partial<SearchSettings>>(sessionStorage, SECRETS_KEY) ?? {};
  return {
    ...EMPTY_SEARCH_SETTINGS,
    ...stored,
    ...secrets,
  };
}

export function saveSearchSettings(settings: SearchSettings): void {
  const secrets = Object.fromEntries(
    SECRET_KEYS.map((key) => [key, settings[key]]),
  );
  const persistent = { ...settings };
  for (const key of SECRET_KEYS) delete (persistent as Record<string, unknown>)[key];
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistent));
    sessionStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    // Storage unavailable; settings still apply for this session.
  }
}
