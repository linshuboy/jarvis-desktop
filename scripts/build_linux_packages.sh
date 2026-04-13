#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

resolve_cache_dir() {
  local preferred fallback
  preferred="${1:-}"
  fallback="${2:-}"
  if [[ -n "$preferred" ]]; then
    mkdir -p "$preferred" 2>/dev/null || true
    if [[ -d "$preferred" && -w "$preferred" ]]; then
      printf '%s\n' "$preferred"
      return 0
    fi
  fi
  mkdir -p "$fallback"
  printf '%s\n' "$fallback"
}

if [[ -z "${PKG_CONFIG:-}" && -x /usr/bin/pkg-config ]]; then
  export PKG_CONFIG=/usr/bin/pkg-config
fi

SYSTEM_PKG_CONFIG_PATHS=()
if [[ -d /usr/lib/x86_64-linux-gnu/pkgconfig ]]; then
  SYSTEM_PKG_CONFIG_PATHS+=("/usr/lib/x86_64-linux-gnu/pkgconfig")
fi
if [[ -d /usr/share/pkgconfig ]]; then
  SYSTEM_PKG_CONFIG_PATHS+=("/usr/share/pkgconfig")
fi
if [[ ${#SYSTEM_PKG_CONFIG_PATHS[@]} -gt 0 ]]; then
  SYSTEM_PKG_CONFIG_JOINED="$(IFS=:; printf '%s' "${SYSTEM_PKG_CONFIG_PATHS[*]}")"
  if [[ -n "${PKG_CONFIG_PATH:-}" ]]; then
    export PKG_CONFIG_PATH="${SYSTEM_PKG_CONFIG_JOINED}:${PKG_CONFIG_PATH}"
  else
    export PKG_CONFIG_PATH="${SYSTEM_PKG_CONFIG_JOINED}"
  fi
fi

if [[ -z "${GOCACHE:-}" ]]; then
  export GOCACHE="$(resolve_cache_dir "${XDG_CACHE_HOME:-$HOME/.cache}/go-build" "/tmp/go-cache")"
fi

if [[ -z "${GOMODCACHE:-}" ]]; then
  export GOMODCACHE="$(resolve_cache_dir "${XDG_CACHE_HOME:-$HOME/.cache}/go-modcache" "/tmp/go-modcache")"
fi

cd "$DESKTOP_DIR"
npm run build:icons
npm run build:hostd
npx tauri build --bundles deb,rpm "$@"
