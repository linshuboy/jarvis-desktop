use crate::autostart;
use crate::sync_tray_autostart_state;

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use reqwest::blocking::{Client, Response};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::StatusCode;
use reqwest::Url;
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
    auth_session_path: PathBuf,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct DesktopAuthUser {
    user_id: String,
    username: String,
    display_name: Option<String>,
    role: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct DesktopAuthSession {
    server_url: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    user: Option<DesktopAuthUser>,
}

#[derive(Deserialize)]
struct AuthBootstrapStatus {
    init_done: bool,
}

#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    user: DesktopAuthUser,
}

#[derive(Deserialize)]
struct AuthMeResponse {
    user: DesktopAuthUser,
}

#[derive(Deserialize)]
struct CreateBindingInviteResponse {
    invite_url: Option<String>,
    invite_code: Option<String>,
}

#[derive(Debug)]
enum ApiError {
    Http { status: StatusCode, message: String },
    Transport(String),
    Decode(String),
}

impl ApiError {
    fn message(&self) -> String {
        match self {
            Self::Http { message, .. } => message.clone(),
            Self::Transport(message) => message.clone(),
            Self::Decode(message) => message.clone(),
        }
    }
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
    if let Ok(path) = env::var("AGI_HOSTD_BIN") {
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
    let auth_session_path = config_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("auth-session.json");
    Ok(HostdPaths {
        data_root,
        config_path,
        state_path,
        control_socket_path,
        auth_session_path,
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

fn read_auth_session(path: &Path) -> Result<DesktopAuthSession, String> {
    let content = match fs::read(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DesktopAuthSession::default())
        }
        Err(error) => {
            return Err(format!(
                "failed to read desktop auth session {}: {}",
                path.display(),
                error
            ))
        }
    };
    serde_json::from_slice::<DesktopAuthSession>(&content).map_err(|error| {
        format!(
            "failed to decode desktop auth session {}: {}",
            path.display(),
            error
        )
    })
}

fn write_auth_session(path: &Path, session: &DesktopAuthSession) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create desktop auth session directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let mut payload = serde_json::to_vec_pretty(session).map_err(|error| {
        format!(
            "failed to encode desktop auth session {}: {}",
            path.display(),
            error
        )
    })?;
    payload.push(b'\n');
    fs::write(path, payload).map_err(|error| {
        format!(
            "failed to write desktop auth session {}: {}",
            path.display(),
            error
        )
    })
}

fn auth_state_json(
    session: &DesktopAuthSession,
    bootstrap_init_done: Option<bool>,
    auth_error: Option<&str>,
) -> Value {
    json!({
        "server_url": session.server_url.clone().unwrap_or_default(),
        "authenticated": session
            .access_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "user": session.user.clone(),
        "bootstrap_init_done": bootstrap_init_done,
        "auth_error": auth_error.map(str::to_string),
    })
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

fn normalize_server_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(String::from("server_url is required"));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    let mut url = Url::parse(&with_scheme)
        .map_err(|error| format!("invalid server_url {}: {}", trimmed, error))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(format!(
                "server_url scheme must be http or https, got {}",
                scheme
            ))
        }
    }
    if url.host_str().is_none() {
        return Err(String::from("server_url host is required"));
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_string();
    if path.is_empty() {
        url.set_path("/");
    } else {
        url.set_path(format!("{}/", path).as_str());
    }
    Ok(url.to_string())
}

fn api_url(server_url: &str, path: &str) -> Result<Url, String> {
    let base = Url::parse(server_url)
        .map_err(|error| format!("invalid normalized server_url {}: {}", server_url, error))?;
    base.join(path).map_err(|error| {
        format!(
            "failed to resolve API path {} from {}: {}",
            path, server_url, error
        )
    })
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("failed to build desktop HTTP client: {}", error))
}

fn parse_api_response(response: Response) -> Result<Value, ApiError> {
    let status = response.status();
    let body = response.text().map_err(|error| {
        ApiError::Transport(format!("failed to read API response body: {}", error))
    })?;
    let payload = if body.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(&body).map_err(|error| {
            ApiError::Decode(format!("failed to decode API response body: {}", error))
        })?
    };
    if !status.is_success() {
        let message = payload
            .get("detail")
            .and_then(Value::as_str)
            .or_else(|| payload.get("error").and_then(Value::as_str))
            .or_else(|| payload.get("message").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| format!("request failed with status {}", status.as_u16()));
        return Err(ApiError::Http { status, message });
    }
    Ok(payload)
}

