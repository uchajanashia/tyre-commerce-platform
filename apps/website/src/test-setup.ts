// Node 25 exposes an incomplete experimental `localStorage` global when no
// backing file is configured. Replace only that invalid implementation so the
// browser test environment has the Storage contract application code expects.
if (typeof globalThis.localStorage?.removeItem !== 'function') {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}
