mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::desktop_snapshot,
            commands::desktop_validate_config,
            commands::desktop_set_runtime_token,
            commands::desktop_clear_runtime_token
        ])
        .run(tauri::generate_context!())
        .expect("failed to run JARVIS desktop app");
}
