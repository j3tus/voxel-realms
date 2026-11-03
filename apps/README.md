# Voxel Realms apps

Native shells around the game. Each app opens the bundled **server picker** (`launcher/`), then navigates its window to the chosen server, so the
game itself is always that server's own current web client (no app update needed when the game changes). Servers are remembered; the first run is
seeded from `launcher/config.json` (edit it to ship your own default server).

| App | Stack | Targets | Build |
|---|---|---|---|
| `desktop/` | Tauri 2 (Rust + the OS webview, ~5-10 MB) | Windows, macOS, Linux | `cd apps/desktop && npm i && npx tauri build` (Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev`) |
| `mobile/` | Capacitor 7 (Android project is committed) | Android, iOS | Android: `cd apps/mobile && npm i && npx cap sync android && cd android && ./gradlew assembleDebug` (needs JDK 21 + Android SDK). iOS: on a Mac, `npm run ios:add` then `npx cap open ios` |

Everything builds in CI: Actions -> *apps* -> Run workflow (installers for the three desktop systems + an Android APK as artifacts).
The desktop app has no native menu (the game and picker are the whole window) and exposes no native APIs to web pages; navigation is limited to http(s). The mobile app is locked to landscape and the game's touch controls take over; the page gets `?app=1` so it can tell it is running inside an app.

## Security
* Desktop: strict CSP on the bundled picker, empty Tauri capability (no IPC for the picker or any game page), navigation guard, no devtools. `cargo test` covers the guard.
* Android: HTTPS only (plain http only to localhost / the emulator host), no cloud backup. The public release APK is attached **only** when it is signed (repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`); otherwise CI builds a debug APK as a test artifact only.
* Every release asset has a `.sha256` file and, for tagged releases, a GitHub build-provenance attestation: `gh attestation verify <file> --repo <owner>/<repo>`.
* Desktop installers are not code-signed yet (needs Apple/Microsoft certificates), so Windows SmartScreen / macOS Gatekeeper will warn. Verify the checksum or attestation before running.

Status: written and reviewed, **not yet built or run on a device** (the Pi that hosts the game cannot build either). The first CI run is the real test; expect small fixes.
Not done yet: code signing / notarisation, store listings, app icons for Android/iOS (default Capacitor art; `desktop/icon.png` is the source icon), auto-update.

## Releasing (GitHub)
1. Create the GitHub repo and push this project (`git init`, add the remote, push; the repo root is this folder).
2. Put the repo in `site/download.html`: `<meta name="vr-repo" content="YOUR_USER/YOUR_REPO">`, then redeploy the site (`./vr update`).
3. Publish: `git tag v1.0.0 && git push --tags`. The *apps* workflow builds everything and attaches fixed-name files to the release
   (`voxel-realms-windows-x64-setup.exe`, `-windows-x64.msi`, `-macos.dmg`, `-linux-x64.AppImage`, `-linux-x64.deb`, `-android.apk`),
   which is what `/site/download.html` links to via `releases/latest/download/`. Until the repo is set the page shows "not published yet".
