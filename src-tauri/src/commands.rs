use crate::autostart;

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use std::os::unix::net::UnixStream;

const HELPER_MANAGEMENT_MODE: &str = "app-managed";

#[derive(Clone)]
struct HostdPaths {
    data_root: PathBuf,
    config_path: PathBuf,
    state_path: PathBuf,
    control_socket_path: PathBuf,
}

fn hostd_binary_name() -> &'static str {
    if cfg!(windows) {
        "hostd.exe"
    } else {
        "hostd"
    }
}

fn bundled_hostd_relative_path() -> PathBuf {
    PathBuf::from("hostd")
        .join(format!("{}-{}", env::consts::OS, env::consts::ARCH))
        .join(hostd_binary_name())
}

fn resolve_hostd_bin(app: &AppHandle) -> PathBuf {
    if let Ok(path) = env::var("JARVIS_HOSTD_BIN") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let bundled_relative_path = bundled_hostd_relative_path();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_path = resource_dir.join(&bundled_relative_path);
        if bundled_path.is_file() {
            return bundled_path;
        }
    }

    let source_resources_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(&bundled_relative_path);
    if source_resources_path.is_file() {
        return source_resources_path;
    }

    let workspace_hostd_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../runtime/hostd")
        .join(hostd_binary_name());
    if workspace_hostd_path.is_file() {
        return workspace_hostd_path;
    }

    PathBuf::from(hostd_binary_name())
}

fn command_error(bin: &Path, args: &[&str], stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        format!("{} {:?} failed", bin.display(), args)
    } else {
        message
    }
}

fn run_hostd_json(app: &AppHandle, args: &[&str]) -> Result<Value, String> {
    let bin = resolve_hostd_bin(app);
    let output = Command::new(&bin)
        .args(args)
        .output()
        .map_err(|error| format!("failed to launch {}: {}", bin.display(), error))?;
    if !output.status.success() {
        return Err(command_error(&bin, args, &output.stderr));
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("failed to decode {} output: {}", bin.display(), error))
}

fn run_hostd_json_with_paths(
    app: &AppHandle,
    args: &[&str],
    paths: &HostdPaths,
) -> Result<Value, String> {
    let mut expanded = args
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    expanded.push(String::from("--config"));
    expanded.push(paths.config_path.display().to_string());
    expanded.push(String::from("--state"));
    expanded.push(paths.state_path.display().to_string());
    expanded.push(String::from("--control-socket"));
    expanded.push(paths.control_socket_path.display().to_string());
    let refs = expanded.iter().map(String::as_str).collect::<Vec<_>>();
    run_hostd_json(app, &refs)
}

#[derive(Default, Deserialize, Serialize)]
struct PersistedState {
    runtime_id: Option<String>,
    runtime_token: Option<String>,
    pairing_state: Option<String>,
    last_gateway_url: Option<String>,
    last_connected_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
struct SocketSnapshot {
    runtime_id: Option<String>,
    pairing_state: Option<String>,
    has_runtime_token: bool,
    last_gateway_url: Option<String>,
    last_connected_at: Option<String>,
    last_error: Option<String>,
    online: bool,
    connection_state: Option<String>,
    helper_pid: Option<u32>,
    control_socket_path: Option<String>,
}

fn resolve_hostd_paths(app: &AppHandle) -> Result<HostdPaths, String> {
    let default_data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve desktop app data dir: {}", error))?
        .join("hostd");
    let default_config_path = default_data_root.join("config.json");
    let default_state_path = default_data_root.join("state.json");
    let config_path = env::var("HOSTD_CONFIG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_config_path);
    let state_path = env::var("HOSTD_STATE_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_state_path);
    let control_socket_path = env::var("HOSTD_CONTROL_SOCKET_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| match env::consts::OS {
            "windows" => PathBuf::from(r"\\.\pipe\hostd-control"),
            _ => state_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("control.sock"),
        });
    let data_root = state_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    Ok(HostdPaths {
        data_root,
        config_path,
        state_path,
        control_socket_path,
    })
}

fn legacy_hostd_paths() -> Result<(PathBuf, PathBuf), String> {
    match env::consts::OS {
        "windows" => {
            let program_data = env::var("ProgramData")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| String::from(r"C:\ProgramData"));
            Ok((
                PathBuf::from(&program_data)
                    .join("hostd")
                    .join("config.json"),
                PathBuf::from(program_data).join("hostd").join("state.json"),
            ))
        }
        "macos" => {
            let home = home_dir()?;
            let base = home
                .join("Library")
                .join("Application Support")
                .join("hostd");
            Ok((base.join("config.json"), base.join("state.json")))
        }
        _ => Ok((
            PathBuf::from("/etc/hostd/config.json"),
            PathBuf::from("/var/lib/hostd/state.json"),
        )),
    }
}

fn maybe_copy_legacy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() || !source.is_file() || source == destination {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create desktop helper directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "failed to import legacy hostd file {} -> {}: {}",
            source.display(),
            destination.display(),
            error
        )
    })?;
    Ok(())
}

