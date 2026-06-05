import type { ClientReleaseAsset, ClientReleaseManifest } from './types'

const DEFAULT_RELEASE_MANIFEST_URL =
  'https://github.com/linshuboy/jarvisai-releases/releases/latest/download/release-manifest.json'
const UPDATE_PROXY_STORAGE_KEY = 'agi.desktop.client_update_proxy_url'

export function releaseManifestUrl(): string {
  const configured = import.meta.env.VITE_CLIENT_RELEASE_MANIFEST_URL
  return configured?.trim() || DEFAULT_RELEASE_MANIFEST_URL
}

export function defaultUpdateProxyUrl(): string {
  return import.meta.env.VITE_CLIENT_UPDATE_PROXY_URL?.trim() || ''
}

export function readStoredUpdateProxyUrl(): string {
  const stored = globalThis.localStorage?.getItem(UPDATE_PROXY_STORAGE_KEY)
  return stored?.trim() || defaultUpdateProxyUrl()
}

export function writeStoredUpdateProxyUrl(value: string): void {
  const trimmed = value.trim()
  if (trimmed) {
    globalThis.localStorage?.setItem(UPDATE_PROXY_STORAGE_KEY, trimmed)
    return
  }
  globalThis.localStorage?.removeItem(UPDATE_PROXY_STORAGE_KEY)
}

export function currentDesktopPlatform(): string {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) {
    return 'macos'
  }
  if (platform.includes('win')) {
    return 'windows'
  }
  return 'linux'
}

export function currentDesktopArch(): string | null {
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (source.includes('arm64') || source.includes('aarch64')) {
    return 'arm64'
  }
  if (source.includes('x86_64') || source.includes('x64') || source.includes('win64') || source.includes('amd64')) {
    return 'amd64'
  }
  return null
}

export function preferredDesktopKinds(platform: string): string[] {
  if (platform === 'macos') {
    return ['dmg']
  }
  if (platform === 'windows') {
    return ['exe', 'msi']
  }
  return ['deb', 'rpm']
}

export function preferredDesktopInstallKinds(platform: string): string[] {
  if (platform === 'macos') {
    return ['dmg']
  }
  if (platform === 'windows') {
    return ['msi']
  }
  return []
}

function selectPreferredAssetByKinds(
  manifest: ClientReleaseManifest,
  preferredKinds: string[],
  allowFallback: boolean,
): ClientReleaseAsset | null {
  if (!preferredKinds.length) {
    return null
  }
  const platform = currentDesktopPlatform()
  const arch = currentDesktopArch()
  const platformAssets = manifest.clients.desktop.filter((asset) => asset.platform === platform)
  const archAssets = arch ? platformAssets.filter((asset) => asset.arch === arch) : []
  const assets = archAssets.length ? archAssets : platformAssets
  for (const kind of preferredKinds) {
    const matched = assets.find((asset) => asset.kind === kind)
    if (matched) {
      return matched
    }
  }
  return allowFallback ? (assets[0] ?? null) : null
}

export function selectPreferredDesktopAsset(manifest: ClientReleaseManifest): ClientReleaseAsset | null {
  const platform = currentDesktopPlatform()
  return selectPreferredAssetByKinds(manifest, preferredDesktopKinds(platform), true)
}

export function selectPreferredDesktopInstallAsset(manifest: ClientReleaseManifest): ClientReleaseAsset | null {
  const platform = currentDesktopPlatform()
  return selectPreferredAssetByKinds(manifest, preferredDesktopInstallKinds(platform), false)
}
