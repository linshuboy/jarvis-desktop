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

export function preferredDesktopKinds(platform: string): string[] {
  if (platform === 'macos') {
    return ['dmg']
  }
  if (platform === 'windows') {
    return ['exe', 'msi']
  }
  return ['deb', 'rpm']
}

export function selectPreferredDesktopAsset(manifest: ClientReleaseManifest): ClientReleaseAsset | null {
  const platform = currentDesktopPlatform()
  const preferredKinds = preferredDesktopKinds(platform)
  const assets = manifest.clients.desktop.filter((asset) => asset.platform === platform)
  for (const kind of preferredKinds) {
    const matched = assets.find((asset) => asset.kind === kind)
    if (matched) {
      return matched
    }
  }
  return assets[0] ?? null
}
