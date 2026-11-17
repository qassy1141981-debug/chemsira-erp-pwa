package com.alsafa.accounting;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Only exposed to the packaged local HTML. No networking or external file paths. */
public final class SQLiteBridge {
    private final Context context;
    private final Map<String, SQLiteDatabase> databases = new HashMap<>();

    public SQLiteBridge(Context context) {
        this.context = context;
        database("__native_metadata__").execSQL(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }

    private SQLiteDatabase database(String name) {
        if (name == null || name.length() > 1024) throw new IllegalArgumentException("Invalid database name");
        if (databases.containsKey(name)) return databases.get(name);
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(name.getBytes(StandardCharsets.UTF_8));
            StringBuilder filename = new StringBuilder("accounting-");
            for (int index = 0; index < 12; index++) filename.append(String.format("%02x", hash[index] & 255));
            File file = context.getDatabasePath(filename + ".sqlite");
            File parent = file.getParentFile();
            if (!parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("Cannot create database folder");
            SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
            db.enableWriteAheadLogging();
            db.execSQL("PRAGMA synchronous=FULL");
            db.execSQL("PRAGMA busy_timeout=5000");
            databases.put(name, db);
            return db;
        } catch (Exception error) {
            throw new IllegalStateException("Cannot open local database", error);
        }
    }

    @JavascriptInterface
    public synchronized String request(String json) {
        JSONObject reply = new JSONObject();
        try {
            JSONObject request = new JSONObject(json);
            Object result = execute(request);
            reply.put("ok", true);
            reply.put("result", result == null ? JSONObject.NULL : result);
        } catch (Exception error) {
            try {
                reply.put("ok", false);
                reply.put("error", error.getMessage() == null ? "SQLite write failed" : error.getMessage());
            } catch (Exception ignored) { /* JSONObject keys are fixed. */ }
        }
        return reply.toString();
    }

    private Object execute(JSONObject request) throws Exception {
        String op = request.getString("op");
        SQLiteDatabase meta = database("__native_metadata__");
        switch (op) {
            case "kvAll": {
                JSONObject values = new JSONObject();
                try (Cursor cursor = meta.rawQuery("SELECT key,value FROM settings", null)) {
                    while (cursor.moveToNext()) values.put(cursor.getString(0), cursor.getString(1));
                }
                return values;
            }
            case "kvGet": {
                try (Cursor cursor = meta.rawQuery("SELECT value FROM settings WHERE key=?", new String[]{request.getString("key")})) {
                    return cursor.moveToFirst() ? cursor.getString(0) : null;
                }
            }
            case "kvSet":
                meta.execSQL("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                    new Object[]{request.getString("key"), request.getString("value")});
                return null;
            case "kvRemove":
                meta.execSQL("DELETE FROM settings WHERE key=?", new Object[]{request.getString("key")});
                return null;
            case "kvClear":
                meta.execSQL("DELETE FROM settings");
                return null;
        }
        SQLiteDatabase db = database(request.getString("name"));
        switch (op) {
            case "open": return null;
            case "begin": db.execSQL("BEGIN IMMEDIATE"); return null;
            case "commit": db.execSQL("COMMIT"); return null;
            case "rollback": db.execSQL("ROLLBACK"); return null;
            case "execute": {
                String sql = request.getString("sql");
                JSONArray args = request.getJSONArray("args");
                String first = sql.trim().split("\\s+", 2)[0].toUpperCase(Locale.ROOT);
                if (first.equals("SELECT") || first.equals("PRAGMA") || first.equals("WITH") || first.equals("EXPLAIN")) {
                    String[] bind = new String[args.length()];
                    for (int index = 0; index < args.length(); index++)
                        bind[index] = args.isNull(index) ? null : args.get(index).toString();
                    JSONArray rows = new JSONArray();
                    try (Cursor cursor = db.rawQuery(sql, bind)) {
                        while (cursor.moveToNext()) {
                            JSONObject row = new JSONObject();
                            for (int col = 0; col < cursor.getColumnCount(); col++) {
                                Object value;
                                switch (cursor.getType(col)) {
                                    case Cursor.FIELD_TYPE_NULL: value = JSONObject.NULL; break;
                                    case Cursor.FIELD_TYPE_INTEGER: value = cursor.getLong(col); break;
                                    case Cursor.FIELD_TYPE_FLOAT: value = cursor.getDouble(col); break;
                                    default: value = cursor.getString(col);
                                }
                                row.put(cursor.getColumnName(col), value);
                            }
                            rows.put(row);
                        }
                    }
                    return new JSONObject().put("rows", rows).put("rowsAffected", 0);
                }
                Object[] bind = new Object[args.length()];
                for (int index = 0; index < args.length(); index++) bind[index] = args.isNull(index) ? null : args.get(index);
                db.execSQL(sql, bind);
                try (Cursor cursor = db.rawQuery("SELECT changes(), last_insert_rowid()", null)) {
                    cursor.moveToFirst();
                    return new JSONObject().put("rows", new JSONArray())
                        .put("rowsAffected", cursor.getLong(0)).put("insertId", cursor.getLong(1));
                }
            }
            default: throw new IllegalArgumentException("Unsupported database operation");
        }
    }

    public synchronized void close() {
        for (SQLiteDatabase db : databases.values()) db.close();
        databases.clear();
    }
}
