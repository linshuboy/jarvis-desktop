#!/usr/bin/env bash
set -euo pipefail

fail_or_skip() {
  local message="$1"
  if [[ "${MACOS_CODESIGN_REQUIRED:-}" == "true" ]]; then
    printf '%s\n' "$message" >&2
    exit 1
  fi
  printf '%s; skipping macOS code signing.\n' "$message"
  exit 0
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail_or_skip "macOS code signing must run on a Darwin host"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner_temp="${RUNNER_TEMP:-/tmp}"
keychain_path="${MACOS_CODESIGN_KEYCHAIN_PATH:-$runner_temp/sunvisai-macos-codesign.keychain-db}"
keychain_password="${MACOS_CODESIGN_KEYCHAIN_PASSWORD:-$(openssl rand -base64 24)}"
p12_path="$runner_temp/sunvisai-macos-codesign.p12"
root_cert_path="$repo_root/certs/sunvisai-local-root-ca.cer"
config_path="${MACOS_TAURI_SIGNING_CONFIG:-$runner_temp/tauri.macos.signing.json}"

p12_base64="${MACOS_CODESIGN_P12_BASE64:-}"
p12_password="${MACOS_CODESIGN_PASSWORD:-}"
signing_source="macOS"

if [[ -z "$p12_base64" || -z "$p12_password" ]]; then
  if [[ "${MACOS_CODESIGN_ALLOW_WINDOWS_FALLBACK:-true}" == "true" ]]; then
    p12_base64="${WINDOWS_CODESIGN_PFX_BASE64:-}"
    p12_password="${WINDOWS_CODESIGN_PASSWORD:-}"
    signing_source="Windows fallback"
  fi
fi

if [[ -z "$p12_base64" ]]; then
  fail_or_skip "MACOS_CODESIGN_P12_BASE64 is not configured and no reusable Windows PFX is available"
fi
if [[ -z "$p12_password" ]]; then
  fail_or_skip "MACOS_CODESIGN_PASSWORD is not configured and no reusable Windows PFX password is available"
fi

decode_base64_file() {
  local value="$1"
  local output="$2"
  if printf '%s' "$value" | base64 --decode >"$output" 2>/dev/null; then
    return 0
  fi
  printf '%s' "$value" | base64 -D >"$output"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

mkdir -p "$runner_temp"
decode_base64_file "$p12_base64" "$p12_path"
if [[ -n "${MACOS_CODESIGN_ROOT_CERT_BASE64:-}" ]]; then
  root_cert_path="$runner_temp/sunvisai-macos-root-ca.cer"
  decode_base64_file "$MACOS_CODESIGN_ROOT_CERT_BASE64" "$root_cert_path"
fi

if security list-keychains -d user | tr -d '"' | grep -Fxq "$keychain_path"; then
  security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
fi

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"

existing_keychains=()
while IFS= read -r keychain; do
  keychain="${keychain//\"/}"
  [[ -n "$keychain" ]] && existing_keychains+=("$keychain")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain_path" "${existing_keychains[@]}"

security import "$p12_path" \
  -k "$keychain_path" \
  -P "$p12_password" \
  -T /usr/bin/codesign \
  -T /usr/bin/security

if [[ -f "$root_cert_path" ]]; then
  security add-trusted-cert \
    -d \
    -r trustRoot \
    -k "$keychain_path" \
    "$root_cert_path"
fi

security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path"

rm -f "$p12_path"

identity_output="$(security find-identity -v -p codesigning "$keychain_path" || true)"
if [[ -z "$identity_output" || "$identity_output" == *"0 valid identities found"* ]]; then
  fail_or_skip "No valid macOS code signing identity found in temporary keychain"
fi

signing_identity="${MACOS_CODESIGN_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(printf '%s\n' "$identity_output" | awk '/[0-9A-F]{40}/ {print $2; exit}')"
fi
if [[ -z "$signing_identity" ]]; then
  fail_or_skip "Unable to resolve macOS code signing identity"
fi

escaped_identity="$(json_escape "$signing_identity")"
cat >"$config_path" <<EOF
{
  "bundle": {
    "macOS": {
      "signingIdentity": "$escaped_identity",
      "hardenedRuntime": false
    }
  }
}
EOF

tauri_config_args="--config $config_path"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    printf 'TAURI_CONFIG_ARGS=%s\n' "$tauri_config_args"
    printf 'MACOS_CODESIGN_KEYCHAIN_PATH=%s\n' "$keychain_path"
  } >>"$GITHUB_ENV"
fi

printf 'Configured macOS local code signing from %s certificate material.\n' "$signing_source"
printf 'Signing identity: %s\n' "$signing_identity"
printf 'Tauri config override: %s\n' "$config_path"
printf 'Build with: npx tauri build ... %s\n' "$tauri_config_args"
