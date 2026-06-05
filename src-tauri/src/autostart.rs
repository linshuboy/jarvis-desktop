use serde::Serialize;
use std::env;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "macos")]
const MACOS_AUTOSTART_LABEL: &str = "ai.sunvisai.desktop.autostart";
#[cfg(target_os = "windows")]
const WINDOWS_RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const WINDOWS_RUN_VALUE: &str = "SunvisaiDesktop";
#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;
const LINUX_AUTOSTART_FILE: &str = "ai.sunvisai.desktop.desktop";

#[cfg(target_os = "windows")]
fn hidden_windows_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    command
}

#[derive(Debug, Clone, Serialize)]
pub struct AppAutostartStatus {
    pub platform: String,
    pub supported: bool,
    pub enabled: bool,
    pub mode: String,
    pub entry_path: String,
    pub target_path: String,
    pub last_error: Option<String>,
}

pub fn background_launch_requested() -> bool {
    env::args().any(|argument| argument == "--background")
}

pub fn close_action() -> &'static str {
    if cfg!(target_os = "macos") {
        "hide"
    } else {
        "minimize"
    }
}

pub fn status() -> AppAutostartStatus {
    match status_result() {
        Ok(status) => status,
        Err(error) => AppAutostartStatus {
            platform: env::consts::OS.to_string(),
            supported: is_supported(),
            enabled: false,
            mode: String::from("background"),
            entry_path: String::new(),
            target_path: current_executable_path()
                .map(|path| path.display().to_string())
                .unwrap_or_default(),
            last_error: Some(error),
        },
    }
}

pub fn set_enabled(enabled: bool) -> Result<AppAutostartStatus, String> {
    if !is_supported() {
        return Ok(status());
    }
    let executable_path = current_executable_path()?;
    platform_set_enabled(&executable_path, enabled)?;
    Ok(status())
}

fn current_executable_path() -> Result<PathBuf, String> {
    env::current_exe()
        .map_err(|error| format!("failed to resolve current executable path: {}", error))
}

fn is_supported() -> bool {
    matches!(env::consts::OS, "macos" | "windows" | "linux")
}

fn status_result() -> Result<AppAutostartStatus, String> {
    let executable_path = current_executable_path()?;
    platform_status(&executable_path)
}

#[cfg(target_os = "macos")]
fn platform_status(executable_path: &Path) -> Result<AppAutostartStatus, String> {
    let entry_path = macos_plist_path()?;
    Ok(AppAutostartStatus {
        platform: env::consts::OS.to_string(),
        supported: true,
        enabled: entry_path.is_file(),
        mode: String::from("background"),
        entry_path: entry_path.display().to_string(),
        target_path: executable_path.display().to_string(),
        last_error: None,
    })
}

#[cfg(target_os = "macos")]
fn platform_set_enabled(executable_path: &Path, enabled: bool) -> Result<(), String> {
    let entry_path = macos_plist_path()?;
    if enabled {
        let payload = render_macos_launch_agent(executable_path)?;
        if let Some(parent) = entry_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create macOS launch agent directory {}: {}",
                    parent.display(),
                    error
                )
            })?;
        }
        fs::write(&entry_path, payload).map_err(|error| {
            format!(
                "failed to write macOS launch agent {}: {}",
                entry_path.display(),
                error
            )
        })?;
    } else if entry_path.exists() {
        fs::remove_file(&entry_path).map_err(|error| {
            format!(
                "failed to remove macOS launch agent {}: {}",
                entry_path.display(),
                error
            )
        })?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_plist_path() -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{MACOS_AUTOSTART_LABEL}.plist")))
}

#[cfg(target_os = "macos")]
fn render_macos_launch_agent(executable_path: &Path) -> Result<String, String> {
    let executable = xml_escape(&executable_path.display().to_string());
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{MACOS_AUTOSTART_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{executable}</string>
    <string>--background</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
"#
    ))
}

