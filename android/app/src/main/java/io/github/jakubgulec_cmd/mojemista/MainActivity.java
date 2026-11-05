package io.github.jakubgulec_cmd.mojemista;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Nativní obal webové aplikace Moje místa.
 * - Přijímá sdílení z Instagramu (ACTION_SEND text/plain) a předá odkaz webové aplikaci (?text=…).
 * - Odkazy mimo aplikaci (Mapy Google, Instagram) otevírá v příslušných aplikacích.
 * - Poloha přes systémové oprávnění, schránka přes JS most, Zpět zavírá panely.
 */
public class MainActivity extends Activity {
    private static final String BASE = "https://jakubgulec-cmd.github.io/moje-mista/";
    private static final String HOST = "jakubgulec-cmd.github.io";
    private static final int REQ_LOCATION = 1;

    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFFEEF1F6);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " MojeMistaApp/2");

        web.addJavascriptInterface(new Bridge(), "MojeMistaApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/moje-mista")) {
                    return false; // vlastní stránky zůstávají v aplikaci
                }
                openExternal(uri);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        }
        handleIntent(getIntent(), savedInstanceState == null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent, false);
    }

    /** Spuštění aplikace nebo sdílení: sdílený text pošleme webové aplikaci jako parametr. */
    private void handleIntent(Intent intent, boolean firstLaunch) {
        String shared = null;
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null) shared = text.toString();
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (shared == null && subject != null) shared = subject;
        }
        if (shared != null) {
            web.loadUrl(BASE + "?text=" + Uri.encode(shared) + "&source=app");
        } else if (firstLaunch) {
            web.loadUrl(BASE + "?source=app");
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // žádná aplikace pro odkaz
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocationPermission(), false);
            geoCallback = null;
            geoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        // Nejdřív ať webová aplikace zavře otevřený panel; když nic nezavřela, jdeme zpět / ven.
        web.evaluateJavascript("window.mmBack ? String(window.mmBack()) : 'false'", value -> {
            if (value != null && value.contains("true")) return;
            if (web.canGoBack()) web.goBack();
            else MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    /** Most pro webovou aplikaci (window.MojeMistaApp). */
    private class Bridge {
        @JavascriptInterface
        public String readClipboard() {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return "";
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
            return t == null ? "" : t.toString();
        }
    }
}