fn bootstrap_hostd_files(paths: &HostdPaths) -> Result<(), String> {
    fs::create_dir_all(&paths.data_root).map_err(|error| {
        format!(
            "failed to create desktop helper data dir {}: {}",
            paths.data_root.display(),
            error
        )
    })?;

    let use_default_config_path = env::var("HOSTD_CONFIG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_none();
    let use_default_state_path = env::var("HOSTD_STATE_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_none();
    if use_default_config_path || use_default_state_path {
        let (legacy_config_path, legacy_state_path) = legacy_hostd_paths()?;
        if use_default_config_path {
            maybe_copy_legacy_file(&legacy_config_path, &paths.config_path)?;
        }
        if use_default_state_path {
            maybe_copy_legacy_file(&legacy_state_path, &paths.state_path)?;
        }
    }

    if paths.config_path.exists() {
        return Ok(());
    }

    let gateway_ws_url = env::var("HOSTD_GATEWAY_WS_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let gateway_tls_mode = env::var("HOSTD_GATEWAY_TLS_MODE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| String::from("system"));
    let gateway_tls_fingerprint = env::var("HOSTD_GATEWAY_TLS_FINGERPRINT")
        .ok()
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let log_level = env::var("HOSTD_LOG_LEVEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| String::from("info"));

    let mut gateway = Map::new();
    gateway.insert(String::from("ws_url"), Value::String(gateway_ws_url));
    gateway.insert(String::from("tls_mode"), Value::String(gateway_tls_mode));
    if !gateway_tls_fingerprint.is_empty() {
        gateway.insert(
            String::from("tls_fingerprint"),
            Value::String(gateway_tls_fingerprint),
        );
    }
    let payload = json!({
        "gateway": Value::Object(gateway),
        "logging": {
            "level": log_level,
        },
    });
    if let Some(parent) = paths.config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create desktop helper config dir {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let mut content = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("failed to encode desktop helper config template: {}", error))?;
    content.push(b'\n');
    fs::write(&paths.config_path, content).map_err(|error| {
        format!(
            "failed to write desktop helper config {}: {}",
            paths.config_path.display(),
            error
        )
    })
}

fn home_dir() -> Result<PathBuf, String> {
    env::var("HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| String::from("HOME is not set"))
}

fn read_state_file(path: &Path) -> Result<PersistedState, String> {
    let content = match fs::read(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PersistedState::default())
        }
        Err(error) => {
            return Err(format!(
                "failed to read state file {}: {}",
                path.display(),
                error
            ))
        }
    };
    serde_json::from_slice::<PersistedState>(&content)
        .map_err(|error| format!("failed to decode state file {}: {}", path.display(), error))
}

fn write_state_file(path: &Path, state: &PersistedState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create state directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let payload = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("failed to encode state file {}: {}", path.display(), error))?;
    let mut output = payload;
    output.push(b'\n');
    fs::write(path, output)
        .map_err(|error| format!("failed to write state file {}: {}", path.display(), error))
}

fn ensure_runtime_id(state: &mut PersistedState) -> Result<(), String> {
    let current = state.runtime_id.as_deref().unwrap_or("").trim().to_string();
    if !current.is_empty() {
        state.runtime_id = Some(current);
        return Ok(());
    }
    state.runtime_id = Some(new_runtime_id()?);
    Ok(())
}

#[cfg(unix)]
fn new_runtime_id() -> Result<String, String> {
    let mut raw = [0u8; 16];
    let mut source = fs::File::open("/dev/urandom").map_err(|error| {
        format!(
            "failed to open /dev/urandom for runtime id generation: {}",
            error
        )
    })?;
    source.read_exact(&mut raw).map_err(|error| {
        format!(
            "failed to read random bytes for runtime id generation: {}",
            error
        )
    })?;
    raw[6] = (raw[6] & 0x0f) | 0x40;
    raw[8] = (raw[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7], raw[8], raw[9], raw[10], raw[11], raw[12], raw[13], raw[14], raw[15]
    ))
}

