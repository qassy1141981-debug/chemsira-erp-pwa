package com.alsafa.accounting;

import android.view.ViewGroup;
import android.webkit.WebStorage;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class OfflineStorageTest {
    private String evaluate(ActivityScenario<MainActivity> activity, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        activity.onActivity(screen -> {
            WebView web = (WebView) ((ViewGroup) screen.findViewById(android.R.id.content)).getChildAt(0);
            web.evaluateJavascript(script, result -> { value.set(result); latch.countDown(); });
        });
        assertTrue("WebView did not respond", latch.await(15, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(ActivityScenario<MainActivity> activity, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 45000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(activity, expression))) return;
            Thread.sleep(150);
        }
        fail("Installed app did not complete: " + expression);
    }

    @Test public void movementsSurviveClosingAndClearingBrowserStorage() throws Exception {
        try (ActivityScenario<MainActivity> first = ActivityScenario.launch(MainActivity.class)) {
            waitFor(first, "typeof window.nativeStorageReady === 'object'");
            evaluate(first, """
                window.nativeStorageReady.then(()=>{window.nativeReadyForTest=true})
                """);
            waitFor(first, "window.nativeReadyForTest === true");
            evaluate(first, """
                (async()=>{
                  try {
                    const db=await new Promise((ok,fail)=>{
                      const r=indexedDB.open("DeviceSQLiteTest",1);
                      r.onupgradeneeded=()=>{r.result.createObjectStore("movements",{keyPath:"id"})};
                      r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
                    });
                    await new Promise((ok,fail)=>{
                      const tx=db.transaction("movements","readwrite");
                      tx.objectStore("movements").put({id:"receipt",amount:125});
                      tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
                    });
                    localStorage.setItem("device-sqlite-test","persisted");
                    db.close();window.savedForTest=true;
                  } catch(error) {window.saveTestError=String(error)}
                })()
                """);
            waitFor(first, "window.savedForTest === true");
            first.onActivity(screen -> {
                WebView web = (WebView) ((ViewGroup) screen.findViewById(android.R.id.content)).getChildAt(0);
                web.clearCache(true);
                WebStorage.getInstance().deleteAllData();
            });
        }
        try (ActivityScenario<MainActivity> second = ActivityScenario.launch(MainActivity.class)) {
            waitFor(second, "typeof window.nativeStorageReady === 'object'");
            evaluate(second, """
                (async()=>{
                  await window.nativeStorageReady;
                  const db=await new Promise((ok,fail)=>{
                    const r=indexedDB.open("DeviceSQLiteTest",1);
                    r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
                  });
                  const r=db.transaction("movements").objectStore("movements").get("receipt");
                  r.onsuccess=()=>{window.readForTest=r.result?.amount===125 &&
                    localStorage.getItem("device-sqlite-test")==="persisted"; db.close()};
                })()
                """);
            waitFor(second, "window.readForTest === true");
            assertEquals("true", evaluate(second, "indexedDB === shimIndexedDB"));
        }
    }
}