fn get_json(server_url: &str, path: &str) -> Result<Value, ApiError> {
    let client = build_http_client().map_err(ApiError::Transport)?;
    let url = api_url(server_url, path).map_err(ApiError::Transport)?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| ApiError::Transport(format!("failed to call API: {}", error)))?;
    parse_api_response(response)
}

fn post_json(
    server_url: &str,
    path: &str,
    bearer_token: Option<&str>,
    payload: &Value,
) -> Result<Value, ApiError> {
    let client = build_http_client().map_err(ApiError::Transport)?;
    let url = api_url(server_url, path).map_err(ApiError::Transport)?;
    let mut request = client.post(url).header(CONTENT_TYPE, "application/json");
    if let Some(token) = bearer_token {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", trimmed));
        }
    }
    let response = request
        .json(payload)
        .send()
        .map_err(|error| ApiError::Transport(format!("failed to call API: {}", error)))?;
    parse_api_response(response)
}

fn get_json_authenticated(
    session: &mut DesktopAuthSession,
    auth_session_path: &Path,
    path: &str,
) -> Result<Value, String> {
    let server_url = require_server_url(session)?;
    let access_token = require_access_token(session)?;
    let request_once = |token: &str| -> Result<Value, ApiError> {
        let client = build_http_client().map_err(ApiError::Transport)?;
        let url = api_url(&server_url, path).map_err(ApiError::Transport)?;
        let response = client
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
            .send()
            .map_err(|error| ApiError::Transport(format!("failed to call API: {}", error)))?;
        parse_api_response(response)
    };
    match request_once(&access_token) {
        Ok(value) => Ok(value),
        Err(ApiError::Http {
            status: StatusCode::UNAUTHORIZED,
            ..
        }) => {
            refresh_auth_session(session, auth_session_path)?;
            let next_access_token = require_access_token(session)?;
            request_once(&next_access_token).map_err(|error| error.message())
        }
        Err(error) => Err(error.message()),
    }
}

fn require_server_url(session: &DesktopAuthSession) -> Result<String, String> {
    let value = session
        .server_url
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if value.is_empty() {
        return Err(String::from("server_url is required"));
    }
    Ok(value)
}

fn require_access_token(session: &DesktopAuthSession) -> Result<String, String> {
    let value = session
        .access_token
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if value.is_empty() {
        return Err(String::from("desktop auth session is not authenticated"));
    }
    Ok(value)
}

fn refresh_auth_session(
    session: &mut DesktopAuthSession,
    auth_session_path: &Path,
) -> Result<(), String> {
    let server_url = require_server_url(session)?;
    let refresh_token = session
        .refresh_token
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if refresh_token.is_empty() {
        return Err(String::from(
            "desktop auth session refresh_token is missing",
        ));
    }
    let payload = post_json(
        &server_url,
        "api/auth/refresh",
        None,
        &json!({ "refresh_token": refresh_token }),
    )
    .map_err(|error| error.message())?;
    let refreshed: AuthResponse = serde_json::from_value(payload)
        .map_err(|error| format!("failed to decode auth refresh response: {}", error))?;
    session.access_token = Some(refreshed.access_token);
    session.refresh_token = Some(refreshed.refresh_token);
    session.user = Some(refreshed.user);
    write_auth_session(auth_session_path, session)?;
    Ok(())
}

fn post_authenticated_json(
    session: &mut DesktopAuthSession,
    auth_session_path: &Path,
    path: &str,
    payload: &Value,
) -> Result<Value, String> {
    let server_url = require_server_url(session)?;
    let access_token = require_access_token(session)?;
    match post_json(&server_url, path, Some(&access_token), payload) {
        Ok(value) => Ok(value),
        Err(ApiError::Http {
            status: StatusCode::UNAUTHORIZED,
            ..
        }) => {
            refresh_auth_session(session, auth_session_path)?;
            let next_access_token = require_access_token(session)?;
            post_json(&server_url, path, Some(&next_access_token), payload)
                .map_err(|error| error.message())
        }
        Err(error) => Err(error.message()),
    }
}

