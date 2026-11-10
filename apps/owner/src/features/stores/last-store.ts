const KEY = 'restrovia.last-store';

/** The café the owner looked at last, so the portal opens there next time. */
export function lastStoreId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberStore(storeId: string) {
  try {
    localStorage.setItem(KEY, storeId);
  } catch {
    // Private windows can refuse storage; the portal then opens the first café.
  }
}
