import WebSQLDatabase from "websql-configurable/lib/websql/WebSQLDatabase.js";

// The compatibility layer manages transaction ordering and defers completion
// until the native SQLite COMMIT/ROLLBACK callback. It never uses browser IDB.
const request = (operation) => {
  const reply = JSON.parse(window.nativeSQLite.request(JSON.stringify(operation)));
  if (!reply.ok) throw new Error(reply.error || "Native SQLite failed");
  return reply.result;
};

const databases = new Map();
window.openDatabase = (name, version) => {
  name = String(name);
  if (databases.has(name)) return databases.get(name);
  request({ op: "open", name });
  const driver = {
    exec(statements, readOnly, callback) {
      const results = statements.map(({ sql, args }) => {
        try {
          if (readOnly && !/^\s*SELECT\b/i.test(sql)) throw new Error("Read-only transaction");
          return {
            error: null,
            ...request({
              op: "execute", name, sql,
              args: args.map((value) => value === undefined ? null : value),
            }),
          };
        } catch (error) {
          if (/^\s*(COMMIT|END)\b/i.test(sql)) {
            // Upstream WebSQL's commit callback ignores SQL result errors.
            // Fail closed before it can emit an IndexedDB "complete" event.
            try { request({ op: "rollback", name }); } catch {}
            const root = document.getElementById("root");
            root.textContent = "تعذر إتمام الحفظ في قاعدة الجهاز. أوقف العمل وأعد تشغيل التطبيق. لم تُعتبر الحركة محفوظة.";
            root.setAttribute("role", "alert");
            throw error;
          }
          return { error, rows: [], rowsAffected: 0 };
        }
      });
      setTimeout(() => callback(null, results), 0);
    },
  };
  const db = new WebSQLDatabase(version, driver, {});
  databases.set(name, db);
  return db;
};
window.nativeStorageRequest = request;
