/* Preserve the original browser database; migrate a copy before opening the UI. */
window.nativeStorageReady = (async () => {
  if (!window.nativeSQLite) throw new Error("Native database bridge is unavailable");
  const native = window.nativeStorageRequest;
  const originalFactory = window.indexedDB;
  const originalStorage = window.localStorage;
  const migrationKey = "__accounting_native_migrated_v1";
  const persisted = native({ op: "kvAll" });

  for (let index = 0; index < originalStorage.length; index++) {
    const key = originalStorage.key(index);
    if (!(key in persisted)) native({
      op: "kvSet", key, value: originalStorage.getItem(key),
    });
  }

  // License and interface settings also belong to the installed app's SQLite.
  const storage = {
    getItem: (key) => native({ op: "kvGet", key: String(key) }),
    setItem: (key, value) => native({ op: "kvSet", key: String(key), value: String(value) }),
    removeItem: (key) => native({ op: "kvRemove", key: String(key) }),
    clear: () => native({ op: "kvClear" }),
    key: (index) => Object.keys(native({ op: "kvAll" }))[index] ?? null,
    get length() { return Object.keys(native({ op: "kvAll" })).length; },
  };
  Object.defineProperty(window, "localStorage", { value: storage });

  let snapshot;
  if (!native({ op: "kvGet", key: migrationKey })) {
    snapshot = await new Promise((resolve, reject) => {
      const open = originalFactory.open("AccountingSystem");
      let created = false;
      open.onupgradeneeded = () => { created = true; open.transaction.abort(); };
      open.onerror = () => created ? resolve(null) : reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const names = [...db.objectStoreNames];
        if (!names.length) { db.close(); resolve(null); return; }
        const tx = db.transaction(names, "readonly");
        const stores = names.map((name) => {
          const source = tx.objectStore(name);
          const entry = {
            name, keyPath: source.keyPath, autoIncrement: source.autoIncrement,
            indexes: [...source.indexNames].map((name) => {
              const index = source.index(name);
              return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
            }),
            rows: [], keys: [],
          };
          source.getAll().onsuccess = (event) => { entry.rows = event.target.result; };
          source.getAllKeys().onsuccess = (event) => { entry.keys = event.target.result; };
          return entry;
        });
        tx.oncomplete = () => { db.close(); resolve({ version: db.version, stores }); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("Cannot read existing data")); };
      };
    });
  }

  window.setGlobalVars(window, { checkOrigin: false });
  window.shimIndexedDB.__useShim();

  if (snapshot) {
    // IndexedDBShim uses SQLite files distinct from the untouched browser DB.
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("AccountingSystem", snapshot.version);
      open.onupgradeneeded = () => {
        for (const store of snapshot.stores) {
          const target = open.result.createObjectStore(store.name, {
            keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          });
          for (const index of store.indexes) target.createIndex(index.name, index.keyPath, index);
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(snapshot.stores.map((store) => store.name), "readwrite");
        for (const store of snapshot.stores) {
          const target = tx.objectStore(store.name);
          target.clear();
          store.rows.forEach((row, index) => {
            if (store.keyPath === null) target.put(row, store.keys[index]);
            else target.put(row);
          });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("Data migration failed")); };
      };
    });
  }
  native({ op: "kvSet", key: migrationKey, value: "1" });
  if (window.nativeFiles) {
    const blobs = new Map();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob); blobs.set(url, blob); return url;
    };
    URL.revokeObjectURL = (url) => { blobs.delete(url); revoke(url); };
    const exportAnchor = (anchor) => {
      if (!anchor?.hasAttribute("download")) return false;
      const blob = blobs.get(anchor.href);
      const data = anchor.href.match(/^data:([^;,]*);base64,(.*)$/s);
      if (!blob && !data) return false;
      if (data) {
        window.nativeFiles.saveFile(anchor.download || "accounting-export", data[1], data[2]);
        return true;
      }
      const reader = new FileReader();
      reader.onload = () => window.nativeFiles.saveFile(
        anchor.download || "accounting-export", blob.type,
        String(reader.result).split(",")[1],
      );
      reader.onerror = () => alert("تعذر تجهيز ملف النسخة الاحتياطية. أعد المحاولة.");
      reader.readAsDataURL(blob);
      return true;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      if (!exportAnchor(this)) return click.apply(this, args);
    };
    document.addEventListener("click", (event) => {
      if (exportAnchor(event.target.closest?.("a[download]"))) event.preventDefault();
    }, true);
    window.print = () => window.nativeFiles.printPage();
  }
})();
window.nativeStorageReady.catch((error) => {
  console.error("Native storage startup failed", error);
  document.getElementById("root").textContent =
    "تعذر فتح قاعدة بيانات الجهاز. لم يتم حذف بياناتك. أعد تشغيل التطبيق أو استعد نسخة احتياطية.";
});
