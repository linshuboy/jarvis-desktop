use std::env;
use std::process::Command;

use serde_json::{json, Value};

fn resolve_hostd_bin() -> String {
    if let Ok(path) = env::var("JARVIS_HOSTD_BIN") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "hostd".to_string()
}

fn command_error(bin: &str, args: &[&str], stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        format!("{} {:?} failed", bin, args)
    } else {
        message
    }
}

fn run_hostd_json(args: &[&str]) -> Result<Value, String> {
    let bin = resolve_hostd_bin();
    let output = Command::new(&bin)
        .args(args)
        .output()
        .map_err(|error| format!("failed to launch {}: {}", bin, error))?;
    if !output.status.success() {
        return Err(command_error(&bin, args, &output.stderr));
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("failed to decode {} output: {}", bin, error))
}

#[tauri::command]
pub fn desktop_snapshot() -> Result<Value, String> {
    let version = run_hostd_json(&["version"])?;
    let status = run_hostd_json(&["app", "snapshot"])?;
    let config_validation = match run_hostd_json(&["config", "validate"]) {
        Ok(value) => value,
        Err(error) => json!({
            "valid": false,
            "error": error,
        }),
    };
    Ok(json!({
        "bridge": "tauri-hostd-cli",
        "version": version,
        "status": status,
        "config_validation": config_validation,
    }))
}

#[tauri::command]
pub fn desktop_validate_config() -> Result<Value, String> {
    match run_hostd_json(&["config", "validate"]) {
        Ok(value) => Ok(value),
        Err(error) => Ok(json!({
            "valid": false,
            "error": error,
        })),
    }
}

#[tauri::command]
pub fn desktop_set_runtime_token(token: String) -> Result<Value, String> {
    let trimmed = token.trim().to_string();
    if trimmed.is_empty() {
        return Err("runtime token is required".to_string());
    }
    run_hostd_json(&["app", "set-token", "--token", trimmed.as_str()])
}

#[tauri::command]
pub fn desktop_clear_runtime_token() -> Result<Value, String> {
    run_hostd_json(&["app", "clear-token"])
}
