import type {
  AppAutostartStatus,
  DesktopClientUpdateCheck,
  DesktopClientUpdateDownload,
  DesktopClientUpdateInstall,
  ConfigValidation,
  DesktopAuthState,
  DesktopLoginResult,
  DesktopSnapshot,
  HelperManagementStatus,
  PairStatus,
} from './types'
import { releaseManifestUrl, selectPreferredDesktopAsset, selectPreferredDesktopInstallAsset } from './clientUpdates'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

const CURRENT_DESKTOP_VERSION = '0.1.14'

const helperMethods = [
  'host.fs.stat',
  'host.fs.list',
  'host.fs.read',
  'host.fs.write',
  'host.fs.mkdir',
  'host.exec.run',
]

let mockStatus: PairStatus = {
  bridge_mode: 'mock-web-bridge',
  helper_available: true,
  config_path: '~/Library/Application Support/Sunvisai Desktop/hostd/config.json',
  state_path: '~/Library/Application Support/Sunvisai Desktop/hostd/state.json',
  control_socket_path: '~/Library/Application Support/Sunvisai Desktop/hostd/control.sock',
  runtime_id: 'mock-runtime-id',
  pairing_state: 'pending',
  has_runtime_token: false,
  last_gateway_url: 'ws://127.0.0.1:8001/ws/node',
  last_connected_at: '',
  last_error: 'PAIRING_REQUIRED: runtime pairing required',
  online: false,
  connection_state: 'waiting_for_pairing',
  helper_pid: 4242,
}

let mockAuth: DesktopAuthState = {
  server_url: 'https://sunvisai.example.com/',
  authenticated: false,
  user: null,
  bootstrap_init_done: true,
  auth_error: null,
}

let mockConfigValidation: ConfigValidation = {
  valid: true,
  config_path: mockStatus.config_path,
  state_path: mockStatus.state_path,
  config: {
    gateway: {
      ws_url: 'ws://127.0.0.1:8001/ws/node',
      tls_mode: 'system',
    },
    display_name: 'macbook-pro-lab',
    heartbeat_seconds: 20,
    components: {
      host: {
        enabled: true,
        methods: helperMethods,
      },
    },
    logging: {
      level: 'info',
    },
  },
}

let mockHelperManagement: HelperManagementStatus = {
  mode: 'app-managed',
  data_root: '~/Library/Application Support/Sunvisai Desktop/hostd',
}

let mockAutostartStatus: AppAutostartStatus = {
  platform: 'darwin',
  supported: true,
  enabled: false,
  mode: 'background',
  entry_path: '~/Library/LaunchAgents/ai.sunvisai.desktop.autostart.plist',
  target_path: '/Applications/Sunvisai Desktop.app/Contents/MacOS/Sunvisai Desktop',
}

async function resolveInvoke(): Promise<TauriInvoke | null> {
  try {
    const core = await import('@tauri-apps/api/core')
    return core.invoke
  } catch {
    return null
  }
}

function buildMockSnapshot(): DesktopSnapshot {
  return {
    bridge: mockStatus.bridge_mode,
    app_version: CURRENT_DESKTOP_VERSION,
    hostd_bin_path: '~/Library/Application Support/Sunvisai Desktop/hostd/macos-aarch64/hostd',
    app_close_action: 'hide',
    app_background_launch: false,
    app_autostart: { ...mockAutostartStatus },
    version: {
      version: '0.1.0',
      commit: 'dev',
      build_date: '',
      go_version: 'go1.24.0',
    },
    auth: {
      server_url: mockAuth.server_url,
      authenticated: mockAuth.authenticated,
      user: mockAuth.user ? { ...mockAuth.user } : null,
      bootstrap_init_done: mockAuth.bootstrap_init_done ?? null,
      auth_error: mockAuth.auth_error ?? null,
    },
    status: { ...mockStatus },
    helper_management: { ...mockHelperManagement },
    config_validation: mockConfigValidation.valid
      ? {
          valid: true,
          config_path: mockConfigValidation.config_path,
          state_path: mockConfigValidation.state_path,
          config: mockConfigValidation.config,
        }
      : { valid: false, error: mockConfigValidation.error },
  }
}

export async function getDesktopSnapshot(): Promise<DesktopSnapshot> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    return buildMockSnapshot()
  }
  return invoke<DesktopSnapshot>('desktop_snapshot')
}

