/* Хранилище: IndexedDB, запасной вариант — localStorage. Всё в try/catch. */
(function (O) {
  'use strict';
  const S = { mode: 'idb', db: null };
  const DB = 'ottisk', STORE = 'kv';

  function openDb() {
    return new Promise((res, rej) => {
      try {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error || new Error('idb error'));
        rq.onblocked = () => rej(new Error('idb blocked'));
      } catch (e) { rej(e); }
    });
  }

  S.init = async function () {
    try { S.db = await openDb(); S.mode = 'idb'; }
    catch (e) { console.warn('IndexedDB недоступна, используем localStorage', e); S.mode = 'ls'; }
    return S.mode;
  };

  S.get = function (key) {
    if (S.mode === 'idb' && S.db) {
      return new Promise(res => {
        try {
          const tx = S.db.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(key);
          rq.onsuccess = () => res(rq.result === undefined ? null : rq.result);
          rq.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    }
    try { const v = localStorage.getItem('ottisk:' + key); return Promise.resolve(v ? JSON.parse(v) : null); } catch (e) { return Promise.resolve(null); }
  };

  S.set = function (key, value) {
    if (S.mode === 'idb' && S.db) {
      return new Promise(res => {
        try {
          const tx = S.db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => { console.warn('idb write failed', tx.error); res(false); };
        } catch (e) { res(false); }
      });
    }
    try { localStorage.setItem('ottisk:' + key, JSON.stringify(value)); return Promise.resolve(true); }
    catch (e) { console.warn('localStorage write failed', e); return Promise.resolve(false); }
  };

  O.Store = S;
})(window.Ottisk);
