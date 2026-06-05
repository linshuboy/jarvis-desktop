mod autostart;
mod commands;

use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuEvent, MenuItemBuilder};
use tauri::tray::TrayIcon;
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Manager, WindowEvent, Wry};

const TRAY_OPEN_ID: &str = "tray.open";
const TRAY_HIDE_ID: &str = "tray.hide";
const TRAY_AUTOSTART_ID: &str = "tray.autostart";
const TRAY_QUIT_ID: &str = "tray.quit";

#[derive(Default)]
pub(crate) struct TrayState {
    tray_icon: Mutex<Option<TrayIcon<Wry>>>,
    autostart_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl TrayState {
    fn install(&self, tray_icon: TrayIcon<Wry>, autostart_item: CheckMenuItem<Wry>) {
        if let Ok(mut slot) = self.tray_icon.lock() {
            *slot = Some(tray_icon);
        }
        if let Ok(mut slot) = self.autostart_item.lock() {
            *slot = Some(autostart_item);
        }
    }

    fn autostart_item(&self) -> Option<CheckMenuItem<Wry>> {
        self.autostart_item
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().cloned())
    }

    pub(crate) fn sync_autostart_checked(&self, enabled: bool) {
        if let Some(item) = self.autostart_item() {
            let _ = item.set_checked(enabled);
        }
    }
}

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

fn hide_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = app.hide() {
        eprintln!("failed to hide desktop app: {}", error);
    }
    apply_background_window_policy(app);
}

pub(crate) fn sync_tray_autostart_state(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        state.sync_autostart_checked(enabled);
    }
}

fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = app.show() {
        eprintln!("failed to show desktop app: {}", error);
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.unminimize() {
        eprintln!("failed to unminimize desktop window: {}", error);
    }
    if let Err(error) = window.show() {
        eprintln!("failed to show desktop window: {}", error);
    }
    if let Err(error) = window.set_focus() {
        eprintln!("failed to focus desktop window: {}", error);
    }
}

fn handle_tray_menu_event(app: &AppHandle, event: MenuEvent) {
    if event.id() == TRAY_OPEN_ID {
        show_main_window(app);
        return;
    }
    if event.id() == TRAY_HIDE_ID {
        hide_main_window(app);
        return;
    }
    if event.id() == TRAY_AUTOSTART_ID {
        let Some(state) = app.try_state::<TrayState>() else {
            return;
        };
        let Some(item) = state.autostart_item() else {
            return;
        };
        let requested_enabled = item.is_checked().unwrap_or(false);
        match autostart::set_enabled(requested_enabled) {
            Ok(status) => state.sync_autostart_checked(status.enabled),
            Err(error) => {
                eprintln!("failed to update desktop autostart from tray: {}", error);
                state.sync_autostart_checked(autostart::status().enabled);
            }
        }
        return;
    }
    if event.id() == TRAY_QUIT_ID {
        if let Err(error) = commands::desktop_quit_application(app.clone()) {
            eprintln!("failed to quit desktop app from tray: {}", error);
        }
    }
}

fn install_tray_icon(app: &AppHandle) -> Result<(), String> {
    let open_item = MenuItemBuilder::with_id(TRAY_OPEN_ID, "打开主界面")
        .build(app)
        .map_err(|error| format!("failed to build tray open item: {}", error))?;
    let hide_item = MenuItemBuilder::with_id(TRAY_HIDE_ID, "隐藏窗口")
        .build(app)
        .map_err(|error| format!("failed to build tray hide item: {}", error))?;
    let autostart_item = CheckMenuItemBuilder::with_id(TRAY_AUTOSTART_ID, "登录自启")
        .checked(autostart::status().enabled)
        .build(app)
        .map_err(|error| format!("failed to build tray autostart item: {}", error))?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "退出 App")
        .build(app)
        .map_err(|error| format!("failed to build tray quit item: {}", error))?;
    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&hide_item)
        .separator()
        .item(&autostart_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|error| format!("failed to build tray menu: {}", error))?;

    let mut tray_builder = TrayIconBuilder::with_id("desktop-tray")
        .menu(&menu)
        .tooltip("Sunvisai Desktop")
        .on_menu_event(|app, event| {
            handle_tray_menu_event(app, event);
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder.icon_as_template(true);
    }
    let tray_icon = tray_builder
        .build(app)
        .map_err(|error| format!("failed to build tray icon: {}", error))?;
    let state = app.state::<TrayState>();
    state.install(tray_icon, autostart_item);
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            app.manage(TrayState::default());
            let Some(main_window) = app.get_webview_window("main") else {
                return Ok(());
            };
            if let Err(error) = install_tray_icon(&app_handle) {
                eprintln!("failed to install desktop tray icon: {}", error);
            }
            let helper_app_handle = app_handle.clone();
            std::thread::spawn(move || {
                if let Err(error) =
                    commands::recover_helper_after_desktop_launch(&helper_app_handle)
                {
                    eprintln!(
                        "failed to recover desktop helper after app launch: {}",
                        error
                    );
                }
            });
            let close_app_handle = app_handle.clone();
            main_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_main_window(&close_app_handle);
                }
            });
            if autostart::background_launch_requested() {
                let launch_app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    hide_main_window(&launch_app_handle);
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
            commands::desktop_reconnect_runtime,
            commands::desktop_sync_auth_state,
            commands::desktop_logout,
            commands::desktop_set_app_autostart,
            commands::desktop_check_client_update,
            commands::desktop_download_client_update,
            commands::desktop_install_client_update,
            commands::desktop_quit_application
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Sunvisai desktop app");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        {
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show_main_window(app_handle);
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