export async function loginDesktop(serverUrl: string, username: string, password: string): Promise<DesktopLoginResult> {
  const normalizedServerUrl = serverUrl.trim()
  const normalizedUsername = username.trim()
  const normalizedPassword = password.trim()
  if (!normalizedServerUrl) {
    throw new Error('服务地址不能为空')
  }
  if (!normalizedUsername) {
    throw new Error('用户名不能为空')
  }
  if (!normalizedPassword) {
    throw new Error('密码不能为空')
  }
  const invoke = await resolveInvoke()
  if (invoke === null) {
    mockAuth = {
      server_url: normalizedServerUrl.endsWith('/') ? normalizedServerUrl : `${normalizedServerUrl}/`,
      authenticated: true,
      user: {
        user_id: 'mock-user-1',
        username: normalizedUsername,
        display_name: 'Mock User',
        role: 'system_admin',
      },
      bootstrap_init_done: true,
      auth_error: null,
    }
    mockStatus = {
      ...mockStatus,
      pairing_state: 'paired',
      has_runtime_token: true,
      online: true,
      connection_state: 'connected',
      last_connected_at: new Date().toISOString(),
      last_error: '',
      last_gateway_url: mockAuth.server_url.replace(/^http/, 'ws').replace(/\/$/, '/ws/node'),
    }
    return {
      authenticated: true,
      bind_succeeded: true,
      bind_error: null,
      auth: {
        server_url: mockAuth.server_url,
        authenticated: mockAuth.authenticated,
        user: mockAuth.user ? { ...mockAuth.user } : null,
        bootstrap_init_done: mockAuth.bootstrap_init_done ?? null,
        auth_error: mockAuth.auth_error ?? null,
      },
    }
  }
  return invoke<DesktopLoginResult>('desktop_login', {
    serverUrl: normalizedServerUrl,
    username: normalizedUsername,
    password,
  })
}

export async function bindCurrentRuntime(): Promise<PairStatus> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    if (!mockAuth.authenticated) {
      throw new Error('请先登录账号')
    }
    mockStatus = {
      ...mockStatus,
      pairing_state: 'paired',
      has_runtime_token: true,
      online: true,
      connection_state: 'connected',
      last_connected_at: new Date().toISOString(),
      last_error: '',
    }
    return { ...mockStatus }
  }
  return invoke<PairStatus>('desktop_bind_current_runtime')
}

export async function reconnectRuntime(): Promise<PairStatus> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    if (!mockStatus.has_runtime_token) {
      throw new Error('当前设备尚未绑定，无法重新连接')
    }
    mockStatus = {
      ...mockStatus,
      online: true,
      connection_state: 'connected',
      last_connected_at: new Date().toISOString(),
      last_error: '',
    }
    return { ...mockStatus }
  }
  return invoke<PairStatus>('desktop_reconnect_runtime')
}

export async function logoutDesktop(): Promise<DesktopAuthState> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    mockAuth = {
      ...mockAuth,
      authenticated: false,
      user: null,
    }
    mockStatus = {
      ...mockStatus,
      pairing_state: 'unpaired',
      has_runtime_token: false,
      online: false,
      connection_state: 'offline',
      last_connected_at: '',
    }
    return {
      server_url: mockAuth.server_url,
      authenticated: false,
      user: null,
      bootstrap_init_done: mockAuth.bootstrap_init_done ?? null,
      auth_error: null,
    }
  }
  return invoke<DesktopAuthState>('desktop_logout')
}

export async function syncDesktopAuthState(): Promise<DesktopAuthState> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    return {
      server_url: mockAuth.server_url,
      authenticated: mockAuth.authenticated,
      user: mockAuth.user ? { ...mockAuth.user } : null,
      bootstrap_init_done: mockAuth.bootstrap_init_done ?? null,
      auth_error: mockAuth.auth_error ?? null,
    }
  }
  return invoke<DesktopAuthState>('desktop_sync_auth_state')
}

export async function validateDesktopConfig(): Promise<ConfigValidation> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    return buildMockSnapshot().config_validation
  }
  return invoke<ConfigValidation>('desktop_validate_config')
}