#[cfg(not(unix))]
fn new_runtime_id() -> Result<String, String> {
    Err(String::from(
        "runtime id generation fallback is not supported on this platform",
    ))
}

fn build_state_fallback(
    bridge_mode: &str,
    helper_available: bool,
    config_path: &Path,
    state_path: &Path,
    control_socket_path: &Path,
    state: PersistedState,
) -> Value {
    json!({
        "bridge_mode": bridge_mode,
        "helper_available": helper_available,
        "config_path": config_path.display().to_string(),
        "state_path": state_path.display().to_string(),
        "control_socket_path": control_socket_path.display().to_string(),
        "runtime_id": state.runtime_id.unwrap_or_default(),
        "pairing_state": normalize_pairing_state(state.pairing_state.as_deref()),
        "has_runtime_token": state.runtime_token.as_deref().map(|value| !value.trim().is_empty()).unwrap_or(false),
        "last_gateway_url": state.last_gateway_url.unwrap_or_default(),
        "last_connected_at": state.last_connected_at.unwrap_or_default(),
        "last_error": state.last_error.unwrap_or_default(),
        "online": false,
        "connection_state": "offline",
        "helper_pid": 0,
    })
}

fn normalize_socket_snapshot(
    bridge_mode: &str,
    helper_available: bool,
    config_path: &Path,
    state_path: &Path,
    control_socket_path: &Path,
    snapshot: SocketSnapshot,
) -> Value {
    json!({
        "bridge_mode": bridge_mode,
        "helper_available": helper_available,
        "config_path": config_path.display().to_string(),
        "state_path": state_path.display().to_string(),
        "control_socket_path": control_socket_path.display().to_string(),
        "runtime_id": snapshot.runtime_id.unwrap_or_default(),
        "pairing_state": normalize_pairing_state(snapshot.pairing_state.as_deref()),
        "has_runtime_token": snapshot.has_runtime_token,
        "last_gateway_url": snapshot.last_gateway_url.unwrap_or_default(),
        "last_connected_at": snapshot.last_connected_at.unwrap_or_default(),
        "last_error": snapshot.last_error.unwrap_or_default(),
        "online": snapshot.online,
        "connection_state": snapshot.connection_state.unwrap_or_else(|| String::from("offline")),
        "helper_pid": snapshot.helper_pid.unwrap_or_default(),
    })
}

fn normalize_pairing_state(value: Option<&str>) -> String {
    match value.unwrap_or("").trim().to_lowercase().as_str() {
        "pending" => String::from("pending"),
        "paired" => String::from("paired"),
        "revoked" => String::from("revoked"),
        _ => String::from("unpaired"),
    }
}

#[cfg(unix)]
fn appctl_request(
    route: &str,
    method: &str,
    payload: Option<&Value>,
    control_socket_path: &Path,
) -> Result<Value, String> {
    let mut stream = UnixStream::connect(control_socket_path).map_err(|error| {
        format!(
            "failed to connect hostd control socket {}: {}",
            control_socket_path.display(),
            error
        )
    })?;
    let body = if let Some(value) = payload {
        serde_json::to_vec(value)
            .map_err(|error| format!("failed to encode hostd request payload: {}", error))?
    } else {
        Vec::new()
    };
    let request = format!(
        "{method} {route} HTTP/1.1\r\nHost: hostd.local\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to write hostd control request: {}", error))?;
    if !body.is_empty() {
        stream
            .write_all(&body)
            .map_err(|error| format!("failed to write hostd control request body: {}", error))?;
    }
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|error| format!("failed to flush hostd control request: {}", error))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| format!("failed to read hostd control response: {}", error))?;
    parse_http_response(&response)
}

#[cfg(not(unix))]
fn appctl_request(
    _route: &str,
    _method: &str,
    _payload: Option<&Value>,
    _control_socket_path: &Path,
) -> Result<Value, String> {
    Err(String::from(
        "direct hostd IPC is only supported on unix platforms",
    ))
}

