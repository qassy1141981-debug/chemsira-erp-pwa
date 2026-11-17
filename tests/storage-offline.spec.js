const { test, expect } = require("@playwright/test");

const databaseName = "AccountingSystem";

async function openApp(page) {
  await page.goto("./");
  await expect(page.locator("#local-save-status")).toBeHidden();
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

async function setUpAndSignIn(page) {
  await startTrial(page);

  await page
    .getByPlaceholder("مثال: شركة النور للمنظفات")
    .fill(`شركة اختبار ${Date.now()}`);
  await page.getByRole("button", { name: "ابدأ الاستخدام" }).click();

  await page.getByPlaceholder("admin").fill("admin");
  await page.locator('input[type="password"]').fill("admin123");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("link", { name: "العملاء" })).toBeVisible();
}

test("a customer can be added and edited offline, then remains after reload", async ({
  page,
  context,
}) => {
  await openApp(page);
  await setUpAndSignIn(page);
  await page.goto("./#/customers");
  await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  await waitForServiceWorker(page);

  const customerName = `Offline customer ${Date.now()}`;
  const editedCustomerName = `${customerName} edited`;
  await context.setOffline(true);
  try {
    await page.getByRole("button", { name: "إضافة عميل" }).last().click();
    let customerDialog = page.getByRole("dialog");
    await customerDialog
      .getByPlaceholder("مثال: محمد أحمد")
      .fill(customerName);
    await customerDialog
      .getByRole("button", { name: "إضافة", exact: true })
      .click();
    await expect(page.getByText(customerName, { exact: true })).toBeVisible();

    const customerRow = page.getByRole("row").filter({ hasText: customerName });
    await customerRow.getByTitle("تعديل").click();
    customerDialog = page.getByRole("dialog");
    await expect(customerDialog).toBeVisible();
    await customerDialog
      .getByPlaceholder("مثال: محمد أحمد")
      .fill(editedCustomerName);
    await customerDialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(
      page.getByText(editedCustomerName, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(customerName, { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveTitle("النظام المحاسبي المتكامل");
    await expect(
      page.getByText(editedCustomerName, { exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
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

test("the installed app opens from its manifest start URL while offline", async ({
  page,
  context,
}) => {
  await openApp(page);
  await waitForServiceWorker(page);

  const installTarget = await page.evaluate(async () => {
    const manifestUrl = document.querySelector('link[rel="manifest"]').href;
    const manifest = await fetch(manifestUrl).then((response) => response.json());
    const startUrl = new URL(manifest.start_url, manifestUrl);
    const scopeUrl = new URL(manifest.scope, manifestUrl);
    const registration = await navigator.serviceWorker.getRegistration(startUrl.href);

    return {
      startUrl: startUrl.href,
      scope: scopeUrl.href,
      registrationScope: registration?.scope,
    };
  });

  expect(installTarget.startUrl.startsWith(installTarget.scope)).toBe(true);
  expect(installTarget.registrationScope).toBe(installTarget.scope);

  await context.setOffline(true);
  try {
    await page.goto(installTarget.startUrl);
    await expect(page).toHaveTitle("النظام المحاسبي المتكامل");
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator("#local-save-status")).toBeHidden();
  } finally {
    await context.setOffline(false);
  }
});

test("background storage checks stay hidden when persistence is refused", async ({
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
  await expect(indicator).toBeHidden();
  await expect(indicator).toHaveAttribute("data-state", "warning");
  await expect(indicator).toHaveText("الحفظ المحلي نشط");
  await expect(indicator).toHaveAttribute(
    "title",
    "البيانات محفوظة على هذا الجهاز. اضغط لطلب حمايتها من الإزالة التلقائية بواسطة المتصفح.",
  );
});

test("the save indicator warns when an AccountingSystem write is aborted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persist: () =>
          new Promise((resolve) => {
            window.resolvePersistentStorageRequest = resolve;
          }),
      },
    });
  });

  await openApp(page);
  await startTrial(page);

  await page.evaluate((databaseName) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("customers", "readwrite");
        transaction.addEventListener(
          "complete",
          () => {
            database.close();
            resolve();
          },
          { once: true },
        );
        transaction.addEventListener(
          "abort",
          () => reject(transaction.error || new Error("Setup transaction aborted")),
          { once: true },
        );
        transaction.objectStore("customers").clear();
      };
    });
  }, databaseName);

  const abortedWriteStatus = await page.evaluate((databaseName) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("customers", "readwrite");
        transaction.addEventListener(
          "abort",
          () => {
            const warningAtAbort = {
              state: document.querySelector("#local-save-status").dataset.state,
              text: document.querySelector("#local-save-status").textContent,
              title: document.querySelector("#local-save-status").title,
            };
            window.resolvePersistentStorageRequest(true);
            queueMicrotask(() => {
              const statusAfterPersistenceResponse = {
                state: document.querySelector("#local-save-status").dataset.state,
                text: document.querySelector("#local-save-status").textContent,
                title: document.querySelector("#local-save-status").title,
              };
              database.close();
              resolve({ warningAtAbort, statusAfterPersistenceResponse });
            });
          },
          { once: true },
        );
        transaction.objectStore("customers").clear();
        transaction.abort();
      };
    });
  }, databaseName);

  expect(abortedWriteStatus).toEqual({
    warningAtAbort: {
      state: "warning",
      text: "تعذر إتمام الحفظ",
      title: "لم تكتمل معاملة قاعدة البيانات المحلية.",
    },
    statusAfterPersistenceResponse: {
      state: "warning",
      text: "تعذر إتمام الحفظ",
      title: "لم تكتمل معاملة قاعدة البيانات المحلية.",
    },
  });
  await expect(page.locator("#local-save-status")).toBeVisible();
});
