const { test, expect } = require("@playwright/test");

const databaseName = "AccountingSystem";

async function openApp(page) {
  await page.goto("/");
  await expect(page.locator("#local-save-status")).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector("#root")?.textContent?.trim().length > 0,
  );
}

async function waitForServiceWorker(page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && navigator.serviceWorker.controller);
  });
}

async function startTrial(page) {
  const trialButton = page.getByRole("button", {
    name: "ابدأ تجربة ٣ أيام مجانًا",
  });
  if (await trialButton.isVisible()) {
    await trialButton.click();
  }

  await page.waitForFunction(async (databaseName) => {
    if (typeof indexedDB.databases !== "function") return false;
    const databases = await indexedDB.databases();
    const exists = databases.some((database) => database.name === databaseName);
    if (!exists) return false;

    return new Promise((resolve) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        const ready = database.objectStoreNames.contains("customers");
        database.close();
        resolve(ready);
      };
    });
  }, databaseName);
}

test("a local application record is still present after reload", async ({
  page,
}) => {
  await openApp(page);
  await startTrial(page);

  const record = {
    id: `playwright-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "Playwright persistence check",
  };

  try {
    const saved = await page.evaluate(
      ({ databaseName, record }) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains("customers")) {
              database.close();
              reject(new Error("The application customers store is unavailable"));
              return;
            }

            const transaction = database.transaction("customers", "readwrite");
            transaction.objectStore("customers").put(record);
            transaction.oncomplete = () => {
              database.close();
              resolve(true);
            };
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          };
        }),
      { databaseName, record },
    );
    expect(saved).toBe(true);

    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          ({ databaseName, id }) =>
            new Promise((resolve, reject) => {
              const request = indexedDB.open(databaseName);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const database = request.result;
                const transaction = database.transaction("customers", "readonly");
                const lookup = transaction.objectStore("customers").get(id);
                lookup.onsuccess = () => {
                  const found = lookup.result;
                  database.close();
                  resolve(found?.name ?? null);
                };
                lookup.onerror = () => reject(lookup.error);
              };
            }),
          { databaseName, id: record.id },
        ),
      )
      .toBe(record.name);
  } finally {
    await page.evaluate(
      ({ databaseName, id }) =>
        new Promise((resolve) => {
          const request = indexedDB.open(databaseName);
          request.onerror = () => resolve();
          request.onsuccess = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains("customers")) {
              database.close();
              resolve();
              return;
            }
            const transaction = database.transaction("customers", "readwrite");
            transaction.objectStore("customers").delete(id);
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onerror = transaction.onabort = () => {
              database.close();
              resolve();
            };
          };
        }),
      { databaseName, id: record.id },
    );
  }
});

test("the application shell opens from its service-worker cache offline", async ({
  page,
  context,
}) => {
  await openApp(page);
  await waitForServiceWorker(page);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page).toHaveTitle("النظام المحاسبي المتكامل");
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText("لا يوجد اتصال بالإنترنت")).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test("the save indicator warns when persistent storage is refused", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persist: async () => false,
      },
    });
  });

  await openApp(page);

  const indicator = page.locator("#local-save-status");
  await expect(indicator).toHaveAttribute("data-state", "warning");
  await expect(indicator).toHaveText("الحفظ المحلي نشط");
  await expect(indicator).toHaveAttribute(
    "title",
    "البيانات محفوظة على هذا الجهاز. اضغط لطلب حمايتها من الإزالة التلقائية بواسطة المتصفح.",
  );
});
