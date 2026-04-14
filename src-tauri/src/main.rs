mod autostart;
mod commands;

use tauri::{AppHandle, Manager, WindowEvent};

fn apply_background_window_policy(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    #[cfg(target_os = "macos")]
    let result = window.hide();
    #[cfg(not(target_os = "macos"))]
    let result = window.minimize();
    if let Err(error) = result {
        eprintln!("failed to apply background window policy: {}", error);
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let Some(main_window) = app.get_webview_window("main") else {
                return Ok(());
            };
            let helper_app_handle = app_handle.clone();
            std::thread::spawn(move || {
                if let Err(error) = commands::ensure_helper_running(&helper_app_handle) {
                    eprintln!("failed to ensure desktop helper is running: {}", error);
                }
            });
            let close_app_handle = app_handle.clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    apply_background_window_policy(&close_app_handle);
                }
            });
            if autostart::background_launch_requested() {
                let launch_app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    apply_background_window_policy(&launch_app_handle);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_snapshot,
            commands::desktop_validate_config,
            commands::desktop_set_runtime_token,
            commands::desktop_clear_runtime_token,
            commands::desktop_login,
            commands::desktop_bind_current_runtime,
            commands::desktop_logout,
            commands::desktop_set_app_autostart,
            commands::desktop_quit_application
        ])
        .run(tauri::generate_context!())
        .expect("failed to run JARVIS desktop app");
}