#[cfg(target_os = "windows")]
fn platform_status(executable_path: &Path) -> Result<AppAutostartStatus, String> {
    let output = hidden_windows_command("reg")
        .args(["query", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE])
        .output()
        .map_err(|error| format!("failed to query Windows autostart registry: {}", error))?;
    let enabled = output.status.success();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let last_error = if enabled {
        None
    } else if stderr.to_lowercase().contains("unable to find") {
        None
    } else {
        if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        }
    };
    Ok(AppAutostartStatus {
        platform: env::consts::OS.to_string(),
        supported: true,
        enabled,
        mode: String::from("background"),
        entry_path: format!(r"{}\{}", WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE),
        target_path: executable_path.display().to_string(),
        last_error,
    })
}

#[cfg(target_os = "windows")]
fn platform_set_enabled(executable_path: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        let command = format!(r#""{}" --background"#, executable_path.display());
        let output = hidden_windows_command("reg")
            .args([
                "add",
                WINDOWS_RUN_KEY,
                "/v",
                WINDOWS_RUN_VALUE,
                "/t",
                "REG_SZ",
                "/d",
                command.as_str(),
                "/f",
            ])
            .output()
            .map_err(|error| format!("failed to enable Windows autostart: {}", error))?;
        if !output.status.success() {
            return Err(reg_error(
                "failed to enable Windows autostart",
                &output.stderr,
            ));
        }
    } else {
        let output = hidden_windows_command("reg")
            .args(["delete", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE, "/f"])
            .output()
            .map_err(|error| format!("failed to disable Windows autostart: {}", error))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.to_lowercase().contains("unable to find") {
                return Err(reg_error(
                    "failed to disable Windows autostart",
                    &output.stderr,
                ));
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn reg_error(prefix: &str, stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {message}")
    }
}

#[cfg(target_os = "linux")]
fn platform_status(executable_path: &Path) -> Result<AppAutostartStatus, String> {
    let entry_path = linux_autostart_file_path()?;
    let enabled = if entry_path.is_file() {
        let content = fs::read_to_string(&entry_path).map_err(|error| {
            format!(
                "failed to read Linux autostart entry {}: {}",
                entry_path.display(),
                error
            )
        })?;
        !content
            .lines()
            .any(|line| line.trim().eq_ignore_ascii_case("Hidden=true"))
    } else {
        false
    };
    Ok(AppAutostartStatus {
        platform: env::consts::OS.to_string(),
        supported: true,
        enabled,
        mode: String::from("background"),
        entry_path: entry_path.display().to_string(),
        target_path: executable_path.display().to_string(),
        last_error: None,
    })
}

#[cfg(target_os = "linux")]
fn platform_set_enabled(executable_path: &Path, enabled: bool) -> Result<(), String> {
    let entry_path = linux_autostart_file_path()?;
    if enabled {
        if let Some(parent) = entry_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create Linux autostart directory {}: {}",
                    parent.display(),
                    error
                )
            })?;
        }
        fs::write(&entry_path, render_linux_desktop_entry(executable_path)).map_err(|error| {
            format!(
                "failed to write Linux autostart entry {}: {}",
                entry_path.display(),
                error
            )
        })?;
    } else if entry_path.exists() {
        fs::remove_file(&entry_path).map_err(|error| {
            format!(
                "failed to remove Linux autostart entry {}: {}",
                entry_path.display(),
                error
            )
        })?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_autostart_file_path() -> Result<PathBuf, String> {
    Ok(home_dir()?
        .join(".config")
        .join("autostart")
        .join(LINUX_AUTOSTART_FILE))
}

#[cfg(target_os = "linux")]
fn render_linux_desktop_entry(executable_path: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName=Sunvisai Desktop\nComment=Launch Sunvisai Desktop in background mode on login\nExec={} --background\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        desktop_exec_escape(&executable_path.display().to_string())
    )
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_status(executable_path: &Path) -> Result<AppAutostartStatus, String> {
    Ok(AppAutostartStatus {
        platform: env::consts::OS.to_string(),
        supported: false,
        enabled: false,
        mode: String::from("background"),
        entry_path: String::new(),
        target_path: executable_path.display().to_string(),
        last_error: None,
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_set_enabled(_executable_path: &Path, _enabled: bool) -> Result<(), String> {
    Ok(())
}

fn home_dir() -> Result<PathBuf, String> {
    env::var("HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| String::from("HOME is not set"))
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "linux")]
fn desktop_exec_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 8);
    escaped.push('"');
    for character in value.chars() {
        match character {
            '"' | '\\' | '$' | '`' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped.push('"');
    escaped
}