fn clear_auth_credentials(session: &mut DesktopAuthSession) {
    session.access_token = None;
    session.refresh_token = None;
    session.user = None;
}

fn sync_auth_state(paths: &HostdPaths) -> Result<Value, String> {
    let mut session = read_auth_session(&paths.auth_session_path)?;
    let server_url = match require_server_url(&session) {
        Ok(value) => value,
        Err(_) => return Ok(auth_state_json(&session, None, None)),
    };
    let bootstrap_payload = match get_json(&server_url, "api/auth/bootstrap/status") {
        Ok(value) => value,
        Err(error) => {
            return Ok(auth_state_json(
                &session,
                None,
                Some(error.message().as_str()),
            ))
        }
    };
    let bootstrap: AuthBootstrapStatus = serde_json::from_value(bootstrap_payload)
        .map_err(|error| format!("failed to decode bootstrap status response: {}", error))?;
    if !bootstrap.init_done {
        clear_auth_credentials(&mut session);
        write_auth_session(&paths.auth_session_path, &session)?;
        return Ok(auth_state_json(&session, Some(false), None));
    }
    if !session
        .access_token
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        return Ok(auth_state_json(&session, Some(true), None));
    }
    match get_json_authenticated(&mut session, &paths.auth_session_path, "api/auth/me") {
        Ok(payload) => {
            let me: AuthMeResponse = serde_json::from_value(payload)
                .map_err(|error| format!("failed to decode auth me response: {}", error))?;
            session.user = Some(me.user);
            write_auth_session(&paths.auth_session_path, &session)?;
            Ok(auth_state_json(&session, Some(true), None))
        }
        Err(error) => {
            let lower = error.to_lowercase();
            if lower.contains("invalid")
                || lower.contains("revoked")
                || lower.contains("expired")
                || lower.contains("not authenticated")
            {
                clear_auth_credentials(&mut session);
                write_auth_session(&paths.auth_session_path, &session)?;
                return Ok(auth_state_json(
                    &session,
                    Some(true),
                    Some("登录状态已失效，请重新登录"),
                ));
            }
            Ok(auth_state_json(&session, Some(true), Some(error.as_str())))
        }
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

fn bind_current_runtime(app: &AppHandle, paths: &HostdPaths) -> Result<Value, String> {
    let mut session = read_auth_session(&paths.auth_session_path)?;
    let invite_payload = post_authenticated_json(
        &mut session,
        &paths.auth_session_path,
        "api/host/runtime/invites",
        &json!({ "expires_in_seconds": 900 }),
    )?;
    let invite: CreateBindingInviteResponse = serde_json::from_value(invite_payload)
        .map_err(|error| format!("failed to decode binding invite response: {}", error))?;
    let invite_url = invite
        .invite_url
        .or_else(|| {
            invite.invite_code.map(|code| {
                format!(
                    "{}/api/host/runtime/invites/claim?code={}",
                    require_server_url(&session)
                        .unwrap_or_default()
                        .trim_end_matches('/'),
                    code
                )
            })
        })
        .unwrap_or_default();
    let trimmed_invite_url = invite_url.trim().to_string();
    if trimmed_invite_url.is_empty() {
        return Err(String::from(
            "binding invite response did not include invite_url",
        ));
    }
    let claim_value = run_hostd_json_with_paths(
        app,
        &[
            "pair",
            "claim-invite",
            "--invite-url",
            trimmed_invite_url.as_str(),
        ],
        paths,
    )?;
    let _ = ensure_helper_running(app);
    Ok(claim_value)
}

fn persist_auth_and_bind(
    app: &AppHandle,
    paths: &HostdPaths,
    server_url: String,
    auth: AuthResponse,
) -> Result<Value, String> {
    let session = DesktopAuthSession {
        server_url: Some(server_url),
        access_token: Some(auth.access_token),
        refresh_token: Some(auth.refresh_token),
        user: Some(auth.user),
    };
    write_auth_session(&paths.auth_session_path, &session)?;
    match bind_current_runtime(app, paths) {
        Ok(_) => Ok(json!({
            "authenticated": true,
            "bind_succeeded": true,
            "bind_error": Value::Null,
            "auth": auth_state_json(&session, Some(true), None),
        })),
        Err(error) => {
            write_auth_session(&paths.auth_session_path, &session)?;
            Ok(json!({
                "authenticated": true,
                "bind_succeeded": false,
                "bind_error": error,
                "auth": auth_state_json(&session, Some(true), None),
            }))
        }
    }
}

fn login_and_bind(
    app: &AppHandle,
    server_url: &str,
    username: &str,
    password: &str,
) -> Result<Value, String> {
    let paths = resolve_hostd_paths(app)?;
    bootstrap_hostd_files(&paths)?;
    let normalized_server_url = normalize_server_url(server_url)?;
    let bootstrap: AuthBootstrapStatus = serde_json::from_value(
        get_json(&normalized_server_url, "api/auth/bootstrap/status")
            .map_err(|error| error.message())?,
    )
    .map_err(|error| format!("failed to decode bootstrap status response: {}", error))?;
    if !bootstrap.init_done {
        return Err(String::from("服务端尚未初始化，无法登录桌面客户端"));
    }
    let login_payload = post_json(
        &normalized_server_url,
        "api/auth/login",
        None,
        &json!({
            "username": username.trim(),
            "password": password,
        }),
    )
    .map_err(|error| error.message())?;
    let auth: AuthResponse = serde_json::from_value(login_payload)
        .map_err(|error| format!("failed to decode auth login response: {}", error))?;
    persist_auth_and_bind(app, &paths, normalized_server_url, auth)
}

#[tauri::command]
pub fn desktop_snapshot(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    let helper_startup_error = ensure_helper_running(&app).err();
    let resolved_hostd_bin = resolve_hostd_bin(&app);
    let version = run_hostd_json(&app, &["version"])?;
    let status = load_runtime_snapshot(&app, &paths)?;
    let auth = auth_state_json(&read_auth_session(&paths.auth_session_path)?, None, None);
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
        "auth": auth,
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
pub fn desktop_login(
    app: AppHandle,
    server_url: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    let normalized_username = username.trim().to_string();
    if normalized_username.is_empty() {
        return Err(String::from("username is required"));
    }
    if password.trim().is_empty() {
        return Err(String::from("password is required"));
    }
    login_and_bind(&app, &server_url, &normalized_username, password.as_str())
}

#[tauri::command]
pub fn desktop_bind_current_runtime(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    bind_current_runtime(&app, &paths)
}

#[tauri::command]
pub fn desktop_sync_auth_state(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    sync_auth_state(&paths)
}

#[tauri::command]
pub fn desktop_logout(app: AppHandle) -> Result<Value, String> {
    let paths = resolve_hostd_paths(&app)?;
    let mut session = read_auth_session(&paths.auth_session_path)?;
    if session
        .refresh_token
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        let server_url = require_server_url(&session)?;
        let _ = post_json(
            &server_url,
            "api/auth/logout",
            None,
            &json!({
                "refresh_token": session.refresh_token.clone().unwrap_or_default(),
            }),
        );
    }
    let preserved_server_url = session.server_url.clone();
    session = DesktopAuthSession {
        server_url: preserved_server_url,
        access_token: None,
        refresh_token: None,
        user: None,
    };
    write_auth_session(&paths.auth_session_path, &session)?;
    let _ = clear_runtime_token_direct(&app);
    Ok(auth_state_json(&session, Some(true), None))
}

#[tauri::command]
pub fn desktop_set_app_autostart(app: AppHandle, enabled: bool) -> Result<Value, String> {
    let status = autostart::set_enabled(enabled)?;
    sync_tray_autostart_state(&app, status.enabled);
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

#[cfg(test)]
mod tests {
    use super::{api_url, normalize_server_url};

    #[test]
    fn normalize_server_url_accepts_plain_hostname() {
        let normalized = normalize_server_url("jarvis.example.com").expect("normalize server url");
        assert_eq!(normalized, "https://jarvis.example.com/");
    }

    #[test]
    fn normalize_server_url_preserves_path_prefix() {
        let normalized = normalize_server_url("https://jarvis.example.com/desktop")
            .expect("normalize server url");
        assert_eq!(normalized, "https://jarvis.example.com/desktop/");
        let login_url = api_url(&normalized, "api/auth/login").expect("api url");
        assert_eq!(
            login_url.as_str(),
            "https://jarvis.example.com/desktop/api/auth/login"
        );
    }
}
