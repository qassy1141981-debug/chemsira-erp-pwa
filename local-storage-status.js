(() => {
  const button = document.getElementById("local-save-status");
  if (!button) return;

  const setStatus = (message, state, title = "") => {
    button.textContent = message;
    button.dataset.state = state;
    button.title = title;
    // Keep background storage checks running without a permanent screen badge.
    // Only a failed database write needs an actionable, visible warning.
    button.hidden = message !== "تعذر إتمام الحفظ";
  };
  let writeOutcomeObserved = false;
  let latestWriteTransaction = 0;

  const requestPersistentStorage = async () => {
    if (!navigator.storage?.persist) {
      setStatus(
        "الحفظ المحلي نشط",
        "saved",
        "تُحفظ البيانات في قاعدة محلية على هذا الجهاز.",
      );
      return;
    }

    try {
      const persisted = await navigator.storage.persist();
      if (writeOutcomeObserved) return;
      setStatus(
        persisted ? "الحفظ المحلي محمي" : "الحفظ المحلي نشط",
        persisted ? "saved" : "warning",
        persisted
          ? "تُحفظ البيانات على هذا الجهاز، وطلبنا من المتصفح عدم حذفها تلقائيًا."
          : "البيانات محفوظة على هذا الجهاز. اضغط لطلب حمايتها من الإزالة التلقائية بواسطة المتصفح.",
      );
    } catch (error) {
      console.warn("[LocalStorage] تعذر طلب حماية التخزين المحلي:", error);
      if (writeOutcomeObserved) return;
      setStatus(
        "الحفظ المحلي نشط",
        "warning",
        "البيانات محفوظة على هذا الجهاز، لكن لم نتمكن من طلب منع المتصفح من حذفها تلقائيًا.",
      );
    }
  };

  const database = window.indexedDB;
  const Database = window.IDBDatabase;
  if (database && Database?.prototype?.transaction) {
    const originalTransaction = Database.prototype.transaction;
    Database.prototype.transaction = function (...args) {
      const transaction = originalTransaction.apply(this, args);
      if (this.name === "AccountingSystem" && args[1] === "readwrite") {
        const writeId = ++latestWriteTransaction;
        transaction.addEventListener(
          "complete",
          () => {
            if (writeId !== latestWriteTransaction) return;
            writeOutcomeObserved = true;
            setStatus("تم الحفظ على هذا الجهاز", "saved", "اكتملت كتابة البيانات في قاعدة الجهاز المحلية.");
          },
          { once: true },
        );
        transaction.addEventListener(
          "abort",
          () => {
            if (writeId !== latestWriteTransaction) return;
            writeOutcomeObserved = true;
            setStatus("تعذر إتمام الحفظ", "warning", "لم تكتمل معاملة قاعدة البيانات المحلية.");
          },
          { once: true },
        );
      }
      return transaction;
    };
  }

  button.addEventListener("click", requestPersistentStorage);
  requestPersistentStorage();
})();
