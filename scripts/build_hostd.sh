#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOSTD_DIR="$ROOT_DIR/runtime/hostd"
OUTPUT_ROOT="$ROOT_DIR/apps/desktop/src-tauri/binaries"

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

detect_target_triple() {
  local goos_value goarch_value
  goos_value="${1:-}"
  goarch_value="${2:-}"
  case "${goos_value}/${goarch_value}" in
    darwin/amd64) printf '%s\n' 'x86_64-apple-darwin' ;;
    darwin/arm64) printf '%s\n' 'aarch64-apple-darwin' ;;
    linux/amd64) printf '%s\n' 'x86_64-unknown-linux-gnu' ;;
    linux/arm64) printf '%s\n' 'aarch64-unknown-linux-gnu' ;;
    windows/amd64) printf '%s\n' 'x86_64-pc-windows-msvc' ;;
    windows/arm64) printf '%s\n' 'aarch64-pc-windows-msvc' ;;
    *)
      printf 'unsupported GOOS/GOARCH for desktop sidecar target: %s/%s\n' "$goos_value" "$goarch_value" >&2
      return 1
      ;;
  esac
}

GOOS_VALUE="${GOOS:-$(detect_goos)}"
GOARCH_VALUE="${GOARCH:-$(detect_goarch)}"
TARGET_TRIPLE_VALUE="${TARGET_TRIPLE:-$(detect_target_triple "$GOOS_VALUE" "$GOARCH_VALUE")}"

case "$GOOS_VALUE" in
  windows) BINARY_NAME="hostd.exe" ;;
  *) BINARY_NAME="hostd" ;;
esac

OUTPUT_PATH="$OUTPUT_ROOT/hostd-$TARGET_TRIPLE_VALUE"
if [[ "$GOOS_VALUE" == "windows" ]]; then
  OUTPUT_PATH="${OUTPUT_PATH}.exe"
fi

mkdir -p "$OUTPUT_ROOT"

printf 'building hostd -> %s\n' "$OUTPUT_PATH"
(
  cd "$HOSTD_DIR"
  GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" "$GO_BIN" build -o "$OUTPUT_PATH" ./cmd/hostd
)

if [[ "$GOOS_VALUE" != "windows" ]]; then
  chmod +x "$OUTPUT_PATH"
fi