export async function setRuntimeToken(token: string): Promise<PairStatus> {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error('设备 token 不能为空')
  }
  const invoke = await resolveInvoke()
  if (invoke === null) {
    mockStatus = {
      ...mockStatus,
      pairing_state: 'paired',
      has_runtime_token: true,
      online: true,
      connection_state: 'connected',
      last_connected_at: new Date().toISOString(),
      last_error: '',
    }
    return { ...mockStatus }
  }
  return invoke<PairStatus>('desktop_set_runtime_token', { token: trimmed })
}

export async function clearRuntimeToken(): Promise<PairStatus> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    mockStatus = {
      ...mockStatus,
      pairing_state: 'unpaired',
      has_runtime_token: false,
      online: false,
      connection_state: 'offline',
      last_connected_at: '',
      last_error: '',
    }
    return { ...mockStatus }
  }
  return invoke<PairStatus>('desktop_clear_runtime_token')
}

export async function setDesktopAutostart(enabled: boolean): Promise<AppAutostartStatus> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    mockAutostartStatus = {
      ...mockAutostartStatus,
      enabled,
      last_error: undefined,
    }
    return { ...mockAutostartStatus }
  }
  return invoke<AppAutostartStatus>('desktop_set_app_autostart', { enabled })
}

function proxyFetchUrl(url: string, proxyUrl: string): string {
  const trimmed = proxyUrl.trim()
  if (!trimmed) {
    return url
  }
  if (trimmed.includes('{url}')) {
    return trimmed.split('{url}').join(encodeURIComponent(url))
  }
  return `${trimmed.replace(/\/+$/, '')}/${url}`
}

function comparableReleaseVersion(value: string): string {
  return value.trim().replace(/^[vV]/, '')
}

function releaseUpdateAvailable(latestVersion: string, currentVersion: string): boolean {
  const latest = comparableReleaseVersion(latestVersion)
  const current = comparableReleaseVersion(currentVersion)
  return Boolean(latest && latest !== current)
}

export async function checkDesktopClientUpdate(proxyUrl = ''): Promise<DesktopClientUpdateCheck> {
  const manifestUrl = releaseManifestUrl()
  const invoke = await resolveInvoke()
  if (invoke === null) {
    const response = await fetch(proxyFetchUrl(manifestUrl, proxyUrl), { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      throw new Error(`检查更新失败：${response.status} ${response.statusText}`.trim())
    }
    const manifest = await response.json()
    const asset = selectPreferredDesktopAsset(manifest)
    const installAsset = selectPreferredDesktopInstallAsset(manifest)
    const currentVersion = CURRENT_DESKTOP_VERSION
    const latestVersion = String(manifest.release?.version || '')
    return {
      manifest_url: manifestUrl,
      proxy_url: proxyUrl.trim() || undefined,
      current_version: currentVersion,
      latest_version: latestVersion,
      update_available: releaseUpdateAvailable(latestVersion, currentVersion),
      checked_at: new Date().toISOString(),
      asset,
      install_asset: installAsset,
      all_assets: Array.isArray(manifest.clients?.desktop) ? manifest.clients.desktop : [],
    }
  }
  return invoke<DesktopClientUpdateCheck>('desktop_check_client_update', { manifestUrl, proxyUrl })
}

export async function downloadDesktopClientUpdate(proxyUrl = ''): Promise<DesktopClientUpdateDownload> {
  const manifestUrl = releaseManifestUrl()
  const invoke = await resolveInvoke()
  if (invoke === null) {
    const check = await checkDesktopClientUpdate(proxyUrl)
    if (!check.asset) {
      throw new Error('当前平台没有可下载的桌面客户端包')
    }
    throw new Error(`浏览器预览模式不支持写入 Downloads，请打开 ${proxyFetchUrl(check.asset.url, proxyUrl)}`)
  }
  return invoke<DesktopClientUpdateDownload>('desktop_download_client_update', { manifestUrl, proxyUrl })
}

export async function installDesktopClientUpdate(proxyUrl = ''): Promise<DesktopClientUpdateInstall> {
  const manifestUrl = releaseManifestUrl()
  const invoke = await resolveInvoke()
  if (invoke === null) {
    throw new Error('浏览器预览模式不支持安装更新，请在 macOS 桌面客户端内操作')
  }
  return invoke<DesktopClientUpdateInstall>('desktop_install_client_update', { manifestUrl, proxyUrl })
}

export async function quitDesktopApplication(): Promise<void> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    return
  }
  await invoke('desktop_quit_application')
}
