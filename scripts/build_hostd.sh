#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOSTD_DIR="$ROOT_DIR/runtime/hostd"
OUTPUT_ROOT="$ROOT_DIR/apps/desktop/src-tauri/resources/hostd"

GO_BIN="${GO_BIN:-go}"

detect_goos() {
  local uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Darwin) printf '%s\n' 'darwin' ;;
    Linux) printf '%s\n' 'linux' ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) printf '%s\n' 'windows' ;;
    *)
      printf 'unsupported operating system for hostd build: %s\n' "$uname_s" >&2
      return 1
      ;;
  esac
}

detect_goarch() {
  local uname_m
  uname_m="$(uname -m)"
  case "$uname_m" in
    x86_64|amd64) printf '%s\n' 'amd64' ;;
    arm64|aarch64) printf '%s\n' 'arm64' ;;
    *)
      printf 'unsupported architecture for hostd build: %s\n' "$uname_m" >&2
      return 1
      ;;
  esac
}

detect_resource_arch() {
  local goarch_value
  goarch_value="${1:-}"
  case "$goarch_value" in
    amd64|x86_64) printf '%s\n' 'x86_64' ;;
    arm64|aarch64) printf '%s\n' 'aarch64' ;;
    *)
      printf 'unsupported architecture for desktop resource path: %s\n' "$goarch_value" >&2
      return 1
      ;;
  esac
}

detect_resource_os() {
  local goos_value
  goos_value="${1:-}"
  case "$goos_value" in
    darwin) printf '%s\n' 'macos' ;;
    linux) printf '%s\n' 'linux' ;;
    windows) printf '%s\n' 'windows' ;;
    *)
      printf 'unsupported operating system for desktop resource path: %s\n' "$goos_value" >&2
      return 1
      ;;
  esac
}

GOOS_VALUE="${GOOS:-$(detect_goos)}"
GOARCH_VALUE="${GOARCH:-$(detect_goarch)}"
RESOURCE_OS="${RESOURCE_OS:-$(detect_resource_os "$GOOS_VALUE")}"
RESOURCE_ARCH="${RESOURCE_ARCH:-$(detect_resource_arch "$GOARCH_VALUE")}"

case "$GOOS_VALUE" in
  windows) BINARY_NAME="hostd.exe" ;;
  *) BINARY_NAME="hostd" ;;
esac

OUTPUT_DIR="$OUTPUT_ROOT/$RESOURCE_OS-$RESOURCE_ARCH"
OUTPUT_PATH="$OUTPUT_DIR/$BINARY_NAME"

mkdir -p "$OUTPUT_DIR"

printf 'building hostd -> %s\n' "$OUTPUT_PATH"
(
  cd "$HOSTD_DIR"
  GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" "$GO_BIN" build -o "$OUTPUT_PATH" ./cmd/hostd
)

if [[ "$GOOS_VALUE" != "windows" ]]; then
  chmod +x "$OUTPUT_PATH"
fi
