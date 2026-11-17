const { _electron, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  const executablePath = path.resolve(__dirname,
    "../../generated-artifacts/accounting-native-windows/win-unpacked/Alsafa Accounting.exe");
  const launch = () => _electron.launch({ executablePath, timeout: 45000 });
  const first = await launch();
  try {
    const page = await first.firstWindow();
    await page.evaluate(() => window.nativeStorageReady);
    await expect(page.locator("#root")).not.toBeEmpty();
    await page.evaluate(async () => {
      const db = await new Promise((ok, fail) => {
        const r = indexedDB.open("WindowsSQLiteTest", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("movements", { keyPath: "id" });
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      await new Promise((ok, fail) => {
        const tx = db.transaction("movements", "readwrite");
        tx.objectStore("movements").put({ id: "receipt", amount: 125 });
        tx.oncomplete = ok; tx.onabort = () => fail(tx.error);
      });
      localStorage.setItem("windows-sqlite-test", "persisted");
      db.close();
    });
  } finally { await first.close(); }
  const second = await launch();
  try {
    const page = await second.firstWindow();
    await page.evaluate(() => window.nativeStorageReady);
    assert.equal(await page.evaluate(async () => {
      const db = await new Promise((ok, fail) => {
        const r = indexedDB.open("WindowsSQLiteTest", 1);
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      const record = await new Promise((ok, fail) => {
        const r = db.transaction("movements").objectStore("movements").get("receipt");
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      db.close();
      return indexedDB === shimIndexedDB && record.amount === 125 &&
        localStorage.getItem("windows-sqlite-test") === "persisted";
    }), true);
    console.log("PASS: packaged Windows executable reopened native SQLite data.");
  } finally { await second.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
