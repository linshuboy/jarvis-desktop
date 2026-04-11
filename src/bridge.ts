import type { ConfigValidation, DesktopSnapshot, PairStatus } from './types'

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
  config_path: '~/Library/Application Support/hostd/config.json',
  state_path: '~/Library/Application Support/hostd/state.json',
  control_socket_path: '~/Library/Application Support/hostd/control.sock',
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
    version: {
      version: '0.1.0',
      commit: 'dev',
      build_date: '',
      go_version: 'go1.24.0',
    },
    status: { ...mockStatus },
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
    throw new Error('runtime token 不能为空')
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
