#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOSTD_DIR="$ROOT_DIR/runtime/hostd"
OUTPUT_ROOT="$ROOT_DIR/apps/desktop/src-tauri/binaries"
DESKTOP_PACKAGE_JSON="$ROOT_DIR/apps/desktop/package.json"

GO_BIN="${GO_BIN:-go}"

resolve_version() {
  local value tag_value
  value="${VERSION:-}"
  if [[ -z "$value" && -n "${RELEASE_TAG:-}" ]]; then
    tag_value="${RELEASE_TAG#refs/tags/}"
    if [[ "$tag_value" == v* ]]; then
      value="${tag_value#v}"
    elif [[ "$tag_value" =~ ^[0-9]+([.][0-9A-Za-z-]+)+$ ]]; then
      value="$tag_value"
    fi
  fi
  if [[ -z "$value" ]]; then
    value="$(node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(pkg.version || 'dev');" "$DESKTOP_PACKAGE_JSON")"
  fi
  printf '%s\n' "$value"
}

resolve_commit() {
  local value
  value="${SOURCE_SHA:-${GITHUB_SHA:-}}"
  if [[ -z "$value" ]]; then
    value="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    value="$(git -C "$HOSTD_DIR" rev-parse --short=12 HEAD 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    value="dev"
  fi
  printf '%s\n' "$value"
}

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
VERSION_VALUE="$(resolve_version)"
COMMIT_VALUE="$(resolve_commit)"
BUILD_DATE_VALUE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
LDFLAGS_VALUE="-s -w -X agi/runtime/hostd/internal/buildinfo.Version=$VERSION_VALUE -X agi/runtime/hostd/internal/buildinfo.Commit=$COMMIT_VALUE -X agi/runtime/hostd/internal/buildinfo.BuildDate=$BUILD_DATE_VALUE"

case "$GOOS_VALUE" in
  windows) BINARY_NAME="hostd.exe" ;;
  *) BINARY_NAME="hostd" ;;
esac

OUTPUT_PATH="$OUTPUT_ROOT/hostd-$TARGET_TRIPLE_VALUE"
if [[ "$GOOS_VALUE" == "windows" ]]; then
  OUTPUT_PATH="${OUTPUT_PATH}.exe"
fi

mkdir -p "$OUTPUT_ROOT"

printf 'building hostd %s (%s, %s) -> %s\n' "$VERSION_VALUE" "$COMMIT_VALUE" "$BUILD_DATE_VALUE" "$OUTPUT_PATH"
(
  cd "$HOSTD_DIR"
  GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" "$GO_BIN" build -trimpath -ldflags="$LDFLAGS_VALUE" -o "$OUTPUT_PATH" ./cmd/hostd
)

if [[ "$GOOS_VALUE" != "windows" ]]; then
  chmod +x "$OUTPUT_PATH"
fi

HOST_GOOS_VALUE="$(detect_goos 2>/dev/null || true)"
HOST_GOARCH_VALUE="$(detect_goarch 2>/dev/null || true)"
if [[ "$GOOS_VALUE" == "$HOST_GOOS_VALUE" && "$GOARCH_VALUE" == "$HOST_GOARCH_VALUE" ]]; then
  "$OUTPUT_PATH" version
else
  printf 'skipping hostd version self-check for cross target %s/%s on host %s/%s\n' "$GOOS_VALUE" "$GOARCH_VALUE" "${HOST_GOOS_VALUE:-unknown}" "${HOST_GOARCH_VALUE:-unknown}"
fi
