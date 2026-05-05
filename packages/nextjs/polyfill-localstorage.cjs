// Polyfill localStorage / sessionStorage for Next.js static-export build workers.
// Node 20+ workers used by `next build` don't expose Web Storage by default,
// and any module that touches `localStorage` at import time will crash the
// static export silently. Loaded via NODE_OPTIONS="--require ./polyfill-localstorage.cjs".

class MemoryStorage {
  constructor() {
    this._store = new Map();
  }
  get length() {
    return this._store.size;
  }
  key(i) {
    return Array.from(this._store.keys())[i] ?? null;
  }
  getItem(k) {
    return this._store.has(String(k)) ? this._store.get(String(k)) : null;
  }
  setItem(k, v) {
    this._store.set(String(k), String(v));
  }
  removeItem(k) {
    this._store.delete(String(k));
  }
  clear() {
    this._store.clear();
  }
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = new MemoryStorage();
}
if (typeof globalThis.sessionStorage === "undefined") {
  globalThis.sessionStorage = new MemoryStorage();
}