fn parse_http_response(bytes: &[u8]) -> Result<Value, String> {
    let separator = b"\r\n\r\n";
    let Some(index) = bytes
        .windows(separator.len())
        .position(|window| window == separator)
    else {
        return Err(String::from(
            "invalid hostd control response: missing http headers",
        ));
    };
    let headers = String::from_utf8_lossy(&bytes[..index]);
    let body = &bytes[index + separator.len()..];
    let status_line = headers
        .lines()
        .next()
        .ok_or_else(|| String::from("invalid hostd control response: missing status line"))?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| String::from("invalid hostd control response: missing status code"))?
        .parse::<u16>()
        .map_err(|error| format!("invalid hostd control response status code: {}", error))?;
    let payload = if body.is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_slice::<Value>(body)
            .map_err(|error| format!("failed to decode hostd control response body: {}", error))?
    };
    if status_code >= 400 {
        if let Some(message) = payload.get("error").and_then(Value::as_str) {
            return Err(message.to_string());
        }
        return Err(format!(
            "hostd control request failed with status {}",
            status_code
        ));
    }
    Ok(payload)
}

fn helper_available(_app: &AppHandle, paths: &HostdPaths) -> bool {
    #[cfg(unix)]
    {
        return appctl_request("/v1/snapshot", "GET", None, &paths.control_socket_path).is_ok();
    }
    #[cfg(not(unix))]
    {
        return run_hostd_json_with_paths(_app, &["app", "snapshot"], paths)
            .ok()
            .and_then(|value| {
                value
                    .get("helper_available")
                    .and_then(Value::as_bool)
                    .or_else(|| {
                        value.get("status").and_then(|status| {
                            status.get("helper_available").and_then(Value::as_bool)
                        })
                    })
            })
            .unwrap_or(false);
    }
}

fn spawn_hostd(app: &AppHandle, paths: &HostdPaths) -> Result<(), String> {
    let bin = resolve_hostd_bin(app);
    let mut command = Command::new(&bin);
    command
        .arg("run")
        .arg("--config")
        .arg(&paths.config_path)
        .arg("--state")
        .arg(&paths.state_path)
        .arg("--control-socket")
        .arg(&paths.control_socket_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map_err(|error| format!("failed to launch helper {}: {}", bin.display(), error))?;
    Ok(())
}

pub fn ensure_helper_running(app: &AppHandle) -> Result<(), String> {
    let paths = resolve_hostd_paths(app)?;
    bootstrap_hostd_files(&paths)?;
    if helper_available(app, &paths) {
        return Ok(());
    }
    run_hostd_json_with_paths(app, &["config", "validate"], &paths)?;
    spawn_hostd(app, &paths)?;
    for _ in 0..30 {
        if helper_available(app, &paths) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "helper did not become ready on {} after desktop startup",
        paths.control_socket_path.display()
    ))
}

fn load_runtime_snapshot(_app: &AppHandle, paths: &HostdPaths) -> Result<Value, String> {
    #[cfg(not(unix))]
    {
        return run_hostd_json_with_paths(_app, &["app", "snapshot"], paths);
    }
    match appctl_request("/v1/snapshot", "GET", None, &paths.control_socket_path) {
        Ok(value) => {
            let snapshot: SocketSnapshot = serde_json::from_value(value)
                .map_err(|error| format!("failed to decode hostd snapshot: {}", error))?;
            Ok(normalize_socket_snapshot(
                "direct-ipc",
                true,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                snapshot,
            ))
        }
        Err(_) => {
            let state = read_state_file(&paths.state_path)?;
            Ok(build_state_fallback(
                "state-fallback",
                false,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                state,
            ))
        }
    }
}

fn set_runtime_token_direct(app: &AppHandle, token: &str) -> Result<Value, String> {
    let paths = resolve_hostd_paths(app)?;
    #[cfg(not(unix))]
    {
        return run_hostd_json_with_paths(app, &["app", "set-token", "--token", token], &paths);
    }
    let _ = ensure_helper_running(app);
    let payload = json!({ "token": token });
    match appctl_request(
        "/v1/runtime-token",
        "POST",
        Some(&payload),
        &paths.control_socket_path,
    ) {
        Ok(value) => {
            let snapshot: SocketSnapshot = serde_json::from_value(value)
                .map_err(|error| format!("failed to decode hostd set-token response: {}", error))?;
            Ok(normalize_socket_snapshot(
                "direct-ipc",
                true,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                snapshot,
            ))
        }
        Err(_) => {
            let mut state = read_state_file(&paths.state_path)?;
            ensure_runtime_id(&mut state)?;
            state.runtime_token = Some(token.trim().to_string());
            state.pairing_state = Some(String::from("paired"));
            state.last_error = Some(String::new());
            write_state_file(&paths.state_path, &state)?;
            Ok(build_state_fallback(
                "state-fallback",
                false,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                state,
            ))
        }
    }
}

