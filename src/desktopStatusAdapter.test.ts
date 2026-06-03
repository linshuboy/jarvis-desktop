import { createDesktopRuntimeProcessView } from './desktopStatusAdapter'
import type { ConfigValidation, DesktopAuthState, DesktopSnapshot } from './types'

const auth = {
  server_url: 'https://example.test',
  authenticated: true,
  user: { user_id: 'u1', username: 'owner' },
} satisfies DesktopAuthState

const config = {
  valid: true,
  config_path: '/tmp/config.toml',
  state_path: '/tmp/state.json',
  config: {
    gateway: { ws_url: 'wss://example.test/ws', tls_mode: 'system' },
    display_name: 'desktop',
    heartbeat_seconds: 10,
    components: { host: { enabled: true, methods: ['host.exec.run'] } },
    logging: { level: 'info' },
  },
} satisfies ConfigValidation

const snapshot = {
  bridge: 'tauri',
  app_version: '0.1.9',
  hostd_bin_path: '/tmp/hostd',
  app_close_action: 'hide',
  app_background_launch: true,
  app_autostart: {
    platform: 'linux',
    supported: true,
    enabled: false,
    mode: 'systemd',
    entry_path: '',
    target_path: '',
  },
  version: {
    version: '0.1.0',
    commit: 'test',
    build_date: '2026-04-27',
    go_version: 'go1.24',
  },
  auth,
  config_validation: config,
  helper_management: {
    mode: 'systemd',
    data_root: '/tmp',
  },
  status: {
    bridge_mode: 'tauri',
    helper_available: true,
    config_path: '/tmp/config.toml',
    state_path: '/tmp/state.json',
    control_socket_path: '/tmp/socket',
    runtime_id: 'runtime-1',
    pairing_state: 'paired',
    has_runtime_token: true,
    last_gateway_url: 'wss://example.test/ws',
    last_connected_at: '2026-04-27T10:00:00Z',
    last_error: '',
    online: true,
    connection_state: 'connected',
    helper_pid: 123,
  },
} satisfies DesktopSnapshot

const view = createDesktopRuntimeProcessView({ snapshot, effectiveAuth: auth, configValidation: config })

if (view.visibleEventCount !== 4 || view.status !== 'running') {
  throw new Error('Desktop runtime process adapter did not build the expected shared process view')
}
