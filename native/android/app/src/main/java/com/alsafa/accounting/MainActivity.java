package com.alsafa.accounting;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private WebView webView;
    private SQLiteBridge database;
    private ValueCallback<Uri[]> filePicker;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            database = new SQLiteBridge(this);
            webView = new WebView(this);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true); // Read-only migration of earlier app data.
            webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            webView.getSettings().setAllowFileAccess(false);
            webView.getSettings().setAllowContentAccess(true);
            webView.addJavascriptInterface(database, "nativeSQLite");
            webView.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Toast.makeText(MainActivity.this, "الروابط الخارجية تحتاج إلى الإنترنت.", Toast.LENGTH_LONG).show();
                    return true;
                }
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return new WebResourceResponse("text/plain", "UTF-8",
                        new ByteArrayInputStream(new byte[0]));
                }
            });
            webView.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (filePicker != null) filePicker.onReceiveValue(null);
                    filePicker = callback;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, 10);
                    return true;
                }
            });
            setContentView(webView);
            try (InputStream input = getAssets().open("accounting.html");
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                webView.loadDataWithBaseURL("https://localhost/",
                    new String(output.toByteArray(), StandardCharsets.UTF_8), "text/html", "UTF-8", null);
            }
        } catch (Exception error) {
            new AlertDialog.Builder(this).setTitle("تعذر فتح قاعدة بيانات الجهاز")
                .setMessage("لم تُحذف بياناتك. أعد تشغيل التطبيق أو استعد نسخة احتياطية.")
                .setPositiveButton("إغلاق", (dialog, which) -> finish()).show();
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 10 && filePicker != null) {
            filePicker.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null
                ? new Uri[]{data.getData()} : null);
            filePicker = null;
        }
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (webView != null) { webView.removeJavascriptInterface("nativeSQLite"); webView.destroy(); }
        if (database != null) database.close();
        super.onDestroy();
    }
}