fn clear_runtime_token_direct(app: &AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(app)?;
    #[cfg(not(unix))]
    {
        return run_hostd_json_with_paths(app, &["app", "clear-token"], &paths);
    }
    let _ = ensure_helper_running(app);
    match appctl_request(
        "/v1/runtime-token/clear",
        "POST",
        Some(&json!({})),
        &paths.control_socket_path,
    ) {
        Ok(value) => {
            let snapshot: SocketSnapshot = serde_json::from_value(value).map_err(|error| {
                format!("failed to decode hostd clear-token response: {}", error)
            })?;
            Ok(normalize_socket_snapshot(
                "direct-ipc",
                true,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                snapshot,
            ))
        }
        Err(_) => {
            let mut state = read_state_file(&paths.state_path)?;
            ensure_runtime_id(&mut state)?;
            state.runtime_token = Some(String::new());
            state.pairing_state = Some(String::from("unpaired"));
            state.last_error = Some(String::new());
            write_state_file(&paths.state_path, &state)?;
            Ok(build_state_fallback(
                "state-fallback",
                false,
                &paths.config_path,
                &paths.state_path,
                &paths.control_socket_path,
                state,
            ))
        }
    }
}

#[tauri::command]
pub fn desktop_snapshot(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    let helper_startup_error = ensure_helper_running(&app).err();
    let resolved_hostd_bin = resolve_hostd_bin(&app);
    let version = run_hostd_json(&app, &["version"])?;
    let status = load_runtime_snapshot(&app, &paths)?;
    let app_autostart = serde_json::to_value(autostart::status())
        .map_err(|error| format!("failed to encode desktop autostart status: {}", error))?;
    let config_validation = match run_hostd_json_with_paths(&app, &["config", "validate"], &paths) {
        Ok(value) => value,
        Err(error) => json!({
            "valid": false,
            "error": error,
        }),
    };
    Ok(json!({
        "bridge": "tauri-hostd-ipc",
        "hostd_bin_path": resolved_hostd_bin.display().to_string(),
        "app_close_action": autostart::close_action(),
        "app_background_launch": autostart::background_launch_requested(),
        "app_autostart": app_autostart,
        "version": version,
        "status": status,
        "config_validation": config_validation,
        "helper_management": {
            "mode": HELPER_MANAGEMENT_MODE,
            "data_root": paths.data_root.display().to_string(),
            "startup_error": helper_startup_error,
        },
    }))
}

#[tauri::command]
pub fn desktop_validate_config(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    match run_hostd_json_with_paths(&app, &["config", "validate"], &paths) {
        Ok(value) => Ok(value),
        Err(error) => Ok(json!({
            "valid": false,
            "error": error,
        })),
    }
}

#[tauri::command]
pub fn desktop_set_runtime_token(app: AppHandle, token: String) -> Result<Value, String> {
    let trimmed = token.trim().to_string();
    if trimmed.is_empty() {
        return Err("runtime token is required".to_string());
    }
    set_runtime_token_direct(&app, trimmed.as_str())
}

#[tauri::command]
pub fn desktop_clear_runtime_token(app: AppHandle) -> Result<Value, String> {
    clear_runtime_token_direct(&app)
}

#[tauri::command]
pub fn desktop_set_app_autostart(enabled: bool) -> Result<Value, String> {
    let status = autostart::set_enabled(enabled)?;
    serde_json::to_value(status)
        .map_err(|error| format!("failed to encode desktop autostart update: {}", error))
}

#[tauri::command]
pub fn desktop_quit_application(app: AppHandle) -> Result<(), String> {
    match resolve_hostd_paths(&app) {
        Ok(paths) => {
            if let Err(error) = run_hostd_json_with_paths(&app, &["app", "shutdown"], &paths) {
                eprintln!("failed to stop helper before desktop exit: {}", error);
            }
        }
        Err(error) => {
            eprintln!(
                "failed to resolve desktop helper paths before exit: {}",
                error
            );
        }
    }
    app.exit(0);
    Ok(())
}
