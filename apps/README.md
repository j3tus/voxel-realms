# Voxel Realms apps

Native shells around the game. Each app opens the bundled **server picker** (`launcher/`), then navigates its window to the chosen server, so the
game itself is always that server's own current web client (no app update needed when the game changes). Servers are remembered; the first run is
seeded from `launcher/config.json` (edit it to ship your own default server).

| App | Stack | Targets | Build |
|---|---|---|---|
| `desktop/` | Tauri 2 (Rust + the OS webview, ~5-10 MB) | Windows, macOS, Linux | `cd apps/desktop && npm i && npx tauri build` (Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev`) |
| `mobile/` | Capacitor 7 (Android project is committed) | Android, iOS | Android: `cd apps/mobile && npm i && npx cap sync android && cd android && ./gradlew assembleDebug` (needs JDK 21 + Android SDK). iOS: on a Mac, `npm run ios:add` then `npx cap open ios` |

Everything builds in CI: Actions -> *apps* -> Run workflow (installers for the three desktop systems + an Android APK as artifacts).
Desktop menu: Game -> Switch server (Ctrl/Cmd+Shift+S), Reload, Fullscreen (F11). The mobile app is locked to landscape and the game's touch controls take over; the page gets `?app=1` so it can tell it is running inside an app.

Status: written and reviewed, **not yet built or run on a device** (the Pi that hosts the game cannot build either). The first CI run is the real test; expect small fixes.
Not done yet: code signing / notarisation, store listings, app icons for Android/iOS (default Capacitor art; `desktop/icon.png` is the source icon), auto-update.

## Releasing (GitHub)
1. Create the GitHub repo and push this project (`git init`, add the remote, push; the repo root is this folder).
2. Put the repo in `site/download.html`: `<meta name="vr-repo" content="YOUR_USER/YOUR_REPO">`, then redeploy the site (`./vr update`).
3. Publish: `git tag v1.0.0 && git push --tags`. The *apps* workflow builds everything and attaches fixed-name files to the release
   (`voxel-realms-windows-x64-setup.exe`, `-windows-x64.msi`, `-macos.dmg`, `-linux-x64.AppImage`, `-linux-x64.deb`, `-android.apk`),
   which is what `/site/download.html` links to via `releases/latest/download/`. Until the repo is set the page shows "not published yet".
