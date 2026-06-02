import type { ClientReleaseAsset, ClientReleaseManifest } from './types'

const DEFAULT_RELEASE_MANIFEST_URL =
  'https://github.com/linshuboy/JARVISAI/releases/latest/download/release-manifest.json'

export function releaseManifestUrl(): string {
  const configured = import.meta.env.VITE_CLIENT_RELEASE_MANIFEST_URL
  return configured?.trim() || DEFAULT_RELEASE_MANIFEST_URL
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
