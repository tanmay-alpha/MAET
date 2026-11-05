// Every key MAET writes starts with "maet" ("maet.settings", "maet_chart_*", "maet:screener-*").
const MAET_KEY_PATTERN = /^maet[._:-]/;

/**
 * Removes MAET's own browser-side data (settings, chart layouts, guest watchlist) while
 * leaving everything else — notably the Supabase sign-in session — untouched.
 */
export function clearMaetLocalData(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key !== null && MAET_KEY_PATTERN.test(key)) storage.removeItem(key);
  }
}
