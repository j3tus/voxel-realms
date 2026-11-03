// Desktop shell for Voxel Realms. The window opens the bundled server picker (apps/launcher); choosing a server navigates the window to that
// server's own web client, so the game is always current.
//
// Security posture:
//  * no native menu and no IPC permissions: neither the picker nor a remote game page can call into Rust (see capabilities/default.json)
//  * navigation is limited to http(s) (and the app's own tauri:// origin); file:, data:, javascript:, custom schemes etc. are refused
//  * the bundled picker runs under a strict CSP (tauri.conf.json); devtools are not compiled in
use tauri::{plugin::Builder as PluginBuilder, Runtime};

/// Allow only the app's own origin and plain web pages (the game servers the player chose).
fn navigation_allowed(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "http" | "https") || url.as_str() == "about:blank"
}

fn nav_guard<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    PluginBuilder::new("nav-guard").on_navigation(|_webview, url| navigation_allowed(url)).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(nav_guard())
        .run(tauri::generate_context!())
        .expect("error while running Voxel Realms");
}

#[cfg(test)]
mod tests {
    use super::navigation_allowed;
    fn ok(s: &str) -> bool { navigation_allowed(&tauri::Url::parse(s).unwrap()) }

    #[test]
    fn allows_web_and_app_origin() {
        assert!(ok("https://play.example.com/?app=1"));
        assert!(ok("http://localhost:8080/?app=1"));
        assert!(ok("tauri://localhost/index.html"));
    }

    #[test]
    fn blocks_everything_else() {
        for u in ["file:///etc/passwd", "data:text/html,hi", "javascript:alert(1)", "ftp://example.com/x", "blob:https://x/1", "ws://localhost:8080/", "app://evil/"] {
            assert!(!ok(u), "{u} should be blocked");
        }
    }
}
