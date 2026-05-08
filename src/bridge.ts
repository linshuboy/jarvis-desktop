import type {
  AppAutostartStatus,
  ConfigValidation,
  DesktopAuthState,
  DesktopLoginResult,
  DesktopSnapshot,
  HelperManagementStatus,
  PairStatus,
} from './types'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

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
  config_path: '~/Library/Application Support/JARVIS Desktop/hostd/config.json',
  state_path: '~/Library/Application Support/JARVIS Desktop/hostd/state.json',
  control_socket_path: '~/Library/Application Support/JARVIS Desktop/hostd/control.sock',
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
  server_url: 'https://jarvis.example.com/',
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
  data_root: '~/Library/Application Support/JARVIS Desktop/hostd',
}

let mockAutostartStatus: AppAutostartStatus = {
  platform: 'darwin',
  supported: true,
  enabled: false,
  mode: 'background',
  entry_path: '~/Library/LaunchAgents/ai.jarvis.desktop.autostart.plist',
  target_path: '/Applications/JARVIS Desktop.app/Contents/MacOS/JARVIS Desktop',
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
    hostd_bin_path: '~/Library/Application Support/JARVIS Desktop/hostd/macos-aarch64/hostd',
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

export async function quitDesktopApplication(): Promise<void> {
  const invoke = await resolveInvoke()
  if (invoke === null) {
    return
  }
  await invoke('desktop_quit_application')
}
