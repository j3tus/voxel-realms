// Desktop shell for Voxel Realms. The window opens the bundled server picker (apps/launcher); choosing a server navigates the window to that
// server's own web client, so the game is always current. The menu adds the things a browser tab cannot: switch server, fullscreen, reload.
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let win = app.get_webview_window("main").expect("main window");
            let launcher = win.url()?; // the bundled picker, remembered so "Switch server" can come back to it
            let switch = MenuItemBuilder::with_id("switch", "Switch server").accelerator("CmdOrCtrl+Shift+S").build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "Reload").accelerator("CmdOrCtrl+R").build(app)?;
            let full = MenuItemBuilder::with_id("fullscreen", "Toggle fullscreen").accelerator("F11").build(app)?;
            let game = SubmenuBuilder::new(app, "Game").item(&switch).item(&reload).item(&full).separator().quit().build()?;
            app.set_menu(MenuBuilder::new(app).item(&game).build()?)?;
            app.on_menu_event(move |app, event| {
                let Some(w) = app.get_webview_window("main") else { return };
                match event.id().as_ref() {
                    "switch" => { let _ = w.navigate(launcher.clone()); }
                    "reload" => { let _ = w.eval("location.reload()"); }
                    "fullscreen" => { let f = w.is_fullscreen().unwrap_or(false); let _ = w.set_fullscreen(!f); }
                    _ => {}
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Voxel Realms");
}
