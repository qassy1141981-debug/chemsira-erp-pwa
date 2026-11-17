const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");

/** Shared native SQLite protocol, also exercised directly by persistence tests. */
function createSQLiteBridge(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const databases = new Map();
  const get = (name) => {
    if (typeof name !== "string" || name.length > 1024) throw new Error("Invalid database name");
    if (!databases.has(name)) {
      const filename = createHash("sha256").update(name).digest("hex").slice(0, 24);
      const db = new DatabaseSync(path.join(directory, `accounting-${filename}.sqlite`));
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      databases.set(name, db);
    }
    return databases.get(name);
  };
  const meta = get("__native_metadata__");
  meta.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const execute = (request) => {
    const { op, name } = request;
    switch (op) {
      case "open": get(name); return null;
      case "begin": get(name).exec("BEGIN IMMEDIATE"); return null;
      case "commit": get(name).exec("COMMIT"); return null;
      case "rollback": get(name).exec("ROLLBACK"); return null;
      case "execute": {
        if (typeof request.sql !== "string" || !Array.isArray(request.args)) throw new Error("Invalid SQL request");
        const db = get(name);
        const statement = db.prepare(request.sql);
        if (statement.columns().length) return { rows: statement.all(...request.args), rowsAffected: 0 };
        const result = statement.run(...request.args);
        return { rows: [], rowsAffected: Number(result.changes), insertId: Number(result.lastInsertRowid) };
      }
      case "kvAll": return Object.fromEntries(meta.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
      case "kvGet": return meta.prepare("SELECT value FROM settings WHERE key=?").get(request.key)?.value ?? null;
      case "kvSet": meta.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").run(request.key, request.value); return null;
      case "kvRemove": meta.prepare("DELETE FROM settings WHERE key=?").run(request.key); return null;
      case "kvClear": meta.exec("DELETE FROM settings"); return null;
      default: throw new Error("Unsupported database operation");
    }
  };
  return {
    request(json) {
      try { return JSON.stringify({ ok: true, result: execute(JSON.parse(json)) }); }
      catch (error) { return JSON.stringify({ ok: false, error: error.message }); }
    },
    close() {
      for (const db of databases.values()) db.close();
      databases.clear();
    },
  };
}
module.exports = { createSQLiteBridge };
