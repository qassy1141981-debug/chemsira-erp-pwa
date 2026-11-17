const { chromium, expect } = require("../../artifacts/accounting/node_modules/@playwright/test");
const { createSQLiteBridge } = require("../storage/sqlite.cjs");
const { createServer } = require("node:http");
const { readFileSync, mkdtempSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "accounting-sqlite-"));
  let bridge = createSQLiteBridge(directory);
  let rejectTestCommit = false;
  // Test-only synchronous transport replaces the platform JS interface.
  // The production document forbids all network connections.
  const transport = `<script>window.nativeSQLite={request(json){
    const xhr=new XMLHttpRequest();xhr.open("POST","/native-sql",false);
    xhr.send(json);if(xhr.status!==200)throw new Error("Native test transport failed");return xhr.responseText;
  }};</script>`;
  const html = readFileSync(path.join(__dirname, "../../artifacts/accounting/desktop/offline/native.html"), "utf8")
    .replace("connect-src 'none'", "connect-src 'self'")
    .replace('<script>', `${transport}<script>`);
  const server = createServer(async (request, response) => {
    if (request.url === "/native-sql") {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { "content-type": "application/json" });
      const operation = JSON.parse(body);
      const rejectCommit = rejectTestCommit && operation.name === "CommitFailureTest" &&
        /^\s*(END|COMMIT)\b/i.test(operation.sql || "");
      const reply = rejectCommit
        ? JSON.stringify({ ok: false, error: "Simulated disk commit failure" })
        : bridge.request(body);
      if (!JSON.parse(reply).ok) console.error("SQL FAILURE", JSON.parse(body).op, JSON.parse(body).sql, reply);
      response.end(reply);
    } else if (request.url === "/seed") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Legacy storage fixture</title>");
    } else {
      response.writeHead(200, { "content-type": "text/html;charset=utf-8" });
      response.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"],
  });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (error) => { errors.push(error.message); console.error("PAGE ERROR", error.stack); });
  page.on("console", (message) => { if(message.type()==="error")console.error("BROWSER", message.text()); });
  try {
    await page.goto(`${url}/seed`);
    await page.evaluate(() => new Promise((ok, fail) => {
      localStorage.setItem("legacy-local-setting", "preserve-this");
      const open = indexedDB.open("AccountingSystem", 1);
      open.onupgradeneeded = () => {
        const customer = open.result.createObjectStore("customers", { keyPath: "id" });
        customer.createIndex("name", "name");
        const treasury = open.result.createObjectStore("treasury", { keyPath: "id" });
        treasury.createIndex("date", "date"); treasury.createIndex("type", "type");
      };
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("customers", "readwrite");
        tx.objectStore("customers").put({ id: "legacy-customer", name: "عميل سابق", balance: 7 });
        tx.oncomplete = () => { db.close(); ok(); }; tx.onabort = () => fail(tx.error);
      };
    }));
    await page.goto(url);
    await page.evaluate(() => window.nativeStorageReady);
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15000 });
    assert.equal(await page.evaluate(() => indexedDB === shimIndexedDB), true);
    console.log("Native SQLite-backed interface started.");

    const trial = page.getByRole("button", { name: /ابدأ تجربة/ });
    if (await trial.count()) await trial.click();
    await page.waitForTimeout(1500);
    assert.deepEqual(errors, []);
    const legacy = await page.evaluate(() => new Promise((ok, fail) => {
      const open = indexedDB.open("AccountingSystem");
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction("customers").objectStore("customers").get("legacy-customer");
        request.onsuccess = () => { db.close(); ok({
          balance: request.result.balance, setting: localStorage.getItem("legacy-local-setting"),
        }); }; request.onerror = () => fail(request.error);
      };
    }));
    assert.deepEqual(legacy, { balance: 7, setting: "preserve-this" });
    console.log("PASS: existing local movements and settings migrated without deleting the source database.");

    await page.evaluate(async () => {
      localStorage.setItem("native-persistence-test", "stored-in-sqlite");
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open("AccountingSystem");
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["customers", "treasury"], "readwrite");
        tx.objectStore("customers").put({ id:"native-customer", name:"عميل قاعدة الجهاز", balance:42 });
        tx.objectStore("treasury").put({ id:"native-movement", date:"2026-11-17", amount:42, type:"receipt" });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["customers", "treasury"], "readwrite");
        tx.objectStore("customers").put({id:"must-not-exist", name:"كتابة ملغاة"});
        // Abort after SQL statements have actually changed both stores, not
        // before the native transaction has started.
        const clear = tx.objectStore("treasury").clear();
        tx.oncomplete = () => reject(new Error("Aborted transaction completed"));
        tx.onabort = resolve;
        clear.onsuccess = () => tx.abort();
      });
      db.close();
    });
    await page.close();
    bridge.close(); // Simulate full process exit, not just a page reload.
    bridge = createSQLiteBridge(directory);
    const fresh = await browser.newPage();
    await fresh.goto(url);
    await fresh.evaluate(() => window.nativeStorageReady);
    const result = await fresh.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open("AccountingSystem");
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      const get = (table, key) => new Promise((resolve, reject) => {
        const request = db.transaction(table).objectStore(table).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      return {
        customer: await get("customers","native-customer"),
        movement: await get("treasury","native-movement"),
        aborted: await get("customers","must-not-exist"),
        setting: localStorage.getItem("native-persistence-test"),
      };
    });
    assert.equal(result.customer.balance, 42);
    assert.equal(result.movement.amount, 42);
    assert.equal(result.aborted, null);
    assert.equal(result.setting, "stored-in-sqlite");
    assert.ok(readdirSync(directory).some((name) => name.endsWith(".sqlite")));
    console.log("PASS: movements and settings survived SQLite close/reopen; aborted multi-table write was rolled back.");
    await fresh.evaluate(() => new Promise((ok, fail) => {
      openDatabase("CommitFailureTest", "1").transaction(
        (tx) => tx.executeSql("CREATE TABLE movements (amount INTEGER)", []), fail, ok);
    }));
    rejectTestCommit = true;
    fresh.on("pageerror", () => {}); // Expected: fail closed, never emit success.
    await fresh.evaluate(() => {
      window.falseSuccess = false;
      openDatabase("CommitFailureTest", "1").transaction(
        (tx) => tx.executeSql("INSERT INTO movements VALUES(99)", []),
        () => {},
        () => { window.falseSuccess = true; });
    });
    await expect(fresh.locator("#native-storage-fatal")).toContainText("تعذر إتمام الحفظ");
    assert.equal(await fresh.evaluate(() => window.falseSuccess), false);
    const remaining = JSON.parse(bridge.request(JSON.stringify({
      op: "execute", name: "CommitFailureTest",
      sql: "SELECT COUNT(*) AS count FROM movements", args: [],
    })));
    assert.equal(remaining.result.rows[0].count, 0);
    console.log("PASS: a failed COMMIT rolls back data and cannot report save success.");
  } finally {
    await browser.close();
    bridge.close();
    server.closeAllConnections();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
