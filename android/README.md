# Moje místa – Android aplikace

Nativní obal webové aplikace https://jakubgulec-cmd.github.io/moje-mista/ (WebView).
Přijímá sdílení z Instagramu (Sdílet → Moje místa) a předává odkaz webové aplikaci.

APK se sestavuje automaticky v GitHub Actions (`.github/workflows/android.yml`) a objeví se ve vydáních repozitáře.
Podpisový klíč je v GitHub Secrets (KEYSTORE_B64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD).
